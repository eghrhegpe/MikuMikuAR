/**
 * [doc:adr-177] Phase 4 — Web 入口 smoke 测试
 *
 * 验证主应用 web 入口（index.web.html → vite preview 4174）首屏渲染 + 基础导航。
 * 不依赖 Wails runtime（__MMKU_WEB__=true 短路 browser-adapter）。
 *
 * 运行：npx playwright test --grep "@web"
 * 前置：webServer 自动 build + preview dist-web/（playwright.config.ts 配置）
 */
import { test, expect, type Page } from "@playwright/test";

const WEB_URL = process.env.WEB_URL || "http://localhost:4174/MikuMikuAR/";

/**
 * 导航到 web 入口并等待 init() 完成。
 *
 * init() 完成信号：#loading display:none（成功）或 background 有色（失败）。
 * web 入口走 browser-adapter，GetConfig 等返回默认值，init 应成功。
 */
async function gotoWebEntry(page: Page): Promise<void> {
    await page.goto(WEB_URL, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector("#btnMainAction", { timeout: 20000 });

    // 等 init() 完成（同 vitePage fixture 的守卫逻辑）
    await page.evaluate(() => {
        return new Promise<void>((resolve) => {
            const loading = document.getElementById("loading");
            if (!loading) return resolve();
            const done = () => resolve();
            if (loading.style.display === "none" || loading.style.background) {
                return done();
            }
            const obs = new MutationObserver(() => {
                if (loading.style.display === "none" || loading.style.background) {
                    obs.disconnect();
                    done();
                }
            });
            obs.observe(loading, { attributes: true, attributeFilter: ["style"] });
            setTimeout(() => {
                obs.disconnect();
                done();
            }, 20000);
        });
    });

    // 强制 #loading pointer-events:none 让 click 穿透（同 vitePage fixture）
    await page.evaluate(() => {
        const loading = document.getElementById("loading");
        if (!loading) return;
        const forcePassthrough = () => {
            if (loading.style.pointerEvents !== "none") {
                loading.style.pointerEvents = "none";
            }
        };
        forcePassthrough();
        new MutationObserver(forcePassthrough).observe(loading, {
            attributes: true,
            attributeFilter: ["style"],
        });
    });
}

test.describe("Web Smoke — 主应用 Web 入口 (@web)", { tag: ["@web"] }, () => {
    test("首屏渲染：canvas + 6 nav 按钮可见", async ({ page }) => {
        await gotoWebEntry(page);

        await expect(page.locator("#renderCanvas")).toBeVisible({ timeout: 10000 });

        // 主应用 6 个 nav 按钮（模型/动作/场景/环境/设置/广场）
        await expect(page.locator("#btnMainAction")).toBeVisible();
        await expect(page.locator("#btnMotionPopup")).toBeVisible();
        await expect(page.locator("#btnScene")).toBeVisible();
        await expect(page.locator("#btnEnv")).toBeVisible();
        await expect(page.locator("#btnSettings")).toBeVisible();
        await expect(page.locator("#btnPlaza")).toBeVisible();
    });

    test("环境菜单打开 + 文件夹渲染", async ({ page }) => {
        await gotoWebEntry(page);

        await page.click("#btnEnv");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });

        // env 菜单顶层文件夹渲染
        await expect(page.getByTestId("folder:env:sky")).toBeVisible();
        await expect(page.getByTestId("folder:env:particle")).toBeVisible();
    });

    test("Ctrl+1~5 + 7 切换各 nav 菜单", async ({ page }) => {
        await gotoWebEntry(page);

        for (const n of [1, 2, 3, 4, 5, 7]) {
            await page.keyboard.press(`Control+Digit${n}`);
            await page.waitForSelector("#sceneOverlay.visible", { timeout: 6000 });
            await page.keyboard.press(`Control+Digit${n}`);
            await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 6000 });
        }
    });

    test("能力门控：AR 相机模式选项被隐藏", async ({ page }) => {
        // [doc:adr-177] A5 验证：browser-adapter capabilities().ar === false
        await gotoWebEntry(page);

        await page.click("#btnScene");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });

        // 进入相机控制（场景菜单含 camera:main）
        const cameraRow = page.locator('[data-testid="folder:scene:camera"], [data-id="camera:main"]');
        if (await cameraRow.count() > 0) {
            await cameraRow.first().click();
            // AR 选项不应出现在相机模式滑块（capabilities.ar=false 过滤）
            const arOption = page.locator('text=AR');
            await expect(arOption).toHaveCount(0);
        }
    });

    test("能力门控：广场窗口模式选项被隐藏", async ({ page }) => {
        // [doc:adr-177] A5 验证：browser-adapter capabilities().plazaWindow === false
        await gotoWebEntry(page);

        await page.click("#btnPlaza");
        await page.waitForSelector("#sceneOverlay.visible", { timeout: 8000 });

        // 独立窗口选项不应出现
        const windowOption = page.locator('text=独立窗口');
        await expect(windowOption).toHaveCount(0);
    });
});
