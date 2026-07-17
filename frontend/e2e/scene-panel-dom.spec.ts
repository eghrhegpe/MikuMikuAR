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
        // 后处理 / 渲染预设 已随 ADR-111 迁至环境菜单（env:postprocess）与场景→高级子层（scene:presets）
        // 场景根级不再直接挂 scene:render:postprocess / scene:render:presets，相关断言见 env-panel 测试
        await expect(page.getByTestId("folder:scene:physics")).toBeVisible();
    });

    test("场景面板: 后处理区段含抗锯齿等选项（迁至环境菜单）", async ({ vitePage: page }) => {
        // [adr-111] 后处理（Bloom/DOF/色调映射）从场景菜单迁入环境菜单，故从 env 入口验证
        await page.keyboard.press("Escape");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
        await page.click("#btnEnv");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await page.getByTestId("folder:env:postprocess").click();
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
