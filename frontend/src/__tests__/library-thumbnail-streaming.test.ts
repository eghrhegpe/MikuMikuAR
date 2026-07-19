import { describe, it, expect, vi, beforeEach } from 'vitest';

// [adr-136] 缩略图流式加载 AbortSignal 协作式取消的确定性测试。
// 复用 library-core.test.ts 的 mock 结构，聚焦 loadThumbnailsStreaming / abortThumbnailStreaming。

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    recentModels: [] as string[],
    focusedModelId: null as string | null,
    // 缩略图缓存：真实 Map，测试间重置
    thumbnailCache: new Map<string, string>(),
}));

vi.mock('../scene/scene', () => ({
    loadPMXFile: vi.fn(),
    loadVMDFromPath: vi.fn(),
    removeModel: vi.fn(),
    loadAudioFile: vi.fn(),
    loadVPDPose: vi.fn(),
}));

vi.mock('../core/wails-bindings', () => ({
    GetConfig: vi.fn(),
    SetResourceRoot: vi.fn(),
    SetOverridePath: vi.fn(),
    SelectDir: vi.fn(),
    SelectImportFile: vi.fn(),
    ImportZip: vi.fn(),
    ScanModelDir: vi.fn(),
    GetLibraryIndex: vi.fn(),
    ExtractZip: vi.fn(),
    CleanOrphanCache: vi.fn(),
    ClearExtractCache: vi.fn(),
    GetThumbnailBatch: vi.fn(),
    GetModelMetaBatch: vi.fn(),
    GetRecentModels: vi.fn(),
    AddRecentModel: vi.fn(),
    GetAllTags: vi.fn(),
    GetModelsByTag: vi.fn(),
    SelectAudioFile: vi.fn(),
    SelectVMDMotion: vi.fn(),
    SelectVPDPose: vi.fn(),
    SetUIState: vi.fn().mockResolvedValue(undefined),
    // [adr-136] 被测函数依赖的缩略图拉取 binding（Wails binding，无法真中止）
    GetThumbnail: vi.fn(),
}));

vi.mock('../core/load-manager', () => ({
    loadManager: { load: vi.fn() },
}));

vi.mock('./model-detail', () => ({ buildModelLevel: vi.fn() }));
vi.mock('../menus/scene-menu', () => ({ buildStageTransformLevel: vi.fn() }));
vi.mock('./menu', () => ({ SlideMenu: vi.fn() }));
vi.mock('../core/icons', () => ({ createIconifyIcon: vi.fn(() => null) }));
vi.mock('../core/ui-helpers', () => ({
    slideRow: vi.fn(() => {}),
}));

// [adr-136] notifyThumbnailUpdate 由 ui-resource-panel 提供，需 mock 以断言调用
vi.mock('../core/ui-resource-panel', () => ({
    notifyThumbnailUpdate: vi.fn(),
}));

vi.mock('../core/config', () => ({
    getBaseName: vi.fn((p: string) => p.split('/').pop() || p),
    get allModels() {
        return mockState.allModels;
    },
    get libraryRoot() {
        return mockState.libraryRoot;
    },
    get displayNamePriority() {
        return mockState.displayNamePriority;
    },
    get librarySortMode() {
        return mockState.librarySortMode;
    },
    get modelMetaCache() {
        return mockState.modelMetaCache;
    },
    get recentModels() {
        return mockState.recentModels;
    },
    get focusedModelId() {
        return mockState.focusedModelId;
    },
    // [adr-136] 缩略图缓存：真实 Map，供 .has/.set 读写
    get thumbnailCache() {
        return mockState.thumbnailCache;
    },

    normPath: (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, ''),
    getBrowseDir: (category: string) => {
        if (category === 'prop') {
            return '/test/root/props';
        }
        if (category === 'stage') {
            return '/test/root/stages';
        }
        return '/test/root/models';
    },
    cardContainer: (container: HTMLElement, fn: (c: HTMLElement) => void) => {
        const card = document.createElement('div');
        fn(card);
        container.appendChild(card);
    },
    formatError: (e: any) => String(e),
    computeLibraryRef: (fp: string) => fp,
    dom: {
        sceneOverlay: {
            classList: { contains: () => false, add: vi.fn(), remove: vi.fn() },
            dataset: {} as Record<string, string>,
        },
    },
    getMenuWrapper: () => document.createElement('div'),
    stackRegistry: { modelStack: null, sceneStackGetter: null, buildLevel: null },
    uiState: {} as Record<string, unknown>,

    setStatus: vi.fn(),
    setLibraryRoot: vi.fn(),
    setResourceRoot: vi.fn(),
    setAllModels: vi.fn(),
    setDisplayNamePriority: vi.fn(),
    setOverridePaths: vi.fn(),
    setThumbnailCache: vi.fn(),
    setModelMetaCache: vi.fn(),
    setRecentModels: vi.fn(),
    setFocusedModelId: vi.fn(),
    closeAllOverlays: vi.fn(),
    modelRegistry: new Map(),
    LoadingGuard: class {
        tryEnter() {
            return true;
        }
        leave() {}
        isLoading() {
            return false;
        }
        clear() {}
    },
}));

