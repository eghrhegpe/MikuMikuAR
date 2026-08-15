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
import { test, expect, type Page } from "@playwright/test";
import { gotoWebEntry, waitForInitComplete, WEB_ENTRY_URL } from "./helpers";

/**
 * 与 gotoWebEntry 等价，但不安装 installOverlayGuards。
 * 本 spec 的前两个用例必须观察真实引导弹窗，不能被常驻守卫强制隐藏。
 */
async function gotoWebEntryWithoutOverlayGuards(page: Page): Promise<void> {
    await page.goto(WEB_ENTRY_URL, { waitUntil: "commit", timeout: 30000 });

    // 等 SW 首次接管后的 reload 完成（与 helpers.gotoWebEntry 同一约定）
    await page
        .waitForFunction(
            () => navigator.serviceWorker?.controller != null,
            null,
            { timeout: 15000 }
        )
        .catch(() => { /* SW 未接管（本地 preview 未注册）时跳过，不影响测试 */ });

    await page.waitForSelector("#btnMainAction", { timeout: 20000 });
    await waitForInitComplete(page);
}

/** 直接从 IndexedDB 读取 ADR-183 的跳过标志，避免“点击取消后立即 reload”丢写。 */
async function readFsaAuthPromptDismissed(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const dbReq = indexedDB.open("mikumikuar-web");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
        });
        try {
            const tx = db.transaction("config", "readonly");
            const req = tx.objectStore("config").get("fsaAuthPromptDismissed");
            const value = await new Promise<unknown>((resolve, reject) => {
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            return value === true;
        } finally {
            db.close();
        }
    });
}

test.describe("Web FSA — 根目录授权引导 (@web)", { tag: ["@web"] }, () => {
    test("首启动: 未授权时弹出「授权模型根目录」确认框", async ({ page }) => {
        // 不经过 gotoWebEntry 的 dismiss——本测试要观察引导弹窗本身
        await gotoWebEntryWithoutOverlayGuards(page);

        // 等 initLibrary 引导弹窗（state='none' 且未 dismissed → showConfirm）
        const dialog = page.locator("#mmd-dialog-overlay.mmd-dialog-visible");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        // 五语任一均可；preview 默认 locale 随浏览器环境变化，不能硬编码中文。
        await expect(dialog.locator(".mmd-dialog-title")).toHaveText(
            /授权模型根目录|Authorize model root directory|モデルルートディレクトリの認可|모델 루트 디렉터리 인가|授權模型根目錄/
        );

        // 点取消关闭，随后操作不再被拦截
        await dialog.locator(".mmd-dialog-cancel").click();
        await expect(dialog).not.toBeVisible();
    });

    test("取消引导: dismissed 持久化后刷新不再弹窗", async ({ page }) => {
        await gotoWebEntryWithoutOverlayGuards(page);

        // 取消引导
        const dialog = page.locator("#mmd-dialog-overlay.mmd-dialog-visible");
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await dialog.locator(".mmd-dialog-cancel").click();
        await expect(dialog).not.toBeVisible();

        // 必须等 IndexedDB 写入完成再刷新，否则 reload 可能取消未完成事务
        await expect
            .poll(async () => readFsaAuthPromptDismissed(page), { timeout: 10000 })
            .toBe(true);

        // 同一 context 内刷新 → dismissed 标志持久化 → 不再弹窗
        await page.reload({ waitUntil: "commit" });
        await page.waitForSelector("#btnMainAction", { timeout: 20000 });
        await waitForInitComplete(page);

        // 等库初始化真正跑完（状态栏出现 📦 开头的 first-use/browse 提示，五种语言均含此 emoji），
        // 避免 toHaveCount(0) 在 initLibrary 尚未执行时提前通过造成假绿。
        await page.waitForFunction(
            () => document.getElementById("statusText")?.textContent?.includes("📦") ?? false,
            null,
            { timeout: 10000 }
        );

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
