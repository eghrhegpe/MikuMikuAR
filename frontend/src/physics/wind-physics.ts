/**
 * wind-physics.ts — 风力注入 WASM Bullet 物理
 *
 * 通过 MmdWasmPhysicsRuntimeImpl.onSyncObservable 在每次物理步进前
 * 对所有 Dynamic 刚体施加风力，使头发/裙子等物理部件受风影响。
 *
 * 设计约束：
 * - 仅 WASM 运行时生效（JS 运行时无 Bullet 物理，风仍影响粒子/水面）
 * - Kinematic 刚体（骨骼跟随）不受力，Bullet 自动忽略
 * - 刚体索引经 @/core/mmd-adapter 的 getRigidBodyBundleMap 走公开 API
 *   `rigidBodyBundleReferenceCountMap`（ADR-192 Phase 2 已内化），无私有字段依赖
 *
 * 作用范围（ADR-200）：风力同时作用于两类刚体：
 *   1. **自建刚体**（虚拟裙骨 ADR-084 / 地面碰撞）——经 getRigidBodyBundleMap 遍历
 *   2. **模型原生真物理刚体**（头发/裙子 Physics/PhysicsWithBone）——经
 *      applyForceToModelRigidBodies 守卫式反射（FollowBone 跳过）。
 *   虚拟裙骨只对无裙骨模型生效，主流正经模型靠路径 2 受风。
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import { MmdWasmRuntime as MmdWasmRuntimeClass } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import type { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import { getWindVector, isWindActive } from '../core/wind-utils';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { getPhysicsImpl, getRigidBodyBundleMap, applyForceToModelRigidBodies } from '@/core/mmd-adapter';
import { modelRegistry } from '@/core/config';

// 薄转发：保留历史导出名 _getBundles，避免 wind-physics.test.ts 改动（ADR-192 双轨过渡）
export { getRigidBodyBundleMap as _getBundles } from '@/core/mmd-adapter';

/** 风力系数 — Bullet 刚体质量惯性大，需要比 XPBD 布料更大的系数。
 *  0.15 过小（风速 10 时仅 1.5N，对 1kg 刚体加速度 1.5m/s²，肉眼难辨）；
 *  1.0 时风速 10 产生 10N，联邦自建 Dynamic 刚体（虚拟裙骨/地面）摆动明显。
 *  Kinematic 刚体（骨骼跟随）Bullet 自动忽略，无需额外跳过。
 *  此系数用于**自建刚体**（虚拟裙骨 ADR-084 / 地面），其质量/阻尼由联邦自设，1.0 已调好。 */
const WIND_FORCE_SCALE = 1.0;

/** 模型原生刚体专用风力系数（ADR-200）。
 *  MMD 头发/裙子刚体的质量/阻尼由模型作者设定，通常阻尼较高（防抖），
 *  1.0 系数下稳态摆幅偏弱。故原生刚体用独立更大系数，与自建刚体解耦，
 *  互不影响各自已调好的手感。5.0 为经验起点，可按实测在 §ADR-200 §5.1 调整。 */
const MODEL_WIND_FORCE_SCALE = 5.0;

/** 临时向量，避免每帧分配 */
const _tmpWind = new Vector3();
const _tmpModelWind = new Vector3();

/** 每运行时订阅状态：支持多 MmdWasmRuntime 场景（多场景/多窗口） */
interface _WindSub {
    /** 已订阅的 observer，用于精确移除（不误伤其他订阅者） */
    observer: ObserverHandle | null;
}
const _subs = new Map<IMmdRuntime, _WindSub>();

/**
 * physics sync 回调 — 在 Bullet 评估前施加风力。
 * 注意：Buffered 模式下此回调在锁内执行，applyCentralForce 会自动等待锁。
 */
function _onPhysicsSync(impl: MmdWasmPhysicsRuntimeImpl): void {
    if (!isWindActive()) {
        return;
    }

    const wind = getWindVector();
    _tmpWind.copyFrom(wind).scaleInPlace(WIND_FORCE_SCALE);

    // (1) 自建刚体（虚拟裙骨/地面）：经公开 map 遍历
    for (const bundle of getRigidBodyBundleMap(impl)) {
        const count = bundle.count;
        for (let i = 0; i < count; i++) {
            bundle.applyCentralForce(i, _tmpWind);
        }
    }

    // (2) 模型原生真物理刚体（头发/裙子）：经守卫式反射施力（ADR-200），用独立更大系数。
    // 只对 actor（stage 无需风）；applyForceToModelRigidBodies 内部按 physicsMode 筛 Dynamic。
    _tmpModelWind.copyFrom(wind).scaleInPlace(MODEL_WIND_FORCE_SCALE);
    for (const inst of modelRegistry.values()) {
        if (inst.kind !== 'actor' || !inst.mmdModel) {
            continue;
        }
        applyForceToModelRigidBodies(inst.mmdModel, _tmpModelWind);
    }
}

/**
 * 初始化风力物理注入。
 * 在 scene.ts 中 MmdWasmRuntime 创建后调用。
 *
 * 由于 physics impl 延迟创建（首个模型加载时），此处订阅可能失败，
 * 由 model-loader 在模型加载成功后调用 retryWindPhysicsSubscription() 显式重试。
 *
 * 安全性：幂等——重复调用不会重复订阅。
 *
 * [adr-104] 已移除原 monkey-patch createMmdModel 的做法（脆弱，
 * babylon-mmd 内部实现变更即静默失效），改为显式调用点承载。
 */
export function initWindPhysics(runtime: IMmdRuntime): void {
    if (!(runtime instanceof MmdWasmRuntimeClass)) {
        return;
    }
    let sub = _subs.get(runtime);
    if (!sub) {
        sub = { observer: null };
        _subs.set(runtime, sub);
    }
    // 尝试立即订阅（如果 impl 已存在）；否则由 retry 在模型加载后补齐
    _trySubscribe(runtime);
}

/**
 * [adr-104] 模型加载成功后由 model-loader 显式调用，重试订阅 physics impl
 * （此时 physics impl 已就绪）。替代原 monkey-patch createMmdModel 的脆弱做法。
 *
 * @param runtime 指定运行时；省略时重试所有已注册运行时（用于全局重试场景）
 */
export function retryWindPhysicsSubscription(runtime?: IMmdRuntime): void {
    if (runtime) {
        _trySubscribe(runtime);
        return;
    }
    for (const rt of _subs.keys()) {
        _trySubscribe(rt);
    }
}

function _trySubscribe(runtime: IMmdRuntime): void {
    const sub = _subs.get(runtime);
    if (!sub || sub.observer) {
        return;
    } // 已订阅

    const impl = getPhysicsImpl(runtime);
    if (!impl) {
        return;
    }

    sub.observer = observe(impl.onSyncObservable, () => _onPhysicsSync(impl));
}

/**
 * 销毁风力物理注入。
 * 仅移除自己的 observer，不影响其他 onSyncObservable 订阅者。重置所有状态。
 */
export function disposeWindPhysics(): void {
    for (const [, sub] of _subs) {
        if (sub.observer) {
            sub.observer.dispose();
        }
    }
    _subs.clear();
}

/**
 * 当前运行时是否实际启用了风力物理（WASM Bullet）。
 * 供 UI 层判断是否需要显示"JS 运行时下 Bullet 物理不受风影响"的提示。
 */
export function isWindPhysicsActive(): boolean {
    for (const sub of _subs.values()) {
        if (sub.observer) {
            return true;
        }
    }
    return false;
}
