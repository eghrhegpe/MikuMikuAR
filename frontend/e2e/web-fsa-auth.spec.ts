/**
 * [doc:adr-183] Web 入口 — FSA 根目录授权引导 UI 流程
 *
 * 生产构建（vite preview）下无法 import 源码模块（/src/ 路径不存在），
 * 故改为通过 UI 行为验证 browser-adapter 的 FSA 引导状态机：
 *   1. 首启动（未 dismissed + 无根目录）→ 弹「授权模型根目录」确认框
 *   2. 用户点取消 → dismissFsaAuthPrompt 写 IndexedDB → 刷新后不再弹
 *   3. 模型库面板的导入文件 / 重扫入口始终可见
 *
 * 约束：requestPermission 须用户手势 → Playwright 用 page.evaluate 模拟。
 *       FSA API 在 headless Chromium 中部分可用（showDirectoryPicker 被限制），
 *       因此本 spec 侧重验证 UI 层状态机 + 引导弹窗，而非真·系统文件选择器。
 *
 * 运行：npx playwright test --grep "@web" web-fsa-auth
 * 前置：webServer 自动 build + preview dist-web/（playwright.config.ts 配置）
 */
import { test, expect } from "@playwright/test";
import { gotoWebEntry, WEB_ENTRY_URL } from "./helpers";

test.describe("Web FSA — 根目录授权引导 (@web)", { tag: ["@web"] }, () => {
    test("首启动: 未授权时弹出「授权模型根目录」确认框", async ({ page }) => {
        // 不经过 gotoWebEntry 的 dismiss——本测试要观察引导弹窗本身
        await page.goto(WEB_ENTRY_URL, { waitUntil: "commit", timeout: 30000 });
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });

        // 等 initLibrary 引导弹窗（state='none' 且未 dismissed → showConfirm）
        const dialog = page.locator("#mmd-dialog-overlay.mmd-dialog-visible");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog.locator(".mmd-dialog-title")).toHaveText(/授权模型根目录/);

        // 点取消关闭，随后操作不再被拦截
        await dialog.locator(".mmd-dialog-cancel").click();
        await expect(dialog).not.toBeVisible();
    });

    test("取消引导: dismissed 持久化后刷新不再弹窗", async ({ page }) => {
        await page.goto(WEB_ENTRY_URL, { waitUntil: "commit", timeout: 30000 });
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });

        // 取消引导
        const dialog = page.locator("#mmd-dialog-overlay.mmd-dialog-visible");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await dialog.locator(".mmd-dialog-cancel").click();
        await expect(dialog).not.toBeVisible();

        // 同一 context 内刷新 → dismissed 标志持久化 → 不再弹窗
        await page.reload({ waitUntil: "commit" });
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });
        await expect(page.locator("#mmd-dialog-overlay.mmd-dialog-visible")).toHaveCount(0, {
            timeout: 10000,
        });
    });

    test("FSA 入口: 模型库面板包含导入文件操作", async ({ page }) => {
        await gotoWebEntry(page);

        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 导入文件按钮始终可见（ADR-183 的 initLibrary 引导只在有 FSA 时触发）
        await expect(page.getByTestId("action:models:import-file")).toBeVisible();
    });

    test("FSA 入口: 模型库面板包含重扫操作", async ({ page }) => {
        await gotoWebEntry(page);

        await page.click("#btnMainAction");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });

        // 重扫按钮始终可见（refreshLibrary 兜底授权拉起）
        await expect(page.getByTestId("action:models:rescan")).toBeVisible();
    });
});
