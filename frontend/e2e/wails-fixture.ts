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
import { waitForInitComplete, installOverlayGuards } from "./helpers";

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
        // [doc:e2e] CI runner (ubuntu-latest) 默认 /dev/shm ≈ 64MB，renderer 易因内存压力崩溃，
        // 表现为 beforeEach 中 "Target page, context or browser has been closed"（run 30743044142: 35 failed）。
        // --disable-dev-shm-usage 改用 /tmp 规避；--no-sandbox 兼容 root 容器。
        // 点开设置/场景面板会渲染 WebGL overlay；headless 无 GPU 须走软件渲染。
        // 经 DEBUG 诊断（run 30750286147）：本环境 GPU 进程无法初始化
        // （ContextResult::kTransientFailure: Failed to send GpuControl.CreateCommandBuffer），
        // --use-gl=swiftshader 更被拒绝（只允许 gl=egl-angle）。故软件 WebGL 依赖
        // --use-gl=angle --use-angle=swiftshader + --enable-unsafe-swiftshader 尽力而为；
        // 若 CI runner 无可用 GPU/软件渲染，开 overlay 的 spec 仍会失败——属环境硬伤，非测试 bug。
        // 绝不可用 --disable-gpu（会直接禁用 WebGL）。本地 Windows 下这些参数无害。
        const browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
            ],
        });
        // [doc:e2e] axe-core playwright 适配器要求 page 来自 browser.newContext()，
        // browser.newPage() 会报 "Please use browser.newContext()"，故显式建 context 再 newPage。
        const context = await browser.newContext();
        const page = await context.newPage();
        // waitUntil:"commit" 早返回（DOM 一开始解析就放行），避免多 worker 并发打 Vite 时
        // babylon-mmd 等重模块阻塞 HTML parser 触发 10s goto 超时。
        // [doc:adr-229] 带 ?e2e=1 让 app 走 NullEngine 无 GPU 启动（DOM overlay 仍渲染），
        // 规避 headless 无 GPU 下 WebGL 上下文创建失败把整个浏览器进程搞崩。
        await page.goto(`${VITE_URL}/?e2e=1`, { waitUntil: "commit", timeout: 30000 });
        // 守卫 1: nav 按钮静态渲染（index.html 写死，不证明 init() 跑完）
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });
        // 守卫 2: 等 init() 完成。init() 成功 → dom.showApp() 把 #loading display:none；
        // 失败 → dom.showError() 给 #loading 加 background。任一信号出现即表示 init 跑完，
        // click handler 已注册。纯 Vite 模式下 Wails binding 不可用通常走失败路径，
        // 但 click handler 仍已在 `await initScene()` 之前注册，可正常触发 toggleOverlay。
        await waitForInitComplete(page);
        // [doc:e2e] 纯 Vite 模式下 init() catch 会调 dom.showError() 设 #loading 的
        // pointer-events:'auto'，全屏 z-index:10000 的 #loading 会拦截所有 nav click；
        // body.app-booting 让 #bottomNav pointer-events:none 阻断导航；
        // init 失败还可能异步弹出 #mmd-dialog-overlay 全屏拦截层。
        // installOverlayGuards 用 body 级常驻 MutationObserver 统一放行三者，
        // 与元素创建时序无关（旧守卫 dialog 未创建时不监听 → 真实点击被吞，probe 实锤）。
        await installOverlayGuards(page);
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
        await waitForInitComplete(page);
        await installOverlayGuards(page);
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
