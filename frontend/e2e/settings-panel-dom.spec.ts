/**
 * E2E DOM-only test for the Settings panel — verifies settings UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Settings opens via #btnSettings → #sceneOverlay (separate overlay element).
 *
 * ADR-157 后设置根区段为 8 个：
 * appearance / graphics / controls / resources / downloads / media / system / about。
 * 旧的 library→resources、performance/rendering→graphics、paths→resources、
 * audio→media、shortcuts→controls。
 */
import { test, expect } from "./wails-fixture";

test.describe("Settings — DOM/overlay (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // [ADR-229 §8] vitePage 每 test 全新浏览器实例，localStorage 本为空，不调用 clear()
        // [workaround] 同 library/motion-panel-dom：纯 Vite 下 FSA 引导可能先弹确认框，
        // dialog 冻结背景会给 #app 留下 inert，导致后续真实 click 被 body 拦截。
        await page.evaluate(() => document.getElementById("app")?.removeAttribute("inert"));
        await page.click("#btnSettings");
        // [doc:e2e] 设置面板使用统一的 #sceneOverlay（非独立 #settingsOverlay）
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("设置面板: 8 个真实根区段渲染", async ({ vitePage: page }) => {
        // 使用 settings-menu wrapper 限定标题，避免匹配导航按钮的 nav-label；不依赖具体语言文案
        await expect(page.locator('[data-menu-id="settings-menu"] .slide-title')).toBeVisible();
        const rootFolders = [
            "folder:settings:appearance",
            "folder:settings:graphics",
            "folder:settings:controls",
            "folder:settings:resources",
            "folder:settings:downloads",
            "folder:settings:media",
            "folder:settings:system",
            "folder:settings:about",
        ];
        for (const testId of rootFolders) {
            await expect(page.getByTestId(testId)).toBeVisible();
        }
    });

    test("设置面板: 操控区段可导航（原快捷键已并入）", async ({ vitePage: page }) => {
        await page.getByTestId("folder:settings:controls").click();
        // 进入子层后根级 folder 不再可见，改断言子层稳定 custom host（不依赖本地化文案）。
        await expect(page.locator('[data-menu-id="settings-menu"] .slide-title')).toBeVisible();
        await expect(page.getByTestId("settings:perf:shortcut-groups")).toBeVisible();
    });

    test("设置面板: 外观区段显示外观/主题相关选项", async ({ vitePage: page }) => {
        await page.getByTestId("folder:settings:appearance").click();
        // 不依赖本地化文本：断言 schema 自定义节点的稳定 testid host。
        await expect(page.locator('[data-menu-id="settings-menu"] .slide-title')).toBeVisible();
        await expect(page.getByTestId("settings:appearance:theme-presets")).toBeVisible();
        await expect(page.getByTestId("settings:appearance:font")).toBeVisible();
    });

    test("设置面板: 关闭后重新打开", async ({ vitePage: page }) => {
        // 仅断言 overlay 重新可见不足以证明“不崩溃”；同时监听未捕获异常。
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        // Close by clicking the same nav button again (toggle behavior)
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });

        // Re-open
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.locator('[data-menu-id="settings-menu"] .slide-title')).toBeVisible();
        await expect(page.getByTestId("folder:settings:appearance")).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});
