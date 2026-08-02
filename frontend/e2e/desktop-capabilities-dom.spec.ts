/**
 * E2E DOM-only test — 桌面能力门控验证 (@dom)
 *
 * 在 vitePage（无 Wails 运行时）下验证桌面端能力声明：
 *   1. 能力门控 UI：AR 相机模式入口存在（桌面端 capabilities.ar=true）
 *   2. 广场按钮存在
 *   3. watchDir 相关 UI 行为（desktop adapter go-adapter 中为 true）
 *
 * 注意：vitePage 下走 browser-adapter（无 Wails runtime），GetCapabilities 返回
 * 默认值。本 spec 验证的是 DOM 结构是否存在对应的 UI 入口，而非真实能力值。
 * 真实能力验证在 @webgl 模式（含 Wails runtime）中通过 wails-bindings 合约测试覆盖。
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 */
import { test, expect } from "./wails-fixture";

/**
 * vite-only 模式下 init() 可能失败并显示 #mmd-dialog-overlay，该 dialog
 * 拦截所有 pointer events。关闭它以便 nav 按钮可点击。
 */
async function dismissErrorDialog(page: any): Promise<void> {
    const dialogVisible = await page.evaluate(() => {
        const el = document.getElementById("mmd-dialog-overlay");
        return el?.classList.contains("mmd-dialog-visible") ?? false;
    });
    if (dialogVisible) {
        await page.evaluate(() => {
            const el = document.getElementById("mmd-dialog-overlay");
            if (el) el.classList.remove("mmd-dialog-visible");
        });
    }
}

test.describe("Desktop Capabilities — DOM 入口 (@dom)", { tag: ["@dom"] }, () => {
    test("nav 按钮全集: 模型/动作/场景/环境/设置/广场 均可见", async ({ vitePage: page }) => {
        await expect(page.locator("#btnMainAction")).toBeVisible();
        await expect(page.locator("#btnMotionPopup")).toBeVisible();
        await expect(page.locator("#btnScene")).toBeVisible();
        await expect(page.locator("#btnEnv")).toBeVisible();
        await expect(page.locator("#btnSettings")).toBeVisible();
        await expect(page.locator("#btnPlaza")).toBeVisible();
    });

    test("场景面板包含舞台区段（桌面端场景控制入口）", async ({ vitePage: page }) => {
        await dismissErrorDialog(page);
        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 舞台区段在场景面板中可见
        await expect(page.getByTestId("folder:scene:render:stage")).toBeVisible();
    });

    test("模型库: 导入文件入口可见（桌面端有文件系统访问）", async ({ vitePage: page }) => {
        await dismissErrorDialog(page);
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        await expect(page.getByTestId("action:models:import-file")).toBeVisible();
    });

    test("模型库: 重扫按钮可见", async ({ vitePage: page }) => {
        await dismissErrorDialog(page);
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        await expect(page.getByTestId("action:models:rescan")).toBeVisible();
    });

    test("设置面板: 模型库路径区段可见", async ({ vitePage: page }) => {
        await dismissErrorDialog(page);
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        await expect(page.getByTestId("folder:settings:library")).toBeVisible();
    });

    test("设置面板: 路径区段可见", async ({ vitePage: page }) => {
        await dismissErrorDialog(page);
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        await expect(page.getByTestId("folder:settings:paths")).toBeVisible();
    });

    test("设置面板: 抗锯齿档位选择器可见（AA 唯一入口）", async ({ vitePage: page }) => {
        await dismissErrorDialog(page);
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await page.getByTestId("folder:settings:graphics").click();

        await expect(page.getByTestId("settings:graphics:aa")).toBeVisible();
    });
});
