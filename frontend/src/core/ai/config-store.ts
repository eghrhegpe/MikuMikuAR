// [doc:adr-196] AI 配置持久化 — 浏览器端走 IndexedDB（复用 backend/idb.ts），不再使用 Web Storage（FR-9 / AC-5）
// 桌面端（go-adapter 可用时）配置由 Go 侧持有，前端不暴露 key；本模块仅服务浏览器适配器。
// 设计要点：capabilities() 是同步签名，故用内存缓存 + 异步回源，保持同步读语义（见 loadAiConfig）。

import { idbGet, idbSet } from '../backend/idb';
import type { Store } from '../backend/idb';
import type { AiConfigProvider, AiErrorKind, AiValidationResult, AiValidationError } from './types';
export type { AiConfigProvider } from './types';

export interface AiConfig {
    provider: AiConfigProvider;
    endpoint: string;
    apiKey: string;
    model: string;
    /** [doc:adr-199 P2-3] 请求超时（毫秒）。本地 Ollama 冷启动可能 10–60s，故可配；缺省 30000。 */
    timeoutMs: number;
}

/** [doc:adr-199 P2-3] 超时下限（防误设过小掐断正常请求）。 */
export const MIN_TIMEOUT_MS = 5000;
/** 超时上限（防误设导致挂死请求永不释放）。 */
export const MAX_TIMEOUT_MS = 300000;
/** 缺省超时。 */
export const DEFAULT_TIMEOUT_MS = 30000;

export interface ProviderPreset {
    endpoint: string;
    model: string;
    needsKey: boolean;
    labelKey: string;
    docUrl: string;
}

/** 服务商预设：端点、默认模型、是否需要 Key、文案 key、文档链接。 */
export const PROVIDER_PRESETS: Record<AiConfigProvider, ProviderPreset> = {
    ollama: {
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'llama3.2',
        needsKey: false,
        labelKey: 'ai.provider.ollama',
        docUrl: 'https://ollama.com/',
    },
    deepseek: {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat',
        needsKey: true,
        labelKey: 'ai.provider.deepseek',
        docUrl: 'https://platform.deepseek.com/api_keys',
    },
    openai: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        needsKey: true,
        labelKey: 'ai.provider.openai',
        docUrl: 'https://platform.openai.com/api-keys',
    },
    openrouter: {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'openai/gpt-4o-mini',
        needsKey: true,
        labelKey: 'ai.provider.openrouter',
        docUrl: 'https://openrouter.ai/keys',
    },
    custom: {
        endpoint: '',
        model: '',
        needsKey: true,
        labelKey: 'ai.provider.custom',
        docUrl: '',
    },
};

/** 零 key 默认路径：本地 Ollama（大模型零 key，小模型零成本）。见 ADR-196 开放问题 Q2 裁定。 */
export const DEFAULT_AI_CONFIG: AiConfig = {
    provider: 'ollama',
    endpoint: PROVIDER_PRESETS.ollama.endpoint,
    apiKey: '',
    model: PROVIDER_PRESETS.ollama.model,
    timeoutMs: DEFAULT_TIMEOUT_MS,
};

const CONFIG_STORE: Store = 'config';
const CONFIG_KEY = 'ai';

let _cache: AiConfig | null = null;

/** 同步读取：优先内存缓存；未加载时回退默认并触发异步回源（不阻塞调用方）。 */
export function loadAiConfig(): AiConfig {
    if (_cache) {
        return _cache;
    }
    void _hydrate();
    return DEFAULT_AI_CONFIG;
}

/** 同步保存：写内存缓存 + 异步落盘 IndexedDB（fire-and-forget）。返回合并后的配置。 */
export function saveAiConfig(partial: Partial<AiConfig>): AiConfig {
    const merged: AiConfig = { ...(_cache ?? DEFAULT_AI_CONFIG), ...partial };
    _cache = merged;
    void idbSet(CONFIG_STORE, CONFIG_KEY, merged).catch(() => undefined);
    return merged;
}

