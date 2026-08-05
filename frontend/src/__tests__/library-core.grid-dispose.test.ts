// @ts-nocheck — vi.mock 运行时替换（与 library-core-mocks 同构）
// library-core.grid-dispose.test.ts
// [fix:p3-leak] grid 模式 renderCustom dispose 链回归测试：
// renderGridMode 经 cardContainer 返回 `() => safeDispose(panel)`，menu.ts _customDispose
// 在 buildPanel 重建/dispose 时调用它，释放 createResourcePanel 的 observer/virtualGrid
// 并从 _activePanels 注销。若未来重构丢掉 return（renderGridMode / renderCustom / 透传层
// 任一断链），每次重建即泄漏一个 panel（观察器持续触发 + 内存增长），本测试拦截。
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
    makeModel,
} from './library-core-mocks';

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    thumbnailCache: new Map<string, any>(),
    recentModels: [] as string[],
    focusedModelId: null as string | null,
}));
const capturedSlideRows = vi.hoisted(() => [] as any[]);
// createResourcePanel 返回的可追踪 handle：dispose 必须经 safeDispose 被调用
const panelHandle = vi.hoisted(() => ({
    updateItems: vi.fn(),
    setLayout: vi.fn(),
    refreshThumbs: vi.fn(),
    dispose: vi.fn(),
}));

vi.mock('../scene/scene', () => sceneFactory());
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../library/library-path', () => libraryPathFactory(mockState));
vi.mock('../core/ui-helpers', () => ({
    ...uiHelpersFactory(capturedSlideRows),
    createResourcePanel: vi.fn(() => panelHandle),
    openFullscreen: vi.fn(),
    closeFullscreen: vi.fn(),
}));
// config：与 configModuleFactory(mockState) 同构，但 cardContainer 必须透传 fn 返回值
// （对齐真实 ui-card.ts 行为）——否则 renderGridMode 的 dispose 链在测试中丢失。
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
    get thumbnailCache() {
        return mockState.thumbnailCache;
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
    cardContainer: (container: HTMLElement, fn: (c: HTMLElement) => (() => void) | void) => {
        container.classList.remove('render-card');
        const card = document.createElement('div');
        card.className = 'lcard';
        const dispose = fn(card);
        container.appendChild(card);
        return dispose;
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

import { buildLevel, setResourceViewMode } from '../menus/library-core';
import { createResourcePanel } from '../core/ui-helpers';

describe('grid 模式 renderCustom dispose 链（a4c61729 修复保护）', () => {
    let container: HTMLElement;

    beforeEach(() => {
        mockState.allModels = [];
        mockState.libraryRoot = '/test/root';
        mockState.librarySortMode = 'default';
        mockState.modelMetaCache = new Map();
        capturedSlideRows.length = 0;
        panelHandle.dispose.mockClear();
        (createResourcePanel as any).mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        setResourceViewMode('grid');
    });

    it('grid 模式 renderCustom 返回 dispose 函数', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
        ];
        const level = buildLevel('/test/root/models', 'Grid');
        const dispose = level.renderCustom!(container);
        expect(dispose).toBeTypeOf('function');
        expect(createResourcePanel).toHaveBeenCalledTimes(1);
    });

    it('调用 renderCustom 返回的 dispose 会释放 panel（safeDispose → handle.dispose）', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
        ];
        const level = buildLevel('/test/root/models', 'Grid');
        const dispose = level.renderCustom!(container);
        dispose!();
        expect(panelHandle.dispose).toHaveBeenCalledTimes(1);
    });

    it('重建渲染时每轮都拿到新的 dispose（无一次性泄漏）', () => {
        mockState.allModels = [
            makeModel({ file_path: '/test/root/models/a.pmx', dir: '/test/root/models' }),
        ];
        const level = buildLevel('/test/root/models', 'Grid');
        const d1 = level.renderCustom!(container);
        const d2 = level.renderCustom!(container);
        expect(d1).toBeTypeOf('function');
        expect(d2).toBeTypeOf('function');
        d1!();
        d2!();
        expect(panelHandle.dispose).toHaveBeenCalledTimes(2);
    });
});
