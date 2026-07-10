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
 * Waits for the Wails bridge (window.wails) to be injected by the WebView.
 * Returns true if the bridge became ready within the timeout, false otherwise.
 * Android WebView may not have the bridge available at module-parse time.
 */
export async function awaitWailsBridge(timeout = 3000): Promise<boolean> {
    const poll = (resolve: (v: boolean) => void, reject: (e: Error) => void) => {
        if (typeof window.wails?.platform === 'function') {
            resolve(true);
        } else {
            setTimeout(() => poll(resolve, reject), 50);
        }
    };
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Wails bridge timeout')), timeout);
        poll((v) => {
            clearTimeout(timer);
            resolve(v);
        }, reject);
    })
        .then(() => true)
        .catch(() => false);
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
 * not available on Android. Returns true if the action should proceed,
 * false if it was blocked (Android).
 */
export function guardExternalAction(label: string): boolean {
    if (isAndroidPlatform()) {
        return false;
    }
    return true;
}
