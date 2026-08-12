import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { stateMockSuperset } from './mocks/state-superset';

// ── hoisted mocks ──

interface MockStageInst {
    kind: string;
    name: string;
    visible?: boolean;
    meshes?: unknown[];
}

const mockEnvState = vi.hoisted(() => ({ groundVisibleEnabled: true, waterEnabled: false }));
const mockSetEnvState = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockPop = vi.hoisted(() => vi.fn());
const mockReRender = vi.hoisted(() => vi.fn());
const mockModelRegistry = vi.hoisted(() => new Map<string, MockStageInst>());
const mockPushUndoSnapshot = vi.hoisted(() => vi.fn());
const mockOfferSceneUndo = vi.hoisted(() => vi.fn());
const mockRemoveModel = vi.hoisted(() => vi.fn());
const mockSetModelVisibility = vi.hoisted(() => vi.fn());
const mockFeedbackStatus = vi.hoisted(() => vi.fn());
const mockFeedbackInfo = vi.hoisted(() => vi.fn());
const mockGetBrowseDir = vi.hoisted(() => vi.fn());
const mockBuildLevel = vi.hoisted(() => vi.fn());
const mockBuildTransformCard = vi.hoisted(() => vi.fn());
const mockBuildMaterialCard = vi.hoisted(() => vi.fn());
const mockBuildDangerCard = vi.hoisted(() => vi.fn());
const _mockCreateIconifyIcon = vi.hoisted(() =>
    vi.fn(() => {
        const el = document.createElement('span');
        el.className = 'mock-icon';
        return el;
    })
);

vi.mock('../core/config', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...(actual as object),
        setStatus: vi.fn(),
        cardContainer: (container: HTMLElement, fn: (c: HTMLElement) => void) => {
            const card = document.createElement('div');
            card.className = 'lcard';
            fn(card);
            container.appendChild(card);
        },
        modelRegistry: mockModelRegistry,
        overridePaths: {},
        libraryRoot: '',
        escapeHtml: (s: string) => s,
    };
});

vi.mock('../core/icons', () => ({
    createIconifyIcon: () => {
        const el = document.createElement('span');
        el.className = 'mock-icon';
        return el;
    },
}));

vi.mock('../core/state', () => stateMockSuperset({ envState: mockEnvState }));

vi.mock('../scene/env/_bridge/env-bridge', () => ({
    setEnvState: (...args: unknown[]) => mockSetEnvState(...args),
}));

vi.mock('../scene/env/env', () => ({
    isMirrorActive: vi.fn(() => false),
    setMirrorSize: vi.fn(),
    setMirrorResolution: vi.fn(),
    getMirrorInfo: vi.fn(() => ({
        active: false,
        width: 6,
        height: 1,
        resolution: 512,
        meshCount: 0,
        position: [0, 0, 0],
    })),
}));

