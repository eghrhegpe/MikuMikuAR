// settings-diagnostic.ts — AI 诊断助手面板（ADR-196 Phase 1）
// 三分区：上下文信息 / 聊天对话 / 端点配置
// 通过 resolveAi() 获取适配器实例，双路径（browser-adapter / go-adapter）统一分发

import { t } from '../core/i18n/t';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import { getErrors, clearErrors, type ErrorEntry } from '../core/ai/error-buffer';
import { captureSceneSnapshot } from '../core/ai/scene-snapshot';
import {
    loadAiConfig,
    saveAiConfig,
    ensureAiConfigLoaded,
    PROVIDER_PRESETS,
    validateAiConfig,
    type AiConfig,
    type AiConfigProvider,
} from '../core/ai/config-store';
import { resolveAi } from '../core/ai';
import type {
    AiService,
    AiCapabilities,
    ChatMessage,
    ChatChunk,
    AiErrorKind,
} from '../core/ai/types';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { createKeyboardNav } from '../core/ui-keyboard-nav';
import type { Disposable } from '../core/dom';
import { buildToolCatalogText, buildToolSchemas } from '../core/ai/action-catalog';
import { executeAction, parseActionFromLLM } from '../core/ai/intent-dispatcher';
import { getAction } from '../core/action-registry';
import { showConfirm } from '../core/dialog';
import { DebouncedTimer } from '../core/async';

// ======== 模块级状态 ========

let _ai: AiService | null = null;
let _caps: AiCapabilities | null = null;
let _aiResolved = false;
const _messages: ChatMessage[] = [];
let _isStreaming = false;
let _abortController: AbortController | null = null;
let _mode: 'diagnostic' | 'chat' | 'control' = 'diagnostic';

let _chatContainer: HTMLElement | null = null;
let _inputEl: HTMLTextAreaElement | null = null;
let _corsWarningEl: HTMLElement | null = null;
let _configEndpoint: HTMLInputElement | null = null;
let _configApiKey: HTMLInputElement | null = null;
let _configModel: HTMLInputElement | null = null;
let _configModelDatalist: HTMLDataListElement | null = null;
let _statusBadgeEl: HTMLElement | null = null;
let _adviceEl: HTMLElement | null = null;
let _statusTextEl: HTMLElement | null = null;
let _lastConnectionOk: boolean | null = null;
let _testing = false;
let _refreshingCaps = false;

let _controlRegistered = false;
let _pendingAction: {
    actionId: string;
    params: Record<string, unknown>;
    toolCallId?: string;
} | null = null;
let _pendingContainer: HTMLElement | null = null;

/** 当前面板编辑态的配置副本，blur 时同步到持久化层。 */
let _localConfig: AiConfig = { ...loadAiConfig() };

/** 自动连接测试防抖定时器 */
let _autoTestTimer: DebouncedTimer | null = null;
let _autoTesting = false;

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
        _updateControlsEnabled();
    });

function _addAssistantMessage(text: string): void {
    _messages.push({ role: 'assistant', content: text });
}

async function _refreshCaps(): Promise<void> {
    if (_refreshingCaps || !_ai) {
        return;
    }
    _refreshingCaps = true;
    try {
        await _ai.refreshCapabilities?.();
        _caps = _ai.capabilities();
        _refreshConfigUI();
    } finally {
        _refreshingCaps = false;
    }
}

function _refreshConfigUI(): void {
    _updateCorsWarning();
    _updateApiKeyVisibility();
    if (_caps === null) {
        _setStatusBadge('initializing');
    } else {
        _updateStatusBadge();
        _scheduleAutoTest();
    }
}

/** 配置稳定后自动触发一次连接测试，避免用户手动点击。 */
function _scheduleAutoTest(): void {
    if (!_aiResolved || _testing) {
        return;
    }
    if (!_autoTestTimer) {
        _autoTestTimer = new DebouncedTimer();
    }
    _autoTestTimer.schedule(() => void _runAutoTest(), 600);
}

