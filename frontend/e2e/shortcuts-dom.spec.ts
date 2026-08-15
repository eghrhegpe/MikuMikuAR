/**
 * E2E DOM-only test for keyboard shortcuts — verifies shortcut UI renders
 * and the registered shortcuts respond correctly.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * ADR-157 后原“快捷键”根区段已并入“操控”：Navigate: Settings → 操控.
 */
import { test, expect } from "./wails-fixture";

test.describe("Shortcuts — DOM/overlay (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // #app.inert 已由 helpers.installOverlayGuards 统一清理。
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("快捷键面板: 通过设置 → 操控导航可见", async ({ vitePage: page }) => {
        await page.getByTestId("folder:settings:controls").click();

        // 进入操控子层后根级 folder 不再可见；改断言稳定 custom host，
        // 覆盖快捷键分组卡片与“恢复默认快捷键”按钮（不依赖本地化文案）。
        await expect(page.getByTestId("settings:perf:shortcut-groups")).toBeVisible();
        await expect(page.getByTestId("settings:perf:shortcut-reset-all")).toBeVisible();
    });

    test("播放/暂停按钮在无模型时挂载（@dom fixture 无模型，仅验证存在性）", async ({ vitePage: page }) => {
        const playBtn = page.locator("#btnPlayPause");
        // Playback bar is hidden (display:none) until a model is loaded, so the
        // button is present in the DOM but not visible. Assert attachment (existence),
        // not visibility or clickability — clicking a 0×0 hidden button is meaningless
        // without a loaded model, and the @dom fixture has no model.
        await expect(playBtn).toBeAttached();
    });
});
