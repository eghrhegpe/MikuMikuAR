/**
 * MmdAdapter — 联邦项目接触 babylon-mmd 的唯一适配边界（ADR-192）。
 *
 * 把所有对 babylon-mmd 私有 / 未公开字段的访问（私有字段反射、类型网关）
 * 集中到本模块，避免脆弱依赖散落多个业务文件。上游 PR 路径关闭后，
 * 联邦对 babylon-mmd 为永久自治下游，本模块是本地应对的收敛点。
 *
 * 已知脆弱点（上游私有 API，版本升级若重命名会失效，已纳入 bump 回归清单）：
 * - IMmdRuntime.physics / MmdWasmPhysicsRuntimeImpl._rigidBodyBundleMap（条目 3，Phase 2 内化）
 * - StreamAudioPlayer._audio（条目 9，Phase 2 内化）
 */

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { IMmdBindableModelAnimation } from 'babylon-mmd/esm/Runtime/Animation/IMmdBindableAnimation';
import type { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import { MmdWasmPhysicsRuntimeImpl as MmdWasmPhysicsRuntimeImplClass } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import type { RigidBodyBundle } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyBundle';
import type { RigidBody } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody';
import type { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import type { RuntimeModel } from '@/core/types';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { logWarn } from '@/core/logger';

/**
 * 从 IMmdRuntime 获取底层 MmdWasmPhysicsRuntimeImpl。
 * `.physics` 不在 IMmdRuntime 公开接口（上游最小接口策略，overview §74/§82）。
 * physics 在首个模型加载前可能为 null，需延迟获取。
 *
 * 【主动创建】WASM 内建物理下，`MmdWasmPhysicsRuntime._impl` 是 lazy 的（nullPhysicsClock
 * 构造时为 null），只有首次 `getImpl(ctor)` 才创建（mmdWasmPhysicsRuntime.js:103-110）。
 * 模型刷开后若无人主动取 impl，被动 `.impl` getter 恒返回 null——这正是 wind-physics
 * `windPhysicsActive === false` 的真因（ADR-200）。故这里若被动 `.impl` 为 null，主动
 * `getImpl(MmdWasmPhysicsRuntimeImpl)` 强制创建（同 virtual-skirt.ts:289 的做法）。
 * 导入的 impl 类其依赖均在 WASM 运行时图内（scene.ts 已加载 MmdWasmRuntime/MmdWasmPhysics），零新增 bundle。
 */
export function getPhysicsImpl(runtime: IMmdRuntime): MmdWasmPhysicsRuntimeImpl | null {
    const physics = (runtime as unknown as Record<string, unknown>).physics as
        | (Record<string, unknown> & {
              getImpl?: (ctor: typeof MmdWasmPhysicsRuntimeImplClass) => MmdWasmPhysicsRuntimeImpl;
          })
        | undefined;
    if (!physics) {
        return null;
    }
    const passive = physics.impl as MmdWasmPhysicsRuntimeImpl | undefined | null;
    if (passive) {
        return passive;
    }
    // 被动 impl 为 null：主动触发 lazy 创建（与 virtual-skirt 一致）
    if (typeof physics.getImpl === 'function') {
        return physics.getImpl(MmdWasmPhysicsRuntimeImplClass) ?? null;
    }
    return null;
}

/**
 * 返回所有 RigidBodyBundle 迭代器（条目 3 内化，ADR-192 Phase 2）。
 *
 * 使用上游公开属性 `rigidBodyBundleReferenceCountMap`（key 同为 RigidBodyBundle），
 * 替代原对私有字段 `_rigidBodyBundleMap` 的反射——彻底脱离上游私有字段依赖。
 * 返回类型从内部 `RigidBodyBundleLike` 提升为上游公开 `RigidBodyBundle`，
 * wind-physics 直接调用其公开 `count` / `applyCentralForce`。
 *
 * 该属性是上游公开契约（mmdWasmPhysicsRuntimeImpl.d.ts:233），babylon-mmd 升级时稳定。
 *
 * ⚠️ 语义澄清（ADR-200）：此 map **只含 JS 侧经 `addRigidBodyBundle` 手动加入的刚体**
 * （虚拟裙骨 ADR-084 / 地面碰撞 ground-collision.ts）。模型自带的 PMX 刚体走
 * `MmdWasmModel._physicsModel.buildPhysics(...)` 独立构建，绕过本 map，恒不在此。
 * 故 wind-physics 遍历此 map 施力对**角色原生头发/裙子无效**——那些刚体在 WASM C++ 侧，
 * JS 无公开句柄。切勿假设本 map 含模型刚体（ADR-192 条目 3 内化时的隐含误解）。
 */
export function getRigidBodyBundleMap(impl: MmdWasmPhysicsRuntimeImpl): Iterable<RigidBodyBundle> {
    return impl.rigidBodyBundleReferenceCountMap.keys();
}

/**
 * 返回所有**单数** RigidBody 迭代器（路径1 修正，ADR-200）。
 *
 * 与 getRigidBodyBundleMap **平行但作用于不同的容器**：
 * - `rigidBodyBundleReferenceCountMap`（bundle 容器）：仅含 JS 侧经 `addRigidBodyBundle`
 *   手动加入的刚体。联邦当前**无任何处**调用 `addRigidBodyBundle`（virtual-skirt.ts /
 *   ground-collision.ts 均用单数 `addRigidBody` / `addRigidBodyToGlobal`），
 *   故该容器恒空——这正是 `window.__scene.rigidBodyBundleCount === 0` 的真因。
 * - `rigidBodyReferenceCountMap`（单数容器）：含经 `addRigidBody` /
 *   `addRigidBodyToGlobal` 加入的刚体——**虚拟裙骨 ADR-084 与地面碰撞正是走这里**。
 *
 * 原 wind-physics 仅遍历 bundle 容器，导致联邦自建刚体恒为 0 施力目标。
 * 本访问器补齐单数侧，使风力能作用于联邦自建 Dynamic 刚体（体/地面）。
 *
 * 属性 `rigidBodyReferenceCountMap` 是上游公开契约（mmdWasmPhysicsRuntimeImpl.d.ts），
 * 与 bundle 容器同源，升级稳定。
 */
export function getRigidBodyMap(impl: MmdWasmPhysicsRuntimeImpl): Iterable<RigidBody> {
    return impl.rigidBodyReferenceCountMap.keys();
}

/**
 * 从 StreamAudioPlayer 取出内部 HTMLAudioElement（条目 9）。
 *
 * [_audio 是上游私有字段，且 StreamAudioPlayer 构造不接收外部 audio 元素注入，
 * 故 WebAudio 处理（fade GainNode / beatDetector.attach / ended 监听）必须反射 _audio。
 * 属「守卫式反射」而非能力内化——上游不提供公开替代 API（经 Phase 2 调研确认）。]
 *
 * 若 _audio 缺失（上游重命名/移除），降级返回 null，且首次仅打一次 dev 警告，
 * 使 babylon-mmd 升级回归立即可见（绝不静默失效）。
 */
let _streamAudioMissingWarned = false;
export function getStreamAudio(player: StreamAudioPlayer): HTMLAudioElement | null {
    // ADR-202 P2（条目 9）: fork 已暴露 `get audio()`（postinstall 注入到 1.2.0），
    // 改用公开只读 getter 替代 `_audio` 反射。保留降级：若 patch 未生效（纯官方版）
    // 则 player.audio 为 undefined → 首次打一次 dev 警告，升级回归可见。
    const audio = (player as unknown as { audio?: HTMLAudioElement }).audio;
    if (audio === undefined && !_streamAudioMissingWarned) {
        _streamAudioMissingWarned = true;
        logWarn(
            'mmd-adapter',
            'StreamAudioPlayer.audio 缺失（postinstall patch 未生效或上游移除）。音频 WebAudio 处理（fade/beat/ended）将降级。检查 apply-vendored-wasm.mjs 与 babylon-mmd 版本兼容性'
        );
    }
    return audio ?? null;
}

/**
 * 向模型自带的真物理刚体（头发/裙子等）施加中心力（ADR-200 守卫式反射）。
 *
 * 【背景】模型 PMX 刚体经 `MmdWasmModel._physicsModel.buildPhysics(...)` 在 WASM 侧构建，
 * 不进 `rigidBodyBundleReferenceCountMap`（详见 getRigidBodyBundleMap 注释），且 `MmdWasmModel`
 * 只暴露只读 `rigidBodyStates`，无公开施力 API。故必须反射两层私有字段
 * `_physicsModel`（MmdBulletPhysicsModel）→ `._bundle`（MmdRigidBodyBundle，含公开 `count` /
 * `applyCentralForce` + `rigidBodyData[]`）。属「守卫式反射」，同条目9 `_audio`。
 *
 * 【筛选】仅对真物理刚体施力：`physicsMode !== FollowBone(0)`（即 Physics(1) /
 * PhysicsWithBone(2)）。FollowBone 刚体每帧被 syncBodies 的 `setTransformMatrix` 强制设为
 * 骨骼变换，施力立即被覆盖（无效）。判据来源：mmdBulletPhysics.js:150-151 官方注释 +
 * :335-346 syncBodies 分支（正常播放时 Physics/PhysicsWithBone 仅 break，纯 Bullet 自解算）。
 * FollowBone=0 常量本地定义（避免引 pmxObject loader 深路径），来源 PmxObject.RigidBody.PhysicsMode。
 *
 * 【降级】`_physicsModel` 或 `._bundle` 缺失（上游重命名/物理未构建）→ 返回 0，
 * 首次仅打一次 dev 警告，使 babylon-mmd 升级回归立即可见（绝不静默失效）。
 *
 * @returns 实际施力的刚体数（降级或无真物理刚体时为 0）
 */
const FOLLOW_BONE = 0; // PmxObject.RigidBody.PhysicsMode.FollowBone

interface _ModelBundleLike {
    count: number;
    rigidBodyData: ReadonlyArray<{ physicsMode: number }>;
    applyCentralForce(index: number, force: Vector3): void;
}
interface _PhysicsModelLike {
    _bundle: _ModelBundleLike | null;
}

function _getModelBundle(model: RuntimeModel): _ModelBundleLike | null {
    const pm = (model as unknown as { _physicsModel?: _PhysicsModelLike })._physicsModel;
    return pm?._bundle ?? null;
}

let _modelPhysicsMissingWarned = false;
export function applyForceToModelRigidBodies(model: RuntimeModel, force: Vector3): number {
    const bundle = _getModelBundle(model);
    if (!bundle) {
        if (!_modelPhysicsMissingWarned) {
            _modelPhysicsMissingWarned = true;
            logWarn(
                'mmd-adapter',
                'MmdWasmModel._physicsModel._bundle 缺失（可能已被 babylon-mmd 重命名，或模型未构建物理）。风力将不作用于模型原生刚体。检查 babylon-mmd 版本兼容性'
            );
        }
        return 0;
    }
    let applied = 0;
    const count = bundle.count;
    const data = bundle.rigidBodyData;
    for (let i = 0; i < count; i++) {
        // 仅真物理刚体（Physics/PhysicsWithBone）受力；FollowBone 每帧被骨骼变换覆盖，跳过
        if (data[i]?.physicsMode !== FOLLOW_BONE) {
            bundle.applyCentralForce(i, force);
            applied++;
        }
    }
    return applied;
}

/**
 * 向模型原生真物理刚体（头发/裙子）施加中心力 —— P2（ADR-201）。
 *
 * 旧版 applyForceToModelRigidBodies 经反射 `_physicsModel._bundle`，
 * 在 WASM 内建物理下 _physicsModel 恒为 null → 返回 0（死路，见 ADR-200）。
 *
 * 本函数改走 fork 新增的 wasm 导出（getMmdModelRigidBodyBundleLen /
 * mmdModelRigidBodyApplyCentralForce，ADR-201）：从 model.ptr 直接在 wasm 侧
 * 解析原生 bundle 并施力，JS 不持有 bundle ptr——彻底避开 RigidBodyBundle
 * 析构调 destroyRigidBodyBundle 摧毁模型原生物理的隐患（2B 方案）。
 *
 * FollowBone 刚体由 wasm 侧跳过（其变换由骨骼驱动，施力每帧被覆盖）。
 *
 * 升级回归：若 wasm 实例缺少这两个导出（babylon-mmd 未含 P2 补丁），
 * 首次仅打一次 dev 警告并返回 0（绝不静默失效，使升级回归立即可见）。
 *
 * @param wasmInstance  MmdWasmPhysicsRuntimeImpl.wasmInstance（含 P2 导出）
 * @param model          RuntimeModel（MmdWasmModel，需有 .ptr）
 * @param force         世界坐标系下的风力向量
 * @returns 原生刚体总数（含 FollowBone；其施力在 wasm 侧被跳过）
 */
let _nativeMissingWarned = false;
export function applyForceToModelRigidBodiesNative(
    wasmInstance: unknown,
    model: RuntimeModel,
    force: Vector3
): number {
    const wi = wasmInstance as Record<string, unknown> | null;
    if (
        !wi ||
        typeof wi.getMmdModelRigidBodyBundleLen !== 'function' ||
        typeof wi.mmdModelRigidBodyApplyCentralForce !== 'function'
    ) {
        if (!_nativeMissingWarned) {
            _nativeMissingWarned = true;
            logWarn(
                'mmd-adapter',
                'wasm 实例缺少 getMmdModelRigidBodyBundleLen / mmdModelRigidBodyApplyCentralForce 导出（babylon-mmd 未含 P2 补丁）。风力将不作用于模型原生刚体。检查 babylon-mmd 构建是否含 ADR-201。'
            );
        }
        return 0;
    }
    const ptr = (model as unknown as { ptr?: number }).ptr;
    if (typeof ptr !== 'number') {
        return 0;
    }
    const len = (wi.getMmdModelRigidBodyBundleLen as (p: number) => number)(ptr);
    if (len <= 0) {
        return 0;
    }
    const apply = wi.mmdModelRigidBodyApplyCentralForce as (
        p: number,
        i: number,
        x: number,
        y: number,
        z: number
    ) => void;
    for (let i = 0; i < len; i++) {
        apply(ptr, i, force.x, force.y, force.z);
    }
    return len;
}

/**
 * [ADR-202 A-class] WASM 模式下手工触发 IK 重解。
 *
 * WASM 运行时的 MmdWasmRuntimeBone 暴露 ikSolverIndex（而非 ikSolver 字段），
 * 故 bone-override 的 applyBoneOverrideIK 无法像 JS 模式那样调用 solver.solve()。
 * 本函数经 fork 新增的 mmdModelSolveIk 导出，从 model.ptr 直接在 wasm 侧调用
 * MmdModel::solve_ik，使骨骼覆盖后能重解 IK（如骑乘姿势覆盖膝盖后重解足部 IK）。
 *
 * 升级回归守卫：若 wasm 实例缺少 mmdModelSolveIk 导出（babylon-mmd 未含 ADR-202
 * A-class 补丁），首次仅打一次 dev 警告并返回 false（绝不静默失效）。
 *
 * @param wasmInstance   MmdWasmPhysicsRuntimeImpl.wasmInstance（含 ADR-202 导出）
 * @param model          RuntimeModel（MmdWasmModel，需有 .ptr）
 * @param ikSolverIndex  目标骨骼的 ikSolverIndex（来自 MmdWasmRuntimeBone.ikSolverIndex；-1=无求解器）
 * @param usePhysics     是否启用物理感知 IK（false 匹配 JS solver.solve(false) 语义）
 * @returns true=已调用 wasm 侧 solve_ik；false=缺导出或 model.ptr 不可用
 */
let _solveIkMissingWarned = false;
export function solveIkNative(
    wasmInstance: unknown,
    model: RuntimeModel,
    ikSolverIndex: number,
    usePhysics: boolean
): boolean {
    const wi = wasmInstance as Record<string, unknown> | null;
    if (!wi || typeof wi.mmdModelSolveIk !== 'function') {
        if (!_solveIkMissingWarned) {
            _solveIkMissingWarned = true;
            logWarn(
                'mmd-adapter',
                'wasm 实例缺少 mmdModelSolveIk 导出（babylon-mmd 未含 ADR-202 A-class 补丁）。骨骼覆盖后无法重解 IK。检查 vendor wasm 是否已同步至含 mmdModelSolveIk 的构建。'
            );
        }
        return false;
    }
    if (ikSolverIndex < 0) {
        return false; // 无 IK 求解器挂载（哨兵值 -1），非错误
    }
    const ptr = (model as unknown as { ptr?: number }).ptr;
    if (typeof ptr !== 'number') {
        return false;
    }
    (wi.mmdModelSolveIk as (p: number, i: number, u: boolean) => void)(ptr, ikSolverIndex, usePhysics);
    return true;
}

/**
 * [ADR-200 wind mass-aware] 质量感知批量风力施加。
 *
 * 旧版 applyForceToModelRigidBodiesNative 对所有原生刚体施加相同风力，
 * 轻质量头发刚体（0.05-0.2kg）被放大成发散摆动（"乱飘、拉到最长"）。
 * 本函数改走 fork 新增的 mmdModelRigidBodyApplyWindForce 导出，wasm 侧遍历
 * 所有原生刚体，按 mass/reference_mass 缩放风力：重质量（衣服）满力，
 * 轻质量（头发）自动降力，min_scale 兜底避免极轻刚体完全无力。
 *
 * 升级回归守卫：若 wasm 实例缺少 mmdModelRigidBodyApplyWindForce 导出，
 * 首次仅打一次 dev 警告并返回 0（绝不静默失效）。
 *
 * @param wasmInstance    MmdWasmPhysicsRuntimeImpl.wasmInstance（含 wind mass-aware 导出）
 * @param model           RuntimeModel（MmdWasmModel，需有 .ptr）
 * @param force           世界坐标系下的风力向量（已含全局系数，如 MODEL_WIND_FORCE_SCALE）
 * @param referenceMass   参考质量（kg），mass >= 此值的刚体获满力；典型 1.0（衣服质量）
 * @param minScale        最小缩放系数，避免极轻刚体完全无力；典型 0.2
 * @returns wasm 侧处理的刚体总数（含 FollowBone，其施力在 wasm 侧被跳过）；0=缺导出或无 bundle
 */
let _windForceMissingWarned = false;
export function applyWindForceToModelRigidBodiesNative(
    wasmInstance: unknown,
    model: RuntimeModel,
    force: Vector3,
    referenceMass: number,
    minScale: number
): number {
    const wi = wasmInstance as Record<string, unknown> | null;
    if (!wi || typeof wi.mmdModelRigidBodyApplyWindForce !== 'function') {
        if (!_windForceMissingWarned) {
            _windForceMissingWarned = true;
            logWarn(
                'mmd-adapter',
                'wasm 实例缺少 mmdModelRigidBodyApplyWindForce 导出（babylon-mmd 未含 wind mass-aware 补丁）。降级为无质量感知风力，头发可能乱飘。检查 vendor wasm 是否已同步。'
            );
        }
        return 0;
    }
    const ptr = (model as unknown as { ptr?: number }).ptr;
    if (typeof ptr !== 'number') {
        return 0;
    }
    // 先取 bundle len 用于返回值（wasm 导出不返回数量，需另调 getMmdModelRigidBodyBundleLen）
    const len = (wi.getMmdModelRigidBodyBundleLen as (p: number) => number)(ptr);
    if (len <= 0) {
        return 0;
    }
    (wi.mmdModelRigidBodyApplyWindForce as (
        p: number,
        fx: number,
        fy: number,
        fz: number,
        rm: number,
        ms: number
    ) => void)(ptr, force.x, force.y, force.z, referenceMass, minScale);
    return len;
}

/**
 * CapabilityProbe — 升级回归探测（ADR-192 Phase 2 守卫式反射）。
 * 条目 3 已通过公开 API 内化，不再需要探测；
 * 条目 9 仍依赖私有 _audio，探测用于在升级时确认字段存在。
 */
export const CapabilityProbe = {
    hasStreamAudio(player: StreamAudioPlayer): boolean {
        return (player as unknown as { audio?: HTMLAudioElement }).audio !== undefined;
    },
    hasModelPhysicsBundle(model: RuntimeModel): boolean {
        return _getModelBundle(model) !== null;
    },
};

// ======== Phase 1：时序 / 坐标系契约固化（条目 12）+ 切换契约（条目 14） ========

/**
 * 在骨骼 worldMatrix 已被 babylon-mmd 更新之后、渲染之前注册回调。
 *
 * 时序契约（固化自 lighting.ts / perception-gaze.ts 的逆工程注释）：
 * babylon-mmd 在 scene.onBeforeRenderObservable 中更新骨骼 worldMatrix，
 * 而 onAfterAnimationsObservable 在 onBeforeRenderObservable 『之前』触发。
 * 因此读取本帧骨骼矩阵必须在 onBeforeRenderObservable（或之后）注册回调，
 * 否则读到的是上一帧旧值。
 *
 * 这是「逆工程行为」固化点：集中此处，业务代码不再各自注释时序陷阱。
 */
export function onBoneMatricesUpdated(scene: Scene, callback: () => void): ObserverHandle {
    return observe(scene.onBeforeRenderObservable, callback);
}

/**
 * 把世界坐标系下的点转换到 rootMesh 局部坐标系（固化自 perception-gaze.ts / adr-071）。
 *
 * 坐标系契约：babylon-mmd 的骨骼 worldMatrix 是 rootMesh 局部坐标系
 * （不含 rootMesh 的 scaling/rotation/translation），而相机 position 是世界坐标系。
 * 若模型有 autoScale 或位置偏移，两者不一致会导致依赖骨骼世界位置的逻辑出错。
 *
 * 返回 false 表示 mesh 无可用 worldMatrix（降级：不转换）。
 */
export function transformWorldToRootLocal(
    mesh: { getWorldMatrix?: () => unknown },
    target: Vector3
): boolean {
    const getWM = mesh.getWorldMatrix;
    if (!getWM) {
        return false;
    }
    const rootWorld = getWM.call(mesh) as Matrix | null;
    if (!rootWorld) {
        return false;
    }
    const invRoot = Matrix.Invert(rootWorld);
    Vector3.TransformCoordinatesToRef(target, invRoot, target);
    return true;
}

/**
 * 返回骨骼在世界坐标系下的 worldMatrix（固化自 adr-071 坐标系契约）。
 *
 * babylon-mmd 的 IMmdRuntimeBone.worldMatrix 是 rootMesh 局部坐标系，
 * 本函数乘以 rootMesh 的世界矩阵，得到世界坐标系矩阵，使调用方无需自行处理坐标系陷阱。
 *
 * 注意：每次调用分配新 Matrix。当前仅在非热路径使用；若需每帧批量读取，
 * 应改用缓存策略（见 ADR-192「BoneFrameClock 缓存优化」项）。
 */
export function getBoneWorldMatrix(
    bone: IMmdRuntimeBone,
    rootMesh: { getWorldMatrix: () => Matrix }
): Matrix {
    const local = Matrix.FromArray(bone.worldMatrix);
    const rootWorld = rootMesh.getWorldMatrix();
    return local.multiply(rootWorld);
}

/**
 * 切换模型当前动画到新动画，并归零运行时全局时钟到第 0 帧。
 *
 * 固化自 vmd-loader.ts / vmd-layers.ts 的「切换+重置」散落补丁（条目 14）：
 * 1. babylon-mmd 的 setRuntimeAnimation 只换动画句柄、不重置 _currentFrameTime。
 *    若上一动作播到 50s、新动作仅 10s，陈旧时钟越过新时长 → 下一帧 beforePhysics
 *    立即 pause → 表现为「0.01s 后被重置为无动作」。必须 seekAnimation(0, true) 归零。
 * 2. setRuntimeAnimation(null) 仅解绑、不释放 WASM buffer；必须显式 dispose 旧
 *    runtime animation 句柄（其内部 onDispose 回调回收 WASM AnimCurve 资源），否则泄漏。
 * 3. 旧句柄经私有字段 currentAnimation 取出（上游类型未暴露，A 类 augmentation），此处收口该 cast。
 *
 * 不接管：auto-loop 回绕（playback.ts:101，无 setRuntimeAnimation）、快进快退、
 * seek-to-target（shortcut-app / playback.ts:191）。这些是正常播放控制，非切换 bug workaround。
 *
 * @param runtime    MmdRuntime（用于 seekAnimation 归零时钟）
 * @param model      MmdModel（绑定目标）
 * @param animation  新动画（IMmdBindableModelAnimation，vmd-loader 的 runtimeAnimation / vmd-layers 的 composite 均满足）
 */
export async function switchAnimation(
    runtime: IMmdRuntime,
    model: RuntimeModel,
    animation: IMmdBindableModelAnimation
): Promise<void> {
    // 1. 取出并释放旧句柄（私有字段 currentAnimation，A 类 augmentation）
    const prevAnim =
        (model as unknown as { currentAnimation?: { dispose?: () => void } | null })
            .currentAnimation ?? null;
    // 2. 解绑旧动画（不释放 WASM buffer）
    model.setRuntimeAnimation(null);
    // 3. 释放旧句柄，回收 WASM AnimCurve 资源
    if (prevAnim) {
        try {
            prevAnim.dispose?.();
        } catch {
            // 旧动画句柄清理失败不影响本次绑定
        }
    }
    // 4. 创建并绑定新动画
    const handle = model.createRuntimeAnimation(animation);
    model.setRuntimeAnimation(handle);
    // 5. 归零运行时全局时钟到第 0 帧（不改变 _animationPaused）
    try {
        await runtime.seekAnimation(0, true);
    } catch {
        // 归零失败不影响动作绑定，下一帧主循环会纠正
    }
}
