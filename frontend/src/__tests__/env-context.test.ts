import { describe, it, expect, vi, beforeEach } from 'vitest';

// env-impl / env-context 共用 Babylon 类型 import，mock 根模块提供最小类即可
vi.mock('@babylonjs/core', () => ({
    Scene: class {},
    ParticleSystem: class {},
    DefaultRenderingPipeline: class {},
    StandardMaterial: class {},
    Texture: class {},
    Mesh: class {},
}));

import {
    initEnvImpl,
    resetEnvContext,
    getScene,
    isInitialized,
    getPipeline,
    INFINITE_GROUND_SIZE,
    effectiveGroundSize,
    resolveStaticAsset,
} from '../scene/env/_shared/env-context';

describe('env-context: 共享上下文与纯函数', () => {
    beforeEach(() => {
        resetEnvContext();
    });

    it('initEnvImpl 后 isInitialized/getScene/getPipeline 生效', () => {
        const scene: any = { tag: 'scene' };
        const pipeline: any = { tag: 'pipeline' };
        expect(isInitialized()).toBe(false);
        initEnvImpl(scene, pipeline);
        expect(isInitialized()).toBe(true);
        expect(getScene()).toBe(scene);
        expect(getPipeline()).toBe(pipeline);
    });

    it('[fix P2] resetEnvContext 复位共享引用 —— dispose 后 getScene/getPipeline 抛错', () => {
        const scene: any = { tag: 'scene' };
        const pipeline: any = { tag: 'pipeline' };
        initEnvImpl(scene, pipeline);
        expect(isInitialized()).toBe(true);
        // 关键修复行：disposeEnvUpdateObserver 末尾调用，防 HMR 幽灵引用
        resetEnvContext();
        expect(isInitialized()).toBe(false);
        expect(() => getScene()).toThrow('[env-context] Scene not initialized');
        expect(() => getPipeline()).toThrow('[env-context] Pipeline not initialized');
    });

    it('getScene 在未初始化时抛错', () => {
        expect(() => getScene()).toThrow('[env-context] Scene not initialized');
    });

    it('getPipeline 在未初始化时抛错', () => {
        expect(() => getPipeline()).toThrow('[env-context] Pipeline not initialized');
    });

    it('effectiveGroundSize: 无限地面走固定大尺寸，否则走给定尺寸', () => {
        expect(INFINITE_GROUND_SIZE).toBe(2000);
        expect(effectiveGroundSize(60, false)).toBe(60);
        expect(effectiveGroundSize(60, true)).toBe(INFINITE_GROUND_SIZE);
    });

    it('resolveStaticAsset: 绝对 URL / data: 原样返回', () => {
        const http = 'http://example.com/a.png';
        const https = 'https://example.com/a.png';
        const data = 'data:image/png;base64,AAAA';
        expect(resolveStaticAsset(http)).toBe(http);
        expect(resolveStaticAsset(https)).toBe(https);
        expect(resolveStaticAsset(data)).toBe(data);
    });

    it('resolveStaticAsset: 相对路径按 window.origin 解析', () => {
        const resolved = resolveStaticAsset('assets/sky.png');
        expect(resolved).toContain('assets/sky.png');
        expect(resolved.startsWith('http://') || resolved.startsWith('https://')).toBe(true);
    });
});
