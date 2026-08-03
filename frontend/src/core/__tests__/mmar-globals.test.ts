import { describe, it, expect, vi, beforeEach } from 'vitest';

// 动态 import 目标全部 mock 掉，避免拉起 Babylon / scene 重依赖；
// mock 路径须解析到与源码一致的绝对模块（相对测试文件需多退一级）。
vi.mock('../../scene/scene', () => ({
    engine: { getFps: () => 60, _gl: undefined },
    scene: { meshes: [{}, {}, {}] },
    modelManager: { getAll: () => [{ name: 'A' }, { name: 'B' }] },
}));
vi.mock('../../scene/manager/model-ops', () => ({
    focusedModel: () => ({ name: 'A' }),
}));
vi.mock('../../scene/motion/motion-intent', () => ({
    getActiveMotion: () => ({ vmdName: 'dance' }),
}));
vi.mock('../../core/config', () => ({
    envState: { qualityProfile: 'high' },
}));
vi.mock('../../core/gpu-capabilities', () => ({
    detectKtx2Support: () => ({ supported: true }),
}));

import {
    updateMmarStatus,
    refreshSceneSnapshot,
    startSceneSnapshotPolling,
    stopSceneSnapshotPolling,
} from '../mmar-globals';
// [doc:adr-238] focusedModel 改经 scene-action-bridge（model-ops 注册），测试补注册 mock
import { registerSceneAction } from '../scene-action-bridge';
import { focusedModel as mockFocusedModel } from '../../scene/manager/model-ops';

describe('mmar-globals', () => {
    beforeEach(() => {
        // 复位 status 到已知态；scene 由 refreshSceneSnapshot 用例自行填充
        stopSceneSnapshotPolling();
        updateMmarStatus('idle', '');
        // 桥注册（model-ops/motion-intent 被 mock，其尾部注册不执行，手动补齐）
        registerSceneAction('focusedModel', () => mockFocusedModel());
        registerSceneAction('getActiveMotion', () => ({ vmdName: 'dance' }));
    });

    it('模块加载后 window.__mmar 已就绪（F2 自动初始化）', () => {
        // mmar-globals 顶层 ensureMmar() 已执行，window.__mmar 始终非 null
        expect(window.__mmar).toBeDefined();
        expect(window.__mmar!.status.phase).toBe('idle');
        expect(window.__mmar!.status.updatedAt).toBeGreaterThan(0);
    });

    it('updateMmarStatus 写入 phase/text/detail/updatedAt', () => {
        updateMmarStatus('scanning', 'loading...', 'detail-x');
        const s = window.__mmar!.status;
        expect(s.phase).toBe('scanning');
        expect(s.text).toBe('loading...');
        expect(s.detail).toBe('detail-x');
        expect(s.updatedAt).toBeGreaterThan(0);
    });

    it('updateMmarStatus 空 text 归一为空串', () => {
        updateMmarStatus('error', '');
        expect(window.__mmar!.status.text).toBe('');
    });

    it('refreshSceneSnapshot 填充真实场景快照（F1/F5/F6）', async () => {
        await refreshSceneSnapshot();
        const s = window.__mmar!.scene;
        expect(s.fps).toBe(60);
        expect(s.meshCount).toBe(3);
        expect(s.modelCount).toBe(2); // 真实加载数，而非 0/1
        expect(s.activeModel).toBe('A');
        expect(s.activeMotion).toBe('dance');
        expect(s.ktxSupported).toBe(true);
        expect(s.qualityTier).toBe('high'); // 去 as any 后正确读取
    });

    it('refreshSceneSnapshot WebGPU 下 _gl 缺失不抛错', async () => {
        // engine._gl 为 undefined 时 gpu 保持空串，整体不抛
        await expect(refreshSceneSnapshot()).resolves.toBeUndefined();
        expect(window.__mmar!.scene.gpu).toBe('');
    });

    it('startSceneSnapshotPolling 幂等，stop 可重复调用（F7）', async () => {
        startSceneSnapshotPolling(50);
        startSceneSnapshotPolling(50); // 不应注册第二个 timer
        stopSceneSnapshotPolling();
        stopSceneSnapshotPolling(); // 幂等 stop
        expect(window.__mmar).toBeDefined();
    });
});
