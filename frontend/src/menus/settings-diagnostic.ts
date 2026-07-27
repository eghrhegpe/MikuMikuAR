// settings-diagnostic.ts — AI 诊断助手面板（ADR-196 Phase 1）
// 三分区：上下文信息 / 聊天对话 / 端点配置
// 通过 resolveAi() 获取适配器实例，双路径（browser-adapter / go-adapter）统一分发

import { t } from '../core/i18n/t';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import { getErrors, clearErrors, type ErrorEntry } from '../core/ai/error-buffer';
import { captureSceneSnapshot } from '../core/ai/scene-snapshot';
import { loadAiConfig, saveAiConfig, ensureAiConfigLoaded } from '../core/ai/config-store';
import { resolveAi } from '../core/ai';
import type { AiService, AiCapabilities, ChatMessage, ChatChunk } from '../core/ai/types';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { buildToolCatalogText, buildToolSchemas } from '../core/ai/action-catalog';
import { executeAction } from '../core/ai/intent-dispatcher';
import { getAction } from '../core/action-registry';

// ======== 模块级状态 ========

let _ai: AiService | null = null;
let _caps: AiCapabilities | null = null;
let _aiResolved = false;
let _messages: ChatMessage[] = [];
let _isStreaming = false;
let _abortController: AbortController | null = null;
let _mode: 'diagnostic' | 'chat' | 'control' = 'diagnostic';

let _chatContainer: HTMLElement | null = null;
let _inputEl: HTMLTextAreaElement | null = null;
let _corsWarningEl: HTMLElement | null = null;
let _configEndpoint: HTMLInputElement | null = null;
let _configApiKey: HTMLInputElement | null = null;
let _configModel: HTMLInputElement | null = null;

let _controlRegistered = false;
let _pendingAction: { actionId: string; params: Record<string, unknown> } | null = null;
let _pendingContainer: HTMLElement | null = null;

// ======== 生命周期 ========

void ensureAiConfigLoaded();

// 面板打开时异步 resolve AiService
resolveAi()
    .then(async (ai) => {
        _ai = ai;
        _aiResolved = true;
        await _refreshCaps();
        _updateControlsEnabled();
        if (_messages.length === 0) {
            _addAssistantMessage(t('ai.welcome'));
            _renderChat();
        }
    })
    .catch(() => {
        _aiResolved = false;
        _addAssistantMessage(t('ai.errors.resolveFailed'));
        _renderChat();
    });

function _addAssistantMessage(text: string): void {
    _messages.push({ role: 'assistant', content: text });
}

async function _refreshCaps(): Promise<void> {
    if (!_ai) return;
    await _ai.refreshCapabilities?.();
    _caps = _ai.capabilities();
    _updateCorsWarning();
    _updateConfigFields();
}

function _updateControlsEnabled(): void {
    const sendBtn = document.getElementById('diag-send-btn') as HTMLButtonElement | null;
    const testBtn = document.getElementById('diag-test-btn') as HTMLButtonElement | null;
    if (sendBtn) sendBtn.disabled = !_aiResolved;
    if (testBtn) testBtn.disabled = !_aiResolved;
}

function _updateCorsWarning(): void {
    if (!_corsWarningEl) return;
    if (_caps && _caps.corsRisk !== 'none') {
        _corsWarningEl.style.display = '';
    } else {
        _corsWarningEl.style.display = 'none';
    }
}

