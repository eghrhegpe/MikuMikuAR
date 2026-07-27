// [doc:adr-196] AI 配置持久化 — 浏览器端走 IndexedDB（复用 backend/idb.ts），不再使用 Web Storage（FR-9 / AC-5）
// 桌面端（go-adapter 可用时）配置由 Go 侧持有，前端不暴露 key；本模块仅服务浏览器适配器。
// 设计要点：capabilities() 是同步签名，故用内存缓存 + 异步回源，保持同步读语义（见 loadAiConfig）。

import { idbGet, idbSet } from '../backend/idb';
import type { Store } from '../backend/idb';

export interface AiConfig {
    endpoint: string;
    apiKey: string;
    model: string;
}

/** 零 key 默认路径：本地 Ollama（大模型零 key，小模型零成本）。见 ADR-196 开放问题 Q2 裁定。 */
export const DEFAULT_AI_CONFIG: AiConfig = {
    endpoint: 'http://localhost:11434/v1/chat/completions',
    apiKey: '',
    model: 'llama3.2',
};

const CONFIG_STORE: Store = 'config';
const CONFIG_KEY = 'ai';

let _cache: AiConfig | null = null;

/** 同步读取：优先内存缓存；未加载时回退默认并触发异步回源（不阻塞调用方）。 */
export function loadAiConfig(): AiConfig {
    if (_cache) return _cache;
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
    if (_cache) return;
    await _hydrate();
}

async function _hydrate(): Promise<void> {
    try {
        const stored = await idbGet<AiConfig>(CONFIG_STORE, CONFIG_KEY);
        _cache = stored ? { ...DEFAULT_AI_CONFIG, ...stored } : DEFAULT_AI_CONFIG;
    } catch {
        // IndexedDB 不可用（隐私模式 / 非浏览器环境）时静默回退默认
        _cache = DEFAULT_AI_CONFIG;
    }
}
