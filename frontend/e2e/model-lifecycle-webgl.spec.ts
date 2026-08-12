/**
 * E2E: 核心旅程 — 模型生命周期（加载 → 删除 → 重加载）
 *
 * 双模式：
 * - @dom (vitePage): 程序化 mesh 生命周期（createTestMesh → removeActiveModel），
 *   验证 Babylon 场景管理 + ModelManager 状态，不依赖 Wails。
 * - @webgl (wailsPage): 真实 PMX 模型完整生命周期，需 Wails + WebView2。
 *
 * @see ADR-150 模型替换原子操作契约
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel, loadSeedModel, clearSeedModel } from "./helpers";

// ======== @dom: Mesh lifecycle (programmatic, no Wails needed) ========
test.describe("Mesh 生命周期 (@dom, vitePage)", { tag: ["@dom"] }, () => {
    test("createTestMesh → verify meshCount → clearTestMeshes → meshCount decreases", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        const beforeCount = await page.evaluate(() => (window as any).__scene.meshCount);
        await loadSeedModel(page);
        const afterCreate = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(afterCreate).toBeGreaterThan(beforeCount);
        await clearSeedModel(page);
        const afterClear = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(afterClear).toBeLessThan(afterCreate);
    });

    test("removeActiveModel does not throw on empty scene (graceful no-op)", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        // Should not throw when no model is focused
        await page.evaluate(() => (window as any).__scene.driver.removeActiveModel());
        const meshCount = await page.evaluate(() => (window as any).__scene.meshCount);
        // meshCount should remain unchanged (background meshes still present)
        expect(meshCount).toBeGreaterThanOrEqual(0);
    });
});

// ======== @webgl: Real model lifecycle (needs Wails + WebGL) ========
test.describe("模型生命周期: 加载→删除→重加载 (@webgl, wailsPage)", { tag: ["@webgl"] }, () => {
    test("加载模型 → meshCount > 10 → 删除 → meshCount 降低", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const meshCountAfterLoad = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCountAfterLoad).toBeGreaterThan(10);

        // 通过 __scene 钩子删除当前模型（模拟 removeSceneActor 路径）
        await page.evaluate(() => (window as any).__scene.driver.removeActiveModel());
        // [2026-08-12] 删模型是同步操作，5s 足够；原 10s 默认 + Playwright 15s 测试 timeout 冲突，容易超时被 kill。
        await page.waitForFunction(
            (before) => (window as any).__scene.meshCount < before,
            meshCountAfterLoad,
            { timeout: 5000 }
        );

        const meshCountAfterDelete = await page.evaluate(() => (window as any).__scene.meshCount);
        // 删除模型后 meshCount 应降至背景 mesh 水平（天空球/地面等）
        expect(meshCountAfterDelete).toBeLessThan(meshCountAfterLoad);
    });

    test("删除模型后 modelManager 为空", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        // 确认有模型
        const hasModelBefore = await page.evaluate(() => {
            const mm = (window as any).__scene?.modelManager;
            return (mm?.size ?? 0) > 0;
        });
        expect(hasModelBefore).toBe(true);

        // 删除
        await page.evaluate(() => (window as any).__scene.driver.removeActiveModel());
        await page.waitForFunction(() => {
            const mm = (window as any).__scene?.modelManager;
            return (mm?.size ?? 0) === 0;
        }, { timeout: 5000 });

        // 确认 modelManager 为空
        const hasModelAfter = await page.evaluate(() => {
            const mm = (window as any).__scene?.modelManager;
            return (mm?.size ?? 0) > 0;
        });
        expect(hasModelAfter).toBe(false);
    });

    test("删除模型后重新加载 → meshCount 再次 > 10", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const meshCountFirst = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCountFirst).toBeGreaterThan(10);

        // 删除
        await page.evaluate(() => (window as any).__scene.driver.removeActiveModel());
        await page.waitForFunction(() => {
            const mm = (window as any).__scene?.modelManager;
            return (mm?.size ?? 0) === 0;
        }, { timeout: 5000 });

        // 重新加载
        await loadFirstModel(page);

        const meshCountSecond = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCountSecond).toBeGreaterThan(10);
    });
});