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
        const browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(VITE_URL, { waitUntil: "domcontentloaded", timeout: 10000 });
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
        const page = context.pages()[0] || await context.newPage();
        await use(page);
        await browser.disconnect();
    },
});

export { expect } from "@playwright/test";
