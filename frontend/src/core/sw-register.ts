// [doc:adr] Web 生产构建的 Service Worker 注册（二次启动秒开）
//
// 仅在 web 入口 + 生产构建生效：由调用方传入 enabled 守卫
// （import.meta.env.PROD && globalThis.__MMKU_WEB__ === true）。
// 桌面 Wails 构建不注册（__MMKU_WEB__ 未定义）；dev 模式 PROD 为 false 不注册。
export function registerServiceWorker(enabled: boolean): void {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // 等首屏资源加载完再注册，避免 SW 抢先于关键路径、影响首次启动速度
    window.addEventListener('load', () => {
        const base = import.meta.env.BASE_URL; // 如 '/MikuMikuAR/'
        navigator.serviceWorker
            .register(`${base}sw.js`, { scope: base })
            .catch((err) => console.warn('[sw] register failed:', err));
    });
}
