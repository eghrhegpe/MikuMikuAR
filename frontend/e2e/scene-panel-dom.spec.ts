/**
 * E2E DOM-only test for the Scene panel — verifies scene UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Scene opens via #btnScene → #sceneOverlay.
 */
import { test, expect } from "./wails-fixture";

test.describe("Scene — DOM/overlay (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // Isolate: clear localStorage so scene state (render preset, env, camera)
        // from a previous test doesn't carry over.
        await page.evaluate(() => localStorage.clear());
        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("场景面板: 核心区段渲染", async ({ vitePage: page }) => {
        // 使用 slide-title 类定位弹窗标题，避免匹配导航按钮的 nav-label
        await expect(page.locator('.slide-title').filter({ hasText: '场景' })).toBeVisible();
        // Core scene menu root sections (post refactor).
        // 道具 / 舞台灯光 / 队形 live inside the 舞台 sub-level, not at root.
        await expect(page.getByText("舞台", { exact: true })).toBeVisible();
        await expect(page.getByText("后处理", { exact: true })).toBeVisible();
        await expect(page.getByText("预设场景", { exact: true })).toBeVisible();
        await expect(page.getByText("物理", { exact: true })).toBeVisible();
        await expect(page.getByText("布料模拟", { exact: true })).toBeVisible();
    });

    test("场景面板: 后处理区段含抗锯齿等选项", async ({ vitePage: page }) => {
        // 后处理 is a top-level section in the refactored scene menu.
        await page.getByText("后处理", { exact: true }).click();
        await expect(page.getByText("抗锯齿")).toBeVisible();
        await expect(page.getByText("暗角", { exact: true })).toBeVisible();
    });

    test("场景面板: 舞台区段含舞台灯光", async ({ vitePage: page }) => {
        await page.getByText("舞台", { exact: true }).click();
        // 舞台灯光 / 加载舞台 live inside the 舞台 sub-level.
        await expect(page.getByText("舞台灯光", { exact: true })).toBeVisible();
        await expect(page.getByText("加载舞台", { exact: true })).toBeVisible();
    });
});
