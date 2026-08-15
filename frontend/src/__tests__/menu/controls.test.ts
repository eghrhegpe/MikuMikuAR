// menu/controls.test.ts — SlideMenu 增量刷新机制（registerControl / updateControls）
// [doc:PACU] 声明式 schema 的核心机制：控件注册 + pathHint 精确刷新 + itemBuilder 增量 patch。
// 既有覆盖里零测试的区域（对照 menu.ts 公开面 audit 结果）。
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import type { PopupLevel, PopupRow } from '../../core/config';
import { bundles } from '../../core/i18n/t';
import { zhCN } from '../../core/i18n/locales/zh-CN';

describe('SlideMenu — registerControl / updateControls 增量刷新', () => {
    let menu: SlideMenu;
    let container: HTMLElement;

    beforeAll(() => {
        // [doc:perf] 语言包运行时加载；测试环境直接预填基准包，避免 t() 缺失 key 告警
        bundles['zh-CN'] = zhCN;
    });

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
        // 与 render-menu.ts 的 pathHint 契约一致：reactivity 收集的是顶层 key（叶名），
        // 例如 ctrl.bind='env.skyMode' 时 pathHint 传 'skyMode'，不是完整路径。
        menu.registerControl(exact, 'skyMode');
        menu.registerControl(generic);
        menu.registerControl(other, 'groundPitch');

        menu.updateControls(new Set(['skyMode']));

        expect(exact).toHaveBeenCalledTimes(1); // pathHint 命中
        expect(generic).toHaveBeenCalledTimes(1); // 未提供 pathHint → 兼容全量
        expect(other).not.toHaveBeenCalled(); // pathHint 不匹配 → 跳过
    });

    it('updateControls(new Set()) 空集回退全量更新', () => {
        const a = vi.fn();
        const b = vi.fn();
        menu.registerControl(a, 'skyMode');
        menu.registerControl(b, 'groundPitch');
        menu.updateControls(new Set());
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('itemBuilder 层级：updateControls 重建 items 并增量 patch 面板', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: '旧', icon: 'i', target: 'v1' }],
            itemBuilder: (): PopupRow[] => [
                { kind: 'action' as const, label: '新', icon: 'i', target: 'v1' },
            ],
        };
        menu.reset(level);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rowEl = container.querySelector('.slide-item');
        expect(rowEl?.textContent).toContain('旧');

        menu.updateControls();

        expect(level.items).toHaveLength(1);
        expect(level.items[0].label).toBe('新');
        // key 不变 → 原地刷新文本，不重建整行（增量 patch 而非全量重建）
        expect(container.querySelector('.slide-item')).toBe(rowEl);
        expect(container.querySelector('.slide-label')?.textContent).toBe('新');
    });

    it('buildPanel 重建后清空旧控件注册表，旧 update 不再被调用', async () => {
        const stale = vi.fn();
        menu.registerControl(stale);
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        await new Promise((resolve) => requestAnimationFrame(resolve));

        menu.updateControls();

        expect(stale).not.toHaveBeenCalled();
    });

    it('itemBuilder 返回空列表时清空旧面板（回归防护）', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: '旧', icon: 'i', target: 'old' }],
            itemBuilder: (): PopupRow[] => [],
        };
        menu.reset(level);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-item')).toBeTruthy();

        menu.updateControls();

        expect(level.items).toHaveLength(0);
        expect(container.querySelector('.slide-item')).toBeNull();
    });
});
