/**
 * E2E test helpers — shared utilities for connecting to Wails WebView2
 * via Chrome DevTools Protocol.
 *
 * Prerequisites:
 *   1. Project root `.env` must have:
 *        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 *   2. Start the app: `wails dev` (from project root)
 *   3. Run tests: `npx playwright test`
 */
import { expect, Page } from "@playwright/test";
import { chromium } from "@playwright/test";

export const CDP_ENDPOINT = "http://127.0.0.1:9222";

/** Connect to the already-running Wails WebView2 via CDP. */
export async function connectToWails(): Promise<{ page: Page; close: () => Promise<void> }> {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const contexts = browser.contexts();
    // The first/default context has the Wails WebView2 page(s)
    const context = contexts[0] || await browser.newContext();
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    return {
        page,
        close: async () => { await browser.close(); },
    };
}

/** Take a Babylon screenshot via the exposed __capture helper. */
export async function captureScreenshot(page: Page): Promise<string> {
    return await page.evaluate(async () => {
        const f = (window as any).__capture;
        if (!f) throw new Error("__capture not found on window — ensure main.ts exposes it");
        return await f();
    });
}

/** Click the bottom-nav "环境" button to open the environment panel. */
export async function openEnvPanel(page: Page): Promise<void> {
    await page.click("#btnEnv");
    // Wait for the overlay to appear
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 3000 });
}

/** Click a mode button inside the sky level by its visible text label. */
export async function clickSkyMode(page: Page, modeLabel: string): Promise<void> {
    // The sky level renders buttons with text like "纯色", "渐变", "贴图", "程序化"
    await page.getByRole("button", { name: modeLabel }).click();
}

/** Navigate into a sub-level of the environment menu by clicking its folder row. */
export async function clickEnvSubLevel(page: Page, label: string): Promise<void> {
    // Environment sub-menus (天空, 照明, 地面, etc.) use text content in menu-item divs
    await page.getByText(label, { exact: true }).click();
}
