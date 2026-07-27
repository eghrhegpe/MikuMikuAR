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

import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { MmdWasmPhysicsRuntimeImpl } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl';
import type { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';

/** RigidBodyBundle 结构化类型（仅取 wind-physics 实际使用的字段）。 */
export interface RigidBodyBundleLike {
    count: number;
    applyCentralForce(index: number, force: Vector3): void;
}

/**
 * 从 IMmdRuntime 获取底层 MmdWasmPhysicsRuntimeImpl。
 * `.physics` 不在 IMmdRuntime 公开接口（上游最小接口策略，overview §74/§82）。
 * physics 在首个模型加载前可能为 null，需延迟获取。
 */
export function getPhysicsImpl(runtime: IMmdRuntime): MmdWasmPhysicsRuntimeImpl | null {
    const physics = (runtime as unknown as Record<string, unknown>).physics as
        Record<string, unknown> | undefined;
    if (!physics) {
        return null;
    }
    const impl = physics.impl as MmdWasmPhysicsRuntimeImpl | undefined;
    return impl ?? null;
}

/**
 * 从 MmdWasmPhysicsRuntimeImpl 取出所有 RigidBodyBundle 迭代器。
 * 反射访问上游私有字段 `_rigidBodyBundleMap`（Map<RigidBodyBundle, number>）。
 * 字段缺失 / 类型异常时抛错，作为升级回归护栏（绝不静默失效）。
 */
export function getRigidBodyBundleMap(impl: MmdWasmPhysicsRuntimeImpl): Iterable<RigidBodyBundleLike> {
    const map = (impl as unknown as Record<string, unknown>)._rigidBodyBundleMap;
    if (map instanceof Map) {
        return map.keys();
    }
    if (map === undefined) {
        throw new Error(
            'mmd-adapter: _rigidBodyBundleMap 不存在（可能已被 babylon-mmd 重命名）。检查 babylon-mmd 版本兼容性'
        );
    }
    throw new Error('mmd-adapter: _rigidBodyBundleMap 类型异常。检查 babylon-mmd 版本兼容性');
}

/**
 * 从 StreamAudioPlayer 取出内部 HTMLAudioElement（条目 9）。
 * `_audio` 不在公开接口（上游最小接口策略）。不存在时返回 null（降级）。
 */
export function getStreamAudio(player: StreamAudioPlayer): HTMLAudioElement | null {
    const audio = (player as unknown as { _audio?: HTMLAudioElement })._audio;
    return audio ?? null;
}

/**
 * CapabilityProbe — 升级回归探测骨架（Phase 2 能力内化前使用）。
 * 探测上游私有字段是否存在：存在则用之，不存在则走联邦自实现降级路径，
 * 避免「无守卫反射」的静默失效。
 */
export const CapabilityProbe = {
    hasRigidBodyBundleMap(impl: MmdWasmPhysicsRuntimeImpl): boolean {
        return (impl as unknown as Record<string, unknown>)._rigidBodyBundleMap !== undefined;
    },
    hasStreamAudio(player: StreamAudioPlayer): boolean {
        return (player as unknown as { _audio?: HTMLAudioElement })._audio !== undefined;
    },
};

// ======== Phase 1 服务占位（骨架，待实现） ========

/** TODO(Phase 1): 固化 worldMatrix 时序/坐标系契约（条目 12）。
 * 对外提供 getBoneWorldMatrix(bone) + 坐标系转换，内部缓存 + onBeforeRenderObservable invalidate。 */
export interface BoneFrameClock {
    // Phase 1 实现
}

/** TODO(Phase 1): 封装「setRuntimeAnimation + seekAnimation(0)」切换+重置组合（条目 14）。
 * 仅覆盖切换场景（vmd-loader/playback/vmd-layers），不接管快进快退 / auto-loop / seek-to-target。 */
export interface PlaybackContract {
    // Phase 1 实现
}