async function _runAutoTest(): Promise<void> {
    if (!_ai || _testing || _autoTesting) {
        return;
    }
    const validation = validateAiConfig(_localConfig);
    if (!validation.ok) {
        // 配置不完整时 badge/advice 已由校验结果接管，无需覆盖
        return;
    }

    _autoTesting = true;
    _setStatusBadge('testing');
    try {
        const result = await _ai.testConnection();
        if (result.ok) {
            _lastConnectionOk = true;
            _renderAdvice(undefined);
        } else {
            _lastConnectionOk = false;
            _renderAdvice(result.kind);
        }
    } catch (err) {
        _lastConnectionOk = false;
        _renderAdvice('unknown');
    } finally {
        _autoTesting = false;
        _updateStatusBadge();
    }
}

function _updateApiKeyVisibility(): void {
    if (!_configApiKey) {
        return;
    }
    const row = _configApiKey.closest('.diag-field-row') as HTMLElement | null;
    if (!row) {
        return;
    }
    const needsKey = PROVIDER_PRESETS[_localConfig.provider].needsKey;
    row.style.display = needsKey ? '' : 'none';
}

function _updateControlsEnabled(): void {
    const testBtn = document.getElementById('diag-test-btn') as HTMLButtonElement | null;
    if (testBtn) {
        testBtn.disabled = !_aiResolved;
    }
    _updateSendButton();
}

function _updateCorsWarning(): void {
    if (!_corsWarningEl) {
        return;
    }
    if (_caps && _caps.corsRisk !== 'none') {
        _corsWarningEl.style.display = '';
    } else {
        _corsWarningEl.style.display = 'none';
    }
}

/** 把面板当前编辑态同步到对应持久化层，并刷新能力探测。 */
function _persistConfig(partial: Partial<AiConfig>): void {
    _localConfig = { ..._localConfig, ...partial };
    if (_ai?.kind === 'go') {
        _saveGoConfig({
            baseUrl: _localConfig.endpoint,
            model: _localConfig.model,
            aiKey: _localConfig.apiKey,
        });
    } else {
        saveAiConfig(_localConfig);
    }
    void _refreshCaps();
}

/** 应用服务商预设，更新本地编辑态与输入框。 */
function _applyProvider(provider: AiConfigProvider): void {
    const preset = PROVIDER_PRESETS[provider];
    _localConfig.provider = provider;
    _localConfig.endpoint = preset.endpoint;
    _localConfig.model = preset.model;
    if (_configEndpoint) {
        _configEndpoint.value = preset.endpoint;
    }
    if (_configModel) {
        _configModel.value = preset.model;
    }
    _persistConfig({ provider, endpoint: preset.endpoint, model: preset.model });
    _updateProviderButtons(provider);
    _updateDocLink(provider);
}

function _updateStatusBadge(): void {
    if (!_statusBadgeEl || !_statusTextEl) {
        return;
    }
    const validation = validateAiConfig(_localConfig);
    if (!validation.ok && validation.kind) {
        _setStatusBadge(validation.kind);
        _renderAdvice(validation.kind);
        return;
    }
    if (_lastConnectionOk === true) {
        _setStatusBadge('connected');
        _renderAdvice(undefined);
    } else if (_lastConnectionOk === false) {
        _setStatusBadge('error');
    } else {
        _setStatusBadge(_caps?.available ? 'disconnected' : 'missingEndpoint');
        _renderAdvice(undefined);
    }
}

