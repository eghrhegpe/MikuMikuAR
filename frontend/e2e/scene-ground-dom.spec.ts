/**
 * E2E DOM-only test for the Scene → Ground (地面) panel.
 *
 * Ground moved from Environment to Scene (scene-menu.ts root).
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * The ground level reuses buildGroundLevel() from env-feature-levels.ts,
 * so internal test-ids remain env:ground:*.
 *
 * @see scene-menu.ts — 'scene:ground' → buildGroundLevel
 * @see env-feature-levels.ts — buildGroundLevel()
 */
import { test, expect } from "./wails-fixture";

test.describe("Scene — Ground Panel (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await page.evaluate(() => localStorage.clear());
        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        // Navigate into 地面 sub-level (folder in scene root with headerToggle)
        await page.getByTestId("folder:scene:ground").click();
    });

    test("地面面板: 基础设置区段渲染", async ({ vitePage: page }) => {
        // 基础设置 folder 默认打开，包含颜色/不透明度/高度/范围/边缘淡出
        await expect(page.getByTestId("env:ground:color")).toBeVisible();
        await expect(page.getByTestId("env:ground:opacity")).toBeVisible();
        await expect(page.getByTestId("env:ground:height")).toBeVisible();
        await expect(page.getByTestId("env:ground:size")).toBeVisible();
        await expect(page.getByTestId("env:ground:edgeFade")).toBeVisible();
    });

    test("地面面板: 折叠区段（贴图/地形/增强/PBR）均渲染", async ({ vitePage: page }) => {
        // 贴图模式 folder（默认关闭，但 collapsible-header 始终可见）
        await expect(page.getByTestId("env:ground:texture")).toBeVisible();
        // 地形 folder（默认关闭，headerToggle 控制 type→terrain/flat）
        await expect(page.getByTestId("env:ground:terrain")).toBeVisible();
        // 地面增强 folder（默认关闭）
        await expect(page.getByTestId("env:ground:enhance")).toBeVisible();
        // PBR 材质 folder（默认关闭；headerToggle 控制 groundPbrEnabled）
        await expect(page.getByTestId("env:ground:pbr")).toBeVisible();
        // 装饰 folder（默认关闭，但 collapsible 本身存在）
        await expect(page.getByTestId("env:ground:deco")).toBeVisible();
        // 地面反射 folder
        await expect(page.getByTestId("env:ground:reflection")).toBeVisible();
    });
});
