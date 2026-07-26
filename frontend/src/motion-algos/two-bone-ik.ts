// [doc:adr-085 方案C] Two-Bone IK — 纯 JS 余弦定理求解（WASM IK 临时替代）
// 职责: WASM 模式下 babylon-mmd 的 IkSolver 不可用（ikSolver 字段为 null），
//   本模块作为临时替代，根据 IK 目标位置反推髋、膝的旋转增量。
// 与 motion-algos/ 其他算法同层：仅依赖 Babylon 数学库，不引入 scene/env/babylon-mmd 运行时。
// 引擎钩子（scene/motion/bone-override.ts）负责把结果写入 worldMatrix buffer。
//
// 算法（余弦定理，三角形 hip-knee-endEffector 与目标 target）：
//   边长 L1=|hip→knee|（大腿长，固定）
//   边长 L2=|knee→endEffector|（小腿长，固定）
//   当前腿长 D_cur=|hip→endEffector|
//   目标腿长 D_target=|hip→target|（clamp 到 [|L1-L2|, L1+L2]）
//   膝角 θ_knee = acos((L1²+L2²-D²)/(2·L1·L2))（π=直腿，0=完全折叠）
//   髋角 θ_hip  = acos((L1²+D²-L2²)/(2·L1·D))（hip→knee 与 hip→endEffector 夹角）
//   旋转轴 = (endEffector-hip) × (target-hip)
//   增量角 = θ_new(D_target) - θ_cur(D_cur)
//
// 关键区分：
//   - endEffectorPos：腿链末端（脚踝）当前世界位置（未偏移 = WASM IK 求解后的动画位置）
//   - targetPos：IK 目标骨已偏移后的位置（动画位置 + slot.pos）
//   两者必须不同，否则增量恒为零（无旋转）。集成代码用 targetPos - slot.pos 反推 endEffectorPos。
//
// 限制（与方案A fork 库的对比）：
//   - 不处理 IK 链角度约束（MMD 膝关节只能沿单轴弯曲）
//   - 不迭代（一次求解，非收敛）
//   - 不处理物理（与 canSkipWhenPhysicsEnabled 无关）
//   适用于脚部位置偏移等小偏移场景；大偏移可能产生不自然姿态。

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';

/** 两骨骼 IK 求解输入（所有位置为世界空间） */
export interface SolveTwoBoneIKInput {
    /** 髋骨（大腿）世界位置 */
    hipPos: Readonly<Vector3>;
    /** 膝骨世界位置 */
    kneePos: Readonly<Vector3>;
    /** 腿链末端（脚踝）当前世界位置（未偏移 = WASM IK 求解后的动画位置） */
    endEffectorPos: Readonly<Vector3>;
    /** 目标位置（IK 目标骨已偏移后的位置 = 动画位置 + slot.pos） */
    targetPos: Readonly<Vector3>;
}

/** 两骨骼 IK 求解结果 */
export interface SolveTwoBoneIKResult {
    /** true=有旋转变化需应用；false=无需更新（增量近零或几何无效） */
    changed: boolean;
    /** 髋骨增量旋转（世界空间四元数，应左乘到当前旋转：newQ = hipDelta × curQ） */
    hipDelta: Quaternion;
    /** 膝骨增量旋转（世界空间四元数，应左乘到当前旋转：newQ = kneeDelta × curQ） */
    kneeDelta: Quaternion;
}

// 复用静态实例，避免每次调用分配（本函数可能在每帧渲染中被调用）
const _curDir = new Vector3();
const _targetDir = new Vector3();
const _axis = new Vector3();
const _hipToKnee = new Vector3();
const _identity = Quaternion.Identity();

