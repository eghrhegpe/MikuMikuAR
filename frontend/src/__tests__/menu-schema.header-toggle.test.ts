// menu-schema.header-toggle.test.ts — headerToggle get/set 映射（ADR-093 §6.4，拆自 menu-schema.test.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { envState } from '../core/config';

describe('ADR-093 Menu Schema — headerToggle get/set 映射', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('get 将 groundType=terrain 映射为 toggle ON', () => {
        const original = envState.groundType;
        try {
            envState.groundType = 'terrain';
            const schema: MenuNode[] = [
                {
                    id: 't:ht',
                    kind: 'folder',
                    label: 'env.ground',
                    defaultOpen: true,
                    headerToggle: {
                        bind: 'env.groundType',
                        get: (v) => v === 'terrain',
                        set: (on) => (on ? 'terrain' : 'flat'),
                    },
                    children: [
                        {
                            id: 't:ht:child',
                            kind: 'slider',
                            label: 'env.groundPitch',
                            control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                        },
                    ],
                },
            ];
            renderMenu(schema, container);
            const checkbox = container.querySelector(
                'input[type="checkbox"]'
            ) as HTMLInputElement;
            expect(checkbox).toBeTruthy();
            expect(checkbox.checked).toBe(true);
        } finally {
            envState.groundType = original;
        }
    });

    it('get 将 groundType=flat 映射为 toggle OFF', () => {
        const original = envState.groundType;
        try {
            envState.groundType = 'flat';
            const schema: MenuNode[] = [
                {
                    id: 't:ht2',
                    kind: 'folder',
                    label: 'env.ground',
                    defaultOpen: true,
                    headerToggle: {
                        bind: 'env.groundType',
                        get: (v) => v === 'terrain',
                        set: (on) => (on ? 'terrain' : 'flat'),
                    },
                    children: [
                        {
                            id: 't:ht2:child',
                            kind: 'slider',
                            label: 'env.groundPitch',
                            control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                        },
                    ],
                },
            ];
            renderMenu(schema, container);
            const checkbox = container.querySelector(
                'input[type="checkbox"]'
            ) as HTMLInputElement;
            expect(checkbox).toBeTruthy();
            expect(checkbox.checked).toBe(false);
        } finally {
            envState.groundType = original;
        }
    });
});