function _updateConfigFields(): void {
    if (!_caps) return;
    if (_configEndpoint && _caps.available) {
        // go-adapter 从 AiGetLLMConfig 返回 baseUrl；browser-adapter 在 capabilities 中无 endpoint 字段
        // 对于 browser adapter，保持从 loadAiConfig 读取
        if (_ai?.kind === 'browser') {
            const cfg = loadAiConfig();
            _configEndpoint.value = cfg.endpoint;
            _configApiKey.value = cfg.apiKey;
            _configModel.value = cfg.model;
        }
    }
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

                for (const err of errors) {
                    const errRow = _createErrorRow(err);
                    c.appendChild(errRow);
                }

                const snapshotEl = document.createElement('div');
                snapshotEl.className = 'setting-hint';
                snapshotEl.textContent = snapshot;
                c.appendChild(snapshotEl);

                const btnRow = document.createElement('div');
                btnRow.className = 'diag-hint-row';

                const clearBtn = document.createElement('button');
                clearBtn.textContent = t('ai.errors.clear');
                clearBtn.className = 'preset-chip';
                clearBtn.addEventListener('click', () => {
                    clearErrors();
                    _addAssistantMessage(t('ai.errors.cleared'));
                    _renderChat();
                });
                btnRow.appendChild(clearBtn);

                const refreshBtn = document.createElement('button');
                refreshBtn.textContent = t('ai.snapshot.refresh');
                refreshBtn.className = 'preset-chip';
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

function _createErrorRow(err: ErrorEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'diag-error-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Error: ${err.tag}`);

    const tag = document.createElement('span');
    tag.textContent = `[${err.tag}]`;
    tag.className = 'diag-error-tag';
    row.appendChild(tag);

    const msg = document.createElement('span');
    msg.textContent = err.message;
    msg.className = 'diag-error-msg';
    row.appendChild(msg);

    if (err.stack) {
        const expandIcon = document.createElement('span');
        expandIcon.textContent = ' ▶';
        expandIcon.className = 'diag-error-expand';
        row.appendChild(expandIcon);

        const stackEl = document.createElement('pre');
        const stackLines = err.stack.split('\n').slice(0, 5).join('\n');
        stackEl.textContent = stackLines;
        stackEl.className = 'diag-error-stack';

        let expanded = false;
        const toggle = (): void => {
            expanded = !expanded;
            stackEl.style.display = expanded ? '' : 'none';
            expandIcon.textContent = expanded ? ' ▼' : ' ▶';
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });
        row.appendChild(stackEl);
    }

    return row;
}

// ======== 模式切换卡片 ========

function _ensureControlActions(): void {
    if (!_controlRegistered) {
        import('../core/ai/action-registry-defs').then((m) => m.registerControlActions());
        _controlRegistered = true;
    }
}

function buildModeSwitchSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:mode-switch',
            kind: 'custom',
            renderCustom: (c) => {
                const group = document.createElement('div');
                group.setAttribute('role', 'tablist');
                group.className = 'diag-mode-row';

                const diagBtn = document.createElement('button');
                diagBtn.setAttribute('role', 'tab');
                diagBtn.setAttribute('aria-selected', String(_mode === 'diagnostic'));
                diagBtn.textContent = t('ai.mode.diagnostic');
                diagBtn.className = 'mode-btn' + (_mode === 'diagnostic' ? ' active' : '');
                diagBtn.addEventListener('click', () => {
                    _mode = 'diagnostic';
                    _refreshModeUI(diagBtn, chatBtn, ctrlBtn);
                });

                const chatBtn = document.createElement('button');
                chatBtn.setAttribute('role', 'tab');
                chatBtn.setAttribute('aria-selected', String(_mode === 'chat'));
                chatBtn.textContent = t('ai.mode.chat');
                chatBtn.className = 'mode-btn' + (_mode === 'chat' ? ' active' : '');
                chatBtn.addEventListener('click', () => {
                    _mode = 'chat';
                    _refreshModeUI(diagBtn, chatBtn, ctrlBtn);
                });

                const ctrlBtn = document.createElement('button');
                ctrlBtn.setAttribute('role', 'tab');
                ctrlBtn.setAttribute('aria-selected', String(_mode === 'control'));
                ctrlBtn.textContent = t('ai.mode.control');
                ctrlBtn.className = 'mode-btn' + (_mode === 'control' ? ' active' : '');
                ctrlBtn.addEventListener('click', () => {
                    _mode = 'control';
                    _refreshModeUI(diagBtn, chatBtn, ctrlBtn);
                    _ensureControlActions();
                });

                group.appendChild(diagBtn);
                group.appendChild(chatBtn);
                group.appendChild(ctrlBtn);
                c.appendChild(group);
            },
        },
    ];
}

function _refreshModeUI(
    diagBtn: HTMLButtonElement,
    chatBtn: HTMLButtonElement,
    ctrlBtn: HTMLButtonElement
): void {
    diagBtn.className = 'mode-btn' + (_mode === 'diagnostic' ? ' active' : '');
    chatBtn.className = 'mode-btn' + (_mode === 'chat' ? ' active' : '');
    ctrlBtn.className = 'mode-btn' + (_mode === 'control' ? ' active' : '');
    diagBtn.setAttribute('aria-selected', String(_mode === 'diagnostic'));
    chatBtn.setAttribute('aria-selected', String(_mode === 'chat'));
    ctrlBtn.setAttribute('aria-selected', String(_mode === 'control'));
    if (_pendingContainer) {
        _pendingContainer.style.display = _mode === 'control' ? '' : 'none';
    }
}