/**
 * 求解两骨骼 IK，返回髋、膝的世界空间增量旋转。
 *
 * 调用约定：
 *   - endEffectorPos 为腿链末端的当前位置（未偏移）
 *   - targetPos 为 IK 目标骨偏移后的位置（endEffectorPos + slot.pos）
 *   - 返回的增量旋转需用 applyRotationToWorldMatrix 写回 worldMatrix buffer
 *
 * 退化场景（返回 changed=false）：
 *   - L1 或 L2 过小（< 1e-6）
 *   - hip 与 endEffector 重合（curDir 无法归一化）
 *   - hip 与 target 重合（targetDir 无法归一化）
 *   - 腿完全伸直且共线（hip-knee-endEffector 三点共线，无腿平面法线）
 *   - 增量角均近零（< 1e-6 rad，目标与当前腿姿态等价）
 *
 * 旋转轴选择：
 *   - 默认：curDir × targetDir（hip→endEffector 与 hip→target 的叉积）
 *   - 共线回退：当 curDir 与 targetDir 共线但 |Dcur| ≠ |Dtarget|（膝盖角度需变化），
 *     使用腿平面法线 (knee-hip) × (endEffector-hip) 作为旋转轴
 *   - 共线回退失败（腿完全伸直，三点共线）：返回 changed=false
 */
export function solveTwoBoneIK(input: SolveTwoBoneIKInput): SolveTwoBoneIKResult {
    const { hipPos, kneePos, endEffectorPos, targetPos } = input;

    // 1. 腿骨静态长度（大腿 + 小腿）
    const L1 = Vector3.Distance(hipPos, kneePos);
    const L2 = Vector3.Distance(kneePos, endEffectorPos);
    if (L1 < 1e-6 || L2 < 1e-6) {
        return { changed: false, hipDelta: _identity, kneeDelta: _identity };
    }

    // 2. 当前腿长（hip→endEffector）和目标腿长（hip→target）
    const Dcur = Vector3.Distance(hipPos, endEffectorPos);
    const Dtarget = Vector3.Distance(hipPos, targetPos);

    // 3. clamp 目标距离到可达范围 [|L1-L2|+ε, L1+L2-ε]
    const Dmin = Math.abs(L1 - L2) + 1e-4;
    const Dmax = L1 + L2 - 1e-4;
    const DtargetClamped = Math.max(Dmin, Math.min(Dmax, Dtarget));

    // 4. 余弦定理求当前角度（用 Dcur）
    const cosKneeCur = (L1 * L1 + L2 * L2 - Dcur * Dcur) / (2 * L1 * L2);
    const thetaKneeCur = Math.acos(Math.max(-1, Math.min(1, cosKneeCur)));
    const cosHipCur = Dcur > 1e-6 ? (L1 * L1 + Dcur * Dcur - L2 * L2) / (2 * L1 * Dcur) : 1;
    const thetaHipCur = Dcur > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, cosHipCur))) : 0;

    // 5. 余弦定理求目标角度（用 DtargetClamped）
    const cosKneeNew = (L1 * L1 + L2 * L2 - DtargetClamped * DtargetClamped) / (2 * L1 * L2);
    const thetaKneeNew = Math.acos(Math.max(-1, Math.min(1, cosKneeNew)));
    const cosHipNew =
        DtargetClamped > 1e-6
            ? (L1 * L1 + DtargetClamped * DtargetClamped - L2 * L2) / (2 * L1 * DtargetClamped)
            : 1;
    const thetaHipNew = Math.acos(Math.max(-1, Math.min(1, cosHipNew)));

    // 6. 增量角 = 目标角度 - 当前角度
    const hipDeltaAngle = thetaHipNew - thetaHipCur;
    const kneeDeltaAngle = thetaKneeNew - thetaKneeCur;

    if (Math.abs(hipDeltaAngle) < 1e-6 && Math.abs(kneeDeltaAngle) < 1e-6) {
        return { changed: false, hipDelta: _identity, kneeDelta: _identity };
    }

    // 7. 旋转轴 = curDir × targetDir（hip→endEffector 与 hip→target 的叉积）
    _curDir.set(
        endEffectorPos.x - hipPos.x,
        endEffectorPos.y - hipPos.y,
        endEffectorPos.z - hipPos.z
    );
    const curLen = _curDir.length();
    if (curLen < 1e-6) {
        return { changed: false, hipDelta: _identity, kneeDelta: _identity };
    }
    _curDir.scaleInPlace(1 / curLen);

    _targetDir.set(
        targetPos.x - hipPos.x,
        targetPos.y - hipPos.y,
        targetPos.z - hipPos.z
    );
    const targetLen = _targetDir.length();
    if (targetLen < 1e-6) {
        return { changed: false, hipDelta: _identity, kneeDelta: _identity };
    }
    _targetDir.scaleInPlace(1 / targetLen);

    Vector3.CrossToRef(_curDir, _targetDir, _axis);
    let axisLen = _axis.length();

    // 7b. 共线回退：curDir 与 targetDir 共线（axisLen≈0）但增量角非零时，
    //     使用腿平面法线 (knee-hip) × (endEffector-hip) 作为旋转轴。
    //     典型场景：脚部纯 Y 偏移（抬起/下沉），hip→endEffector 与 hip→target 同向。
    if (axisLen < 1e-6) {
        _hipToKnee.set(
            kneePos.x - hipPos.x,
            kneePos.y - hipPos.y,
            kneePos.z - hipPos.z
        );
        Vector3.CrossToRef(_hipToKnee, _curDir, _axis);
        axisLen = _axis.length();
        if (axisLen < 1e-6) {
            // 腿完全伸直（hip-knee-endEffector 三点共线）：无腿平面法线，无法构造旋转轴
            return { changed: false, hipDelta: _identity, kneeDelta: _identity };
        }
    }
    _axis.scaleInPlace(1 / axisLen);

    // 8. 构造增量旋转四元数（世界空间，左乘到当前旋转）
    const hipDelta = Quaternion.RotationAxis(_axis, hipDeltaAngle);
    const kneeDelta = Quaternion.RotationAxis(_axis, kneeDeltaAngle);

    return { changed: true, hipDelta, kneeDelta };
}

