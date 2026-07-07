/**
 * E2E test for the Environment → Sky panel.
 *
 * DOM-only assertions (slider counts per mode) use vitePage (localhost:5173, no Wails).
 * Screenshot test uses wailsPage (WebView2 CDP, needs `wails dev` running).
 */
import { test, expect } from "./wails-fixture";
import { openEnvPanel, clickSkyMode, clickEnvSubLevel, captureScreenshot, captureFingerprint, compareToBaseline } from "./helpers";

test.describe("Environment — Sky Panel (vitePage, DOM-only)", () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
    });

    test("纯色模式: 只显示天空色 (3 个滑块)", async ({ vitePage: page }) => {
        await clickSkyMode(page, "纯色");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(3);
    });

    test("渐变模式: 天顶 + 地平 + 中间色 (9 个滑块)", async ({ vitePage: page }) => {
        await clickSkyMode(page, "渐变");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(9);
    });

    test("程序化模式: 天顶 + 地平 + 亮度 (7 个滑块)", async ({ vitePage: page }) => {
        await clickSkyMode(page, "程序化");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(7);
    });

    test("贴图模式: 不显示颜色滑块，只留亮度+环境光强度", async ({ vitePage: page }) => {
        await clickSkyMode(page, "贴图");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(2);
    });
});

test.describe("Environment — Sky Panel (wailsPage, screenshot)", () => {
    test("纯色纯白截图: 与基线比对（首次运行自动生成基线）", async ({ wailsPage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
        await clickSkyMode(page, "纯色");

        const sliders = page.locator('input[type="range"]');
        await sliders.nth(0).fill("1");
        await sliders.nth(1).fill("1");
        await sliders.nth(2).fill("1");

        // 校验截图管线本身仍可用（与菜单「截图当前模型」同源）
        const dataUrl = await captureScreenshot(page);
        expect(dataUrl).toContain("data:image/png;base64,");

        // 与持久化基线做内容比对（Phase 2, ADR-060）。首次运行无基线会自动生成，
        // 后续运行若画面发生非预期变化则失败。删除 __baselines__/env-sky-solid-white.json 可重算。
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
