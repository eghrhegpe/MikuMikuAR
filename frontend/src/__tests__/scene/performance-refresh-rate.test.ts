// performance-refresh-rate.test.ts — ADR-118 刷新率感知自动降级单测
//
// 覆盖 ADR-118 Phase 1（刷新率相对阈值）+ Phase 2（运行时峰值校准 / recalc）：
//   1. 60Hz RSCALE=1 零回归（FPS<28 触发 L1，FPS≥32 恢复 L0）
//   2. 120Hz 阈值翻倍（FPS=45 触发 L1，60Hz 下 45 不会触发）
//   3. 240Hz 钳位（refreshRate=1000 → 钳至 240，FPS=100 触发 L1）
//   4. detectRefreshRate 缺失 / 非正数 → 回落 60Hz
//   5. recalcPerformanceReference 运行时更新硬件基准
//
// 测试隔离策略：vi.resetModules + 动态 import 确保每个用例获得干净的模块实例
// （_hardwareRefRate / _warmup / _fpsReady / _lastDegradeTime 等模块级状态不复用）。
// vi.useFakeTimers 控制 performance.now()，绕过 500ms 评估节流 + 3000ms 初始降级冷却。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LightState } from '../../scene/render/lighting';
import type { RenderState } from '../../scene/render/renderer';

// ======== Mocks（hoisted，对动态 import 同样生效）========

const h = vi.hoisted(() => ({
    setLightState: vi.fn(),
    setRenderState: vi.fn(),
    getLightState: vi.fn(() => ({}) as LightState),
    getRenderState: vi.fn(() => ({}) as RenderState),
    setAutoDegradingReflection: vi.fn(),
    setEnvStateForPerformance: vi.fn(),
    setUIState: vi.fn(),
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
        envState: {
            ...actual.envState,
            qualityProfile: 'high',
            reflectionQuality: 'high',
            cloudQuality: 'high',
            particleQuality: 'high',
        },
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

// ======== Helpers ========

type PerformanceModule = typeof import('../../scene/render/performance');

/** 安全设置 screen.refreshRate（非标准属性，jsdom 默认不存在）。 */
function setRefreshRate(hz: number | undefined): void {
    Object.defineProperty(window.screen, 'refreshRate', {
        value: hz,
        configurable: true,
        writable: true,
        enumerable: true,
    });
}

/** 设置刷新率后重置模块缓存并动态 import，确保模块级常量 _hardwareRefRate 读到新值。 */
async function loadPerf(hz: number | undefined): Promise<PerformanceModule> {
    setRefreshRate(hz);
    vi.resetModules();
    return await import('../../scene/render/performance');
}

function registerBridge(perf: PerformanceModule, getFps: () => number): void {
    perf.registerRenderBridge({
        engine: { getFps },
        setLightState: h.setLightState,
        setRenderState: h.setRenderState,
        getLightState: h.getLightState,
        getRenderState: h.getRenderState,
    });
}

/**
 * 驱动 updatePerformance 直至一次评估发生。
 * 流程：35 次调用填充 FPS 样本缓冲（_fpsSampleSize=30）→ 前进 3100ms 绕过
 * 500ms 评估节流 + 3000ms 初始降级冷却 → 再调一次触发评估。
 */
function driveEvaluation(perf: PerformanceModule): void {
    for (let i = 0; i < 35; i++) {
        perf.updatePerformance();
    }
    vi.advanceTimersByTime(3100);
    perf.updatePerformance();
}

beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    h.setLightState.mockClear();
    h.setRenderState.mockClear();
    h.setAutoDegradingReflection.mockClear();
    h.setEnvStateForPerformance.mockClear();
});

// ======== ADR-118 Phase 1: 刷新率相对阈值 ========

describe('ADR-118 Phase 1: 刷新率相对阈值', () => {
    it('60Hz — RSCALE=1，FPS<28 触发 L1 降级（零回归）', async () => {
        const perf = await loadPerf(60);
        registerBridge(perf, () => 25); // 低于 28 阈值
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);

        // 60Hz: L1 降级阈值 = 28 * 1 = 28; 25 < 28 → 降级
        expect(perf.getCurrentDegradeLevel()).toBe(1);
    });

    it('60Hz — FPS=45 不触发降级（对照组）', async () => {
        const perf = await loadPerf(60);
        registerBridge(perf, () => 45);
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);

        // 60Hz: L1 降级阈值 = 28; 45 >= 28 → 不降级
        expect(perf.getCurrentDegradeLevel()).toBe(0);
    });

    it('60Hz — L1 降级后 FPS≥32 恢复到 L0', async () => {
        const perf = await loadPerf(60);
        registerBridge(perf, () => 40); // 高于 32 恢复阈值
        perf.setPerformanceMode('auto');

        // 强制降级到 L1（绕过冷却）
        perf.setPerformanceMode('balanced');
        expect(perf.getCurrentDegradeLevel()).toBe(1);

        // 切回 auto，FPS=40 应触发恢复
        perf.setPerformanceMode('auto');
        driveEvaluation(perf);

        // 60Hz: L1 恢复阈值 = 32 * 1 = 32; 40 > 32 → 恢复 L0
        // 恢复冷却 2000ms，_lastRecoveryTime=0，t=3100 → 3100>=2000 → 通过
        expect(perf.getCurrentDegradeLevel()).toBe(0);
    });

    it('120Hz — 阈值翻倍，FPS=45 触发 L1（60Hz 下 45 不会触发）', async () => {
        const perf = await loadPerf(120);
        registerBridge(perf, () => 45);
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);

        // 120Hz: L1 降级阈值 = 28 * 2 = 56; 45 < 56 → 降级
        expect(perf.getCurrentDegradeLevel()).toBe(1);
    });
});

