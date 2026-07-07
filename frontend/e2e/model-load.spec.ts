/**
 * E2E: 核心旅程 — 模型加载
 *
 * 走 wailsPage（WebView2 CDP，含真实 Go 后端），因为加载模型需要 Wails 文件访问。
 * 断言基于 window.__scene 数值钩子（见 ADR-060 Phase 0），不依赖像素截图。
 *
 * @requires 模型库已配置 resource_root 且至少含 1 个可加载模型（CI 需 seed 模型）。
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel } from "./helpers";

test.describe("核心旅程: 模型加载", () => {
    test("加载首个模型后，meshCount 显著增加且 FPS ≥ 30", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCount).toBeGreaterThan(10);

        const fps = await page.evaluate(() => (window as any).__scene.fps);
        expect(fps).toBeGreaterThanOrEqual(30);
    });

    test("加载指定名称模型（确定性选择）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        // 将 '示例模型' 替换为 CI seed 的真实模型名；保证首项非文件夹时可用。
        await loadModelByName(page, "示例模型");
        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCount).toBeGreaterThan(10);
    });
});
