/**
 * [doc:adr-176/178] Web 入口 — 能力门控 UI 验证
 *
 * 生产构建（vite preview）下无法 import 源码模块（/src/ 路径不存在），
 * 故改为通过 UI 行为验证 browser-adapter 的能力门控声明：
 *   1. ar === false → 相机模式无 AR 选项（web-smoke 已覆盖，此处交叉验证）
 *   2. plazaWindow === false → 广场无「独立窗口」选项（web-smoke 已覆盖）
 *   3. watchDir === false → 设置-资源 无「下载监听」卡片（visibleWhen 门控）
 *   4. 广场按钮存在（web 端有 plaza 内联模式，无独立窗口）
 *
 * 与 ADR-177 web-smoke 互补：web-smoke 验证首屏，本文件验证能力门控 UI。
 *
 * 运行：npx playwright test --grep "@web" web-capabilities
 * 前置：webServer 自动 build + preview dist-web/（playwright.config.ts 配置）
 */
import { test, expect } from "@playwright/test";
import { gotoWebEntry } from "./helpers";

test.describe("Web Capabilities — 能力门控 UI 验证 (@web)", { tag: ["@web"] }, () => {
    test.beforeEach(async ({ page }) => {
        await gotoWebEntry(page);
    });

    test("能力门控: 相机模式无 AR 选项（ar === false）", async ({ page }) => {
        // AR 门控在动作弹窗的相机控制层：motion:camera → camera:main
        // （场景菜单无相机行，原实现定位 folder:scene:camera 是错误前提 → 每跑必红）
        await page.click("#btnMotionPopup");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });
        await page.getByTestId("folder:motion:camera").click();
        // camera:main 是 custom 节点 id，renderMenu 对 kind:'custom' 不 emit data-testid
        // ——唯一真实锚点是 FOV 滑块 camera:main:fov（与 motion-panel-dom.spec.ts:30 一致）
        await page.waitForSelector('[data-testid="camera:main:fov"]', { timeout: 8000 });

        // AR 选项不应出现在相机模式（capabilities.ar=false 过滤）。
        // 原 text=AR 全页大小写不敏感子串会误红（英文面板 "Cartesian/Standard/Start"
        // 含 ar 子串），且 modeSlider 选项标签不全量渲染本就无法用 getByText 命中
        // （motion-panel-dom.spec.ts:36-37 实证）——改为断言控制方案 listbox 的
        // aria-valuemax=1（仅 orbit/freefly 两项；ar=true 时含 AR 共 3 项 = valuemax 2）
        const controlSlider = page.locator(".cs-top[role='slider']").first();
        await expect(controlSlider).toHaveAttribute("aria-valuemax", "1");
    });

    test("能力门控: 广场无「独立窗口」选项（plazaWindow === false）", async ({ page }) => {
        await page.click("#btnPlaza");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });

        await expect(page.locator('text=独立窗口')).toHaveCount(0);
    });

    test("能力门控: 设置-资源无「下载监听」卡片（watchDir === false）", async ({ page }) => {
        // web 无文件系统监听 → settings-resources 的 resources:watch 卡片
        // （visibleWhen: capabilities().watchDir）不应渲染。
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });

        // 进入资源页签——入口必须存在，否则 fail（原实现 count()>0 才点击，假绿）
        const resourceTab = page.locator('[data-testid="folder:settings:resources"]');
        await expect(resourceTab.first()).toBeVisible();
        await resourceTab.first().click();
        // watchDir=false → 无「下载监听」/「监听下载目录」文案
        await expect(page.locator('text=下载监听')).toHaveCount(0);
        await expect(page.locator('text=监听下载目录')).toHaveCount(0);
    });

    test("广场按钮存在（web 端有内联 plaza，无独立窗口）", async ({ page }) => {
        // ADR-177: web 端有 plaza 按钮，但 plazaWindow 能力为 false
        await expect(page.locator("#btnPlaza")).toBeVisible();
    });

    test("所有 6 个 + 广场 nav 按钮可见", async ({ page }) => {
        const navButtons = [
            "#btnMainAction",
            "#btnMotionPopup",
            "#btnScene",
            "#btnEnv",
            "#btnSettings",
            "#btnPlaza",
        ];
        for (const selector of navButtons) {
            await expect(page.locator(selector)).toBeVisible();
        }
    });
});
