// @ts-nocheck — vi.mock 运行时替换（与 library-core-mocks 同构）
// library-core.model-meta-concurrency.test.ts
// [fix:p4-concurrency] ensureModelMeta 跨路径并发合并回归测试：
// 两个不相交路径集并发调用时，后完成者必须基于最新 modelMetaCache 增量合并后
// 整体回写——旧实现「函数开头快照一次 + 循环内整体 set」会让后完成者用旧快照
// 覆盖对方已写缓存（LoadingGuard 只拦同 key，不拦跨路径并发）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    sceneFactory,
    wailsBindingsFactory,
    loadManagerFactory,
    modelDetailFactory,
    sceneMenuFactory,
    menuFactory,
    iconsFactory,
    statusBarFactory,
    libraryPathFactory,
    uiHelpersFactory,
    createMockState,
    makeModel,
} from './library-core-mocks';

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    recentModels: [] as string[],
    focusedModelId: null as string | null,
}));
const capturedSlideRows = vi.hoisted(() => [] as any[]);

vi.mock('../scene/scene', () => sceneFactory());
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../core/ui-helpers', () => uiHelpersFactory(capturedSlideRows));
vi.mock('../library/library-path', () => libraryPathFactory(mockState));
// config：与 configModuleFactory(mockState) 同构，但 setModelMetaCache 必须真正写回
// mockState.modelMetaCache——否则并发合并的中间写入无法被后续调用观察到，测试失真。
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
    // Setters
    setStatus: vi.fn(),
    setLibraryRoot: vi.fn(),
    setResourceRoot: vi.fn(),
    setAllModels: vi.fn(),
    setDisplayNamePriority: vi.fn(),
    setOverridePaths: vi.fn(),
    setThumbnailCache: vi.fn(),
    setModelMetaCache: (m: Map<string, unknown>) => {
        mockState.modelMetaCache = m;
    },
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

import { buildLevel } from '../menus/library-core';
import { GetModelMetaBatch } from '../core/wails-bindings';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('ensureModelMeta 跨路径并发合并（a4c61729 修复保护）', () => {
    let container: HTMLElement;

    beforeEach(() => {
        mockState.allModels = [];
        mockState.libraryRoot = '/test/root';
        mockState.librarySortMode = 'default';
        mockState.modelMetaCache = new Map();
        capturedSlideRows.length = 0;
        (GetModelMetaBatch as any).mockReset();
        container = document.createElement('div');
    });

    it('两个不相交路径并发，后完成者不覆盖先完成者已写入的缓存', async () => {
        const aPath = '/test/root/models/a1.pmx';
        const bPath = '/test/root/models/b1.pmx';
        mockState.allModels = [
            makeModel({ file_path: aPath, dir: '/test/root/models' }),
            makeModel({ file_path: bPath, dir: '/test/root/models' }),
        ];

        // 手动控制两个并发批次 resolve（按调用顺序入队）
        const resolvers: ((v: unknown) => void)[] = [];
        (GetModelMetaBatch as any).mockImplementation((chunk: string[]) => {
            const path = chunk[0];
            return new Promise((resolve) => {
                resolvers.push(() => resolve({ [path]: { comment: `meta-${path}` } }));
            });
        });

        // 两次 renderCustom 各触发一路不相交路径的 ensureModelMeta（fire-and-forget）
        const filterA = (m: { file_path: string }) => m.file_path === aPath;
        const filterB = (m: { file_path: string }) => m.file_path === bPath;
        buildLevel('/test/root/models', 'A', filterA).renderCustom!(container);
        buildLevel('/test/root/models', 'B', filterB).renderCustom!(container);
        expect(resolvers).toHaveLength(2);

        // 第一批（A）先完成并写入缓存
        resolvers[0]!(undefined);
        await flushMicrotasks();
        expect(mockState.modelMetaCache.has(aPath)).toBe(true);

        // 第二批（B）后完成：新实现基于最新缓存增量合并，A 不被覆盖
        resolvers[1]!(undefined);
        await flushMicrotasks();
        expect(mockState.modelMetaCache.has(bPath)).toBe(true);
        expect(mockState.modelMetaCache.has(aPath)).toBe(true); // ← 防覆盖回归核心断言
    });

    it('同路径重复触发被 LoadingGuard 去重（单路径内不重复拉取）', async () => {
        const aPath = '/test/root/models/a1.pmx';
        mockState.allModels = [
            makeModel({ file_path: aPath, dir: '/test/root/models' }),
        ];
        const calls: string[][] = [];
        (GetModelMetaBatch as any).mockImplementation((chunk: string[]) => {
            calls.push(chunk);
            return Promise.resolve({ [chunk[0]]: { comment: 'meta' } });
        });

        buildLevel('/test/root/models', 'A').renderCustom!(container);
        await flushMicrotasks();
        expect(mockState.modelMetaCache.has(aPath)).toBe(true);
        // 缓存已存在，再次触发不应重复拉取
        buildLevel('/test/root/models', 'A').renderCustom!(container);
        await flushMicrotasks();
        expect(calls.length).toBe(1);
    });
});
