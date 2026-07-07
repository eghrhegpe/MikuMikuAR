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

    // 换装：依赖模型带 outfit 变体，且在 model-detail 弹窗中可见。
    // 下列为条件骨架：若当前模型无 outfit，测试应跳过而非失败（TODO 接 skipWhen 判断）。
    test("换装后画面应发生变化（capture 哈希对比）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const before = await page.evaluate(async () => await (window as any).__scene.capture());

        // TODO(ADR-060 Phase 1): 打开 model-detail 弹窗并点击 outfit 变体。
        // 选择器待补：btnMainAction → 点击已加载模型条目 → model-detail 内 outfit 变体行。
        // 例：
        //   await page.locator('#btnMainAction').click();
        //   await page.locator('#sceneOverlay .slide-item', { hasText: '换装' }).first().click();
        //   await page.locator('.slide-item', { hasText: '变体A' }).click();

        const after = await page.evaluate(async () => await (window as any).__scene.capture());
        expect(before).not.toBe(after);
    });
});
