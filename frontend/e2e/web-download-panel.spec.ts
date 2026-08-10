/**
 * [doc:adr-181] Web 入口 — 下载管理面板 E2E
 *
 * 验证下载面板的 DOM 渲染与核心交互路径：
 *   1. 模型库面板包含下载管理入口
 *   2. 下载面板区段渲染
 *   3. 下载列表空态处理
 *   4. 下载面板打开/关闭不崩溃
 *
 * 下载管理面板通过 设置 → 下载管理 进入。
 *
 * 运行：npx playwright test --grep "@web" web-download
 * 前置：webServer 自动 build + preview dist-web/（playwright.config.ts 配置）
 */
import { test, expect } from "@playwright/test";
import { gotoWebEntry } from "./helpers";

test.describe("Web Download — 下载管理面板 (@web)", { tag: ["@web"] }, () => {
    test.beforeEach(async ({ page }) => {
        await gotoWebEntry(page);
    });

    test("设置面板包含下载管理入口", async ({ page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 下载管理区段（SETTINGS.DOWNLOADS 注册）——入口必须存在，否则 fail
        // （原实现 if(visible) 条件通过，面板缺失时测试仍绿 = 假绿）
        await expect(page.getByTestId("folder:settings:downloads")).toBeVisible();
    });

    test("下载管理: 打开后不崩溃", async ({ page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        const downloadsEntry = page.getByTestId("folder:settings:downloads");
        await expect(downloadsEntry).toBeVisible();
        await downloadsEntry.click();
        // 面板应保持可见（未崩溃）
        await expect(page.locator("#sceneOverlay")).toHaveClass(/visible/);
    });

    test("模型库: 浏览区段渲染正常", async ({ page }) => {
        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 浏览入口应始终可见（无论是否有模型）
        await expect(page.getByTestId("folder:models:browse")).toBeVisible();

        // 最近打开区段
        await expect(page.getByTestId("folder:__recent__")).toBeVisible();

        // 标签区段
        await expect(page.getByTestId("folder:__tags__")).toBeVisible();
    });

    test("模型库: 打开/关闭/重开不崩溃（稳定性）", async ({ page }) => {
        for (let i = 0; i < 3; i++) {
            await page.click("#btnMainAction");
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
            await expect(page.getByTestId("folder:models:browse")).toBeVisible();

            await page.click("#btnMainAction");
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
        }
    });

    test("设置面板: 打开/关闭/重开不崩溃（稳定性）", async ({ page }) => {
        for (let i = 0; i < 3; i++) {
            await page.click("#btnSettings");
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
            await expect(page.locator(".slide-title").filter({ hasText: "设置" })).toBeVisible();

            await page.click("#btnSettings");
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
        }
    });
});
