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
import type { StreamAudioPlayer } from 'babylon-mmd/esm/Runtime/Audio/streamAudioPlayer';
import type { RuntimeModel } from '@/core/types';
import { observe, type ObserverHandle } from '@/core/observer-handle';

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
    const prevAnim = (model as unknown as { currentAnimation?: { dispose?: () => void } | null })
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
