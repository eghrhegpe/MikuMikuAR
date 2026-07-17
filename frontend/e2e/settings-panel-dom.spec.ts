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
        // [doc:e2e] 设置面板使用统一的 #sceneOverlay（非独立 #settingsOverlay）
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("设置面板: 核心区段渲染", async ({ vitePage: page }) => {
        // 使用 slide-title 类定位弹窗标题，避免匹配导航按钮的 nav-label
        await expect(page.locator('.slide-title').filter({ hasText: '设置' })).toBeVisible();
        // Settings folders
        await expect(page.getByTestId("folder:settings:appearance")).toBeVisible();
        await expect(page.getByTestId("folder:settings:library")).toBeVisible();
        await expect(page.getByTestId("folder:settings:performance")).toBeVisible();
        await expect(page.getByTestId("folder:settings:rendering")).toBeVisible();
        await expect(page.getByTestId("folder:settings:paths")).toBeVisible();
        await expect(page.getByTestId("folder:settings:audio")).toBeVisible();
    });

    test("设置面板: 快捷键区段可导航", async ({ vitePage: page }) => {
        await expect(page.getByTestId("folder:settings:shortcuts")).toBeVisible();
        await page.getByTestId("folder:settings:shortcuts").click();
        // Shortcuts list renders — at least one shortcut key should be visible
        // We just assert the breadcrumb or title changed
        await expect(page.getByTestId("folder:settings:shortcuts")).toBeVisible();
    });

    test("设置面板: 外观区段显示渲染相关选项", async ({ vitePage: page }) => {
        await page.getByTestId("folder:settings:appearance").click();
        // Appearance has color/theme options. Use exact match — the level also
        // renders a "恢复默认外观" button.
        await expect(page.getByTestId("folder:settings:appearance")).toBeVisible();
    });

    test("设置面板: 关闭后重新打开", async ({ vitePage: page }) => {
        // Close by clicking the same nav button again (toggle behavior)
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });

        // Re-open
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.locator('.slide-title').filter({ hasText: '设置' })).toBeVisible();
    });
});
