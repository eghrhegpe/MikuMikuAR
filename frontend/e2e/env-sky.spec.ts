/**
 * E2E test for the Environment → Sky panel.
 *
 * DOM-only assertions (vitePage, localhost:5173, no Wails) verify the sky unified
 * level renders its mode control, presets, and color controls. The sky UI is a
 * SINGLE unified level (not per-mode slider sets); mode options (程序化/纯色/贴图)
 * live in a segmented control that shows only the CURRENT mode, so we assert the
 * current mode + presets + color controls rather than per-mode slider counts.
 *
 * Screenshot test uses wailsPage (WebView2 CDP, needs `wails3 dev` running).
 */
import { test, expect } from "./wails-fixture";
import { openEnvPanel, clickEnvSubLevel, captureScreenshot, captureFingerprint, compareToBaseline } from "./helpers";

test.describe("Environment — Sky Panel (vitePage, DOM-only)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
    });

    test("天空统一层级：模式控件 + 预设 + 折叠区段均渲染", async ({ vitePage: page }) => {
        await expect(page.getByText("天空模式")).toBeVisible();
        // Current sky mode (segmented control shows only the active value).
        await expect(page.getByText("纯色", { exact: true })).toBeVisible();
        // Environment presets (always visible).
        await expect(page.getByText("黎明")).toBeVisible();
        await expect(page.getByText("正午")).toBeVisible();
        await expect(page.getByText("夜景")).toBeVisible();
        // Collapsible sections (titles always visible, content hidden by default).
        await expect(page.getByText("天空外观")).toBeVisible();
        await expect(page.getByText("高级天空设置")).toBeVisible();
    });
});

test.describe("Environment — Sky Panel (wailsPage, screenshot)", { tag: ["@webgl"] }, () => {
    test("选择天空预设（夜景）不报错且面板保持可见", async ({ wailsPage: page }) => {
        // NOTE: applies a procedural sky preset, which triggers a sky-dome
        // texture rebuild. Under the @dom fixture's software-GL (SwiftShader)
        // Chromium this crashes the GPU process; the real WebView2 renderer
        // (@webgl) handles it fine, so this assertion lives here.
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
        await page.getByText("夜景", { exact: true }).click();
        await expect(page.locator("#sceneOverlay")).toHaveClass(/visible/);
    });

    test("纯色纯白截图: 与基线比对（首次运行自动生成基线）", async ({ wailsPage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");

        // 校验截图管线本身仍可用（与菜单「截图当前模型」同源）
        const dataUrl = await captureScreenshot(page);
        expect(dataUrl).toContain("data:image/png;base64,");

        // 与持久化基线做内容比对（Phase 2, ADR-060）。需 BASELINE_GEN=1 首次生成
        // （避免跨平台无意漂移），后续运行若画面变化则失败。
        // 删除 __baselines__/env-sky-solid-white.json 后设 BASELINE_GEN=1 重算。
        const fp = await captureFingerprint(page);
        const res = await compareToBaseline("env-sky-solid-white", fp);
        if (res.created) {
            test.info().annotations.push({
                type: "baseline",
                description: "auto-generated env-sky-solid-white baseline (first run)",
            });
        }
        expect(res.match, `画面与基线不符 (hamming=${res.diff.toFixed(3)})`).toBe(true);
    });
});
