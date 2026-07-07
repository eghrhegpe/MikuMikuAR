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
        // Core scene menu sections
        await expect(page.getByText("渲染", { exact: true })).toBeVisible();
        await expect(page.getByText("舞台", { exact: true })).toBeVisible();
        await expect(page.getByText("道具", { exact: true })).toBeVisible();
        await expect(page.getByText("舞台灯光")).toBeVisible();
        await expect(page.getByText("队形", { exact: true })).toBeVisible();
    });

    test("场景面板: 渲染预设区段可导航", async ({ vitePage: page }) => {
        await page.getByText("渲染", { exact: true }).click();
        await expect(page.getByText("渲染预设")).toBeVisible();
        // Preset names (standard/cinematic/cartoon...)
        await expect(page.getByText("标准", { exact: true })).toBeVisible();
        await expect(page.getByText("电影", { exact: true })).toBeVisible();
    });

    test("场景面板: 后处理区段含抗锯齿等选项", async ({ vitePage: page }) => {
        await page.getByText("渲染", { exact: true }).click();
        await expect(page.getByText("后处理")).toBeVisible();
        // Click into post-process
        await page.getByText("后处理", { exact: true }).click();
        await expect(page.getByText("抗锯齿")).toBeVisible();
        await expect(page.getByText("暗角", { exact: true })).toBeVisible();
    });
});
