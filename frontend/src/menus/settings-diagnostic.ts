// settings-diagnostic.ts — AI 诊断助手面板（ADR-196 Phase 1）
// 三分区：上下文信息 / 聊天对话 / 端点配置
// 通过 resolveAi() 获取适配器实例，双路径（browser-adapter / go-adapter）统一分发

import { t } from '../core/i18n/t';
import { getLang } from '../core/i18n/locale';
import { cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import { captureError } from '../core/ai/error-buffer';
import {
    loadAiConfig,
    saveAiConfig,
    ensureAiConfigLoaded,
    PROVIDER_PRESETS,
    validateAiConfig,
    normalizeEndpoint,
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
import { executeActionById } from '../core/action-executor';
import { getActiveBible, buildDialogueSystemPrompt } from '../core/ai/dialogue-session';
import { parseDialogueLines, type DialogueLine } from '../core/ai/character-bible';
import { speakLines, cancelSpeech } from '../core/ai/dialogue-speech';
import { getAction, listActions } from '../core/action-registry';
import { showConfirm, showPrompt } from '../core/dialog';
import { showErrorToast } from '../core/toast';
import { logWarn, logInfo } from '../core/logger';
import { DebouncedTimer } from '../core/async';
import { goKeyAllowsProceed } from '../core/ai/go-key-allows-proceed';
import { renderMarkdownInto } from '../core/ai/markdown';
import {
    listSessions,
    loadSession,
    saveSession,
    deleteSession,
    getActiveId,
    setActiveId,
    clearActiveId,
    newSessionId,
    deriveTitle,
    type ChatSession,
} from '../core/ai/chat-store';

// ======== 模块级状态 ========

let _ai: AiService | null = null;
let _caps: AiCapabilities | null = null;
let _aiResolved = false;
const _messages: ChatMessage[] = [];
let _isStreaming = false;
let _abortController: AbortController | null = null;
/** 台词模式开关（合并后唯一模式差异化：on=角色扮演，off=统一 AI 助手） */
let _dialogueMode = false;

// [doc:adr-203] 多会话持久化状态
let _activeSessionId: string | null = null;
let _sessionCreatedAt = 0;
/** 会话历史加载完成前避免持久化空会话覆盖磁盘。 */
let _sessionLoaded = false;
/** 会话列表容器（Phase 2 独立面板会话卡）引用，切换后刷新高亮。 */
let _sessionListEl: HTMLElement | null = null;

let _chatContainer: HTMLElement | null = null;
let _inputEl: HTMLTextAreaElement | null = null;
let _corsWarningEl: HTMLElement | null = null;
let _configEndpoint: HTMLInputElement | null = null;
let _configApiKey: HTMLInputElement | null = null;
let _configModel: HTMLInputElement | null = null;
let _configModelDatalist: HTMLDataListElement | null = null;
/** 模型芯片列表容器（可见下拉，替代不可见的 datalist）。 */
let _modelListEl: HTMLElement | null = null;
let _statusBadgeEl: HTMLElement | null = null;
let _adviceEl: HTMLElement | null = null;
let _statusTextEl: HTMLElement | null = null;
let _lastConnectionOk: boolean | null = null;
let _lastConnectionKind: AiErrorKind | null = null;
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
/** 上次 fetchModels 获取到的模型列表，供测试填充缺省 model 使用。 */
let _fetchedModels: string[] = [];

/** Go 桌面端 key 不可回读，_goKeyConfigured=true 时 missingKey 不应阻止请求。
 *  委托给 core/ai/go-key-allows-proceed 纯函数。 */
function _goKeyAllowsProceed(validation: ReturnType<typeof validateAiConfig>): boolean {
    return goKeyAllowsProceed(validation, _ai?.kind === 'go', _goKeyConfigured);
}

/** 测试前确保 model 非空：若 model 为空且有已发现模型，自动取第一个并持久化。
 *  若还未获取过模型，主动触发一次 fetchModels。await 落盘后才返回，
 *  保证 Go 端已收到更新后再执行测试。 */
async function _ensureTestModel(): Promise<void> {
    if (_localConfig.model.trim()) {
        return;
    }
    // 首次无缓存：主动获取一次
    if (_fetchedModels.length === 0) {
        await _refreshModelList();
    }
    if (_fetchedModels.length > 0) {
        _localConfig.model = _fetchedModels[0];
        if (_configModel) {
            _configModel.value = _fetchedModels[0];
        }
        // 必须 await，确保 Go 端配置已更新（含 model）后再进行连接测试
        await _doSaveConfig();
    }
}

// ======== 生命周期 ========

// 面板打开时异步 resolve AiService
resolveAi()
    .then(async (ai) => {
        _ai = ai;
        _aiResolved = true;
        // 先恢复持久化的活动会话（_messages/_dialogueMode），再渲染，避免空会话闪切。
        await _loadActiveSession();
        // 配置回填在 config-card 两阶段渲染中完成（_loadInitialConfig），
        // 先 resolve 再渲染，消除"默认值闪切"时序竞态。
        await _refreshCaps();
        _updateControlsEnabled();
        _renderChat();
        _refreshSessionList();
    })
    .catch(() => {
        _aiResolved = false;
        _sessionLoaded = true;
        _renderChat();
        _updateControlsEnabled();
    });

function _addAssistantMessage(text: string): void {
    _messages.push({ role: 'assistant', content: text });
}

// ======== [doc:adr-203] 会话持久化 ========

const _persistTimer = new DebouncedTimer();

/** 立即把当前 _messages/_dialogueMode 写入活动会话（无 id 则新建）。降级静默。 */
async function _doPersistSession(): Promise<void> {
    if (!_sessionLoaded) {
        return;
    }
    // 空会话（无任何消息）不落盘，避免历史列表堆积空条目。
    if (_messages.length === 0) {
        return;
    }
    if (!_activeSessionId) {
        _activeSessionId = newSessionId();
        _sessionCreatedAt = Date.now();
        await setActiveId(_activeSessionId);
    }
    const title = deriveTitle(_messages) || t('ai.chat.untitled');
    await saveSession({
        id: _activeSessionId,
        title,
        dialogueMode: _dialogueMode,
        createdAt: _sessionCreatedAt || Date.now(),
        updatedAt: Date.now(),
        messages: [..._messages],
    });
    _refreshSessionList();
}

/** 防抖持久化（对话流式频繁触发时合并写）。 */
function _persistSession(): void {
    _persistTimer.schedule(() => void _doPersistSession(), 500);
}

/** flush 防抖并同步落盘（关面板 / 切换会话前调用）。 */
async function _flushSession(): Promise<void> {
    _persistTimer.cancel();
    await _doPersistSession();
}

/** 面板打开时恢复活动会话到 _messages/_dialogueMode。无活动会话则保持空（首用）。 */
async function _loadActiveSession(): Promise<void> {
    try {
        const activeId = await getActiveId();
        if (activeId) {
            const session = await loadSession(activeId);
            if (session) {
                _activeSessionId = session.id;
                _sessionCreatedAt = session.createdAt;
                const raw = session as unknown as Record<string, unknown>;
                _dialogueMode = raw.dialogueMode !== undefined
                    ? !!raw.dialogueMode
                    : raw.mode === 'dialogue';
                _messages.length = 0;
                _messages.push(...session.messages);
            }
        }
    } catch {
        /* 恢复失败保持空会话 */
    } finally {
        _sessionLoaded = true;
    }
}

/** 新建会话：先存旧会话，再切到全新空会话。 */
async function _createSession(): Promise<void> {
    await _flushSession();
    _activeSessionId = newSessionId();
    _sessionCreatedAt = Date.now();
    await setActiveId(_activeSessionId);
    _messages.length = 0;
    _dialogueMode = false;
    _renderChat();
    _refreshSessionList();
}

/** 切换到指定会话：先存旧，再加载目标。 */
async function _switchSession(id: string): Promise<void> {
    if (id === _activeSessionId) {
        return;
    }
    await _flushSession();
    const session = await loadSession(id);
    if (!session) {
        return;
    }
    _activeSessionId = session.id;
    _sessionCreatedAt = session.createdAt;
    const raw = session as unknown as Record<string, unknown>;
    _dialogueMode = raw.dialogueMode !== undefined
        ? !!raw.dialogueMode
        : raw.mode === 'dialogue';
    _messages.length = 0;
    _messages.push(...session.messages);
    await setActiveId(id);
    _renderChat();
    _refreshSessionList();
}

/** 删除会话；若删的是当前会话，切到最近的其它会话或新建空会话。 */
async function _deleteSessionAndAdjust(id: string): Promise<void> {
    await deleteSession(id);
    if (id === _activeSessionId) {
        // 先清空当前会话内存状态，避免下方 _switchSession 内的 _flushSession 把
        // 已删除会话的 _messages 回写磁盘、复活已删除会话（P1 修复）。
        _messages.length = 0;
        _activeSessionId = null;
        const remaining = await listSessions();
        if (remaining.length > 0) {
            await _switchSession(remaining[0].id);
        } else {
            // 无剩余会话：清除 activeId 指针，避免下次打开读到陈旧 id。
            await clearActiveId();
            _renderChat();
        }
    }
    _refreshSessionList();
}

/** 刷新会话列表 UI（Phase 2 会话卡存在时）。Phase 1 为 no-op。 */
function _refreshSessionList(): void {
    if (_sessionListEl) {
        void _renderSessionList(_sessionListEl);
    }
}

/** 渲染会话历史列表：新建按钮 + 每个会话项（点击切换 / 重命名 / 删除）。 */
async function _renderSessionList(container: HTMLElement): Promise<void> {
    container.innerHTML = '';

    const newBtn = document.createElement('button');
    newBtn.className = 'preset-chip diag-session-new';
    newBtn.textContent = '＋ ' + t('ai.chat.newSession');
    newBtn.setAttribute('aria-label', t('ai.chat.newSession'));
    newBtn.addEventListener('click', () => void _createSession());
    container.appendChild(newBtn);

    const sessions = await listSessions();
    for (const s of sessions) {
        container.appendChild(_createSessionRow(s));
    }
}

function _createSessionRow(s: ChatSession): HTMLElement {
    const row = document.createElement('div');
    row.className =
        'diag-session-row' + (s.id === _activeSessionId ? ' diag-session-row--active' : '');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', s.title || t('ai.chat.untitled'));
    row.addEventListener('click', () => void _switchSession(s.id));
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void _switchSession(s.id);
        }
    });

    const title = document.createElement('span');
    title.className = 'diag-session-title';
    title.textContent = s.title || t('ai.chat.untitled');
    row.appendChild(title);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'diag-session-btn';
    renameBtn.textContent = '✎';
    renameBtn.setAttribute('title', t('ai.chat.rename'));
    renameBtn.setAttribute('aria-label', t('ai.chat.rename'));
    renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = await showPrompt(t('ai.chat.rename'), s.title);
        if (name && name.trim()) {
            const full = await loadSession(s.id);
            if (full) {
                await saveSession({ ...full, title: name.trim(), updatedAt: Date.now() });
                _refreshSessionList();
            }
        }
    });
    row.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'diag-session-btn diag-session-btn--danger';
    delBtn.textContent = '✕';
    delBtn.setAttribute('title', t('ai.chat.delete'));
    delBtn.setAttribute('aria-label', t('ai.chat.delete'));
    delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm(t('ai.chat.deleteConfirm', { title: s.title }));
        if (ok) {
            await _deleteSessionAndAdjust(s.id);
        }
    });
    row.appendChild(delBtn);

    return row;
}

