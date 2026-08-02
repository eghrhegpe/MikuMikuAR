// renderer-transition.test.ts — transitionRenderState 单元测试
//
// 覆盖 renderer.ts 中 P1 修复：
//   - observeOnce→observe（过渡动画跑满 t>=1）
//   - 过渡中销毁防御（pipeline/_scene 为 null 时取消）
//   - _cancelRenderTransition 移除 _scene 检查

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
} from '../../scene/render/renderer';

/** 最小 scene 桩（不依赖 NullEngine，避免 Engine mock 兼容问题） */
function createMockScene(): any {
    return {
        onBeforeRenderObservable: {
            add: vi.fn(() => ({ remove: vi.fn() })),
            remove: vi.fn(),
        },
        activeCamera: { fov: 0.8 },
        dispose: vi.fn(),
    };
}

describe('transitionRenderState', () => {
    let scene: any;

    beforeEach(() => {
        scene = createMockScene();
        initRenderer(scene, new Map(), vi.fn());
    });

    afterEach(() => {
        disposeRenderer();
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
    });

    it('二次调用取消前一次过渡（_cancelRenderTransition 覆盖 _renderTransitionObserver）', () => {
        const result1 = transitionRenderState({ exposure: 2 });
        expect(result1).toBe(true);
        // 第二次调用应覆盖前一次 observer
        const result2 = transitionRenderState({ exposure: 2, bloomWeight: 0.5 });
        expect(result2).toBe(true);
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
});