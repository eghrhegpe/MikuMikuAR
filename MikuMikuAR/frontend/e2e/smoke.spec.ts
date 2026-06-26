/**
 * E2E smoke test — verifies the app loads and basic navigation works.
 *
 * Uses vitePage (headless Chromium → localhost:5173) for fast DOM-only assertions.
 */
import { test, expect } from "./wails-fixture";

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
    const overlay = page.locator("#sceneOverlay");
    await expect(overlay).toHaveClass(/visible/, { timeout: 3000 });

    await expect(page.getByText("天空")).toBeVisible();
    await expect(page.getByText("地面")).toBeVisible();
    await expect(page.getByText("粒子")).toBeVisible();
});
