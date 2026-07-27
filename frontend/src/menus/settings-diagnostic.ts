// settings-diagnostic.ts — AI 诊断助手面板（ADR-196）
// 三分区：上下文信息 / 聊天对话 / 端点配置
// Phase 0: 通过 browser-adapter（Ollama / OpenAI 兼容端点）工作

import { t } from '../core/i18n/t';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import { getErrors, clearErrors } from '../core/ai/error-buffer';
import { captureSceneSnapshot } from '../core/ai/scene-snapshot';
import { loadAiConfig, saveAiConfig, type AiConfig } from '../core/ai/config-store';
import { browserAiAdapter } from '../core/ai/browser-adapter';
import type { ChatMessage, ChatChunk } from '../core/ai/types';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 聊天状态 ========

let _messages: ChatMessage[] = [];
let _isStreaming = false;
let _abortController: AbortController | null = null;

function _addSystemMessage(text: string): void {
    _messages.push({ role: 'assistant' as const, content: text });
}

// ======== 上下文卡片 ========

function buildContextSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:context',
            kind: 'custom',
            renderCustom: (c) => {
                const errors = getErrors();
                const snapshot = captureSceneSnapshot();

                const errCount = document.createElement('div');
                errCount.className = 'setting-hint';
                errCount.textContent = t('ai.errors.count', { count: String(errors.length) });
                c.appendChild(errCount);

                const snapshotEl = document.createElement('div');
                snapshotEl.className = 'setting-hint';
                snapshotEl.textContent = snapshot;
                c.appendChild(snapshotEl);

                const btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px';

                const clearBtn = document.createElement('button');
                clearBtn.textContent = t('ai.errors.clear');
                clearBtn.className = 'menu-btn';
                clearBtn.addEventListener('click', () => {
                    clearErrors();
                    _addSystemMessage(t('ai.errors.cleared'));
                    _renderChat();
                });
                btnRow.appendChild(clearBtn);

                const refreshBtn = document.createElement('button');
                refreshBtn.textContent = t('ai.snapshot.refresh');
                refreshBtn.className = 'menu-btn';
                refreshBtn.addEventListener('click', () => {
                    const snap = captureSceneSnapshot();
                    const hint = c.querySelector('.setting-hint:last-of-type');
                    if (hint) hint.textContent = snap;
                });
                btnRow.appendChild(refreshBtn);

                c.appendChild(btnRow);
            },
        },
    ];
}

// ======== 对话卡片 ========

let _chatContainer: HTMLElement | null = null;
let _inputEl: HTMLTextAreaElement | null = null;

function _renderChat(): void {
    if (!_chatContainer) return;
    _chatContainer.innerHTML = '';
    for (const msg of _messages) {
        const row = document.createElement('div');
        row.className = `chat-row chat-row--${msg.role}`;
        row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border-color, #333);font-size:13px';

        const label = document.createElement('strong');
        label.textContent = msg.role === 'user' ? t('ai.chat.you') : t('ai.chat.assistant');
        label.style.cssText = 'display:block;margin-bottom:2px;color:var(--accent-color, #6cf)';
        row.appendChild(label);

        const content = document.createElement('div');
        content.textContent = msg.content;
        row.appendChild(content);
        _chatContainer.appendChild(row);
    }
    _chatContainer.scrollTop = _chatContainer.scrollHeight;
}

function _renderStreamingChunk(chunk: ChatChunk): void {
    if (!_chatContainer) return;
    if (chunk.type === 'text' && chunk.content) {
        let lastRow = _chatContainer.lastElementChild;
        if (!lastRow || !lastRow.classList.contains('chat-row--streaming')) {
            const row = document.createElement('div');
            row.className = 'chat-row chat-row--streaming chat-row--assistant';
            row.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--border-color, #333);font-size:13px';
            const label = document.createElement('strong');
            label.textContent = t('ai.chat.assistant');
            label.style.cssText = 'display:block;margin-bottom:2px;color:var(--accent-color, #6cf)';
            row.appendChild(label);
            const content = document.createElement('div');
            content.textContent = '';
            row.appendChild(content);
            _chatContainer.appendChild(row);
            lastRow = row;
        }
        const contentDiv = lastRow.querySelector('div:last-child') as HTMLElement;
        if (contentDiv) {
            contentDiv.textContent += chunk.content;
        }
        _chatContainer.scrollTop = _chatContainer.scrollHeight;
    }
}