// ======== 对话卡片 ========

function _renderChat(): void {
    if (!_chatContainer) return;
    _chatContainer.innerHTML = '';
    for (const msg of _messages) {
        const row = document.createElement('div');
        row.className = `diag-chat-row chat-row--${msg.role}`;

        const label = document.createElement('strong');
        label.textContent = msg.role === 'user' ? t('ai.chat.you') : t('ai.chat.assistant');
        label.className = 'diag-chat-label';
        row.appendChild(label);

        const content = document.createElement('div');
        content.textContent = msg.content;
        content.className = 'diag-chat-content';
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
            row.className = 'diag-chat-row chat-row--streaming chat-row--assistant';
            const label = document.createElement('strong');
            label.textContent = t('ai.chat.assistant');
            label.className = 'diag-chat-label';
            row.appendChild(label);
            const content = document.createElement('div');
            content.textContent = '';
            content.className = 'diag-chat-content';
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

    if (_mode === 'control' && !_pendingAction && fullText) {
        _messages.push({ role: 'assistant', content: t('ai.control.unsupported') });
        _renderChat();
    }
}

function _renderPendingAction(): void {
    if (!_pendingContainer || !_pendingAction) return;
    _pendingContainer.innerHTML = '';
    _pendingContainer.style.display = '';

    const action = getAction(_pendingAction.actionId);
    if (!action) {
        _pendingContainer.textContent = t('ai.control.unsupported');
        return;
    }

    const card = document.createElement('div');
    card.className = 'diag-pending-card';
    card.setAttribute('role', 'alert');
    card.setAttribute('data-testid', 'ai:control:pending-action');

    const title = document.createElement('div');
    title.className = 'diag-pending-title';
    title.textContent = t('ai.control.pending');
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'diag-pending-desc';
    desc.textContent = action.label;
    card.appendChild(desc);

    const paramsList = document.createElement('div');
    paramsList.className = 'diag-pending-params';
    for (const [key, val] of Object.entries(_pendingAction.params)) {
        const paramRow = document.createElement('span');
        paramRow.textContent = `${key}: ${JSON.stringify(val)}`;
        paramsList.appendChild(paramRow);
    }
    card.appendChild(paramsList);

    const btnRow = document.createElement('div');
    btnRow.className = 'diag-hint-row';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = t('ai.control.apply');
    applyBtn.className = 'mode-btn active';
    applyBtn.addEventListener('click', () => _applyPendingAction(applyBtn));

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('ai.control.cancel');
    cancelBtn.className = 'preset-chip';
    cancelBtn.addEventListener('click', _cancelPendingAction);

    btnRow.appendChild(applyBtn);
    btnRow.appendChild(cancelBtn);
    card.appendChild(btnRow);

    _pendingContainer.appendChild(card);
}

async function _applyPendingAction(btn: HTMLButtonElement): Promise<void> {
    if (!_pendingAction) return;
    btn.disabled = true;
    btn.textContent = t('ai.control.executing');

    const result = await executeAction(_pendingAction.actionId, _pendingAction.params);
    _messages.push({
        role: 'assistant',
        content: result.success ? result.message : `❌ ${result.message}`,
    });
    _pendingAction = null;
    if (_pendingContainer) _pendingContainer.style.display = 'none';
    _renderChat();
}

function _cancelPendingAction(): void {
    _pendingAction = null;
    if (_pendingContainer) {
        _pendingContainer.style.display = 'none';
        _pendingContainer.innerHTML = '';
    }
    _messages.push({ role: 'assistant', content: t('ai.control.cancelled') });
    _renderChat();
}

function _buildSystemMessage(): ChatMessage {
    if (_mode === 'chat') {
        return {
            role: 'system',
            content: t('ai.system.role') + '\n\n' + t('ai.system.chat'),
        };
    }
    if (_mode === 'control') {
        const catalog = buildToolCatalogText();
        return {
            role: 'system',
            content: [
                t('ai.system.role'),
                t('ai.system.control'),
                catalog,
                t('ai.system.controlFormat'),
            ].join('\n\n'),
        };
    }
    const contextParts: string[] = [];
    const errors = getErrors();
    if (errors.length > 0) {
        contextParts.push(
            t('ai.context.errors') + errors.map((e) => `[${e.tag}] ${e.message}`).join('\n')
        );
    }
    const snapshot = captureSceneSnapshot();
    if (snapshot !== '(场景未初始化)') {
        contextParts.push(t('ai.context.scene') + snapshot);
    }
    return {
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
}

async function _sendMessage(): Promise<void> {
    if (_isStreaming || !_inputEl || !_ai) return;
    const text = _inputEl.value.trim();
    if (!text) return;

    _messages.push({ role: 'user', content: text });
    _inputEl.value = '';
    _renderChat();

    _isStreaming = true;
    _updateSendButton();
    _abortController = new AbortController();

    const systemMessage = _buildSystemMessage();

    // 只保留最近 10 轮 user+assistant 对（不含 system）
    const recentMessages = _messages.slice(-20);
    const chatMessages: ChatMessage[] = [systemMessage, ...recentMessages];
    let fullResponse = '';

    try {
        const requestTools = _mode === 'control' ? buildToolSchemas() : undefined;
        const chunks = _ai.streamChat({
            messages: chatMessages,
            signal: _abortController.signal,
            tools: requestTools,
        });
        for await (const chunk of chunks) {
            if (chunk.type === 'text' && chunk.content) {
                fullResponse += chunk.content;
                _renderStreamingChunk(chunk);
            } else if (chunk.type === 'tool_call') {
                let params: Record<string, unknown> = {};
                try {
                    params = JSON.parse(chunk.toolArgs ?? '{}');
                } catch { /* ignore parse failure */ }
                _pendingAction = { actionId: chunk.toolName ?? '', params };
                _renderPendingAction();
            } else if (chunk.type === 'error') {
                _addAssistantMessage(t('ai.errors.apiError', { msg: chunk.error ?? '' }));
                _renderChat();
                break;
            } else if (chunk.type === 'done') {
                break;
            }
        }
    } catch (err) {
        _addAssistantMessage(
            t('ai.errors.apiError', { msg: err instanceof Error ? err.message : String(err) })
        );
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

function _clearChat(): void {
    _messages.length = 0;
    _addAssistantMessage(t('ai.welcome'));
    _renderChat();
}

function _updateSendButton(): void {
    const sendBtn = document.getElementById('diag-send-btn') as HTMLButtonElement | null;
    const stopBtn = document.getElementById('diag-stop-btn') as HTMLButtonElement | null;
    if (sendBtn) sendBtn.disabled = _isStreaming || !_aiResolved;
    if (stopBtn) stopBtn.style.display = _isStreaming ? '' : 'none';
}

function buildChatSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:chat',
            kind: 'custom',
            renderCustom: (c) => {
                _chatContainer = document.createElement('div');
                _chatContainer.setAttribute('aria-live', 'polite');
                _chatContainer.setAttribute('aria-relevant', 'additions');
                _chatContainer.className = 'diag-chat-box';
                c.appendChild(_chatContainer);

                const inputRow = document.createElement('div');
                inputRow.className = 'diag-input-row';

                _inputEl = document.createElement('textarea');
                _inputEl.placeholder = t('ai.chat.placeholder');
                _inputEl.setAttribute('aria-label', t('ai.chat.placeholder'));
                _inputEl.className = 'diag-textarea';
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
                sendBtn.className = 'mode-btn active';
                sendBtn.setAttribute('aria-label', t('ai.chat.send'));
                sendBtn.addEventListener('click', () => void _sendMessage());
                inputRow.appendChild(sendBtn);

                const stopBtn = document.createElement('button');
                stopBtn.id = 'diag-stop-btn';
                stopBtn.textContent = t('ai.chat.stop');
                stopBtn.className = 'preset-chip';
                stopBtn.setAttribute('aria-label', t('ai.chat.stop'));
                stopBtn.style.display = 'none';
                stopBtn.addEventListener('click', _stopStreaming);
                inputRow.appendChild(stopBtn);

                const clearBtn = document.createElement('button');
                clearBtn.id = 'diag-clear-btn';
                clearBtn.textContent = t('ai.chat.clear');
                clearBtn.className = 'preset-chip';
                clearBtn.setAttribute('aria-label', t('ai.chat.clear'));
                clearBtn.addEventListener('click', _clearChat);
                inputRow.appendChild(clearBtn);

                c.appendChild(inputRow);

                _pendingContainer = document.createElement('div');
                _pendingContainer.className = 'diag-pending-area';
                _pendingContainer.style.display = 'none';
                _pendingContainer.setAttribute('data-testid', 'ai:control:pending-action');
                c.appendChild(_pendingContainer);

                _renderChat();
                _updateSendButton();
            },
        },
    ];
}

// ======== 配置卡片 ========

function _saveGoConfig(partial: { baseUrl?: string; model?: string; aiKey?: string }): void {
    import('@bindings/mikumikuar/internal/app/app').then((b) => {
        b.AiSetLLMConfig({
            baseUrl: partial.baseUrl ?? _configEndpoint?.value ?? '',
            model: partial.model ?? _configModel?.value ?? '',
            aiKey: partial.aiKey,
        }).catch(() => undefined);
    });
}

async function _testConnection(statusEl: HTMLElement): Promise<void> {
    if (!_ai) {
        statusEl.textContent = t('ai.config.notResolved');
        statusEl.style.color = 'var(--warn)';
        return;
    }
    statusEl.textContent = t('ai.config.testing');
    statusEl.style.color = 'var(--text-muted)';

    try {
        const result = await _ai.testConnection();
        if (result.ok) {
            statusEl.textContent = t('ai.config.connected');
            statusEl.style.color = 'var(--success)';
        } else {
            statusEl.textContent = result.message;
            statusEl.style.color = 'var(--danger)';
        }
    } catch (err) {
        statusEl.textContent = err instanceof Error ? err.message : String(err);
        statusEl.style.color = 'var(--danger)';
    }
}

function buildConfigSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:config',
            kind: 'custom',
            renderCustom: (c) => {
                const cfg = loadAiConfig();

                // CORS 风险提示条
                _corsWarningEl = document.createElement('div');
                _corsWarningEl.textContent = t('ai.config.corsWarning');
                _corsWarningEl.className = 'diag-warning';
                _corsWarningEl.setAttribute('role', 'alert');
                c.appendChild(_corsWarningEl);

                const createField = (
                    label: string,
                    type: string,
                    defaultValue: string,
                    onSave: (val: string) => void
                ): HTMLDivElement => {
                    const row = document.createElement('div');
                    row.className = 'diag-field-row';

                    const lbl = document.createElement('div');
                    lbl.textContent = label;
                    lbl.className = 'diag-field-label';
                    row.appendChild(lbl);

                    const input = document.createElement('input');
                    input.type = type;
                    input.value = defaultValue;
                    input.className = 'diag-input';
                    input.addEventListener('blur', () => {
                        onSave(input.value);
                    });
                    row.appendChild(input);
                    return row;
                };

                _configEndpoint = createField(
                    t('ai.config.endpoint'),
                    'text',
                    cfg.endpoint,
                    (v) => {
                        if (_ai?.kind === 'go') {
                            _saveGoConfig({ baseUrl: v });
                        } else {
                            saveAiConfig({ endpoint: v });
                        }
                    }
                ).querySelector('input') as HTMLInputElement;

                _configApiKey = createField(t('ai.config.apiKey'), 'password', cfg.apiKey, (v) => {
                    if (_ai?.kind === 'go') {
                        _saveGoConfig({ aiKey: v });
                    } else {
                        saveAiConfig({ apiKey: v });
                    }
                }).querySelector('input') as HTMLInputElement;

                _configModel = createField(t('ai.config.model'), 'text', cfg.model, (v) => {
                    if (_ai?.kind === 'go') {
                        _saveGoConfig({ model: v });
                    } else {
                        saveAiConfig({ model: v });
                    }
                }).querySelector('input') as HTMLInputElement;

                const testRow = document.createElement('div');
                testRow.className = 'diag-hint-row';

                const testBtn = document.createElement('button');
                testBtn.id = 'diag-test-btn';
                testBtn.textContent = t('ai.config.test');
                testBtn.className = 'preset-chip';
                testBtn.setAttribute('aria-label', t('ai.config.test'));
                testRow.appendChild(testBtn);

                const statusEl = document.createElement('span');
                statusEl.className = 'diag-status';
                testRow.appendChild(statusEl);

                testBtn.addEventListener('click', () => void _testConnection(statusEl));
                c.appendChild(testRow);

                _updateCorsWarning();
                _updateControlsEnabled();
            },
        },
    ];
}

// ======== 首次进入清空对话并显示欢迎 ========

function buildDiagnosticSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:mode-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('ai.mode.title'));
                    return renderMenu(buildModeSwitchSchema(), inner);
                });
            },
        },
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
    getSettingsMenu: () => SettingsMenuHandle
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
