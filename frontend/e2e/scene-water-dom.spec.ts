/**
 * E2E DOM-only test for the Scene → Water (水面) panel.
 *
 * Water moved from Environment to Scene (scene-menu.ts root).
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Reuses buildWaterLevel() from env-water-levels.ts.
 *
 * [ADR-229 §8 去重] 仅保留 schema-driven 不覆盖的独有断言：
 * 预设芯片（custom 渲染，无 schema 节点）；其余滑块/开关断言
 * 由 e2e/schema-driven.spec.ts 自动覆盖（env:water 面板）。
 *
 * @see scene-menu.ts — 'scene:water' → buildWaterLevel
 * @see env-water-levels.ts — buildWaterLevel()
 */
import { test, expect } from "./wails-fixture";

test.describe("Scene — Water Panel (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // [ADR-229 §8 修复] ① 不调 localStorage.clear()：vitePage 每 test 全新浏览器实例，
        // localStorage 本就为空；clear() 会触发应用 storage 监听导致页面导航、
        // 销毁执行上下文（曾报 "Execution context was destroyed"）。
        // ② 真实 locator.click：vitePage fixture 已强制移除 app-booting 并保持
        // #loading pointer-events:none，命中测试可通过；若被拦截会失败并暴露 app bug。
        // ③ #app.inert 已由 helpers.installOverlayGuards 统一清理。
        await page.locator("#btnScene").click();
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        // Navigate into 水面 sub-level (folder in scene root with headerToggle)
        await page.getByTestId("folder:scene:water").click();
    });

    test("水面面板: 预设芯片渲染", async ({ vitePage: page }) => {
        // 5 种水预设芯片（纯文本 button，custom 渲染，schema-driven 不覆盖 →
        // 本文件独有断言）。
        // [ADR-229 §8 修复] 原先 getByText("Calm"/...) 依赖英文文案，在 zh-CN/ja/ko/zh-TW
        // locale 下必失败；现改用 env-water-levels.ts 注入的稳定 testid，locale 无关。
        await expect(page.getByTestId("env:water:preset:calm")).toBeVisible();
        await expect(page.getByTestId("env:water:preset:ripple")).toBeVisible();
        await expect(page.getByTestId("env:water:preset:ocean")).toBeVisible();
        await expect(page.getByTestId("env:water:preset:storm")).toBeVisible();
        await expect(page.getByTestId("env:water:preset:tropical")).toBeVisible();
    });
});
