/**
 * E2E DOM-only test for Settings — 主题与语言
 *
 * 覆盖外观设置（主题色预设）与语言切换（中/英/日/韩/繁），
 * 验证设置面板核心路径：打开设置 → 进入外观 → 稳定 testid 可见。
 *
 * Uses vitePage (headless Chromium → localhost:5173), no Wails needed.
 */
import { test, expect } from "./wails-fixture";

test.describe("Settings — 主题与语言 (vitePage, @dom)", { tag: ["@dom", "@overlay"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    });

    test("外观区段: 包含主题色相关选项", async ({ vitePage: page }) => {
        // 进入外观子层级后根级 folder 不再可见，改断言子层稳定 custom host id
        await page.getByTestId("folder:settings:appearance").click();

        // 主题色预设卡片有稳定 custom host id（settings-appearance.ts schema 定义），
        // 每行另有稳定 testid settings:appearance:theme:<hex>，不依赖本地化文本。
        await expect(page.getByTestId("settings:appearance:theme-presets")).toBeVisible();
        await expect(
            page.locator('[data-testid^="settings:appearance:theme:"]').first()
        ).toBeVisible();
    });

    test("外观区段: 语言切换行可见", async ({ vitePage: page }) => {
        await page.getByTestId("folder:settings:appearance").click();

        // 语言卡片有稳定 custom host id；每行 testid 使用语言代码，不受 UI 语言影响。
        await expect(page.getByTestId("settings:appearance:language")).toBeVisible();
        for (const code of ["zh-CN", "en", "ja", "ko", "zh-TW"]) {
            await expect(page.getByTestId(`settings:appearance:lang:${code}`)).toBeVisible();
        }
    });

    test("资源区段: 可进入且返回不崩溃", async ({ vitePage: page }) => {
        // ADR-157 后“路径/库”已并入资源区段（settings.ts 根项：resources）
        await page.getByTestId("folder:settings:resources").click();
        await expect(page.getByTestId("resources:library-sort")).toBeVisible();

        // 返回设置根级：点击 #btnSettings 触发 toggle 关闭
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });

        // 重新打开确保不崩溃
        await page.click("#btnSettings");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
        await expect(page.getByTestId("folder:settings:resources")).toBeVisible();
    });

    test("画面区段: 性能/渲染相关控件可见", async ({ vitePage: page }) => {
        // 旧 performance/rendering 根项已合并为 ADR-157 的 graphics 区段
        await page.getByTestId("folder:settings:graphics").click();
        await expect(page.getByTestId("settings:graphics:modes")).toBeVisible();
        await expect(page.getByTestId("settings:graphics:aa")).toBeVisible();
    });

    test("媒体区段: 可进入且无崩溃", async ({ vitePage: page }) => {
        // 旧 audio 区段已并入 ADR-157 的 media 区段
        await page.getByTestId("folder:settings:media").click();
        await expect(page.getByTestId("media:volume")).toBeVisible();
    });

    test("设置面板: 所有顶层区段均渲染（完整性检查）", async ({ vitePage: page }) => {
        // ADR-157 真实顶层区段：appearance/graphics/controls/resources/downloads/media/system/about
        const topLevelFolders = [
            "folder:settings:appearance",
            "folder:settings:graphics",
            "folder:settings:controls",
            "folder:settings:resources",
            "folder:settings:downloads",
            "folder:settings:media",
            "folder:settings:system",
            "folder:settings:about",
        ];
        for (const testId of topLevelFolders) {
            await expect(page.getByTestId(testId)).toBeVisible();
        }
    });
});
