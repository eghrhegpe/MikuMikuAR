// Core
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { logWarn } from '../core/logger';
import { DebouncedTimer } from '../core/async';
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
import { relayTarget } from '../core/ai/relay';
import { isWebPlatform } from '../core/platform';
import { resolveAi } from '../core/ai';
import type { AiErrorKind } from '../core/ai/types';
// [audit:round19 P1/P2] 收敛到 core/ai/go-key-allows-proceed 严格版（errors 全量过滤）：
// 此前本地同名实现仅判 kind==='missingKey'，[missingKey+missingModel] 组合会放行空 model 请求；
// 且 core 版生产零消费者导致集成测试测的是不存在路径。现 menus 版成为薄包装，语义单一。
import { goKeyAllowsProceed as coreGoKeyAllowsProceed } from '../core/ai/go-key-allows-proceed';

// Local
import { diagState } from './diagnostic-state';
import type { MenuNode } from './menu-schema';

export function goKeyAllowsProceed(validation: ReturnType<typeof validateAiConfig>): boolean {
    // [audit:round19] 薄包装：isGo/keyConfigured 来自 diagState，判定语义统一走 core 严格版
    return coreGoKeyAllowsProceed(validation, diagState.ai?.kind === 'go', !!diagState.goKeyConfigured);
}

async function ensureTestModel(): Promise<void> {
    if (diagState.localConfig.model.trim()) {
        return;
    }
    if (diagState.fetchedModels.length === 0) {
        await refreshModelList();
    }
    if (diagState.fetchedModels.length > 0) {
        diagState.localConfig.model = diagState.fetchedModels[0];
        if (diagState.configModel) {
            diagState.configModel.value = diagState.fetchedModels[0];
        }
        await doSaveConfig();
    }
}

