// menu/controls.test.ts — SlideMenu 增量刷新机制（registerControl / updateControls）
// [doc:PACU] 声明式 schema 的核心机制：控件注册 + pathHint 精确刷新 + itemBuilder 增量 patch。
// 既有覆盖里零测试的区域（对照 menu.ts 公开面 audit 结果）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import type { PopupLevel, PopupRow } from '../../core/config';

describe('SlideMenu — registerControl / updateControls 增量刷新', () => {
    let menu: SlideMenu;
    let container: HTMLElement;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
        container = m.container;
        menu.reset(makeTestLevel('根'));
    });

    it('updateControls() 无路径信息时全量更新所有已注册控件', () => {
        const a = vi.fn();
        const b = vi.fn();
        menu.registerControl(a);
        menu.registerControl(b);
        menu.updateControls();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('updateControls(changedKeys) 只更新 pathHint 命中或未提供的控件', () => {
        const exact = vi.fn();
        const generic = vi.fn();
        const other = vi.fn();
        menu.registerControl(exact, 'env.skyMode');
        menu.registerControl(generic);
        menu.registerControl(other, 'env.groundPitch');

        menu.updateControls(new Set(['env.skyMode']));

        expect(exact).toHaveBeenCalledTimes(1); // pathHint 命中
        expect(generic).toHaveBeenCalledTimes(1); // 未提供 pathHint → 兼容全量
        expect(other).not.toHaveBeenCalled(); // pathHint 不匹配 → 跳过
    });

    it('updateControls(new Set()) 空集回退全量更新', () => {
        const a = vi.fn();
        const b = vi.fn();
        menu.registerControl(a, 'env.skyMode');
        menu.registerControl(b, 'env.groundPitch');
        menu.updateControls(new Set());
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('itemBuilder 层级：updateControls 重建 items 并增量 patch 面板', () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: '旧', icon: 'i', target: 'v1' }],
            itemBuilder: (): PopupRow[] => [
                { kind: 'action' as const, label: '新', icon: 'i', target: 'v2' },
            ],
        };
        menu.reset(level);

        menu.updateControls();

        expect(level.items).toHaveLength(1);
        expect(level.items[0].label).toBe('新');
        expect(container.querySelector('.slide-label')?.textContent).toBe('新');
    });
});
