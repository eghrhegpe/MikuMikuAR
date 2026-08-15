// render-loop.test.ts — 渲染循环 + FPS 时钟单测（ADR-102）
// 覆盖 calcHardwareScaling（GL 纹理上限钳位）、startRenderLoop 幂等/场景销毁守卫/
// FPS 时钟/resize 处理、stopRenderLoop 资源清理。mock scene/performance/config/
// observer-handle/dispose-helpers，隔离 Babylon.js。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    const engine = {
        getCaps: vi.fn((): { maxTextureSize?: number } => ({ maxTextureSize: 4096 })),
        getRenderWidth: vi.fn(() => 1920),
        getRenderHeight: vi.fn(() => 1080),
        getHardwareScalingLevel: vi.fn(() => 1),
        setHardwareScalingLevel: vi.fn(),
        runRenderLoop: vi.fn(),
        stopRenderLoop: vi.fn(),
        getFps: vi.fn(() => 60),
        resize: vi.fn(),
    };
    const scene = {
        onBeforeRenderObservable: { observers: [] as unknown[], add: vi.fn(), remove: vi.fn() },
        onAfterRenderObservable: { observers: [] as unknown[], add: vi.fn(), remove: vi.fn() },
        isDisposed: false,
        render: vi.fn(),
    };
    const applyFrameControl = vi.fn();
    const updatePerformance = vi.fn();
    const getPerfRenderScaleMul = vi.fn(() => 1);
    const recalcPerformanceReference = vi.fn();
    const uiState = { renderScale: 1 };
    const dom = { fpsClock: { textContent: '' } };
    const formatTimestamp = vi.fn(() => '12:00:00');
    const logWarn = vi.fn();
    const observe = vi.fn(() => ({ dispose: vi.fn() }));
    const safeDispose = vi.fn((o: unknown) => {
        (o as { dispose?: () => void } | null)?.dispose?.();
        return null;
    });
    return {
        engine,
        scene,
        applyFrameControl,
        updatePerformance,
        getPerfRenderScaleMul,
        recalcPerformanceReference,
        uiState,
        dom,
        formatTimestamp,
        logWarn,
        observe,
        safeDispose,
    };
});

vi.mock('../scene/scene', () => ({
    engine: shared.engine,
    scene: shared.scene,
    applyFrameControl: shared.applyFrameControl,
}));
vi.mock('../scene/render/performance', () => ({
    updatePerformance: shared.updatePerformance,
    getPerfRenderScaleMul: shared.getPerfRenderScaleMul,
    recalcPerformanceReference: shared.recalcPerformanceReference,
}));
vi.mock('../core/config', () => ({
    uiState: shared.uiState,
    dom: shared.dom,
}));
vi.mock('@/core/format-timestamp', () => ({
    formatTimestamp: shared.formatTimestamp,
}));
vi.mock('../core/logger', () => ({
    logWarn: shared.logWarn,
}));
vi.mock('../core/observer-handle', () => ({
    observe: shared.observe,
}));
vi.mock('../core/dispose-helpers', () => ({
    safeDispose: shared.safeDispose,
}));

import { calcHardwareScaling, startRenderLoop, stopRenderLoop } from '../core/render-loop';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    shared.scene.isDisposed = false;
    shared.uiState.renderScale = 1;
    shared.getPerfRenderScaleMul.mockReturnValue(1);
    shared.dom.fpsClock.textContent = '';
    // 默认引擎规格：1920×1080 @1x，纹理上限 4096
    shared.engine.getCaps.mockReturnValue({ maxTextureSize: 4096 });
    shared.engine.getRenderWidth.mockReturnValue(1920);
    shared.engine.getRenderHeight.mockReturnValue(1080);
    shared.engine.getHardwareScalingLevel.mockReturnValue(1);
    shared.engine.getFps.mockReturnValue(60);
});

afterEach(() => {
    vi.unstubAllGlobals();
    stopRenderLoop();
    vi.restoreAllMocks();
});

