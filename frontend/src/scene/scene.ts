// [doc:architecture] Scene — 3D 场景核心模块（纯组装器）
// 规范文档: docs/architecture.md §渲染环节
// 职责: 导入所有子系统，按正确顺序装配，提供唯一 initScene() 入口
// 注意: 具体逻辑已拆分到子模块，此文件仅负责组合。

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { RenderingManager } from '@babylonjs/core/Rendering/renderingManager';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Particles/webgl2ParticleSystem';

import { RegisterMmdModelLoaders } from 'babylon-mmd/esm/Loader/dynamic';
import { RegisterDxBmpTextureLoader } from 'babylon-mmd/esm/Loader/registerDxBmpTextureLoader';
// MMD 原生描边：side-effect import，把 getMmdOutlineRenderer() 补丁挂到 Scene.prototype。
// 之后带描边(edge)标记的 PMX 材质在 renderOutline=true 时会惰性注册描边组件并渲染轮廓线。
import 'babylon-mmd/esm/Loader/mmdOutlineRenderer';
// SDEF 球面变形：side-effect import，注册 SDEF 着色器变体到 MmdStandardMaterial。
// 网格含 SDEF 顶点数据时自动启用球面变形，关节弯曲更自然；无 SDEF 顶点时零开销。
import 'babylon-mmd/esm/Loader/sdefInjector';
import { GetMmdWasmInstance } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance';
import { MmdWasmInstanceTypeSPR } from 'babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease';
// MPR（多线程 WASM 物理）依赖 SharedArrayBuffer + COOP/COEP 跨源隔离，
// 仅当构建期 VITE_MMD_WASM_MT 定义时才动态拉入（与 Go 端 CoopCoepMiddleware 同轴门控）。
// 默认未定义 → 走 SPR 单线程，且 MPR worker 不被打包（保持 bundle 精简、构建零回归）。
// 注意：MmdWasmInstanceTypeMPR 必须动态 import，静态 import 会把 worker 拉进图导致构建失败。
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { MmdWasmPhysics } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysics';
import 'babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation';
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import { initWindPhysics, disposeWindPhysics } from '../physics/wind-physics';
import { applyGroundCollision } from './physics/ground-collision';
import { swallowError } from '../core/utils';
import { logWarn } from '../core/logger';
import { MmdRuntimeShared } from 'babylon-mmd/esm/Runtime/mmdRuntimeShared';
// JS 版 runtime（无 WASM 双缓冲，worldMatrix 覆写可生效）
import { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { FeetState } from '@/core/types';
import 'babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation';
import 'babylon-mmd/esm/Loader/mmdModelLoader.default';
import '@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader';
import '@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment';

import {
    initEnvFacade,
    applyEnvState,
    _envSys,
    refreshWaterRenderList,
    addRipple,
    disposeEnvUpdateObserver,
} from './env/env';
import { initCameraSystem, autoFrame } from './camera/camera';
import {
    dom,
    setMmdRuntime,
    mmdRuntime,
    modelRegistry,
    setModelRegistry,
    propRegistry,
    envState,
    uiState,
    triggerAutoSave,
    setTriggerAutoSave,
    getMmdRuntimeType,
    focusedModelId,
} from '../core/config';
import { attachBeatDetector, getStreamPlayer } from '../outfit/audio';
import { detectRuntimeMode, persistRuntimeMode, renderRuntimeBadge } from '../core/runtime-mode';
import { _catState, _matState, _matEnabled } from './manager/material';
import { updatePlaybackUI, initPlaybackObservables } from './motion/playback';
import { initLighting, _updateSunDisc } from './render/lighting';
import {
    initRenderer,
    rebuildOutlineState,
    pipeline,
    disposeRenderer,
} from './render/renderer';
import { onModelMeshesReady, disposeReflection } from './env/env-reflection';
import { initLoader, setOnMeshesReady, setOnModelLoaded } from './manager/model-loader';

// Re-export material system (extracted to material.ts for file size)
export {
    _catState,
    _matState,
    _matEnabled,
    _catOf,
    _applyAll,
    isMatEnabled,
    setMatEnabled,
    getMatCatGroups,
    getMatCatParams,
    setMatCatParams,
    resetMatCatParams,
    getMatDetailList,
    getMatParams,
    setMatParams,
    resetSingleMatParams,
    resetAllMatParams,
    getMatState,
    applyMatState,
    registerMaterialTarget,
    unregisterMaterialTarget,
    getMaterialMeshes,
    isMatCategoryAllEnabled,
    setMatCategoryEnabled,
    DEFAULT_MAT_PARAMS,
    applyUnlitFallback,
} from './manager/material';
export type { MaterialCategoryParams, MaterialCategory } from './manager/material';

import { ModelManager } from './manager/model-manager';
import {
    updateProcMotion,
    createProcBeatDetector,
    getProcBeatDetector,
    onModelRemoved,
} from './motion/proc-motion-bridge';
import { triggerAutoSaveImpl } from './scene-serialize';

// ======== Babylon.js ========
// alpha:true 让 WebGL drawing buffer 携带 alpha 通道，使 AR 模式下 scene.clearColor
// 的 a=0 生效（透明 canvas），从而透出底层 <video> 相机画面。非 AR 场景 clearColor
// 的 a=1.0 完全不透明，不受影响。
// [doc:test-isolation] 测试态隔离（审计项 scene.ts:126-131）：vitest 无 WebGL，
// 模块顶层 new Scene(engine) + 相机系统初始化会强制拉起真实 Babylon 场景图与 DOM 依赖，
// 迫使每个 transitively 导入 scene.ts 的测试铺设 engine-mock/babylon-classes。
// 测试态改用引擎无关 Scene（Babylon 官方 offline 模式：new Scene() 不绑定 engine），
// 并跳过相机初始化，使 scene.ts 可零成本导入。生产路径（MODE !== 'test'）完全不变。
const _isTestEnv = import.meta.env.MODE === 'test';

export let engine = new Engine(dom.canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    alpha: true,
});
// 扩展渲染组下限至 -2：天空盒(Group -2)先于体积云(Group -1)先于 Group 0（地面/角色）。
// Babylon 默认 MIN_RENDERINGGROUPS=0 会跳过负数 group，导致负组 mesh 不渲染。
RenderingManager.MIN_RENDERINGGROUPS = -2;
export let scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);

