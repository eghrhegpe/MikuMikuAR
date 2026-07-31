// [doc:architecture] Platform detection — side-effect-free helpers.
//
// Kept separate from core/main.ts on purpose: main.ts runs heavy bootstrap
// side effects at import time (DOM event binding, hint init, event bus
// subscription). Importing main.ts just to read the platform would pull those
// side effects into unit tests and crash them. This module has zero runtime
// side effects, so it is safe to import from anywhere (menus, tests, etc.).

/**
 * Returns true when running inside the Android WebView (Wails v3).
 * Pure check against the Wails runtime bridge — no side effects.
 */
export function isAndroidPlatform(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.wails?.platform === 'function' &&
        window.wails.platform() === 'android'
    );
}

/**
 * Returns true when running in a pure browser (no Wails bridge).
 *
 * ⚠️ 同步判定，仅用于**运行时已稳定**的 UI 降级（配合 backend.capabilities()）。
 * Android 冷启动 `window.wails` 尚未注入时会被误判为 web —— 启动期 backend 选型
 * 必须用 `await resolveBackend()`（异步 + awaitWailsBridge），见 ADR-176。
 */
export function isWebPlatform(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof (window as { wails?: unknown }).wails === 'undefined'
    );
}

/**
 * Waits for the Wails bridge (window.wails) to be injected by the WebView.
 * Returns true if the bridge became ready within the timeout, false otherwise.
 * Android WebView may not have the bridge available at module-parse time.
 *
 * [doc:adr-177] 判定条件为 window.wails 对象存在性（非 platform 方法）。
 * platform 是 Android 专属方法，桌面端 wails 3 不注入该方法，导致误降级 browserAdapter。
 * Android 冷启动 window.wails 延迟注入，注入后本判定立即满足。
 */
export async function awaitWailsBridge(timeout = 3000): Promise<boolean> {
    let settled = false;
    const poll = (resolve: (v: boolean) => void) => {
        if (settled) {
            return;
        } // [audit:P2] 超时后停止轮询，防定时器泄漏
        if (
            typeof window !== 'undefined' &&
            typeof (window as { wails?: unknown }).wails === 'object' &&
            (window as { wails?: unknown }).wails !== null
        ) {
            settled = true;
            resolve(true);
        } else {
            setTimeout(() => poll(resolve), 50);
        }
    };
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            settled = true;
            resolve(false);
        }, timeout);
        poll((v) => {
            clearTimeout(timer);
            resolve(v);
        });
    });
}

/**
 * Opens a URL in the system browser. On Android, Browser.OpenURL (Wails v3)
 * may not be implemented; falls back to creating a temporary <a> element.
 * Returns true if handled (Android), false if caller should use Browser.OpenURL.
 */
export function openExternalURL(url: string): boolean {
    if (isAndroidPlatform()) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
        return true;
    }
    return false; // caller should use Browser.OpenURL on desktop
}

/**
 * 打开外链的统一入口：先尝试 Android `<a>.click()` 方式，失败则回退 `window.open`。
 * 桌面端 Wails 的 `window.open` 会被 WebView2 拦截并走系统浏览器，
 * 与之前 `browser.openURL`（Wails Browser.OpenURL）行为一致。
 * 修复安卓冷启动 `openExternalURL` 返回 false 后 `browser.openURL` 卡死的问题。
 */
export function openExternalLink(url: string): void {
    if (openExternalURL(url)) {
        return;
    }
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
        console.warn(`[platform] openExternalLink: popup blocked for ${url}`);
    }
}

/**
 * Guards an external application action (Blender, MMD, etc.) that is
 * not available on Android or in a pure browser. Returns true if the
 * action should proceed, false if it was blocked.
 *
 * ADR-176：扩展为同挡 Android + Web（externalApps 在两者均为 false）。
 * 注意 isAndroidPlatform() 优先判定，Android 冷启动误判 web 不影响结果。
 */
export function guardExternalAction(_label: string): boolean {
    if (isAndroidPlatform() || isWebPlatform()) {
        return false;
    }
    return true;
}

// ======== 适配器选型共享函数（ADR-176/196 双适配器共用） ========

/** [doc:adr-196/176] 运行时判定是否为 web 入口（短路标记或构建模式）。
 *  纯函数，无运行时副作用。 */
export function isWebEntryMode(): boolean {
    if ((globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ === true) {
        return true;
    }
    const meta = import.meta as unknown as { env?: { MODE?: string } };
    return meta.env?.MODE === 'web';
}

/** [doc:adr-196/176] 读取 globalThis 上声明的适配器身份（'go' | 'browser'）。
 *  key 参数为全局变量名（如 '__MMKU_BACKEND__' / '__MMKU_AI_BACKEND__'）。 */
export function readDeclaredAdapter(globalKey: string): 'go' | 'browser' | undefined {
    const v = (globalThis as Record<string, unknown>)[globalKey];
    return v === 'go' || v === 'browser' ? v : undefined;
}
