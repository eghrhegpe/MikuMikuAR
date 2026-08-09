/**
 * E2E DOM-only test for the Scene → Water (水面) panel.
 *
 * Water moved from Environment to Scene (scene-menu.ts root).
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Reuses buildWaterLevel() from env-feature-levels.ts.
 *
 * [ADR-229 §8 去重] 仅保留 schema-driven 不覆盖的独有断言：
 * 预设芯片（custom 渲染，无 schema 节点）；其余滑块/开关断言
 * 由 e2e/schema-driven.spec.ts 自动覆盖（env:water 面板）。
 *
 * @see scene-menu.ts — 'scene:water' → buildWaterLevel
 * @see env-feature-levels.ts — buildWaterLevel()
 */
import { test, expect } from "./wails-fixture";

test.describe("Scene — Water Panel (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // [ADR-229 §8 修复] ① 不调 localStorage.clear()：vitePage 每 test 全新浏览器实例，
        // localStorage 本就为空；clear() 会触发应用 storage 监听导致页面导航、
        // 销毁执行上下文（曾报 "Execution context was destroyed"）。
        // ② 用 page.evaluate 触发 click（与 helpers/schema-driven 一致）：原生
        // page.click 会被 vite-only 的 app-booting pointer-events:none 拦截
        // （wails-fixture 注释记载），导致 beforeEach 超时。
        await page.evaluate(() => { document.getElementById("btnScene")?.click(); });
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        // Navigate into 水面 sub-level (folder in scene root with headerToggle)
        await page.evaluate(() => {
            document.querySelector<HTMLElement>('[data-testid="folder:scene:water"]')?.click();
        });
    });

    test("水面面板: 预设芯片渲染", async ({ vitePage: page }) => {
        // 5 种水预设芯片（纯文本 button，无 testId → getByText 回退；
        // custom 渲染，schema-driven 不覆盖 → 本文件独有断言）。
        // [ADR-229 §8 修复] headless Chromium 默认语言为英文（en.ts），
        // 原断言中文（平静/涟漪…）在当前环境必失败，改用运行时语言标签。
        await expect(page.getByText("Calm", { exact: true })).toBeVisible();
        await expect(page.getByText("Ripple", { exact: true })).toBeVisible();
        await expect(page.getByText("Ocean", { exact: true })).toBeVisible();
        await expect(page.getByText("Storm", { exact: true })).toBeVisible();
        await expect(page.getByText("Tropical", { exact: true })).toBeVisible();
    });
});
