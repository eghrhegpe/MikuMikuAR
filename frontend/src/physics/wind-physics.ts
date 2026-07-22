/**
 * wind-physics.ts — 风力注入 WASM Bullet 物理
 *
 * 通过 MmdWasmPhysicsRuntimeImpl.onSyncObservable 在每次物理步进前
 * 对所有 Dynamic 刚体施加风力，使头发/裙子等物理部件受风影响。
 *
 * 设计约束：
 * - 仅 WASM 运行时生效（JS 运行时无 Bullet 物理，风仍影响 XPBD 布料/粒子）
 * - Kinematic 刚体（骨骼跟随）不受力，Bullet 自动忽略
 * - 通过反射访问 babylon-mmd 内部字段（_rigidBodyBundleMap），
 *   babylon-mmd 升级时若字段重命名会静默降级（空数组→风力消失），
 *   此时需检查 babylon-mmd Physics/Bind/Impl/physicsRuntime.d.ts 更新适配
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import { MmdWasmRuntime as MmdWasmRuntimeClass } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import type { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import { getWindVector, isWindActive } from '../core/wind-utils';
import { observe, type ObserverHandle } from '@/core/observer-handle';

/** 风力系数 — Bullet 刚体质量惯性大，需要比 XPBD 布料更大的系数 */
const WIND_FORCE_SCALE = 0.15;

/** 临时向量，避免每帧分配 */
const _tmpWind = new Vector3();

/** 每运行时订阅状态：支持多 MmdWasmRuntime 场景（多场景/多窗口） */
interface _WindSub {
    /** 已订阅的 observer，用于精确移除（不误伤其他订阅者） */
    observer: ObserverHandle | null;
}
const _subs = new Map<IMmdRuntime, _WindSub>();

/**
 * 尝试从 MmdWasmRuntime 获取 PhysicsRuntimeImpl。
 * physics impl 在首个模型加载前为 null，需延迟获取。
 */
function _getPhysicsImpl(runtime: IMmdRuntime): MmdWasmPhysicsRuntimeImpl | null {
    const physics = (runtime as unknown as Record<string, unknown>).physics as
        Record<string, unknown> | undefined;
    if (!physics) {
        return null;
    }
    // MmdWasmPhysicsRuntime.impl 是 public getter
    const impl = physics.impl as MmdWasmPhysicsRuntimeImpl | undefined;
    return impl ?? null;
}

/**
 * 从 PhysicsRuntimeImpl 获取所有 RigidBodyBundle。
 * 反射访问 _rigidBodyBundleMap（Map<RigidBodyBundle, number>）。
 * babylon-mmd 升级若重命名此字段，直接抛错。
 */
export function _getBundles(
    impl: MmdWasmPhysicsRuntimeImpl
): Iterable<{ count: number; applyCentralForce(index: number, force: Vector3): void }> {
    const map = (impl as unknown as Record<string, unknown>)._rigidBodyBundleMap;
    if (map instanceof Map) {
        return map.keys();
    }
    // babylon-mmd 升级可能重命名/移除该字段：直接抛错
    if (map === undefined) {
        throw new Error(
            'wind-physics: _rigidBodyBundleMap 不存在（可能已被 babylon-mmd 重命名）。检查 babylon-mmd 版本兼容性'
        );
    }
    throw new Error('wind-physics: _rigidBodyBundleMap 类型异常。检查 babylon-mmd 版本兼容性');
}

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

    for (const bundle of _getBundles(impl)) {
        const count = bundle.count;
        for (let i = 0; i < count; i++) {
            bundle.applyCentralForce(i, _tmpWind);
        }
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

    const impl = _getPhysicsImpl(runtime);
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
