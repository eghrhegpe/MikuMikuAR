// menu-schema.i18n.test.ts — i18n 热切换（ADR-065 / ADR-093 §6.6，拆自 menu-schema.test.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { setLang, getLang } from '../core/i18n/locale';
import type { LangCode } from '../core/i18n/locale';

describe('ADR-093 Menu Schema — i18n 热切换', () => {
    let container: HTMLElement;
    let savedLang: LangCode;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        savedLang = getLang();
    });

    afterEach(() => {
        container.remove();
        setLang(savedLang);
    });

    it('切换语言后重新渲染，label 文本随之变化', () => {
        const schema: MenuNode[] = [
            {
                id: 't:i18n',
                kind: 'slider',
                label: 'env.sky',
                control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
            },
        ];

        setLang('zh-CN');
        renderMenu(schema, container);
        const zhText = container.textContent ?? '';

        container.innerHTML = '';
        setLang('en');
        renderMenu(schema, container);
        const enText = container.textContent ?? '';

        // 两种语言的 label 应该不同（证明 t() 在渲染时重新求值）
        expect(zhText).not.toBe(enText);
    });

    it('modeSlider options label 经 t() 国际化', () => {
        const schema: MenuNode[] = [
            {
                id: 't:i18nMode',
                kind: 'modeSlider',
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

        setLang('zh-CN');
        renderMenu(schema, container);
        const zhText = container.textContent ?? '';

        container.innerHTML = '';
        setLang('en');
        renderMenu(schema, container);
        const enText = container.textContent ?? '';

        expect(zhText).not.toBe(enText);
    });
});
