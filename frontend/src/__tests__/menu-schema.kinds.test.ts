// menu-schema.kinds.test.ts — 各 kind 渲染 + modeRow kind 渲染（ADR-093 §6.1 / §6.11，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { setEnvState } from '../scene/scene';
import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';

// [doc:perf] 语言包改为运行时加载，测试环境直接预填缓存
beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

describe('ADR-093 Menu Schema — 各 kind 渲染 + modeRow', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    // ═══════════════════════════════════════════════════════
    // §6.1 各 kind 渲染
    // ═══════════════════════════════════════════════════════
    describe('各 kind 渲染', () => {
        it('slider 生成滑块行 DOM', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:slider',
                    kind: 'slider',
                    label: 'env.groundPitch',
                    control: { bind: 'env.groundPitch', min: -45, max: 45, step: 1 },
                    icon: 'lucide:arrow-up-down',
                },
            ];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
            expect(container.querySelector('.cs-row')).toBeTruthy();
        });

        it('toggle 生成开关行 DOM', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:toggle',
                    kind: 'toggle',
                    label: 'env.groundVisibleEnabled',
                    control: { bind: 'env.groundVisibleEnabled' },
                    icon: 'lucide:infinity',
                },
            ];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('colorSlider 生成颜色滑块 DOM', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:color',
                    kind: 'colorSlider',
                    label: 'env.skyColorTop',
                    control: { bind: 'env.skyColorTop' },
                },
            ];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('modeSlider 生成模式选择器 DOM', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:mode',
                    kind: 'modeSlider',
                    label: 'env.skyMode',
                    control: {
                        bind: 'env.skyMode',
                        options: [
                            { value: 'color', label: 'env.solid' },
                            { value: 'texture', label: 'env.texture' },
                        ],
                    },
                    icon: 'lucide:sun',
                },
            ];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('custom 调用 renderCustom 并将内容写入容器', () => {
            const renderCustom = vi.fn((cc: HTMLElement) => {
                const div = document.createElement('div');
                div.id = 'custom-el';
                cc.appendChild(div);
            });
            const schema: MenuNode[] = [{ id: 't:custom', kind: 'custom', renderCustom }];
            renderMenu(schema, container);
            expect(renderCustom).toHaveBeenCalledWith(container);
            expect(container.querySelector('#custom-el')).toBeTruthy();
        });

        it('folder 渲染折叠面板 + 子节点', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:folder',
                    kind: 'folder',
                    label: 'env.ground',
                    icon: 'lucide:grid-3x3',
                    defaultOpen: true,
                    children: [
                        {
                            id: 't:folder:slider',
                            kind: 'slider',
                            label: 'env.groundPitch',
                            control: { bind: 'env.groundPitch', min: -45, max: 45, step: 1 },
                        },
                    ],
                },
            ];
            renderMenu(schema, container);
            expect(container.querySelector('.collapsible-wrapper')).toBeTruthy();
        });

        it('divider 不生成 DOM', () => {
            const schema: MenuNode[] = [{ id: 't:divider', kind: 'divider' }];
            renderMenu(schema, container);
            expect(container.children.length).toBe(0);
        });

        it('sectionTitle 生成分组标题 DOM', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:section',
                    kind: 'sectionTitle',
                    label: 'env.sky',
                },
            ];
            renderMenu(schema, container);
            expect(container.querySelector('.section-title')).toBeTruthy();
            expect(container.textContent).toContain('天空');
        });

        it('headerToggle bind 直接 boolean 映射', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:htoggle',
                    kind: 'folder',
                    label: 'env.ground',
                    defaultOpen: true,
                    headerToggle: { bind: 'env.groundVisibleEnabled' },
                    children: [
                        {
                            id: 't:htoggle:child',
                            kind: 'slider',
                            label: 'env.groundPitch',
                            control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                        },
                    ],
                },
            ];
            renderMenu(schema, container);
            expect(container.querySelector('.collapsible-wrapper')).toBeTruthy();
            expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.11 modeRow kind 渲染
    // ═══════════════════════════════════════════════════════
    describe('modeRow kind 渲染', () => {
        it('renders horizontal button group with active state', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:modeRow',
                    kind: 'modeRow',
                    label: 'env.skyMode',
                    control: {
                        bind: 'env.skyMode',
                        options: [
                            { value: 'color', label: 'env.solid' },
                            { value: 'texture', label: 'env.texture' },
                        ],
                    },
                },
            ];
            renderMenu(schema, container);
            const typeRow = container.querySelector('.type-row');
            expect(typeRow).toBeTruthy();
            const btns = typeRow!.querySelectorAll('.mode-btn');
            expect(btns.length).toBe(2);
        });

        it('clicking button triggers onChange and updates state', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:modeRow2',
                    kind: 'modeRow',
                    label: 'env.skyMode',
                    control: {
                        bind: 'env.skyMode',
                        options: [
                            { value: 'color', label: 'env.solid' },
                            { value: 'texture', label: 'env.texture' },
                        ],
                    },
                },
            ];
            renderMenu(schema, container);
            const btns = container.querySelectorAll('.mode-btn');
            expect(btns.length).toBe(2);
            (btns[1] as HTMLElement).click();
            expect(setEnvState).toHaveBeenCalledWith({ skyMode: 'texture' });
        });
    });
});
