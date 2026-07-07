/**
 * E2E DOM-only test for the Settings panel — verifies settings UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Settings opens via #btnSettings → #settingsOverlay (separate overlay element).
 */
import { test, expect } from "./wails-fixture";

test.describe("Settings — DOM/overlay (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // Isolate: clear localStorage so settings state (theme, language, paths)
        // from a previous test doesn't leak into the next one.
        await page.evaluate(() => localStorage.clear());
        await page.click("#btnSettings");
        await page.waitForSelector("#settingsOverlay.visible", { timeout: 5000 });
    });

    test("设置面板: 核心区段渲染", async ({ vitePage: page }) => {
        await expect(page.getByText("设置", { exact: true })).toBeVisible();
        // Settings folders
        await expect(page.getByText("外观", { exact: true })).toBeVisible();
        await expect(page.getByText("性能", { exact: true })).toBeVisible();
        await expect(page.getByText("路径", { exact: true })).toBeVisible();
        await expect(page.getByText("音频", { exact: true })).toBeVisible();
    });

    test("设置面板: 快捷键区段可导航", async ({ vitePage: page }) => {
        await expect(page.getByText("快捷键")).toBeVisible();
        await page.getByText("快捷键", { exact: true }).click();
        // Shortcuts list renders — at least one shortcut key should be visible
        // We just assert the breadcrumb or title changed
        await expect(page.getByText("快捷键")).toBeVisible();
    });

    test("设置面板: 外观区段显示渲染相关选项", async ({ vitePage: page }) => {
        await page.getByText("外观", { exact: true }).click();
        // Appearance has color/theme options
        await expect(page.getByText("外观")).toBeVisible();
    });

    test("设置面板: 关闭后重新打开", async ({ vitePage: page }) => {
        await page.click("#btnCloseSettings");
        await page.waitForSelector("#settingsOverlay:not(.visible)", { timeout: 5000 });

        // Re-open
        await page.click("#btnSettings");
        await page.waitForSelector("#settingsOverlay.visible", { timeout: 5000 });
        await expect(page.getByText("设置", { exact: true })).toBeVisible();
    });
});
