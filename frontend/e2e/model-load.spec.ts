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
import type { Page } from "@playwright/test";
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadSeedModel, clearSeedModel } from "./helpers";

/** 打开模型库 → 进入“加载模型”浏览层（当前 DOM 契约：folder:models:browse）。 */
async function openLibraryBrowse(page: Page): Promise<void> {
    await page.click("#btnMainAction");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    await page.getByTestId("folder:models:browse").click({ timeout: 5000 });
    await page.waitForSelector('[data-testid^="model:"]', { timeout: 5000 });
}

/** 进入模型库浏览层并加载第一个真实模型条目。 */
async function loadFirstModelFromLibrary(page: Page): Promise<void> {
    await openLibraryBrowse(page);
    await page.locator('[data-testid^="model:"]').first().click();
    await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
}

// ======== @dom: Seed model (programmatic mesh, no Wails needed) ========
test.describe("核心旅程: Seed model (@dom, vitePage)", { tag: ["@dom"] }, () => {
    test("createTestMesh adds mesh and clearTestMeshes returns to baseline", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        await clearSeedModel(page);
        const beforeCount = await page.evaluate(() => (window as any).__scene.testMeshCount);
        await page.evaluate(async () => (window as any).__scene.driver.createTestMesh());
        const afterCreate = await page.evaluate(() => (window as any).__scene.testMeshCount);
        expect(afterCreate).toBeGreaterThan(beforeCount);
        await clearSeedModel(page);
        const afterClear = await page.evaluate(() => (window as any).__scene.testMeshCount);
        expect(afterClear).toBe(beforeCount);
    });
});

// ======== @webgl: Real model loading (needs Wails + WebGL) ========
test.describe("核心旅程: 真实模型加载 (@webgl, wailsPage)", { tag: ["@webgl"] }, () => {
    // @webgl 共享同一个 Wails WebView2 页面：串行 + 每个用例后清空模型，避免状态残留。
    test.describe.configure({ mode: "serial" });

    test.afterEach(async ({ wailsPage: page }) => {
        await page.evaluate(() => {
            const mm = (window as any).__scene?.modelManager;
            if (!mm) return;
            for (const inst of mm.getAll()) mm.remove(inst.id);
        }).catch(() => {});
    });

    test("加载首个模型后，meshCount 显著增加且渲染循环活跃（fps > 0）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModelFromLibrary(page);

        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCount).toBeGreaterThan(10);

        // 加载后首帧可能未渲染；用 waitForFunction 等渲染循环启动（替代固定 sleep）。
        // 不在此断言 FPS ≥ 30：CI/无 GPU/软件渲染下该阈值属于性能门禁而非功能冒烟，容易 flaky。
        await page.waitForFunction(() => (window as any).__scene?.fps > 0, { timeout: 20000 });
    });

    test("加载模型库首个模型（确定性选择）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await openLibraryBrowse(page);
        await page.locator('[data-testid^="model:"]').first().click();
        await page.waitForFunction(() => (window as any).__scene?.meshCount > 10, { timeout: 20000 });
        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCount).toBeGreaterThan(10);
    });
});

// ======== CI Seed Model (@webgl only, real WebGL rendering smoke) ========
test.describe("CI: Seed model rendering smoke (@webgl)", { tag: ["@webgl"] }, () => {
    test("createTestMesh + 渲染循环活跃（fps > 0, real WebGL rendering）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await clearSeedModel(page);
        const meshCount = await loadSeedModel(page);
        expect(meshCount).toBeGreaterThan(0);
        await page.waitForFunction(() => (window as any).__scene?.fps > 0, { timeout: 10000 });
        await clearSeedModel(page);
        const afterClear = await page.evaluate(() => (window as any).__scene.testMeshCount);
        expect(afterClear).toBe(0);
    });
});
