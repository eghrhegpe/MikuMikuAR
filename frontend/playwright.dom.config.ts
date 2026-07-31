/**
 * Minimal Playwright config for @dom tests only.
 * Skips the web preview server (which is needed for @web tests only).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : 2,
    reporter: "html",

    webServer: {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60000,
    },

    use: {
        baseURL: "http://localhost:5173",
        screenshot: "only-on-failure",
        trace: "on-first-retry",
    },
});