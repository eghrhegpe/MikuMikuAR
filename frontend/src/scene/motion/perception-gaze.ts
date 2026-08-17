// [doc:adr-071] 感知层 — 视线追踪调度入口（头部跟随 + 眼部跟随，WASM/JS 双路径派发）
// 共用骨架（钳制 / 写入策略 / *_GazeCore）→ perception-gaze-core.ts
// WASM 路径实现 → perception-gaze-wasm.ts
// JS   路径实现 → perception-gaze-js.ts
//
// [doc:adr-271] 本文件只保留「选路径 + 派发」两件事。原先骨架也定义在这里，
// 而骨架又要被 js/wasm 两个实现模块 import → `gaze → js/wasm → gaze` size=3 环。
// 骨架下移到 core 叶子后，依赖方向变为 `gaze → core ← js/wasm`（单向漏斗）。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

// [doc:adr-238] isARActive 经 scene-action-bridge 查询（ar-camera 注册），切断 scene/motion→scene/ar
import { getSceneAction } from '@/core/scene-action-bridge';
import { transformWorldToRootLocal } from '@/core/mmd-adapter';
import type {
    MeshMetadata,
    GazeConfig,
    MmdModelLike,
    PerceptionTier,
    GazeCache,
} from './perception-shared';
import { _v3, _isWasmRuntime } from './perception-shared';

// [doc:adr-271] 骨架在 core 叶子；只转发对外仍有消费者的两个符号
// （perception.ts 与 perception-gaze.test.ts 从本文件取它们），
// 其余 core 符号由 js/wasm 实现模块直连 core，不在此转发（避免死导出）。
import { _clampHeadGazeTarget, _clampEyeGazeTarget } from './perception-gaze-core';
export { _clampHeadGazeTarget, _clampEyeGazeTarget } from './perception-gaze-core';

import { _applyHeadGazeWasm, _applyEyeGazeWasm } from './perception-gaze-wasm';
import { _applyHeadGazeJS, _applyEyeGazeJS } from './perception-gaze-js';

// ── AR 模式视线距离（米） ──
const AR_GAZE_DISTANCE = 1.5;

/** 获取视线目标点（AR 模式沿相机朝向投射，普通模式用相机位置） */
export function _getGazeTarget(cam: Camera, out: Vector3): Vector3 {
    if (getSceneAction('isARActive')?.() ?? false) {
        const forward = cam.getDirection(Vector3.Forward());
        out.copyFrom(cam.position);
        out.addInPlace(forward.scale(AR_GAZE_DISTANCE));
        return out;
    }
    out.copyFrom(cam.position);
    return out;
}

/**
 * [adr-071] 坐标系对齐：把世界坐标系下的 gazeTarget 转换到 rootMesh 局部坐标系。
 *
 * babylon-mmd 的骨骼 worldMatrix 是 rootMesh 局部坐标系（不含 rootMesh 的 scaling/rotation/translation），
 * 而相机 position 是世界坐标系。若模型有 autoScale 或位置偏移，两个坐标系不一致，
 * 会导致 gaze 方向计算错误（典型症状：眼睛看向角色原始正前方而非相机）。
 *
 * 此函数原地修改 target，使其与骨骼 worldMatrix 在同一坐标系。
 */
function _worldToLocalGazeTarget(mmdModel: MmdModelLike, target: Vector3): void {
    // [adr-071] 坐标系对齐：骨骼 worldMatrix 是 rootMesh 局部坐标系，相机是世界系，
    // 需把 gazeTarget 转到 rootMesh 局部坐标系（固化于 mmd-adapter 的
    // transformWorldToRootLocal —— ADR-192 条目 12 规划的服务名为 BoneFrameClock，
    // 实际落地为该自由函数，全仓无同名类）。
    transformWorldToRootLocal(mmdModel.mesh, target);
}

