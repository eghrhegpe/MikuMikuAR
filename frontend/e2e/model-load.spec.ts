/**
 * E2E: 核心旅程 — 模型加载
 *
 * 双模式：
 * - @dom (vitePage): seed model (createTestMesh) 验证 Babylon 场景基础健康度，
 *   不依赖 Wails 文件访问，可在 CI 上稳定运行。
 * - @webgl (wailsPage): 真实 PMX 模型加载，需要 Wails + WebView2。
 *
 * 断言基于 window.__scene 数值钩子（见 ADR-060 Phase 0），不依赖像素截图。
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel, loadSeedModel, clearSeedModel } from "./helpers";

// ======== @dom: Seed model (programmatic mesh, no Wails needed) ========
test.describe("核心旅程: Seed model (@dom, vitePage)", { tag: ["@dom"] }, () => {
    test("createTestMesh adds mesh to scene", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        const meshCount = await loadSeedModel(page);
        expect(meshCount).toBeGreaterThan(0);
        await clearSeedModel(page);
    });

    test("clearTestMeshes removes seed meshes", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        const beforeCount = await page.evaluate(() => (window as any).__scene.meshCount);
        await page.evaluate(async () => (window as any).__scene.createTestMesh());
        const afterCreate = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(afterCreate).toBeGreaterThan(beforeCount);
        await clearSeedModel(page);
        const afterClear = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(afterClear).toBeLessThan(afterCreate);
    });
});

// ======== @webgl: Real model loading (needs Wails + WebGL) ========
test.describe("核心旅程: 真实模型加载 (@webgl, wailsPage)", { tag: ["@webgl"] }, () => {
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
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await page.waitForSelector('[data-testid^="actor:model"]', { timeout: 5000 });
        const name = (await page.locator('[data-testid^="actor:model"]').first().innerText()).trim();
        await page.locator('[data-testid^="actor:model"]', { hasText: name }).first().click();
        await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCount).toBeGreaterThan(10);
    });
});

// ======== CI Seed Model (@webgl only, for FPS validation) ========
test.describe("CI: Seed model FPS validation (@webgl)", { tag: ["@webgl"] }, () => {
    test("createTestMesh + FPS ≥ 30 (real WebGL rendering)", async ({ wailsPage: page }) => {
        const meshCount = await loadSeedModel(page);
        expect(meshCount).toBeGreaterThan(0);
        const fps = await page.evaluate(() => (window as any).__scene.fps);
        expect(fps).toBeGreaterThanOrEqual(30);
        await clearSeedModel(page);
    });
});