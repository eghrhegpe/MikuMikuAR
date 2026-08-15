// env-texture.test.ts — 统一贴图工厂（ADR-092）

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

import {
    createCanvasTexture,
    createCanvasDataURL,
    getOrCreateCanvasTexture,
    disposeTextureCache,
} from '../../scene/env/_shared/env-texture';

// happy-dom 无真实 2D canvas；为回退路径提供最小桩
beforeAll(() => {
    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (w: number, h: number) => ({
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
            }),
            putImageData: () => {},
            fillRect: () => {},
        }),
        toDataURL: () => 'data:image/png;base64,',
    };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
        tag === 'canvas' ? (fakeCanvas as any) : origCreate(tag)
    );
    return () => {
        vi.restoreAllMocks();
    };
});

describe('createCanvasTexture', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    it('用 DynamicTexture 创建贴图并调用 draw 回调', () => {
        const draw = vi.fn((ctx: CanvasRenderingContext2D, size: number) => {
            expect(size).toBe(64);
            // 用 getContext 桩支持的方法
        });
        const tex = createCanvasTexture({ size: 64, draw, scene, name: 'testTex' });
        expect(tex).toBeInstanceOf(Texture);
        expect(draw).toHaveBeenCalledOnce();
        tex.dispose();
    });

    it('设置 CLAMP / WRAP 地址模式', () => {
        const draw = vi.fn();
        const texClamp = createCanvasTexture({ size: 16, draw, scene, wrap: 'clamp' });
        expect(texClamp.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
        expect(texClamp.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
        texClamp.dispose();

        const texWrap = createCanvasTexture({ size: 16, draw, scene, wrap: 'wrap' });
        expect(texWrap.wrapU).toBe(Texture.WRAP_ADDRESSMODE);
        expect(texWrap.wrapV).toBe(Texture.WRAP_ADDRESSMODE);
        texWrap.dispose();
    });

    it('传递 getAlphaFromRGB 与 hasAlpha', () => {
        const draw = vi.fn();
        const tex1 = createCanvasTexture({ size: 16, draw, scene, getAlphaFromRGB: true });
        expect(tex1.getAlphaFromRGB).toBe(true);
        tex1.dispose();

        const tex2 = createCanvasTexture({ size: 16, draw, scene, hasAlpha: true });
        expect(tex2.hasAlpha).toBe(true);
        tex2.dispose();
    });
});

describe('getOrCreateCanvasTexture', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        disposeTextureCache();
        scene.dispose();
        engine.dispose();
    });

    it('同一 key 返回缓存的贴图，draw 只调用一次', () => {
        const draw = vi.fn();
        const opts = { size: 32, draw, scene, name: 'cached' };
        const t1 = getOrCreateCanvasTexture('cache-key-1', opts);
        const t2 = getOrCreateCanvasTexture('cache-key-1', opts);
        expect(t1).toBe(t2);
        expect(draw).toHaveBeenCalledOnce();
    });

    it('不同 key 返回不同贴图', () => {
        const draw = vi.fn();
        const t1 = getOrCreateCanvasTexture('key-a', { size: 32, draw, scene });
        const t2 = getOrCreateCanvasTexture('key-b', { size: 32, draw, scene });
        expect(t1).not.toBe(t2);
    });

    it('超过缓存上限时淘汰索引但不立即释放旧贴图', () => {
        const draw = vi.fn();
        const first = getOrCreateCanvasTexture('evict-0', { size: 16, draw, scene });
        const disposeSpy = vi.spyOn(first, 'dispose');
        for (let i = 1; i <= 32; i++) {
            getOrCreateCanvasTexture(`evict-${i}`, { size: 16, draw, scene });
        }
        expect(disposeSpy).not.toHaveBeenCalled();
        expect(getOrCreateCanvasTexture('evict-0', { size: 16, draw, scene })).not.toBe(first);
        disposeTextureCache();
        expect(disposeSpy).toHaveBeenCalledOnce();
    });
});

describe('disposeTextureCache', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        disposeTextureCache();
        scene.dispose();
        engine.dispose();
    });

    it('清空缓存且不抛异常', () => {
        const draw = vi.fn();
        getOrCreateCanvasTexture('d-key', { size: 16, draw, scene });
        getOrCreateCanvasTexture('d-key-2', { size: 16, draw, scene });
        expect(() => disposeTextureCache()).not.toThrow();
    });

    it('dispose 后同 key 重新创建新贴图', () => {
        const draw = vi.fn();
        const t1 = getOrCreateCanvasTexture('fresh-key', { size: 16, draw, scene });
        disposeTextureCache();
        const t2 = getOrCreateCanvasTexture('fresh-key', { size: 16, draw, scene });
        expect(t2).not.toBe(t1);
        expect(draw).toHaveBeenCalledTimes(2);
    });
});

describe('边界补强', () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine();
        scene = new Scene(engine);
    });

    afterEach(() => {
        disposeTextureCache();
        scene.dispose();
        engine.dispose();
    });

    it('draw 抛错时回退且不泄漏 DynamicTexture', () => {
        const draw = vi.fn(() => {
            throw new Error('boom');
        });
        const tex = createCanvasTexture({ size: 16, draw, scene, name: 'fallback' });
        expect(tex).toBeInstanceOf(Texture);
        expect(scene.textures.length).toBe(1);
        tex.dispose();
    });

    it('非法 wrap 回退到 clamp', () => {
        const draw = vi.fn(() => {
            throw new Error('boom');
        });
        const tex = createCanvasTexture({
            size: 16,
            draw,
            scene,
            wrap: 'bogus' as 'clamp' | 'wrap',
        });
        expect(tex.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
        expect(tex.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
        tex.dispose();
    });

    it('非正/非有限尺寸归一为 1', () => {
        for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            const draw = vi.fn();
            const tex = createCanvasTexture({ size, draw, scene });
            const w = tex.getSize().width;
            expect(Number.isFinite(w)).toBe(true);
            expect(w).toBeGreaterThan(0);
            tex.dispose();
        }
    });

    it('scene dispose 后创建不抛异常', () => {
        scene.dispose();
        const draw = vi.fn();
        expect(() => createCanvasTexture({ size: 16, draw, scene })).not.toThrow();
    });

    it('createCanvasDataURL 非法尺寸归一为 1', () => {
        const draw = vi.fn((_ctx: CanvasRenderingContext2D, size: number) => {
            expect(size).toBe(1);
        });
        expect(createCanvasDataURL({ size: 0, draw })).toBe('data:image/png;base64,');
        expect(draw).toHaveBeenCalledOnce();
    });
});
