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

import type { Page } from "@playwright/test";
import { test, expect } from "./wails-fixture";
import { waitForSceneHook } from "./helpers";

/** 打开模型库 → 进入“加载模型”浏览层（当前 DOM 契约：folder:models:browse）。 */
async function openLibraryBrowse(page: Page): Promise<void> {
    // 若上个用例残留 overlay，先 Escape 关闭，避免 #btnMainAction 被当成“关闭”再点。
    const overlayOpen = await page.evaluate(() =>
        document.getElementById("sceneOverlay")?.classList.contains("visible") ?? false
    );
    if (overlayOpen) {
        await page.keyboard.press("Escape");
        await page.waitForSelector("#sceneOverlay:not(.visible)", { timeout: 5000 });
    }
    await page.click("#btnMainAction");
    await page.waitForSelector("#sceneOverlay.visible", { timeout: 5000 });
    await page.getByTestId("folder:models:browse").click({ timeout: 5000 });
    await page.waitForSelector('[data-testid^="model:"]', { timeout: 5000 });
}

/** 加载模型库第一个真实模型条目（替代 helpers.loadFirstModel 已过期的 actor:model 选择器）。 */
async function loadFirstModelFromLibrary(page: Page): Promise<void> {
    await openLibraryBrowse(page);
    await page.locator('[data-testid^="model:"]').first().click();
    // meshCount 可能在 ImportMeshAsync 完成前就 >10；必须等到 modelManager 已注册且已聚焦，
    // 才能保证 createMmdModel → retryWindPhysicsSubscription → register → focus 已走完。
    await page.waitForFunction(() => {
        const mm = (window as any).__scene?.modelManager;
        return mm && mm.size > 0 && !!mm.focused?.() && (window as any).__scene?.meshCount > 10;
    }, { timeout: 20000 });
}

/** 清空当前 modelManager 中所有模型，避免共享 Wails 页面状态残留。 */
async function clearAllModels(page: Page): Promise<void> {
    await page.evaluate(() => {
        const mm = (window as any).__scene?.modelManager;
        if (!mm) return;
        for (const id of [...mm.modelRegistry.keys()]) {
            mm.remove(id);
        }
    });
}

/** 物理骨骼候选关键词：覆盖常见 MMD 日文名与英文名，避免只认四个固定骨骼名。 */
const PHYSICS_BONE_KEYWORDS = [
    "髪", "hair", "スカート", "skirt", "フリル", "frill", "袖", "sleeve",
    "リボン", "ribbon", "胸", "bust", "chest",
];

/** 从当前焦点模型 runtimeBones 中选出疑似物理骨骼的名字；无则返回空数组。 */
async function findPhysicsBoneNames(page: Page): Promise<string[]> {
    return page.evaluate((keywords) => {
        const mm = (window as any).__scene?.modelManager;
        const inst = mm?.focused?.();
        const bones = inst?.mmdModel?.runtimeBones;
        if (!Array.isArray(bones)) return [];
        const names = bones.map((b: { name?: string }) => b?.name ?? "");
        return names.filter((n) => keywords.some((k) => n.toLowerCase().includes(k)));
    }, PHYSICS_BONE_KEYWORDS);
}

