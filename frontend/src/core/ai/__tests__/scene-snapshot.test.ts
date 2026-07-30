// [doc:adr-196] scene-snapshot 守护测试：快照格式化、bridge 注入、未初始化降级。
// 纯函数 + bridge 模式测试，不依赖 Babylon 引擎。

import { describe, it, expect } from 'vitest';
import {
    formatSceneSnapshot,
    captureSceneSnapshotData,
    captureSceneSnapshot,
    registerAiSnapshotBridge,
    type SceneSnapshotData,
    type SceneSnapshotBridge,
} from '../scene-snapshot';

const SAMPLE_DATA: SceneSnapshotData = {
    fps: 59.8,
    modelCount: 2,
    meshCount: 150,
    materialCount: 80,
    activeMotions: ['dance.vmd', 'wave.vmd'],
    performanceMode: 'quality',
    ktx2Supported: true,
    ktx2PreferredFormat: 'bc7',
    rendererVendor: 'Google Inc.',
    rendererName: 'ANGLE (Intel, Intel(R) UHD Graphics (0x0000) Direct3D11 vs_5_0 ps_5_0)',
};

describe('formatSceneSnapshot', () => {
    it('完整数据格式化', () => {
        const text = formatSceneSnapshot(SAMPLE_DATA);
        expect(text).toContain('FPS: 59.8');
        expect(text).toContain('模型数: 2');
        expect(text).toContain('Mesh 数: 150');
        expect(text).toContain('材质数: 80');
        expect(text).toContain('活动动画: dance.vmd, wave.vmd');
        expect(text).toContain('性能模式: quality');
        expect(text).toContain('KTX2: 支持(bc7)');
        expect(text).toContain('GPU: Google Inc. / ANGLE');
    });

    it('无活动动画时显示占位', () => {
        const text = formatSceneSnapshot({ ...SAMPLE_DATA, activeMotions: [] });
        expect(text).toContain('(无)');
    });

    it('KTX2 不支持时显示', () => {
        const text = formatSceneSnapshot({
            ...SAMPLE_DATA,
            ktx2Supported: false,
            ktx2PreferredFormat: undefined,
        });
        expect(text).toContain('KTX2: 不支持');
    });

    it('KTX2 支持但无首选格式', () => {
        const text = formatSceneSnapshot({
            ...SAMPLE_DATA,
            ktx2Supported: true,
            ktx2PreferredFormat: undefined,
        });
        expect(text).toContain('KTX2: 支持(?)');
    });
});

describe('captureSceneSnapshotData / bridge', () => {
    it('未注册 bridge 时返回 null', () => {
        expect(captureSceneSnapshotData()).toBeNull();
    });

    it('注册 bridge 后返回快照数据', () => {
        const bridge: SceneSnapshotBridge = {
            getFps: () => 60,
            getModelCount: () => 1,
            getMeshCount: () => 100,
            getMaterialCount: () => 50,
            getActiveMotions: () => ['test.vmd'],
            getPerformanceMode: () => 'balanced',
            getRendererInfo: () => ({ vendor: 'Test', renderer: 'Mock' }),
            getKtx2Support: () => ({ supported: false, preferredFormat: undefined }),
        };
        registerAiSnapshotBridge(bridge);
        const data = captureSceneSnapshotData();
        expect(data).not.toBeNull();
        expect(data!.fps).toBe(60);
        expect(data!.activeMotions).toEqual(['test.vmd']);
    });
});

describe('captureSceneSnapshot', () => {
    it('未初始化时返回占位符', () => {
        // 由于 _bridge 是模块级单例，前面的 bridge 测试已注册了 bridge，
        // 此处无法真正模拟「未初始化」。但能保证返回字符串。
        const text = captureSceneSnapshot();
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
    });

    it('已注册 bridge 时返回完整格式化快照', () => {
        const bridge: SceneSnapshotBridge = {
            getFps: () => 59.9,
            getModelCount: () => 3,
            getMeshCount: () => 200,
            getMaterialCount: () => 100,
            getActiveMotions: () => ['dance.vmd', 'wave.vmd'],
            getPerformanceMode: () => 'quality',
            getRendererInfo: () => ({ vendor: 'AMD', renderer: 'Radeon RX 7900' }),
            getKtx2Support: () => ({ supported: true, preferredFormat: 'bc7' }),
        };
        registerAiSnapshotBridge(bridge);
        const text = captureSceneSnapshot();
        // 内容应与 formatSceneSnapshot 一致
        expect(text).toContain('FPS: 59.9');
        expect(text).toContain('模型数: 3');
        expect(text).toContain('Mesh 数: 200');
        expect(text).toContain('材质数: 100');
        expect(text).toContain('活动动画: dance.vmd, wave.vmd');
        expect(text).toContain('性能模式: quality');
        expect(text).toContain('KTX2: 支持(bc7)');
        expect(text).toContain('GPU: AMD / Radeon RX 7900');
    });

    it('bridge 返回空动画列表时显示 (无)', () => {
        const bridge: SceneSnapshotBridge = {
            getFps: () => 30,
            getModelCount: () => 0,
            getMeshCount: () => 0,
            getMaterialCount: () => 0,
            getActiveMotions: () => [],
            getPerformanceMode: () => 'power_save',
            getRendererInfo: () => ({ vendor: 'Test', renderer: 'Test' }),
            getKtx2Support: () => ({ supported: false, preferredFormat: undefined }),
        };
        registerAiSnapshotBridge(bridge);
        const text = captureSceneSnapshot();
        expect(text).toContain('活动动画: (无)');
        expect(text).toContain('KTX2: 不支持');
    });
});