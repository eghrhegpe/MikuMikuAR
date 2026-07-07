/**
 * E2E: 核心旅程 — 模型加载
 *
 * 走 wailsPage（WebView2 CDP，含真实 Go 后端），因为加载模型需要 Wails 文件访问。
 * 断言基于 window.__scene 数值钩子（见 ADR-060 Phase 0），不依赖像素截图。
 *
 * @requires 模型库已配置 resource_root 且至少含 1 个可加载模型（CI 用 seed model path）。
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel, loadSeedModel, clearSeedModel } from "./helpers";

test.describe("核心旅程: 模型加载", { tag: ["@webgl"] }, () => {
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
        // 不从 spec 硬编码模型名(原 "示例模型" 在本地不存在必败):
        // 从模型库首个真实条目动态取名,保证本地/CI 均可确定性加载。
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await page.waitForSelector("#sceneOverlay .slide-item", { timeout: 5000 });
        const name = (await page.locator("#sceneOverlay .slide-item").first().innerText()).trim();
        // 重新定位并点击该名称项完成加载(若首项是文件夹则此处进入子层级,非预期但可接受)。
        await page.locator("#sceneOverlay .slide-item", { hasText: name }).first().click();
        await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCount).toBeGreaterThan(10);
    });
});

// ======== CI Seed Model (no PMX file needed) ========
test.describe("CI: Seed model (programmatic mesh)", { tag: ["@webgl"] }, () => {
    test("createTestMesh adds mesh to scene and FPS ≥ 30", async ({ wailsPage: page }) => {
        const meshCount = await loadSeedModel(page);
        expect(meshCount).toBeGreaterThan(0);
        // FPS proves real WebGL rendering is happening
        const fps = await page.evaluate(() => (window as any).__scene.fps);
        expect(fps).toBeGreaterThanOrEqual(30);
        await clearSeedModel(page);
    });
});
