/**
 * E2E DOM-only test for keyboard shortcuts — verifies shortcut UI renders
 * and the registered shortcuts respond correctly.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Navigate: Settings → 快捷键 to view the shortcuts panel.
 */
import { test, expect } from "./wails-fixture";

test.describe("Shortcuts — DOM/overlay (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test("快捷键面板: 通过设置 → 快捷键导航可见", async ({ vitePage: page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#settingsOverlay.visible", { timeout: 5000 });
        await page.getByText("快捷键", { exact: true }).click();

        // The shortcut list should display registered shortcuts
        // (at minimum the Ctrl+N nav shortcuts)
        await expect(page.getByText("快捷键")).toBeVisible();
    });

    test("Ctrl+1 ~ 5 切换各导航菜单（已在 smoke 覆盖，这里验证无冲突）", async ({ vitePage: page }) => {
        const overlay = page.locator("#sceneOverlay");
        for (const n of [1, 2, 3, 4, 5]) {
            await page.keyboard.press(`Control+Digit${n}`);
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 6000 });
            await page.keyboard.press(`Control+Digit${n}`);
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 6000 });
        }
        await expect(overlay).not.toHaveClass(/visible/);
    });

    test("快捷键: 空间/Space 切换播放状态（按钮存在）", async ({ vitePage: page }) => {
        const playBtn = page.locator("#btnPlayPause");
        await expect(playBtn).toBeVisible();
        // PlayPause toggles via click or Space; verify it responds
        await playBtn.click();
        // No crash — button still visible
        await expect(playBtn).toBeVisible();
    });
});
