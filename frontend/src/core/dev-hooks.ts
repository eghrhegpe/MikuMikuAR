// [doc:adr-102] E2E capture + scene inspection hooks (DEV only).
// Split from main.ts (:1063-1171). Pure DEV-side-effect module: it only
// attaches helpers to `window` for Playwright numeric assertions; it has no
// business logic shared with production paths, so it stays out of the Split
// layer's hot import graph.
import { scene, engine, focusedModel, modelManager } from '../scene/scene';
import { loadOutfits, applyOutfitVariant } from '../outfit/outfit';
import { envState, mmdRuntime } from './config';
import { isWindPhysicsActive } from '../physics/wind-physics';
import { removeFocusedModel } from '../scene/manager/model-ops';
import { logInfo } from './logger';
// [doc:adr-229] 通用状态读取器：window.__state 复用 menu-schema 的 getStateValue（含 modelId）
import { getStateValue, type StatePath } from '../menus/menu-schema';

export function setupE2ECapture(): void {
    // [doc:e2e] 生产构建下默认不注入 E2E 钩子（DEV 为 false），
    // 但设 VITE_E2E_MODE=true 后仍可编入，供本地 @webgl 测试使用。
    if (!import.meta.env.DEV && !import.meta.env.VITE_E2E_MODE) {
        return;
    }

    // [doc:bone-override] 骨骼层级导出钩子（DEV only）
    // 用法：在控制台调用 window.__dumpBones() 获取当前模型的骨骼层级 JSON
    (window as unknown as Record<string, unknown>).__dumpBones = (): unknown => {
        // 动态导入避免循环依赖 + 仅在需要时加载

        return import('../scene/motion/bone-override').then((m) => {
            const dump = m.dumpBoneHierarchy();
            if (!dump) {
                console.warn('[__dumpBones] 无可用模型或骨骼未初始化');
                return null;
            }
            logInfo(
                '__dumpBones',
                `导出完成：${dump.totalBones} 根骨骼，${dump.totalOverridden} 根被覆盖`
            );
            logInfo('__dumpBones', '返回值已复制到剪贴板（如可用）');
            // 尝试复制到剪贴板
            try {
                const json = JSON.stringify(dump, null, 2);
                void navigator.clipboard.writeText(json);
            } catch {
                /* expected failure when clipboard is unavailable */
            }
            return dump;
        });
    };

    window.__capture = async (): Promise<string> => {
        const { CreateScreenshotAsync } = await import('@babylonjs/core/Misc/screenshotTools');
        // Force a render frame so Babylon writes to the backbuffer
        scene.render();
        return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
    };

    // ======== E2E State Hook (DEV only) ========
    // [doc:adr-229] 通用状态读取器：schema-driven 交互断言（拖滑块/点开关后验证
    // state 生效）复用 menu-schema 的 getStateValue（含 modelId 透传）。
    // 只读快照，不暴露 setter——交互写入走真实 DOM 事件（addSliderRow 等 onChange）。
    (window as unknown as Record<string, unknown>).__state = {
        get: (path: string, modelId?: string): unknown => getStateValue(path as StatePath, modelId),
    };

    // ======== E2E Scene Inspection Hook (DEV only) ========
    // Exposes live Babylon.js / XPBD state for Playwright numeric assertions.
    // Avoids fragile pixel-screenshot comparison for 3D correctness.
    (window as unknown as Record<string, unknown>).__scene = {
        get fps(): number {
            return engine.getFps();
        },
        get meshCount(): number {
            // Babylon keeps a flat meshes array (incl. system meshes like
            // ground/helpers). Assert a threshold, not an exact number.
            return scene.meshes.length;
        },
        get currentAnimation(): string {
            // Use focusedModel().vmdName instead of mmdRuntime.runtimeAnimation
            // which doesn't exist in babylon-mmd's public API.
            const inst = focusedModel();
            return inst?.vmdName ?? 'idle';
        },
        // --- Outfit (换装) behavior hook (DEV only, on-strategy per ADR-060) ---
        // Drives the REAL applyOutfitVariant path so E2E can assert a 3D change
        // without fragile 3-4 level menu navigation. Returns {variants, error}
        // so the test can distinguish "no outfits" from "loadOutfits failed" —
        // a .catch(->[]) would silently mask real regressions.
        outfitVariants: async (): Promise<{ variants: string[]; error: string | null }> => {
            const inst = focusedModel();
            if (!inst) {
                return { variants: [], error: null };
            }
            try {
                const o = await loadOutfits(inst.id);
                return { variants: (o?.variants ?? []).map((v) => v.name), error: null };
            } catch (e) {
                return { variants: [], error: String(e) };
            }
        },
        applyOutfit: (variantName: string): Promise<boolean> => {
            const inst = focusedModel();
            if (!inst) {
                return Promise.resolve(false);
            }
            return applyOutfitVariant(inst.id, variantName)
                .then(() => true)
                .catch(() => false);
        },
        // Coarse 16x16 luminance fingerprint of the current frame. Stable enough
        // for "did the picture change" assertions without decoding the PNG.
        // (Do NOT read a '2d' context from the WebGL canvas — getContext returns null.)
        fingerprint: async (): Promise<string> => {
            if (!window.__capture) {
                return '';
            }
            const url = await window.__capture!();
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = c.height = 16;
            const ctx = c.getContext('2d');
            if (!ctx) {
                return '';
            }
            ctx.drawImage(img, 0, 0, 16, 16);
            const d = ctx.getImageData(0, 0, 16, 16).data;
            const LUM_THRESHOLD = 384; // ≈ half-brightness: (255×3)/2 = 382.5
            let s = '';
            for (let i = 0; i < d.length; i += 4) {
                s += d[i] + d[i + 1] + d[i + 2] > LUM_THRESHOLD ? '1' : '0';
            }
            return s;
        },
        // Delegate to the existing screenshot helper. NOTE: do NOT read a
        // '2d' context from the WebGL canvas — getContext('2d') returns null.
        capture: (): Promise<string> => window.__capture!(),

        // CI seed model — creates a programmatic Babylon mesh so @webgl E2E tests
        // can assert a real 3D scene without a PMX file on disk.
        createTestMesh: async (): Promise<void> => {
            const { MeshBuilder } = await import('@babylonjs/core/Meshes/meshBuilder');
            const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
            const { Color3 } = await import('@babylonjs/core/Maths/math.color');
            // Dispose any previous test meshes first
            for (const m of [...scene.meshes]) {
                if (m.name.startsWith('e2e-test-')) {
                    m.dispose();
                }
            }
            const box = MeshBuilder.CreateBox('e2e-test-mesh', { size: 0.5 }, scene);
            const mat = new StandardMaterial('e2e-test-mat', scene);
            mat.diffuseColor = new Color3(1, 0, 0);
            box.material = mat;
        },
        clearTestMeshes: (): void => {
            for (const m of [...scene.meshes]) {
                if (m.name.startsWith('e2e-test-')) {
                    m.dispose();
                }
            }
        },

        // ======== Model Lifecycle Hooks (E2E @dom + @webgl) ========
        /** Remove the currently focused model (delegates to removeFocusedModel). */
        removeActiveModel: (): void => {
            removeFocusedModel();
        },
        /** Direct reference to the ModelManager instance for state inspection. */
        get modelManager() {
            return modelManager;
        },

        // ======== 物理健康检查钩子 (E2E @webgl) ========
        /** WASM 物理刚体 Bundle 数（0 = 无 bundle 类刚体）。
         *  ⚠️ 联邦的自建刚体（虚拟裙骨 ADR-084 / 地面碰撞）走 `addRigidBody`（单数
         *  RigidBody），进入 `rigidBodyReferenceCountMap`（单数容器），**不进** bundle 容器。
         *  故本数值恒为 0 属正常，不可作为"物理已运行"的断言目标——
         *  改用下方 rigidBodyCount（单数容器）。保留此探针仅供调试观测。 */
        get rigidBodyBundleCount(): number {
            const rt = mmdRuntime;
            if (!rt) {
                return 0;
            }
            const physics = (
                rt as unknown as {
                    physics?: {
                        impl?: { rigidBodyBundleReferenceCountMap?: ReadonlyMap<unknown, number> };
                    };
                }
            ).physics;
            const impl = physics?.impl;
            return impl?.rigidBodyBundleReferenceCountMap?.size ?? 0;
        },

        /** WASM 物理**单数**刚体数（0 = 无自建刚体或 JS 运行时）。
         *  联邦自建刚体（地面碰撞默认开启 / 虚拟裙骨 ADR-084）经 `addRigidBody`
         *  进入 `rigidBodyReferenceCountMap`（单数容器）。注意：虚拟裙骨/地面走的是
         *  单数 RigidBody，**不进** bundle 容器，故 rigidBodyBundleCount 恒为 0 属正常。
         *  此数值 > 0 表示 WASM 物理已运行且联邦自建刚体已登记——
         *  与路径1 风力（getRigidBodyMap）一致，是 e2e 物理健康检查的可靠断言目标。 */
        get rigidBodyCount(): number {
            const rt = mmdRuntime;
            if (!rt) {
                return 0;
            }
            const physics = (
                rt as unknown as {
                    physics?: {
                        impl?: { rigidBodyReferenceCountMap?: ReadonlyMap<unknown, number> };
                    };
                }
            ).physics;
            const impl = physics?.impl;
            return impl?.rigidBodyReferenceCountMap?.size ?? 0;
        },

        /** 风力物理是否已实际订阅（WASM Bullet onSyncObservable） */
        get windPhysicsActive(): boolean {
            return isWindPhysicsActive();
        },

        /** 临时设置风速（E2E 测试用，不持久化） */
        setWindSpeed: (speed: number): void => {
            envState.windSpeed = speed;
            envState.windEnabled = speed > 0;
        },

        /** 获取指定骨骼名的世界位置（用于验证物理是否真的动了骨骼） */
        getBoneWorldPositions: (
            boneNames: string[]
        ): Record<string, { x: number; y: number; z: number } | null> => {
            const inst = focusedModel();
            if (!inst?.mmdModel?.runtimeBones) {
                return {};
            }
            const bones = inst.mmdModel.runtimeBones;
            const result: Record<string, { x: number; y: number; z: number } | null> = {};
            for (const name of boneNames) {
                const bone = bones.find((b: { name: string }) => b.name === name);
                if (!bone) {
                    result[name] = null;
                    continue;
                }
                const wm = (bone as unknown as { worldMatrix: Float32Array }).worldMatrix;
                if (!wm) {
                    result[name] = null;
                    continue;
                }
                result[name] = { x: wm[12], y: wm[13], z: wm[14] };
            }
            return result;
        },
    };
}
