/**
 * Minimal config for @dom-only local testing.
 * Skips the web preview server (used for @web tests only).
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: 1,
    reporter: "line",

    webServer: {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 30000,
    },

    use: {
        baseURL: "http://localhost:5173",
        screenshot: "only-on-failure",
    },
});