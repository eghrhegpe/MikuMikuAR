// menu-schema.guards.test.ts — visibleWhen 守卫（ADR-093 §6.2，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { envState } from '../core/config';

describe('ADR-093 Menu Schema — visibleWhen 守卫', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('返回 false 时节点跳过渲染', () => {
        const schema: MenuNode[] = [
            {
                id: 't:hidden',
                kind: 'slider',
                label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                visibleWhen: () => false,
            },
        ];
        renderMenu(schema, container);
        expect(container.children.length).toBe(0);
    });

    it('返回 true 时节点正常渲染', () => {
        const schema: MenuNode[] = [
            {
                id: 't:visible',
                kind: 'slider',
                label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                visibleWhen: () => true,
            },
        ];
        renderMenu(schema, container);
        expect(container.children.length).toBeGreaterThan(0);
    });

    it('基于 envState 的动态条件守卫', () => {
        const originalGT = envState.groundType;
        try {
            const schema: MenuNode[] = [
                {
                    id: 't:cond',
                    kind: 'slider',
                    label: 'env.groundPitch',
                    control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                    visibleWhen: () => envState.groundType !== 'terrain',
                },
            ];

            envState.groundType = 'flat';
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);

            container.innerHTML = '';
            envState.groundType = 'terrain';
            renderMenu(schema, container);
            expect(container.children.length).toBe(0);
        } finally {
            envState.groundType = originalGT;
        }
    });

    it('folder 子节点的 visibleWhen 独立求值', () => {
        const schema: MenuNode[] = [
            {
                id: 't:folder',
                kind: 'folder',
                label: 'env.ground',
                defaultOpen: true,
                children: [
                    {
                        id: 't:show',
                        kind: 'slider',
                        label: 'env.groundPitch',
                        control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                        visibleWhen: () => true,
                    },
                    {
                        id: 't:hide',
                        kind: 'slider',
                        label: 'env.groundRoll',
                        control: { bind: 'env.groundRoll', min: 0, max: 1, step: 0.1 },
                        visibleWhen: () => false,
                    },
                ],
            },
        ];
        renderMenu(schema, container);
        // folder 渲染了，visibleWhen=true 的子节点存在，visibleWhen=false 的被跳过
        const rows = container.querySelectorAll('.cs-row');
        expect(rows.length).toBe(1); // 只有 visibleWhen=true 的 slider 被渲染
    });
});
