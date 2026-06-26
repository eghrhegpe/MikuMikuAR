import { test, expect } from "./wails-fixture";
import { captureScreenshot, openEnvPanel, clickSkyMode, clickEnvSubLevel } from "./helpers";

test.describe("Environment — Sky Panel", () => {
    test.beforeEach(async ({ wailsPage: page }) => {
        await openEnvPanel(page);
        await clickEnvSubLevel(page, "天空");
    });

    test("纯色模式: 只显示一个「天空色」颜色行 (3 个滑块)", async ({ wailsPage: page }) => {
        await clickSkyMode(page, "纯色");
        // Only one color row (3 range sliders) + brightness + envIntensity
        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(5);
    });

    test("纯色模式: 设置纯白 (1,1,1) → 截图成功", async ({ wailsPage: page }) => {
        await clickSkyMode(page, "纯色");

        const sliders = page.locator('input[type="range"]');
        await sliders.nth(0).fill("1");
        await sliders.nth(1).fill("1");
        await sliders.nth(2).fill("1");

        const dataUrl = await captureScreenshot(page);
        expect(dataUrl).toContain("data:image/png;base64,");
    });

    test("渐变模式: 显示天顶色 + 地平色两行 (6 个滑块)", async ({ wailsPage: page }) => {
        await clickSkyMode(page, "渐变");

        const sliders = page.locator('input[type="range"]');
        // 2 color rows × 3 channels + brightness + envIntensity + mid color row
        await expect(sliders).toHaveCount(10);
    });

    test("程序化模式: 显示天顶色 + 地平色 (6 个滑块)", async ({ wailsPage: page }) => {
        await clickSkyMode(page, "程序化");

        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(8);
    });

    test("贴图模式: 不显示颜色滑块，只留亮度+环境光强度", async ({ wailsPage: page }) => {
        await clickSkyMode(page, "贴图");

        const sliders = page.locator('input[type="range"]');
        await expect(sliders).toHaveCount(2);
    });
});
