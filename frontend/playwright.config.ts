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

    // [doc:adr-177] Phase 4 双 webServer：5173 桌面 dev（@dom/@webgl）+ 4174 web preview（@web）
    // Playwright 支持数组形式并行启动多 server，各自 reuseExistingServer 避免重复启动。
    webServer: [
        {
            // 主应用桌面入口（vite.config.ts → index.html），@dom/@webgl 测试用
            command: "npm run dev",
            url: "http://localhost:5173",
            reuseExistingServer: true,
            // Vite 首次编译 babylon-mmd 等重模块常需 30-60s，15s 会误判超时。
            timeout: 60000,
        },
        {
            // [doc:adr-177] Phase 4 web 入口生产构建预览（vite.web.config.ts → index.web.html）
            // 需先构建 dist-web/ 再 preview；@web 测试用。port 与 dev 分离避免冲突。
            command: "npx vite build --config vite.web.config.ts && npx vite preview --config vite.web.config.ts --port 4174 --strictPort",
            url: "http://localhost:4174/MikuMikuAR/",
            reuseExistingServer: true,
            timeout: 120000, // 构建需 70s + preview 启动
        },
    ],

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
