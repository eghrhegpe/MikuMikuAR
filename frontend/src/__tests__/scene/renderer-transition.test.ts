// @vitest-environment node
// renderer-transition.test.ts — transitionRenderState 单元测试
//
// 覆盖 renderer.ts 中 P1 修复：
//   - observeOnce→observe（过渡动画跑满 t>=1）
//   - 过渡中销毁防御（pipeline/_scene 为 null 时取消）
//   - _cancelRenderTransition 移除 _scene 检查
// 另补审计边界：
//   - 二次调用真实移除前一个 observer
//   - duration NaN/Infinity/负数回退安全默认值
//   - 非有限数值目标不污染管线
//   - onComplete 只执行一次且 observer 不泄漏

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Babylon.js 轻量 mock（避免 WebGL 依赖）----
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => ({
    DefaultRenderingPipeline: class {
        samples = 1;
        fxaaEnabled = false;
        bloomEnabled = false;
        imageProcessingEnabled = true;
        imageProcessing = {
            toneMappingType: 0,
            exposure: 1,
            contrast: 1,
            vignetteEnabled: false,
            vignetteWeight: 0,
        };
        dispose() {}
        setRenderCamera() {}
    },
}));

vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline', () => ({
    SSRRenderingPipeline: class {},
}));
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline', () => ({
    SSAO2RenderingPipeline: class {},
}));
vi.mock('@babylonjs/core/PostProcesses/postProcess', () => ({ PostProcess: class {} }));
vi.mock('@babylonjs/core/Materials/effect', () => ({
    Effect: { ShadersStore: {} },
}));
vi.mock('@babylonjs/core/Layers/glowLayer', () => ({ GlowLayer: class {} }));

// 隔离全局 scene 单例（与 env-terrain.test.ts 同模式）
vi.mock('../../scene/scene', () => ({ scene: {} }));

import {
    initRenderer,
    disposeRenderer,
    transitionRenderState,
    isRendererReady,
    pipeline,
} from '../../scene/render/renderer';

/**
 * 最小 scene 桩（不依赖 NullEngine，避免 Engine mock 兼容问题）。
 * 带真实回调集合：emit 只调用仍注册的 observer，dispose 后旧回调不会再被触发，
 * 使“完成帧取消 observer”类断言与真实 Observable 语义一致。
 */
function createMockScene(): any {
    const callbacks = new Set<() => void>();
    return {
        onBeforeRenderObservable: {
            add: vi.fn((cb: () => void) => {
                callbacks.add(cb);
                const handle = { remove: vi.fn(() => callbacks.delete(cb)) };
                return handle;
            }),
            addOnce: vi.fn(),
            remove: vi.fn((handle: { remove: () => void }) => {
                handle.remove();
            }),
            emit: vi.fn(() => {
                for (const cb of [...callbacks]) {
                    cb();
                }
            }),
        },
        activeCamera: { fov: 0.8 },
        dispose: vi.fn(),
    };
}

