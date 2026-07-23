// [doc:architecture] Backend 选型单例 — ADR-176
//
// resolveBackend(): Promise<BackendService>
// - 先 await awaitWailsBridge()（ADR-017/159 桥接注入范式）消除 Android 冷启动竞态，
//   再判定 window.wails 是否存在注入 goAdapter / browserAdapter（惰性单例）。
// - ❌ 禁止模块顶层同步 `export const backend = detectBackend()`：Android 冷启动
//   window.wails 尚未注入会被误固化成 browser → 误降级。
// - Web 入口置 globalThis.__MMKU_WEB__ = true（或 import.meta.env.MODE === 'web'）
//   短路 awaitWailsBridge 的 3s 超时等待，直接返回 browserAdapter。

import type { BackendService } from './types';
import { browserAdapter } from './browser-adapter';
import { awaitWailsBridge } from '../platform';

// go-adapter 动态加载：web 入口短路路径完全不拉进 bundle，
// 避免 @wailsio/runtime 初始化触发 /wails/custom.js 404（ADR-176 web 侧干净运行）。
// 桌面/安卓路径首次调用时按需加载 go-adapter chunk。
let _goAdapter: BackendService | null = null;
async function _getGoAdapter(): Promise<BackendService> {
    if (!_goAdapter) {
        const mod = await import('./go-adapter');
        _goAdapter = mod.goAdapter;
    }
    return _goAdapter;
}

let _resolved: BackendService | null = null;
let _resolving: Promise<BackendService> | null = null;

function _isWebEntry(): boolean {
    if ((globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ === true) return true;
    const meta = import.meta as unknown as { env?: { MODE?: string } };
    return meta.env?.MODE === 'web';
}

export function resolveBackend(): Promise<BackendService> {
    if (_resolved) return Promise.resolve(_resolved);
    if (_resolving) return _resolving;

    _resolving = (async (): Promise<BackendService> => {
        if (!_isWebEntry()) {
            const ready = await awaitWailsBridge(3000);
            if (ready && typeof window.wails === 'object') {
                _resolved = await _getGoAdapter();
                return _resolved;
            }
        }
        _resolved = browserAdapter;
        return browserAdapter;
    })();

    return _resolving;
}