/** disposeScene() 已调用标志，防止重复释放。 */
let _sceneDisposed = false;

/** initScene() 是否已至少执行过一次。首次调用时跳过 scene/engine 重建。 */
let _sceneInitialized = false;

/**
 * 统一应用帧率控制：垂直同步 + 帧率上限。
 * - 垂直同步关闭（vsync=false）：解除本应用层限帧（engine.maxFPS=0）。
 *   注意：浏览器/WebView 渲染循环由 requestAnimationFrame 驱动，天然与显示器刷新同步，
 *   无法在 Web 层真正关闭 vsync；此开关等价于"不施加任何人为限帧"。
 * - 垂直同步开启（默认）：应用帧率上限 fpsLimit（0=不限制=原生刷新同步）。
 */
export function applyFrameControl(): void {
    if (uiState.vsync === false) {
        engine.maxFPS = 0; // 关闭垂直同步：不限帧
        return;
    }
    const limit = uiState.fpsLimit ?? 0;
    engine.maxFPS = limit > 0 ? limit : undefined;
}

/**
 * 级联释放 Scene → Engine 及其所有子资源。
 * - 同步操作，适合在 beforeunload / visibilitychange 中调用以释放 WebGL context。
 * - 幂等：_sceneDisposed 标志防止重复释放。
 * - 释放顺序：子系统 observer → Scene → Engine（WebGL context 最后释放）。
 */
export function disposeScene(): void {
    if (_sceneDisposed) {
        return;
    }
    _sceneDisposed = true;

    // 1. 移除 scene.onDisposeObservable 订阅，避免 scene.dispose() 触发冗余回调
    if (_sceneDisposeObserverHandle) {
        _sceneDisposeObserverHandle = safeDispose(_sceneDisposeObserverHandle);
    }

    // 2. 清理播放相关 observer
    _disposePlaybackObservables?.();
    _disposePlaybackObservables = null;

    // 3. [fix:P3] 释放程序化动作模块（BeatDetector + perception observer）
    import('./motion/proc-motion-bridge')
        .then(({ disposeProcMotion }) => disposeProcMotion())
        .catch(() => {});

    // 4. 释放反射系统、渲染管线、环境更新、物理风系统
    disposeReflection();
    disposeRenderer();
    disposeEnvUpdateObserver();
    disposeWindPhysics();

    // 5. Scene → Engine 级联释放（WebGL 上下文最终释放）
    scene.dispose();
    engine.dispose();
}

