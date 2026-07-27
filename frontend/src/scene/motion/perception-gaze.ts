// [doc:adr-071] 感知层 — 视线追踪（头部跟随 + 眼部跟随，WASM/JS 双路径调度）
// WASM 路径实现 → perception-gaze-wasm.ts
// JS   路径实现 → perception-gaze-js.ts

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import type { MmdRuntimeBoneExtended } from '@/core/types';
import { isARActive } from '../ar/ar-camera';
import { transformWorldToRootLocal } from '@/core/mmd-adapter';
import type {
    MeshMetadata,
    GazeConfig,
    MmdModelLike,
    PerceptionTier,
    GazeCache,
} from './perception-shared';
import {
    _v3,
    _q,
    _m,
    _gazeAlpha,
    _gazeLog,
    _qAngleDeg,
    _isWasmRuntime,
    getHeadGazeMaxYaw,
    getHeadGazeMaxPitch,
    getEyeGazeMaxYaw,
    getEyeGazeMaxPitch,
    getEyeGazeSmooth,
} from './perception-shared';

// Re-export getter functions for JS/WASM sub-modules (avoid circular dependency)
export { getEyeGazeMaxYaw, getEyeGazeMaxPitch, getEyeGazeSmooth };
import { _applyHeadGazeWasm, _applyEyeGazeWasm } from './perception-gaze-wasm';
import { _applyHeadGazeJS, _applyEyeGazeJS } from './perception-gaze-js';

// ── 眼球追踪平滑系数（默认值，实际从 perception-shared 动态读取） ──
const _DEFAULT_EYE_SMOOTH = 0.35;

// ── AR 模式视线距离（米） ──
const AR_GAZE_DISTANCE = 1.5;

// ── 头部/眼球跟随角度限位（默认值，实际从 perception-shared 动态读取） ──
const _DEFAULT_HEAD_GAZE_MAX_YAW = (75 * Math.PI) / 180;
const _DEFAULT_HEAD_GAZE_MAX_PITCH = (35 * Math.PI) / 180;
const _DEFAULT_EYE_GAZE_MAX_YAW = (9 * Math.PI) / 180;
const _DEFAULT_EYE_GAZE_MAX_PITCH = (8 * Math.PI) / 180;

/**
 * 将"转向相机的目标世界旋转"钳制在相对父骨骼坐标系的 yaw/pitch 锥形内。
 */
export function _clampGazeTargetInParentFrame(
    oldWorldQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion,
    maxYawRad: number,
    maxPitchRad: number
): Quaternion {
    return _clampImpl(oldWorldQ, targetWorldQ, parentWorldQ, maxYawRad, maxPitchRad);
}

function _clampImpl(
    oldWorldQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion,
    maxYawRad: number,
    maxPitchRad: number
): Quaternion {
    const invParent = _q().copyFrom(parentWorldQ).invert();
    const desiredLocal = _q().copyFrom(invParent).multiplyInPlace(targetWorldQ);

    // ── Swing-Twist 分解 ──
    // desiredLocal = swing × twist
    // twist = 绕父骨骼 +Y 轴的旋转（yaw，左右转头）
    // swing = 剩余偏转（含 pitch 俯仰 + roll 翻滚）
    // 分解后分别限位 yaw 和 swing 总角，避免 toEulerAngles 在大角度复合旋转下的信息丢失。
    const twist = _q();
    _swingTwistDecompose(desiredLocal, Vector3.Up(), twist);

    // 限位 twist（yaw）：限制 twist 与 Identity 绕 +Y 的夹角
    let twistAngle = 2 * Math.acos(Math.min(Math.abs(twist.w), 1));
    if (twist.y < 0) {
        twistAngle = -twistAngle;
    } // 保留方向
    const clampedTwistAngle = Math.max(-maxYawRad, Math.min(maxYawRad, twistAngle));
    const clampedTwist = _q().copyFrom(Quaternion.RotationAxis(Vector3.Up(), clampedTwistAngle));

    // 限位 swing：限制 swing 与 Identity 的总夹角（涵盖 pitch + roll）
    const swingAngle = 2 * Math.acos(Math.min(Math.abs(desiredLocal.w), 1));
    // swing 总角 ≈ sqrt(pitch² + roll²)，用 maxPitchRad 作为 swing 上限
    const maxSwingRad = maxPitchRad;
    const clampedSwing = _q();
    if (swingAngle > maxSwingRad && swingAngle > 1e-6) {
        // 等比缩放 swing 四元数的旋转角度
        const scale = maxSwingRad / swingAngle;
        // swing = desiredLocal × twist⁻¹
        const invTwist = _q().copyFrom(twist).invert();
        const swing = _q().copyFrom(desiredLocal).multiplyInPlace(invTwist);
        // 缩放：对 swing 做 slerp(Identity, swing, scale)
        Quaternion.SlerpToRef(Quaternion.Identity(), swing, scale, clampedSwing);
    } else {
        const invTwist = _q().copyFrom(twist).invert();
        clampedSwing.copyFrom(desiredLocal).multiplyInPlace(invTwist);
    }

    // 重组：clampedLocal = clampedSwing × clampedTwist
    const clampedLocal = _q().copyFrom(clampedSwing).multiplyInPlace(clampedTwist);

    return _q().copyFrom(parentWorldQ).multiplyInPlace(clampedLocal);
}

