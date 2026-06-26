import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: "html",

    use: {
        // Wails WebView2 exposes CDP on 9222 when .env has WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
        // We connect via connectOverCDP in each test rather than launching a new browser.
        // This baseURL is only used for direct goto fallback if connectOverCDP fails.
        baseURL: "http://localhost:34115",

        // Capture screenshot on failure
        screenshot: "only-on-failure",
        trace: "on-first-retry",
    },

    // Playwright doesn't launch a browser; tests connect to Wails WebView2 via CDP.
    // So we don't need projects or browser channels defined here.
});
