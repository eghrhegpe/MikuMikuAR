// [doc:adr-102] E2E capture + scene inspection hooks (DEV only).
// Split from main.ts (:1063-1171). Pure DEV-side-effect module: it only
// attaches helpers to `window` for Playwright numeric assertions; it has no
// business logic shared with production paths, so it stays out of the Split
// layer's hot import graph.
import { scene, engine, focusedModel, modelManager, isHeadless } from '../scene/scene';
import { loadOutfits, applyOutfitVariant } from '@/scene/manager/outfit';
import { envState, mmdRuntime } from './config';
import {
    isWindPhysicsActive,
    disposeWindPhysics,
    initWindPhysics,
} from '@/scene/physics/wind-physics';
import { removeFocusedModel } from '../scene/manager/model-ops';
import { logInfo } from './logger';
// [doc:adr-229] 通用状态读取器：window.__state 由 menus/menu-schema 经 core/e2e-state-bridge 注入，
// 本模块不再直接 import menu-schema（ADR-238：core 不反向依赖 UI 层）。
import { getE2EStateReader } from './e2e-state-bridge';
// [fix:P1] 守卫域就绪探测：@dom 环境无灯光/管线时写入被拦截（setLightState/setRenderState
// 守卫），e2e 需预检跳过 light./render. 域的动作断言，避免「UI 可操作但 state 未生效」误报。
import { isLightingReady } from '../scene/render/lighting';
import { isRenderReady } from '../scene/render/renderer';
// [fix:P1] 程序化测试 mesh 工厂共享（子代理审核）：dev-hooks 与
// mesh-lifecycle-headless.test.ts 同源调用，消灭双份实现（此前测试复制实现，
// 生产代码真回归抓不到）。Babylon 实现在 test-mesh 内动态 import，不拉渲染器链。
import {
    createTestMesh as createTestMeshShared,
    clearTestMeshes as clearTestMeshesShared,
    TEST_MESH_PREFIX,
} from './test-mesh';

