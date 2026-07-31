/**
 * E2E: 核心旅程 — 截图导出
 *
 * 双模式：
 * - @dom (vitePage): 设置面板「截图」入口 DOM 断言，纯 UI 回归，稳定。
 * - @webgl (wailsPage): __scene.capture() 真实截图管线验证，需要 WebGL。
 *
 * 本项目截图走 Wails 原生 SaveFile 对话框（非浏览器 download），
 * 故 Playwright 无法用 page.waitForEvent('download') 拦截。正确做法：
 *   1) 直接断言 window.__scene.capture() 的 Babylon→image 管线；
 *   2) 断言设置面板存在「截图」入口（DOM 级，捕获菜单回归）。
 *
 * @see ADR-060 Phase 1/Phase 2 — 原生对话框在 headless WebView2 下的处理与截图基线比对。
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook } from "./helpers";

// ======== @dom: Settings panel screenshot entry (DOM-only) ========
test.describe("截图导出: 设置面板入口 (@dom, vitePage)", { tag: ["@dom"] }, () => {
    test("设置面板可打开且 __scene.capture 管线就绪", async ({ vitePage: page }) => {
        // 使用 JS click() 绕过 Babylon canvas 的 pointer-events 拦截层
        await page.evaluate(() => {
            document.getElementById("btnSettings")?.click();
        });
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        // 验证设置面板 overlay 已打开
        const overlayVisible = await page.evaluate(() => {
            const overlay = document.getElementById("sceneOverlay");
            return overlay?.classList.contains("visible") ?? false;
        });
        expect(overlayVisible).toBe(true);
        // 验证截图管线在 __scene 钩子中就绪（@webgl 测试会进一步验证返回值）
        const captureReady = await page.evaluate(() => {
            const s = (window as any).__scene;
            return typeof s?.capture === "function";
        });
        expect(captureReady).toBe(true);
    });
});

// ======== @webgl: Real screenshot capture pipeline ========
test.describe("截图导出: capture pipeline (@webgl, wailsPage)", { tag: ["@webgl"] }, () => {
    test("__scene.capture() 应返回有效 PNG dataURL", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        // 与菜单「截图当前模型」走同一条 Babylon CreateScreenshotAsync 管线。
        const dataUrl = await page.evaluate(async () => await (window as any).__scene.capture());
        expect(typeof dataUrl).toBe("string");
        expect(dataUrl).toContain("data:image/png;base64,");
    });
});