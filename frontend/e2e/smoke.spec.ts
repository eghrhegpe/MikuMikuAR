/**
 * E2E smoke test — verifies the app loads and basic navigation works.
 *
 * Uses vitePage (headless Chromium → localhost:5173) for fast DOM-only assertions.
 * NOTE: in pure-vite mode (no Wails runtime) the Wails init logs an error but the
 * menu DOM still renders, so overlay/nav interactions are valid @dom assertions.
 */
import { test, expect } from "./wails-fixture";

test.describe("Smoke — DOM/overlay (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test("app loaded: canvas and nav bar present", async ({ vitePage: page }) => {
        const canvas = page.locator("#renderCanvas");
        await expect(canvas).toBeVisible({ timeout: 5000 });

        await expect(page.locator("#btnMainAction")).toBeVisible();
        await expect(page.locator("#btnMotionPopup")).toBeVisible();
        await expect(page.locator("#btnScene")).toBeVisible();
        await expect(page.locator("#btnEnv")).toBeVisible();
        await expect(page.locator("#btnSettings")).toBeVisible();
    });

    test("environment button opens overlay", async ({ vitePage: page }) => {
        await page.click("#btnEnv");
        // All nav buttons share the single #sceneOverlay; it gains `.visible` on open.
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });

        // Env menu top-level folders render inside the overlay.
        await expect(page.getByText("天空", { exact: true })).toBeVisible();
        await expect(page.getByText("地面", { exact: true })).toBeVisible();
        await expect(page.getByText("粒子", { exact: true })).toBeVisible();
    });

    test("Ctrl+1~5 toggle each nav menu (overlay show/hide)", async ({ vitePage: page }) => {
        const overlay = page.locator("#sceneOverlay");
        for (const n of [1, 2, 3, 4, 5]) {
            // Open via Ctrl+N
            await page.keyboard.press(`Control+Digit${n}`);
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 6000 });
            // Toggle off via the same shortcut
            await page.keyboard.press(`Control+Digit${n}`);
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 6000 });
        }
        await expect(overlay).not.toHaveClass(/visible/);
    });
});