import { loadThumbnailsStreaming, abortThumbnailStreaming } from '../menus/library-core';
import { notifyThumbnailUpdate } from '../core/ui-resource-panel';
import { GetThumbnail } from '../core/wails-bindings';
import type { CancellablePromise } from '@wailsio/runtime';

const getThumb = vi.mocked(GetThumbnail);
const notify = vi.mocked(notifyThumbnailUpdate);

// GetThumbnail 真实返回 CancellablePromise<string>（Promise + cancel/cancelOn）。
// mock 用此 helper 包裹，类型与绑定一致（cancel/cancelOn 在本测试中不被 SUT 调用，给 stub）。
function cancellable<T>(p: Promise<T>): CancellablePromise<T> {
    return Object.assign(p, {
        cancel: () => undefined,
        cancelOn: () => p,
    }) as unknown as CancellablePromise<T>;
}

beforeEach(() => {
    mockState.thumbnailCache.clear();
    getThumb.mockReset();
    notify.mockReset();
});

describe('loadThumbnailsStreaming — AbortSignal (adr-136)', () => {
    it('空 keys 立即返回，不调用 GetThumbnail', async () => {
        await loadThumbnailsStreaming([]);
        expect(getThumb).not.toHaveBeenCalled();
    });

    it('已 abort 的 signal：协作式停止，0 次 GetThumbnail 且不写缓存', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        await loadThumbnailsStreaming(['k1', 'k2', 'k3'], ctrl.signal);
        expect(getThumb).not.toHaveBeenCalled();
        expect(mockState.thumbnailCache.size).toBe(0);
    });

    it('无 signal（向后兼容）：每个未缓存 key 各拉取一次并写缓存 + 通知', async () => {
        const keys = ['a', 'b', 'c'];
        getThumb.mockImplementation((k: string) => cancellable(Promise.resolve(`data-${k}`)));
        await loadThumbnailsStreaming(keys);
        expect(getThumb).toHaveBeenCalledTimes(3);
        expect(mockState.thumbnailCache.get('a')).toBe('data-a');
        expect(mockState.thumbnailCache.get('c')).toBe('data-c');
        expect(notify).toHaveBeenCalled();
    });

    it('中途 abort：丢弃已拉取但未写入的过期结果，正常 settle 不抛', async () => {
        const ctrl = new AbortController();
        const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
        // 第一次拉取即触发 abort，模拟「用户已切走」
        getThumb.mockImplementation((k: string) => {
            ctrl.abort();
            return cancellable(Promise.resolve(`data-${k}`));
        });
        await expect(loadThumbnailsStreaming(keys, ctrl.signal)).resolves.toBeUndefined();
        // 过期结果被丢弃：并非所有 key 都入缓存
        expect(mockState.thumbnailCache.size).toBeLessThan(keys.length);
        expect(getThumb).toHaveBeenCalled();
    });

    it('abortThumbnailStreaming：取消在飞批次，结果被丢弃且 promise 不挂起', async () => {
        const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        // 慢 binding：setTimeout(0) 后才 resolve，给 abort 留出同步窗口
        getThumb.mockImplementation(
            (k: string) =>
                cancellable(new Promise<string>((r) => setTimeout(() => r(`data-${k}`), 0)))
        );
        const promise = loadThumbnailsStreaming(keys);
        abortThumbnailStreaming(); // 同步取消当前批次
        await expect(promise).resolves.toBeUndefined();
        expect(mockState.thumbnailCache.size).toBeLessThan(keys.length);
    });
});
