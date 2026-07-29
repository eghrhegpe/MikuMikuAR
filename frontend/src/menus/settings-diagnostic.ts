// settings-diagnostic.ts — AI 诊断助手面板（ADR-196 Phase 1）
// 三分区：上下文信息 / 聊天对话 / 端点配置
// 通过 resolveAi() 获取适配器实例，双路径（browser-adapter / go-adapter）统一分发

import { t } from '../core/i18n/t';
import { getLang } from '../core/i18n/locale';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import { getErrors, clearErrors, captureError, type ErrorEntry } from '../core/ai/error-buffer';
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
import { buildToolCatalogText, buildToolSchemas } from '../core/ai/action-catalog';
import { executeAction, parseActionFromLLM } from '../core/ai/intent-dispatcher';
import { getActiveBible, buildDialogueSystemPrompt } from '../core/ai/dialogue-session';
import { parseDialogueLines, type DialogueLine } from '../core/ai/character-bible';
import { speakLines, cancelSpeech } from '../core/ai/dialogue-speech';
import { getAction } from '../core/action-registry';
import { showConfirm } from '../core/dialog';
import { showErrorToast } from '../core/toast';
import { logWarn } from '../core/logger';
import { DebouncedTimer } from '../core/async';

// ======== 模块级状态 ========

/** 面板四态：诊断 / 闲聊 / 控制 / 台词（ADR-196 + ADR-156）。 */
type DiagMode = 'diagnostic' | 'chat' | 'control' | 'dialogue';

/** tab 顺序单一数据源，驱动 tab 构建、键盘导航与刷新。 */
const DIAG_MODES: readonly DiagMode[] = ['diagnostic', 'chat', 'control', 'dialogue'];

let _ai: AiService | null = null;
let _caps: AiCapabilities | null = null;
let _aiResolved = false;
const _messages: ChatMessage[] = [];
let _isStreaming = false;
let _abortController: AbortController | null = null;
let _mode: DiagMode = 'diagnostic';

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
// [doc:adr-155] 多 tool_call 复合指令：_pendingAction 为“当前待确认”，其余排队于 _pendingQueue。
// 逐条弹卡，用户应用/取消一条后自动弹下一条。
let _pendingQueue: Array<{
    actionId: string;
    params: Record<string, unknown>;
    toolCallId?: string;
}> = [];
// 当前批次全部 tool_call 的元数据（按 OpenAI 协议，每个 tool_call 均需回填 tool 消息，
// 否则下一轮请求报错）。队列清空后统一回填 + 触发后续 stream。
let _pendingToolResults: Array<{ toolCallId: string; content: string }> = [];
let _pendingBatchHasToolCalls = false;
let _pendingContainer: HTMLElement | null = null;
// [doc:adr-155] 破坏性动作执行成功后的可撤销引用（复用 scene:undo 快照能力）。
// 仅保留最近一个；下一个 pending 动作入列或撤销执行后清空。
let _lastUndoable: { label: string } | null = null;

/** 台词模式：是否朗读出声（默认开，环境不支持时 speakLines 自静默）。 */
let _speakEnabled = true;
/** 台词模式朗读开关按钮引用（仅 dialogue 模式可见，由 _refreshModeUI 控制显隐）。 */
let _speakToggleBtn: HTMLButtonElement | null = null;

/** Go 桌面端后端 key 已配置标志（前端不可读明文，用于输入框占位提示）。 */
let _goKeyConfigured = false;

/** 当前面板编辑态的配置副本，blur 时同步到持久化层。
 *  模块加载时为占位值，建配置卡前由 _loadInitialConfig() 覆写（见 buildConfigSchema 两阶段渲染）。 */
let _localConfig: AiConfig = { ...loadAiConfig() };

/** 自动连接测试防抖定时器 */
let _autoTestTimer: DebouncedTimer | null = null;
let _autoTesting = false;

// ======== 生命周期 ========

