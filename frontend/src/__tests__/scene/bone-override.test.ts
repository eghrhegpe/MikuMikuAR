// [doc:adr-116 P1] 校验覆盖合成纯函数 _computeOverride 的语义正确性。
// 重点：位置覆盖应为「动画平移 + 偏移」的加法语义，且位置覆盖不得抹除动画旋转。
import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { _computeOverride } from '@/scene/motion/bone-override';

const HALF_PI = Math.PI / 2;

describe('bone-override _computeOverride (ADR-116 P1)', () => {
    it('位置覆盖：保留动画旋转并叠加偏移量（加法语义）', () => {
        const oldT = new Vector3(5, 0, 0);
        const oldR = Quaternion.FromEulerAngles(0, Math.PI / 4, 0); // 45° yaw
        const slot = {
            quat: Quaternion.Identity(),
            weight: 1,
            pos: new Vector3(0, 1, 0),
            overrideRotation: false,
        };
        const { translation, rotation } = _computeOverride(oldT, oldR, slot);
        expect(translation.x).toBeCloseTo(5);
        expect(translation.y).toBeCloseTo(1);
        expect(translation.z).toBeCloseTo(0);
        // 动画旋转未被抹除
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI / 4);
    });

    it('位置覆盖：不传 pos 时平移完全沿用动画', () => {
        const oldT = new Vector3(1, 2, 3);
        const oldR = Quaternion.Identity();
        const slot = { quat: Quaternion.Identity(), weight: 1, overrideRotation: false };
        const { translation } = _computeOverride(oldT, oldR, slot);
        expect(translation.x).toBeCloseTo(1);
        expect(translation.y).toBeCloseTo(2);
        expect(translation.z).toBeCloseTo(3);
    });

    it('旋转覆盖（weight=1）：硬覆盖旋转、平移沿用动画', () => {
        const oldT = new Vector3(1, 2, 3);
        const oldR = Quaternion.Identity();
        const target = Quaternion.FromEulerAngles(0, Math.PI, 0); // 180° yaw
        const slot = { quat: target, weight: 1, overrideRotation: true };
        const { translation, rotation } = _computeOverride(oldT, oldR, slot);
        expect(translation.x).toBeCloseTo(1);
        // oldR=Identity 时 result = Identity × target = target
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI);
    });

    it('旋转覆盖（0<weight<1）：按比例 Slerp 混合', () => {
        const oldT = new Vector3(0, 0, 0);
        const oldR = Quaternion.Identity();
        const target = Quaternion.FromEulerAngles(0, Math.PI, 0); // 180° yaw
        const slot = { quat: target, weight: 0.5, overrideRotation: true };
        const { rotation } = _computeOverride(oldT, oldR, slot);
        // 半程混合 → 90° yaw
        expect(rotation.toEulerAngles().y).toBeCloseTo(HALF_PI);
    });

    it('旋转+位置组合覆盖：两者同时生效', () => {
        const oldT = new Vector3(0, 0, 0);
        const oldR = Quaternion.Identity();
        const target = Quaternion.FromEulerAngles(0, HALF_PI, 0); // 90° yaw
        const slot = {
            quat: target,
            weight: 1,
            pos: new Vector3(0, 2, 0),
            overrideRotation: true,
        };
        const { translation, rotation } = _computeOverride(oldT, oldR, slot);
        expect(translation.y).toBeCloseTo(2);
        expect(rotation.toEulerAngles().y).toBeCloseTo(HALF_PI);
    });

    it('overrideRotation 缺省（undefined）视为不覆盖旋转，安全保留动画', () => {
        const oldT = new Vector3(0, 0, 0);
        const oldR = Quaternion.FromEulerAngles(0, Math.PI / 3, 0);
        const slot = { quat: Quaternion.Identity(), weight: 1 }; // 无 overrideRotation
        const { rotation } = _computeOverride(oldT, oldR, slot);
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI / 3);
    });

    // ── 父骨传播回归护栏（ADR-116 §十一 2026-07-17 复合语义）──
    // 原 6 例 oldRotation 恒为 Identity，复合分支（weight≥1 → oldRotation × slot.quat）从未被真实父骨旋转触发，
    // 是 2026-07-17 复合语义回归的盲区。以下用例锁死该分支。

    it('父骨传播 + weight≥1：复合 = 父骨旋转 × 本骨目标', () => {
        // 父骨 yaw 90°，本骨目标 yaw 90°（复合后 180°）。
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slotQuat = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slot = { quat: slotQuat, weight: 1, overrideRotation: true };
        const { rotation } = _computeOverride(new Vector3(0, 0, 0), parentRot, slot);
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI); // 180°
    });

    it('父骨传播 + weight≥1：拒绝退化为「绝对覆盖」', () => {
        // 若有人把 bone-override.ts:166 退化成 rotation = slot.quat（绝对覆盖），
        // 本例会得 90° 而非 180°；此处显式断言「不是 90°」以拦截回归。
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slotQuat = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slot = { quat: slotQuat, weight: 1, overrideRotation: true };
        const { rotation } = _computeOverride(new Vector3(0, 0, 0), parentRot, slot);
        expect(rotation.toEulerAngles().y).not.toBeCloseTo(HALF_PI);
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI);
    });

    it('父骨传播 + 0<weight<1：Slerp 从「父骨旋转」插到「绝对目标」（非复合）', () => {
        // 父骨 yaw 90°，本骨目标 yaw 0°。weight=0.5 时 Slerp(90°, 0°, 0.5) = 45°。
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slotQuat = Quaternion.FromEulerAngles(0, 0, 0);
        const slot = { quat: slotQuat, weight: 0.5, overrideRotation: true };
        const { rotation } = _computeOverride(new Vector3(0, 0, 0), parentRot, slot);
        expect(rotation.toEulerAngles().y).toBeCloseTo(HALF_PI / 2); // 45°
    });

    it('父骨传播 + 位置覆盖：平移加法与旋转复合互不干扰', () => {
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slotQuat = Quaternion.FromEulerAngles(0, HALF_PI, 0);
        const slot = { quat: slotQuat, weight: 1, pos: new Vector3(1, 2, 3), overrideRotation: true };
        const { translation, rotation } = _computeOverride(new Vector3(0, 0, 0), parentRot, slot);
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI); // 旋转复合 180°
        expect(translation.x).toBeCloseTo(1); // 平移走纯加法，不受旋转复合影响
        expect(translation.y).toBeCloseTo(2);
        expect(translation.z).toBeCloseTo(3);
    });
});

