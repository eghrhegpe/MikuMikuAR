// [doc:adr-225] 墓碑 Service Worker —— 部署于 Pages 根 /MikuMikuAR/sw.js
//
// 背景：主应用 web 入口由根迁至 /MikuMikuAR/app/ 后，其 sw.js 也随 BASE_URL
// 落到 /app/。但存量访客浏览器中仍注册着 scope=/MikuMikuAR/ 的旧 SW，
// 其 fetch 处理器在离线/网络抖动时会用 caches.match('./index.html') 回退，
// 吐出缓存的**旧 app 外壳**——用户会看到「文档站变成了主应用」。
//
// 本文件替换旧 SW 的更新目标：浏览器下次更新检查拉到此脚本 → 安装 → 清空
// 全部 cache → 注销自身 → 通知所有受控页面刷新。此后根路径不再被 SW 接管。
//
// 注意：不要在此添加任何 fetch 监听器，否则会继续拦截文档站请求。

self.addEventListener('install', () => {
    // 跳过等待，立即进入 activate，缩短残留窗口
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // 1. 清空旧 app 遗留的所有缓存
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
            } catch {
                // 缓存清理失败不阻断注销
            }

            // 2. 注销自身
            try {
                await self.registration.unregister();
            } catch {
                // 注销失败时下次更新检查会重试
            }

            // 3. 让受控页面立即脱离 SW 控制（下一次导航即为纯网络）
            try {
                const clients = await self.clients.matchAll({ type: 'window' });
                for (const client of clients) {
                    client.navigate(client.url);
                }
            } catch {
                // 部分浏览器禁止 navigate()，忽略即可
            }
        })()
    );
});