function _finalizeStream(fullText: string): void {
    if (fullText) {
        _messages.push({ role: 'assistant', content: fullText });
    }
    _isStreaming = false;
    _abortController = null;
    _renderChat();
    _updateSendButton();
}

async function _sendMessage(): Promise<void> {
    if (_isStreaming || !_inputEl) return;
    const text = _inputEl.value.trim();
    if (!text) return;

    const cfg = loadAiConfig();
    if (!cfg.endpoint) {
        _addSystemMessage(t('ai.errors.noEndpoint'));
        _renderChat();
        return;
    }

    _messages.push({ role: 'user', content: text });
    _inputEl.value = '';
    _renderChat();

    _isStreaming = true;
    _updateSendButton();
    _abortController = new AbortController();

    const contextParts: string[] = [];
    const errors = getErrors();
    if (errors.length > 0) {
        contextParts.push(t('ai.context.errors') + errors.map((e) => `[${e.tag}] ${e.message}`).join('\n'));
    }
    const snapshot = captureSceneSnapshot();
    if (snapshot !== '(场景未初始化)') {
        contextParts.push(t('ai.context.scene') + snapshot);
    }

    const systemMessage: ChatMessage = {
        role: 'system',
        content: [
            t('ai.system.role'),
            t('ai.system.format'),
            t('ai.system.safety'),
            contextParts.length > 0 ? t('ai.context.header') + contextParts.join('\n\n') : '',
        ]
            .filter(Boolean)
            .join('\n\n'),
    };

    const chatMessages: ChatMessage[] = [systemMessage, ..._messages.slice(-20)];
    let fullResponse = '';

    try {
        const chunks = browserAiAdapter.streamChat({
            messages: chatMessages,
            signal: _abortController.signal,
        });
        for await (const chunk of chunks) {
            if (chunk.type === 'text' && chunk.content) {
                fullResponse += chunk.content;
                _renderStreamingChunk(chunk);
            } else if (chunk.type === 'error') {
                _addSystemMessage(t('ai.errors.apiError', { msg: chunk.error ?? '' }));
                _renderChat();
                break;
            } else if (chunk.type === 'done') {
                break;
            }
        }
    } catch (err) {
        _addSystemMessage(t('ai.errors.apiError', { msg: err instanceof Error ? err.message : String(err) }));
        _renderChat();
    } finally {
        _finalizeStream(fullResponse);
    }
}

function _stopStreaming(): void {
    if (_abortController) {
        _abortController.abort();
        _abortController = null;
    }
}

function _updateSendButton(): void {
    const sendBtn = document.getElementById('diag-send-btn') as HTMLButtonElement | null;
    const stopBtn = document.getElementById('diag-stop-btn') as HTMLButtonElement | null;
    if (sendBtn) sendBtn.disabled = _isStreaming;
    if (stopBtn) stopBtn.style.display = _isStreaming ? '' : 'none';
}

function buildChatSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:chat',
            kind: 'custom',
            renderCustom: (c) => {
                _chatContainer = document.createElement('div');
                _chatContainer.style.cssText =
                    'max-height:300px;overflow-y:auto;margin-bottom:8px;padding:4px;background:var(--bg-secondary, #1a1a2e);border-radius:4px';
                c.appendChild(_chatContainer);

                const inputRow = document.createElement('div');
                inputRow.style.cssText = 'display:flex;gap:6px;align-items:flex-start';

                _inputEl = document.createElement('textarea');
                _inputEl.placeholder = t('ai.chat.placeholder');
                _inputEl.style.cssText = 'flex:1;min-height:36px;resize:vertical;padding:6px;border-radius:4px;border:1px solid var(--border-color,#444);background:var(--bg-primary,#111);color:var(--text-primary,#eee);font-size:13px';
                _inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void _sendMessage();
                    }
                });
                inputRow.appendChild(_inputEl);

                const sendBtn = document.createElement('button');
                sendBtn.id = 'diag-send-btn';
                sendBtn.textContent = t('ai.chat.send');
                sendBtn.className = 'menu-btn menu-btn--primary';
                sendBtn.addEventListener('click', () => void _sendMessage());
                inputRow.appendChild(sendBtn);

                const stopBtn = document.createElement('button');
                stopBtn.id = 'diag-stop-btn';
                stopBtn.textContent = t('ai.chat.stop');
                stopBtn.className = 'menu-btn';
                stopBtn.style.display = 'none';
                stopBtn.addEventListener('click', _stopStreaming);
                inputRow.appendChild(stopBtn);

                c.appendChild(inputRow);

                _renderChat();
            },
        },
    ];
}

