// menu-schema.dispose.test.ts — renderCustom dispose 级联（ADR-093 §6.3，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';

describe('ADR-093 Menu Schema — renderCustom dispose 级联', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    it('custom 返回的 dispose 被 renderMenu 收集并执行', () => {
        const dispose = vi.fn();
        const schema: MenuNode[] = [
            {
                id: 't:d1',
                kind: 'custom',
                renderCustom: () => dispose,
            },
        ];
        const release = renderMenu(schema, container);
        expect(dispose).not.toHaveBeenCalled();
        release();
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('folder 内 custom 子节点的 dispose 在级联释放时被调用', () => {
        const childDispose = vi.fn();
        const schema: MenuNode[] = [
            {
                id: 't:folder',
                kind: 'folder',
                label: 'env.ground',
                defaultOpen: true,
                children: [{ id: 't:c', kind: 'custom', renderCustom: () => childDispose }],
            },
        ];
        const release = renderMenu(schema, container);
        expect(childDispose).not.toHaveBeenCalled();
        release();
        expect(childDispose).toHaveBeenCalledTimes(1);
    });

    it('folder 自身的 renderCustom dispose 也被收集', () => {
        const folderDispose = vi.fn();
        const schema: MenuNode[] = [
            {
                id: 't:folder',
                kind: 'folder',
                label: 'env.ground',
                defaultOpen: true,
                renderCustom: () => folderDispose,
            },
        ];
        const release = renderMenu(schema, container);
        release();
        expect(folderDispose).toHaveBeenCalledTimes(1);
    });

    it('多个 custom 的 dispose 全部按序执行', () => {
        const order: string[] = [];
        const d1 = vi.fn(() => order.push('d1'));
        const d2 = vi.fn(() => order.push('d2'));
        const d3 = vi.fn(() => order.push('d3'));
        const schema: MenuNode[] = [
            { id: 't:c1', kind: 'custom', renderCustom: () => d1 },
            { id: 't:c2', kind: 'custom', renderCustom: () => d2 },
            { id: 't:c3', kind: 'custom', renderCustom: () => d3 },
        ];
        const release = renderMenu(schema, container);
        release();
        expect(d1).toHaveBeenCalledTimes(1);
        expect(d2).toHaveBeenCalledTimes(1);
        expect(d3).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['d1', 'd2', 'd3']);
    });

    it('renderCustom 返回 void 时 dispose 不报错', () => {
        const schema: MenuNode[] = [
            {
                id: 't:void',
                kind: 'custom',
                renderCustom: (cc) => {
                    cc.appendChild(document.createElement('div'));
                },
            },
        ];
        const release = renderMenu(schema, container);
        expect(() => release()).not.toThrow();
    });

    it('visibleWhen=false 的 custom 节点不调用 renderCustom 也不收集 dispose', () => {
        const renderCustom = vi.fn();
        const dispose = vi.fn();
        const schema: MenuNode[] = [
            {
                id: 't:hidden',
                kind: 'custom',
                visibleWhen: () => false,
                renderCustom: () => {
                    renderCustom();
                    return dispose;
                },
            },
        ];
        const release = renderMenu(schema, container);
        expect(renderCustom).not.toHaveBeenCalled();
        release();
        expect(dispose).not.toHaveBeenCalled();
    });
});
