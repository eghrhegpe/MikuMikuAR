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
        await expect(page.getByTestId("folder:scene:render:stage")).toBeVisible();
        // 后处理 位于 渲染 子层级（非根级），保留稳定 id 契约，待人工确认导航路径
        await expect(page.getByTestId("folder:scene:render:postprocess")).toBeVisible();
        // 预设场景 位于 渲染 子层级（非根级），保留稳定 id 契约，待人工确认
        await expect(page.getByTestId("folder:scene:render:presets")).toBeVisible();
        await expect(page.getByTestId("folder:scene:physics")).toBeVisible();
    });

    test("场景面板: 后处理区段含抗锯齿等选项", async ({ vitePage: page }) => {
        // 后处理 is a top-level section in the refactored scene menu.
        await page.getByTestId("folder:scene:render:postprocess").click();
        await expect(page.getByTestId("postprocess:optical:aa")).toBeVisible();
        await expect(page.getByTestId("postprocess:vignette")).toBeVisible();
    });

    test("场景面板: 舞台区段含舞台灯光", async ({ vitePage: page }) => {
        await page.getByTestId("folder:scene:render:stage").click();
        // 舞台灯光 / 加载舞台 live inside the 舞台 sub-level.
        await expect(page.getByTestId("folder:scene:stageLight")).toBeVisible();
        await expect(page.getByTestId("menu.scene.loadStage")).toBeVisible();
    });
});