function _setStatusBadge(
    state: AiErrorKind | 'connected' | 'disconnected' | 'testing' | 'error' | 'initializing'
): void {
    if (!_statusBadgeEl || !_statusTextEl) {
        return;
    }
    const badgeState: string =
        state === 'connected' ||
        state === 'disconnected' ||
        state === 'testing' ||
        state === 'initializing'
            ? state
            : state === 'cors' || state === 'missingEndpoint' || state === 'missingKey'
              ? state
              : 'error';
    _statusBadgeEl.className = 'diag-status-badge diag-status-badge--' + badgeState;
    const textKey =
        state === 'connected' ||
        state === 'disconnected' ||
        state === 'testing' ||
        state === 'initializing' ||
        state === 'cors' ||
        state === 'missingEndpoint' ||
        state === 'missingKey'
            ? `ai.status.${state}`
            : 'ai.status.error';
    _statusTextEl.textContent = t(textKey);
}

function _renderAdvice(kind?: AiErrorKind): void {
    if (!_adviceEl) {
        return;
    }
    if (!kind) {
        _adviceEl.style.display = 'none';
        _adviceEl.textContent = '';
        return;
    }
    _adviceEl.textContent = t(`ai.errorAdvice.${kind}`);
    _adviceEl.className = 'diag-advice diag-advice--' + kind;
    _adviceEl.style.display = '';
}

let _activeProviderButtons: HTMLButtonElement[] = [];
let _activeDocLink: HTMLAnchorElement | null = null;

function _updateProviderButtons(active: AiConfigProvider): void {
    for (const btn of _activeProviderButtons) {
        const provider = btn.dataset.provider as AiConfigProvider;
        btn.className = 'preset-chip' + (provider === active ? ' active' : '');
    }
}

function _updateDocLink(provider: AiConfigProvider): void {
    if (!_activeDocLink) {
        return;
    }
    const preset = PROVIDER_PRESETS[provider];
    if (preset.docUrl) {
        _activeDocLink.href = preset.docUrl;
        _activeDocLink.textContent = t('ai.config.doc', { provider: t(preset.labelKey) });
        _activeDocLink.style.display = '';
    } else {
        _activeDocLink.style.display = 'none';
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
                    if (hint) {
                        hint.textContent = snap;
                    }
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
        expandIcon.setAttribute('aria-expanded', 'false');
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
            expandIcon.setAttribute('aria-expanded', String(expanded));
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
        import('../core/ai/action-registry-defs').then((m) => m.registerAllActions());
        _controlRegistered = true;
    }
}

function _selectTab(
    mode: 'diagnostic' | 'chat' | 'control',
    btns: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement]
): void {
    _mode = mode;
    _refreshModeUI(...btns);
    if (mode === 'control') _ensureControlActions();
}

function _buildTab(
    mode: 'diagnostic' | 'chat' | 'control',
    btns: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement]
): HTMLButtonElement {
    const labelKey =
        mode === 'diagnostic' ? 'ai.mode.diagnostic' : mode === 'chat' ? 'ai.mode.chat' : 'ai.mode.control';
    const btn = document.createElement('button');
    btn.setAttribute('role', 'tab');
    btn.textContent = t(labelKey);
    btn.className = 'mode-btn' + (_mode === mode ? ' active' : '');
    btn.addEventListener('click', () => _selectTab(mode, btns));
    return btn;
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

                const btns = [null, null, null] as unknown as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
                btns[0] = _buildTab('diagnostic', btns);
                btns[1] = _buildTab('chat', btns);
                btns[2] = _buildTab('control', btns);

                const navDisp: Disposable = createKeyboardNav(group, {
                    selector: 'button[role="tab"]',
                    onEnter: (el) => {
                        const idx = btns.indexOf(el as HTMLButtonElement);
                        if (idx >= 0) {
                            const modes = ['diagnostic', 'chat', 'control'] as const;
                            _selectTab(modes[idx], btns);
                        }
                    },
                    onArrowActivate: (el) => {
                        const idx = btns.indexOf(el as HTMLButtonElement);
                        if (idx >= 0) {
                            const modes = ['diagnostic', 'chat', 'control'] as const;
                            _selectTab(modes[idx], btns);
                        }
                    },
                    rovingTabIndex: true,
                    wrap: true,
                });

                for (const btn of btns) group.appendChild(btn);
                c.appendChild(group);

                return () => {
                    navDisp.dispose();
                };
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
    diagBtn.tabIndex = _mode === 'diagnostic' ? 0 : -1;
    chatBtn.setAttribute('aria-selected', String(_mode === 'chat'));
    chatBtn.tabIndex = _mode === 'chat' ? 0 : -1;
    ctrlBtn.setAttribute('aria-selected', String(_mode === 'control'));
    ctrlBtn.tabIndex = _mode === 'control' ? 0 : -1;
    if (_pendingContainer) {
        _pendingContainer.style.display = _mode === 'control' ? '' : 'none';
        if (_mode === 'control') {
            if (_pendingAction) {
                _renderPendingAction();
            } else {
                _renderControlHint();
            }
        }
    }
}

