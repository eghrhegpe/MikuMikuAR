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
    return typeof window !== 'undefined' && typeof (window as { wails?: unknown }).wails === 'undefined';
}

/**
 * Waits for the Wails bridge (window.wails) to be injected by the WebView.
 * Returns true if the bridge became ready within the timeout, false otherwise.
 * Android WebView may not have the bridge available at module-parse time.
 */
export async function awaitWailsBridge(timeout = 3000): Promise<boolean> {
    let settled = false;
    const poll = (resolve: (v: boolean) => void) => {
        if (settled) {
            return;
        } // [audit:P2] 超时后停止轮询，防定时器泄漏
        if (typeof window.wails?.platform === 'function') {
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