function inferProvider(endpoint: string): AiConfigProvider {
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

export async function loadInitialConfig(): Promise<void> {
    await diagState.saveChain;
    await ensureAiConfigLoaded();
    diagState.localConfig = { ...loadAiConfig() };
    await resolveAi();
    if (diagState.ai?.loadConfig) {
        try {
            const persisted = await diagState.ai.loadConfig();
            if (persisted.endpoint || persisted.model) {
                diagState.localConfig = {
                    ...diagState.localConfig,
                    provider: inferProvider(persisted.endpoint),
                    endpoint: persisted.endpoint,
                    model: persisted.model,
                    apiKey: persisted.apiKey ?? diagState.localConfig.apiKey,
                    relayUrl: persisted.relayUrl ?? diagState.localConfig.relayUrl,
                };
            }
            if (diagState.ai.kind === 'go' && persisted.keyConfigured && !persisted.apiKey) {
                diagState.goKeyConfigured = true;
            }
        } catch {
            /* keep defaults */
        }
    }
}

export async function refreshCaps(): Promise<void> {
    if (diagState.refreshingCaps || !diagState.ai) {
        return;
    }
    diagState.refreshingCaps = true;
    try {
        await diagState.ai.refreshCapabilities?.();
        diagState.caps = diagState.ai.capabilities();
        refreshConfigUI();
    } finally {
        diagState.refreshingCaps = false;
    }
}

function refreshConfigUI(): void {
    updateCorsWarning();
    updateApiKeyVisibility();
    if (diagState.caps === null) {
        setStatusBadge('initializing');
    } else {
        updateStatusBadge();
        scheduleAutoTest();
    }
}

function scheduleAutoTest(): void {
    if (!diagState.aiResolved || diagState.testing) {
        return;
    }
    if (!diagState.autoTestTimer) {
        diagState.autoTestTimer = new DebouncedTimer();
    }
    void refreshModelList();
    diagState.autoTestTimer.schedule(() => void runAutoTest(), 600);
}

async function runAutoTest(): Promise<void> {
    if (!diagState.ai || diagState.testing || diagState.autoTesting) {
        return;
    }
    await ensureTestModel();
    const validation = validateAiConfig(diagState.localConfig);
    if (!validation.ok && !goKeyAllowsProceed(validation)) {
        return;
    }
    diagState.autoTesting = true;
    setStatusBadge('testing');
    try {
        const result = await diagState.ai.testConnection();
        if (result.ok) {
            diagState.lastConnectionOk = true;
            diagState.lastConnectionKind = null;
            renderAdvice(undefined);
        } else {
            diagState.lastConnectionOk = false;
            diagState.lastConnectionKind = result.kind;
            captureError('ai-connection', result.message, undefined);
            renderAdvice(result.kind);
        }
    } catch (err) {
        diagState.lastConnectionOk = false;
        diagState.lastConnectionKind = 'unknown';
        captureError('ai-connection', translateGoError(err), err);
        renderAdvice('unknown');
    } finally {
        diagState.autoTesting = false;
        updateStatusBadge();
    }
}

function updateApiKeyVisibility(): void {
    if (!diagState.configApiKey) {
        return;
    }
    const row = diagState.configApiKey.closest('.diag-field-row') as HTMLElement | null;
    if (!row) {
        return;
    }
    const needsKey = PROVIDER_PRESETS[diagState.localConfig.provider].needsKey;
    row.style.display = needsKey ? '' : 'none';
}

function updateCorsWarning(): void {
    if (!diagState.corsWarningEl || !diagState.relayStatusEl) {
        return;
    }
    const caps = diagState.caps;
    const cfg = diagState.localConfig;
    if (!caps) {
        diagState.corsWarningEl.style.display = 'none';
        diagState.relayStatusEl.textContent = '';
        return;
    }

    // [doc:relay] 用与 browser-adapter 完全一致的判定（relayTarget 内置平台/端点/配置检查）：
    //   - relay 真正生效（纯网页 + 远程端点 + relayUrl 已配置）→ 显示 relay 状态，隐藏 CORS 警告
    //   - 非网页平台（桌面 Wails 走 go 适配器，Go 直连 API）→ 无 CORS/relay 概念，全部隐藏
    //     （此前未查平台：桌面端继承默认 relayUrl 后只要端点远程就误报「Relay 代理已启用」）
    const relayActive = relayTarget(cfg.relayUrl, cfg.endpoint) !== null;

    if (relayActive) {
        diagState.corsWarningEl.style.display = 'none';
        diagState.relayStatusEl.textContent = t('ai.config.relayActive', { url: cfg.relayUrl });
        diagState.relayStatusEl.className = 'diag-hint diag-hint--ok';
    } else if (!isWebPlatform()) {
        // 桌面端直连：不显示 relay 状态，也不显示 CORS 警告（后端无 CORS 限制）
        diagState.corsWarningEl.style.display = 'none';
        diagState.relayStatusEl.textContent = '';
    } else if (caps.corsRisk !== 'none') {
        diagState.corsWarningEl.style.display = '';
        diagState.relayStatusEl.textContent = t('ai.config.relayNotConfigured');
        diagState.relayStatusEl.className = 'diag-hint';
    } else {
        diagState.corsWarningEl.style.display = 'none';
        diagState.relayStatusEl.textContent = '';
    }
}

export function persistConfig(partial: Partial<AiConfig>): void {
    diagState.localConfig = { ...diagState.localConfig, ...partial };
    void doSaveConfig();
}

async function doSaveConfig(): Promise<void> {
    const snapshot: AiConfig = { ...diagState.localConfig };
    const kind = diagState.ai?.kind;
    // [fix P2] 分离「链状态」与「本次结果」：单次保存失败不得永久破坏 saveChain。
    //   - current 承载本次结果（失败仍 reject，供 flushAndSave 等调用方捕获反馈）
    //   - diagState.saveChain 更新为吞错版（resolved），下次 doSaveConfig 不受影响
    // 修复前：L242 throw err 使 saveChain 永久 rejected，后续所有保存 .then 不执行、静默失效。
    const current = diagState.saveChain
        .catch(() => {
            /* 吞掉历史 reject，链恢复为 resolved */
        })
        .then(async () => {
            try {
                if (kind === 'go') {
                    const normalizedEndpoint = normalizeEndpoint(snapshot.endpoint);
                    const b = await import('@bindings/mikumikuar/internal/app/app');
                    await b.AiSetLLMConfig({
                        baseUrl: normalizedEndpoint,
                        model: snapshot.model,
                        aiKey: snapshot.apiKey,
                    });
                    await saveAiConfig({ ...snapshot, endpoint: normalizedEndpoint, apiKey: '' });
                } else {
                    await saveAiConfig(snapshot);
                }
            } catch (err) {
                console.warn('[ai-config] 持久化失败', err);
                throw err; // 重新抛出，让调用方（如保存按钮）能够捕获并反馈给用户
            }
        });
    diagState.saveChain = current.catch(() => {
        /* 链保持 resolved，供后续串行 */
    });
    return current;
}

export function applyProvider(provider: AiConfigProvider): void {
    const preset = PROVIDER_PRESETS[provider];
    diagState.localConfig.provider = provider;
    diagState.localConfig.endpoint = preset.endpoint;
    diagState.localConfig.model = preset.model;
    if (diagState.configEndpoint) {
        diagState.configEndpoint.value = preset.endpoint;
    }
    if (diagState.configModel) {
        diagState.configModel.value = preset.model;
    }
    updateProviderButtons(provider);
    updateDocLink(provider);
    if (diagState.configModelDatalist) {
        diagState.configModelDatalist.innerHTML = '';
    }
    diagState.fetchedModels = [];
    void (async () => {
        await doSaveConfig();
        void refreshCaps();
        void refreshModelList();
    })();
}

function updateProviderButtons(active: AiConfigProvider): void {
    for (const btn of diagState.activeProviderButtons) {
        const provider = btn.dataset.provider as AiConfigProvider;
        btn.className = 'preset-chip' + (provider === active ? ' active' : '');
    }
}

function updateDocLink(provider: AiConfigProvider): void {
    if (!diagState.activeDocLink) {
        return;
    }
    const preset = PROVIDER_PRESETS[provider];
    if (preset.docUrl) {
        diagState.activeDocLink.href = preset.docUrl;
        diagState.activeDocLink.textContent = t('ai.config.doc', { provider: t(preset.labelKey) });
        diagState.activeDocLink.style.display = '';
    } else {
        diagState.activeDocLink.style.display = 'none';
    }
}

export async function refreshModelList(): Promise<void> {
    if (!diagState.ai) {
        return;
    }
    try {
        const models = (await diagState.ai.fetchModels?.()) ?? [];
        diagState.fetchedModels = models;
        populateModelDatalist(models);
        if (models.length > 0 && diagState.configModel) {
            populateModelChips(models, diagState.configModel);
            if (diagState.modelListEl) {
                diagState.modelListEl.style.display = '';
            }
        }
        const btn = document.getElementById('diag-model-refresh-btn');
        if (btn) {
            btn.setAttribute(
                'title',
                models.length > 0
                    ? t('ai.config.modelsFound', { n: String(models.length) })
                    : t('ai.config.modelsNone')
            );
        }
    } catch (err) {
        logWarn('ai-config', 'fetchModels failed:', err);
        const btn = document.getElementById('diag-model-refresh-btn');
        if (btn) {
            btn.setAttribute('title', t('ai.config.modelsNone'));
        }
    }
}

function populateModelDatalist(models: string[]): void {
    if (!diagState.configModelDatalist) {
        return;
    }
    diagState.configModelDatalist.innerHTML = '';
    for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        diagState.configModelDatalist.appendChild(opt);
    }
}