// ======== 对话卡片 ========

function _renderChat(): void {
    if (!_chatContainer) {
        return;
    }
    _chatContainer.innerHTML = '';
    for (const msg of _messages) {
        if (msg.role === 'tool') {
            continue;
        }
        if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls) {
            continue;
        }

        const row = document.createElement('div');
        row.className = `diag-chat-row chat-row--${msg.role}`;

        const label = document.createElement('strong');
        label.textContent = msg.role === 'user' ? t('ai.chat.you') : t('ai.chat.assistant');
        label.className = 'diag-chat-label';
        row.appendChild(label);

        const content = document.createElement('div');
        const textContent = typeof msg.content === 'string' ? msg.content : '';
        content.textContent = textContent;
        content.className = 'diag-chat-content';
        row.appendChild(content);
        _chatContainer.appendChild(row);
    }
    _chatContainer.scrollTop = _chatContainer.scrollHeight;
}

function _renderStreamingChunk(chunk: ChatChunk): void {
    if (!_chatContainer) {
        return;
    }
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

    if (_chatContainer && fullText) {
        const streamingRow = _chatContainer.querySelector('.chat-row--streaming');
        if (streamingRow) {
            streamingRow.classList.remove('chat-row--streaming');
            const contentDiv = streamingRow.querySelector(
                '.diag-chat-content'
            ) as HTMLElement | null;
            if (contentDiv) {
                contentDiv.textContent = fullText;
            }
            _chatContainer.scrollTop = _chatContainer.scrollHeight;
        } else {
            _renderChat();
        }
    } else {
        _renderChat();
    }

    _updateSendButton();
}

function _pruneHistory(messages: ChatMessage[], maxPairs: number = 10): ChatMessage[] {
    const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
    const body = systemMsg ? messages.slice(1) : messages;
    if (body.length <= maxPairs * 2) {
        return messages;
    }

    const keepFromIdx = body.length - maxPairs * 2;
    let start = keepFromIdx;
    while (start > 0 && body[start]?.role === 'tool') {
        start--;
    }
    if (start > 0 && body[start]?.role === 'assistant') {
        const asst = body[start] as Extract<ChatMessage, { role: 'assistant' }>;
        if (asst.tool_calls) {
            while (start > 0 && body[start - 1]?.role === 'tool') {
                start--;
            }
        }
    }
    const pruned = body.slice(start);
    return systemMsg ? [systemMsg, ...pruned] : pruned;
}

