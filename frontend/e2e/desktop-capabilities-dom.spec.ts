/**
 * E2E DOM-only test — 桌面能力门控验证 (@dom)
 *
 * 在 vitePage（无 Wails 运行时）下验证桌面端能力门控的 DOM 入口：
 *   1. 底部导航全集（模型/动作/场景/环境/设置/广场）
 *   2. 场景面板舞台区段
 *   3. 模型库导入/重扫入口
 *   4. 设置 resources / graphics AA
 *
 * 注意：vitePage 下走 browser-adapter（无 Wails runtime），GetCapabilities 返回
 * 默认值。本 spec 验证的是 DOM 结构是否存在对应的 UI 入口，而非真实能力值。
 * 真实能力验证在 @webgl 模式（含 Wails runtime）中通过 wails-bindings 合约测试覆盖。
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 */
import { test, expect } from "./wails-fixture";

test.describe("Desktop Capabilities — DOM 入口 (@dom)", { tag: ["@dom"] }, () => {
    test("nav 按钮全集: 模型/动作/场景/环境/设置/广场 均可见", async ({ vitePage: page }) => {
        await expect(page.locator("#btnMainAction")).toBeVisible();
        await expect(page.locator("#btnMotionPopup")).toBeVisible();
        await expect(page.locator("#btnScene")).toBeVisible();
        await expect(page.locator("#btnEnv")).toBeVisible();
        await expect(page.locator("#btnSettings")).toBeVisible();
        await expect(page.locator("#btnPlaza")).toBeVisible();
    });

    test("场景面板包含舞台区段（桌面端场景控制入口）", { tag: ["@overlay"] }, async ({ vitePage: page }) => {
        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 舞台区段在场景面板中可见
        await expect(page.getByTestId("folder:scene:render:stage")).toBeVisible();
    });

    test("模型库: 导入文件入口可见（桌面端有文件系统访问）", { tag: ["@overlay"] }, async ({ vitePage: page }) => {
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        await expect(page.getByTestId("action:models:import-file")).toBeVisible();
    });

    test("模型库: 重扫按钮可见", { tag: ["@overlay"] }, async ({ vitePage: page }) => {
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        await expect(page.getByTestId("action:models:rescan")).toBeVisible();
    });

    test("设置面板: 模型库路径区段可见", { tag: ["@overlay"] }, async ({ vitePage: page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 原 folder:settings:library 在 settings.ts 根项不存在（settings.ts:57-99 仅有
        // appearance/graphics/controls/resources/downloads/media/system/about）；
        // 原 folder:settings:paths 也不存在。统一改用真实存在的 resources 区段
        // （含资源路径/库排序，面板实现见 settings-resources.ts）
        await expect(page.getByTestId("folder:settings:resources")).toBeVisible();
    });

    test("设置面板: 抗锯齿档位选择器可见（AA 唯一入口）", { tag: ["@overlay"] }, async ({ vitePage: page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await page.getByTestId("folder:settings:graphics").click();

        await expect(page.getByTestId("settings:graphics:aa")).toBeVisible();
    });
});
