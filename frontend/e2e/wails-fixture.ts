/**
 * Playwright fixtures for MikuMikuAR E2E tests.
 *
 * Two connection modes:
 *   wailsPage — connectOverCDP to running Wails WebView2 (needed for screenshots / WebGL).
 *   vitePage  — launch a local Chromium targeting the Vite dev server (DOM-only, no Wails needed).
 *
 * Usage:
 *   test("DOM test", async ({ vitePage }) => { ... });       // Fast, no Wails
 *   test("snapshot", async ({ wailsPage }) => { ... });      // Full integration
 */
import { test as base, chromium, Page } from "@playwright/test";
import http from "http";

const VITE_URL = process.env.VITE_URL || "http://localhost:5173";
const CDP_ENDPOINT = "http://127.0.0.1:9222";

type WailsFixtures = {
    wailsPage: Page;
    vitePage: Page;
};

/**
 * Polls the CDP endpoint until it responds, fail-fast after timeout.
 * Prevents the 30s-connectOverCDP timeout from being wasted on a dead port.
 */
async function ensureCDPReady(endpoint: string, timeout = 30000): Promise<void> {
    const start = Date.now();
    let lastErr: string = "";
    while (Date.now() - start < timeout) {
        try {
            await new Promise<void>((resolve, reject) => {
                const req = http.get(`${endpoint}/json/version`, (res) => {
                    if (res.statusCode === 200) resolve();
                    else reject(new Error(`status ${res.statusCode}`));
                });
                req.on("error", (e) => { lastErr = e.message; reject(e); });
                req.setTimeout(2000, () => { req.destroy(); reject(new Error("timeout")); });
            });
            return; // success
        } catch {
            // retry after 500ms
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    throw new Error(
        `CDP endpoint ${endpoint} not ready within ${timeout}ms` +
        (lastErr ? ` (last error: ${lastErr})` : "")
    );
}

export const test = base.extend<WailsFixtures>({
    /** Page connected to a local Playwright-managed Chromium pointed at Vite dev server. */
    vitePage: async ({}, use) => {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        // waitUntil:"commit" 早返回（DOM 一开始解析就放行），避免多 worker 并发打 Vite 时
        // babylon-mmd 等重模块阻塞 HTML parser 触发 10s goto 超时。
        await page.goto(VITE_URL, { waitUntil: "commit", timeout: 30000 });
        // 守卫 1: nav 按钮静态渲染（index.html 写死，不证明 init() 跑完）
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });
        // 守卫 2: 等 init() 完成。init() 成功 → dom.showApp() 把 #loading display:none；
        // 失败 → dom.showError() 给 #loading 加 background。任一信号出现即表示 init 跑完，
        // click handler 已注册。纯 Vite 模式下 Wails binding 不可用通常走失败路径，
        // 但 click handler 仍已在 `await initScene()` 之前注册，可正常触发 toggleOverlay。
        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                const loading = document.getElementById("loading");
                if (!loading) return resolve();
                const done = () => resolve();
                if (loading.style.display === "none" || loading.style.background) {
                    return done();
                }
                const obs = new MutationObserver(() => {
                    if (loading.style.display === "none" || loading.style.background) {
                        obs.disconnect();
                        done();
                    }
                });
                obs.observe(loading, { attributes: true, attributeFilter: ["style"] });
                setTimeout(() => {
                    obs.disconnect();
                    done();
                }, 20000);
            });
        });
        // [doc:e2e] 纯 Vite 模式下 init() catch 会调 dom.showError() 设 #loading 的
        // pointer-events:'auto'，全屏 z-index:10000 的 #loading 会拦截所有 nav click。
        // 强制保持 pointer-events:none 让 click 穿透；MutationObserver 兜后续变更。
        await page.evaluate(() => {
            const loading = document.getElementById("loading");
            if (!loading) return;
            const forcePassthrough = () => {
                if (loading.style.pointerEvents !== "none") {
                    loading.style.pointerEvents = "none";
                }
            };
            forcePassthrough();
            new MutationObserver(forcePassthrough).observe(loading, {
                attributes: true,
                attributeFilter: ["style"],
            });
        });
        await use(page);
        await browser.close();
    },

    /** Page connected to the running Wails WebView2 via CDP.
     *  Actively polls /json/version before connecting, so a stale/dead endpoint
     *  is detected fast with a clear error message. */
    wailsPage: async ({}, use) => {
        await ensureCDPReady(CDP_ENDPOINT, 30000);
        const browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 10000 });
        const context = browser.contexts()[0] || await browser.newContext();
        // [doc:e2e] 主应用窗口和隐藏预热 plaza 窗口都在同一个 browser context 中。
        // pages()[0] 可能是 plaza 窗口（about:blank），所以遍历找含 #btnMainAction 的页面。
        let page: Page | undefined;
        const allPages = context.pages();
        for (const p of allPages) {
            try {
                await p.waitForSelector("#btnMainAction", { timeout: 2000 });
                page = p;
                break;
            } catch { /* 不是主应用窗口，继续 */ }
        }
        if (!page) {
            page = allPages[0] || await context.newPage();
        }

        // [doc:e2e] Same guards as vitePage: wait for init() to complete and
        // force pointer-events:none on the #loading overlay so nav clicks
        // are not intercepted.
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });
        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                const loading = document.getElementById("loading");
                if (!loading) return resolve();
                const done = () => resolve();
                if (loading.style.display === "none" || loading.style.background) {
                    return done();
                }
                const obs = new MutationObserver(() => {
                    if (loading.style.display === "none" || loading.style.background) {
                        obs.disconnect();
                        done();
                    }
                });
                obs.observe(loading, { attributes: true, attributeFilter: ["style"] });
                setTimeout(() => {
                    obs.disconnect();
                    done();
                }, 20000);
            });
        });
        await page.evaluate(() => {
            const loading = document.getElementById("loading");
            if (!loading) return;
            const forcePassthrough = () => {
                if (loading.style.pointerEvents !== "none") {
                    loading.style.pointerEvents = "none";
                }
            };
            forcePassthrough();
            new MutationObserver(forcePassthrough).observe(loading, {
                attributes: true,
                attributeFilter: ["style"],
            });
        });
        // Dismiss any leftover overlay from a previous test run
        // via Escape so the app's own state machine properly resets.
        await page.keyboard.press("Escape");

        await use(page);
        // [doc:e2e] connectOverCDP 返回的 Browser 在 Playwright 1.61 无 disconnect()，
        // 改用 close() 安全释放 CDP 连接，不干扰 WebView2 进程。
        try { await browser.close(); } catch { /* fixture teardown 异常不吞断言 */ }
    },
});

export { expect } from "@playwright/test";