async function _runStream(opts?: { allowTools?: boolean }): Promise<void> {
    if (_isStreaming || !_ai) {
        return;
    }
    const allowTools = opts?.allowTools ?? _mode === 'control';

    _isStreaming = true;
    _updateSendButton();
    _abortController = new AbortController();

    const systemMessage = _buildSystemMessage();
    const chatMessages: ChatMessage[] = _pruneHistory([systemMessage, ..._messages]);
    let fullResponse = '';
    const pendingToolCalls: Array<{ id: string; name: string; args: string }> = [];
    let streamErrorSeen = false;

    try {
        const requestTools = allowTools ? buildToolSchemas() : undefined;
        const chunks = _ai.streamChat({
            messages: chatMessages,
            signal: _abortController.signal,
            tools: requestTools,
        });
        for await (const chunk of chunks) {
            if (chunk.type === 'text' && chunk.content) {
                fullResponse += chunk.content;
                _renderStreamingChunk(chunk);
            } else if (chunk.type === 'tool_call' && allowTools) {
                pendingToolCalls.push({
                    id: chunk.toolId ?? `call_${Date.now()}_${pendingToolCalls.length}`,
                    name: chunk.toolName ?? '',
                    args: chunk.toolArgs ?? '{}',
                });
            } else if (chunk.type === 'error') {
                streamErrorSeen = true;
                if (_chatContainer) {
                    const streamingRow = _chatContainer.querySelector('.chat-row--streaming');
                    if (streamingRow) {
                        streamingRow.remove();
                    }
                }
                _addAssistantMessage(t('ai.errors.apiError', { msg: chunk.error ?? '' }));
                _renderChat();
                break;
            } else if (chunk.type === 'done') {
                break;
            }
        }

        if (pendingToolCalls.length > 0) {
            const first = pendingToolCalls[0];
            let params: Record<string, unknown> = {};
            try {
                params = JSON.parse(first.args);
            } catch {
                /* ignore */
            }
            if (!_tryQueuePendingAction(first.name, params, first.id)) {
                _isStreaming = false;
                _abortController = null;
                _updateSendButton();
                _renderChat();
                _renderControlHint();
                return;
            }
            const assistantMsg: ChatMessage = {
                role: 'assistant',
                content: null,
                tool_calls: pendingToolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: tc.args },
                })),
            };
            _messages.push(assistantMsg);
            _isStreaming = false;
            _abortController = null;
            _updateSendButton();
            _renderChat();
            _renderPendingAction();
            return;
        }
    } catch (err) {
        streamErrorSeen = true;
        if (_chatContainer) {
            const streamingRow = _chatContainer.querySelector('.chat-row--streaming');
            if (streamingRow) {
                streamingRow.remove();
            }
        }
        _addAssistantMessage(
            t('ai.errors.apiError', { msg: err instanceof Error ? err.message : String(err) })
        );
        _renderChat();
    } finally {
        if (_isStreaming) {
            const handledAsControlFallback =
                !streamErrorSeen &&
                _mode === 'control' &&
                fullResponse &&
                !_pendingAction &&
                _handleControlFallback(fullResponse);
            if (!handledAsControlFallback) {
                if (streamErrorSeen) {
                    _isStreaming = false;
                    _abortController = null;
                    _updateSendButton();
                } else {
                    _finalizeStream(fullResponse);
                }
            }
        }
    }
}

function _handleControlFallback(fullResponse: string): boolean {
    const fallback = parseActionFromLLM(fullResponse);
    if (!fallback) {
        return false;
    }
    const queued = _tryQueuePendingAction(fallback.action, fallback.params, null);
    _isStreaming = false;
    _abortController = null;
    _updateSendButton();
    _renderChat();
    if (queued) {
        _renderPendingAction();
    } else {
        _renderControlHint();
    }
    return true;
}

function _tryQueuePendingAction(
    actionId: string,
    params: Record<string, unknown>,
    toolCallId: string | null
): boolean {
    const action = getAction(actionId);
    if (!action) {
        _addAssistantMessage(t('ai.control.unsupported'));
        return false;
    }
    _pendingAction = { actionId, params, toolCallId: toolCallId ?? undefined };
    return true;
}

function _renderControlHint(): void {
    if (!_pendingContainer || _pendingAction || _mode !== 'control') {
        return;
    }
    _pendingContainer.innerHTML = '';
    _pendingContainer.style.display = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'diag-control-hint';

    const hint = document.createElement('div');
    hint.className = 'diag-control-hint-text';
    hint.textContent = t('ai.control.emptyHint');
    wrapper.appendChild(hint);

    const catalog = buildToolCatalogText();
    if (catalog) {
        const title = document.createElement('div');
        title.className = 'diag-control-hint-title';
        title.textContent = t('ai.control.availableTools');
        wrapper.appendChild(title);

        const list = document.createElement('pre');
        list.className = 'diag-control-hint-list';
        list.textContent = catalog;
        wrapper.appendChild(list);
    }

    _pendingContainer.appendChild(wrapper);
}

