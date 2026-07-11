// footstep-detect.test.ts — 纯落地判定单测（ADR-088）
import { describe, it, expect } from 'vitest';
import { detectFootLanding } from '../motion-algos/footstep-detect';

const base = {
    footYPrev: 2.5,
    footY: 0.2,
    dt: 1 / 60,
    prevStepTime: 0,
    now: 1000,
    minInterval: 120,
};

describe('detectFootLanding', () => {
    it('离地→贴地上升沿触发 landed=true', () => {
        const r = detectFootLanding({ ...base, prevGrounded: false, grounded: true });
        expect(r.landed).toBe(true);
    });

    it('持续贴地（grounded 保持 true）不重复触发', () => {
        const r = detectFootLanding({ ...base, prevGrounded: true, grounded: true });
        expect(r.landed).toBe(false);
    });

    it('抬脚（grounded=false）不触发', () => {
        const r = detectFootLanding({ ...base, prevGrounded: false, grounded: false });
        expect(r.landed).toBe(false);
    });

    it('去抖：同脚落地间隔 < minInterval 时忽略', () => {
        const r = detectFootLanding({
            ...base,
            prevGrounded: false,
            grounded: true,
            prevStepTime: 950, // now(1000) - 950 = 50ms < 120ms
            now: 1000,
        });
        expect(r.landed).toBe(false);
    });

    it('去抖边界：间隔 == minInterval 仍触发', () => {
        const r = detectFootLanding({
            ...base,
            prevGrounded: false,
            grounded: true,
            prevStepTime: 880, // 1000 - 880 = 120ms == minInterval
            now: 1000,
        });
        expect(r.landed).toBe(true);
    });

    it('impactSpeed = (footYPrev - footY)/dt，取非负', () => {
        const r = detectFootLanding({ ...base, prevGrounded: false, grounded: true });
        // (2.5 - 0.2) / (1/60) = 2.3 * 60 = 138
        expect(r.impactSpeed).toBeCloseTo(138, 5);
    });

    it('落地上升沿但脚向上(footYPrev < footY)时 impactSpeed 为 0', () => {
        const r = detectFootLanding({
            ...base,
            footYPrev: 0.1,
            footY: 0.5,
            prevGrounded: false,
            grounded: true,
        });
        expect(r.impactSpeed).toBe(0);
    });
});
