// [doc:adr-116 P3] 时间驱动纯数学单测 — 验证 frequency/decay/pedalSpeed 真正参与计算
import { describe, it, expect } from 'vitest';
import { computeSwayYaw, computePedalPhase, computeFootPitch } from '@/scene/motion/motion-modules/motion-math';

describe('computeSwayYaw', () => {
    it('t=0 → 0（正弦起点）', () => {
        expect(computeSwayYaw(5, 0.3, 0.5, 0)).toBeCloseTo(0);
    });

    it('decay=1 → 始终为 0（静止）', () => {
        expect(computeSwayYaw(5, 1, 0.5, 1.234)).toBeCloseTo(0);
    });

    it('quarter 周期 → 峰值 = amplitude·(1-decay)', () => {
        const amp = 5;
        const decay = 0.3;
        const freq = 0.5;
        const t = 0.25 / freq; // 四分之一周期（相位 π/2）
        expect(computeSwayYaw(amp, decay, freq, t)).toBeCloseTo(amp * (1 - decay));
    });

    it('frequency 翻倍 → 周期减半（同 t 下相位加倍）', () => {
        const amp = 5;
        const decay = 0;
        const t = 0.25; // freq=1 的四分之一周期
        expect(computeSwayYaw(amp, decay, 1, t)).toBeCloseTo(amp);
    });
});

describe('computePedalPhase', () => {
    it('t=0 → 0', () => {
        expect(computePedalPhase(0, 0.5)).toBeCloseTo(0);
    });

    it('按 360° 自然循环', () => {
        expect(computePedalPhase(0.5, 0.5)).toBeCloseTo(90); // 0.5·0.5·360
        expect(computePedalPhase(2, 0.5)).toBeCloseTo(0); // 整圈回零
    });

    it('负值归一化到 [0,360)', () => {
        expect(computePedalPhase(-0.5, 0.5)).toBeCloseTo(270);
    });
});

describe('computeFootPitch', () => {
    it('phase=90°：左足 +20，右足 -20（反相）', () => {
        expect(computeFootPitch(90, true)).toBeCloseTo(20);
        expect(computeFootPitch(90, false)).toBeCloseTo(-20);
    });

    it('phase=0°：左足 0', () => {
        expect(computeFootPitch(0, true)).toBeCloseTo(0);
    });
});
