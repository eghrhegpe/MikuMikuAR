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

    it('LibraryLoadError 透传原始 req（loadId/phase/cause/req 完整快照）', async () => {
        __mocks.loadPMXFile.mockRejectedValue(new Error('boom'));
        await expect(
            loadManager.load({ kind: 'actor', path: '/a.pmx' })
        ).rejects.toSatisfy((e: unknown) => {
            const err = e as LibraryLoadError;
            return (
                err.name === 'LibraryLoadError' &&
                err.req.kind === 'actor' &&
                err.req.path === '/a.pmx' &&
                (err.cause as Error).message === 'boom' &&
                typeof err.message === 'string' &&
                err.message.length > 0
            );
        });
    });

    it('成功加载后 finally 清空当前加载（getCurrentLoad 返回 null）', async () => {
        __mocks.loadPMXFile.mockResolvedValue('m1');
        await loadManager.load({ kind: 'actor', path: '/a.pmx' });
        expect(loadManager.getCurrentLoad()).toBeNull();
        expect(loadManager.current).toBeNull();
    });
});

describe('kind 分支覆盖', () => {
    it('stage 加载透传 asStage=true 及 skipAutoApply/libraryPath/innerPath', async () => {
        __mocks.loadPMXFile.mockResolvedValue('m1');
        const handle = await loadManager.load({
            kind: 'stage',
            path: '/s.pmx',
            skipAutoApply: true,
            libraryPath: '/lib.zip',
            innerPath: 's.pmx',
        });
        expect(handle).toEqual({ id: 'm1', kind: 'stage', name: '测试模型', filePath: '/s.pmx' });
        expect(__mocks.loadPMXFile).toHaveBeenCalledWith(
            '/s.pmx', true, true, '/lib.zip', 's.pmx', undefined
        );
    });

    it('vmd 加载成功返回 handle 且透传 modelId/signal/skipSceneIntent', async () => {
        __mocks.loadVMDFromPath.mockResolvedValue(undefined);
        const ctrl = new AbortController();
        const handle = await loadManager.load(
            { kind: 'vmd', path: '/dance.vmd', modelId: 'm1', skipSceneIntent: true },
            ctrl.signal
        );
        expect(handle).toEqual({ id: '', kind: 'vmd', name: 'dance', filePath: '/dance.vmd' });
        expect(__mocks.loadVMDFromPath).toHaveBeenCalledWith('/dance.vmd', 'm1', ctrl.signal, true);
    });

    it('camera-vmd 加载成功返回 handle 且透传 signal', async () => {
        __mocks.loadCameraVmdFromPath.mockResolvedValue(undefined);
        const ctrl = new AbortController();
        const handle = await loadManager.load({ kind: 'camera-vmd', path: '/cam.vmd' }, ctrl.signal);
        expect(handle).toEqual({ id: '', kind: 'camera-vmd', name: 'cam', filePath: '/cam.vmd' });
        expect(__mocks.loadCameraVmdFromPath).toHaveBeenCalledWith('/cam.vmd', ctrl.signal);
    });

    it('audio 加载成功返回 handle 且扩展名去除不区分大小写（.MP3）', async () => {
        __mocks.loadAudioFile.mockResolvedValue(undefined);
        const ctrl = new AbortController();
        const handle = await loadManager.load({ kind: 'audio', path: '/bgm.MP3' }, ctrl.signal);
        expect(handle).toEqual({ id: '', kind: 'audio', name: 'bgm', filePath: '/bgm.MP3' });
        expect(__mocks.loadAudioFile).toHaveBeenCalledWith('/bgm.MP3', ctrl.signal);
    });
});

describe('边界与兜底', () => {
    it('未实现 kind（light/personalLight/mirror）→ resolve null 不抛错', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            for (const kind of ['light', 'personalLight', 'mirror'] as const) {
                const handle = await loadManager.load({ kind, path: '/x' });
                expect(handle).toBeNull();
            }
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('底层 loader 返回 falsy → load 返回 null（不包装错误）', async () => {
        __mocks.loadPMXFile.mockResolvedValue(null);
        const handle = await loadManager.load({ kind: 'actor', path: '/a.pmx' });
        expect(handle).toBeNull();
        expect(loadManager.getCurrentLoad()).toBeNull();
    });

    it('registry 查无实例 → handle.name 为空串（时序异常兜底）', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            __mocks.loadPMXFile.mockResolvedValue('ghost-id');
            const handle = await loadManager.load({ kind: 'actor', path: '/a.pmx' });
            expect(handle).toEqual({ id: 'ghost-id', kind: 'actor', name: '', filePath: '/a.pmx' });
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('前一个任务失败不阻塞后一个任务（队列 cleanup 后仍可入队）', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            __mocks.loadPMXFile.mockRejectedValueOnce(new Error('first boom'));
            __mocks.loadPMXFile.mockResolvedValueOnce('m1');
            const p1 = loadManager.load({ kind: 'actor', path: '/a.pmx' });
            const p2 = loadManager.load({ kind: 'actor', path: '/b.pmx' });
            await expect(p1).rejects.toSatisfy(
                (e: unknown) => (e as LibraryLoadError).name === 'LibraryLoadError'
            );
            const handle = await p2;
            expect(handle).toEqual({ id: 'm1', kind: 'actor', name: '测试模型', filePath: '/b.pmx' });
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('加载中 getCurrentLoad() 返回结构化快照（phase=parse + loadId + req），完成后清空', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        __mocks.loadPMXFile.mockImplementation(() => gate.then(() => 'm1'));
        const p = loadManager.load({ kind: 'actor', path: '/slow.pmx' });
        try {
            // 等待 dispatch 进入 loadPMXFile（微任务链：queue.then → dispatch → await import → loader）
            await vi.waitFor(() => {
                expect(loadManager.getCurrentLoad()).not.toBeNull();
            });
            const snap = loadManager.getCurrentLoad()!;
            expect(snap.phase).toBe('parse');
            expect(snap.loadId).toMatch(/^l_[0-9a-z]+_[0-9a-z]{4}$/);
            expect(snap.req).toEqual({ kind: 'actor', path: '/slow.pmx' });
            expect(loadManager.current).toEqual({ kind: 'actor', path: '/slow.pmx' });
        } finally {
            release();
            await p;
        }
        expect(loadManager.getCurrentLoad()).toBeNull();
        expect(loadManager.current).toBeNull();
    });

    it('排队期间 abort 短路后不残留 current 状态', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const ctrl = new AbortController();
            ctrl.abort();
            await expect(
                loadManager.load({ kind: 'actor', path: '/a.pmx' }, ctrl.signal)
            ).rejects.toSatisfy((e: unknown) => e instanceof DOMException && e.name === 'AbortError');
        } finally {
            warnSpy.mockRestore();
        }
        expect(loadManager.getCurrentLoad()).toBeNull();
        expect(loadManager.current).toBeNull();
    });
});