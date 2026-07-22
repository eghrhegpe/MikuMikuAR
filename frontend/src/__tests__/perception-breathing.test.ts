// [doc:adr-071] 感知层 — 呼吸轴向回归测试
// 锁定：呼吸应绕角色左右方向轴（X / Vector3.Right）做俯仰（挺胸/含胸，前后微动），
// 而非绕垂直轴（Y / Vector3.Up）做偏航（左右摇摆）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { PerceptionContext, PerceptionState } from '../scene/motion/perception-shared';
import { _createPerceptionPool } from '../scene/motion/perception-shared';

type Sut = typeof import('../scene/motion/perception-breathing');
let sut: Sut;

const _defaultState: PerceptionState = {
    breathFrequency: 0.3,
    breathAmplitude: 0.02,
    blinkFrequency: 0.25,
    blinkAmplitude: 1,
    headTrackingEnabled: false,
    eyeTrackingEnabled: false,
    microExpressionEnabled: false,
    balanceSwayEnabled: false,
    lipSyncEnabled: false,
    emotion: 'neutral',
    breathEnabled: true,
    blinkEnabled: true,
    headGazeMaxYaw: 45,
    headGazeMaxPitch: 30,
    eyeGazeMaxYaw: 10,
    eyeGazeMaxPitch: 8,
    eyeGazeSmooth: 0.7,
    lipSyncSensitivity: 0.5,
    lipSyncIntensity: 0.5,
    lipSyncMultiMorphEnabled: false,
    balanceSwayPeriod: 3,
    balanceSwayAmplitude: 0.3,
};

function makeCtx(state?: Partial<PerceptionState>): PerceptionContext {
    return {
        modelId: 'test-model',
        state: { ..._defaultState, ...state },
        isActive: true,
        isPinned: false,
        lastOffsets: {
            breath: 0,
            balance: {
                lastBobY: 0,
                swayCenterName: null,
                lastCenterRz: 0,
                lastCenterRx: 0,
                lastUpperRx: 0,
                lastWaistRz: 0,
                lastAllParentRx: 0,
                lastAllParentRz: 0,
            },
            emotion: null,
        },
        pool: _createPerceptionPool(),
        gazeCache: { headWorldQ: null, eyeWorldQ: new Map() },
    };
}

let ctx: PerceptionContext;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/perception-breathing');
    ctx = makeCtx();
});

/** 构造一个仅含「上半身」骨骼的最小 MmdModel（骨骼名命中 BONE_UPPER_CANDIDATES） */
function makeSpineModel(): { model: any; curQ: Quaternion } {
    const curQ = new Quaternion(0, 0, 0, 1); // 初始 identity
    const spine = {
        name: '上半身',
        linkedBone: { rotationQuaternion: curQ },
        // 故意不提供 updateWorldMatrix / childBones → 跳过世界矩阵递归，聚焦轴向断言
    };
    return { model: { runtimeBones: [spine] }, curQ };
}

describe('_applyBreathing 轴向', () => {
    it('绕 X 轴（俯仰）旋转：curQ.x 非零、curQ.y ≈ 0（前后起伏，非左右摇摆）', () => {
        const { model, curQ } = makeSpineModel();
        // time=1 → phase=0.3·2π≈1.88rad，sin≈0.95 → breathOffset≈0.019rad，确保非零旋转
        sut._applyBreathing(model, 1, ctx);

        // 俯仰（Pitch）体现在四元数 X 分量；偏航（Yaw）体现在 Y 分量
        expect(Math.abs(curQ.x)).toBeGreaterThan(1e-4);
        expect(Math.abs(curQ.y)).toBeLessThan(1e-6);
        expect(Math.abs(curQ.z)).toBeLessThan(1e-6);
    });

    it('无匹配上半身骨骼时安全返回，不抛异常', () => {
        const curQ = new Quaternion(0, 0, 0, 1);
        const model = {
            runtimeBones: [{ name: '左足', linkedBone: { rotationQuaternion: curQ } }],
        } as any;
        expect(() => sut._applyBreathing(model, 1, ctx)).not.toThrow();
        // 未命中 → curQ 保持 identity
        expect(curQ.x).toBe(0);
        expect(curQ.y).toBe(0);
    });
});