function populateModelChips(models: string[], inputEl: HTMLInputElement): void {
    if (!diagState.modelListEl) {
        return;
    }
    diagState.modelListEl.innerHTML = '';
    for (const m of models) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = m;
        chip.className = 'preset-chip';
        chip.addEventListener('click', () => {
            diagState.localConfig.model = m;
            inputEl.value = m;
            persistConfig({ model: m });
            if (diagState.modelListEl) {
                diagState.modelListEl.style.display = 'none';
            }
        });
        diagState.modelListEl.appendChild(chip);
    }
}

export function updateStatusBadge(): void {
    if (!diagState.statusBadgeEl || !diagState.statusTextEl) {
        return;
    }
    const validation = validateAiConfig(diagState.localConfig);
    if (!validation.ok && !goKeyAllowsProceed(validation) && validation.kind) {
        setStatusBadge(validation.kind);
        renderAdvice(validation.kind);
        return;
    }
    if (diagState.lastConnectionOk === true) {
        setStatusBadge('connected');
        renderAdvice(undefined);
    } else if (diagState.lastConnectionOk === false) {
        const kind = diagState.lastConnectionKind ?? 'unknown';
        setStatusBadge(kind);
        renderAdvice(kind);
    } else {
        setStatusBadge(diagState.caps?.available ? 'disconnected' : 'missingEndpoint');
        renderAdvice(undefined);
    }
}

