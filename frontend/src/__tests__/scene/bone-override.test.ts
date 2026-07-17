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
});
