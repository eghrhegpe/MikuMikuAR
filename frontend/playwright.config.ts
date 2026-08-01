import { defineConfig } from "@playwright/test";

/**
 * E2E 测试配置 — 两阶段策略
 *
 * @dom (vitePage): Chromium → Vite dev server :5173, 稳定快速, CI 阻塞门禁。
 *                  覆盖 DOM/UI 回归 + Babylon 程序化逻辑（createTestMesh 等）。
 * @webgl (wailsPage): CDP → Wails WebView2 :9222, 需 Windows + Wails v3, CI 非阻塞。
 *                     覆盖真实 PMX 加载、动作/换装、截图管线等深度集成。
 * @web (vite preview): build → preview :4174, Web 入口能力门控。
 *
 * 详细策略见 e2e/README.md §7.5 两阶段测试策略。
 */
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
    // Playwright 支持数组形式并行启动多 server。
    // 注意：CI 中 @web 相关 job 自己管理 4174 preview server，此处跳过避免端口冲突
    // （Serve 工作流先启动 server，Playwright 再启同一端口 → --strictPort 报错退出）。
    webServer: [
        {
            // 主应用桌面入口（vite.config.ts → index.html），@dom/@webgl 测试用
            command: "npm run dev",
            url: "http://localhost:5173",
            reuseExistingServer: true,
            // Vite 首次编译 babylon-mmd 等重模块常需 30-60s，CI 中可能更慢。
            // CI 日志显示 120s 默认超时仍不够，扩展到 180s。
            timeout: 180000,
        },
        // [doc:adr-177] Phase 4 web 入口生产构建预览（vite.web.config.ts → index.web.html）
        // 需先构建 dist-web/ 再 preview；@web 测试用。port 与 dev 分离避免冲突。
        // CI 中 @web 专属 job（e2e-web-smoke / e2e-web-full）设置 RUN_WEB_E2E=1 激活此 server，
        // 其他 job（@dom）不启动，避免 70s 不必要的构建等待。
        ...(process.env.RUN_WEB_E2E ? [{
            // 先杀掉残留的 4174 进程（CI runner 上前一个 workflow 遗留），再构建+预览。
            // sudo 是必要的：CI runner 上前一个 workflow 的 preview server 可能属不同用户，
            // 普通 fuser 无权限杀掉。用 || true 而非 2>/dev/null 以便排错时可见 stderr。
            command: "sudo fuser -k 4174/tcp 2>/dev/null || true; npx vite build --config vite.web.config.ts && npx vite preview --config vite.web.config.ts --port 4174 --strictPort",
            url: "http://localhost:4174/MikuMikuAR/",
            reuseExistingServer: true,
            timeout: 120000, // 构建需 70s + preview 启动
        }] : []),
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
