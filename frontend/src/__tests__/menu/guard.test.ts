import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';

// ─── 统一 async 交互守卫（guard / guardedRun）契约测试 ───
// 长治久安方案：把分散在各 async click handler 的「前置 transitioning 检查 +
// _buildSeq 快照 + 事后过期复查」收敛为 SlideMenu 的 guard()/guardedRun()。
// 本测试锁定其语义：stale 检测器生命周期、过期判定、全包式前置拒绝。

describe('SlideMenu — 统一交互守卫 (guard/guardedRun)', () => {
    let menu: SlideMenu;
    let container: HTMLElement;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
        container = m.container;
        menu.reset(makeTestLevel('根'));
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
    });

    it('guard() 正常时返回 stale 检测器，初始不为过期', () => {
        const stale = menu.guard();
        expect(typeof stale).toBe('function');
        expect(stale!()).toBe(false);
    });

    it('transitioning 时 guard() 返回 null（前置拒绝）', () => {
        (menu as any).transitioning = true;
        expect(menu.guard()).toBeNull();
    });

    it('_buildSeq 变化后 stale() 变为 true（内容重建 = 过期）', () => {
        const stale = menu.guard()!;
        expect(stale()).toBe(false);
        (menu as any)._buildSeq += 1;
        expect(stale()).toBe(true);
    });

    it('transitioning 变为 true 后 stale() 变为 true（进入过渡 = 过期）', () => {
        const stale = menu.guard()!;
        expect(stale()).toBe(false);
        (menu as any).transitioning = true;
        expect(stale()).toBe(true);
    });

    it('guardedRun 前置拒绝：transitioning 时不执行 fn', () => {
        (menu as any).transitioning = true;
        const fn = vi.fn();
        menu.guardedRun(fn);
        expect(fn).not.toHaveBeenCalled();
    });

    it('guardedRun 正常执行并向 fn 注入 stale 检测器', async () => {
        const calls: (boolean | null)[] = [];
        await menu.guardedRun(async (stale) => {
            calls.push(stale());
            (menu as any)._buildSeq += 1;
            calls.push(stale());
        });
        expect(calls).toEqual([false, true]);
    });
});