function setStatusBadge(
    state: AiErrorKind | 'connected' | 'disconnected' | 'testing' | 'error' | 'initializing'
): void {
    if (!diagState.statusBadgeEl || !diagState.statusTextEl) {
        return;
    }
    diagState.statusBadgeEl.className = 'diag-status-badge diag-status-badge--' + state;
    diagState.statusTextEl.textContent = t(`ai.status.${state}`);
}

function focusInput(el: HTMLInputElement | null): void {
    if (!el) {
        return;
    }
    el.closest('.diag-field-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
}

function renderAdvice(kind?: AiErrorKind): void {
    if (!diagState.adviceEl) {
        return;
    }
    if (!kind) {
        diagState.adviceEl.style.display = 'none';
        diagState.adviceEl.innerHTML = '';
        return;
    }
    diagState.adviceEl.className = 'diag-advice diag-advice--' + kind;
    diagState.adviceEl.innerHTML = '';
    const textSpan = document.createElement('span');
    textSpan.textContent = t(`ai.errorAdvice.${kind}`);
    diagState.adviceEl.appendChild(textSpan);
    const actions = document.createElement('div');
    actions.className = 'diag-advice-actions';
    if (kind === 'missingEndpoint' || kind === 'notFound') {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.endpoint');
        btn.addEventListener('click', () => focusInput(diagState.configEndpoint));
        actions.appendChild(btn);
    }
    if (kind === 'missingKey' || kind === 'unauthorized') {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.apiKey');
        btn.addEventListener('click', () => focusInput(diagState.configApiKey));
        actions.appendChild(btn);
    }
    if (kind === 'missingModel') {
        const btn = document.createElement('button');
        btn.className = 'preset-chip';
        btn.textContent = t('ai.config.model');
        btn.addEventListener('click', () => focusInput(diagState.configModel));
        actions.appendChild(btn);
    }
    if (actions.children.length > 0) {
        diagState.adviceEl.appendChild(actions);
    }
    diagState.adviceEl.style.display = 'block';
}

async function flushAndSave(): Promise<{ ok: boolean; error?: string }> {
    if (diagState.configEndpoint) {
        diagState.localConfig.endpoint = diagState.configEndpoint.value;
    }
    if (diagState.configModel) {
        diagState.localConfig.model = diagState.configModel.value;
    }
    if (diagState.configApiKey) {
        diagState.localConfig.apiKey = diagState.configApiKey.value;
    }
    try {
        await doSaveConfig();
        void refreshCaps();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: translateGoError(err) };
    }
}

