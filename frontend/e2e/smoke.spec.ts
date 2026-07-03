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

test("Ctrl+1~5 keyboard shortcuts toggle each nav menu", async ({ vitePage: page }) => {
    async function ctrlNum(digit: string): Promise<void> {
        await page.keyboard.down("Control");
        await page.keyboard.press(`Digit${digit}`);
        await page.keyboard.up("Control");
    }

    // Ctrl+1 → model popup
    await ctrlNum("1");
    await expect(page.locator("#modelPopup")).toHaveClass(/visible/, { timeout: 3000 });
    await ctrlNum("1"); // toggle off

    // Ctrl+2 → motion popup
    await ctrlNum("2");
    await expect(page.locator("#motionPopup")).toHaveClass(/visible/, { timeout: 3000 });
    await ctrlNum("2");

    // Ctrl+3 → scene overlay (showSceneMenu)
    await ctrlNum("3");
    await expect(page.locator("#sceneOverlay")).toHaveClass(/visible/, { timeout: 3000 });
    await ctrlNum("3");

    // Ctrl+4 → environment overlay (showEnvMenu, same #sceneOverlay)
    await ctrlNum("4");
    await expect(page.locator("#sceneOverlay")).toHaveClass(/visible/, { timeout: 3000 });
    await ctrlNum("4");

    // Ctrl+5 → settings overlay
    await ctrlNum("5");
    await expect(page.locator("#settingsOverlay")).toHaveClass(/visible/, { timeout: 3000 });
    await ctrlNum("5");
});
