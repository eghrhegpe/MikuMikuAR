/**
 * [doc:adr-176/178] Web 入口 — 能力门控完整验证
 *
 * 验证 browser-adapter 的 capabilities() 声明在 web 入口中正确生效：
 *   1. windowsCopy 等桌面独有能力 → false
 *   2. watchDir → false（ADRsion-178 Android 同理，web 也 false）
 *   3. AR / plazaWindow 均为 false（已在 web-smoke 覆盖，此处补充交叉验证）
 *   4. 广场按钮存在（web 端有 plaza 内联模式，无独立窗口）
 *
 * 与 ADR-177 web-smoke 互补：web-smoke 验证 UI 隐藏，本文件验证能力声明数据。
 *
 * 运行：npx playwright test --grep "@web" web-capabilities
 * 前置：webServer 自动 build + preview dist-web/（playwright.config.ts 配置）
 */
import { test, expect, type Page } from "@playwright/test";

const WEB_URL = process.env.WEB_URL || "http://localhost:4174/MikuMikuAR/";

async function gotoWebEntry(page: Page): Promise<void> {
    await page.goto(WEB_URL, { waitUntil: "commit", timeout: 30000 });
    await page.waitForSelector("#btnMainAction", { timeout: 20000 });
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

test.describe("Web Capabilities — 能力声明验证 (@web)", { tag: ["@web"] }, () => {
    test.beforeEach(async ({ page }) => {
        await gotoWebEntry(page);
    });

    test("browser-adapter capabilities: ar === false", async ({ page }) => {
        const ar = await page.evaluate(async () => {
            try {
                const wb = await import("/src/core/wails-bindings.ts");
                const caps = await wb.GetCapabilities();
                return caps?.ar ?? null;
            } catch {
                return null;
            }
        });
        expect(ar).toBe(false);
    });

    test("browser-adapter capabilities: plazaWindow === false", async ({ page }) => {
        const pw = await page.evaluate(async () => {
            try {
                const wb = await import("/src/core/wails-bindings.ts");
                const caps = await wb.GetCapabilities();
                return caps?.plazaWindow ?? null;
            } catch {
                return null;
            }
        });
        expect(pw).toBe(false);
    });

    test("browser-adapter capabilities: watchDir === false（web 无文件系统监听）", async ({ page }) => {
        const wd = await page.evaluate(async () => {
            try {
                const wb = await import("/src/core/wails-bindings.ts");
                const caps = await wb.GetCapabilities();
                return caps?.watchDir ?? null;
            } catch {
                return null;
            }
        });
        // ADR-178: web 端无文件系统监听能力
        expect(wd).toBe(false);
    });

    test("browser-adapter capabilities: windowsCopy 为 false（非桌面端）", async ({ page }) => {
        const wc = await page.evaluate(async () => {
            try {
                const wb = await import("/src/core/wails-bindings.ts");
                const caps = await wb.GetCapabilities();
                return caps?.windowsCopy ?? null;
            } catch {
                return null;
            }
        });
        // 浏览器端无 Wails 原生剪贴板跨端能力
        expect(wc).toBe(false);
    });

    test("广场按钮存在（web 端有内联 plaza，无独立窗口）", async ({ page }) => {
        // ADR-177: web 端有 plaza 按钮，但 plazaWindow 能力为 false
        await expect(page.locator("#btnPlaza")).toBeVisible();
    });

    test("所有 6 个 + 广场 nav 按钮可见", async ({ page }) => {
        const navButtons = [
            "#btnMainAction",
            "#btnMotionPopup",
            "#btnScene",
            "#btnEnv",
            "#btnSettings",
            "#btnPlaza",
        ];
        for (const selector of navButtons) {
            await expect(page.locator(selector)).toBeVisible();
        }
    });

    test("GetCapabilities 返回完整能力清单（无异常）", async ({ page }) => {
        const caps = await page.evaluate(async () => {
            try {
                const wb = await import("/src/core/wails-bindings.ts");
                return await wb.GetCapabilities();
            } catch (e) {
                return { error: String(e) };
            }
        });

        // 不应抛异常——browser-adapter 的 getCachedCapabilities() 应正常返回
        expect(caps).not.toHaveProperty("error");
        expect(caps).toBeDefined();
        // 至少包含已知字段
        expect(caps).toHaveProperty("ar");
        expect(caps).toHaveProperty("plazaWindow");
        expect(caps).toHaveProperty("watchDir");
    });
});