describe('calcHardwareScaling（DPR×renderScale 钳位）', () => {
    it('无 maxTextureSize → 返回 base', () => {
        shared.engine.getCaps.mockReturnValue({ maxTextureSize: 0 });
        expect(calcHardwareScaling(2, 1)).toBeCloseTo(0.5);
    });

    it('renderScale=0 → 回退 1，不放大为 1000', () => {
        expect(calcHardwareScaling(1, 0)).toBeCloseTo(1);
    });

    it('负数/NaN/Infinity 入参回退 1 且结果有限', () => {
        expect(Number.isFinite(calcHardwareScaling(-2, 1))).toBe(true);
        expect(calcHardwareScaling(-2, 1)).toBeCloseTo(1);
        expect(calcHardwareScaling(2, -1)).toBeCloseTo(0.5); // 仅 renderScale 回退，dpr=2 保留
        expect(calcHardwareScaling(Number.NaN, 1)).toBeCloseTo(1);
        expect(calcHardwareScaling(1, Number.POSITIVE_INFINITY)).toBeCloseTo(1);
    });

    it('maxTextureSize 为负数/NaN/缺失时跳过钳位', () => {
        shared.engine.getCaps.mockReturnValue({ maxTextureSize: -1 });
        expect(calcHardwareScaling(2, 1)).toBeCloseTo(0.5);
        shared.engine.getCaps.mockReturnValue({ maxTextureSize: Number.NaN });
        expect(calcHardwareScaling(2, 1)).toBeCloseTo(0.5);
        shared.engine.getCaps.mockReturnValue({});
        expect(calcHardwareScaling(2, 1)).toBeCloseTo(0.5);
    });

    it('缓冲未超限 → 返回 base', () => {
        // 1920×1080，dpr=2, scale=1 → buf 3840×2160 < 4096
        expect(calcHardwareScaling(2, 1)).toBeCloseTo(0.5);
    });

    it('缓冲超限 → 按纹理上限钳位', () => {
        shared.engine.getCaps.mockReturnValue({ maxTextureSize: 1000 });
        // base=0.5, bufW=3840 → s=1000/3840=0.2604 → 0.5×0.2604=0.1302
        expect(calcHardwareScaling(2, 1)).toBeCloseTo(0.5 * (1000 / 3840), 4);
    });

    it('renderScale 参与计算', () => {
        // dpr=1, scale=0.5 → bufW=960 < 4096 → base=2
        expect(calcHardwareScaling(1, 0.5)).toBeCloseTo(2);
    });
});