export let modelManager: ModelManager;

/** 播放观察者 dispose 函数，场景销毁时调用以清理 observable。 */
let _disposePlaybackObservables: (() => void) | null = null;

/** scene.onDisposeObservable 订阅句柄，HMR 重入时需先移除旧订阅避免累积。 */
let _sceneDisposeObserverHandle: ObserverHandle | null = null;

// Dev debug helper — module-level export for Console inspection (no window pollution)
export const __envDebug = import.meta.env.DEV
    ? () => ({
          clearColor: `rgba(${scene.clearColor.r.toFixed(2)},${scene.clearColor.g.toFixed(2)},${scene.clearColor.b.toFixed(2)},${scene.clearColor.a})`,
          matType: _envSys.sky.skyMesh.material.getClassName() || 'none',
          skyMode: envState.skyMode,
      })
    : undefined;

// 相机系统不依赖 MMD runtime，模块顶层初始化（确保渲染循环启动时有 activeCamera）
// 测试态跳过：无 canvas / 无渲染循环，且降低导入期 DOM 依赖（见 _isTestEnv 注释）
if (!_isTestEnv) {
    initCameraSystem(scene, dom.canvas);
}

// scene-lighting.ts 提供 getLightState / setLightState
// scene-renderer.ts 提供 getRenderState / setRenderState / reattachPipeline

// ======== Convenience getters (delegated to model-ops) ========
export { focusedMmdModel, focusedModel } from './manager/model-ops';