export function buildConfigSchema(): MenuNode[] {
    return [
        {
            id: 'diagnostic:config',
            kind: 'custom',
            renderCustom: (c) => {
                const loadingEl = document.createElement('div');
                loadingEl.className = 'setting-hint';
                loadingEl.textContent = '\u231B ' + t('ai.config.loading');
                c.appendChild(loadingEl);
                void (async () => {
                    try {
                        await loadInitialConfig();
                    } catch (err) {
                        console.warn('[ai-config] loadInitialConfig failed', err);
                    } finally {
                        loadingEl.remove();
                    }
                    renderConfigCard(c);
                })();
            },
        },
    ];
}

function renderConfigCard(c: HTMLElement): void {
    diagState.activeProviderButtons = [];
    diagState.activeDocLink = null;

    const statusBadge = document.createElement('div');
    statusBadge.className = 'diag-status-badge diag-status-badge--disconnected';
    const statusText = document.createElement('span');
    statusText.textContent = t('ai.status.disconnected');
    statusBadge.appendChild(statusText);
    c.appendChild(statusBadge);
    diagState.statusBadgeEl = statusBadge;
    diagState.statusTextEl = statusText;

    const adviceEl = document.createElement('div');
    adviceEl.className = 'diag-advice';
    adviceEl.style.display = 'none';
    adviceEl.setAttribute('role', 'status');
    c.appendChild(adviceEl);
    diagState.adviceEl = adviceEl;

    const hintEl = document.createElement('div');
    hintEl.className = 'setting-hint';
    hintEl.textContent = t('ai.config.providerHint');
    c.appendChild(hintEl);

    const providerRow = document.createElement('div');
    providerRow.className = 'diag-provider-row';
    const providers: AiConfigProvider[] = ['deepseek', 'openai', 'openrouter', 'custom', 'ollama'];
    for (const provider of providers) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = t(PROVIDER_PRESETS[provider].labelKey);
        btn.className =
            'preset-chip' + (provider === diagState.localConfig.provider ? ' active' : '');
        btn.dataset.provider = provider;
        btn.addEventListener('click', () => applyProvider(provider));
        providerRow.appendChild(btn);
        diagState.activeProviderButtons.push(btn);
    }
    const docLink = document.createElement('a');
    docLink.target = '_blank';
    docLink.className = 'diag-link';
    docLink.setAttribute('aria-label', t('ai.config.doc', { provider: '' }));
    providerRow.appendChild(docLink);
    diagState.activeDocLink = docLink;
    c.appendChild(providerRow);

    diagState.corsWarningEl = document.createElement('div');
    diagState.corsWarningEl.textContent = t('ai.config.corsWarning');
    diagState.corsWarningEl.className = 'diag-warning';
    diagState.corsWarningEl.setAttribute('role', 'alert');
    c.appendChild(diagState.corsWarningEl);

    diagState.relayStatusEl = document.createElement('div');
    diagState.relayStatusEl.className = 'diag-hint';
    c.appendChild(diagState.relayStatusEl);

    const createField = (
        label: string,
        type: string,
        value: string,
        onChange: (val: string) => void,
        fieldKey?: keyof AiConfig
    ): { row: HTMLDivElement; input: HTMLInputElement } => {
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
            persistConfig(fieldKey ? { [fieldKey]: input.value } : diagState.localConfig);
        });
        row.appendChild(input);
        return { row, input };
    };

    const endpointGroup = createField(
        t('ai.config.endpoint'),
        'text',
        diagState.localConfig.endpoint,
        (v) => {
            diagState.localConfig.endpoint = v;
        },
        'endpoint'
    );
    c.appendChild(endpointGroup.row);
    diagState.configEndpoint = endpointGroup.input;

    const apiKeyGroup = createField(
        t('ai.config.apiKey'),
        'password',
        diagState.localConfig.apiKey,
        (v) => {
            diagState.localConfig.apiKey = v;
        },
        'apiKey'
    );
    c.appendChild(apiKeyGroup.row);
    diagState.configApiKey = apiKeyGroup.input;

    if (diagState.ai?.kind === 'go' && diagState.goKeyConfigured && diagState.configApiKey) {
        diagState.configApiKey.placeholder = t('ai.config.keyConfigured');
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
    modelInput.value = diagState.localConfig.model;
    modelInput.setAttribute('list', 'diag-model-list');
    modelInput.setAttribute('aria-label', t('ai.config.model'));
    modelInput.addEventListener('input', () => {
        diagState.localConfig.model = modelInput.value;
        if (diagState.modelListEl) {
            diagState.modelListEl.style.display = 'none';
        }
    });
    modelInput.addEventListener('blur', () => persistConfig({ model: modelInput.value }));
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
    modelBtnRow.appendChild(modelRefresh);

    const modelToggleBtn = document.createElement('button');
    modelToggleBtn.textContent = '\u25BC';
    modelToggleBtn.className = 'preset-chip';
    modelToggleBtn.setAttribute('title', t('ai.config.showModels'));
    modelToggleBtn.setAttribute('aria-label', t('ai.config.showModels'));
    modelToggleBtn.style.padding = '2px 10px';
    modelToggleBtn.style.fontSize = 'var(--font-ui-sm)';
    modelToggleBtn.addEventListener('click', () => {
        if (diagState.modelListEl && diagState.modelListEl.style.display !== 'none') {
            diagState.modelListEl.style.display = 'none';
        } else if (diagState.modelListEl && diagState.modelListEl.children.length > 0) {
            diagState.modelListEl.style.display = '';
        } else {
            modelRefresh.click();
        }
    });
    modelBtnRow.appendChild(modelToggleBtn);
    modelRow.appendChild(modelBtnRow);

    const modelDatalist = document.createElement('datalist');
    modelDatalist.id = 'diag-model-list';
    modelRow.appendChild(modelDatalist);
    c.appendChild(modelRow);

    const modelListWrap = document.createElement('div');
    modelListWrap.className = 'diag-model-chips';
    modelListWrap.style.display = 'none';
    c.appendChild(modelListWrap);
    diagState.configModel = modelInput;
    diagState.configModelDatalist = modelDatalist;
    diagState.modelListEl = modelListWrap;

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
    c.appendChild(testRow);

    // Wire up model refresh click (event handler set by entry point via data attributes)
    modelRefresh.addEventListener('click', async () => {
        if (modelRefresh.dataset.refreshing === 'true' || !diagState.ai) {
            return;
        }
        modelRefresh.dataset.refreshing = 'true';
        modelRefresh.disabled = true;
        modelRefresh.textContent = '\u2026';
        try {
            await flushAndSave();
            const models = (await diagState.ai.fetchModels?.()) ?? [];
            diagState.fetchedModels = models;
            populateModelDatalist(models);
            if (models.length > 0 && !diagState.localConfig.model) {
                diagState.localConfig.model = models[0];
                modelInput.value = models[0];
            }
            modelRefresh.setAttribute(
                'title',
                models.length > 0
                    ? t('ai.config.modelsFound', { n: String(models.length) })
                    : t('ai.config.modelsNone')
            );
            if (models.length > 0) {
                populateModelChips(models, modelInput);
                modelListWrap.style.display = '';
            }
        } catch (err) {
            console.warn('[ai-config] 发现模型失败', err);
            modelRefresh.setAttribute('title', t('ai.config.modelsNone'));
        } finally {
            delete modelRefresh.dataset.refreshing;
            modelRefresh.disabled = false;
            modelRefresh.textContent = t('ai.config.refreshModels');
        }
    });

    let saving = false;
    saveBtn.addEventListener('click', async () => {
        if (saving) {
            return;
        }
        saving = true;
        saveBtn.disabled = true;
        statusEl.textContent = t('ai.config.saving');
        statusEl.style.color = 'var(--text-muted)';
        const res = await flushAndSave();
        statusEl.textContent = res.ok
            ? t('ai.config.saved')
            : `${t('ai.config.saveFailed')}: ${res.error ?? ''}`;
        statusEl.style.color = res.ok ? 'var(--success)' : 'var(--danger)';
        if (!res.ok) {
            captureError('ai-config', res.error ?? 'save failed', undefined);
        }
        saving = false;
        saveBtn.disabled = false;
    });

    testBtn.addEventListener('click', () => void testConnection(statusEl));

    updateDocLink(diagState.localConfig.provider);
    refreshConfigUI();
}

