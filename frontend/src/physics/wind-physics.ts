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
import { getWindVector, isWindActive } from '../core/physics/wind-utils';

/** 风力系数 — Bullet 刚体质量惯性大，需要比 XPBD 布料更大的系数 */
const WIND_FORCE_SCALE = 0.15;

/** 临时向量，避免每帧分配 */
const _tmpWind = new Vector3();

/** 已订阅的 observer，用于精确移除（不误伤其他订阅者） */
let _observer: { remove(): void } | null = null;
/** monkey-patch 前的原始 createMmdModel，用于 restore */
let _origCreateModel: ((...args: any[]) => any) | null = null;
let _patchedRuntime: IMmdRuntime | null = null;
/** 防止 double-init 导致 restore 链断裂 */
let _initialized = false;

/**
 * 尝试从 MmdWasmRuntime 获取 PhysicsRuntimeImpl。
 * physics impl 在首个模型加载前为 null，需延迟获取。
 */
function _getPhysicsImpl(runtime: IMmdRuntime): MmdWasmPhysicsRuntimeImpl | null {
    const physics = (runtime as any).physics;
    if (!physics) {
        return null;
    }
    // MmdWasmPhysicsRuntime.impl 是 public getter
    const impl = physics.impl;
    return impl ?? null;
}

/**
 * 从 PhysicsRuntimeImpl 获取所有 RigidBodyBundle。
 * 反射访问 _rigidBodyBundleMap（Map<RigidBodyBundle, number>）。
 * babylon-mmd 升级若重命名此字段，降级为空数组并 warn。
 */
function _getBundles(
    impl: MmdWasmPhysicsRuntimeImpl
): Iterable<{ count: number; applyCentralForce(index: number, force: Vector3): void }> {
    const map = (impl as any)._rigidBodyBundleMap;
    if (map instanceof Map) {
        return map.keys();
    }
    // babylon-mmd 升级可能导致字段不存在，warn 一次
    if (map !== undefined) {
        console.warn(
            '[wind-physics] _rigidBodyBundleMap 类型异常，风力物理已禁用。检查 babylon-mmd 版本兼容性'
        );
    }
    return [];
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
 * 由于 physics impl 延迟创建（首个模型加载时），
 * 我们在每次模型加载后重试订阅。
 *
 * 安全性：幂等——重复调用不会重复 patch 或重复订阅。
 */
export function initWindPhysics(runtime: IMmdRuntime): void {
    if (!(runtime instanceof MmdWasmRuntimeClass)) {
        return;
    }
    if (_initialized) {
        return;
    } // 防 double-init 破坏 restore 链

    _initialized = true;

    // 尝试立即订阅（如果 impl 已存在）
    _trySubscribe(runtime);

    // 监听模型创建事件，在新模型加载后重试订阅
    // （physics impl 在首个模型加载时创建）
    _origCreateModel = runtime.createMmdModel.bind(runtime);
    _patchedRuntime = runtime;
    runtime.createMmdModel = function (...args: any[]) {
        const result = _origCreateModel!.call(this, ...args);
        _trySubscribe(runtime);
        return result;
    } as any;
}

function _trySubscribe(runtime: IMmdRuntime): void {
    if (_observer) {
        return;
    } // 已订阅

    const impl = _getPhysicsImpl(runtime);
    if (!impl) {
        return;
    }

    _observer = impl.onSyncObservable.add(() => _onPhysicsSync(impl));
}

/**
 * 销毁风力物理注入。
 * 仅移除自己的 observer，不影响其他 onSyncObservable 订阅者。
 * 恢复 monkey-patched createMmdModel，重置所有状态。
 */
export function disposeWindPhysics(): void {
    if (_observer) {
        _observer.remove();
        _observer = null;
    }
    if (_patchedRuntime && _origCreateModel) {
        (_patchedRuntime as any).createMmdModel = _origCreateModel;
        _origCreateModel = null;
        _patchedRuntime = null;
    }
    _initialized = false;
}

/**
 * 当前运行时是否实际启用了风力物理（WASM Bullet）。
 * 供 UI 层判断是否需要显示"JS 运行时下 Bullet 物理不受风影响"的提示。
 */
export function isWindPhysicsActive(): boolean {
    return _observer !== null;
}
