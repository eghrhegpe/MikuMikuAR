// @vitest-environment node
// load-manager.test.ts — [doc:adr-135] P0.2: LoadManager 串行队列 / abort 短路 / 错误包装单测
// 背景：此前所有测试均 mock loadManager 单例，核心逻辑零直接覆盖（ADR-204 违规）。
// 本文件直接测 LoadManager 实例：串行排队顺序、signal.aborted 短路抛 AbortError、
// 错误包装为 LibraryLoadError（含 loadId/phase）、getCurrentLoad 结构化快照。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 底层 loader（dispatch 内 dynamic import 的模块）
const __mocks = vi.hoisted(() => {
    const loadPMXFile = vi.fn();
    const loadVMDFromPath = vi.fn();
    const loadCameraVmdFromPath = vi.fn();
    const loadAudioFile = vi.fn();
    return { loadPMXFile, loadVMDFromPath, loadCameraVmdFromPath, loadAudioFile };
});

vi.mock('../scene/manager/model-loader', () => ({
    loadPMXFile: __mocks.loadPMXFile,
}));
vi.mock('../scene/motion/vmd-loader', () => ({
    loadVMDFromPath: __mocks.loadVMDFromPath,
    loadCameraVmdFromPath: __mocks.loadCameraVmdFromPath,
}));
vi.mock('../core/audio', () => ({
    loadAudioFile: __mocks.loadAudioFile,
}));
vi.mock('../core/config', () => ({
    modelRegistry: new Map<string, { name: string }>([['m1', { name: '测试模型' }]]),
}));
vi.mock('../core/load-refresh-registry', () => ({
    runLoadRefreshHooks: vi.fn(),
}));

import { loadManager, LibraryLoadError } from '../core/load-manager';

beforeEach(() => {
    // 重置单例内部状态（loadManager 是模块级单例，测试间须隔离）
    // 通过完成态清空 _current/_loadId/_phase（finally 已保证），无需额外 API
    Object.keys(__mocks).forEach((k) => (__mocks as any)[k].mockReset());
});

describe('LoadManager 串行队列', () => {
    it('actor 加载成功返回 handle（含 registry 名称）', async () => {
        __mocks.loadPMXFile.mockResolvedValue('m1');
        const handle = await loadManager.load({ kind: 'actor', path: '/a.pmx' });
        expect(handle).toEqual({ id: 'm1', kind: 'actor', name: '测试模型', filePath: '/a.pmx' });
    });

    it('多个请求串行排队（不并发）', async () => {
        const order: string[] = [];
        __mocks.loadPMXFile.mockImplementation(async (path: string) => {
            order.push(path);
            await new Promise((r) => setTimeout(r, 5)); // 模拟异步耗时
            return 'm1';
        });
        const p1 = loadManager.load({ kind: 'actor', path: '/a.pmx' });
        const p2 = loadManager.load({ kind: 'actor', path: '/b.pmx' });
        await Promise.all([p1, p2]);
        // 串行：先 a 后 b，loadPMXFile 不应并发调用同一个底层
        expect(order).toEqual(['/a.pmx', '/b.pmx']);
    });
});

describe('abort 短路', () => {
    it('排队期间 signal 已 abort → 抛 AbortError 且不启动底层 loader', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(
            loadManager.load({ kind: 'actor', path: '/a.pmx' }, ctrl.signal)
        ).rejects.toSatisfy((e: unknown) => e instanceof DOMException && e.name === 'AbortError');
        expect(__mocks.loadPMXFile).not.toHaveBeenCalled();
    });
});

describe('错误包装', () => {
    it('底层 loader 抛错 → 包装为 LibraryLoadError（含 loadId/phase）', async () => {
        __mocks.loadPMXFile.mockRejectedValue(new Error('boom'));
        await expect(
            loadManager.load({ kind: 'actor', path: '/a.pmx' })
        ).rejects.toSatisfy((e: unknown) => {
            const err = e as LibraryLoadError;
            return err.name === 'LibraryLoadError' && err.phase === 'parse' && !!err.loadId;
        });
    });

    it('成功加载后 finally 清空当前加载（getCurrentLoad 返回 null）', async () => {
        __mocks.loadPMXFile.mockResolvedValue('m1');
        await loadManager.load({ kind: 'actor', path: '/a.pmx' });
        expect(loadManager.getCurrentLoad()).toBeNull();
        expect(loadManager.current).toBeNull();
    });
});