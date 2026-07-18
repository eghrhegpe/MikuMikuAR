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
}));

vi.mock('../scene/env/env-bridge', () => ({
    setEnvState: (...args: unknown[]) => mockSetEnvState(...args),
}));

vi.mock('../scene/env/env', () => ({
    isDebugMirrorActive: vi.fn(() => false),
    setDebugMirrorSize: vi.fn(),
    setDebugMirrorResolution: vi.fn(),
    getDebugMirrorInfo: vi.fn(() => ({
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

describe('Stage - ground/water toggles', () => {
    beforeEach(() => {
        mockEnvState.groundVisible = true;
        mockEnvState.waterEnabled = false;
        mockSetEnvState.mockReset();
        mockPush.mockReset();
    });

    it('debug: check rendered container content', () => {
        const level = buildStageLevel();
        expect(level.renderCustom).toBeDefined();
        const container = document.createElement('div');
        level.renderCustom!(container);
        console.log('container innerHTML length:', container.innerHTML.length);
        console.log('container innerHTML:', container.innerHTML.substring(0, 1000));
        console.log('container children:', container.children.length);
        for (let i = 0; i < container.children.length; i++) {
            const child = container.children[i];
            console.log(
                `  child[${i}]:`,
                child.tagName,
                child.className,
                child.innerHTML.substring(0, 150)
            );
            const items = child.querySelectorAll('.slide-item');
            console.log('  .slide-item count:', items.length);
            items.forEach((item, j) => {
                const label = item.querySelector('.slide-label');
                console.log(`    item[${j}]: label="${label?.textContent}"`);
            });
        }
    });

    it('renders ground row with toggle reflecting envState.groundVisible', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { row, checkbox } = findToggleRow(container, '地面');
        expect(row).not.toBeNull();
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(true);
    });

    it('renders water row with toggle reflecting envState.waterEnabled', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { row, checkbox } = findToggleRow(container, '水面');
        expect(row).not.toBeNull();
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(false);
    });

    it('clicking ground toggle calls setEnvState with groundVisible=false', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { toggleLabel } = findToggleRow(container, '地面');
        expect(toggleLabel).not.toBeNull();

        // 点击 toggle label 触发 onChange（headerToggle 的 click handler）
        toggleLabel!.click();

        expect(mockSetEnvState).toHaveBeenCalledWith({ groundVisible: false });
    });

    it('clicking water toggle calls setEnvState with waterEnabled=true', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { toggleLabel } = findToggleRow(container, '水面');
        expect(toggleLabel).not.toBeNull();

        toggleLabel!.click();

        expect(mockSetEnvState).toHaveBeenCalledWith({ waterEnabled: true });
    });

    it('clicking toggle does not navigate (stopPropagation via closest .toggle)', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { row, toggleLabel } = findToggleRow(container, '地面');
        expect(row).not.toBeNull();
        expect(toggleLabel).not.toBeNull();

        // Click the toggle label — should toggle but NOT navigate
        toggleLabel!.click();

        // Should NOT navigate (toggle click is stopPropagation'd)
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('ground row has arrow for navigation to full parameters', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { row, arrow } = findToggleRow(container, '地面');
        expect(row).not.toBeNull();
        expect(arrow).not.toBeNull();
        expect(arrow!.textContent).toBe('▾');
    });

    it('water row has arrow for navigation', () => {
        const level = buildStageLevel();
        const container = renderLevel(level);
        const { arrow } = findToggleRow(container, '水面');
        expect(arrow).not.toBeNull();
    });
});