/**
 * Swing-Twist 分解：把 q 分解为 swing × twist，twist 是绕指定轴的旋转。
 * 参考：https://www.euclideanspace.com/maths/geometry/rotations/for/decomposition/
 */
function _swingTwistDecompose(q: Quaternion, twistAxis: Vector3, outTwist: Quaternion): void {
    // twist = (q·axis) / |q·axis| 投影到轴上
    // p = (dot(q.xyz, axis), normalized) — q 的轴向分量
    const dot = q.x * twistAxis.x + q.y * twistAxis.y + q.z * twistAxis.z;
    const axisLen = Math.sqrt(dot * dot + q.w * q.w);
    if (axisLen < 1e-6) {
        // q 几乎纯 swing（无 twist 分量），twist = Identity
        outTwist.set(0, 0, 0, 1);
        return;
    }
    outTwist.set(
        (dot * twistAxis.x) / axisLen,
        (dot * twistAxis.y) / axisLen,
        (dot * twistAxis.z) / axisLen,
        q.w / axisLen
    );
}

/** 获取视线目标点（AR 模式沿相机朝向投射，普通模式用相机位置） */
export function _getGazeTarget(cam: Camera, out: Vector3): Vector3 {
    if (isARActive()) {
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
    // 需把 gazeTarget 转到 rootMesh 局部坐标系（固化于 mmd-adapter BoneFrameClock）。
    transformWorldToRootLocal(mmdModel.mesh, target);
}

/** 头部专用包装（维持已有回归测试签名不变） */
export function _clampHeadGazeTarget(
    oldHeadRotQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion
): Quaternion {
    return _clampImpl(
        oldHeadRotQ,
        targetWorldQ,
        parentWorldQ,
        getHeadGazeMaxYaw(),
        getHeadGazeMaxPitch()
    );
}

/** 眼球专用包装（相对头部坐标系，用更紧的生理锥形） */
export function _clampEyeGazeTarget(
    oldEyeRotQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion
): Quaternion {
    return _clampImpl(
        oldEyeRotQ,
        targetWorldQ,
        parentWorldQ,
        getEyeGazeMaxYaw(),
        getEyeGazeMaxPitch()
    );
}

// ── Gaze 共用骨架（[doc:adr-071] JS/WASM 双路径收敛） ──
// JS 路径和 WASM 路径共享的 lookDir 计算、targetWorldQ、clamp、Slerp、cache 维护逻辑。
// 写入策略通过 strategy 参数注入，避免代码重复（净减 ~150 行）。

/** 头部跟随写入策略（JS/WASM 各自实现） */
export interface HeadGazeWriteStrategy {
    /**
     * 写入头部最终旋转 + 传播子骨骼
     * @param headRuntime 头部骨骼
     * @param finalQ 最终世界旋转（已 clamp + Slerp）
     * @param headPos 头部世界位置
     * @param oldHeadMat 调用前的头部世界矩阵
     * @param parentWorldQ 父骨骼世界旋转
     */
    writeHead(
        headRuntime: IMmdRuntimeBone,
        finalQ: Quaternion,
        headPos: Vector3,
        oldHeadMat: Matrix,
        parentWorldQ: Quaternion
    ): void;
}

/** 眼部跟随写入策略（JS/WASM 各自实现） */
export interface EyeGazeWriteStrategy {
    /**
     * 写入单个眼球最终旋转 + 传播子骨骼
     * @param eyeRb 眼球骨骼
     * @param finalEyeQ 最终世界旋转
     * @param localQ 最终本地旋转（相对父骨骼，cache 也存此值）
     * @param eyeMat 调用前的眼球世界矩阵
     * @param parentWorldQ 父骨骼世界旋转
     */
    writeEye(
        eyeRb: IMmdRuntimeBone,
        finalEyeQ: Quaternion,
        localQ: Quaternion,
        eyeMat: Matrix,
        parentWorldQ: Quaternion
    ): void;
}

/** 头部跟随共用骨架（lookDir → targetWorldQ → clamp → Slerp → cache → strategy.writeHead） */
export function _applyHeadGazeCore(
    headRuntime: IMmdRuntimeBone,
    gazeTarget: Vector3,
    dt: number,
    cache: GazeCache | undefined,
    strategy: HeadGazeWriteStrategy
): void {
    const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime.worldMatrix));
    const headPos = oldHeadMat.getTranslation();
    const oldHeadRotQ =
        cache?.headWorldQ ??
        _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));

    // lookDir = bonePos - camPos（已踩坑 3 次，与直觉相反：远离相机方向）
    const lookDir = headPos.subtractToRef(gazeTarget, _v3());
    if (lookDir.lengthSquared() < 0.0001) {
        return;
    }
    lookDir.normalize();
    // 注意：Babylon.js FromLookDirectionRH 实际让 +Z 对齐 lookDir（非 -Z，源码历史注释有误）
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    // parentWorldQ：从 parentBone.worldMatrix 提取旋转（JS/WASM 等价实现）
    const parentWorldQ = _q();
    const parentBone = headRuntime.parentBone;
    if (parentBone) {
        const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
        Quaternion.FromRotationMatrixToRef(parentMat.getRotationMatrix(), parentWorldQ);
    } else {
        parentWorldQ.copyFrom(Quaternion.Identity());
    }

    const clampedTarget = _clampHeadGazeTarget(oldHeadRotQ, targetWorldQ, parentWorldQ);
    const alpha = _gazeAlpha(0.7, dt);
    const finalQ = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, clampedTarget, alpha));
    _gazeLog(
        'HEAD',
        headRuntime.linkedBone?.name,
        'dt',
        dt.toFixed(4),
        'α',
        alpha.toFixed(4),
        'err→',
        _qAngleDeg(oldHeadRotQ, targetWorldQ).toFixed(1),
        'clamp',
        _qAngleDeg(clampedTarget, targetWorldQ).toFixed(1),
        'err←',
        _qAngleDeg(finalQ, targetWorldQ).toFixed(1)
    );

    if (cache) {
        if (!cache.headWorldQ) {
            cache.headWorldQ = new Quaternion();
        }
        cache.headWorldQ.copyFrom(finalQ);
    }

    strategy.writeHead(headRuntime, finalQ, headPos, oldHeadMat, parentWorldQ);
}

