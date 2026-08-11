// @vitest-environment node
// [doc:adr-071] 感知层 — 呼吸轴向回归测试
// 锁定：呼吸应绕角色左右方向轴（X / Vector3.Right）做俯仰（挺胸/含胸，前后微动），
// 而非绕垂直轴（Y / Vector3.Up）做偏航（左右摇摆）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { PerceptionContext, PerceptionState } from '../scene/motion/perception-shared';
import { _createPerceptionPool } from '../scene/motion/perception-shared';

type Sut = typeof import('../scene/motion/perception-breathing');
type SharedMod = typeof import('../scene/motion/perception-shared');
let sut: Sut;
let _setContextPool: SharedMod['_setContextPool'];
let _resetContextPool: SharedMod['_resetContextPool'];

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
        gazeCache: { headWorldQ: null, eyeLocalQ: new Map() },
    };
}

let ctx: PerceptionContext;

beforeEach(async () => {
    vi.resetModules();
    // 动态导入，确保与 perception-breathing 共享同一个 perception-shared 模块实例
    const shared = await import('../scene/motion/perception-shared');
    _setContextPool = shared._setContextPool;
    _resetContextPool = shared._resetContextPool;
    sut = await import('../scene/motion/perception-breathing');
    ctx = makeCtx();
    // 激活对象池（与 production perception-observer 一致），否则 _q() 走 fallback
    _setContextPool(ctx.pool);
    _resetContextPool();
});

afterEach(() => {
    _setContextPool(null);
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

describe('_applyBreathing 边界路径', () => {
    it('rotationQuaternion 为 null 时安全返回，不写 lastOffsets', () => {
        const model = {
            runtimeBones: [
                { name: '上半身', linkedBone: { rotationQuaternion: null } },
            ],
        } as any;
        expect(() => sut._applyBreathing(model, 1, ctx)).not.toThrow();
        // 提前 return → lastOffsets.breath 保持 0
        expect(ctx.lastOffsets.breath).toBe(0);
    });

    it('claimedBones 不包含目标骨骼时跳过（被其他系统占用）', () => {
        const { model, curQ } = makeSpineModel();
        // claimedBones 只包含 '下半身'，不包含 '上半身' → 应跳过
        sut._applyBreathing(model, 1, ctx, ['下半身']);
        expect(curQ.x).toBe(0);
        expect(curQ.y).toBe(0);
        // 跳过 → lastOffsets 不更新
        expect(ctx.lastOffsets.breath).toBe(0);
    });

    it('claimedBones 包含目标骨骼时正常执行', () => {
        const { model, curQ } = makeSpineModel();
        sut._applyBreathing(model, 1, ctx, ['上半身']);
        expect(Math.abs(curQ.x)).toBeGreaterThan(1e-4);
    });

    it('跨帧增量叠加：lastOffsets.breath 逐帧更新', () => {
        const { model, curQ } = makeSpineModel();
        // 第 1 帧
        sut._applyBreathing(model, 0.5, ctx);
        const offset1 = ctx.lastOffsets.breath;
        expect(offset1).not.toBe(0);

        // 第 2 帧（不同 time → 不同 phase → 不同 offset）
        sut._applyBreathing(model, 1.0, ctx);
        const offset2 = ctx.lastOffsets.breath;
        expect(offset2).not.toBe(offset1);
    });

    it('amp=0 时仍更新 lastOffsets.breath（确保关闭瞬间不残留冻结）', () => {
        // 先跑一帧建立非零 lastOffsets
        const { model } = makeSpineModel();
        sut._applyBreathing(model, 1, ctx);
        expect(ctx.lastOffsets.breath).not.toBe(0);

        // 切到 amp=0，再跑一帧
        ctx.state.breathAmplitude = 0;
        const curQ2 = new Quaternion(0, 0, 0, 1);
        const spine2 = {
            name: '上半身',
            linkedBone: { rotationQuaternion: curQ2 },
        };
        const model2 = { runtimeBones: [spine2] } as any;
        sut._applyBreathing(model2, 2, ctx);
        // amp=0 → breathOffset=0 → lastOffsets 应被清零（撤销残留）
        // 注意：0 * sin(负值) = -0，语义上仍为零
        expect(ctx.lastOffsets.breath + 0).toBe(0);
    });

    it('对象池被实际使用（池索引前进）', () => {
        const idxBefore = ctx.pool._qIdx;
        const { model } = makeSpineModel();
        sut._applyBreathing(model, 1, ctx);
        // _applyBreathing 内部调用 _q() 两次（deltaQ + localQ）
        expect(ctx.pool._qIdx).toBe(idxBefore + 2);
    });
});

describe('_updateBoneChain', () => {
    it('对含 updateWorldMatrix 的骨骼递归调用', () => {
        const calls: string[] = [];
        const grandChild = {
            name: '首',
            updateWorldMatrix: () => {
                calls.push('grandChild');
            },
            childBones: [],
        };
        const child = {
            name: '上半身2',
            updateWorldMatrix: () => {
                calls.push('child');
            },
            childBones: [grandChild],
        };
        sut._updateBoneChain(child as any);
        expect(calls).toEqual(['child', 'grandChild']);
    });

    it('对无 updateWorldMatrix 的骨骼安全跳过（WASM runtime）', () => {
        const bone = {
            name: '上半身2',
            childBones: [{ name: '首', childBones: [] }],
        };
        // 不含 updateWorldMatrix → 不进入递归，不抛异常
        expect(() => sut._updateBoneChain(bone as any)).not.toThrow();
    });
});