// applyRotationToWorldMatrix 的复用实例
const _curMat = new Matrix();
const _rotMat = new Matrix();
const _curQ = new Quaternion();
const _newQ = new Quaternion();
const _newMat = new Matrix();
const _ONE = new Vector3(1, 1, 1);
const _trans = new Vector3();

/**
 * 将增量旋转应用到 worldMatrix buffer（保持 translation 不变，仅替换旋转部分）。
 *
 * 语义：newQ = delta × curQ（世界空间左乘，等价于在当前旋转之上叠加 delta 旋转）。
 * 列主序：m[0..2]=第0列（右向量），m[4..6]=第1列（上向量），m[8..10]=第2列（前向量），m[12..14]=平移。
 *
 * @param mat 16 元素 worldMatrix buffer（就地修改）
 * @param delta 增量旋转四元数（世界空间）
 */
export function applyRotationToWorldMatrix(
    mat: Float32Array | number[],
    delta: Quaternion
): void {
    // 提取当前 translation
    _trans.set(mat[12], mat[13], mat[14]);

    // 提取当前旋转（从 4x4 矩阵的 3x3 子矩阵）
    Matrix.FromArrayToRef(mat, 0, _curMat);
    _curMat.getRotationMatrixToRef(_rotMat);
    Quaternion.FromRotationMatrixToRef(_rotMat, _curQ);

    // 世界空间叠加：newQ = delta × curQ
    delta.multiplyToRef(_curQ, _newQ);

    // 构造新矩阵（scale=1, newQ, 原 translation）
    Matrix.ComposeToRef(_ONE, _newQ, _trans, _newMat);

    // 写回 buffer
    const m = _newMat.m;
    for (let i = 0; i < 16; ++i) {
        mat[i] = m[i];
    }
}