// ======== 配置卡片 ========

function _testConnection(statusEl: HTMLElement): void {
    const cfg = loadAiConfig();
    if (!cfg.endpoint) {
        statusEl.textContent = t('ai.config.noEndpoint');
        statusEl.style.color = 'var(--error-color, #f55)';
        return;
    }
    statusEl.textContent = t('ai.config.testing');
    statusEl.style.color = 'var(--text-secondary, #999)';

    fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1,
            stream: false,
        }),
    })
        .then((res) => {
            if (res.ok) {
                statusEl.textContent = t('ai.config.connected');
                statusEl.style.color = 'var(--success-color, #5a5)';
            } else {
                statusEl.textContent = t('ai.config.httpError', { code: String(res.status) });
                statusEl.style.color = 'var(--warning-color, #fa0)';
            }
        })
        .catch(() => {
            statusEl.textContent = t('ai.config.connectionFailed');
            statusEl.style.color = 'var(--error-color, #f55)';
        });
}

function buildConfigSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:config',
            kind: 'custom',
            renderCustom: (c) => {
                const cfg = loadAiConfig();

                const createField = (
                    label: string,
                    type: string,
                    defaultValue: string,
                    onSave: (val: string) => void,
                ): HTMLDivElement => {
                    const row = document.createElement('div');
                    row.style.cssText = 'margin-bottom:8px';

                    const lbl = document.createElement('div');
                    lbl.textContent = label;
                    lbl.style.cssText = 'font-size:12px;margin-bottom:2px;color:var(--text-secondary,#999)';
                    row.appendChild(lbl);

                    const input = document.createElement('input');
                    input.type = type;
                    input.value = defaultValue;
                    input.style.cssText = 'width:100%;padding:6px;border-radius:4px;border:1px solid var(--border-color,#444);background:var(--bg-primary,#111);color:var(--text-primary,#eee);font-size:13px;box-sizing:border-box';
                    input.addEventListener('blur', () => {
                        onSave(input.value);
                    });
                    row.appendChild(input);
                    return row;
                };

                c.appendChild(
                    createField(t('ai.config.endpoint'), 'text', cfg.endpoint, (v) =>
                        saveAiConfig({ endpoint: v }),
                    ),
                );
                c.appendChild(
                    createField(t('ai.config.apiKey'), 'password', cfg.apiKey, (v) =>
                        saveAiConfig({ apiKey: v }),
                    ),
                );
                c.appendChild(
                    createField(t('ai.config.model'), 'text', cfg.model, (v) =>
                        saveAiConfig({ model: v }),
                    ),
                );

                const testRow = document.createElement('div');
                testRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px';

                const testBtn = document.createElement('button');
                testBtn.textContent = t('ai.config.test');
                testBtn.className = 'menu-btn';
                testRow.appendChild(testBtn);

                const statusEl = document.createElement('span');
                statusEl.style.cssText = 'font-size:12px';
                testRow.appendChild(statusEl);

                testBtn.addEventListener('click', () => _testConnection(statusEl));
                c.appendChild(testRow);
            },
        },
    ];
}

// ======== 主动预加载 AI 配置（后台加载 IndexedDB 数据，不阻塞渲染） ========
import { ensureAiConfigLoaded } from '../core/ai/config-store';
void ensureAiConfigLoaded();

// ======== 首次进入清空对话并显示欢迎 ========

function buildDiagnosticSchema(): MenuNode[] {
    if (_messages.length === 0) {
        _addSystemMessage(t('ai.welcome'));
    }
    return [
        {
            id: 'diagnostic:context-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('ai.context.title'));
                    return renderMenu(buildContextSchema(), inner);
                });
            },
        },
        {
            id: 'diagnostic:chat-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('ai.chat.title'));
                    return renderMenu(buildChatSchema(), inner);
                });
            },
        },
        {
            id: 'diagnostic:config-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('ai.config.title'));
                    return renderMenu(buildConfigSchema(), inner);
                });
            },
        },
    ];
}

export function buildSettingsDiagnosticLevel(
    getSettingsMenu: () => SettingsMenuHandle,
): PopupLevel {
    return {
        label: t('settings.diagnostic'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildDiagnosticSchema(), container);
        },
    };
}