// scene-stage-levels.ts → ./scene-menu-state（scene-menu-state.ts 默认返回 null，无需显式 mock）
// 保留 scene-menu mock 防止 importActual 链意外加载真实 scene-menu 模块触发 side-effect
vi.mock('./scene-menu', () => ({
    reRenderSceneMenu: vi.fn(),
    getSceneMenu: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('./env-ground-levels', () => ({ buildGroundLevel: vi.fn(() => ({ label: 'ground' })) }));
vi.mock('./env-water-levels', () => ({ buildWaterLevel: vi.fn(() => ({ label: 'water' })) }));

// 阻断 Babylon.js Scene 初始化（scene/scene.ts 模块级 new Scene()）
// 补齐源码依赖的 undo 快照 API（scene-stage-levels / resource-detail-helpers 均 import）
vi.mock('../scene/scene', () => ({
    modelManager: { modelRegistry: new Map(), size: 0, focused: vi.fn(), get: vi.fn() },
    setEnvState: (...args: unknown[]) => mockSetEnvState(...args),
    pushUndoSnapshot: (...args: unknown[]) => mockPushUndoSnapshot(...args),
    offerSceneUndo: (...args: unknown[]) => mockOfferSceneUndo(...args),
}));

// 列表卸载/可见性操作走 model-ops，直接 mock 掉以避免真实模块依赖 Babylon/camera 环境
vi.mock('../scene/manager/model-ops', () => ({
    removeModel: (...args: unknown[]) => mockRemoveModel(...args),
    setModelVisibility: (...args: unknown[]) => mockSetModelVisibility(...args),
}));

vi.mock('../core/feedback', () => ({
    feedbackStatus: (...args: unknown[]) => mockFeedbackStatus(...args),
    feedbackInfo: (...args: unknown[]) => mockFeedbackInfo(...args),
}));

// load stage 按钮动态 import 的两个模块
vi.mock('@/core/library-path', () => ({
    getBrowseDir: (...args: unknown[]) => mockGetBrowseDir(...args),
}));
vi.mock('../menus/library-core', () => ({
    buildLevel: (...args: unknown[]) => mockBuildLevel(...args),
}));

// buildStageTransformLevel 的三个区块构建器（各自有独立测试，此处聚焦接线逻辑）
vi.mock('../menus/resource-detail-helpers', () => ({
    buildTransformCard: (...args: unknown[]) => mockBuildTransformCard(...args),
    buildMaterialCard: (...args: unknown[]) => mockBuildMaterialCard(...args),
    buildDangerCard: (...args: unknown[]) => mockBuildDangerCard(...args),
}));

import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';

// [doc:perf] 语言包改为运行时加载，测试环境直接预填缓存
beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

// ── SUT ──

import { buildStageLevel, buildStageTransformLevel } from '../menus/scene-stage-levels';
import { setSceneMenu, getSceneMenu } from '../menus/scene-menu-state';

// ── helpers ──

type FakeSlideMenu = NonNullable<ReturnType<typeof getSceneMenu>>;

function makeFakeMenu(): FakeSlideMenu {
    return { push: mockPush, pop: mockPop, reRender: mockReRender } as unknown as FakeSlideMenu;
}

function renderLevel(level: ReturnType<typeof buildStageLevel>): HTMLElement {
    const container = document.createElement('div');
    if (level.renderCustom) {
        level.renderCustom(container);
    }
    return container;
}

function _findToggleRow(
    container: HTMLElement,
    label: string
): {
    row: HTMLElement | null;
    checkbox: HTMLInputElement | null;
    arrow: HTMLElement | null;
    toggleLabel: HTMLElement | null;
} {
    // 新 UI 使用 slideRow + headerToggle → .collapsible-header 结构
    const headers = Array.from(container.querySelectorAll('.collapsible-header'));
    for (const item of headers) {
        const labelEl = item.querySelector('.collapsible-label');
        if (labelEl?.textContent === label) {
            return {
                row: item as HTMLElement,
                checkbox: item.querySelector(
                    '.toggle input[type="checkbox"]'
                ) as HTMLInputElement | null,
                arrow: item.querySelector('.collapsible-arrow') as HTMLElement | null,
                toggleLabel: item.querySelector('.toggle.header-toggle') as HTMLElement | null,
            };
        }
    }
    // 兜底：旧版 .toggle-row 结构
    const items = Array.from(container.querySelectorAll('.toggle-row'));
    for (const item of items) {
        const labelEl = item.querySelector('.toggle-label');
        if (labelEl?.textContent === label) {
            return {
                row: item as HTMLElement,
                checkbox: item.querySelector(
                    '.toggle input[type="checkbox"]'
                ) as HTMLInputElement | null,
                arrow: null,
                toggleLabel: null,
            };
        }
    }
    return { row: null, checkbox: null, arrow: null, toggleLabel: null };
}

// ── tests ──

describe('Stage level', () => {
    beforeEach(() => {
        mockEnvState.groundVisibleEnabled = true;
        mockEnvState.waterEnabled = false;
        mockSetEnvState.mockReset();
        mockPush.mockReset();
        mockPop.mockReset();
        mockReRender.mockReset();
        mockModelRegistry.clear();
        mockPushUndoSnapshot.mockReset();
        mockPushUndoSnapshot.mockImplementation(() => 'snap-1');
        mockOfferSceneUndo.mockReset();
        mockRemoveModel.mockReset();
        mockSetModelVisibility.mockReset();
        mockFeedbackStatus.mockReset();
        mockFeedbackInfo.mockReset();
        mockGetBrowseDir.mockReset();
        mockBuildLevel.mockReset();
        mockBuildTransformCard.mockReset();
        mockBuildMaterialCard.mockReset();
        mockBuildDangerCard.mockReset();
    });

    afterEach(() => {
        setSceneMenu(null);
    });

    it('renders load stage button', () => {
        const level = buildStageLevel();
        expect(level.renderCustom).toBeDefined();
        const container = document.createElement('div');
        level.renderCustom!(container);
        expect(container.querySelectorAll('.slide-item').length).toBeGreaterThanOrEqual(1);
        const labels = Array.from(container.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        expect(labels).toContain('加载舞台');
    });

    it('shows empty state when no stages loaded', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        expect(container.textContent).toContain('暂无已加载舞台');
    });

    it('empty state shows load hint', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        expect(container.textContent).toContain('点击上方按钮加载舞台');
    });

    it('load stage button has testId for E2E', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const loadStage = container.querySelector('[data-testid="menu:scene:load-stage"]');
        expect(loadStage).not.toBeNull();
    });

    it('renders loaded stage list when stage models exist', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const labels = Array.from(container.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        expect(labels).toContain('主舞台');
        expect(container.textContent).not.toContain('暂无已加载舞台');
    });

    it('filters out non-stage models from loaded list', () => {
        mockModelRegistry.set('actor-1', { kind: 'actor', name: '初音未来' });
        const level = buildStageLevel();
        const container = renderLevel(level);
        expect(container.textContent).not.toContain('初音未来');
        expect(container.textContent).toContain('暂无已加载舞台');
    });

    it('stage row click opens transform level via menu push', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const menu = makeFakeMenu();
        setSceneMenu(menu);
        const level = buildStageLevel();
        const container = renderLevel(level);
        const row = Array.from(container.querySelectorAll('.slide-item')).find(
            (el) => el.textContent?.includes('主舞台')
        );
        expect(row).toBeDefined();
        row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(mockPush).toHaveBeenCalledTimes(1);
        const pushedLevel = mockPush.mock.calls[0][0] as ReturnType<typeof buildStageTransformLevel>;
        expect(pushedLevel.label).toContain('主舞台');
        expect(pushedLevel.renderCustom).toBeDefined();
    });

    it('visibility toggle button calls setModelVisibility and feedbackInfo', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector('.slide-lead-btn') as HTMLElement | null;
        expect(btn).not.toBeNull();
        expect(btn!.title).toBe('切换可见性');
        btn!.click();
        expect(mockSetModelVisibility).toHaveBeenCalledWith('stage-1', false);
        expect(mockFeedbackInfo).toHaveBeenCalledWith('scene.stageHidden', undefined);
    });

    it('unload button pushes undo snapshot, removes model and offers undo', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector('.slide-add-btn') as HTMLElement | null;
        expect(btn).not.toBeNull();
        expect(btn!.title).toBe('卸载此舞台');
        btn!.click();
        expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
        expect(mockRemoveModel).toHaveBeenCalledWith('stage-1');
        expect(mockOfferSceneUndo).toHaveBeenCalledTimes(1);
        const [msg, snap, onRestored] = mockOfferSceneUndo.mock.calls[0] as [
            string,
            string | null,
            () => void
        ];
        expect(msg).toBe('✓ 已卸载: 主舞台');
        expect(snap).toBe('snap-1');
        expect(typeof onRestored).toBe('function');
    });

    it('load stage button reports missing library dir', async () => {
        mockGetBrowseDir.mockReturnValue(null);
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector(
            '[data-testid="menu:scene:load-stage"]'
        ) as HTMLElement | null;
        expect(btn).not.toBeNull();
        btn!.click();
        await vi.waitFor(() => expect(mockFeedbackStatus).toHaveBeenCalled());
        expect(mockFeedbackStatus).toHaveBeenCalledWith('scene.statusNoModelLib', undefined, false);
        expect(mockBuildLevel).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('load stage button opens browse level on success', async () => {
        mockGetBrowseDir.mockReturnValue('/lib/stage');
        const browseLevel = { label: 'browse' };
        mockBuildLevel.mockReturnValue(browseLevel);
        const menu = makeFakeMenu();
        setSceneMenu(menu);
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector(
            '[data-testid="menu:scene:load-stage"]'
        ) as HTMLElement | null;
        btn!.click();
        await vi.waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
        expect(mockBuildLevel).toHaveBeenCalledTimes(1);
        const [dir, label, filter, sm] = mockBuildLevel.mock.calls[0] as [
            string,
            string,
            (m: unknown) => boolean,
            FakeSlideMenu
        ];
        expect(dir).toBe('/lib/stage');
        expect(label).toBe('加载舞台');
        expect(typeof filter).toBe('function');
        expect(sm).toBe(menu);
        expect(mockPush.mock.calls[0][0]).toBe(browseLevel);
    });

    it('load stage button catches browse errors', async () => {
        mockGetBrowseDir.mockReturnValue('/lib/stage');
        mockBuildLevel.mockImplementation(() => {
            throw new Error('boom');
        });
        // 源码在 getSceneMenu() 为 null 时早退（buildLevel 不会执行），需注入菜单走到错误分支
        setSceneMenu(makeFakeMenu());
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector(
            '[data-testid="menu:scene:load-stage"]'
        ) as HTMLElement | null;
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            btn!.click();
            await vi.waitFor(() =>
                expect(mockFeedbackStatus).toHaveBeenCalledWith(
                    'scene.statusOpenStageLibFailed',
                    undefined,
                    false
                )
            );
        } finally {
            errSpy.mockRestore();
        }
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('visibility toggle: hidden stage click sets visible true and reports shown', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: false });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector('.slide-lead-btn') as HTMLElement | null;
        expect(btn).not.toBeNull();
        btn!.click();
        expect(mockSetModelVisibility).toHaveBeenCalledWith('stage-1', true);
        expect(mockFeedbackInfo).toHaveBeenCalledWith('scene.stageShown', undefined);
    });

    it('visibility toggle click does not bubble to row click', () => {
        setSceneMenu(makeFakeMenu());
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector('.slide-lead-btn') as HTMLElement | null;
        btn!.click();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('stage row click with no menu registered is a safe no-op', () => {
        // afterEach 已清空菜单注册，覆盖源码 getSceneMenu() 为 null 的早退分支
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const row = Array.from(container.querySelectorAll('.slide-item')).find((el) =>
            el.textContent?.includes('主舞台')
        );
        expect(row).toBeDefined();
        expect(() => row!.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('unload button onRestored callback triggers menu re-render', () => {
        setSceneMenu(makeFakeMenu());
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector('.slide-add-btn') as HTMLElement | null;
        btn!.click();
        const [, , onRestored] = mockOfferSceneUndo.mock.calls[0] as [
            string,
            string | null,
            () => void
        ];
        mockReRender.mockClear();
        onRestored();
        expect(mockReRender).toHaveBeenCalledTimes(1);
    });

    it('load stage filter accepts stage/scene and rejects other kinds', async () => {
        mockGetBrowseDir.mockReturnValue('/lib/stage');
        mockBuildLevel.mockReturnValue({ label: 'browse' });
        setSceneMenu(makeFakeMenu());
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector(
            '[data-testid="menu:scene:load-stage"]'
        ) as HTMLElement | null;
        btn!.click();
        await vi.waitFor(() => expect(mockBuildLevel).toHaveBeenCalledTimes(1));
        const filter = mockBuildLevel.mock.calls[0][2] as (m: { type?: string }) => boolean;
        expect(filter({ type: 'stage' })).toBe(true);
        expect(filter({ type: 'scene' })).toBe(true);
        expect(filter({ type: 'actor' })).toBe(false);
        expect(filter({ type: 'prop' })).toBe(false);
        expect(filter({ type: 'light' })).toBe(false);
        expect(filter({})).toBe(false);
    });

    it('load stage button bails out when scene menu is gone after browse dir', async () => {
        mockGetBrowseDir.mockReturnValue('/lib/stage');
        const level = buildStageLevel();
        const container = renderLevel(level);
        const btn = container.querySelector(
            '[data-testid="menu:scene:load-stage"]'
        ) as HTMLElement | null;
        btn!.click();
        await vi.waitFor(() => expect(mockGetBrowseDir).toHaveBeenCalledTimes(1));
        // 让 buildLevel 动态 import + getSceneMenu 检查完成
        await new Promise((r) => setTimeout(r, 0));
        expect(mockBuildLevel).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockFeedbackStatus).not.toHaveBeenCalled();
    });

    it('renders every loaded stage as a row', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台', visible: true });
        mockModelRegistry.set('stage-2', { kind: 'stage', name: '副舞台', visible: false });
        const level = buildStageLevel();
        const container = renderLevel(level);
        const labels = Array.from(container.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        expect(labels).toContain('主舞台');
        expect(labels).toContain('副舞台');
    });

    it('renderCustom returns a dispose function', () => {
        const level = buildStageLevel();
        const container = document.createElement('div');
        const dispose = level.renderCustom!(container);
        expect(typeof dispose).toBe('function');
    });
});

describe('Stage transform level', () => {
    beforeEach(() => {
        mockPush.mockReset();
        mockPop.mockReset();
        mockReRender.mockReset();
        mockModelRegistry.clear();
        mockBuildTransformCard.mockReset();
        mockBuildMaterialCard.mockReset();
        mockBuildDangerCard.mockReset();
    });

    afterEach(() => {
        setSceneMenu(null);
    });

    it('renders transform panel blocks with stage name', () => {
        mockModelRegistry.set('stage-1', { kind: 'stage', name: '主舞台' });
        const level = buildStageTransformLevel('stage-1');
        expect(level.label).toContain('主舞台');
        const container = renderLevel(level);
        expect(mockBuildTransformCard).toHaveBeenCalledTimes(1);
        expect(mockBuildMaterialCard).toHaveBeenCalledTimes(1);
        expect(mockBuildDangerCard).toHaveBeenCalledTimes(1);
        const labels = Array.from(container.querySelectorAll('.collapsible-label')).map(
            (el) => el.textContent
        );
        expect(labels).toContain('拖拽操控');
        const handle = mockBuildTransformCard.mock.calls[0][1];
        expect(handle).toEqual({ id: 'stage-1', kind: 'stage', name: '主舞台' });
    });

    it('falls back to id when stage instance is missing', () => {
        const level = buildStageTransformLevel('ghost-1');
        expect(level.label).toContain('ghost-1');
        const container = renderLevel(level);
        expect(container.querySelector('.collapsible-label')).not.toBeNull();
        expect(mockBuildDangerCard).toHaveBeenCalledTimes(1);
        const handle = mockBuildDangerCard.mock.calls[0][1];
        expect(handle.name).toBe('ghost-1');
    });

    it('danger card onRemoved re-renders menu and pops back to root', () => {
        setSceneMenu(makeFakeMenu());
        const level = buildStageTransformLevel('stage-1');
        renderLevel(level);
        expect(mockBuildDangerCard).toHaveBeenCalledTimes(1);
        const onRemoved = mockBuildDangerCard.mock.calls[0][2] as () => void;
        expect(typeof onRemoved).toBe('function');
        onRemoved();
        expect(mockReRender).toHaveBeenCalledTimes(1);
        expect(mockPop).toHaveBeenCalledTimes(1);
    });

    it('material card receives current scene menu as target stack', () => {
        const menu = makeFakeMenu();
        setSceneMenu(menu);
        const level = buildStageTransformLevel('stage-1');
        renderLevel(level);
        expect(mockBuildMaterialCard).toHaveBeenCalledTimes(1);
        expect(mockBuildMaterialCard.mock.calls[0][2]).toBe(menu);
    });

    it('material card receives null target stack when no scene menu', () => {
        const level = buildStageTransformLevel('stage-1');
        renderLevel(level);
        expect(mockBuildMaterialCard).toHaveBeenCalledTimes(1);
        expect(mockBuildMaterialCard.mock.calls[0][2]).toBeNull();
    });

    it('danger card onRemoved tolerates missing scene menu', () => {
        // 无菜单注册：reRender/pop 均为 no-op，不抛异常
        const level = buildStageTransformLevel('stage-1');
        renderLevel(level);
        const onRemoved = mockBuildDangerCard.mock.calls[0][2] as () => void;
        expect(() => onRemoved()).not.toThrow();
        expect(mockPop).not.toHaveBeenCalled();
        expect(mockReRender).not.toHaveBeenCalled();
    });
});