// node 环境无 requestAnimationFrame；完成帧会经 setRenderState → scheduleRefresh 触发一次，
// 这里统一 stub 避免“ReferenceError: requestAnimationFrame is not defined”。
beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('transitionRenderState', () => {
    let scene: any;

    beforeEach(() => {
        scene = createMockScene();
        initRenderer(scene, new Map(), vi.fn());
    });

    afterEach(() => {
        disposeRenderer();
        vi.useRealTimers();
    });

    it('渲染就绪时返回 true', () => {
        expect(isRendererReady()).toBe(true);
        const result = transitionRenderState({ exposure: 2 });
        expect(result).toBe(true);
    });

    it('注册 observer 而非 observeOnce（可多次执行）', () => {
        transitionRenderState({ exposure: 2 });
        // observer 被注册到 onBeforeRenderObservable
        expect(scene.onBeforeRenderObservable.add).toHaveBeenCalled();
        expect(scene.onBeforeRenderObservable.addOnce).not.toHaveBeenCalled();
    });

    it('二次调用移除前一次 observer（_cancelRenderTransition 覆盖 _renderTransitionObserver）', () => {
        const result1 = transitionRenderState({ exposure: 2 });
        expect(result1).toBe(true);

        const firstObserver = scene.onBeforeRenderObservable.add.mock.results[0].value;

        // 第二次调用应覆盖前一次 observer
        const result2 = transitionRenderState({ exposure: 2, bloomWeight: 0.5 });
        expect(result2).toBe(true);
        expect(scene.onBeforeRenderObservable.remove).toHaveBeenCalledWith(firstObserver);
        expect(scene.onBeforeRenderObservable.add).toHaveBeenCalledTimes(2);
    });

    it('动画完成帧移除 observer 并只调用一次 onComplete', () => {
        vi.useFakeTimers();
        const onComplete = vi.fn();
        const result = transitionRenderState({ exposure: 2 }, 1000, onComplete);
        expect(result).toBe(true);

        vi.advanceTimersByTime(1000);
        scene.onBeforeRenderObservable.emit();

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(scene.onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);

        // observer 已移除，再次 emit 不应重复执行 onComplete
        scene.onBeforeRenderObservable.emit();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['负数', -1000],
    ])('非法 duration（%s）回退默认时长并正常收尾', (_label, duration) => {
        vi.useFakeTimers();
        const onComplete = vi.fn();
        const result = transitionRenderState({ exposure: 2 }, duration, onComplete);
        expect(result).toBe(true);

        // 非法 duration 应按安全默认时长完成，而不是 t 越界/永不取消
        vi.advanceTimersByTime(2000);
        scene.onBeforeRenderObservable.emit();

        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(scene.onBeforeRenderObservable.remove).toHaveBeenCalledTimes(1);
        expect(pipeline?.imageProcessing.exposure).toBe(2);
    });

    it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
    ])('非有限数值目标（%s）不污染管线', (_label, value) => {
        vi.useFakeTimers();
        transitionRenderState({ exposure: value }, 1000);

        vi.advanceTimersByTime(1000);
        scene.onBeforeRenderObservable.emit();

        // 非有限目标应被跳过，保持初始 exposure=1
        expect(pipeline?.imageProcessing.exposure).toBe(1);
        expect(Number.isFinite(pipeline?.imageProcessing.exposure ?? NaN)).toBe(true);
    });
});

describe('transitionRenderState — 销毁守卫', () => {
    let scene: any;

    beforeEach(() => {
        scene = createMockScene();
        initRenderer(scene, new Map(), vi.fn());
    });

    afterEach(() => {
        disposeRenderer();
        vi.useRealTimers();
    });

    it('dispose 后 pipeline 为 null，isRendererReady 返回 false', () => {
        expect(isRendererReady()).toBe(true);
        disposeRenderer();
        expect(isRendererReady()).toBe(false);
    });

    it('渲染未就绪时返回 false', () => {
        disposeRenderer();
        const result = transitionRenderState({ exposure: 2 });
        expect(result).toBe(false);
    });

    it('过渡中 dispose 后回调安全短路，不再触碰已释放对象', () => {
        transitionRenderState({ exposure: 2 });
        const callback = scene.onBeforeRenderObservable.add.mock.calls[0][0];

        disposeRenderer();
        expect(() => callback()).not.toThrow();
    });

    it('disposeRenderer 可重复调用（幂等）', () => {
        disposeRenderer();
        expect(() => disposeRenderer()).not.toThrow();
        expect(isRendererReady()).toBe(false);
    });

    it('dispose 后可重新 initRenderer（HMR 重入路径）', () => {
        disposeRenderer();
        scene = createMockScene();
        initRenderer(scene, new Map(), vi.fn());
        expect(isRendererReady()).toBe(true);
    });
});