// ======== Init Scene ========
export async function initScene(): Promise<void> {
    // 0. HMR 重入清理：释放上一轮 Scene/Engine 及其子资源，避免 WebGL context 泄漏（ADR-106 D3 / Phase 3）
    //    disposeScene() 幂等处理；首次调用时 _sceneInitialized=false 跳过。
    if (_sceneInitialized) {
        disposeScene();
        _sceneDisposed = false; // 重置标志，允许本轮重建

        // 重建 Engine + Scene（HMR 重入时旧实例已被 disposeScene() 释放）
        engine = new Engine(dom.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
            alpha: true,
        });
        scene = new Scene(engine);
        scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);
        // 重新初始化相机系统（新 scene 实例，需重新绑定 canvas）
        initCameraSystem(scene, dom.canvas);

        // 0b. 额外子模块清理（disposeScene() 未覆盖的 observer / 定时器 / 订阅）
        (await import('./motion/bone-override')).stopBoneOverride();
        (await import('./motion/feet-adjustment')).stopFeetAdjustment();
        (await import('./motion/footstep')).stopFootstep();
        (await import('../core/audio-bus')).disposeAudioBus();
        (await import('../core/reactivity')).unsubscribeAll();
        (await import('./env/env-bridge')).cancelEnvPersistTimer();
        (await import('./env/env')).stopTimeOfDay();
    }

    // 1. MMD 运行时初始化
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy;
    // 运行时切换：默认 WASM（含物理），可在程序化动作菜单切换到 JS 版（调试专用，无物理）
    // JS 版保留作为 gaze 行为对比排查与 WASM 兼容性回退，勿删除
    const useJsRuntime = getMmdRuntimeType() === 'js';
    let runtime: IMmdRuntime;
    if (useJsRuntime) {
        runtime = new MmdRuntime(scene, null);
        logWarn('scene', 'JS 版 MmdRuntime（调试专用，无物理）— 生产请用 WASM');
    } else {
        // MPR（多线程）需 SharedArrayBuffer + COOP/COEP，与 Go 端 CoopCoepMiddleware 同轴门控。
        // __MMD_ENABLE_MPR__ 为构建期常量（vite define）：未定义 VITE_MMD_WASM_MT → false →
        // esbuild 消除本分支，默认构建不含 MPR worker/wasm（零回归、bundle 精简）。
        // 运行时再叠加 crossOriginIsolated 守卫：即便构建带 MPR，若启动进程未注入 COOP/COEP
        // （漏设 VITE_MMD_WASM_MT 环境变量），也优雅回退 SPR，绝不因 SAB 不可用而崩窗。
        const useMultiThread =
            __MMD_ENABLE_MPR__ && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
        let wasmInstance;
        if (useMultiThread) {
            try {
                const { MmdWasmInstanceTypeMPR } =
                    await import('babylon-mmd/esm/Runtime/Optimized/InstanceType/multiPhysicsRelease');
                wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeMPR());
                logWarn('scene', '使用 WASM 版 MmdWasmRuntime（MPR 多线程物理）');
            } catch (e) {
                logWarn('scene', 'MPR 初始化失败，回退 SPR 单线程物理：', e);
                wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
                logWarn('scene', '使用 WASM 版 MmdWasmRuntime（SPR 单线程物理，MPR 回退）');
            }
        } else {
            wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
            logWarn('scene', '使用 WASM 版 MmdWasmRuntime（SPR 单线程物理）');
        }
        // [doc:adr-099] 运行时模式徽标：检测 COI/SAB/MPR 并常驻渲染到右上角 HUD
        // （独立 DOM 元素，不被 setStatus 瞬时消息覆盖；结果持久化，刷新/导航后仍在）。
        const runtimeMode = detectRuntimeMode();
        persistRuntimeMode(runtimeMode);
        renderRuntimeBadge(runtimeMode);
        logWarn(
            'scene',
            `[ADR-099] 验证: crossOriginIsolated=${runtimeMode.coi} SharedArrayBuffer=${runtimeMode.sab} useMultiThread=${useMultiThread} threads=${runtimeMode.threads}`
        );
        const mmdWasmPhysics = new MmdWasmPhysics(scene);
        runtime = new MmdWasmRuntime(wasmInstance, scene, mmdWasmPhysics);
        initWindPhysics(runtime);
        if (_sceneDisposeObserverHandle) {
            _sceneDisposeObserverHandle.dispose();
        }
        _sceneDisposeObserverHandle = observe(scene.onDisposeObservable, () => {
            disposeWindPhysics();
            disposeReflection();
            disposeEnvUpdateObserver();
            disposeRenderer();
        });
    }
    runtime.loggingEnabled = true;
    runtime.register(scene);
    setMmdRuntime(runtime);
    // [adr:ground] 运行时就绪后还原持久化/默认的地面碰撞状态
    applyGroundCollision();
    // 将 StreamAudioPlayer 接入 MMD Runtime，实现原生音画同步
    // （play/pause/seek 由 Runtime 自动管理，无需手动 syncAudioPlayback）
    swallowError(
        Promise.resolve(getStreamPlayer()).then((player) => {
            if (player) {
                runtime.setAudioPlayer(player);
            }
        })
    );
    // [adr-104] 注入 scene 引用到 outfit（破除循环依赖，替代动态 import）。
    // 动态 import + swallowError 彻底规避 scene↔outfit 静态环，与既有模式一致。
    swallowError(import('../outfit/outfit').then((m) => m.setSceneRef(scene)));
    // 同步用户记忆的播放速度到新 runtime，防状态漂移
    swallowError(
        import('../menus/motion-popup').then(({ syncPlaybackSpeedToRuntime }) =>
            syncPlaybackSpeedToRuntime(runtime)
        )
    );
    // [doc:adr-121] 初始化场景级动作意图广播（显式调用，避免模块顶层副作用）
    swallowError(
        import('../menus/motion-popup').then(({ initMotionBroadcast }) => initMotionBroadcast())
    );

    // 2. 各子系统初始化（相机系统已在模块顶层初始化）
    initLighting(scene, modelRegistry, propRegistry, _envSys.shadow, triggerAutoSave);
    initRenderer(scene, modelRegistry, triggerAutoSave);
    initEnvFacade(scene, pipeline);

    // 3. Beat Detector
    const beat = createProcBeatDetector();
    attachBeatDetector(beat);

    // 4. ModelManager（必须在 initLoader 之前初始化）
    //    注意：setTriggerAutoSave 必须在此之后立即调用，
    //    确保所有子系统（loader / lighting / renderer）触发保存时函数已实现。
    modelManager = new ModelManager(scene, triggerAutoSave, autoFrame);
    modelManager.onRemoveModel = (id) => {
        // 程序化动作清理（视线追踪 observer 拆除）必须早于 destroyMmdModel
        // 否则下一帧 observer 同时读到 _procVmdActive=true + mmdModel 已销毁 → skeleton null → TypeError
        // 见 proc-motion-bridge.ts onModelRemoved
        onModelRemoved(id);

        // 同步销毁 MMD 模型：必须在网格释放 / modelRegistry.delete 之前执行
        // （见 model-manager.ts remove() 的调用顺序），且必须早于下方三个 fire-and-forget 清理。
        // 下方动态 import 仅「调度」Promise，其 .then 体在微任务中于本同步块结束后、即 destroyMmdModel 之后才运行。
        const inst = modelRegistry.get(id);
        if (inst?.mmdModel && mmdRuntime) {
            try {
                mmdRuntime.destroyMmdModel(inst.mmdModel);
            } catch (e) {
                logWarn('scene', 'removeModel: destroyMmdModel failed', e);
            }
        }

        // 三个清理均为 fire-and-forget：在 destroyMmdModel 之后（微任务）才真正执行。
        // 显式契约：它们只操作各自独立的 registry（_blenderStates / propRegistry / controllers），
        // 绝不访问已销毁的 mmdModel 或 modelRegistry.get(id)。
        // 若未来修改任一实现、新增对模型的访问，必须先加 modelRegistry.get(id) 守卫。
        // WASM 图层混合器 teardown（observer + evaluator 清理）
        swallowError(
            import('./motion/wasm-layers-blender').then(({ teardownWasmLayersBlender }) => {
                if (scene.isDisposed) {
                    return;
                }
                teardownWasmLayersBlender(id);
            })
        );

        // 解除此模型上的所有骨骼锚定道具
        swallowError(
            import('./env/accessory').then(({ detachModelAccessories }) => {
                if (scene.isDisposed) {
                    return;
                }
                detachModelAccessories(id);
            })
        );

        // ADR-084 P3b: 模型卸载时释放该模型的虚拟裙骨控制器，避免 dispose 泄漏。
        // 经动态 import（motion-cloth-levels 内部仍以 await import 加载 virtual-skirt），
        // 不破坏 ADR-081/084 的 virtual-skirt 非 eager 导入约束。
        swallowError(
            import('../menus/motion-cloth-levels').then(({ disposeVirtualSkirtForModel }) => {
                if (scene.isDisposed) {
                    return;
                }
                disposeVirtualSkirtForModel(id);
            })
        );
    };
    setModelRegistry(modelManager.modelRegistry);
    setTriggerAutoSave(triggerAutoSaveImpl);

    // 5. 注入回调解耦：model-loader / model-manager 不再直接动态导入 renderer / proc-motion-bridge
    setOnMeshesReady((meshes) => onModelMeshesReady(meshes));
    const procMotionMod = await import('./motion/proc-motion-bridge');
    modelManager.onModelFocused = () => procMotionMod.activateGazeTracking();
    setOnModelLoaded(() => procMotionMod.activateGazeTracking());

    // 6. Loader（必须在 modelManager + setTriggerAutoSave 之后）
    // 破除循环依赖：scene.ts 不再静态 import outfit / model-preset，
    // 改在 initScene(async) 内动态 import（同 scene.ts:187，adr-053/adr-064）。
    const outfitMod = await import('../outfit/outfit');
    const presetMod = await import('../menus/model-preset');
    initLoader(
        scene,
        runtime,
        modelManager,
        refreshWaterRenderList,
        presetMod.tryAutoApplyPreset,
        (id: string) => outfitMod.loadOutfits(id).then(() => {}),
        rebuildOutlineState
    );
    _disposePlaybackObservables = initPlaybackObservables(
        runtime,
        modelManager,
        updatePlaybackUI,
        updateProcMotion,
        getProcBeatDetector
    );

    // 6. 应用初始环境状态
    applyEnvState(envState);
    _updateSunDisc();

    // 无 VMD 时也能驱动程序化动作和口型同步 — 已由 onAnimationTickObservable 驱动（playback.ts），
    // 此处不再重复注册，避免每帧两次 updateProcMotion 导致竞态（startProcMotion 反复重载）。
    // scene.onBeforeRenderObservable.add(() => {
    //     swallowError(updateProcMotion());
    // });

    // 点击水面 → 生成涟漪
    scene.onPointerObservable.add((info) => {
        if (info.type !== PointerEventTypes.POINTERDOWN) {
            return;
        }
        if (!envState.waterEnabled) {
            return;
        }
        if (info.pickInfo.hit) {
            return;
        }
        const ray = info.pickInfo.ray;
        if (!ray || ray.direction.y >= 0) {
            return;
        }
        const waterY = envState.waterLevel;
        const camY = scene.activeCamera.globalPosition.y;
        if (camY === undefined || camY <= waterY) {
            return;
        }
        const t = (waterY - ray.origin.y) / ray.direction.y;
        if (t <= 0) {
            return;
        }
        const hit = ray.origin.add(ray.direction.scale(t));
        const half = envState.waterSize / 2;
        if (Math.abs(hit.x) > half || Math.abs(hit.z) > half) {
            return;
        }
        addRipple(hit, 5, 0.6, 2, 2.5);
    }, PointerEventTypes.POINTERDOWN);

    // 7. 脚部调整系统启动（ADR-085）
    // 注册为 Pipeline bone-override 层（order=5），在帧钩子（RIDING=10）之前执行
    const { startFeetAdjustment } = await import('./motion/feet-adjustment');
    startFeetAdjustment(
        (): { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] }[] => {
            const out: { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] }[] =
                [];
            for (const inst of modelRegistry.values()) {
                const bones = inst.mmdModel?.runtimeBones;
                if (bones && bones.length > 0) {
                    out.push({ id: inst.id, feet: inst.feet, runtimeBones: bones });
                }
            }
            return out;
        }
    );

    // 7.5 脚步声系统启动（ADR-088）：消费 feet-adjustment 落地事件发声
    // 必须在 startFeetAdjustment 之后注册（落地事件由脚部跟随产生）
    const { startFootstep } = await import('./motion/footstep');
    startFootstep(scene);

    // 8. Bone Override 系统启动
    // 注册 onBeforeRenderObservable 回调，在动画应用后逐骨骼覆盖
    const { startBoneOverride } = await import('./motion/bone-override');
    startBoneOverride(() => {
        const id = focusedModelId;
        if (!id) {
            return [];
        }
        const inst = modelRegistry.get(id);
        return inst?.mmdModel?.runtimeBones ?? [];
    }, scene);

    // [doc:adr-116] 9. Motion Override Modules 注册（主初始化路径）
    // 必须在 focusModel 可能被调用之前完成；registry 内 setTargetModel/createModule 也有幂等兜底
    const { initMotionModules } = await import('./motion/motion-modules/registry');
    initMotionModules();

    // 标记首次初始化完成，HMR 重入时触发 disposeScene() + 重建路径
    _sceneInitialized = true;

    setTriggerAutoSave(triggerAutoSaveImpl);
}