test.describe("物理子系统健康检查", { tag: ["@webgl"] }, () => {
    // @webgl 共享同一个 Wails WebView2 页面：串行 + 每个用例清空模型/风，避免状态残留。
    test.describe.configure({ mode: "serial" });

    test.beforeEach(async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await page.evaluate(() => (window as any).__scene?.driver.setWindSpeed(0));
        await clearAllModels(page);
    });

    test.afterEach(async ({ wailsPage: page }) => {
        await page.evaluate(() => (window as any).__scene?.driver.setWindSpeed(0)).catch(() => {});
        await clearAllModels(page).catch(() => {});
    });

    test("加载模型后 rigidBodyCount > 0（WASM 物理已运行 + 联邦自建刚体已登记）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModelFromLibrary(page);

        // 注意：联邦自建刚体（地面碰撞默认开启 / 虚拟裙骨）走单数容器
        // rigidBodyReferenceCountMap，不进 bundle 容器，故须断言 rigidBodyCount（>0），
        // 而非恒为 0 的 rigidBodyBundleCount。
        const bodyCount = await page.evaluate(() => (window as any).__scene.rigidBodyCount);
        expect(bodyCount).toBeGreaterThan(0);
    });

    test("加载模型后风力物理已订阅（model-loader 显式 retry 建立订阅）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModelFromLibrary(page);

        const active = await page.evaluate(() => (window as any).__scene.windPhysicsActive);
        // 源码语义：model-loader.ts:644 在 actor 模型创建后调用
        // retryWindPhysicsSubscription(_mmdRuntime)，physics impl 就绪即订阅
        // onSyncObservable → isWindPhysicsActive() 为 true。订阅与 windEnabled
        // 无关（windEnabled 只影响 _onPhysicsSync 是否施加风力），故此处应为 true。
        expect(active).toBe(true);
    });

    test("设置风速 10 后风力物理保持活跃（订阅已建立）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModelFromLibrary(page);

        // 激活风力（订阅在模型加载时已建立，此调用只改 envState.windSpeed）
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(10));
        // 订阅不因风速变化而销毁，作为护栏等待（若实现回归销毁订阅则超时暴露）
        await page.waitForFunction(() => (window as any).__scene?.windPhysicsActive === true, {
            timeout: 10000,
        });

        const active = await page.evaluate(() => (window as any).__scene.windPhysicsActive);
        expect(active).toBe(true);

        // 恢复（避免影响后续测试）
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(0));
    });

    test("设置风速 10 后骨骼位置发生变化（物理真的动了）", async ({ wailsPage: page }) => {
        await waitForSceneHook(page);
        await loadFirstModelFromLibrary(page);

        // 从当前模型运行时骨骼中动态筛选疑似物理骨骼，降低对固定日文骨骼名的依赖。
        const boneNames = await findPhysicsBoneNames(page);
        if (boneNames.length === 0) {
            test.skip("当前模型无可识别的物理骨骼（髪/スカート/フリル/袖/リボン/胸 等），跳过位移验证");
            return;
        }

        // 先获取初始骨骼位置（风力关闭）
        const before = await page.evaluate(
            (names) => (window as any).__scene.getBoneWorldPositions(names),
            boneNames
        );

        // 激活风力
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(10));
        // 等待物理模拟让风力生效（轮询骨骼位置变化，替代固定 sleep 2000ms）
        await page.waitForFunction(
            ({ names, before }) => {
                const after = (window as any).__scene.getBoneWorldPositions(names);
                for (const name of Object.keys(before)) {
                    const b = before[name];
                    const a = after[name];
                    if (!b || !a) continue;
                    const dx = a.x - b.x;
                    const dy = a.y - b.y;
                    const dz = a.z - b.z;
                    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.001) return true;
                }
                return false;
            },
            { names: boneNames, before },
            { timeout: 10000 }
        );

        const after = await page.evaluate(
            (names) => (window as any).__scene.getBoneWorldPositions(names),
            boneNames
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
        await loadFirstModelFromLibrary(page);

        // 先开启（等待订阅生效）
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(10));
        await page.waitForFunction(() => (window as any).__scene?.windPhysicsActive === true, {
            timeout: 10000,
        });

        // 再关闭
        await page.evaluate(() => (window as any).__scene.driver.setWindSpeed(0));

        const active = await page.evaluate(() => (window as any).__scene.windPhysicsActive);
        // windSpeed=0 时 isWindActive() 返回 false，_onPhysicsSync 跳过
        // 但 observer 仍订阅（只是回调内跳过），所以 windPhysicsActive 仍为 true
        // 这是预期行为：observer 订阅状态不变，但风力不施加
        expect(active, "observer 仍订阅，windPhysicsActive 保持 true").toBe(true);
    });
});