// ── R4 Slerp 分支边界护栏（ADR-147）──
// 复合分支（weight≥1 → oldRotation × slot.quat）与 Slerp 分支（weight<1 → Slerp(oldRotation, slot.quat, weight)）
// 在非单位 oldRotation（真实父骨传播）下，于边界处结果截然不同。若有人误改 `>=1` 为 `>1`/`>0`，
// 或把 Slerp 终点误写成「复合」，以下用例会立刻失败。
describe('bone-override _computeOverride Slerp 分支边界 (ADR-147 R4)', () => {
    it('边界 weight=1（复合）vs weight=0.999（Slerp）：同非单位 oldR 下结果发散', () => {
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0); // 父骨 90°
        const slotQuat = Quaternion.FromEulerAngles(0, 0, 0); // 本骨目标 0°
        const compound = _computeOverride(
            new Vector3(0, 0, 0),
            parentRot,
            { quat: slotQuat, weight: 1, overrideRotation: true }
        );
        const slerp = _computeOverride(
            new Vector3(0, 0, 0),
            parentRot,
            { quat: slotQuat, weight: 0.999, overrideRotation: true }
        );
        // weight=1 → 复合：父骨 90° × 目标 0° = 90°（保留父骨）
        expect(compound.rotation.toEulerAngles().y).toBeCloseTo(HALF_PI);
        // weight=0.999 → Slerp(90°, 0°, 0.999) ≈ 0.09°（父骨被插掉，远小于 45°）
        expect(slerp.rotation.toEulerAngles().y).toBeLessThan(HALF_PI / 4);
        // 两分支在边界处必须发散（拦截 `>=1` 被误改）
        expect(slerp.rotation.toEulerAngles().y).not.toBeCloseTo(HALF_PI);
    });

    it('下界 weight=0：slot.quat 完全不生效，纯沿用父骨旋转', () => {
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0); // 90°
        const slotQuat = Quaternion.FromEulerAngles(0, Math.PI, 0); // 本骨目标 180°
        const { rotation } = _computeOverride(
            new Vector3(0, 0, 0),
            parentRot,
            { quat: slotQuat, weight: 0, overrideRotation: true }
        );
        // Slerp(90°, 180°, 0) = 起点 = 90°，slot 被忽略
        expect(rotation.toEulerAngles().y).toBeCloseTo(HALF_PI);
        expect(rotation.toEulerAngles().y).not.toBeCloseTo(Math.PI);
    });

    it('weight=1 是复合而非 Slerp@1：非单位 oldR + 非零目标时结果差一倍', () => {
        const parentRot = Quaternion.FromEulerAngles(0, HALF_PI, 0); // 90°
        const slotQuat = Quaternion.FromEulerAngles(0, HALF_PI, 0); // 本骨目标 90°
        const { rotation } = _computeOverride(
            new Vector3(0, 0, 0),
            parentRot,
            { quat: slotQuat, weight: 1, overrideRotation: true }
        );
        // 复合：90° × 90° = 180°；若退化成 Slerp(oldR, target, 1) = target = 90° 则失败
        expect(rotation.toEulerAngles().y).toBeCloseTo(Math.PI);
        expect(rotation.toEulerAngles().y).not.toBeCloseTo(HALF_PI);
    });
});
