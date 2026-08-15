/**
 * E2E DOM-only test for the Model Library panel — verifies library UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Library opens via #btnMainAction → #sceneOverlay.
 */
import { test, expect } from "./wails-fixture";

test.describe("Library — DOM/overlay (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // [ADR-229 §8] vitePage 每 test 全新浏览器实例，localStorage 本为空，
        // clear() 反而触发应用 storage 监听导致页面导航——不调用。
        // #app.inert 已由 helpers.installOverlayGuards 统一清理，无需 spec 再 workaround。
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("模型库: 根级核心按钮渲染", async ({ vitePage: page }) => {
        // Root-level actions in the model library
        await expect(page.getByTestId("folder:models:browse")).toBeVisible();
        await expect(page.getByTestId("action:models:import-file")).toBeVisible();
        await expect(page.getByTestId("action:models:rescan")).toBeVisible();
        await expect(page.getByTestId("folder:__recent__")).toBeVisible();
        await expect(page.getByTestId("folder:__tags__")).toBeVisible();
    });

    test("模型库: 关闭后重新打开不崩溃", async ({ vitePage: page }) => {
        // 仅断言 overlay 重新可见不足以证明“不崩溃”；同时监听未捕获异常，
        // 关闭/重开期间出现 pageerror 即失败。
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        // Close by clicking the same nav button again (toggle behavior)
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });

        // Re-open
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.getByTestId("folder:models:browse")).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});
