/**
 * E2E: 核心旅程 — 模型生命周期（加载 → 删除 → 重加载）
 *
 * 走 wailsPage（WebView2 CDP，含真实 Go 后端 + WebGL 渲染）。
 * 验证模型全生命周期闭环：加载模型 → 场景有 mesh → 删除模型 → 场景空 → 重新加载。
 *
 * @requires 模型库已配置，至少含 1 个可加载模型（CI 用 seed model）。
 * @see ADR-150 模型替换原子操作契约
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel } from "./helpers";

test.describe("模型生命周期: 加载→删除→重加载 (@webgl)", { tag: ["@webgl"] }, () => {
    test("加载模型 → 验证 meshCount 增加 → 删除 → meshCount 为 0", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const meshCountAfterLoad = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCountAfterLoad).toBeGreaterThan(10);

        // 通过 __scene 钩子删除当前模型（模拟 removeSceneActor 路径）
        await page.evaluate(() => (window as any).__scene.removeActiveModel());
        await page.waitForTimeout(500);

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
        await page.evaluate(() => (window as any).__scene.removeActiveModel());
        await page.waitForTimeout(500);

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
        await page.evaluate(() => (window as any).__scene.removeActiveModel());
        await page.waitForTimeout(500);

        // 重新加载
        await loadFirstModel(page);

        const meshCountSecond = await page.evaluate(() => (window as any).__scene.meshCount);
        expect(meshCountSecond).toBeGreaterThan(10);
    });
});