/** 主动预加载（建议 init 后台调用，使首次读取即命中缓存，避免回退默认窗口）。 */
export async function ensureAiConfigLoaded(): Promise<void> {
    if (_cache) {
        return;
    }
    await _hydrate();
}

/** [doc:adr-199 P2-3] 将超时值归一到 [MIN, MAX]；非法/缺失回落缺省。 */
export function normalizeTimeout(v: unknown): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_TIMEOUT_MS;
    return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, n));
}

/** 迁移旧配置：无 provider 字段时按 endpoint 推断，无法推断则回落 ollama。 */
function migrateAiConfig(stored: Partial<AiConfig>): AiConfig {
    const base = { ...DEFAULT_AI_CONFIG, ...stored };
    if (!base.provider || !PROVIDER_PRESETS[base.provider]) {
        const matched = (Object.keys(PROVIDER_PRESETS) as AiConfigProvider[])
            .filter((p) => p !== 'custom')
            .find((p) =>
                base.endpoint.includes(
                    PROVIDER_PRESETS[p].endpoint.replace('/v1/chat/completions', '')
                )
            );
        base.provider = matched ?? 'custom';
    }
    // [doc:adr-199 P2-3] 旧配置无 timeoutMs 或值非法时归一
    base.timeoutMs = normalizeTimeout(base.timeoutMs);
    return base;
}

async function _hydrate(): Promise<void> {
    try {
        const stored = await idbGet<AiConfig>(CONFIG_STORE, CONFIG_KEY);
        _cache = stored ? migrateAiConfig(stored) : DEFAULT_AI_CONFIG;
    } catch {
        // IndexedDB 不可用（隐私模式 / 非浏览器环境）时静默回退默认
        _cache = DEFAULT_AI_CONFIG;
    }
}

/** 校验配置是否足够发起一次对话。全量收集所有错误，一次性返回。 */
export function validateAiConfig(config: AiConfig): AiValidationResult {
    const preset = PROVIDER_PRESETS[config.provider];
    const errors: AiValidationError[] = [];

    if (!config.endpoint.trim()) {
        errors.push({ kind: 'missingEndpoint', message: 'ai.validation.missingEndpoint' });
    }
    if (preset.needsKey && !config.apiKey.trim()) {
        errors.push({ kind: 'missingKey', message: 'ai.validation.missingKey' });
    }
    if (!config.model.trim()) {
        errors.push({ kind: 'missingModel', message: 'ai.validation.missingModel' });
    }

    if (errors.length > 0) {
        return { ok: false, kind: errors[0].kind, message: errors[0].message, errors };
    }
    return { ok: true, message: 'ai.validation.ok' };
}

/** 根据 testConnection / streamChat 的错误消息分类错误类型。 */
export function classifyAiError(
    message: string,
    corsRisk: 'none' | 'possible' | 'high'
): AiErrorKind {
    const m = message.toLowerCase();
    if (m.includes('cors') || m.includes('access-control') || m.includes('failed to fetch')) {
        return 'cors';
    }
    if (
        m.includes('401') ||
        m.includes('unauthorized') ||
        m.includes('invalid authentication') ||
        m.includes('incorrect api key')
    ) {
        return 'unauthorized';
    }
    if (
        m.includes('404') ||
        m.includes('not found') ||
        (m.includes('model') && m.includes('not'))
    ) {
        return 'notFound';
    }
    if (m.includes('429') || m.includes('rate limit') || m.includes('too many requests')) {
        return 'rateLimit';
    }
    if (
        m.includes('500') ||
        m.includes('502') ||
        m.includes('503') ||
        m.includes('504') ||
        m.includes('internal server')
    ) {
        return 'server';
    }
    if (
        m.includes('network') ||
        m.includes('dial tcp') ||
        m.includes('connection refused') ||
        m.includes('connectex') ||
        m.includes('err_connection') ||
        m.includes('etimedout')
    ) {
        return 'network';
    }
    if (
        corsRisk !== 'none' &&
        (m.includes('fetch') || m.includes('networkerror') || m.includes('typeerror'))
    ) {
        return 'cors';
    }
    return 'unknown';
}
