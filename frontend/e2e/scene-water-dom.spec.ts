/**
 * E2E DOM-only test for the Scene → Water (水面) panel.
 *
 * Water moved from Environment to Scene (scene-menu.ts root).
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Reuses buildWaterLevel() from env-feature-levels.ts.
 *
 * @see scene-menu.ts — 'scene:water' → buildWaterLevel
 * @see env-feature-levels.ts — buildWaterLevel()
 */
import { test, expect } from "./wails-fixture";

test.describe("Scene — Water Panel (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await page.evaluate(() => localStorage.clear());
        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        // Navigate into 水面 sub-level (folder in scene root with headerToggle)
        await page.getByTestId("folder:scene:water").click();
    });

    test("水面面板: 预设芯片渲染", async ({ vitePage: page }) => {
        // 5 种水预设芯片（纯文本 button，无 testId → getByText 回退）
        await expect(page.getByText("平静", { exact: true })).toBeVisible();
        await expect(page.getByText("涟漪", { exact: true })).toBeVisible();
        await expect(page.getByText("海浪", { exact: true })).toBeVisible();
        await expect(page.getByText("风暴", { exact: true })).toBeVisible();
        await expect(page.getByText("热带", { exact: true })).toBeVisible();
    });

    test("水面面板: 基本参数区段含滑块控件", async ({ vitePage: page }) => {
        // 基本参数 folder 默认打开，含水位/范围/波高/速度/焦散强度/水颜色
        await expect(page.getByTestId("env:water:level")).toBeVisible();
        await expect(page.getByTestId("env:water:size")).toBeVisible();
        await expect(page.getByTestId("env:water:bigWaveHeight")).toBeVisible();
        await expect(page.getByTestId("env:water:smallWaveHeight")).toBeVisible();
        await expect(page.getByTestId("env:water:animSpeed")).toBeVisible();
        await expect(page.getByTestId("env:water:causticIntensity")).toBeVisible();
        await expect(page.getByTestId("env:water:color")).toBeVisible();
    });
});
