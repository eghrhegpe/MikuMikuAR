/**
 * E2E DOM-only test for the Motion popup — verifies motion UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Motion popup opens via #btnMotionPopup → #sceneOverlay.
 */
import { test, expect } from "./wails-fixture";

test.describe("Motion — DOM/overlay (vitePage, @dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // Isolate: clear localStorage so ProcMotion state, BPM, or playback position
        // from a previous test don't leak into the next one.
        await page.evaluate(() => localStorage.clear());
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("动作弹窗: 标题与核心区段渲染", async ({ vitePage: page }) => {
        // 使用 slide-title 类定位弹窗标题，避免匹配导航按钮的 nav-label
        await expect(page.locator('.slide-title').filter({ hasText: '动作' })).toBeVisible();
        // Motion root sections (post modularize: 相机 / 浏览音乐库 / 程序化动作 / 视线追踪).
        // 动作绑定 / 姿势库 only appear after drilling into a specific model.
        await expect(page.getByTestId("folder:motion:camera")).toBeVisible();
        await expect(page.getByTestId("action:__music_browse__")).toBeVisible();
        await expect(page.getByTestId("folder:motion:procmotion")).toBeVisible();
        await expect(page.getByTestId("folder:motion:gaze")).toBeVisible();
    });

    test("动作弹窗: 相机模式可交互", async ({ vitePage: page }) => {
        await page.getByTestId("folder:motion:camera").click();
        // FOV 滑块行（稳定 id，motion-camera-levels.ts:107）
        await expect(page.getByTestId("camera:main:fov")).toBeVisible();
        // modeSlider 是滑块控件（addModeSlider），仅显示当前值，选项标签不全量渲染，
        // 故不能用 getByText 命中选项。验证两个 modeSlider（控制方案 + 行为）的 listbox role
        // 均渲染且可 focus，即满足「可交互」契约。
        // 注：切换会触发 setCameraBehavior/setCameraControl 的场景副作用，在 vite 纯模式下
        // 缺 Wails runtime 会致页面崩溃，故切换行为本身的覆盖留给 wailsPage 模式或单测。
        const sliders = page.locator(".cs-top[role='listbox']");
        await expect(sliders).toHaveCount(2);
        await sliders.nth(0).focus();
        await sliders.nth(1).focus();
        await expect(page.getByTestId("camera:main:fov")).toBeVisible();
    });

    test("动作弹窗: 返回上级不崩溃", async ({ vitePage: page }) => {
        // Navigate into a sub-level then back
        await page.getByTestId("folder:motion:camera").click();
        // 用稳定 id 锚定相机层级已渲染（替代原 camera:main-mode 动态值断言）
        await expect(page.getByTestId("camera:main:fov")).toBeVisible();
        // Close overlay by clicking the same nav button again (toggle behavior)
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
    });
});
