/**
 * [doc:adr-181] Web 入口 — 下载管理面板 E2E
 *
 * 验证下载面板的 DOM 渲染与核心交互路径：
 *   1. 设置面板包含下载文件夹入口
 *   2. 下载文件夹区段打开后渲染核心卡片（文件夹 / 扫描 / 导入记录）
 *   3. 模型库浏览区段渲染
 *   4. 设置/模型库打开/关闭稳定性（监听 pageerror，避免“没崩”假绿）
 *
 * 下载管理面板通过 设置 → 下载文件夹 进入。
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

    test("设置面板包含下载文件夹入口", async ({ page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 下载文件夹区段（SETTINGS.DOWNLOADS 注册）——入口必须存在，否则 fail
        // （原实现 if(visible) 条件通过，面板缺失时测试仍绿 = 假绿）
        await expect(page.getByTestId("folder:settings:downloads")).toBeVisible();
    });

    test("下载管理: 打开后渲染下载面板核心卡片", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        const downloadsEntry = page.getByTestId("folder:settings:downloads");
        await expect(downloadsEntry).toBeVisible();
        await downloadsEntry.click();
        // 仅断言 overlay 仍可见不足以证明“进入下载面板”；必须确认子层 schema 卡片已渲染。
        await expect(page.getByTestId("downloads:folder")).toBeVisible();
        await expect(page.getByTestId("downloads:scan")).toBeVisible();
        await expect(page.getByTestId("downloads:manage")).toBeVisible();
        await expect(page.locator("#sceneOverlay")).toHaveClass(/visible/);
        expect(pageErrors).toEqual([]);
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
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        for (let i = 0; i < 3; i++) {
            await page.click("#btnMainAction");
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
            await expect(page.getByTestId("folder:models:browse")).toBeVisible();

            await page.click("#btnMainAction");
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
        }
        expect(pageErrors).toEqual([]);
    });

    test("设置面板: 打开/关闭/重开不崩溃（稳定性）", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        for (let i = 0; i < 3; i++) {
            await page.click("#btnSettings");
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
            await expect(page.locator('[data-menu-id="settings-menu"] .slide-title')).toBeVisible();

            await page.click("#btnSettings");
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
        }
        expect(pageErrors).toEqual([]);
    });
});
