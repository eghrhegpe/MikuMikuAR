// [doc:adr] Web 生产构建的 Service Worker 注册（二次启动秒开）
//
// 仅在 web 入口 + 生产构建生效：由调用方传入 enabled 守卫
// （import.meta.env.PROD && globalThis.__MMKU_WEB__ === true）。
// 桌面 Wails 构建不注册（__MMKU_WEB__ 未定义）；dev 模式 PROD 为 false 不注册。
//
// [doc:adr-099] 跨源隔离首访重载：SW 首次接管时，当前文档响应尚未经 SW 补 COOP/COEP，
// crossOriginIsolated 仍为 false。监听 controllerchange（SW 首次取得控制权），若此时尚未跨源
// 隔离则 reload 一次，让浏览器用带头的响应重新评估→ SharedArrayBuffer/MPR 解锁。
// 已隔离（二次访问）或不支持 credentialless 的浏览器不重载，避免无限刷新。
export function registerServiceWorker(enabled: boolean): void {
    if (!enabled) {
        return;
    }
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }
    // SW 首次接管后，若页面尚未跨源隔离，主动 reload 一次让补入的 COOP/COEP 生效。
    // 仅在首次 controllerchange 时触发（controller 从 null → 非 null），防重复刷新。
    if (
        typeof crossOriginIsolated !== 'undefined' &&
        !crossOriginIsolated &&
        navigator.serviceWorker.controller == null &&
        typeof navigator.serviceWorker.addEventListener === 'function'
    ) {
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded) {
                return;
            }
            reloaded = true;
            window.location.reload();
        });
    }
    // 等首屏资源加载完再注册，避免 SW 抢先于关键路径、影响首次启动速度
    window.addEventListener('load', () => {
        const base = import.meta.env.BASE_URL; // 如 '/MikuMikuAR/'
        navigator.serviceWorker
            .register(`${base}sw.js`, { scope: base })
            .catch((err) => console.warn('[sw] register failed:', err));
    });
}
