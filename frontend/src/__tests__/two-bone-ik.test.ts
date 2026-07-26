// [doc:adr-085 方案C] Two-Bone IK 纯函数单测
import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { solveTwoBoneIK, applyRotationToWorldMatrix } from '../motion-algos/two-bone-ik';

/** 构造 16 元素列主序 worldMatrix（Identity 旋转 + 指定 translation） */
function makeMat(tx: number, ty: number, tz: number): number[] {
    const m = new Matrix();
    Matrix.ComposeToRef(new Vector3(1, 1, 1), Quaternion.Identity(), new Vector3(tx, ty, tz), m);
    return Array.from(m.m);
}

/** 四元数xyz分量绝对值之和（用于判断旋转是否非零） */
function quatAbsSum(q: Quaternion): number {
    return Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z);
}

describe('solveTwoBoneIK', () => {
    it('退化：L1 过小（髋膝重合）返回 changed=false', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 1, 0); // 与 hip 重合
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0, 0.1, 0);
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(false);
    });

    it('退化：L2 过小（膝踝重合）返回 changed=false', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0);
        const endEffector = new Vector3(0, 0.5, 0); // 与 knee 重合
        const target = new Vector3(0, 0.4, 0);
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(false);
    });

    it('退化：hip 与 endEffector 重合（curDir 无法归一化）返回 changed=false', () => {
        const hip = new Vector3(0, 0, 0);
        const knee = new Vector3(0, 0.5, 0);
        const endEffector = new Vector3(0, 0, 0); // 与 hip 重合
        const target = new Vector3(0, 0.1, 0);
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(false);
    });

    it('退化：hip 与 target 重合（targetDir 无法归一化）返回 changed=false', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1);
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0, 1, 0); // 与 hip 重合
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(false);
    });

    it('退化：腿完全伸直且三点共线（无腿平面法线）返回 changed=false', () => {
        // hip、knee、endEffector 全在 Y 轴上，腿完全伸直
        // curDir 与 targetDir 共线 → 回退到腿平面法线 (knee-hip)×(endEffector-hip)
        // 但 knee-hip 与 endEffector-hip 也共线 → 腿平面法线为零 → changed=false
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0); // 在 Y 轴上
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0, 0.1, 0);
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(false);
    });

    it('正常：脚部 Y 偏移（抬起）返回 changed=true 且旋转非零', () => {
        // 初始姿态：膝盖稍微向前突出（非共线）
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1);
        const endEffector = new Vector3(0, 0, 0); // 动画位置
        const target = new Vector3(0, 0.1, 0); // 脚抬起 0.1
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(true);
        expect(quatAbsSum(r.hipDelta)).toBeGreaterThan(1e-6);
        expect(quatAbsSum(r.kneeDelta)).toBeGreaterThan(1e-6);
    });

    it('正常：脚部 X 偏移（侧移）返回 changed=true', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1);
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0.3, 0, 0); // 脚侧移 0.3
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(true);
        expect(quatAbsSum(r.hipDelta)).toBeGreaterThan(1e-6);
        expect(quatAbsSum(r.kneeDelta)).toBeGreaterThan(1e-6);
    });

    it('正常：零偏移（endEffector===target）返回 changed=false', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1);
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0, 0, 0); // 无偏移
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        expect(r.changed).toBe(false);
    });

    it('可达范围 clamp：目标远超腿长时不崩溃', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1); // L1≈0.51, L2≈0.51
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0, 10, 0); // 远超腿长（L1+L2≈1.02）
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        // 不崩溃即可；超出范围时 DClamped=DMax，增量非零（腿尽量伸直朝目标）
        expect(r.changed).toBe(true);
    });

    it('可达范围 clamp：目标近零（脚贴近髋）时不崩溃', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1);
        const endEffector = new Vector3(0, 0, 0);
        const target = new Vector3(0, 0.99, 0); // 几乎与 hip 重合
        const r = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: target });
        // 不崩溃即可（可能 changed=true 或 false，取决于增量）
        expect(typeof r.changed).toBe('boolean');
    });

    it('对称性：左右偏移产生相反符号的旋转轴', () => {
        const hip = new Vector3(0, 1, 0);
        const knee = new Vector3(0, 0.5, 0.1);
        const endEffector = new Vector3(0, 0, 0);
        const targetLeft = new Vector3(0.2, 0, 0);
        const targetRight = new Vector3(-0.2, 0, 0);
        const rLeft = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: targetLeft });
        const rRight = solveTwoBoneIK({ hipPos: hip, kneePos: knee, endEffectorPos: endEffector, targetPos: targetRight });
        expect(rLeft.changed).toBe(true);
        expect(rRight.changed).toBe(true);
        // 旋转轴方向相反 → hipDelta 的某个分量符号相反
        // 用点积验证：两个 delta 的虚部点积应为负（方向相反）
        const dot =
            rLeft.hipDelta.x * rRight.hipDelta.x +
            rLeft.hipDelta.y * rRight.hipDelta.y +
            rLeft.hipDelta.z * rRight.hipDelta.z;
        expect(dot).toBeLessThan(0);
    });
});

