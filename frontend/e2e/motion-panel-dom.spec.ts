/**
 * E2E DOM-only test for the Motion popup — verifies motion UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Motion popup opens via #btnMotionPopup → #sceneOverlay.
 */
import { test, expect } from "./wails-fixture";

test.describe("Motion — DOM/overlay (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // Isolate: clear localStorage so ProcMotion state, BPM, or playback position
        // from a previous test don't leak into the next one.
        await page.evaluate(() => localStorage.clear());
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("动作弹窗: 标题与核心区段渲染", async ({ vitePage: page }) => {
        // 使用 slide-title 类定位弹窗标题，避免匹配导航按钮的 nav-label
        await expect(page.locator('.slide-title').filter({ hasText: '动作' })).toBeVisible();
        // Motion root sections (post modularize: 相机 / 浏览音乐库 / 程序化动作 / 视线追踪).
        // 动作绑定 / 姿势库 only appear after drilling into a specific model.
        await expect(page.getByText("相机", { exact: true })).toBeVisible();
        await expect(page.getByText("浏览音乐库", { exact: true })).toBeVisible();
        await expect(page.getByText("程序化动作", { exact: true })).toBeVisible();
        await expect(page.getByText("视线追踪", { exact: true })).toBeVisible();
    });

    test("动作弹窗: 相机模式可交互", async ({ vitePage: page }) => {
        await page.getByText("相机", { exact: true }).click();
        // Camera mode is a segmented control showing only the CURRENT value (轨道).
        // 自由飞行 / 演唱会 / 单拍 live in the slider's hidden listbox, not as
        // visible text — assert the rendered mode value + controls instead.
        await expect(page.getByText("轨道", { exact: true })).toBeVisible();
        await expect(page.getByText("视场角")).toBeVisible();
        await expect(page.getByText("自动运镜")).toBeVisible();
        await expect(page.getByText("加载相机 VMD")).toBeVisible();
    });

    test("动作弹窗: 返回上级不崩溃", async ({ vitePage: page }) => {
        // Navigate into a sub-level then back
        await page.getByText("相机", { exact: true }).click();
        await expect(page.getByText("轨道", { exact: true })).toBeVisible();
        // Close overlay by clicking the same nav button again (toggle behavior)
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
    });
});