async function testConnection(statusEl: HTMLElement): Promise<void> {
    if (diagState.testing || diagState.autoTesting) {
        return;
    }
    diagState.testing = true;
    if (!diagState.ai) {
        statusEl.textContent = t('ai.config.notResolved');
        statusEl.style.color = 'var(--warn)';
        diagState.lastConnectionOk = false;
        updateStatusBadge();
        diagState.testing = false;
        return;
    }
    // [fix P2] ensureTestModel 可能抛错（内部 doSaveConfig reject）——包 try/catch 复位 testing。
    try {
        await ensureTestModel();
    } catch (err) {
        const msg = translateGoError(err);
        statusEl.textContent = msg;
        statusEl.style.color = 'var(--danger)';
        captureError('ai-connection', msg, err);
        diagState.lastConnectionOk = false;
        diagState.testing = false;
        return;
    }
    // [fix P2] flushAndSave 从不 reject（内部吞错返回 {ok:false}），须显式检查返回值：
    // 保存失败时中止测试并提示，避免「配置未持久化却报已连接」的静默误导。
    const saveRes = await flushAndSave();
    if (!saveRes.ok) {
        statusEl.textContent = t('ai.config.saveFailed') + ': ' + (saveRes.error ?? '');
        statusEl.style.color = 'var(--danger)';
        captureError('ai-config', saveRes.error ?? 'save failed', undefined);
        diagState.lastConnectionOk = false;
        diagState.testing = false;
        return;
    }
    const validation = validateAiConfig(diagState.localConfig);
    if (!validation.ok && !goKeyAllowsProceed(validation)) {
        const errMsg = validation.errors
            ? validation.errors.map((e) => t(e.message)).join('; ')
            : t(validation.message);
        statusEl.textContent = errMsg;
        statusEl.style.color = 'var(--warn)';
        captureError('ai-config', errMsg, undefined);
        if (validation.kind) {
            setStatusBadge(validation.kind);
            renderAdvice(validation.kind);
        }
        diagState.lastConnectionOk = false;
        diagState.testing = false;
        return;
    }
    statusEl.textContent = t('ai.config.testing');
    statusEl.style.color = 'var(--text-muted)';
    setStatusBadge('testing');
    diagState.lastConnectionOk = null;
    const isLocalOllama =
        /localhost|127\.0\.0\.1/i.test(diagState.localConfig.endpoint) &&
        diagState.localConfig.provider === 'ollama';
    try {
        const result = await diagState.ai.testConnection();
        if (result.ok) {
            statusEl.textContent = t('ai.config.connected');
            statusEl.style.color = 'var(--success)';
            diagState.lastConnectionOk = true;
            diagState.lastConnectionKind = null;
            renderAdvice(undefined);
        } else {
            const msg = isLocalOllama
                ? t('ai.errorAdvice.ollamaNotInstalled') + ' ' + result.message
                : result.message;
            statusEl.textContent = msg;
            statusEl.style.color = 'var(--danger)';
            captureError('ai-connection', result.message, undefined);
            diagState.lastConnectionKind = result.kind;
            setStatusBadge(result.kind);
            renderAdvice(result.kind);
            diagState.lastConnectionOk = false;
        }
    } catch (err) {
        const msg = translateGoError(err);
        const display = isLocalOllama ? t('ai.errorAdvice.ollamaNotInstalled') + ' ' + msg : msg;
        statusEl.textContent = display;
        statusEl.style.color = 'var(--danger)';
        captureError('ai-connection', msg, err);
        diagState.lastConnectionKind = 'unknown';
        setStatusBadge('unknown');
        renderAdvice('unknown');
        diagState.lastConnectionOk = false;
    } finally {
        diagState.testing = false;
    }
    updateStatusBadge();
}
