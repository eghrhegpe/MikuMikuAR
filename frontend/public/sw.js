// MikuMikuAR Service Worker — Web 生产部署静态资源缓存（二次启动秒开）
//
// 策略：
//  - 导航请求(network-first)：保证拿到最新 index.html（其引用内容哈希资源），
//    离线时回退缓存导航壳。
//  - /assets/ 下构建产物（js/css/wasm，文件名带内容哈希）：cache-first，
//    未命中则网络并写入；文件名随内容变，可安全长期缓存，二次启动直接命中。
//  - 其他同源固定名资源（lib/、textures/ 等用户数据）：network-first + 回退缓存，
//    避免内容更新而 URL 不变导致的 stale。
//  - Range 请求放行网络（wasm 可能分段）；跨域/非 GET 不拦截。
//  - activate 阶段清理非当前 cache 名的旧缓存，控制空间。

const CACHE = 'mmku-static-v1';
const ASSET_RE = /\/assets\//;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((c) => c.addAll(['./', './index.html']).catch(() => undefined))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (req.headers.has('range')) return; // 放行分段请求（如 wasm），不缓存
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // 只管同源

    // 导航：network-first，回退缓存壳（离线可用）
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => undefined);
                    return res;
                })
                .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
        );
        return;
    }

    // /assets/ 带哈希产物：cache-first（秒开）
    if (ASSET_RE.test(url.pathname)) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((res) => {
                    if (res && res.ok) {
                        caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => undefined);
                    }
                    return res;
                });
            })
        );
        return;
    }

    // 其他同源固定名资源：network-first + 回退缓存（防 stale）
    event.respondWith(
        fetch(req)
            .then((res) => {
                caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => undefined);
                return res;
            })
            .catch(() => caches.match(req))
    );
});
