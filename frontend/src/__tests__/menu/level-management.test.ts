import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import { setLang } from '../../core/i18n/locale';
import { t } from '../../core/i18n/t';
import type { PopupLevel } from '../../core/config';

// ─── SlideMenu 测试：层级管理 (getLevel/setLevel/updateRow/refreshHeader) ───

describe('SlideMenu — 层级管理 (getLevel/setLevel/updateRow/refreshHeader)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    it('getLevel 返回指定层级', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        expect(menu.getLevel(1)?.label).toBe('L1');
    });

    it('getLevel 负数索引返回 undefined', () => {
        (menu as any).levels = [makeTestLevel('根')];
        expect(menu.getLevel(-1)).toBeUndefined();
    });

    it('getLevel 越界索引返回 undefined', () => {
        (menu as any).levels = [makeTestLevel('根')];
        expect(menu.getLevel(99)).toBeUndefined();
    });

    it('setLevel 更新指定层级', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const updated = makeTestLevel('已更新');
        menu.setLevel(1, updated);
        expect(menu.getLevel(1)?.label).toBe('已更新');
    });

    it('setLevel 末层触发 reRender', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelectorAll('.slide-item').length).toBe(1);

        const newLevel: PopupLevel = {
            label: '根',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
                { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
            ],
        };
        menu.setLevel(0, newLevel); // index 0 is current (last) level
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });

    it('setLevel 越界无操作', () => {
        (menu as any).levels = [makeTestLevel('L0')];
        menu.setLevel(5, makeTestLevel('不应写入'));
        expect((menu as any).levels.length).toBe(1);
        expect((menu as any).levels[0].label).toBe('L0');
    });

    it('setLevel 非末层不触发 reRender', () => {
        const spy = vi.spyOn(menu, 'reRender');
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        menu.setLevel(1, makeTestLevel('中间层'));
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('updateRow 更新当前层级行', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: '旧', icon: 'i', target: 'old' }],
        };
        menu.reset(level);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-item')?.textContent).toContain('旧');

        menu.updateRow(0, { kind: 'action' as const, label: '新', icon: 'i', target: 'new' });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-item')?.textContent).toContain('新');
    });

    it('updateRow 越界无操作', () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        // 不会抛异常，也不会改变 items
        menu.updateRow(-1, { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        menu.updateRow(5, { kind: 'action' as const, label: 'C', icon: 'i', target: 'c' });
        expect(menu.currentLevel?.items.length).toBe(1);
    });

    it('updateRow 无 panel 时正常跳过', () => {
        (menu as any).levels = [
            makeTestLevel('根', '', [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }]),
        ];
        // 不调用 reset/buildPanel，panel 无 .slide-list
        // 应正常跳过 DOM 操作
        expect(() => {
            menu.updateRow(0, { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        }).not.toThrow();
        expect(menu.currentLevel?.items[0].label).toBe('B');
    });

    it('refreshHeader 刷新标题栏', async () => {
        menu.reset(makeTestLevel('原始标题'));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-title')?.textContent).toBe('原始标题');

        (menu as any).currentLevel!.label = '新标题';
        menu.refreshHeader();
        expect(container.querySelector('.slide-title')?.textContent).toBe('新标题');
    });
});

// ── ADR-065: 纯 items 层级语言热刷新 ─────────────────────────────

