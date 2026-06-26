/**
 * E2E smoke test — verifies the app loads and basic navigation works.
 * Connects to Wails WebView2 via CDP (port 9222).
 *
 * Prerequisites:
 *   1. `.env` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
 *   2. `wails dev` running
 *   3. `npx playwright test`
 */
import { test, expect } from "./wails-fixture";

test("app loaded: canvas and nav bar present", async ({ wailsPage: page }) => {
    // The Babylon canvas should exist
    const canvas = page.locator("#renderCanvas");
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // All nav buttons exist
    await expect(page.locator("#btnMainAction")).toBeVisible();
    await expect(page.locator("#btnMotionPopup")).toBeVisible();
    await expect(page.locator("#btnScene")).toBeVisible();
    await expect(page.locator("#btnEnv")).toBeVisible();
    await expect(page.locator("#btnSettings")).toBeVisible();
});

test("environment button opens overlay", async ({ wailsPage: page }) => {
    await page.click("#btnEnv");
    const overlay = page.locator("#sceneOverlay");
    await expect(overlay).toHaveClass(/visible/, { timeout: 3000 });

    // Environment sub-menu items should be visible
    await expect(page.getByText("天空")).toBeVisible();
    await expect(page.getByText("地面")).toBeVisible();
    await expect(page.getByText("粒子")).toBeVisible();
});
