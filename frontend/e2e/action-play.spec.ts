/**
 * E2E: 核心旅程 — 动作播放与换装
 *
 * 走 wailsPage（含真实 Go 后端 + WebGL）。动作/换装断言基于 window.__scene 数值钩子。
 *
 * @requires 已加载一个自带动作/换装变体的模型（CI 需 seed 对应模型）。
 */
import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel, openMotionPopup } from "./helpers";

test.describe("核心旅程: 动作播放与换装", () => {
    test("切换动作后 currentAnimation 应更新（非 idle）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);
        await openMotionPopup(page);

        await page.waitForSelector("#sceneOverlay .slide-item", { timeout: 5000 });
        // 首个 .slide-item 可能是文件夹行；若模型动作列表首项为文件夹，请改用
        // page.locator('#sceneOverlay .slide-item', { hasText: '动作名' }) 精确定位。
        await page.locator("#sceneOverlay .slide-item").first().click();

        await page.waitForFunction(
            () => {
                const a = (window as any).__scene?.currentAnimation;
                return a && a !== "idle";
            },
            { timeout: 10000 }
        );
        const anim = await page.evaluate(() => (window as any).__scene.currentAnimation);
        expect(anim).not.toBe("idle");
    });

    // 换装：走 window.__scene 行为钩子（applyOutfit / fingerprint），避免 3-4 层
    // 脆弱的菜单 DOM 导航。钩子直接驱动真实 applyOutfitVariant 路径（含 loadOutfits +
    // mesh 重定向），是 ADR-060 规定的「数值/行为断言为主」策略。
    // 前置：CI 需 seed 一个带 outfits.json（≥2 个变体）的模型，否则自动跳过。
    test("换装: 应用不同变体后画面应发生变化", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const variants = await page.evaluate(async () => (window as any).__scene.outfitVariants());
        test.skip(
            variants.length < 2,
            `焦点模型变体不足 2 个 (${variants.length})；需 CI seed 带 outfits.json 的模型`
        );

        const before = await page.evaluate(async () => (window as any).__scene.fingerprint());
        // 应用第二个变体（variants[0] 通常为「默认」）
        const ok = await page.evaluate(
            async (v: string) => (window as any).__scene.applyOutfit(v),
            variants[1]
        );
        expect(ok).toBe(true);

        const after = await page.evaluate(async () => (window as any).__scene.fingerprint());
        expect(after).not.toBe(before);
    });
});