describe('startRenderLoop（幂等 + 生命周期）', () => {
    it('启动注册 render loop + 前置清理（幂等）', () => {
        startRenderLoop();
        startRenderLoop();
        expect(shared.engine.stopRenderLoop).toHaveBeenCalledTimes(2);
        expect(shared.engine.runRenderLoop).toHaveBeenCalledTimes(2);
        expect(shared.applyFrameControl).toHaveBeenCalled();
    });

    it('重复 start 会先移除旧 resize 监听，不叠加', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        startRenderLoop();
        startRenderLoop();
        const resizeAdds = addSpy.mock.calls.filter(([type]) => type === 'resize').length;
        const resizeRemoves = removeSpy.mock.calls.filter(([type]) => type === 'resize').length;
        expect(resizeAdds).toBe(2);
        expect(resizeRemoves).toBe(1);
    });

    it('帧回调：scene 已 dispose → 不渲染并停止循环（P1 守卫）', () => {
        startRenderLoop();
        const cb = shared.engine.runRenderLoop.mock.calls[0][0] as () => void;
        shared.scene.isDisposed = true;
        shared.engine.stopRenderLoop.mockClear();
        cb();
        expect(shared.scene.render).not.toHaveBeenCalled();
        expect(shared.engine.stopRenderLoop).toHaveBeenCalled();
    });

    it('帧回调：正常渲染 + 性能采样', () => {
        startRenderLoop();
        const cb = shared.engine.runRenderLoop.mock.calls[0][0] as () => void;
        cb();
        expect(shared.scene.render).toHaveBeenCalled();
        expect(shared.updatePerformance).toHaveBeenCalled();
    });

    it('帧回调：scene.render 抛错 → 记录并自停', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        startRenderLoop();
        const cb = shared.engine.runRenderLoop.mock.calls[0][0] as () => void;
        shared.scene.render.mockImplementationOnce(() => {
            throw new Error('boom');
        });
        shared.engine.stopRenderLoop.mockClear();
        cb();
        expect(shared.engine.stopRenderLoop).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
    });

    it('降级乘数变化时立即重算 hardwareScalingLevel', () => {
        startRenderLoop();
        shared.getPerfRenderScaleMul.mockReturnValue(0.7);
        const cb = shared.engine.runRenderLoop.mock.calls[0][0] as () => void;
        shared.engine.setHardwareScalingLevel.mockClear();
        cb();
        expect(shared.engine.setHardwareScalingLevel).toHaveBeenCalled();
    });

    it('启动时已降级 → 首帧不重复 applyScaling', () => {
        shared.getPerfRenderScaleMul.mockReturnValue(0.7);
        startRenderLoop();
        const cb = shared.engine.runRenderLoop.mock.calls[0][0] as () => void;
        shared.engine.setHardwareScalingLevel.mockClear();
        cb();
        expect(shared.engine.setHardwareScalingLevel).not.toHaveBeenCalled();
    });

    it('FPS 时钟每 500ms 更新 dom.fpsClock', () => {
        vi.useFakeTimers();
        startRenderLoop();
        vi.advanceTimersByTime(500);
        expect(shared.dom.fpsClock.textContent).toMatch(/60 FPS \| \d{2}:\d{2}/);
    });

    it('resize 触发 engine.resize；DPR 变化时重算 scaling', () => {
        startRenderLoop();
        window.dispatchEvent(new Event('resize'));
        expect(shared.engine.resize).toHaveBeenCalled();
        // DPR 从 1 变 3 → applyScaling 再次被调
        vi.stubGlobal('devicePixelRatio', 3);
        shared.engine.setHardwareScalingLevel.mockClear();
        window.dispatchEvent(new Event('resize'));
        expect(shared.engine.setHardwareScalingLevel).toHaveBeenCalled();
        expect(shared.recalcPerformanceReference).toHaveBeenCalled();
    });
});

describe('stopRenderLoop（资源清理 + 幂等）', () => {
    it('清理 FPS 时钟 / resize 监听 / observer / render loop', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        vi.useFakeTimers();
        startRenderLoop();
        const resizeHandler = addSpy.mock.calls.find(([type]) => type === 'resize')?.[1];
        stopRenderLoop();
        expect(shared.engine.stopRenderLoop).toHaveBeenCalled();
        expect(shared.safeDispose).toHaveBeenCalledTimes(2); // _beforeObs/_afterObs
        const observerDisposeMocks = shared.observe.mock.results.map(
            (r) => (r.value as { dispose: ReturnType<typeof vi.fn> }).dispose
        );
        expect(observerDisposeMocks).toHaveLength(2);
        expect(observerDisposeMocks[0]).toHaveBeenCalled();
        expect(observerDisposeMocks[1]).toHaveBeenCalled();
        expect(removeSpy).toHaveBeenCalledWith('resize', resizeHandler);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('已启动后重复 stop 不重复清理 observer', () => {
        startRenderLoop();
        stopRenderLoop();
        const calls = shared.safeDispose.mock.calls.length;
        stopRenderLoop();
        expect(shared.safeDispose.mock.calls.length).toBe(calls);
    });

    it('未启动时 stop 幂等不崩', () => {
        expect(() => stopRenderLoop()).not.toThrow();
        stopRenderLoop();
        expect(shared.engine.stopRenderLoop).toHaveBeenCalled();
    });
});
