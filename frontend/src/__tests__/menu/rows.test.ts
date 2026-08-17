import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';

// ─── SlideMenu 测试：创建行 (createRow DOM 类型) ───

describe('SlideMenu — 创建行 (createRow DOM 类型)', () => {
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
        // 确保有一个根层级，使 currentLevel 可用
        menu.reset(makeTestLevel('根'));
    });

    // 动画生命周期定时器（150ms/200ms fadeOut/fadeIn 兜底）在测试结束后仍会触发，
    // 不 dispose 会在 vitest teardown 时抛 unhandled error（CI flaky：menu.ts:384 onFadeOut）。
    afterEach(() => {
        menu.dispose();
    });

    // createRow 是 private，通过 (menu as any).createRow(row) 访问

    it('divider 行生成分隔线 DOM', () => {
        const el = (menu as any).createRow({
            kind: 'divider' as const,
            label: '',
            icon: '',
            target: '',
        });
        expect(el).toBeTruthy();
        expect(el.className).toBe('slide-divider');
    });

    it('action 行生成 slide-item', () => {
        const el = (menu as any).createRow({
            kind: 'action' as const,
            label: '测试项',
            icon: 'test-icon',
            target: 'test-target',
        });
        expect(el).toBeTruthy();
        expect(el.className).toContain('slide-item');
        expect(el.querySelector('.slide-label')?.textContent).toBe('测试项');
        expect(el.dataset.rowKey).toBe('action:test-target');
    });

    it('action 行带 onAddClick 生成添加按钮', () => {
        const addClick = vi.fn();
        const el = (menu as any).createRow({
            kind: 'action' as const,
            label: '可添加',
            icon: 'i',
            target: 't',
            onAddClick: addClick,
        });
        const addBtn = el.querySelector('.slide-add-btn');
        expect(addBtn).toBeTruthy();
        // `+` 现渲染为 lucide:plus 图标（iconify-icon），不再用文本 textContent
        expect(addBtn?.querySelector('iconify-icon')).toBeTruthy();
        addBtn?.click();
        expect(addClick).toHaveBeenCalledTimes(1);
    });

    it('action 行点击触发 onItemClick', () => {
        const onItemClick = vi.fn();
        (menu as any).onItemClick = onItemClick;
        const el = (menu as any).createRow({
            kind: 'action' as const,
            label: '点击项',
            icon: 'i',
            target: 'click-target',
        });
        el.click();
        expect(onItemClick).toHaveBeenCalledTimes(1);
        expect(onItemClick).toHaveBeenCalledWith(
            expect.objectContaining({ label: '点击项', target: 'click-target' }),
            menu
        );
    });

    it('folder 行生成含右箭头的 slide-item', () => {
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '子菜单',
            icon: 'folder',
            target: 'sub',
        });
        expect(el.className).toContain('slide-item');
        expect(el.querySelector('.slide-arrow')?.textContent).toBe('>');
        expect(el.dataset.rowKey).toBe('folder:sub');
    });

    it('folder 行点击触发 onFolderEnter', () => {
        const folderEnter = vi.fn(() => makeTestLevel('进入'));
        (menu as any).onFolderEnter = folderEnter;
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '子菜单',
            icon: 'folder',
            target: 'sub',
        });
        el.click();
        expect(folderEnter).toHaveBeenCalledTimes(1);
    });

    it('transitioning 期间 folder 点击被忽略（与键盘导航同语义）', () => {
        const folderEnter = vi.fn(() => makeTestLevel('进入'));
        (menu as any).onFolderEnter = folderEnter;
        (menu as any).transitioning = true;
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '子菜单',
            icon: 'folder',
            target: 'sub',
        });
        el.click();
        expect(folderEnter).not.toHaveBeenCalled();
    });

    it('folder async 点击：await 期间内容版本变化时丢弃过期结果', async () => {
        let resolveFolder: (v: unknown) => void = () => {};
        const folderEnter = vi.fn(
            () => new Promise((res) => { resolveFolder = res; })
        );
        (menu as any).onFolderEnter = folderEnter;
        const pushSpy = vi.spyOn(menu, 'push').mockImplementation(() => {});
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '子菜单',
            icon: 'folder',
            target: 'sub',
        });
        el.click();
        // await 窗口内：模拟其他操作触发内容重建（_buildSeq 递增）
        (menu as any)._buildSeq += 1;
        resolveFolder(makeTestLevel('进入'));
        await Promise.resolve();
        expect(folderEnter).toHaveBeenCalledTimes(1);
        expect(pushSpy).not.toHaveBeenCalled();
        pushSpy.mockRestore();
    });

    it('folder 行带 headerToggle 生成折叠式行', () => {
        const toggleChange = vi.fn();
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '可折叠菜单',
            icon: 'f',
            target: 'coll',
            headerToggle: {
                value: true,
                onChange: toggleChange,
            },
        });
        // headerToggle 路径使用 collapsible-header
        expect(el).toBeTruthy();
        // el 是 slideRow wrapper 中的 firstChild
        expect(el.className).toBe('collapsible-header');
        expect(el.querySelector('.collapsible-label')?.textContent).toBe('可折叠菜单');
        // headerToggle 渲染为真实开关，点击触发 onChange
        const toggle = el.querySelector('.header-toggle');
        expect(toggle).toBeTruthy();
        toggle?.click();
        expect(toggleChange).toHaveBeenCalledWith(false);
    });

    it('headerToggle folder 行：transitioning 期间点击被忽略（与普通 folder 同语义）', () => {
        const folderEnter = vi.fn(() => makeTestLevel('进入'));
        (menu as any).onFolderEnter = folderEnter;
        (menu as any).transitioning = true;
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '子菜单',
            icon: 'folder',
            target: 'sub',
            headerToggle: { value: true, onChange: () => {} },
        });
        el.click();
        expect(folderEnter).not.toHaveBeenCalled();
    });

    it('headerToggle folder 行：async await 窗口内容版本变化时丢弃过期结果', async () => {
        let resolveFolder: (v: unknown) => void = () => {};
        const folderEnter = vi.fn(
            () => new Promise((res) => { resolveFolder = res; })
        );
        (menu as any).onFolderEnter = folderEnter;
        const pushSpy = vi.spyOn(menu, 'push').mockImplementation(() => {});
        const el = (menu as any).createRow({
            kind: 'folder' as const,
            label: '子菜单',
            icon: 'folder',
            target: 'sub',
            headerToggle: { value: true, onChange: () => {} },
        });
        el.click();
        // await 窗口内：模拟其他操作触发内容重建（_buildSeq 递增）
        (menu as any)._buildSeq += 1;
        resolveFolder(makeTestLevel('进入'));
        await Promise.resolve();
        expect(folderEnter).toHaveBeenCalledTimes(1);
        expect(pushSpy).not.toHaveBeenCalled();
        pushSpy.mockRestore();
    });

    it('slider 行生成滑块控件 wrapper', () => {
        const onChange = vi.fn();
        const el = (menu as any).createRow({
            kind: 'slider' as const,
            label: '滑块',
            icon: 'slider',
            target: 'sl',
            sliderValue: 0.5,
            sliderMin: 0,
            sliderMax: 1,
            sliderStep: 0.1,
            onSliderChange: onChange,
        });
        expect(el).toBeTruthy();
        expect(el.dataset.rowKey).toBe('slider:sl');
        // 内部有 cs-row 结构（由 addSliderRow 生成）
        expect(el.querySelector('.cs-row') || el.querySelector('.cs-label')).toBeTruthy();
    });

    it('toggle 行生成开关控件 wrapper', () => {
        const onChange = vi.fn();
        const el = (menu as any).createRow({
            kind: 'toggle' as const,
            label: '开关',
            icon: 'tog',
            target: 'tg',
            toggleValue: true,
            onToggleChange: onChange,
        });
        expect(el).toBeTruthy();
        expect(el.dataset.rowKey).toBe('toggle:tg');
        // 内部有 toggle-row 结构
        const row = el.querySelector('.toggle-row');
        expect(row).toBeTruthy();
        // 点击行主体切换开关并回调
        row?.click();
        expect(onChange).toHaveBeenCalledWith(false);
        const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        expect(checkbox?.checked).toBe(false);
    });

    it('chips 行生成芯片组', () => {
        const chipClick = vi.fn();
        const el = (menu as any).createRow({
            kind: 'chips' as const,
            label: '芯片',
            icon: '',
            target: 'ch',
            chips: [
                { label: 'Chip A', active: true, onClick: chipClick },
                { label: 'Chip B', active: false, onClick: chipClick },
            ],
        });
        expect(el).toBeTruthy();
        expect(el.className).toBe('preset-group');
        const chips = el.querySelectorAll('.preset-chip');
        expect(chips.length).toBe(2);
        expect(chips[0].classList.contains('active')).toBe(true);
        expect(chips[1].classList.contains('active')).toBe(false);
        chips[1].click();
        expect(chipClick).toHaveBeenCalledTimes(1);
    });

    it('鼠标悬停 action 行触发 onHover', () => {
        const onHover = vi.fn();
        (menu as any).onHover = onHover;
        const el = (menu as any).createRow({
            kind: 'action' as const,
            label: '悬停测试',
            icon: 'i',
            target: 'h',
            sublabel: '提示文本',
        });
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ label: '悬停测试' }), true);

        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ label: '悬停测试' }), false);
    });
});
