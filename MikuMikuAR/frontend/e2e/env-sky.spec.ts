/**
 * E2E test for the Environment → Sky panel.
 *
 * DOM-only assertions (slider counts per mode) use vitePage (localhost:5173, no Wails).
 * Screenshot test uses wailsPage (WebView2 CDP, needs `wails dev` running).
 */
import { test, expect } from "./wails-fixture";
import { openEnvPanel, clickSkyMode, clickEnvSubLevel, captureScreenshot } from "./helpers";

test.describe("Environment — Sky Panel (vitePage, DOM-only)", () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
    });

    test("纯色模式: 只显示一个「天空色」颜色行 (3 个滑块)", async ({ vitePage: page }) => {
        await clickSkyMode(page, "纯色");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(5);
    });

    test("渐变模式: 显示天顶色 + 地平色两行 + 中间色 (10 个滑块)", async ({ vitePage: page }) => {
        await clickSkyMode(page, "渐变");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(10);
    });

    test("程序化模式: 显示天顶色 + 地平色 (8 个滑块)", async ({ vitePage: page }) => {
        await clickSkyMode(page, "程序化");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(8);
    });

    test("贴图模式: 不显示颜色滑块，只留亮度+环境光强度", async ({ vitePage: page }) => {
        await clickSkyMode(page, "贴图");
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(2);
    });
});

test.describe("Environment — Sky Panel (wailsPage, screenshot)", () => {
    test("纯色纯白截图", async ({ wailsPage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
        await clickSkyMode(page, "纯色");

        const sliders = page.locator('input[type="range"]');
        await sliders.nth(0).fill("1");
        await sliders.nth(1).fill("1");
        await sliders.nth(2).fill("1");

        const dataUrl = await captureScreenshot(page);
        expect(dataUrl).toContain("data:image/png;base64,");
    });
});