// ======== 快捷 getter ========
export function getScene(): Scene {
    return scene;
}

// ======== AR Camera Mode (delegated to ar/ar-scene.ts) ========
export { setARMode, takeARScreenshot, isARModeActive } from './ar/ar-scene';

// Re-exports from extracted sub-modules (zero-change for consumers)
export {
    loadVMDMotion,
    loadVMDFromPath,
    loadCameraVmdFromPath,
    loadVPDPose,
} from './motion/vmd-loader';
export { updatePlaybackUI, seekFromEvent, initPlaybackObservables } from './motion/playback';
export {
    dom,
    setStatus,
    formatTime,
    setMmdRuntime,
    mmdRuntime,
    modelRegistry,
    focusedModelId,
    setFocusedModelId,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    setModelRegistry,
    propRegistry,
    envState,
    triggerAutoSave,
    setTriggerAutoSave,
} from '../core/config';
export type { EnvState, ModelInstance, PropInstance } from '../core/config';
export { resolveFileUrl, normPath } from '../core/fileservice';
export {
    pushUndoSnapshot,
    popUndoSnapshot,
    restoreUndoSnapshot,
    offerSceneUndo,
    canUndo,
} from './scene-serialize';
export { applyEnvState } from './env/env';
export * from './motion/proc-motion-bridge';
export * from './motion/lipsync-bridge';
export * from './env/props';
export * from './scene-serialize';
export * from './env/env-bridge';
export * from './render/lighting';
export * from './render/renderer';
export * from './manager/model-ops';
export { loadPMXFile, captureThumbnail, initLoader } from './manager/model-loader';
export {
    initCameraSystem,
    autoFrame,
    getCameraState,
    setCameraState,
    animateCameraVmd,
    loadCameraVmd,
    clearCameraVmd,
    hasCameraVmd,
    getCameraVmdName,
    getCameraVmdPath,
    switchCameraMode,
    getCameraMode,
} from './camera/camera';
export type { CameraState } from './camera/camera';
export {
    syncAudioPlayback,
    loadAudioFile,
    attachBeatDetector,
    disposeAudio,
    isAudioPlaying,
} from '../outfit/audio';
export { SaveThumbnail, SaveLastScene, LoadLastScene, SetEnvState } from '../core/wails-bindings';
export type { LightState, StageLightState } from './render/lighting';
export type { RenderState } from './render/renderer';
