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
