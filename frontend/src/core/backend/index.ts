// [doc:architecture] Backend 选型单例 — ADR-176 / 修订（Tier 分层判定）
//
// resolveBackend(): Promise<BackendService>（惰性单例，禁止模块顶层同步求值——
// Android 冷启动 window.wails 尚未注入会被误固化成 browser → 误降级）。
//
// 判定按优先级分三层（详见 resolveBackend）：
//   Tier 0  入口 HTML 显式声明 globalThis.__MMKU_BACKEND__（'go' | 'browser'）
//          —— 权威信号。web 构建置 'browser' 后即便嵌进 Wails webview 也走
//             browserAdapter，消除「网页构建参杂 Go 逻辑」误判；桌面构建不声明，
//             因同一 bundle 在纯浏览器 dev 与 Wails 间共享，需靠运行时探测。
//   Tier 1  旧 web 短路标记 __MMKU_WEB__ === true 或 import.meta.env.MODE === 'web'
//          —— 兜底可读信号。
//   Tier 2  运行时能力探测 awaitWailsBridge()：桌面入口等 window.wails 注入。
//          纯浏览器 dev 下 window.wails 永不存在，等待缩到 500ms（消除 3s 白等）；
//          生产 Wails/Android 保留 3000ms 消化冷启动桥接延迟。

import type { BackendService, BackendCapabilities } from './types';
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

/** Tier 0：入口 HTML 显式声明的后端身份（权威、不可被 window.wails 存在性覆盖）。 */
function _declaredBackend(): 'go' | 'browser' | undefined {
    const v = (globalThis as { __MMKU_BACKEND__?: unknown }).__MMKU_BACKEND__;
    return v === 'go' || v === 'browser' ? v : undefined;
}

export function resolveBackend(): Promise<BackendService> {
    if (_resolved) return Promise.resolve(_resolved);
    if (_resolving) return _resolving;

    _resolving = (async (): Promise<BackendService> => {
        // Tier 0 — 入口显式声明（最高优先级）。
        const declared = _declaredBackend();
        if (declared === 'browser') {
            _resolved = browserAdapter;
            return _resolved;
        }
        if (declared === 'go') {
            const ready = await awaitWailsBridge(3000);
            _resolved =
                ready && typeof window.wails === 'object' ? await _getGoAdapter() : browserAdapter;
            return _resolved;
        }

        // Tier 1 — 旧 web 短路标记 / 构建模式。
        if (_isWebEntry()) {
            _resolved = browserAdapter;
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
            _resolved = browserAdapter;
        }
        return _resolved;
    })();

    return _resolving;
}

// [doc:adr-177] Phase 2 A5 能力门控：跨后端 capabilities 缓存。
// - getCapabilities(): 异步解析后端后读取 capabilities() 并缓存，供初始化阶段预热。
// - getCachedCapabilities(): 同步读缓存；未预热时返回 ALL_TRUE_CAPS（对齐桌面默认全开行为，
//   避免菜单首次渲染因缓存未就绪而闪烁隐藏原生入口）。
let _caps: BackendCapabilities | null = null;

const ALL_TRUE_CAPS: BackendCapabilities = {
    ar: true,
    externalApps: true,
    plazaWindow: true,
    fsAccess: false,
    watchDir: true,
    proxyServer: true,
    fileServer: true,
    systemDirOpen: true,
    storageMode: true,
    screenshotSave: true,
    cacheManage: true,
    configPersist: true,
    modelScan: true,
    // [doc:adr-178] 兜底默认：假设桌面全开（含 MPR 多线程）；解析后由真实后端覆盖
    crossOriginIsolated: true,
    clipboardReliable: true,
    arScope: 'none',
};

export async function getCapabilities(): Promise<BackendCapabilities> {
    if (_caps) return _caps;
    const b = await resolveBackend();
    _caps = b.capabilities();
    return _caps;
}

export function getCachedCapabilities(): BackendCapabilities {
    return _caps ?? ALL_TRUE_CAPS;
}
