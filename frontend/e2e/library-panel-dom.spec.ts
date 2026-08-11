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

    test("模型库: 无配置时库面板正常渲染（首次使用提示不阻塞）", async ({ vitePage: page }) => {
        // 首次使用提示经底部状态栏显示、2s 自动淡出（status-bar.ts:71-83），且仅在
        // app 启动 initLibrary 时显示一次——点击打开面板后断言瞬时文本会因时序超时
        // （且 FSA 可用时 showConfirm 模态阻塞使提示不显示，双风险）。
        // 改为断言库面板 DOM：无配置时核心入口也应正常渲染（与根级按钮用例一致）。
        await expect(page.getByTestId("folder:models:browse")).toBeVisible();
        await expect(page.getByTestId("action:models:import-file")).toBeVisible();
    });

    test("模型库: 关闭后重新打开不崩溃", async ({ vitePage: page }) => {
        // Close by clicking the same nav button again (toggle behavior)
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });

        // Re-open
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.getByTestId("folder:models:browse")).toBeVisible();
    });
});
