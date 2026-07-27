// [doc:adr-196] AiService 选型单例 — 镜像 resolveBackend() 的 Tier 分层判定
//
// resolveAi(): Promise<AiService>（惰性单例，禁止模块顶层同步求值——
// Android 冷启动 window.wails 尚未注入会被误固化成 browser → 误降级）。
//
// 判定按优先级分三层（与 backend/index.ts 完全对齐）：
//   Tier 0  入口 HTML 显式声明 globalThis.__MMKU_AI_BACKEND__（'go' | 'browser'）
//   Tier 1  __MMKU_WEB__ === true 或 import.meta.env.MODE === 'web' 短路标记
//   Tier 2  运行时能力探测 awaitWailsBridge()：桌面入口等 window.wails 注入。
//           纯浏览器 dev 下 window.wails 永不存在，等待缩到 500ms（消除 3s 白等）；
//           生产 Wails/Android 保留 3000ms 消化冷启动桥接延迟。

import type { AiService } from './types';
import { browserAiAdapter } from './browser-adapter';
import { awaitWailsBridge } from '../platform';

// go-adapter 动态加载：web 入口短路路径完全不拉进 bundle，
// 避免把 Go 侧 Wails 调用链带入纯浏览器构建。桌面/安卓路径首次调用时按需加载。
let _goAdapter: AiService | null = null;
async function _getGoAdapter(): Promise<AiService> {
    if (!_goAdapter) {
        const mod = await import('./go-adapter');
        _goAdapter = mod.goAiAdapter;
    }
    return _goAdapter;
}

let _resolved: AiService | null = null;
let _resolving: Promise<AiService> | null = null;

/** Tier 0：入口 HTML 显式声明的 AI 后端身份（权威、不可被 window.wails 存在性覆盖）。 */
function _declaredBackend(): 'go' | 'browser' | undefined {
    const v = (globalThis as { __MMKU_AI_BACKEND__?: unknown }).__MMKU_AI_BACKEND__;
    return v === 'go' || v === 'browser' ? v : undefined;
}

/** Tier 1：旧 web 短路标记 / 构建模式。 */
function _isWebEntry(): boolean {
    if ((globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ === true) return true;
    const meta = import.meta as unknown as { env?: { MODE?: string } };
    return meta.env?.MODE === 'web';
}

export function resolveAi(): Promise<AiService> {
    if (_resolved) return Promise.resolve(_resolved);
    if (_resolving) return _resolving;

    _resolving = (async (): Promise<AiService> => {
        // Tier 0 — 入口显式声明（最高优先级）。
        const declared = _declaredBackend();
        if (declared === 'browser') {
            _resolved = browserAiAdapter;
            return _resolved;
        }
        if (declared === 'go') {
            const ready = await awaitWailsBridge(3000);
            _resolved =
                ready && typeof window.wails === 'object'
                    ? await _getGoAdapter()
                    : browserAiAdapter;
            return _resolved;
        }

        // Tier 1 — 旧 web 短路标记 / 构建模式。
        if (_isWebEntry()) {
            _resolved = browserAiAdapter;
            return _resolved;
        }

        // Tier 2 — 桌面入口（dev 浏览器 / Wails / Android 共享同一 bundle）。
        // 纯浏览器 dev 下 window.wails 永不存在，缩短探测避免 3s 白等；
        // 生产 Wails/Android 保留 3000ms 以消化冷启动桥接延迟。
        const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
        const timeout = dev && typeof window.wails === 'undefined' ? 500 : 3000;
        const ready = await awaitWailsBridge(timeout);
        if (ready && typeof window.wails === 'object') {
            _resolved = await _getGoAdapter();
        } else {
            _resolved = browserAiAdapter;
        }
        return _resolved;
    })();

    return _resolving;
}
