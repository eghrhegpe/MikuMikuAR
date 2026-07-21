// performance-snapshot.test.ts — 性能降级快照恢复路径单测
//
// 覆盖收口后的 `_restoreSnapshot`（applyDegrade level=0 与 resetPerformanceSnapshot 共用）：
//   1. 降级建立快照 → 恢复时用原始值回写 light/render/env
//   2. 恢复全程 `_suppressSnapshotReset` 守卫为 true（防「降级→恢复→再降级」反馈循环）
//   3. 无快照时 resetPerformanceSnapshot 为 no-op（不误触发回写）
//
// performance.ts 从 '../scene' 导入 engine（模块级 new Scene()），故 mock 整个 '../scene'
// 避免拉起真实 Babylon 场景。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 原始（用户）设置：快照应捕获并在恢复时精确回写这些值
const ORIGINAL_LIGHT = { hemiIntensity: 0.9, dirIntensity: 0.5 };
const ORIGINAL_RENDER = { msaaSamples: 8 };

// vi.mock 工厂被提升到文件顶部，故 spy 须用 vi.hoisted 声明以在工厂内可用。
const h = vi.hoisted(() => {
    // 记录 setLightState 被调用时抑制标志的实时值（回调在下方 wire 后填充）
    const box: { suppressedDuringRestore: boolean | null; isSuppressed: () => boolean } = {
        suppressedDuringRestore: null,
        isSuppressed: () => false,
    };
    const setLightState = vi.fn(() => {
        box.suppressedDuringRestore = box.isSuppressed();
    });
    return {
        box,
        setLightState,
        setRenderState: vi.fn(),
        getLightState: vi.fn(() => ({ hemiIntensity: 0.9, dirIntensity: 0.5 })),
        getRenderState: vi.fn(() => ({ msaaSamples: 8 })),
        setAutoDegradingReflection: vi.fn(),
        setEnvStateForPerformance: vi.fn(),
        setUIState: vi.fn(),
    };
});

vi.mock('../../scene/scene', () => ({
    engine: { getFps: () => 60 },
    scene: { onBeforeRenderObservable: { add: () => ({}), remove: () => {} } },
    setLightState: h.setLightState,
    setRenderState: h.setRenderState,
    getLightState: h.getLightState,
    getRenderState: h.getRenderState,
}));

vi.mock('../../scene/render/performance-env-bridge', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../scene/render/performance-env-bridge')>();
    return {
        ...actual,
        setAutoDegradingReflection: h.setAutoDegradingReflection,
        setEnvStateForPerformance: h.setEnvStateForPerformance,
    };
});

vi.mock('@/core/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/config')>();
    return {
        ...actual,
        envState: { ...actual.envState, qualityProfile: 'high', reflectionQuality: 'high' },
    };
});

vi.mock('@/core/state', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/state')>();
    return {
        ...actual,
        uiState: { ...actual.uiState, performanceMode: 'auto' },
        setUIState: h.setUIState,
    };
});

vi.mock('@/core/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/utils')>();
    return { ...actual, formatTimestamp: () => '00:00:00' };
});

import {
    setPerformanceMode,
    resetPerformanceSnapshot,
    getCurrentDegradeLevel,
    isSnapshotResetSuppressed,
} from '../../scene/render/performance';

// wire：让 setLightState mock 能读到真实抑制标志
h.box.isSuppressed = isSnapshotResetSuppressed;

beforeEach(() => {
    // 每例复位到全质量（清 level/snapshot），并清空 spy 历史
    resetPerformanceSnapshot();
    h.setLightState.mockClear();
    h.setRenderState.mockClear();
    h.getLightState.mockClear();
    h.getRenderState.mockClear();
    h.setAutoDegradingReflection.mockClear();
    h.setEnvStateForPerformance.mockClear();
    h.box.suppressedDuringRestore = null;
});

describe('性能快照恢复（_restoreSnapshot 收口路径）', () => {
    it('降级建立快照后，恢复用原始 light/render 值回写并归零 level', () => {
        // 强制降级到 performance（level 2）→ 建立快照（捕获 ORIGINAL_*）
        setPerformanceMode('performance');
        expect(getCurrentDegradeLevel()).toBe(2);

        // 清掉降级过程产生的调用，只观察恢复
        h.setLightState.mockClear();
        h.setRenderState.mockClear();

        // 手动重置 → 触发 _restoreSnapshot 回写原始值
        resetPerformanceSnapshot();

        expect(getCurrentDegradeLevel()).toBe(0);
        expect(h.setLightState).toHaveBeenCalledWith(ORIGINAL_LIGHT);
        expect(h.setRenderState).toHaveBeenCalledWith(ORIGINAL_RENDER);
    });

    it('恢复时环境快照非空 → 桥接 setEnvStateForPerformance 且成对切换降级标志', () => {
        setPerformanceMode('performance');
        h.setAutoDegradingReflection.mockClear();
        h.setEnvStateForPerformance.mockClear();

        resetPerformanceSnapshot();

        // env 快照含 qualityProfile/reflectionQuality → 走桥接分支
        expect(h.setEnvStateForPerformance).toHaveBeenCalledWith(
            { qualityProfile: 'high', reflectionQuality: 'high' },
            true
        );
        // 成对切换：先 true 后 false
        expect(h.setAutoDegradingReflection).toHaveBeenNthCalledWith(1, true);
        expect(h.setAutoDegradingReflection).toHaveBeenNthCalledWith(2, false);
    });

    it('回写 light 时抑制标志为 true（防反馈循环）', () => {
        setPerformanceMode('performance');
        h.box.suppressedDuringRestore = null;

        resetPerformanceSnapshot();

        // _restoreSnapshot 内 setLightState 调用瞬间，_suppressSnapshotReset 必须为 true
        expect(h.box.suppressedDuringRestore).toBe(true);
        // 恢复结束后标志复位
        expect(isSnapshotResetSuppressed()).toBe(false);
    });

    it('无快照时 resetPerformanceSnapshot 为 no-op（不误触发回写）', () => {
        // 当前无快照（beforeEach 已复位）
        resetPerformanceSnapshot();

        expect(h.setLightState).not.toHaveBeenCalled();
        expect(h.setRenderState).not.toHaveBeenCalled();
        expect(h.setEnvStateForPerformance).not.toHaveBeenCalled();
        expect(getCurrentDegradeLevel()).toBe(0);
    });
});
