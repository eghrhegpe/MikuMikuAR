// [doc:adr-196] AiService 选型单例 — 镜像 resolveBackend() 模式
// resolveAi(): Promise<AiService>（惰性单例，禁止模块顶层同步求值）

import type { AiService } from './types';
import { browserAiAdapter } from './browser-adapter';

let _resolved: AiService | null = null;
let _resolving: Promise<AiService> | null = null;

export function resolveAi(): Promise<AiService> {
    if (_resolved) return Promise.resolve(_resolved);
    if (_resolving) return _resolving;

    _resolving = (async (): Promise<AiService> => {
        // 优先尝试 Go 适配器（桌面端 Wails 桥接）
        if (typeof window.wails === 'object') {
            try {
                const mod = await import('./go-adapter');
                const go = mod.goAiAdapter;
                if (go.capabilities().available) {
                    _resolved = go;
                    return _resolved;
                }
            } catch {
                // Go 适配器加载失败，降级到浏览器适配器
            }
        }

        // 兜底：浏览器适配器（Ollama / OpenAI 兼容端点）
        _resolved = browserAiAdapter;
        return _resolved;
    })();

    return _resolving;
}