/**
 * E2E: 核心旅程 — 截图导出
 *
 * 走 wailsPage（含 WebGL）。本项目截图走 Wails 原生 SaveFile 对话框（非浏览器 download），
 * 故 Playwright 无法用 page.waitForEvent('download') 拦截。正确做法：
 *   1) 直接断言 window.__scene.capture() 的 Babylon→image 管线（与菜单「截图当前模型」同源）；
 *   2) 断言场景菜单存在「截图当前模型」入口（DOM 级，捕获菜单回归）。
 *
 * @see ADR-060 Phase 1/Phase 2 — 原生对话框在 headless WebView2 下的处理与截图基线比对。
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook } from "./helpers";

test.describe("核心旅程: 截图导出", () => {
    test("__scene.capture() 应返回有效 PNG dataURL", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        // 与菜单「截图当前模型」走同一条 Babylon CreateScreenshotAsync 管线。
        const dataUrl = await page.evaluate(async () => await (window as any).__scene.capture());
        expect(typeof dataUrl).toBe("string");
        expect(dataUrl).toContain("data:image/png;base64,");
    });

    test("场景菜单存在「截图当前模型」入口", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.getByText("截图当前模型", { exact: true })).toBeVisible();
    });
});
