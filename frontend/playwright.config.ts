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
    // [doc:e2e] 参数对齐隔壁 ysm-model-manager 实证（其 33s 全绿）：
    //   15s/项 快速失败，不再默认 30s 陪跑必败项；
    //   retries=1 而非 2（必败项少烧一轮）；
    //   maxFailures=38（≥ 全部 gate 阈值最大值 37 + 1，详见下方 P0 注释）；
    //   globalTimeout 7min 总限兜底，防 81 个必败 spec 串行烧穿 CI。
    // 背景：@dom 集合混入大量「打开设置/场景面板 → 渲染 WebGL overlay」的 spec，
    // headless CI 无 GPU 时 waitForSelector 20s 必超时（run 31325621473: 49 failed），
    // 旧参数每个必败项 30s×2 重试=90s、串行 49 个 → 7 分钟护栏到点被杀。
    // [fix:P0] 子代理审核（两轮）：maxFailures 必须 ≥ 最大 gate 阈值 + 1，否则失败数被
    // 截断到 maxFailures → 阈值永远等不到 `fa > 阈值`（纸老虎假绿）。
    //   - 曾为 5：@webgl(阈值8)/@web-full(阈值5) 全败只记 5 个失败 → 永不红
    //   - 提到 10 后：@overlay(阈值37) 全败只记 10 个 → 仍假绿（本轮修复）
    //   - 现为 38：覆盖最大阈值 37（@overlay）+1；@dom(7)/@webgl(16)/@web-full(18)/
    //     @web-smoke(5) 测试数均 < 38，maxFailures 不截断它们，仅 @overlay(74) 受影响。
    timeout: 15000,
    globalTimeout: 7 * 60 * 1000,
    retries: process.env.CI ? 1 : 0,
    maxFailures: process.env.CI ? 38 : 0,
    // 限制并发避免多 worker 同时打 Vite 5173 触发 babylon-mmd 重模块重复编译，
    // 该场景会导致 page.goto 在 10s 内达不到 domcontentloaded（实测 14/16 失败的根因）。
    // 同时固定为 1：@webgl 通过 CDP 共享同一个 Wails WebView2 页面，跨文件并行会互相
    // 踩踏（一个用例加载/删除模型时另一个用例也在操作同一实例），全局串行最稳。
    workers: 1,
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
            // [2026-08-12] build 已拆到 e2e-suite.yml 预构建步骤（dist-web/ 含复制后的
            // index.html），本 server 只负责 preview——避免 CI 2 核上 build(300-600s) 与
            // preview 绑在同一 command 里、被步骤 timeout 一起 kill（@web 两个 job 假红根因）。
            // 先杀掉残留的 4174 进程（CI runner 上前一个 workflow 遗留），再 preview。
            // Linux/macOS 用 sudo fuser：CI runner 上前一个 workflow 的 preview server
            // 可能属不同用户，普通 fuser 无权限杀掉。Windows 没有 sudo/fuser，直接走
            // strictPort；如端口被占会快速失败并提示，避免启动脚本本身不可用。
            command: process.platform === "win32"
                ? "npx vite preview --config vite.web.config.ts --port 4174 --strictPort"
                : "sudo fuser -k 4174/tcp 2>/dev/null || true; npx vite preview --config vite.web.config.ts --port 4174 --strictPort",
            // base = '/MikuMikuAR/app/'，preview 实际服务在 /MikuMikuAR/app/（web-smoke.spec 的 WEB_URL 同步）。
            url: "http://localhost:4174/MikuMikuAR/app/",
            reuseExistingServer: true,
            // preview 不构建，仅起静态服务，120s 足够（严格端口被占用才需更长）。
            timeout: 120000,
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
