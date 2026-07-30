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
//
// [doc:adr-099][doc:adr-133] 跨源隔离注入（COI Service Worker）：
//  GitHub Pages 静态托管无法自定义响应头 → 主文档拿不到 COOP/COEP → crossOriginIsolated
//  恒为 false → SharedArrayBuffer 不可用 → MPR 多线程物理降级 SPR。桌面端由 Go 的
//  CoopCoepMiddleware 注入、Android 由 MainActivity.shouldInterceptRequest 注入，网页端
//  唯一手段是让 SW 在响应上补 COOP/COEP，浏览器据此在下次导航解锁跨源隔离。
//
//  关键设计——COEP 用 credentialless 而非 require-corp：
//    require-corp 会硬拦截所有无 CORP 头的跨源资源（AI relay fetch、GitHub API、广场
//    iframe.src），credentialless 则以「不带凭据」方式放行无 CORP 的跨源子资源，既满足
//    crossOriginIsolated=true 的前置条件，又不打断现有跨源调用。Chrome 96+/Edge/新
//    Firefox 支持；不支持的浏览器 SW 注入不生效，自动降级 SPR（scene.ts:650 兜底）。
//
//  ENABLE_COI 开关：默认 true。若发现某跨源资源在 credentialless 下仍失败（少数需凭据
//  的第三方 API），置 false 即整体回退到「无跨源隔离 + SPR 单线程」的安全态，功能不残。

const CACHE = 'mmku-static-v1';
const ASSET_RE = /\/assets\//;

// 跨源隔离注入总开关。true=注入 COOP/COEP 换取 SharedArrayBuffer/MPR；false=纯缓存模式。
const ENABLE_COI = true;

// 给同源响应补 COOP/COEP（+CORP），使浏览器判定 crossOriginIsolated=true。
// 仅处理有实体 body 的正常响应；opaque（status 0）/重定向不动，避免破坏跨源资源。
function withCoiHeaders(res) {
    if (!ENABLE_COI) return res;
    if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') {
        return res;
    }
    const h = new Headers(res.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'credentialless');
    // 让本站资源可被跨源隔离页嵌入（同源资源始终安全，跨源保持 credentialless 放行）
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

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
                    return withCoiHeaders(res);
                })
                .catch(() =>
                    caches
                        .match(req)
                        .then((r) => r || caches.match('./index.html'))
                        .then((r) => (r ? withCoiHeaders(r) : r))
                )
        );
        return;
    }

    // /assets/ 带哈希产物：cache-first（秒开）
    if (ASSET_RE.test(url.pathname)) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return withCoiHeaders(cached);
                return fetch(req).then((res) => {
                    if (res && res.ok) {
                        caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => undefined);
                    }
                    return withCoiHeaders(res);
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
                return withCoiHeaders(res);
            })
            .catch(() => caches.match(req).then((r) => (r ? withCoiHeaders(r) : r)))
    );
});
