/**
 * E2E DOM-only test for the Motion popup — verifies motion UI renders.
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 * Motion popup opens via #btnMotionPopup → #sceneOverlay.
 */
import { test, expect } from "./wails-fixture";

test.describe("Motion — DOM/overlay (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        // [ADR-229 §8] vitePage 每 test 全新浏览器实例，localStorage 本为空，不调用 clear()
        // #app.inert 已由 helpers.installOverlayGuards 统一清理，无需 spec 再 workaround。
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("动作弹窗: 标题与核心区段渲染", async ({ vitePage: page }) => {
        // 使用 slide-title 类 + motion-popup wrapper 定位弹窗标题：既避免匹配导航按钮的
        // nav-label，也避免与其他弹窗的 slide-title 混淆。不断言具体文案，因为标题随
        // 当前语言变化（zh: 动作 / en: Motion），hasText 子串匹配会因 locale 脆弱。
        await expect(
            page.locator('#sceneOverlay [data-menu-id="motion-popup"] .slide-title')
        ).toBeVisible();
        // Motion root sections (post modularize: 相机 / 浏览音乐库 / 程序化动作 / 视线追踪).
        // 动作绑定 / 姿势库 only appear after drilling into a specific model.
        // 程序化动作入口的稳定 testid 来自 rowKey 自动推导：folder:motion:proc-library
        // （target=motion:proc-library，见 motion-root-ui.ts），旧 folder:motion:procmotion 已过时。
        await expect(page.getByTestId("folder:motion:camera")).toBeVisible();
        await expect(page.getByTestId("action:__music_browse__")).toBeVisible();
        await expect(page.getByTestId("folder:motion:proc-library")).toBeVisible();
        await expect(page.getByTestId("folder:motion:gaze")).toBeVisible();
    });

    test("动作弹窗: 相机模式可交互", async ({ vitePage: page }) => {
        await page.getByTestId("folder:motion:camera").click();
        // FOV 滑块行（稳定 id，motion-camera-levels.ts:129）
        await expect(page.getByTestId("camera:main:fov")).toBeVisible();
        // modeSlider 是滑块控件（addModeSlider），仅显示当前值，选项标签不全量渲染，
        // 故不能用 getByText 命中选项。两个 modeSlider（控制方案 + 行为）通过
        // motion-camera-levels.ts 注入的稳定 testid 定位，不依赖 .cs-top 数量或 DOM 顺序。
        // 注：切换会触发 setCameraBehavior/setCameraControl 的场景副作用，在 vite 纯模式下
        // 缺 Wails runtime 会致页面崩溃，故 modeSlider 只验证 role/aria/focus，
        // 切换行为本身的覆盖留给 wailsPage 模式或单测。
        const controlSlider = page.getByTestId("camera:main:control").locator(".cs-top");
        const behaviorSlider = page.getByTestId("camera:behavior:mode").locator(".cs-top");
        await expect(controlSlider).toHaveAttribute("role", "slider");
        await expect(behaviorSlider).toHaveAttribute("role", "slider");
        await expect(controlSlider).toHaveAttribute("aria-valuenow", /\d+/);
        await expect(behaviorSlider).toHaveAttribute("aria-valuenow", /\d+/);
        await controlSlider.focus();
        await behaviorSlider.focus();
        // FOV 数字滑块：用真实键盘步进验证可交互（不切换 modeSlider 避免 Wails 场景副作用）
        const fovSlider = page.getByTestId("camera:main:fov").locator(".cs-bar[role='slider']");
        const fovBefore = await fovSlider.getAttribute("aria-valuenow");
        await fovSlider.press("ArrowRight");
        await expect(fovSlider).not.toHaveAttribute("aria-valuenow", fovBefore ?? "");
        await expect(page.getByTestId("camera:main:fov")).toBeVisible();
    });

    test("动作弹窗: 返回上级不崩溃", async ({ vitePage: page }) => {
        // 监听未捕获异常：只断言 overlay 关闭不足以证明“返回/重开不崩溃”。
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        // Navigate into a sub-level then back
        await page.getByTestId("folder:motion:camera").click();
        // 用稳定 id 锚定相机层级已渲染（替代原 camera:main-mode 动态值断言）
        await expect(page.getByTestId("camera:main:fov")).toBeVisible();

        // 真实返回上级：点 .slide-back 回根，而不是只关闭 overlay。
        await page.locator('#sceneOverlay [data-menu-id="motion-popup"] .slide-back').click();
        await expect(page.getByTestId("folder:motion:camera")).toBeVisible();

        // 关闭后再打开，确认菜单栈能复位到根且未产生未捕获异常。
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.getByTestId("folder:motion:camera")).toBeVisible();
        expect(pageErrors).toEqual([]);
    });
});