function _renderPendingAction(): void {
    if (!_pendingContainer || !_pendingAction) {
        return;
    }
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
    card.setAttribute('data-testid', 'ai:control:pending-card');

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
    if (!_pendingAction) {
        return;
    }
    const action = getAction(_pendingAction.actionId);
    if (action?.destructive) {
        const ok = await showConfirm(t('ai.control.confirmDestructive', { action: action.label }));
        if (!ok) {
            btn.disabled = false;
            btn.textContent = t('ai.control.apply');
            return;
        }
    }
    btn.disabled = true;
    btn.textContent = t('ai.control.executing');

    const result = await executeAction(_pendingAction.actionId, _pendingAction.params);
    const toolCallId = _pendingAction.toolCallId;
    const toolContent = JSON.stringify({
        success: result.success,
        message: result.message,
    });
    if (toolCallId) {
        _messages.push({ role: 'tool', content: toolContent, tool_call_id: toolCallId });
    } else {
        _messages.push({
            role: 'assistant',
            content: result.success
                ? t('ai.control.resultSuccess', { message: result.message })
                : t('ai.control.resultFailed', { message: result.message }),
        });
    }
    _pendingAction = null;
    _renderControlHint();
    btn.disabled = false;
    btn.textContent = t('ai.control.apply');
    _renderChat();

    if (toolCallId) {
        if (result.success) {
            await _runStream({ allowTools: false });
        } else {
            _addAssistantMessage(t('ai.control.resultFailed', { message: result.message }));
            _renderChat();
        }
    }
}

function _cancelPendingAction(): void {
    const last = _messages[_messages.length - 1];
    if (last && last.role === 'assistant' && 'tool_calls' in last && last.tool_calls) {
        _messages.pop();
    }
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
    if (_isStreaming || !_inputEl || !_ai) {
        return;
    }
    const text = _inputEl.value.trim();
    if (!text) {
        return;
    }

    const validation = validateAiConfig(_localConfig);
    if (!validation.ok) {
        if (validation.kind) {
            _setStatusBadge(validation.kind);
            _renderAdvice(validation.kind);
        }
        _addAssistantMessage(t('ai.errorAdvice.' + (validation.kind ?? 'unknown')));
        _renderChat();
        return;
    }

    _messages.push({ role: 'user', content: text });
    _inputEl.value = '';
    _renderChat();

    await _runStream();
}

function _stopStreaming(): void {
    if (_abortController) {
        _abortController.abort();
        _abortController = null;
    }
}

async function _clearChat(): Promise<void> {
    const ok = await showConfirm(t('ai.chat.clearConfirm'));
    if (!ok) {
        return;
    }
    _messages.length = 0;
    _addAssistantMessage(t('ai.welcome'));
    _renderChat();
}

