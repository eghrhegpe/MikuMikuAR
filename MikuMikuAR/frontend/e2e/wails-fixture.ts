import { test as base, chromium, Page } from "@playwright/test";
import { CDP_ENDPOINT } from "./helpers";

/**
 * Extended test fixture that connects to the running Wails WebView2
 * via Chrome DevTools Protocol instead of launching a new browser.
 *
 * Usage:
 *   test("my test", async ({ wailsPage }) => { ... });
 */
type WailsFixtures = {
    wailsPage: Page;
};

export const test = base.extend<WailsFixtures>({
    wailsPage: async ({}, use) => {
        const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
        const context = browser.contexts()[0] || await browser.newContext();
        const page = context.pages()[0] || await context.newPage();
        await use(page);
        await browser.close();
    },
});

export { expect } from "@playwright/test";
