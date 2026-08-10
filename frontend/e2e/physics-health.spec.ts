/**
 * E2E: 物理子系统健康检查
 *
 * 走 wailsPage（含真实 Go 后端 + WASM Bullet 物理）。
 * 不依赖像素截图，全部基于 window.__scene 数值钩子断言。
 *
 * 验证项：
 * 1. 模型加载后物理单数刚体数 > 0（WASM 物理已运行 + 联邦自建刚体已登记）
 * 2. 风力订阅状态检查
 * 3. 设置风速后风力物理被激活
 * 4. 物理真正动了骨骼（位置变化检测）
 *
 * ⚠️ 关于断言目标：联邦自建刚体（虚拟裙骨 ADR-084 / 地面碰撞）经 `addRigidBody`
 * 进入 `rigidBodyReferenceCountMap`（单数容器），**不进** bundle 容器。故
 * `rigidBodyBundleCount` 恒为 0 属正常，断言须用单数 `rigidBodyCount`。
 *
 * @requires 已加载一个带物理（头发/裙子）的 PMX 模型
 */

import { test, expect } from "./wails-fixture";
import { waitForSceneHook, loadFirstModel } from "./helpers";

test.describe("物理子系统健康检查", { tag: ["@webgl"] }, () => {
    test("加载模型后 rigidBodyCount > 0（WASM 物理已运行 + 联邦自建刚体已登记）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        // 注意：联邦自建刚体（地面碰撞默认开启 / 虚拟裙骨）走单数容器
        // rigidBodyReferenceCountMap，不进 bundle 容器，故须断言 rigidBodyCount（>0），
        // 而非恒为 0 的 rigidBodyBundleCount。
        const bodyCount = await page.evaluate(() => (window as any).__scene.rigidBodyCount);
        expect(bodyCount).toBeGreaterThan(0);
    });

    test("加载模型后风力物理初始未订阅（windEnabled 默认 false）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        const active = await page.evaluate(() => (window as any).__scene.windPhysicsActive);
        // 风力默认关闭，observer 不应订阅
        expect(active).toBe(false);
    });

    test("设置风速 10 后 windPhysicsActive 变为 true", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        // 激活风力
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(10));
        // 等待风力订阅生效（physics sync 下一帧触发）
        await page.waitForTimeout(500);

        const active = await page.evaluate(() => (window as any).__scene.windPhysicsActive);
        expect(active).toBe(true);

        // 恢复（避免影响后续测试）
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(0));
    });

    test("设置风速 10 后骨骼位置发生变化（物理真的动了）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        // 先获取初始骨骼位置（风力关闭）
        const before = await page.evaluate(() => {
            // 尝试获取典型受物理影响的骨骼（头发/裙子末端）
            return (window as any).__scene.getBoneWorldPositions([
                "髪先端_L", "髪先端_R", "スカート先端_L", "スカート先端_R",
            ]);
        });

        // 激活风力
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(10));
        // 等待物理模拟数帧（让风力生效）
        await page.waitForTimeout(2000);

        const after = await page.evaluate(() =>
            (window as any).__scene.getBoneWorldPositions([
                "髪先端_L", "髪先端_R", "スカート先端_L", "スカート先端_R",
            ])
        );

        // 至少有一个骨骼位置发生了变化（风力确实推动了刚体）
        let movedAny = false;
        for (const name of Object.keys(before)) {
            const b = before[name];
            const a = after[name];
            if (!b || !a) continue;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dz = a.z - b.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > 0.001) {
                movedAny = true;
                break;
            }
        }
        expect(movedAny).toBe(true);

        // 恢复
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(0));
    });

    test("设置风速 0 后风力停止，windPhysicsActive 保持订阅态（不崩溃）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModel(page);

        // 先开启
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(10));
        await page.waitForTimeout(500);

        // 再关闭
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(0));
        await page.waitForTimeout(500);

        const active = await page.evaluate(() => (window as any).__scene.windPhysicsActive);
        // windSpeed=0 时 isWindActive() 返回 false，_onPhysicsSync 跳过
        // 但 observer 仍订阅（只是回调内跳过），所以 windPhysicsActive 仍为 true
        // 这是预期行为：observer 订阅状态不变，但风力不施加
        expect(active, "observer 仍订阅，windPhysicsActive 保持 true").toBe(true);
    });
});