function _updateSendButton(): void {
    const sendBtn = document.getElementById('diag-send-btn') as HTMLButtonElement | null;
    const stopBtn = document.getElementById('diag-stop-btn') as HTMLButtonElement | null;
    if (sendBtn) {
        sendBtn.disabled = _isStreaming || !_aiResolved;
    }
    if (stopBtn) {
        stopBtn.style.display = _isStreaming ? '' : 'none';
    }
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
    if (_testing) {
        return;
    }
    _testing = true;
    if (!_ai) {
        statusEl.textContent = t('ai.config.notResolved');
        statusEl.style.color = 'var(--warn)';
        _lastConnectionOk = false;
        _updateStatusBadge();
        _testing = false;
        return;
    }

    const validation = validateAiConfig(_localConfig);
    if (!validation.ok) {
        statusEl.textContent = validation.errors
            ? validation.errors.map((e) => t(e.message)).join('; ')
            : t(validation.message);
        statusEl.style.color = 'var(--warn)';
        if (validation.kind) {
            _setStatusBadge(validation.kind);
            _renderAdvice(validation.kind);
        }
        _lastConnectionOk = false;
        _testing = false;
        return;
    }

    statusEl.textContent = t('ai.config.testing');
    statusEl.style.color = 'var(--text-muted)';
    _setStatusBadge('testing');
    _lastConnectionOk = null;

    try {
        const result = await _ai.testConnection();
        if (result.ok) {
            statusEl.textContent = t('ai.config.connected');
            statusEl.style.color = 'var(--success)';
            _lastConnectionOk = true;
            _renderAdvice(undefined);
        } else {
            statusEl.textContent = result.message;
            statusEl.style.color = 'var(--danger)';
            _setStatusBadge(result.kind === 'cors' ? 'cors' : 'error');
            _renderAdvice(result.kind);
            _lastConnectionOk = false;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusEl.textContent = msg;
        statusEl.style.color = 'var(--danger)';
        _setStatusBadge('error');
        _renderAdvice('unknown');
        _lastConnectionOk = false;
    } finally {
        _testing = false;
    }
    _updateStatusBadge();
}

function buildConfigSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:config',
            kind: 'custom',
            renderCustom: (c) => {
                _localConfig = { ...loadAiConfig() };
                _activeProviderButtons = [];
                _activeDocLink = null;

                // 状态徽章
                const statusBadge = document.createElement('div');
                statusBadge.className = 'diag-status-badge diag-status-badge--disconnected';
                const statusText = document.createElement('span');
                statusText.textContent = t('ai.status.disconnected');
                statusBadge.appendChild(statusText);
                c.appendChild(statusBadge);
                _statusBadgeEl = statusBadge;
                _statusTextEl = statusText;

                // 可操作的建议条
                const adviceEl = document.createElement('div');
                adviceEl.className = 'diag-advice';
                adviceEl.style.display = 'none';
                adviceEl.setAttribute('role', 'status');
                c.appendChild(adviceEl);
                _adviceEl = adviceEl;

                // 快速配置提示
                const hintEl = document.createElement('div');
                hintEl.className = 'setting-hint';
                hintEl.textContent = t('ai.config.providerHint');
                c.appendChild(hintEl);

                // 服务商选择 + 文档链接
                const providerRow = document.createElement('div');
                providerRow.className = 'diag-provider-row';

                const providers: AiConfigProvider[] = [
                    'ollama',
                    'deepseek',
                    'openai',
                    'openrouter',
                    'custom',
                ];
                for (const provider of providers) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = t(PROVIDER_PRESETS[provider].labelKey);
                    btn.className =
                        'preset-chip' + (provider === _localConfig.provider ? ' active' : '');
                    btn.dataset.provider = provider;
                    btn.addEventListener('click', () => _applyProvider(provider));
                    providerRow.appendChild(btn);
                    _activeProviderButtons.push(btn);
                }

                const docLink = document.createElement('a');
                docLink.target = '_blank';
                docLink.className = 'diag-link';
                docLink.setAttribute('aria-label', t('ai.config.doc', { provider: '' }));
                providerRow.appendChild(docLink);
                _activeDocLink = docLink;

                c.appendChild(providerRow);

                // CORS 风险提示条
                _corsWarningEl = document.createElement('div');
                _corsWarningEl.textContent = t('ai.config.corsWarning');
                _corsWarningEl.className = 'diag-warning';
                _corsWarningEl.setAttribute('role', 'alert');
                c.appendChild(_corsWarningEl);

                const createField = (
                    label: string,
                    type: string,
                    value: string,
                    onChange: (val: string) => void,
                    fieldKey?: keyof AiConfig
                ): HTMLDivElement => {
                    const row = document.createElement('div');
                    row.className = 'diag-field-row';

                    const lbl = document.createElement('div');
                    lbl.textContent = label;
                    lbl.className = 'diag-field-label';
                    row.appendChild(lbl);

                    const input = document.createElement('input');
                    input.type = type;
                    input.value = value;
                    input.className = 'diag-input';
                    input.addEventListener('input', () => onChange(input.value));
                    input.addEventListener('blur', () => {
                        _persistConfig(fieldKey ? { [fieldKey]: input.value } : _localConfig);
                    });
                    row.appendChild(input);
                    return row;
                };

                const endpointRow = createField(
                    t('ai.config.endpoint'),
                    'text',
                    _localConfig.endpoint,
                    (v) => {
                        _localConfig.endpoint = v;
                    },
                    'endpoint'
                );
                c.appendChild(endpointRow);
                _configEndpoint = endpointRow.querySelector('input') as HTMLInputElement;

                const apiKeyRow = createField(
                    t('ai.config.apiKey'),
                    'password',
                    _localConfig.apiKey,
                    (v) => {
                        _localConfig.apiKey = v;
                    },
                    'apiKey'
                );
                c.appendChild(apiKeyRow);
                _configApiKey = apiKeyRow.querySelector('input') as HTMLInputElement;

                const modelRow = document.createElement('div');
                modelRow.className = 'diag-field-row';
                const modelLabel = document.createElement('div');
                modelLabel.textContent = t('ai.config.model');
                modelLabel.className = 'diag-field-label';
                modelRow.appendChild(modelLabel);
                const modelInput = document.createElement('input');
                modelInput.type = 'text';
                modelInput.className = 'diag-input';
                modelInput.value = _localConfig.model;
                modelInput.setAttribute('list', 'diag-model-list');
                modelInput.setAttribute('aria-label', t('ai.config.model'));
                modelInput.addEventListener('input', () => {
                    _localConfig.model = modelInput.value;
                });
                modelInput.addEventListener('blur', () =>
                    _persistConfig({ model: modelInput.value })
                );
                modelRow.appendChild(modelInput);
                const modelRefresh = document.createElement('button');
                modelRefresh.textContent = '↻';
                modelRefresh.className = 'preset-chip';
                modelRefresh.setAttribute('title', t('ai.config.refreshModels'));
                modelRefresh.setAttribute('aria-label', t('ai.config.refreshModels'));
                modelRefresh.style.padding = '2px 10px';
                modelRefresh.style.fontSize = 'var(--font-ui-sm)';
                let _refreshing = false;
                modelRefresh.addEventListener('click', async () => {
                    if (_refreshing || !_ai) {
                        return;
                    }
                    _refreshing = true;
                    modelRefresh.disabled = true;
                    modelRefresh.textContent = '…';
                    try {
                        const models = (await _ai.fetchModels?.()) ?? [];
                        if (_configModelDatalist) {
                            _configModelDatalist.innerHTML = '';
                            for (const m of models) {
                                const opt = document.createElement('option');
                                opt.value = m;
                                _configModelDatalist.appendChild(opt);
                            }
                        }
                        if (models.length > 0 && !_localConfig.model) {
                            _localConfig.model = models[0];
                            modelInput.value = models[0];
                        }
                    } catch {
                        /* 静默失败，用户仍可手动输入 */
                    } finally {
                        _refreshing = false;
                        modelRefresh.disabled = false;
                        modelRefresh.textContent = '↻';
                    }
                });
                modelRow.appendChild(modelRefresh);
                const modelDatalist = document.createElement('datalist');
                modelDatalist.id = 'diag-model-list';
                modelRow.appendChild(modelDatalist);
                c.appendChild(modelRow);
                _configModel = modelInput;
                _configModelDatalist = modelDatalist;

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

                _updateDocLink(_localConfig.provider);
                _refreshConfigUI();
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
                return cardContainer(c, (inner) => {
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
