/**
 * E2E: 核心旅程 — 模型生命周期（加载 → 删除 → 重加载）
 *
 * 双模式：
 * - @dom (vitePage): 程序化 mesh 生命周期（createTestMesh → clearTestMeshes）
 *   + removeActiveModel 空场景 no-op，验证 Babylon 场景管理 + ModelManager 状态，不依赖 Wails。
 * - @webgl (wailsPage): 真实 PMX 模型完整生命周期，需 Wails + WebView2。
 *
 * @see ADR-150 模型替换原子操作契约
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel, loadSeedModel, clearSeedModel } from "./helpers";

// ======== @dom: Mesh lifecycle (programmatic, no Wails needed) ========
test.describe("Mesh 生命周期 (@dom, vitePage)", { tag: ["@dom"] }, () => {
    test("createTestMesh → testMeshCount=1 → clearTestMeshes → testMeshCount=0", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        // 用专用 seed mesh 计数做主断言，避免背景/系统 mesh 异步增删导致总 meshCount 误报。
        await loadSeedModel(page);
        const afterCreate = await page.evaluate(() => (window as any).__scene.testMeshCount);
        expect(afterCreate).toBe(1);
        await clearSeedModel(page);
        const afterClear = await page.evaluate(() => (window as any).__scene.testMeshCount);
        expect(afterClear).toBe(0);
    });

    test("removeActiveModel does not throw on empty scene (graceful no-op)", async ({ vitePage: page }) => {
        await waitForSceneHook(page);
        const before = await page.evaluate(() => ({
            meshCount: (window as any).__scene.meshCount,
            modelCount: (window as any).__scene.modelManager?.size ?? 0,
            focusedModelId: (window as any).__scene.modelManager?.focusedModelId ?? null,
        }));
        // Should not throw when no model is focused
        await page.evaluate(() => (window as any).__scene.driver.removeActiveModel());
        const after = await page.evaluate(() => ({
            meshCount: (window as any).__scene.meshCount,
            modelCount: (window as any).__scene.modelManager?.size ?? 0,
            focusedModelId: (window as any).__scene.modelManager?.focusedModelId ?? null,
        }));
        // No-op must not mutate model registry/focus, and must not remove meshes.
        // >= 而非 === 是为了容忍 NullEngine 下后台 mesh 异步新增的时序噪声。
        expect(after.modelCount).toBe(before.modelCount);
        expect(after.focusedModelId).toBe(before.focusedModelId);
        expect(after.meshCount).toBeGreaterThanOrEqual(before.meshCount);
    });
});

// ======== @webgl: Real model lifecycle (needs Wails + WebGL) ========
test.describe("模型生命周期: 加载→删除→重加载 (@webgl, wailsPage)", { tag: ["@webgl"] }, () => {
    // 所有 @webgl 用例共享同一个 Wails WebView2 页面；串行避免并行加载/删除互相踩踏。
    test.describe.configure({ mode: "serial" });

    test.beforeEach(async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        // 清掉上个测试或外部遗留模型，保证每个用例从空 modelManager 开始。
        await page.evaluate(() => {
            const mm = (window as any).__scene?.modelManager;
            if (!mm) return;
            for (const id of [...mm.modelRegistry.keys()]) {
                mm.remove(id);
            }
        });
    });

    test.afterEach(async ({ wailsPage: page }) => {
        // 失败/最后一个用例也清理，避免模型残留影响后续 spec 或 retry。
        await page.evaluate(() => {
            const mm = (window as any).__scene?.modelManager;
            if (!mm) return;
            for (const id of [...mm.modelRegistry.keys()]) {
                mm.remove(id);
            }
        }).catch(() => {});
    });

    test("加载模型 → meshCount > 10 → 删除 → meshCount 降低", async ({ wailsPage: page }) => {
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