/** 眼部跟随共用骨架（eyeCenter → lookDir → targetWorldQ → 每眼 clamp/Slerp/cache → strategy.writeEye） */
export function _applyEyeGazeCore(
    eyeRuntimes: IMmdRuntimeBone[],
    gazeTarget: Vector3,
    dt: number,
    cache: GazeCache | undefined,
    strategy: EyeGazeWriteStrategy
): void {
    const eyeCenter = _v3();
    for (const eyeRb of eyeRuntimes) {
        const eb = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        eyeCenter.x += eb[12];
        eyeCenter.y += eb[13];
        eyeCenter.z += eb[14];
    }
    eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

    // lookDir = bonePos - camPos（理由同 head 注释）
    const lookDir = eyeCenter.subtractToRef(gazeTarget, _v3());
    if (lookDir.lengthSquared() < 0.0001) {
        return;
    }
    lookDir.normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    // parentWorldQ：所有 eye 共享父骨骼，循环外算一次（原 JS 路径在循环内冗余重算）
    const parentWorldQ = _q();
    const eyeParentBone = eyeRuntimes[0].parentBone;
    if (eyeParentBone) {
        const pMat = _m().copyFrom(Matrix.FromArray(eyeParentBone.worldMatrix));
        Quaternion.FromRotationMatrixToRef(pMat.getRotationMatrix(), parentWorldQ);
    } else {
        parentWorldQ.copyFrom(Quaternion.Identity());
    }

    for (const eyeRb of eyeRuntimes) {
        const eyeMat = _m().copyFrom(Matrix.FromArray((eyeRb as MmdRuntimeBoneExtended).worldMatrix));
        const boneName = eyeRb.linkedBone?.name ?? '';

        const cachedLocal = cache?.eyeLocalQ.get(boneName);
        const curEyeQ = cachedLocal
            ? _q().copyFrom(parentWorldQ).multiplyInPlace(cachedLocal)
            : _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));

        const clampedTarget = _clampGazeTargetInParentFrame(
            curEyeQ,
            targetWorldQ,
            parentWorldQ,
            getEyeGazeMaxYaw(),
            getEyeGazeMaxPitch()
        );
        const alpha = _gazeAlpha(getEyeGazeSmooth(), dt);
        const finalEyeQ = _q().copyFrom(Quaternion.Slerp(curEyeQ, clampedTarget, alpha));
        _gazeLog(
            'EYE',
            boneName,
            'dt',
            dt.toFixed(4),
            'α',
            alpha.toFixed(4),
            'err→',
            _qAngleDeg(curEyeQ, targetWorldQ).toFixed(1),
            'clamp',
            _qAngleDeg(clampedTarget, targetWorldQ).toFixed(1),
            'err←',
            _qAngleDeg(finalEyeQ, targetWorldQ).toFixed(1)
        );

        // localQ = invParentQ × finalEyeQ（供 cache 维护和 JS 写入）
        const invParentQ = _q().copyFrom(parentWorldQ).invert();
        const localQ = _q().copyFrom(invParentQ).multiplyInPlace(finalEyeQ);

        if (cache) {
            let cached = cache.eyeLocalQ.get(boneName);
            if (!cached) {
                cached = new Quaternion();
                cache.eyeLocalQ.set(boneName, cached);
            }
            cached.copyFrom(localQ);
        }

        strategy.writeEye(eyeRb, finalEyeQ, localQ, eyeMat, parentWorldQ);
    }
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