// 面板打开时异步 resolve AiService
resolveAi()
    .then(async (ai) => {
        _ai = ai;
        _aiResolved = true;
        // 配置回填在 config-card 两阶段渲染中完成（_loadInitialConfig），
        // 先 resolve 再渲染，消除"默认值闪切"时序竞态。
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

function _fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 从端点 hostname 精确推断服务商，避免 substring 误匹配。 */
function _inferProvider(endpoint: string): AiConfigProvider {
    if (!endpoint) {
        return 'custom';
    }
    let hostname: string;
    try {
        hostname = new URL(endpoint).hostname;
    } catch {
        return 'custom';
    }
    const matched = (Object.keys(PROVIDER_PRESETS) as AiConfigProvider[])
        .filter((p) => p !== 'custom')
        .find((p) => {
            try {
                return new URL(PROVIDER_PRESETS[p].endpoint).hostname === hostname;
            } catch {
                return false;
            }
        });
    return matched ?? 'custom';
}

/** 合并 IndexedDB + 适配器持久化配置，确保 _localConfig 为真实保存值。
 *  key 出于安全 go 端不回读明文，仅用 keyConfigured 标志由 _renderConfigCard 显示占位。
 *  内部 await resolveAi() 以保证适配器已就绪，消除"遗漏适配器配置"的时序窗口。 */
async function _loadInitialConfig(): Promise<void> {
    await ensureAiConfigLoaded();
    _localConfig = { ...loadAiConfig() };
    // 等待适配器就绪，确保后续 _ai?.loadConfig 可用
    await resolveAi();
    if (_ai?.loadConfig) {
        try {
            const persisted = await _ai.loadConfig();
            if (persisted.endpoint || persisted.model) {
                _localConfig = {
                    ..._localConfig,
                    provider: _inferProvider(persisted.endpoint),
                    endpoint: persisted.endpoint,
                    model: persisted.model,
                    apiKey: persisted.apiKey ?? _localConfig.apiKey,
                };
            }
            // [doc:adr-196] Go 桌面端 key 已配置但明文不可回读，记标志供占位提示
            if (_ai.kind === 'go' && persisted.keyConfigured && !persisted.apiKey) {
                _goKeyConfigured = true;
            }
        } catch {
            /* keep IndexedDB defaults */
        }
    }
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

/** 把面板当前编辑态同步到对应持久化层。
 *  不调用 _refreshCaps（blur 频次高避免过刷），调用方按需自行刷新。 */
function _persistConfig(partial: Partial<AiConfig>): void {
    _localConfig = { ..._localConfig, ...partial };
    void _doSaveConfig();
}

/** 共享持久化逻辑：go 模式写 Go 后端 + IndexedDB 镜像（不含 key），browser 模式写 IndexedDB。
 *  (async 但内部已 catch，调用方可 void 丢弃) */
async function _doSaveConfig(): Promise<void> {
    try {
        if (_ai?.kind === 'go') {
            await _saveGoConfig({
                baseUrl: _localConfig.endpoint,
                model: _localConfig.model,
                aiKey: _localConfig.apiKey,
            });
            // 同步 endpoint/model 到 IndexedDB 镜像，保证重开面板时 _loadInitialConfig 有可读回退
            saveAiConfig({ ..._localConfig, apiKey: '' });
        } else {
            saveAiConfig(_localConfig);
        }
    } catch (err) {
        console.warn('[ai-config] 持久化失败', err);
    }
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
    _updateProviderButtons(provider);
    _updateDocLink(provider);
    // 清空旧 datalist，避免跨服务商残留旧发现模型
    if (_configModelDatalist) {
        _configModelDatalist.innerHTML = '';
    }
    // [doc:adr-196] 切换服务商：await 保存完成后再刷新能力/模型，避免 _refreshCaps 读到旧配置
    void (async () => {
        await _doSaveConfig();
        void _refreshCaps();
        void _refreshModelList();
    })();
}

async function _refreshModelList(): Promise<void> {
    if (!_ai) {
        return;
    }
    const models = await _ai.fetchModels?.() ?? [];
    if (_configModelDatalist && models.length > 0) {
        _configModelDatalist.innerHTML = '';
        for (const m of models) {
            const opt = document.createElement('option');
            opt.value = m;
            _configModelDatalist.appendChild(opt);
        }
    }
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
    // 所有状态直接映射到对应的 CSS class 和 i18n key，不再做信息压缩
    _statusBadgeEl.className = 'diag-status-badge diag-status-badge--' + state;
    _statusTextEl.textContent = t(`ai.status.${state}`);
}

function _focusInput(el: HTMLInputElement | null): void {
    if (!el) {
        return;
    }
    el.closest('.diag-field-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
}

function _renderAdvice(kind?: AiErrorKind): void {
    if (!_adviceEl) {
        return;
    }
    if (!kind) {
        _adviceEl.style.display = 'none';
        _adviceEl.innerHTML = '';
        return;
    }
    _adviceEl.className = 'diag-advice diag-advice--' + kind;

    // 清空并填入建议文本
    _adviceEl.innerHTML = '';
    const textSpan = document.createElement('span');
    textSpan.textContent = t(`ai.errorAdvice.${kind}`);
    _adviceEl.appendChild(textSpan);

    // 根据错误类型添加可操作入口
    const actions = document.createElement('div');
    actions.className = 'diag-advice-actions';

    if (kind === 'missingEndpoint' || kind === 'notFound') {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.endpoint');
        btn.addEventListener('click', () => _focusInput(_configEndpoint));
        actions.appendChild(btn);
    }
    if (kind === 'missingKey' || kind === 'unauthorized') {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.apiKey');
        btn.addEventListener('click', () => _focusInput(_configApiKey));
        actions.appendChild(btn);
    }
    if (kind === 'missingModel') {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.model');
        btn.addEventListener('click', () => _focusInput(_configModel));
        actions.appendChild(btn);
    }
    if (kind === 'cors' && _activeDocLink?.href) {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.doc', { provider: _activeDocLink.textContent ?? '' });
        btn.addEventListener('click', () => {
            window.open(_activeDocLink!.href, '_blank');
        });
        actions.appendChild(btn);
    }

    if (actions.children.length > 0) {
        _adviceEl.appendChild(actions);
    }

    _adviceEl.style.display = 'block';
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
    row.className = 'diag-error-row diag-error-row--' + err.severity;
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
        // 置位移入成功回调：import 失败时保持 false 以便下次进入 control 模式重试；
        // 补 catch 避免 rejection 静默丢弃（AGENTS.md「Promise 链断裂」反模式）。
        import('../core/ai/action-registry-defs')
            .then((m) => {
                m.registerAllActions();
                _controlRegistered = true;
            })
            .catch((err) => {
                logWarn('diagnostic', '动作注册表加载失败，控制模式动作将不可用', err);
            });
    }
}

function _selectTab(mode: DiagMode, btns: HTMLButtonElement[]): void {
    if (_mode === 'dialogue' && mode !== 'dialogue') {
        cancelSpeech(); // 离开台词模式时停掉未读完的语音
    }
    _mode = mode;
    _refreshModeUI(btns);
    if (mode === 'control') _ensureControlActions();
}

function _modeLabelKey(mode: DiagMode): string {
    switch (mode) {
        case 'diagnostic':
            return 'ai.mode.diagnostic';
        case 'chat':
            return 'ai.mode.chat';
        case 'control':
            return 'ai.mode.control';
        case 'dialogue':
            return 'ai.mode.dialogue';
    }
}

function _buildTab(mode: DiagMode, btns: HTMLButtonElement[]): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.setAttribute('role', 'tab');
    btn.textContent = t(_modeLabelKey(mode));
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
                group.className = 'type-row';

                const btns: HTMLButtonElement[] = [];
                for (const mode of DIAG_MODES) {
                    btns.push(_buildTab(mode, btns));
                }

                for (const btn of btns) group.appendChild(btn);
                c.appendChild(group);
            },
        },
    ];
}

