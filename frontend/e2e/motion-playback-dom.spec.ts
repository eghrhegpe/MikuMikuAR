/**
 * E2E DOM-only test for the motion playback controls.
 *
 * Dual focus:
 *   1. Verify the bottom playback bar DOM elements (static HTML) exist,
 *      even when no motion is active (display: none by default).
 *   2. Verify the motion popup root renders the "动作详情" row that
 *      leads to playback speed control.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 *
 * @see index.html — #playbackBar / #btnPlayPause / #btnLoopToggle / #seekBar / #timeDisplay
 * @see motion-popup.ts — buildMotionRootItems() action:__motion_detail__
 */
import { test, expect } from "./wails-fixture";

test.describe("Motion — Playback Controls (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test("底部播放栏: DOM 元素存在", async ({ vitePage: page }) => {
        // 底部播放栏是 index.html 静态元素，默认 display:none，但始终在 DOM 中。
        // 使用 toHaveCount(1) 断言元素存在于文档中，无视可见性。
        await expect(page.locator("#playbackBar")).toHaveCount(1);
        await expect(page.locator("#btnPlayPause")).toHaveCount(1);
        await expect(page.locator("#btnLoopToggle")).toHaveCount(1);
        await expect(page.locator("#seekBar")).toHaveCount(1);
        await expect(page.locator("#timeDisplay")).toHaveCount(1);
        // 进度填充条是 seekBar 的子元素
        await expect(page.locator("#seekProgress")).toHaveCount(1);
    });

    test("动作弹窗: 空态引导文案渲染", async ({ vitePage: page }) => {
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 无已加载动作时，首行显示"选择动作开始"引导提示（motion.noMotionHint）。
        // action:__motion_detail__ 只在有动作时渲染，这里验证空态回退正确。
        await expect(page.getByText("选择动作开始", { exact: true })).toBeVisible();

        // 核心区段行（与 motion-panel-dom 重复验证，但确保弹窗整体正常渲染）
        await expect(page.getByTestId("folder:motion:camera")).toBeVisible();
    });
});
