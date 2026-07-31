import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: false,
    retries: 0,
    workers: 1,
    reporter: "line",
    webServer: undefined as any, // 跳过 webServer 启动（复用已有 dev server）
    use: {
        baseURL: "http://localhost:5173",
        screenshot: "only-on-failure",
        trace: "on-first-retry",
    },
});