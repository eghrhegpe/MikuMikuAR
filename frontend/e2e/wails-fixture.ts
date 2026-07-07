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

const VITE_URL = process.env.VITE_URL || "http://localhost:5173";
const CDP_ENDPOINT = "http://127.0.0.1:9222";

type WailsFixtures = {
    wailsPage: Page;
    vitePage: Page;
};

export const test = base.extend<WailsFixtures>({
    /** Page connected to a local Playwright-managed Chromium pointed at Vite dev server. */
    vitePage: async ({}, use) => {
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(VITE_URL, { waitUntil: "domcontentloaded", timeout: 10000 });
        await use(page);
        try {
            await use(page);
        } finally {
            await browser.close();
        }
    },

    /** Page connected to the running Wails WebView2 via CDP.
     *  Uses 30s timeout — if 9222 isn't open (e.g. wails3 dev not started
     *  or msedgewebview2 residual killed), fail fast instead of hanging. */
    wailsPage: async ({}, use) => {
        const browser = await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 30000 });
        const context = browser.contexts()[0] || await browser.newContext();
        const page = context.pages()[0] || await context.newPage();
        await use(page);
        await browser.disconnect();
    },
});

export { expect } from "@playwright/test";