function _refreshModeUI(btns: HTMLButtonElement[]): void {
    DIAG_MODES.forEach((mode, i) => {
        const btn = btns[i];
        if (!btn) return;
        const active = _mode === mode;
        btn.className = 'mode-btn' + (active ? ' active' : '');
        btn.setAttribute('aria-selected', String(active));
        btn.tabIndex = active ? 0 : -1;
    });
    _updateSpeakToggle(); // [doc:adr-156] 台词模式切换时同步朗读开关显隐
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

    // 台词模式：解析结构化对白 → 情绪卡片渲染 + 语音朗读（Step 2a）。
    if (_mode === 'dialogue' && fullText) {
        const lines = parseDialogueLines(fullText);
        _renderChat();
        _renderDialogueCards(lines);
        if (_speakEnabled) {
            speakLines(lines, _speechLang());
        }
        _updateSendButton();
        return;
    }

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

/** i18n LangCode → SpeechSynthesis 的 BCP-47 语言标签。 */
function _speechLang(): string {
    switch (getLang()) {
        case 'ja':
            return 'ja-JP';
        case 'ko':
            return 'ko-KR';
        case 'en':
            return 'en-US';
        case 'zh-TW':
            return 'zh-TW';
        default:
            return 'zh-CN';
    }
}

/** 情绪 → 卡片 CSS 修饰类（与 emotion 同名，样式在 CSS 层控制）。 */
function _renderDialogueCards(lines: DialogueLine[]): void {
    if (!_chatContainer || lines.length === 0) {
        return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'diag-dialogue-cards';
    for (const { line, emotion } of lines) {
        const card = document.createElement('div');
        card.className = `diag-dialogue-card diag-emotion--${emotion}`;

        const tag = document.createElement('span');
        tag.className = 'diag-dialogue-emotion';
        tag.textContent = t('ai.dialogue.emotion.' + emotion);
        card.appendChild(tag);

        const body = document.createElement('div');
        body.className = 'diag-dialogue-line';
        body.textContent = line;
        card.appendChild(body);

        wrap.appendChild(card);
    }
    _chatContainer.appendChild(wrap);
    _chatContainer.scrollTop = _chatContainer.scrollHeight;
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
                captureError('ai-stream', chunk.error ?? 'AI stream error', undefined);
                showErrorToast(t('ai.errors.apiError', { msg: chunk.error ?? '' }));
                if (_chatContainer) {
                    const streamingRow = _chatContainer.querySelector('.chat-row--streaming');
                    if (streamingRow) {
                        streamingRow.remove();
                    }
                }
                const errTime = _fmtTime(Date.now());
                _addAssistantMessage(`${t('ai.errors.apiError', { msg: chunk.error ?? '' })} · ${errTime}`);
                _renderChat();
                break;
            } else if (chunk.type === 'done') {
                break;
            }
        }

        if (pendingToolCalls.length > 0) {
            // [doc:adr-155] 将全部 tool_call 入队（首条进 _pendingAction，其余进 _pendingQueue），
            // 逐条弹卡确认。无论单/多都需把全部 tool_call 写入对话历史，
            // 并在队列清空后为每个 tool_call 回填 tool 消息（保障协议完整）。
            const parsed = pendingToolCalls.map((tc) => {
                let params: Record<string, unknown> = {};
                try {
                    params = JSON.parse(tc.args);
                } catch {
                    /* ignore */
                }
                return { actionId: tc.name, params, toolCallId: tc.id };
            });
            // 过滤不支持的动作：不支持项直接回填失败 tool 消息，不入待确认队列。
            const supported: typeof parsed = [];
            _pendingToolResults = [];
            _pendingBatchHasToolCalls = true;
            for (const p of parsed) {
                if (getAction(p.actionId)) {
                    supported.push(p);
                } else {
                    _pendingToolResults.push({
                        toolCallId: p.toolCallId ?? '',
                        content: JSON.stringify({ success: false, message: '不支持的操作' }),
                    });
                }
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

            if (supported.length === 0) {
                // 全部不支持：直接收尾（回填 tool 消息 + 提示）。
                _addAssistantMessage(t('ai.control.unsupported'));
                await _finalizePendingBatch();
                return;
            }
            _pendingAction = supported[0];
            _pendingQueue = supported.slice(1);
            _lastUndoable = null;
            _renderPendingAction();
            return;
        }
    } catch (err) {
        streamErrorSeen = true;
        const errMsg = err instanceof Error ? err.message : String(err);
        captureError('ai-stream', errMsg, err);
        showErrorToast(t('ai.errors.apiError', { msg: errMsg }));
        if (_chatContainer) {
            const streamingRow = _chatContainer.querySelector('.chat-row--streaming');
            if (streamingRow) {
                streamingRow.remove();
            }
        }
        const errTime = _fmtTime(Date.now());
        _addAssistantMessage(`${t('ai.errors.apiError', { msg: errMsg })} · ${errTime}`);
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
    // prompt 回退路径（单动作、无 tool_call）：重置队列批次状态，
    // 避免残留的 _pendingBatchHasToolCalls 导致收尾时误触发后续 stream。
    _pendingQueue = [];
    _pendingToolResults = [];
    _pendingBatchHasToolCalls = false;
    // 新 pending 动作入列，旧的可撤销引用失效（避免跨操作误撤销）。
    _lastUndoable = null;
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

    // [doc:adr-155] 上一个破坏性动作可撤销时，置顶渲染“撤销”入口（兑现 UX“操作结果可撤销”）。
    if (_lastUndoable) {
        const undoRow = document.createElement('div');
        undoRow.className = 'diag-control-undo-row';
        undoRow.setAttribute('data-testid', 'ai:control:undo-row');

        const undoHint = document.createElement('span');
        undoHint.className = 'diag-control-undo-hint';
        undoHint.textContent = t('ai.control.undoHint', { action: _lastUndoable.label });
        undoRow.appendChild(undoHint);

        const undoBtn = document.createElement('button');
        undoBtn.textContent = t('ai.control.undo');
        undoBtn.className = 'preset-chip';
        undoBtn.addEventListener('click', () => _undoLastAction(undoBtn));
        undoRow.appendChild(undoBtn);

        wrapper.appendChild(undoRow);
    }

    const hint = document.createElement('div');
    hint.className = 'diag-control-hint-text';
    hint.textContent = t('ai.control.emptyHint');
    wrapper.appendChild(hint);

    // [doc:adr-199 P1-1] 模型能力分级提示：控制模式依赖 function-calling / 稳定 JSON，弱模型易失败。
    const modelHint = document.createElement('div');
    modelHint.className = 'diag-control-hint-note';
    modelHint.textContent = t('ai.control.modelHint');
    wrapper.appendChild(modelHint);

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

async function _undoLastAction(btn: HTMLButtonElement): Promise<void> {
    if (!_lastUndoable) {
        return;
    }
    btn.disabled = true;
    btn.textContent = t('ai.control.executing');
    // scene:undo 内部已处理“无快照可撤销”的反馈（feedbackStatus）。
    const result = await executeAction('scene:undo', {});
    _lastUndoable = null;
    _messages.push({
        role: 'assistant',
        content: result.success
            ? t('ai.control.undone')
            : t('ai.control.resultFailed', { message: result.message }),
    });
    _renderControlHint();
    _renderChat();
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
    // [doc:adr-155] 多条待确认时显示进度（当前/总数）。
    // 总数 = 已处理（_pendingToolResults） + 当前 1 条 + 剩余队列。
    const total = _pendingToolResults.length + 1 + _pendingQueue.length;
    if (total > 1) {
        const current = _pendingToolResults.length + 1;
        title.textContent = t('ai.control.pendingProgress', {
            current: String(current),
            total: String(total),
        });
    } else {
        title.textContent = t('ai.control.pending');
    }
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'diag-pending-desc';
    desc.textContent = t(action.label);
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
        const ok = await showConfirm(
            t('ai.control.confirmDestructive', { action: t(action.label) })
        );
        if (!ok) {
            btn.disabled = false;
            btn.textContent = t('ai.control.apply');
            return;
        }
    }
    btn.disabled = true;
    btn.textContent = t('ai.control.executing');

    const result = await executeAction(_pendingAction.actionId, _pendingAction.params);
    // [doc:adr-155] 破坏性动作执行成功后记录可撤销引用，供 hint 区渲染“撤销”按钮。
    if (result.success && action?.destructive) {
        _lastUndoable = { label: t(action.label) };
    }
    const toolCallId = _pendingAction.toolCallId;
    if (toolCallId) {
        // 多 tool_call：攒存结果，待队列清空后统一回填 tool 消息。
        _pendingToolResults.push({
            toolCallId,
            content: JSON.stringify({ success: result.success, message: result.message }),
        });
    } else {
        // prompt 回退路径（无 tool_call）：直接写入助手文本。
        _messages.push({
            role: 'assistant',
            content: result.success
                ? t('ai.control.resultSuccess', { message: result.message })
                : t('ai.control.resultFailed', { message: result.message }),
        });
    }
    _renderChat();
    await _advancePendingQueue();
}

async function _cancelPendingAction(): Promise<void> {
    if (!_pendingAction) {
        return;
    }
    const toolCallId = _pendingAction.toolCallId;
    if (toolCallId) {
        // 取消也需为该 tool_call 回填一条结果，避免悬空导致下一轮请求报错。
        _pendingToolResults.push({
            toolCallId,
            content: JSON.stringify({ success: false, message: '用户已取消' }),
        });
    } else {
        _messages.push({ role: 'assistant', content: t('ai.control.cancelled') });
    }
    _renderChat();
    await _advancePendingQueue();
}

// [doc:adr-155] 弹出队列中下一条待确认动作；队列空时收尾。
async function _advancePendingQueue(): Promise<void> {
    if (_pendingQueue.length > 0) {
        _pendingAction = _pendingQueue.shift() ?? null;
        _renderPendingAction();
        return;
    }
    _pendingAction = null;
    await _finalizePendingBatch();
}

// [doc:adr-155] 当前批次全部处理完毕：为每个 tool_call 回填 tool 消息（保障协议完整），
// 若本批含 tool_call 则触发一次后续 stream（不再带 tools，避免无限递归）。
async function _finalizePendingBatch(): Promise<void> {
    const hadToolCalls = _pendingBatchHasToolCalls;
    const results = _pendingToolResults;
    _pendingToolResults = [];
    _pendingBatchHasToolCalls = false;

    for (const r of results) {
        if (r.toolCallId) {
            _messages.push({ role: 'tool', content: r.content, tool_call_id: r.toolCallId });
        }
    }
    _renderControlHint();
    _renderChat();

    if (hadToolCalls && results.some((r) => r.toolCallId)) {
        await _runStream({ allowTools: false });
    }
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
    if (_mode === 'dialogue') {
        return {
            role: 'system',
            content: buildDialogueSystemPrompt(getActiveBible()),
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

// [doc:adr-156/199] 更新朗读开关的文案/状态/显隐（仅 dialogue 模式可见）。
function _updateSpeakToggle(): void {
    if (!_speakToggleBtn) {
        return;
    }
    _speakToggleBtn.style.display = _mode === 'dialogue' ? '' : 'none';
    _speakToggleBtn.textContent = _speakEnabled
        ? t('ai.dialogue.speakOn')
        : t('ai.dialogue.speakOff');
    _speakToggleBtn.setAttribute('aria-checked', String(_speakEnabled));
    _speakToggleBtn.setAttribute('aria-label', t('ai.dialogue.speakToggle'));
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

                // [doc:adr-156/199] 台词模式朗读开关（仅 dialogue 模式可见）。
                _speakToggleBtn = document.createElement('button');
                _speakToggleBtn.id = 'diag-speak-toggle';
                _speakToggleBtn.className = 'preset-chip';
                _speakToggleBtn.setAttribute('role', 'switch');
                _speakToggleBtn.addEventListener('click', () => {
                    _speakEnabled = !_speakEnabled;
                    if (!_speakEnabled) {
                        cancelSpeech(); // 关闭时立即停掉当前朗读
                    }
                    _updateSpeakToggle();
                });
                inputRow.appendChild(_speakToggleBtn);
                _updateSpeakToggle();

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

function _saveGoConfig(partial: {
    baseUrl: string;
    model: string;
    aiKey: string;
}): Promise<void> {
    return import('@bindings/mikumikuar/internal/app/app').then((b) =>
        b.AiSetLLMConfig({
            baseUrl: partial.baseUrl,
            model: partial.model,
            aiKey: partial.aiKey,
        })
    );
}

/**
 * 显式保存：强制 flush 三个输入框当前值→await 持久化→返回成败。
 * 不依赖 blur 时机，避免"填完 key 直接点测试→key 未保存"的坑。
 */
async function _flushAndSave(): Promise<{ ok: boolean; error?: string }> {
    // 从输入框同步最新值到编辑态（blur 可能未触发）
    if (_configEndpoint) {
        _localConfig.endpoint = _configEndpoint.value;
    }
    if (_configModel) {
        _localConfig.model = _configModel.value;
    }
    if (_configApiKey) {
        _localConfig.apiKey = _configApiKey.value;
    }
    try {
        await _doSaveConfig();
        void _refreshCaps();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

async function _testConnection(statusEl: HTMLElement): Promise<void> {
    if (_testing || _autoTesting) {
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

    // 测试前先 flush 保存输入框当前值，避免测的是 blur 未触发的旧配置（尤其是刚填的 key）
    await _flushAndSave();

    const validation = validateAiConfig(_localConfig);
    if (!validation.ok) {
        const errMsg = validation.errors
            ? validation.errors.map((e) => t(e.message)).join('; ')
            : t(validation.message);
        statusEl.textContent = errMsg;
        statusEl.style.color = 'var(--warn)';
        captureError('ai-config', errMsg, undefined);
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
            captureError('ai-connection', result.message, undefined);
            _setStatusBadge(result.kind);
            _renderAdvice(result.kind);
            _lastConnectionOk = false;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusEl.textContent = msg;
        statusEl.style.color = 'var(--danger)';
        captureError('ai-connection', msg, err);
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
                // Phase 1: 加载占位（配置卡需先异步加载持久化配置，避免默认值闪切）
                const loadingEl = document.createElement('div');
                loadingEl.className = 'setting-hint';
                loadingEl.textContent = '⌛ ' + t('ai.config.loading');
                c.appendChild(loadingEl);

                // Phase 2: 异步加载配置 → 构建真实 UI
                void (async () => {
                    await _loadInitialConfig();
                    loadingEl.remove();
                    _renderConfigCard(c);
                })();
            },
        },
    ];
}

function _renderConfigCard(c: HTMLElement): void {
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

    const providers: AiConfigProvider[] = ['ollama', 'deepseek', 'openai', 'openrouter', 'custom'];
    for (const provider of providers) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = t(PROVIDER_PRESETS[provider].labelKey);
        btn.className = 'preset-chip' + (provider === _localConfig.provider ? ' active' : '');
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
        (v) => { _localConfig.endpoint = v; },
        'endpoint'
    );
    c.appendChild(endpointRow);
    _configEndpoint = endpointRow.querySelector('input') as HTMLInputElement;

    const apiKeyRow = createField(
        t('ai.config.apiKey'),
        'password',
        _localConfig.apiKey,
        (v) => { _localConfig.apiKey = v; },
        'apiKey'
    );
    c.appendChild(apiKeyRow);
    _configApiKey = apiKeyRow.querySelector('input') as HTMLInputElement;

    // Go 桌面端 key 已配置但明文不可回读，占位提示无需重填（_goKeyConfigured 由 _loadInitialConfig 填充）
    if (_ai?.kind === 'go' && _goKeyConfigured && _configApiKey) {
        _configApiKey.placeholder = t('ai.config.keyConfigured');
    }

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
    modelInput.addEventListener('blur', () => _persistConfig({ model: modelInput.value }));
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
            await _flushAndSave();
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
            modelRefresh.title =
                models.length > 0
                    ? t('ai.config.modelsFound', { n: String(models.length) })
                    : t('ai.config.modelsNone');
        } catch (err) {
            console.warn('[ai-config] 发现模型失败', err);
            modelRefresh.title = t('ai.config.modelsNone');
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

    const saveBtn = document.createElement('button');
    saveBtn.textContent = t('ai.config.save');
    saveBtn.className = 'preset-chip';
    saveBtn.setAttribute('aria-label', t('ai.config.save'));
    testRow.appendChild(saveBtn);

    const testBtn = document.createElement('button');
    testBtn.id = 'diag-test-btn';
    testBtn.textContent = t('ai.config.test');
    testBtn.className = 'preset-chip';
    testBtn.setAttribute('aria-label', t('ai.config.test'));
    testRow.appendChild(testBtn);

    const statusEl = document.createElement('span');
    statusEl.className = 'diag-status';
    testRow.appendChild(statusEl);

    let _saving = false;
    saveBtn.addEventListener('click', async () => {
        if (_saving) {
            return;
        }
        _saving = true;
        saveBtn.disabled = true;
        statusEl.textContent = t('ai.config.saving');
        statusEl.style.color = 'var(--text-muted)';
        const res = await _flushAndSave();
        statusEl.textContent = res.ok
            ? t('ai.config.saved')
            : `${t('ai.config.saveFailed')}: ${res.error ?? ''}`;
        statusEl.style.color = res.ok ? 'var(--success)' : 'var(--danger)';
        if (!res.ok) {
            captureError('ai-config', res.error ?? 'save failed', undefined);
        }
        _saving = false;
        saveBtn.disabled = false;
    });
    testBtn.addEventListener('click', () => void _testConnection(statusEl));
    c.appendChild(testRow);

    _updateDocLink(_localConfig.provider);
    _refreshConfigUI();
    _updateControlsEnabled();
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
            const dispose = renderMenu(buildDiagnosticSchema(), container);
            // [doc:adr-199] 关面板时收场：停朗读 + 中止流式请求，避免语音播到结束 / fetch 悬挂。
            return () => {
                cancelSpeech();
                _abortController?.abort();
                dispose();
                // [doc:adr-196 P5] 关面板时重置会话状态，保证下次打开为干净初始态
                _messages.length = 0;
                _isStreaming = false;
                _mode = 'diagnostic';
                _pendingAction = null;
                _pendingQueue = [];
                _pendingToolResults = [];
                _pendingBatchHasToolCalls = false;
                _lastUndoable = null;
                _autoTestTimer?.cancel();
                _autoTestTimer = null;
            };
        },
    };
}