// ======== ADR-118 健壮性边界 ========

describe('ADR-118 健壮性边界', () => {
    it('refreshRate=1000 → 钳位 240，FPS=100 触发 L1', async () => {
        const perf = await loadPerf(1000);
        registerBridge(perf, () => 100);
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);

        // 钳位 240Hz: RSCALE=4, L1 阈值 = 28 * 4 = 112; 100 < 112 → 降级
        expect(perf.getCurrentDegradeLevel()).toBe(1);
    });

    it('refreshRate=undefined → 回落 60Hz，FPS=25 触发 L1', async () => {
        const perf = await loadPerf(undefined);
        registerBridge(perf, () => 25);
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);

        // 回落 60Hz: L1 阈值 = 28; 25 < 28 → 降级
        expect(perf.getCurrentDegradeLevel()).toBe(1);
    });

    it('refreshRate=0 → 回落 60Hz（非正数视为无效）', async () => {
        const perf = await loadPerf(0);
        registerBridge(perf, () => 25);
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);

        // 0 不满足 r > 0 → 回落 60Hz → 阈值 28; 25 < 28 → 降级
        expect(perf.getCurrentDegradeLevel()).toBe(1);
    });
});

// ======== ADR-118 Phase 2: recalcPerformanceReference ========

describe('ADR-118 Phase 2: recalcPerformanceReference', () => {
    it('运行时刷新率上升时，recalc 更新硬件基准并收紧降级触发', async () => {
        // 初始 60Hz 加载：FPS=45 不降级
        const perf = await loadPerf(60);
        registerBridge(perf, () => 45);
        perf.setPerformanceMode('auto');

        driveEvaluation(perf);
        expect(perf.getCurrentDegradeLevel()).toBe(0);

        // 模拟外接显示器切换到 120Hz
        setRefreshRate(120);
        perf.recalcPerformanceReference();

        // 前进时间绕过降级冷却（_lastDegradeTime=0，需 t≥3000）
        vi.advanceTimersByTime(3100);
        perf.updatePerformance();

        // 120Hz: L1 阈值 = 56; 45 < 56 → 降级
        expect(perf.getCurrentDegradeLevel()).toBe(1);
    });
});