describe('SlideMenu — ADR-065 纯 items 层级语言热刷新', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        // 锁定初始语言，隔离其它测试对全局 lang 状态的污染
        setLang('zh-CN');
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
    });

    it('itemBuilder 使 updateControls 原地刷新标签（key 不变只改文本）', async () => {
        let lang = 'zh-CN';
        const labelOf = () => (lang === 'en' ? 'Appearance' : '外观');
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: labelOf(), icon: 'i', target: 'appearance' }],
            // [doc:adr-065] itemBuilder 返回最新语言的 items
            itemBuilder: () => [
                { kind: 'action' as const, label: labelOf(), icon: 'i', target: 'appearance' },
            ],
        };
        menu.reset(level);
        await new Promise((r) => requestAnimationFrame(r));
        const labelEl = container.querySelector('.slide-label');
        expect(labelEl?.textContent).toBe('外观');

        // 模拟语言切换后 subscribe 回调触发 updateControls
        lang = 'en';
        menu.updateControls();
        expect(labelEl?.textContent).toBe('Appearance');
        // 原地刷新：DOM 行数量不变（未重建）
        expect(container.querySelectorAll('.slide-item').length).toBe(1);
    });

    it('增量 patch 新增的行也被打上导航标记（P2 回归防护）', async () => {
        let extra = false;
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
            itemBuilder: () =>
                extra
                    ? [
                          { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
                          { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
                      ]
                    : [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        await new Promise((r) => requestAnimationFrame(r));
        // 初始 1 行，已标记
        expect((menu as any).panelItems.length).toBe(1);

        // 增量 patch 追加第 2 行（不走 setupFocus）
        extra = true;
        menu.updateControls();
        // panelItems getter 重扫时为新行补标记 → 方向键可选中
        const items = (menu as any).panelItems as HTMLElement[];
        expect(items.length).toBe(2);
        expect(items.every((el) => el.hasAttribute('data-nav-item'))).toBe(true);
    });

    it('无 itemBuilder 时 updateControls 不会刷新纯 items 标签（回归基线）', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [{ kind: 'action' as const, label: '外观', icon: 'i', target: 'appearance' }],
        };
        menu.reset(level);
        await new Promise((r) => requestAnimationFrame(r));
        expect(container.querySelector('.slide-label')?.textContent).toBe('外观');
        // 无 itemBuilder → updateControls 不应改动已渲染文本
        menu.updateControls();
        expect(container.querySelector('.slide-label')?.textContent).toBe('外观');
    });

    it('面板未渲染时 updateControls 不抛错（ADR-065 守卫）', () => {
        (menu as any).levels = [
            {
                label: '根',
                dir: '',
                items: [
                    { kind: 'action' as const, label: '外观', icon: 'i', target: 'appearance' },
                ],
                itemBuilder: () => [
                    { kind: 'action' as const, label: 'X', icon: 'i', target: 'appearance' },
                ],
            },
        ];
        // 未 buildPanel → panel 无 .slide-list，应安全跳过
        expect(() => menu.updateControls()).not.toThrow();
    });

    it('setLang → scheduleRefresh → 当前层标签热切换（真实 i18n 路径）', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [
                {
                    kind: 'folder' as const,
                    label: t('settings.appearance'),
                    icon: 'i',
                    target: 'appearance',
                },
            ],
            itemBuilder: () => [
                {
                    kind: 'folder' as const,
                    label: t('settings.appearance'),
                    icon: 'i',
                    target: 'appearance',
                },
            ],
        };
        menu.reset(level);
        await new Promise((r) => requestAnimationFrame(r));
        expect(container.querySelector('.slide-label')?.textContent).toBe('外观');

        setLang('en');
        // scheduleRefresh 经 requestAnimationFrame 通知订阅者 → updateControls → patchPanel
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        expect(container.querySelector('.slide-label')?.textContent).toBe('Appearance');
    });

    it('setLang → renderCustom 层级标签热切换（ADR-065 全量重建路径）', async () => {
        // renderCustom 内的文本在渲染期经 t() 求值（等价于 renderMenu 的 schema 标签），
        // 语言切换后须由 updateControls 触发全量重建才能刷新。
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [],
            renderCustom: (c) => {
                const title = document.createElement('div');
                title.className = 'section-title';
                title.textContent = t('settings.appearance');
                c.appendChild(title);
            },
        };
        menu.reset(level);
        await new Promise((r) => requestAnimationFrame(r));
        expect(container.querySelector('.section-title')?.textContent).toBe('外观');

        setLang('en');
        // scheduleRefresh → RAF → updateControls 检测语言变化 → reRender → RAF → buildPanel 全量重建
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        expect(container.querySelector('.section-title')?.textContent).toBe('Appearance');
    });
});
