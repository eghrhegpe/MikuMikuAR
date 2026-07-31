// [doc:adr-196] scene-snapshot 守护测试：快照格式化、bridge 注入、未初始化降级。
// 纯函数 + bridge 模式测试，不依赖 Babylon 引擎。
// 注意：registerAiSnapshotBridge 写模块级 _bridge 单例，故每个 describe 需在 beforeEach 中重置。

import { describe, it, expect, beforeEach } from 'vitest';
import {
    formatSceneSnapshot,
    captureSceneSnapshotData,
    captureSceneSnapshot,
    registerAiSnapshotBridge,
    _resetAiSnapshotBridge,
    type SceneSnapshotData,
    type SceneSnapshotBridge,
} from '../scene-snapshot';

function makeBridge(overrides?: Partial<SceneSnapshotBridge>): SceneSnapshotBridge {
    return {
        getFps: () => 60,
        getModelCount: () => 1,
        getMeshCount: () => 100,
        getMaterialCount: () => 50,
        getActiveMotions: () => [],
        getPerformanceMode: () => 'balanced',
        getRendererInfo: () => ({ vendor: 'Test', renderer: 'Mock' }),
        getKtx2Support: () => ({ supported: false, preferredFormat: undefined }),
        ...overrides,
    };
}

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
    beforeEach(() => {
        _resetAiSnapshotBridge();
    });

    it('未注册 bridge 时返回 null', () => {
        expect(captureSceneSnapshotData()).toBeNull();
    });

    it('注册 bridge 后返回快照数据', () => {
        registerAiSnapshotBridge(makeBridge({ getActiveMotions: () => ['test.vmd'] }));
        const data = captureSceneSnapshotData();
        expect(data).not.toBeNull();
        expect(data!.fps).toBe(60);
        expect(data!.activeMotions).toEqual(['test.vmd']);
    });
});

describe('captureSceneSnapshot', () => {
    beforeEach(() => {
        _resetAiSnapshotBridge();
    });

    it('未初始化时返回占位符', () => {
        // _bridge 已被 beforeEach 重置为 null
        const text = captureSceneSnapshot();
        expect(text).toBe('(场景未初始化)');
    });

    it('已注册 bridge 时返回完整格式化快照', () => {
        registerAiSnapshotBridge(
            makeBridge({
                getFps: () => 59.9,
                getModelCount: () => 3,
                getMeshCount: () => 200,
                getMaterialCount: () => 100,
                getActiveMotions: () => ['dance.vmd', 'wave.vmd'],
                getPerformanceMode: () => 'quality',
                getRendererInfo: () => ({ vendor: 'AMD', renderer: 'Radeon RX 7900' }),
                getKtx2Support: () => ({ supported: true, preferredFormat: 'bc7' }),
            })
        );
        const text = captureSceneSnapshot();
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
        registerAiSnapshotBridge(
            makeBridge({
                getActiveMotions: () => [],
                getKtx2Support: () => ({ supported: false, preferredFormat: undefined }),
            })
        );
        const text = captureSceneSnapshot();
        expect(text).toContain('活动动画: (无)');
        expect(text).toContain('KTX2: 不支持');
    });
});