/** 统一调度入口（perception.ts observer 调用） */
export function _applyGaze(
    mmdModel: MmdModelLike,
    cam: Camera,
    config: { headEnabled: boolean; eyeEnabled: boolean },
    dt: number,
    headClaimed?: readonly string[],
    eyeClaimed?: readonly string[],
    tier?: PerceptionTier,
    cache?: GazeCache
): void {
    // [doc:adr-164] tier 守卫：low 跳过
    if (tier === 'low') {
        return;
    }

    if (!config.headEnabled && !config.eyeEnabled) {
        return;
    }

    const headRuntime = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) =>
        HEAD_BONE_CANDIDATES.includes(b.name)
    );
    const eyeRuntimes: IMmdRuntimeBone[] = mmdModel.runtimeBones.filter((b: IMmdRuntimeBone) =>
        EYE_BONE_CANDIDATES.includes(b.name)
    );

    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;
    if (!needHead && !needEye) {
        return;
    }

    const isWasm = _isWasmRuntime(headRuntime ?? eyeRuntimes[0]);
    const gazeTarget = _getGazeTarget(cam, _v3());

    // [adr-071] 坐标系对齐：骨骼 worldMatrix 是 rootMesh 局部坐标系（不含 rootMesh scaling），
    // 而相机 position 是世界坐标系。需把 gazeTarget 转换到 rootMesh 局部坐标系，
    // 否则当模型 autoScale 后骨骼坐标与相机坐标不在同一空间，gaze 方向计算错误。
    _worldToLocalGazeTarget(mmdModel, gazeTarget);

    if (isWasm) {
        if (needHead && headRuntime && (!headClaimed || headClaimed.includes(headRuntime.name))) {
            _applyHeadGazeWasm(headRuntime, gazeTarget, dt, cache);
        }
        if (needEye) {
            const filteredEyes = eyeClaimed
                ? eyeRuntimes.filter((e) => eyeClaimed.includes(e.name))
                : eyeRuntimes;
            if (filteredEyes.length > 0) {
                _applyEyeGazeWasm(filteredEyes, gazeTarget, dt, cache);
            }
        }
    } else {
        if (needHead && headRuntime && (!headClaimed || headClaimed.includes(headRuntime.name))) {
            _applyHeadGazeJS(headRuntime, gazeTarget, dt, cache);
        }
        if (needEye) {
            const filteredEyes = eyeClaimed
                ? eyeRuntimes.filter((e) => eyeClaimed.includes(e.name))
                : eyeRuntimes;
            if (filteredEyes.length > 0) {
                _applyEyeGazeJS(filteredEyes, gazeTarget, dt, cache);
            }
        }
        const skeleton = (mmdModel.mesh.metadata as MeshMetadata)?.skeleton;
        skeleton?._markAsDirty?.();
    }
}

/** 头部骨骼候选名（JS/WASM 路径共用） */
export const HEAD_BONE_CANDIDATES = ['頭', '首', 'head', 'Head'];
/** 眼球骨骼候选名（JS/WASM 路径共用） */
export const EYE_BONE_CANDIDATES = [
    '右目',
    '左目',
    'Eye_R',
    'Eye_L',
    'eye_r',
    'eye_l',
    'RightEye',
    'LeftEye',
];

/** WASM 模式下的 gaze 应用（供 wasm-layers-blender.ts 调用） */
export function applyGazeWasm(
    bones: readonly IMmdRuntimeBone[],
    cam: Camera,
    config: GazeConfig,
    dt: number
): void {
    if (!config.headEnabled && !config.eyeEnabled) {
        return;
    }

    // 与 _applyGaze 使用相同的骨骼候选列表，避免 WASM 路径漏匹配英文名骨骼
    const headRuntime = bones.find((b) => HEAD_BONE_CANDIDATES.includes(b.name));
    const eyeRuntimes = bones.filter((b) => EYE_BONE_CANDIDATES.includes(b.name));
    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;

    if (!needHead && !needEye) {
        return;
    }

    const gazeTarget = _getGazeTarget(cam, _v3());

    if (needHead && headRuntime) {
        _applyHeadGazeWasm(headRuntime, gazeTarget, dt);
    }

    if (needEye) {
        _applyEyeGazeWasm(eyeRuntimes, gazeTarget, dt);
    }
}