/** 会话历史卡 schema（Phase 2 独立面板顶部）。 */
function buildSessionsSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:sessions',
            kind: 'custom',
            renderCustom: (c) => {
                _sessionListEl = document.createElement('div');
                _sessionListEl.className = 'diag-session-list';
                c.appendChild(_sessionListEl);
                void _renderSessionList(_sessionListEl);
            },
        },
    ];
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
 *  内部 await resolveAi() 以保证适配器已就绪，消除"遗漏适配器配置"的时序窗口。
 *  先 await _saveChain：确保上一轮关面板触发的挂起保存已落盘，再读取，避免读到旧值。 */
async function _loadInitialConfig(): Promise<void> {
    await _saveChain;
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

/** 配置稳定后自动触发一次连接测试，避免用户手动点击。
 *  先触发模型发现，让 auto-test 的 _ensureTestModel 有缓存可用。 */
function _scheduleAutoTest(): void {
    if (!_aiResolved || _testing) {
        return;
    }
    if (!_autoTestTimer) {
        _autoTestTimer = new DebouncedTimer();
    }
    void _refreshModelList();
    _autoTestTimer.schedule(() => void _runAutoTest(), 600);
}

async function _runAutoTest(): Promise<void> {
    if (!_ai || _testing || _autoTesting) {
        return;
    }
    await _ensureTestModel();
    const validation = validateAiConfig(_localConfig);
    if (!validation.ok && !_goKeyAllowsProceed(validation)) {
        // 配置不完整时 badge/advice 已由校验结果接管，无需覆盖
        return;
    }

    _autoTesting = true;
    _setStatusBadge('testing');
    console.log('[ai-test] 连接测试配置:', { endpoint: _localConfig.endpoint, model: _localConfig.model });
    try {
        const result = await _ai.testConnection();
        if (result.ok) {
            _lastConnectionOk = true;
            _lastConnectionKind = null;
            _renderAdvice(undefined);
        } else {
            _lastConnectionOk = false;
            _lastConnectionKind = result.kind;
            captureError('ai-connection', result.message, undefined);
            _renderAdvice(result.kind);
        }
    } catch (err) {
        _lastConnectionOk = false;
        _lastConnectionKind = 'unknown';
        captureError('ai-connection', err instanceof Error ? err.message : String(err), err);
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
 *  串行化：通过 Promise 链确保多次 blur 触发的保存按序执行。
 *  入队时快照 _localConfig，而非执行时读取 — 根除「关面板→重开→_loadInitialConfig 覆写
 *  _localConfig→挂起 save 读到旧值写回」的数据丢失竞态（Go IPC 慢时尤其明显）。 */
let _saveChain: Promise<void> = Promise.resolve();
function _doSaveConfig(): Promise<void> {
    const snapshot: AiConfig = { ..._localConfig };
    const kind = _ai?.kind;
    _saveChain = _saveChain.then(async () => {
        try {
            if (kind === 'go') {
                // Go 模式必须发送归一化的端点（含 /chat/completions），否则 testConnection 发到裸 URL 返回 404
                const normalizedEndpoint = normalizeEndpoint(snapshot.endpoint);
                await _saveGoConfig({
                    baseUrl: normalizedEndpoint,
                    model: snapshot.model,
                    aiKey: snapshot.apiKey,
                });
                // 同步 endpoint/model 到 IndexedDB 镜像，保证重开面板时 _loadInitialConfig 有可读回退
                saveAiConfig({ ...snapshot, endpoint: normalizedEndpoint, apiKey: '' });
            } else {
                saveAiConfig(snapshot);
            }
        } catch (err) {
            console.warn('[ai-config] 持久化失败', err);
        }
    });
    return _saveChain;
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
    // 清空旧 datalist + _fetchedModels，避免跨服务商残留旧发现模型
    if (_configModelDatalist) {
        _configModelDatalist.innerHTML = '';
    }
    _fetchedModels = [];
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
    try {
        const models = await _ai.fetchModels?.() ?? [];
        _fetchedModels = models;
        _populateModelDatalist(models);
        // 失败后恢复成功时刷新按钮 title，避免上次失败的提示残留
        const btn = document.getElementById('diag-model-refresh-btn');
        if (btn) {
            btn.title =
                models.length > 0
                    ? t('ai.config.modelsFound', { n: String(models.length) })
                    : t('ai.config.modelsNone');
        }
    } catch (err) {
        // 与手动刷新按钮对齐：失败时不更新 _fetchedModels，记录警告 + 按钮 title 提示
        logWarn('ai-config', 'fetchModels failed:', err);
        const btn = document.getElementById('diag-model-refresh-btn');
        if (btn) {
            btn.title = t('ai.config.modelsNone');
        }
    }
}

/** 将模型列表写入 datalist DOM，供 _refreshModelList / 手动刷新按钮共享。 */
function _populateModelDatalist(models: string[]): void {
    if (!_configModelDatalist) {
        return;
    }
    _configModelDatalist.innerHTML = '';
    for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        _configModelDatalist.appendChild(opt);
    }
}

/** 将模型列表渲染为可见的芯片按钮组（桌面端 datalist 不可见时的备用下拉）。 */
function _populateModelChips(models: string[], inputEl: HTMLInputElement): void {
    if (!_modelListEl) {
        return;
    }
    _modelListEl.innerHTML = '';
    for (const m of models) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = m;
        chip.className = 'preset-chip';
        chip.addEventListener('click', () => {
            _localConfig.model = m;
            inputEl.value = m;
            void _persistConfig({ model: m });
            if (_modelListEl) {
                _modelListEl.style.display = 'none';
            }
        });
        _modelListEl.appendChild(chip);
    }
}

function _updateStatusBadge(): void {
    if (!_statusBadgeEl || !_statusTextEl) {
        return;
    }
    const validation = validateAiConfig(_localConfig);
    // Go 模式 key 不可见：missingKey 不阻止，按连接状态显示
    if (!validation.ok && !_goKeyAllowsProceed(validation) && validation.kind) {
        _setStatusBadge(validation.kind);
        _renderAdvice(validation.kind);
        return;
    }
    if (_lastConnectionOk === true) {
        _setStatusBadge('connected');
        _renderAdvice(undefined);
    } else if (_lastConnectionOk === false) {
        const kind = _lastConnectionKind ?? 'unknown';
        _setStatusBadge(kind);
        _renderAdvice(kind);
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
        const docHref = _activeDocLink.href;
        const docLabel = _activeDocLink.textContent ?? '';
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.doc', { provider: docLabel });
        btn.addEventListener('click', () => {
            window.open(docHref, '_blank');
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

/** 注册动作注册表（合并后 AI 始终有完整工具集）。
 *  返回 Promise 以便调用方 await 确保注册完成后继续。 */
async function _ensureActionsRegistered(): Promise<void> {
    if (_controlRegistered) return;
    try {
        const m = await import('../core/ai/action-registry-defs');
        m.registerAllActions();
        _controlRegistered = true;
    } catch (err) {
        logWarn('diagnostic', '动作注册表加载失败，AI 工具将不可用', err);
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
        content.className = 'diag-chat-content';
        if (msg.role === 'assistant') {
            // 助手回复按 Markdown 渲染（加粗/列表/标题/代码等）；纯 DOM 构建，免疫 XSS。
            renderMarkdownInto(content, textContent);
        } else {
            // 用户消息保持纯文本。
            content.textContent = textContent;
        }
        row.appendChild(content);
        _chatContainer.appendChild(row);
    }
    _chatContainer.scrollTop = _chatContainer.scrollHeight;
}

/** 显示"等待响应中"占位气泡：streaming 发起后立即调用，给用户即时反馈，
 *  避免请求耗时长时界面完全无动静。收到首个文本 chunk 时由 _renderStreamingChunk
 *  复用同一行（复用 chat-row--streaming）覆盖占位文本。 */
function _showPendingBubble(): void {
    if (!_chatContainer) {
        return;
    }
    // 已有 streaming 行则不重复插入
    if (_chatContainer.querySelector('.chat-row--streaming')) {
        return;
    }
    const row = document.createElement('div');
    row.className = 'diag-chat-row chat-row--streaming chat-row--assistant';
    row.dataset.pending = 'true';
    const label = document.createElement('strong');
    label.textContent = t('ai.chat.assistant');
    label.className = 'diag-chat-label';
    row.appendChild(label);
    const content = document.createElement('div');
    content.textContent = t('ai.chat.thinking');
    content.className = 'diag-chat-content diag-chat-pending';
    row.appendChild(content);
    _chatContainer.appendChild(row);
    _chatContainer.scrollTop = _chatContainer.scrollHeight;
}

function _renderStreamingChunk(chunk: ChatChunk): void {
    if (!_chatContainer) {
        return;
    }
    if (chunk.type !== 'text' || !chunk.content) {
        return;
    }
    let lastRow = _chatContainer.lastElementChild as HTMLElement | null;
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
    } else if (lastRow.dataset.pending === 'true') {
        // 复用占位气泡：清除 pending 标记与占位文本/样式，转为真实流式内容。
        delete lastRow.dataset.pending;
        const pendingContent = lastRow.querySelector('.diag-chat-pending') as HTMLElement | null;
        if (pendingContent) {
            pendingContent.textContent = '';
            pendingContent.classList.remove('diag-chat-pending');
        }
    }

    if (chunk.reasoning) {
        // 思考过程：追加到可折叠的 <details>（默认展开以便实时看到进度），置于正文之前。
        let details = lastRow.querySelector('.diag-reasoning') as HTMLDetailsElement | null;
        if (!details) {
            details = document.createElement('details');
            details.className = 'diag-reasoning';
            details.open = true;
            const summary = document.createElement('summary');
            summary.textContent = t('ai.chat.reasoning');
            details.appendChild(summary);
            const body = document.createElement('div');
            body.className = 'diag-reasoning-body';
            details.appendChild(body);
            // 插到正文 div 之前
            const contentDiv = lastRow.querySelector('.diag-chat-content');
            lastRow.insertBefore(details, contentDiv);
        }
        const body = details.querySelector('.diag-reasoning-body') as HTMLElement;
        if (body) {
            body.textContent += chunk.content;
        }
    } else {
        const contentDiv = lastRow.querySelector('.diag-chat-content') as HTMLElement | null;
        if (contentDiv) {
            contentDiv.textContent += chunk.content;
        }
    }
    _chatContainer.scrollTop = _chatContainer.scrollHeight;
}

/** 把 streaming row 转正：移除 streaming class、回填完整文本。
 *  供正常收尾与中断收尾复用，避免 streaming row 残留或被误删。 */
function _finalizeStreamRow(fullText: string): void {
    if (_chatContainer && fullText) {
        const streamingRow = _chatContainer.querySelector('.chat-row--streaming');
        if (streamingRow) {
            streamingRow.classList.remove('chat-row--streaming');
            const contentDiv = streamingRow.querySelector(
                '.diag-chat-content'
            ) as HTMLElement | null;
            if (contentDiv) {
                // 定格时把流式纯文本重渲染为 Markdown（加粗/列表/标题等）。
                renderMarkdownInto(contentDiv, fullText);
            }
            _chatContainer.scrollTop = _chatContainer.scrollHeight;
        } else {
            _renderChat();
        }
    } else {
        _renderChat();
    }
}

function _finalizeStream(fullText: string): void {
    if (fullText) {
        _messages.push({ role: 'assistant', content: fullText });
        _persistSession(); // [doc:adr-203] 一轮完成后持久化会话
    }
    _isStreaming = false;
    _abortController = null;

    // 台词模式：解析结构化对白 → 情绪卡片渲染 + 语音朗读（Step 2a）。
    if (_dialogueMode && fullText) {
        const lines = parseDialogueLines(fullText);
        _renderChat();
        _renderDialogueCards(lines);
        if (_speakEnabled) {
            speakLines(lines, _speechLang());
        }
        _updateSendButton();
        return;
    }

    _finalizeStreamRow(fullText);
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
    // 确保工具注册表已加载（首次通话前 async import 完成）。
    await _ensureActionsRegistered();
    // 统一 AI 助手始终发工具（含只读诊断工具与控制工具）。
    // dialogue 模式不发工具。显式传入的 opts.allowTools 优先
    // （如工具执行后续跑时传 false，避免连环调用）。
    const allowTools = opts?.allowTools ?? !_dialogueMode;

    _isStreaming = true;
    _updateSendButton();
    _abortController = new AbortController();

    // 立即给出"思考中"占位反馈：请求可能耗时数秒到数十秒，界面不能无动静。
    _showPendingBubble();
    logInfo('ai-stream', `发送消息 dialogueMode=${_dialogueMode} allowTools=${allowTools} 历史条数=${_messages.length}`);

    const systemMessage = _buildSystemMessage();
    const chatMessages: ChatMessage[] = _pruneHistory([systemMessage, ..._messages]);
    let fullResponse = '';
    const pendingToolCalls: Array<{ id: string; name: string; args: string }> = [];
    let streamErrorSeen = false;
    // [doc:adr-199] 用户主动 stop 触发的 abort 不应按错误处理：
    // 不入错误环、不弹 toast、不加错误消息；已生成内容保留到 _messages。
    let abortedByUser = false;
    // 中断时追加到对话历史的提示文本（错误消息或"已停止"），由 finally 统一渲染。
    let interruptMessage: string | null = null;

    try {
        const requestTools = allowTools ? buildToolSchemas() : undefined;
        const chunks = _ai.streamChat({
            messages: chatMessages,
            signal: _abortController.signal,
            tools: requestTools,
        });
        for await (const chunk of chunks) {
            if (chunk.type === 'text' && chunk.content) {
                if (chunk.reasoning) {
                    // 思考过程：只用于流式实时展示（折叠区），不累积进正式回答、不入对话历史。
                    _renderStreamingChunk(chunk);
                } else {
                    fullResponse += chunk.content;
                    _renderStreamingChunk(chunk);
                }
            } else if (chunk.type === 'tool_call' && allowTools) {
                pendingToolCalls.push({
                    id: chunk.toolId ?? `call_${Date.now()}_${pendingToolCalls.length}`,
                    name: chunk.toolName ?? '',
                    args: chunk.toolArgs ?? '{}',
                });
            } else if (chunk.type === 'error') {
                // [doc:adr-199] 错误 chunk：只标记 + 入环 + toast，不删 streaming row、不加错误消息。
                // 已生成的 fullResponse 保留给 finally 统一收尾（避免用户等半天内容全丢）。
                streamErrorSeen = true;
                const errText = chunk.error ?? '';
                captureError('ai-stream', errText || 'AI stream error', undefined);
                showErrorToast(t('ai.errors.apiError', { msg: errText }));
                interruptMessage = t('ai.errors.apiError', { msg: errText });
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
            // 过滤不支持的动作 + 分离 readonly/writable。
            const writable: typeof parsed = [];
            _pendingToolResults = [];
            _pendingBatchHasToolCalls = true;
            for (const p of parsed) {
                const def = getAction(p.actionId);
                if (!def) {
                    _pendingToolResults.push({
                        toolCallId: p.toolCallId ?? '',
                        content: JSON.stringify({ success: false, message: '不支持的操作' }),
                    });
                } else if (def.readonly) {
                    const result = await executeActionById(p.actionId, p.params);
                    _pendingToolResults.push({
                        toolCallId: p.toolCallId ?? '',
                        content: JSON.stringify(result),
                    });
                } else {
                    writable.push(p);
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

            if (writable.length === 0) {
                // 全部不支持或全部只读：直接收尾（回填 tool 消息 + 继续对话）。
                await _finalizePendingBatch();
                return;
            }
            _pendingAction = writable[0];
            _pendingQueue = writable.slice(1);
            _lastUndoable = null;
            _renderPendingAction();
            return;
        }
    } catch (err) {
        // [doc:adr-199] 区分用户主动 abort 与真实错误：
        // abort 静默收尾（保留已生成内容，不污染错误环、不弹 toast）；
        // 其他错误入环 + toast，但同样保留已生成内容（不删 row、不加错误消息到历史）。
        if (_abortController?.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
            abortedByUser = true;
            interruptMessage = t('ai.errors.aborted');
        } else {
            streamErrorSeen = true;
            const errMsg = err instanceof Error ? err.message : String(err);
            captureError('ai-stream', errMsg, err);
            showErrorToast(t('ai.errors.apiError', { msg: errMsg }));
            interruptMessage = t('ai.errors.apiError', { msg: errMsg });
        }
    } finally {
        if (_isStreaming) {
            const handledAsControlFallback =
                !streamErrorSeen &&
                !abortedByUser &&
                !_dialogueMode &&
                fullResponse &&
                !_pendingAction &&
                _handleControlFallback(fullResponse);
            if (!handledAsControlFallback) {
                if (streamErrorSeen || abortedByUser) {
                    // 中断收尾：保留已生成内容（用户等了半天，内容不该丢），
                    // 但不朗读残缺台词、不重复 push（避免 _finalizeStream 的 dialogue 分支副作用）。
                    if (fullResponse) {
                        _messages.push({ role: 'assistant', content: fullResponse });
                    }
                    _isStreaming = false;
                    _abortController = null;
                    _finalizeStreamRow(fullResponse);
                    if (interruptMessage) {
                        const errTime = _fmtTime(Date.now());
                        _addAssistantMessage(`${interruptMessage} · ${errTime}`);
                        _renderChat();
                    }
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
    // 统一面板始终显示 pending 区域（仅 dialogue 模式隐藏）。
    if (!_pendingContainer || _pendingAction || _dialogueMode) {
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

    const toolCount = listActions().length;
    const toolSummary = document.createElement('div');
    toolSummary.className = 'diag-control-hint-note';
    toolSummary.textContent = t('ai.control.toolSummary', { count: String(toolCount) });
    wrapper.appendChild(toolSummary);

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
        _updateSendButton();
        return;
    }
    _pendingAction = null;
    _updateSendButton();
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
    if (_dialogueMode) {
        return {
            role: 'system',
            content: buildDialogueSystemPrompt(getActiveBible()),
        };
    }
    // 统一 AI 助手：角色 + 工具目录 + 调用格式（无预注入错误/快照——AI 通过
    // getErrors/getSnapshot 只读工具按需获取诊断上下文）。
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

async function _sendMessage(): Promise<void> {
    // [doc:adr-155] 有待确认的 pending action 时禁止发新消息：
    // 否则新 stream 会与 _finalizePendingBatch 的后续 stream 竞态，导致工具结果回填后 LLM 不再继续生成。
    if (_isStreaming || _pendingAction || !_inputEl || !_ai) {
        return;
    }
    const text = _inputEl.value.trim();
    if (!text) {
        return;
    }

    const validation = validateAiConfig(_localConfig);
    if (!validation.ok && !_goKeyAllowsProceed(validation)) {
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
    _persistSession(); // [doc:adr-203] 用户消息发出即持久化
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
    // [doc:adr-203] 清空当前会话：内存清空 + 删除该会话的磁盘记录 + 清除 activeId 指针。
    _persistTimer.cancel();
    const id = _activeSessionId;
    _messages.length = 0;
    _activeSessionId = null;
    if (id) {
        await deleteSession(id);
        await clearActiveId();
    }
    _renderChat();
    _refreshSessionList();
}

// [doc:adr-156/199] 更新朗读开关的文案/状态/显隐（仅 dialogue 模式可见）。
function _updateSpeakToggle(): void {
    if (!_speakToggleBtn) {
        return;
    }
    _speakToggleBtn.style.display = _dialogueMode ? '' : 'none';
    _speakToggleBtn.textContent = _speakEnabled
        ? t('ai.dialogue.speakOn')
        : t('ai.dialogue.speakOff');
    _speakToggleBtn.setAttribute('aria-checked', String(_speakEnabled));
    _speakToggleBtn.setAttribute('aria-label', t('ai.dialogue.speakToggle'));
}

function _updateSendButton(): void {
    const sendBtn = document.getElementById('diag-send-btn') as HTMLButtonElement | null;
    if (!sendBtn) return;
    if (_isStreaming) {
        sendBtn.innerHTML = '\u25A0';       // ■ 停止图标
        sendBtn.setAttribute('aria-label', t('ai.chat.stop'));
        sendBtn.disabled = false;
    } else {
        sendBtn.innerHTML = '\u25B6';       // ▶ 发送图标
        sendBtn.setAttribute('aria-label', t('ai.chat.send'));
        // pending action 期间也禁用 send，避免与工具确认流程竞态
        sendBtn.disabled = _pendingAction !== null || !_aiResolved;
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

                // --- Row 1: textarea 独占一行 ---
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
                c.appendChild(inputRow);

                // --- Row 2: 图标按钮行 ---
                const btnRow = document.createElement('div');
                btnRow.className = 'diag-btn-row';

                // 发送/停止同一按钮（图标切换）
                const sendBtn = document.createElement('button');
                sendBtn.id = 'diag-send-btn';
                sendBtn.className = 'preset-chip diag-btn-icon';
                sendBtn.setAttribute('aria-label', t('ai.chat.send'));
                // 空闲态 = 发送图标；流式态由 _updateSendButton 切为停止图标
                sendBtn.innerHTML = '\u25B6';
                sendBtn.addEventListener('click', () => {
                    if (_isStreaming) {
                        _stopStreaming();
                    } else {
                        void _sendMessage();
                    }
                });
                btnRow.appendChild(sendBtn);

                const clearBtn = document.createElement('button');
                clearBtn.id = 'diag-clear-btn';
                clearBtn.className = 'preset-chip diag-btn-icon';
                clearBtn.setAttribute('aria-label', t('ai.chat.clear'));
                clearBtn.innerHTML = '\u2715';
                clearBtn.addEventListener('click', _clearChat);
                btnRow.appendChild(clearBtn);

                // spacer 将台词/朗读按钮推到右侧
                const spacer = document.createElement('div');
                spacer.className = 'diag-btn-spacer';
                btnRow.appendChild(spacer);

                // 台词模式切换
                const dialogueToggle = document.createElement('button');
                dialogueToggle.id = 'diag-dialogue-toggle';
                dialogueToggle.className = 'preset-chip diag-btn-icon';
                dialogueToggle.setAttribute('aria-pressed', 'false');
                dialogueToggle.setAttribute('aria-label', t('ai.mode.dialogue'));
                dialogueToggle.innerHTML = '\uD83D\uDCAC';
                dialogueToggle.addEventListener('click', () => {
                    _dialogueMode = !_dialogueMode;
                    if (_dialogueMode) {
                        _ensureActionsRegistered();
                    } else {
                        cancelSpeech();
                    }
                    dialogueToggle.setAttribute('aria-pressed', String(_dialogueMode));
                    _updateSpeakToggle();
                    if (_pendingContainer) {
                        _pendingContainer.style.display = _dialogueMode ? 'none' : '';
                        if (!_dialogueMode) {
                            if (_pendingAction) {
                                _renderPendingAction();
                            } else {
                                _renderControlHint();
                            }
                        }
                    }
                    _updateControlsEnabled();
                });
                btnRow.appendChild(dialogueToggle);

                // 台词朗读开关
                _speakToggleBtn = document.createElement('button');
                _speakToggleBtn.id = 'diag-speak-toggle';
                _speakToggleBtn.className = 'preset-chip diag-btn-icon';
                _speakToggleBtn.setAttribute('role', 'switch');
                _speakToggleBtn.innerHTML = '\uD83D\uDD0A';
                _speakToggleBtn.addEventListener('click', () => {
                    _speakEnabled = !_speakEnabled;
                    if (!_speakEnabled) {
                        cancelSpeech();
                    }
                    _updateSpeakToggle();
                });
                btnRow.appendChild(_speakToggleBtn);
                _updateSpeakToggle();

                c.appendChild(btnRow);

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

    // 测试前先确保 model 非空（若已获取过模型列表，自动填入第一个）
    await _ensureTestModel();

    // flush 保存输入框当前值（含 _ensureTestModel 填入的 model）到 Go 后端
    await _flushAndSave();

    const validation = validateAiConfig(_localConfig);
    if (!validation.ok && !_goKeyAllowsProceed(validation)) {
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
    console.log('[ai-test] 手动测试配置:', { endpoint: _localConfig.endpoint, model: _localConfig.model });

    try {
        const result = await _ai.testConnection();
        if (result.ok) {
            statusEl.textContent = t('ai.config.connected');
            statusEl.style.color = 'var(--success)';
            _lastConnectionOk = true;
            _lastConnectionKind = null;
            _renderAdvice(undefined);
        } else {
            statusEl.textContent = result.message;
            statusEl.style.color = 'var(--danger)';
            captureError('ai-connection', result.message, undefined);
            _lastConnectionKind = result.kind;
            _setStatusBadge(result.kind);
            _renderAdvice(result.kind);
            _lastConnectionOk = false;
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusEl.textContent = msg;
        statusEl.style.color = 'var(--danger)';
        captureError('ai-connection', msg, err);
        _lastConnectionKind = 'unknown';
        _setStatusBadge('unknown');
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
        _hideModelChips(); // 用户手动输入时收起芯片列表
    });
    modelInput.addEventListener('blur', () => _persistConfig({ model: modelInput.value }));
    modelRow.appendChild(modelInput);

    const modelBtnRow = document.createElement('div');
    modelBtnRow.className = 'diag-hint-row';

                const modelRefresh = document.createElement('button');
                modelRefresh.id = 'diag-model-refresh-btn';
                modelRefresh.textContent = t('ai.config.refreshModels');
                modelRefresh.className = 'preset-chip';
                modelRefresh.setAttribute('title', t('ai.config.refreshModels'));
                modelRefresh.setAttribute('aria-label', t('ai.config.refreshModels'));
                modelRefresh.style.padding = '2px 10px';
                modelRefresh.style.fontSize = 'var(--font-ui-sm)';
    let _refreshing = false;
    const _showModelChips = () => {
        if (_modelListEl) {
            _modelListEl.style.display = '';
        }
    };
    const _hideModelChips = () => {
        if (_modelListEl) {
            _modelListEl.style.display = 'none';
        }
    };
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
            _fetchedModels = models;
            _populateModelDatalist(models);
            if (models.length > 0 && !_localConfig.model) {
                _localConfig.model = models[0];
                modelInput.value = models[0];
            }
            modelRefresh.title =
                models.length > 0
                    ? t('ai.config.modelsFound', { n: String(models.length) })
                    : t('ai.config.modelsNone');
            if (models.length > 0) {
                _populateModelChips(models, modelInput);
                _showModelChips();
            }
        } catch (err) {
            console.warn('[ai-config] 发现模型失败', err);
            modelRefresh.title = t('ai.config.modelsNone');
        } finally {
            _refreshing = false;
            modelRefresh.disabled = false;
            modelRefresh.textContent = t('ai.config.refreshModels');
        }
    });
    modelBtnRow.appendChild(modelRefresh);

    const modelToggleBtn = document.createElement('button');
    modelToggleBtn.textContent = '▼';
    modelToggleBtn.className = 'preset-chip';
    modelToggleBtn.setAttribute('title', t('ai.config.showModels'));
    modelToggleBtn.setAttribute('aria-label', t('ai.config.showModels'));
    modelToggleBtn.style.padding = '2px 10px';
    modelToggleBtn.style.fontSize = 'var(--font-ui-sm)';
    modelToggleBtn.addEventListener('click', () => {
        if (_modelListEl && _modelListEl.style.display !== 'none') {
            _hideModelChips();
        } else if (_modelListEl && _modelListEl.children.length > 0) {
            _showModelChips();
        } else {
            // 未获取过则触发刷新
            modelRefresh.click();
        }
    });
    modelBtnRow.appendChild(modelToggleBtn);

    modelRow.appendChild(modelBtnRow);
    const modelDatalist = document.createElement('datalist');
    modelDatalist.id = 'diag-model-list';
    modelRow.appendChild(modelDatalist);
    c.appendChild(modelRow);

    // 模型芯片列表容器（可见下拉，替代不可见的 datalist）
    const modelListWrap = document.createElement('div');
    modelListWrap.className = 'diag-model-chips';
    modelListWrap.style.display = 'none';
    c.appendChild(modelListWrap);
    _configModel = modelInput;
    _configModelDatalist = modelDatalist;
    _modelListEl = modelListWrap;

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

export function buildDiagnosticSchema(opts?: { withSessions?: boolean }): MenuNode[] {
    return [
        {
            id: 'diagnostic:panel',
            kind: 'custom',
            renderCustom: (c) => {
                const container = document.createElement('div');
                container.className = 'diag-panel-layout';

                // --- Tab bar ---
                const tabBar = document.createElement('div');
                tabBar.className = 'type-row';

                type PanelTab = 'chat' | 'config';
                const tabs: { id: PanelTab; label: string }[] = [
                    { id: 'chat', label: t('ai.chat.title') },
                    { id: 'config', label: t('ai.config.title') },
                ];

                let activeTab: PanelTab = 'chat';
                const tabBtns: HTMLButtonElement[] = [];

                for (const tab of tabs) {
                    const btn = document.createElement('button');
                    btn.textContent = tab.label;
                    btn.className = 'mode-btn' + (activeTab === tab.id ? ' active' : '');
                    btn.setAttribute('role', 'tab');
                    btn.setAttribute('aria-selected', String(activeTab === tab.id));
                    btn.addEventListener('click', () => switchTab(tab.id));
                    tabBar.appendChild(btn);
                    tabBtns.push(btn);
                }
                container.appendChild(tabBar);

                // --- 对话 tab pane（始终渲染，tab 切换仅 toggle display） ---
                const chatPane = document.createElement('div');
                chatPane.className = 'diag-tab-pane';

                if (opts?.withSessions) {
                    cardContainer(chatPane, (inner) => {
                        addSectionTitle(inner, t('ai.chat.history'));
                        return renderMenu(buildSessionsSchema(), inner);
                    });
                }
                cardContainer(chatPane, (inner) => {
                    addSectionTitle(inner, t('ai.chat.title'));
                    return renderMenu(buildChatSchema(), inner);
                });
                container.appendChild(chatPane);

                // --- 配置 tab pane ---
                const configPane = document.createElement('div');
                configPane.className = 'diag-tab-pane';
                configPane.style.display = 'none';
                cardContainer(configPane, (inner) => {
                    addSectionTitle(inner, t('ai.config.title'));
                    return renderMenu(buildConfigSchema(), inner);
                });
                container.appendChild(configPane);

                c.appendChild(container);

                function switchTab(tabId: PanelTab) {
                    if (activeTab === tabId) return;
                    activeTab = tabId;
                    for (let i = 0; i < tabs.length; i++) {
                        const isActive = tabs[i].id === tabId;
                        tabBtns[i].className = 'mode-btn' + (isActive ? ' active' : '');
                        tabBtns[i].setAttribute('aria-selected', String(isActive));
                    }
                    chatPane.style.display = tabId === 'chat' ? '' : 'none';
                    configPane.style.display = tabId === 'config' ? '' : 'none';
                }
            },
        },
    ];
}

/** 关面板收场：停朗读 + 中止流式 + flush 配置/会话 + 清理运行态与 DOM 引用。
 *  设置菜单入口与独立面板共用。 */
function _disposeDiagnosticPanel(): void {
    cancelSpeech();
    _abortController?.abort();
    // 关面板前 flush 输入框当前值到 _localConfig，避免未 blur 的编辑丢失
    if (_configEndpoint) {
        _localConfig.endpoint = _configEndpoint.value;
    }
    if (_configModel) {
        _localConfig.model = _configModel.value;
    }
    if (_configApiKey) {
        _localConfig.apiKey = _configApiKey.value;
    }
    void _doSaveConfig();
    // [doc:adr-203] flush 会话到 IndexedDB，关面板不再清空 _messages（重开恢复）。
    void _flushSession();
    // 会话内容（_messages/_dialogueMode/_activeSessionId）保留在内存，重开面板直接复用；
    // 磁盘已由 _flushSession 落盘。仅重置瞬态运行状态。
    _isStreaming = false;
    _pendingAction = null;
    _pendingQueue = [];
    _pendingToolResults = [];
    _pendingBatchHasToolCalls = false;
    _lastUndoable = null;
    _autoTestTimer?.cancel();
    _autoTestTimer = null;
    _autoTesting = false;
    _testing = false;
    _refreshingCaps = false;
    _fetchedModels = [];
    _lastConnectionOk = null;
    _lastConnectionKind = null;
    _goKeyConfigured = false;
    // 关面板时清理 DOM 引用：避免面板关闭后异步回调（如 resolveAi.then）
    // 持有旧引用向已移除元素写入。重新渲染时 renderCustom 会重新赋值。
    _chatContainer = null;
    _inputEl = null;
    _corsWarningEl = null;
    _configEndpoint = null;
    _configApiKey = null;
    _configModel = null;
    _configModelDatalist = null;
    _modelListEl = null;
    _statusBadgeEl = null;
    _adviceEl = null;
    _statusTextEl = null;
    _pendingContainer = null;
    _speakToggleBtn = null;
    _sessionListEl = null;
    _activeProviderButtons = [];
    _activeDocLink = null;
}

/** 渲染诊断面板内容并返回 dispose。供设置菜单入口与独立面板复用。 */
export function renderDiagnosticPanel(
    container: HTMLElement,
    opts?: { withSessions?: boolean }
): () => void {
    const dispose = renderMenu(buildDiagnosticSchema(opts), container);
    return () => {
        dispose();
        _disposeDiagnosticPanel();
    };
}

export function buildSettingsDiagnosticLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.diagnostic'),
        dir: '',
        items: [],
        renderCustom: (container) => renderDiagnosticPanel(container),
    };
}
