import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ──

const mockEnvState = vi.hoisted(() => ({ groundVisible: true, waterEnabled: false }));
const mockSetEnvState = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockCreateIconifyIcon = vi.hoisted(() =>
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
        modelRegistry: new Map(),
        overridePaths: {},
        libraryRoot: '',
        escapeHtml: (s: string) => s,
        propRegistry: new Map(),
    };
});

vi.mock('../core/icons', () => ({
    createIconifyIcon: () => {
        const el = document.createElement('span');
        el.className = 'mock-icon';
        return el;
    },
}));

vi.mock('../core/state', () => ({
    envState: mockEnvState,
    setThumbnailUpdateCallback: vi.fn(),
}));

vi.mock('../scene/env/env-bridge', () => ({
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

vi.mock('./scene-menu', () => ({
    reRenderSceneMenu: vi.fn(),
    getSceneMenu: vi.fn(() => ({ push: mockPush })),
}));

vi.mock('./env-feature-levels', () => ({
    buildGroundLevel: vi.fn(() => ({ label: 'ground' })),
    buildWaterLevel: vi.fn(() => ({ label: 'water' })),
}));

// 阻断 Babylon.js Scene 初始化（scene/scene.ts 模块级 new Scene()）
vi.mock('../scene/scene', () => ({
    getPropList: vi.fn(() => []),
    removeProp: vi.fn(),
    modelManager: { modelRegistry: new Map(), size: 0, focused: vi.fn(), get: vi.fn() },
    setEnvState: (...args: unknown[]) => mockSetEnvState(...args),
}));

// ── SUT ──

import { buildStageLevel } from '../menus/scene-stage-levels';

// ── helpers ──

function renderLevel(level: ReturnType<typeof buildStageLevel>): HTMLElement {
    const container = document.createElement('div');
    if (level.renderCustom) {
        level.renderCustom(container);
    }
    return container;
}

function findToggleRow(
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
        mockEnvState.groundVisible = true;
        mockEnvState.waterEnabled = false;
        mockSetEnvState.mockReset();
        mockPush.mockReset();
    });

    it('renders load stage and load prop buttons', () => {
        const level = buildStageLevel();
        expect(level.renderCustom).toBeDefined();
        const container = document.createElement('div');
        level.renderCustom!(container);
        expect(container.querySelectorAll('.slide-item').length).toBeGreaterThanOrEqual(2);
        const labels = Array.from(container.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        expect(labels).toContain('加载舞台');
        expect(labels).toContain('加载道具');
    });

    it('shows empty state when no stages loaded', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        expect(container.textContent).toContain('暂无已加载舞台');
    });

    it('load stage button has testId for E2E', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const loadStage = container.querySelector('[data-testid="menu.scene.loadStage"]');
        expect(loadStage).not.toBeNull();
    });
});
