import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    // 限制并发避免多 worker 同时打 Vite 5173 触发 babylon-mmd 重模块重复编译，
    // 该场景会导致 page.goto 在 10s 内达不到 domcontentloaded（实测 14/16 失败的根因）。
    workers: process.env.CI ? 1 : 2,
    reporter: "html",

    // Auto-start Vite for @dom tests. When wails3 dev or another
    // process already serves :5173, reuseExistingServer skips launch.
    webServer: {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        // Vite 首次编译 babylon-mmd 等重模块常需 30-60s，15s 会误判超时。
        timeout: 60000,
    },

    use: {
        // Wails WebView2 exposes CDP on 9222 when MMCAR_DEBUG_PORT=9222 is set
        // (main.go reads it and injects --remote-debugging-port; WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is
        // suppressed by Wails v3). We connect via connectOverCDP in each test rather than launching a new browser.
        // baseURL 与 vitePage fixture 实际 goto 的 URL 保持一致，避免后续误用 34115。
        baseURL: "http://localhost:5173",

        // Capture screenshot on failure
        screenshot: "only-on-failure",
        trace: "on-first-retry",
    },

    // Playwright doesn't launch a browser; tests connect to Wails WebView2 via CDP.
    // So we don't need projects or browser channels defined here.
});
