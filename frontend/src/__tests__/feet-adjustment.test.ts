// @vitest-environment node
// [doc:adr-085] Feet Adjustment — solveFootTarget 纯逻辑单测
import { describe, it, expect } from 'vitest';
import { solveFootTarget, type SolveFootInput } from '../motion-algos/feet-adjustment-math';
import type { FeetState } from '../core/types';

function defaultFeet(overrides: Partial<FeetState> = {}): FeetState {
    return {
        enabled: false,
        intensity: 1,
        soleHeight: 0,
        jumpThreshold: 0.5,
        bodySmooth: 0.5,
        footSmooth: 0.5,
        maxAngle: 30,
        reachAngle: 15,
        ...overrides,
    };
}

function input(overrides: Partial<SolveFootInput>): SolveFootInput {
    return {
        footY: 0,
        groundY: 0,
        hipToFootDist: 1,
        legLength: 1,
        centerY: 1, // 默认 groundY=0, legLength=1, centerY=1 → modelGroundY = max(0, 0) = 0
        prevTargetY: null,
        feet: defaultFeet(),
        ...overrides,
    };
}

describe('solveFootTarget', () => {
    it('跳过：脚踝高于跳跃阈值时不做校正', () => {
        const r = solveFootTarget(input({ footY: 1.0, feet: defaultFeet({ jumpThreshold: 0.5 }) }));
        expect(r.skip).toBe(true);
        expect(r.targetY).toBe(1.0);
        expect(r.grounded).toBe(false);
    });

    it('着地：脚低于地面时立即上推到地面（防穿插）', () => {
        const r = solveFootTarget(input({ footY: -0.2, groundY: 0, prevTargetY: null }));
        expect(r.skip).toBe(false);
        // desiredY = groundY + soleHeight = 0；desiredY > footY → 立即贴合
        expect(r.targetY).toBeCloseTo(0);
    });

    it('着地：脚底高度偏移叠加', () => {
        const r = solveFootTarget(
            input({ footY: -0.5, groundY: 0, feet: defaultFeet({ soleHeight: 0.05 }) })
        );
        expect(r.targetY).toBeCloseTo(0.05);
    });

    it('平滑：脚高于地面时按 footSmooth 软化下拉', () => {
        const r = solveFootTarget(
            input({
                footY: 0.3,
                groundY: 0,
                prevTargetY: 0.2,
                feet: defaultFeet({ footSmooth: 0.5 }),
            })
        );
        // targetY = 0.2 + (0 - 0.2) * 0.5 = 0.1
        expect(r.targetY).toBeCloseTo(0.1);
    });

    it('触及倾角：腿够不到地面时趾尖额外下沉', () => {
        const r = solveFootTarget(
            input({
                footY: 0,
                groundY: 0,
                hipToFootDist: 2, // > legLength 1
                legLength: 1,
                feet: defaultFeet({ reachAngle: 30 }), // sin30 = 0.5
            })
        );
        // overshoot=1 → desiredY -= 0.5*1 = -0.5
        expect(r.targetY).toBeCloseTo(-0.5);
    });

    it('最大足倾角：钳制单帧垂直下拉幅度', () => {
        const r = solveFootTarget(
            input({
                footY: 2,
                groundY: 0,
                legLength: 1,
                feet: defaultFeet({ maxAngle: 30, jumpThreshold: 10 }), // maxDrop = sin30*1 = 0.5
            })
        );
        // footY - desiredY = 2 > maxDrop 0.5 → desiredY = 2 - 0.5 = 1.5
        expect(r.targetY).toBeCloseTo(1.5);
    });

    it('强度：intensity<1 时部分保留动画位置', () => {
        const r = solveFootTarget(
            input({
                footY: -0.2,
                groundY: 0,
                feet: defaultFeet({ intensity: 0.5 }),
            })
        );
        // targetY(上推后)=0 → blend: -0.2 + (0 - (-0.2)) * 0.5 = -0.1
        expect(r.targetY).toBeCloseTo(-0.1);
    });

    it('不跳过边界：脚踝等于跳跃阈值仍做校正', () => {
        const r = solveFootTarget(
            input({ footY: 0.5, groundY: 0, feet: defaultFeet({ jumpThreshold: 0.5 }) })
        );
        expect(r.skip).toBe(false);
    });

    it('相对阈值：高地形坡顶脚落回应贴地（不误判抬脚）', () => {
        // groundY=3.0 的山坡，脚落回 footY=3.0，相对高度 0 < 0.5 → 不跳过
        const r = solveFootTarget(
            input({ footY: 3.0, groundY: 3.0, feet: defaultFeet({ jumpThreshold: 0.5 }) })
        );
        expect(r.skip).toBe(false);
        expect(r.grounded).toBe(true);
        // desiredY = groundY + soleHeight = 3.0
        expect(r.targetY).toBeCloseTo(3.0);
    });

    it('相对阈值：高地形上脚真正抬起仍跳过', () => {
        // groundY=3.0 的山坡，脚抬到 footY=5.5，相对高度 2.5 > 0.5 → 跳过
        const r = solveFootTarget(
            input({ footY: 5.5, groundY: 3.0, feet: defaultFeet({ jumpThreshold: 0.5 }) })
        );
        expect(r.skip).toBe(true);
        expect(r.targetY).toBe(5.5);
    });

    it('reach 穿地缺陷：脚已穿透地面且腿过伸时不额外下沉（reach 仅对离地脚生效）', () => {
        // footY=-0.5 已穿地，hipToFootDist=2 > legLength=1 触发 reach。
        // 缺陷行为：reach 把 desiredY 拉到 -0.5，脚卡在地面下不贴地。
        // 修复后：脚在地面下 → reach 不生效 → desiredY=0 → 上推到地面。
        const r = solveFootTarget(
            input({
                footY: -0.5,
                groundY: 0,
                hipToFootDist: 2,
                legLength: 1,
                feet: defaultFeet({ reachAngle: 30 }),
            })
        );
        expect(r.skip).toBe(false);
        expect(r.targetY).toBeCloseTo(0);
    });

    it('reach 边界：脚恰在地面高度（footY==groundY）仍可额外下沉', () => {
        // 回归保护：reach 门控用 footY>=groundY，脚恰贴地时髋过伸仍应下沉趾尖
        const r = solveFootTarget(
            input({
                footY: 0,
                groundY: 0,
                hipToFootDist: 2,
                legLength: 1,
                feet: defaultFeet({ reachAngle: 30 }),
            })
        );
        expect(r.skip).toBe(false);
        expect(r.targetY).toBeCloseTo(-0.5);
    });

    it('NaN 守卫：groundY 为 NaN 时安全跳过（不向骨骼写入 NaN）', () => {
        const r = solveFootTarget(input({ footY: 0, groundY: NaN }));
        expect(r.skip).toBe(true);
        expect(r.grounded).toBe(false);
        expect(r.targetY).toBe(0);
    });

    it('NaN 守卫：footY 为 NaN 时安全跳过', () => {
        const r = solveFootTarget(input({ footY: NaN, groundY: 0 }));
        expect(r.skip).toBe(true);
        expect(r.grounded).toBe(false);
    });

    it('legLength=0 时 reach/maxAngle 不除零不产生 NaN', () => {
        const r = solveFootTarget(
            input({ footY: 0, groundY: 0, legLength: 0, hipToFootDist: 2 })
        );
        expect(Number.isFinite(r.targetY)).toBe(true);
        expect(r.skip).toBe(false);
    });
});