export function setupE2ECapture(): void {
    // [fix:P2] 钩子收敛：原编译期 DEV 门控在 dev 模式恒真，21 个可写全局对任何
    // `npm run dev` 页面裸露。改为双运行时开关：
    //   - __dumpBones：调试钩子，DEV 或 VITE_E2E_MODE 即注入（控制台随时可用）
    //   - e2e 钩子（__capture/__state/__scene）：仅 ?e2e=1（isHeadless，vitePage）
    //     或 VITE_E2E_MODE=true（@webgl 生产构建）注入，普通 dev 页面不再暴露写操作
    const devMode = import.meta.env.DEV || import.meta.env.VITE_E2E_MODE;
    const e2eMode = isHeadless || import.meta.env.VITE_E2E_MODE;
    if (!devMode && !e2eMode) {
        return;
    }

    // [doc:bone-override] 骨骼层级导出钩子（DEV only）
    // 用法：在控制台调用 window.__dumpBones() 获取当前模型的骨骼层级 JSON
    if (devMode) {
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
                return dump;
            });
        };
    }

    // e2e 钩子仅 e2e 模式注入
    if (!e2eMode) {
        return;
    }

    window.__capture = async (): Promise<string> => {
        // [doc:adr-229] headless（NullEngine）无 backbuffer，截图必失败；
        // 视觉断言本就只在 @webgl（真实 WebView2）跑，此处返回空串让 fingerprint/capture 兜底。
        if (isHeadless) {
            return '';
        }
        const { CreateScreenshotAsync } = await import('@babylonjs/core/Misc/screenshotTools');
        // Force a render frame so Babylon writes to the backbuffer
        scene.render();
        return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
    };

    // ======== E2E State Hook (DEV only) ========
    // [doc:adr-229] 通用状态读取器：schema-driven 交互断言（拖滑块/点开关后验证
    // state 生效）。reader 由 menus/menu-schema 经 core/e2e-state-bridge 注入（ADR-238）；
    // setupE2ECapture 执行时若尚未注入则跳过挂载，注入后 menu-schema 侧自行补挂。
    const _reader = getE2EStateReader();
    if (_reader) {
        (window as unknown as Record<string, unknown>).__state = {
            get: (path: string, modelId?: string): unknown => _reader(path, modelId),
            // [fix:P2] 移除 !isHeadless 前短路：initLighting/initRenderer 在 _doInitScene
            // 无条件执行（scene.ts:435/436），NullEngine 下灯光/管线照常创建（probe 实证
            // isLightingReady=true）。前短路使 headless 恒 false → schema-driven 守卫域
            // 永远跳过 → 「越跳过门禁越绿、守卫域 bug 越黑」。现返回真实就绪状态：
            // headless 且 initScene 完成 → true（@dom 全量断言）；未完成 → false（照实跳过）。
            get isLightingReady(): boolean {
                return isLightingReady();
            },
            get isRenderReady(): boolean {
                return isRenderReady();
            },
        };
    }

    // ======== E2E Scene Inspection Hook (DEV only) ========
    // Exposes live Babylon.js scene state for Playwright numeric assertions.
    // Avoids fragile pixel-screenshot comparison for 3D correctness.
    (window as unknown as Record<string, unknown>).__scene = {
        // [fix:P2] 写操作命名空间收敛：驱动性钩子（改场景/模型/物理状态）统一挪到
        // __scene.driver，只读探针（fps/meshCount/currentAnimation/fingerprint 等）
        // 保留在 __scene 顶层——读写分离，防测试误用写钩子做断言。
        driver: {
            // --- Outfit (换装) behavior hook (DEV only, on-strategy per ADR-060) ---
            // Drives the REAL applyOutfitVariant path so E2E can assert a 3D change
            // without fragile 3-4 level menu navigation.
            applyOutfit: (variantName: string): Promise<boolean> => {
                const inst = focusedModel();
                if (!inst) {
                    return Promise.resolve(false);
                }
                return applyOutfitVariant(inst.id, variantName)
                    .then(() => true)
                    .catch(() => false);
            },

            // CI seed model — creates a programmatic Babylon mesh so @webgl E2E tests
            // can assert a real 3D scene without a PMX file on disk.
            // [fix:P1] 委托共享 test-mesh 模块（与单测同源，见 core/test-mesh.ts）。
            createTestMesh: (): Promise<void> => createTestMeshShared(scene),
            clearTestMeshes: (): void => clearTestMeshesShared(scene),

            // ======== Model Lifecycle Hooks (E2E @dom + @webgl) ========
            /** Remove the currently focused model (delegates to removeFocusedModel). */
            removeActiveModel: (): void => {
                removeFocusedModel();
            },

            /** 临时设置风速（E2E 测试用，不持久化） */
            setWindSpeed: (speed: number): void => {
                envState.windSpeed = speed;
                envState.windEnabled = speed > 0;
            },

            /** 重置风力物理订阅状态（E2E 隔离用）：
             *  先清空全部 observer，再对当前 runtime 重新 init。
             *  这样 windPhysicsActive 能证明“本次模型加载是否真的重新订阅”。 */
            resetWindPhysics: (): void => {
                disposeWindPhysics();
                if (mmdRuntime) {
                    initWindPhysics(mmdRuntime);
                }
            },
        },

        get fps(): number {
            return engine.getFps();
        },
        get meshCount(): number {
            // Babylon keeps a flat meshes array (incl. system meshes like
            // ground/helpers). Assert a threshold, not an exact number.
            return scene.meshes.length;
        },
        get testMeshCount(): number {
            // Programmatic seed meshes only: deterministic lifecycle assertions
            // are not disturbed by async background/system mesh creation.
            return scene.meshes.filter((m) => m.name.startsWith(TEST_MESH_PREFIX)).length;
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
