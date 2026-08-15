/**
 * E2E DOM-only test for the motion playback controls.
 *
 * Dual focus:
 *   1. Verify the bottom playback bar DOM elements (static HTML) exist
 *      and stay hidden until a motion starts.
 *   2. Verify the motion popup empty-state guidance renders when no
 *      motion is loaded.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 *
 * @see index.html — #playbackBar / #btnPlayPause / #btnLoopToggle / #seekBar / #timeDisplay
 * @see motion-root-ui.ts — buildMotionRootItems() empty-state row
 */
import { test, expect } from "./wails-fixture";

test.describe("Motion — Playback Controls (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test("底部播放栏: DOM 元素存在", async ({ vitePage: page }) => {
        // 底部播放栏是 index.html 静态元素，默认 display:none，但始终在 DOM 中。
        // toHaveCount(1) 断言元素存在于文档中，无视可见性；再显式验证默认隐藏。
        await expect(page.locator("#playbackBar")).toHaveCount(1);
        await expect(page.locator("#playbackBar")).toBeHidden();
        await expect(page.locator("#btnPlayPause")).toHaveCount(1);
        await expect(page.locator("#btnLoopToggle")).toHaveCount(1);
        await expect(page.locator("#seekBar")).toHaveCount(1);
        await expect(page.locator("#timeDisplay")).toHaveCount(1);
        // 进度填充条是 seekBar 的子元素
        await expect(page.locator("#seekProgress")).toHaveCount(1);
    });

    test("动作弹窗: 空态引导提示渲染", async ({ vitePage: page }) => {
        // #app.inert 已由 helpers.installOverlayGuards 统一清理。
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 无已加载动作时，根级渲染空态引导行。当前该行未声明语义化 rowKey，
        // menu.ts 自动推导为 `action:`（kind:action + target 为空）；待主模型在
        // motion-root-ui.ts 补 `motion:empty-hint` 后应改用语义 testid。
        await expect(page.getByTestId("action:")).toBeVisible();
    });
});