describe('applyRotationToWorldMatrix', () => {
    it('Identity 旋转不改变矩阵', () => {
        const mat = makeMat(1, 2, 3);
        const original = [...mat];
        applyRotationToWorldMatrix(mat, Quaternion.Identity());
        // translation 保留
        expect(mat[12]).toBeCloseTo(1);
        expect(mat[13]).toBeCloseTo(2);
        expect(mat[14]).toBeCloseTo(3);
        // 旋转部分接近原值（Identity 不改变旋转）
        for (let i = 0; i < 12; ++i) {
            expect(mat[i]).toBeCloseTo(original[i], 5);
        }
    });

    it('90度 Y 轴旋转保留 translation 但改变旋转部分', () => {
        const mat = makeMat(1, 2, 3);
        const rot = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI / 2);
        applyRotationToWorldMatrix(mat, rot);
        // translation 保留
        expect(mat[12]).toBeCloseTo(1);
        expect(mat[13]).toBeCloseTo(2);
        expect(mat[14]).toBeCloseTo(3);
        // 原 Identity 的 m[0]=1（右向量 X 分量）；绕 Y 旋转 90° 后右向量应变为 (0,0,-1)
        // 列主序：m[0]=右X, m[1]=右Y, m[2]=右Z
        expect(mat[0]).toBeCloseTo(0, 5);
        expect(mat[2]).toBeCloseTo(-1, 5);
        // 前向量（m[8]=前X, m[10]=前Z）应变为 (1,0,0)
        expect(mat[8]).toBeCloseTo(1, 5);
        expect(mat[10]).toBeCloseTo(0, 5);
    });

    it('支持 Float32Array 和 number[] 两种 buffer 类型', () => {
        const matNum = makeMat(1, 2, 3);
        const matFloat = new Float32Array(makeMat(1, 2, 3));
        const rot = Quaternion.RotationAxis(new Vector3(0, 1, 0), Math.PI / 4);
        applyRotationToWorldMatrix(matNum, rot);
        applyRotationToWorldMatrix(matFloat, rot);
        // 两种 buffer 类型应产生相同结果
        for (let i = 0; i < 16; ++i) {
            expect(matNum[i]).toBeCloseTo(matFloat[i], 5);
        }
    });

    it('连续应用两次旋转等价于合成旋转', () => {
        const matA = makeMat(1, 2, 3);
        const matB = makeMat(1, 2, 3);
        const rot1 = Quaternion.RotationAxis(new Vector3(0, 1, 0), 0.3);
        const rot2 = Quaternion.RotationAxis(new Vector3(1, 0, 0), 0.5);
        // 路径 A：连续应用 rot1 然后 rot2
        applyRotationToWorldMatrix(matA, rot1);
        applyRotationToWorldMatrix(matA, rot2);
        // 路径 B：合成 rot2 × rot1 后一次应用
        const combined = rot2.multiply(rot1);
        applyRotationToWorldMatrix(matB, combined);
        // 两者应相同（世界空间左乘语义：rot2 × (rot1 × curQ) = (rot2 × rot1) × curQ）
        for (let i = 0; i < 16; ++i) {
            expect(matA[i]).toBeCloseTo(matB[i], 5);
        }
    });
});
