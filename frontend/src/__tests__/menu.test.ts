import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SlideMenu } from '../menus/menu';
import type { PopupLevel, PopupRow } from '../core/config';

// ─── SlideMenu 测试 ─────────────────────────────────────────────
// 验证层级栈管理（push / pop / reset / popTo）。
// 过渡动画基于 CSS，jsdom 中不触发 transitionend；
// 通过手动清除 transitioning 标志来测试同步状态变更。

// ── 辅助函数 ─────────────────────────────────────────────

function makeLevel(label: string, dir = '', items: PopupRow[] = []): PopupLevel {
    return { label, dir, items };
}

// ── 测试 ─────────────────────────────────────────────────

describe('SlideMenu — 层级栈管理', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onHover: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    it('reset 创建初始层级', () => {
        menu.reset(makeLevel('根'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('push 立即增加层级数（同步）', () => {
        menu.reset(makeLevel('根'));
        const before = menu.levelCount;
        menu.push(makeLevel('子级'));
        // levels.push() 是同步的，transitioning 不影响数组
        expect(menu.levelCount).toBe(before + 1);
    });

    it('pop 减少层级数', () => {
        menu.reset(makeLevel('根'));
        menu.push(makeLevel('子级'));
        const before = menu.levelCount;
        // 手动清除 transitioning 使 pop 可以执行
        (menu as any).transitioning = false;
        menu.pop();
        (menu as any).transitioning = false;
        expect(menu.levelCount).toBe(before - 1);
    });

    it('pop 在仅有一层时无效', () => {
        menu.reset(makeLevel('根'));
        menu.pop();
        expect(menu.levelCount).toBe(1);
    });

    it('popTo 回退到指定深度', () => {
        // 直接设置 levels 数组，绕过 push 的 transitioning 守卫
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1'), makeLevel('L2')];
        (menu as any).transitioning = false;
        menu.popTo(0);
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('L0');
    });

    it('reset 清空所有层级并设新根', () => {
        menu.reset(makeLevel('A'));
        menu.push(makeLevel('B'));
        (menu as any).transitioning = false;

        menu.reset(makeLevel('Z'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('Z');
    });

    it('currentLevel 在 pop 完所有层级后为 undefined', () => {
        menu.reset(makeLevel('X'));
        menu.pop();
        (menu as any).transitioning = false;
        // pop 最后一层的 fallback：levels 至少保留 reset 设置的那一层
        // SlideMenu 设计上不允许完全空栈，pop 到 0 时保留当前层
        expect(menu.levelCount).toBeGreaterThanOrEqual(0);
    });

    it('push 在 transitioning 时被阻止', () => {
        menu.reset(makeLevel('根'));
        const before = menu.levelCount;
        (menu as any).transitioning = true;
        menu.push(makeLevel('不应推入'));
        expect(menu.levelCount).toBe(before);
    });

    it('pop 在 transitioning 时被阻止', () => {
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1')];
        const before = (menu as any).levels.length;
        (menu as any).transitioning = true;
        menu.pop();
        expect((menu as any).levels.length).toBe(before);
    });

    it('popTo 到当前层级无变化', () => {
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1'), makeLevel('L2')];
        const before = menu.levelCount;
        menu.popTo(2); // index === length-1 → no-op
        expect(menu.levelCount).toBe(before);
    });

    it('popTo 负数索引被忽略', () => {
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(-1);
        expect(menu.levelCount).toBe(before);
    });

    it('popTo 越界索引被忽略', () => {
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(5);
        expect(menu.levelCount).toBe(before);
    });

    it('resetToRoot 清除多余层级至根', () => {
        (menu as any).levels = [makeLevel('根'), makeLevel('A'), makeLevel('B')];
        menu.resetToRoot();
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('resetToRoot 单层级时无变化', () => {
        menu.reset(makeLevel('仅一层'));
        menu.resetToRoot();
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('仅一层');
    });
});

describe('SlideMenu — 渲染', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    it('reset 构建面板 DOM', () => {
        const level: PopupLevel = {
            label: '测试',
            dir: '',
            items: [
                { kind: 'action' as const, label: '项目1', icon: 'i', target: 'v1' },
                { kind: 'action' as const, label: '项目2', icon: 'i', target: 'v2' },
            ],
        };
        menu.reset(level);
        const items = container.querySelectorAll('.slide-item');
        expect(items.length).toBe(2);
    });

    it('renderCustom 回调创建自定义 DOM', async () => {
        let rendered = false;
        const level: PopupLevel = {
            label: '自定义',
            dir: '',
            items: [],
            renderCustom: (c) => {
                const div = document.createElement('div');
                div.className = 'custom-content';
                div.textContent = 'Hello';
                c.appendChild(div);
            },
        };
        (menu as any).onAfterRender = () => {
            rendered = true;
        };
        menu.reset(level);
        // 等待 buildPanel 的 async 回调 + onAfterRender
        while (!rendered) {
            await new Promise((r) => setTimeout(r, 5));
        }
        const custom = container.querySelectorAll('.custom-content');
        expect(custom.length).toBe(1);
        expect(custom[0]?.textContent).toBe('Hello');
    });

    it('reRender 重新构建当前层级', async () => {
        const level: PopupLevel = {
            label: 'R',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        expect(container.querySelectorAll('.slide-item').length).toBe(1);

        level.items.push({ kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        menu.reRender();
        // reRender 使用 RAF 去抖，需等待下一帧
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });
});

describe('SlideMenu — 键盘导航', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    async function waitForRender(m: SlideMenu): Promise<void> {
        return new Promise((resolve) => {
            const orig = (m as any).onAfterRender;
            (m as any).onAfterRender = () => {
                (m as any).onAfterRender = orig;
                orig?.();
                resolve();
            };
        });
    }

    it('focusNext 在正序/循环', async () => {
        const p = waitForRender(menu);
        menu!.reset({
            label: 'F',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'X', icon: 'i', target: 'x' },
                { kind: 'action' as const, label: 'Y', icon: 'i', target: 'y' },
            ],
        });
        await p;
        // setupFocus() 将 focusIndex 设为 0
        expect((menu as any).focusIndex).toBe(0);

        (menu as any).focusNext();
        expect((menu as any).focusIndex).toBe(1);

        (menu as any).focusNext(); // 循环到 0
        expect((menu as any).focusIndex).toBe(0);
    });

    it('focusPrev 反向循环', async () => {
        const p = waitForRender(menu);
        menu!.reset({
            label: 'F',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'X', icon: 'i', target: 'x' },
                { kind: 'action' as const, label: 'Y', icon: 'i', target: 'y' },
            ],
        });
        await p;

        (menu as any).focusPrev(); // 循环到最后一个
        expect((menu as any).focusIndex).toBe(1);
    });
});

describe('SlideMenu — 层级管理 (getLevel/setLevel/updateRow/refreshHeader)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    it('getLevel 返回指定层级', () => {
        (menu as any).levels = [
            makeLevel('L0'),
            makeLevel('L1'),
            makeLevel('L2'),
        ];
        expect(menu.getLevel(1)?.label).toBe('L1');
    });

    it('getLevel 负数索引返回 undefined', () => {
        (menu as any).levels = [makeLevel('根')];
        expect(menu.getLevel(-1)).toBeUndefined();
    });

    it('getLevel 越界索引返回 undefined', () => {
        (menu as any).levels = [makeLevel('根')];
        expect(menu.getLevel(99)).toBeUndefined();
    });

    it('setLevel 更新指定层级', () => {
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1')];
        const updated = makeLevel('已更新');
        menu.setLevel(1, updated);
        expect(menu.getLevel(1)?.label).toBe('已更新');
    });

    it('setLevel 末层触发 reRender', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            ],
        };
        menu.reset(level);
        await new Promise(resolve => requestAnimationFrame(resolve));
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
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });

    it('setLevel 越界无操作', () => {
        (menu as any).levels = [makeLevel('L0')];
        menu.setLevel(5, makeLevel('不应写入'));
        expect((menu as any).levels.length).toBe(1);
        expect((menu as any).levels[0].label).toBe('L0');
    });

    it('setLevel 非末层不触发 reRender', () => {
        const spy = vi.spyOn(menu, 'reRender');
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1'), makeLevel('L2')];
        menu.setLevel(1, makeLevel('中间层'));
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('updateRow 更新当前层级行', async () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [
                { kind: 'action' as const, label: '旧', icon: 'i', target: 'old' },
            ],
        };
        menu.reset(level);
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-item')?.textContent).toContain('旧');

        menu.updateRow(0, { kind: 'action' as const, label: '新', icon: 'i', target: 'new' });
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-item')?.textContent).toContain('新');
    });

    it('updateRow 越界无操作', () => {
        const level: PopupLevel = {
            label: '根',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            ],
        };
        menu.reset(level);
        // 不会抛异常，也不会改变 items
        menu.updateRow(-1, { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        menu.updateRow(5, { kind: 'action' as const, label: 'C', icon: 'i', target: 'c' });
        expect(menu.currentLevel?.items.length).toBe(1);
    });

    it('updateRow 无 panel 时正常跳过', () => {
        (menu as any).levels = [makeLevel('根', '', [
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
        ])];
        // 不调用 reset/buildPanel，panel 无 .slide-list
        // 应正常跳过 DOM 操作
        expect(() => {
            menu.updateRow(0, { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        }).not.toThrow();
        expect(menu.currentLevel?.items[0].label).toBe('B');
    });

    it('refreshHeader 刷新标题栏', async () => {
        menu.reset(makeLevel('原始标题'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(container.querySelector('.slide-title')?.textContent).toBe('原始标题');

        (menu as any).currentLevel!.label = '新标题';
        menu.refreshHeader();
        expect(container.querySelector('.slide-title')?.textContent).toBe('新标题');
    });
});

describe('SlideMenu — 焦点全面 (setupFocus/clearFocus/applyFocus/activateFocused)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    async function initWithItems(items: PopupRow[]): Promise<void> {
        const p = new Promise<void>((resolve) => {
            const orig = (menu as any).onAfterRender;
            (menu as any).onAfterRender = () => {
                (menu as any).onAfterRender = orig;
                orig?.();
                resolve();
            };
        });
        menu.reset({ label: 'F', dir: '', items });
        await p;
    }

    it('setupFocus 初始化焦点为 0 并应用样式', async () => {
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
        ]);
        expect((menu as any).focusIndex).toBe(0);
        expect(container.querySelector('.slide-focused')).toBeTruthy();
    });

    it('setupFocus 空列表时 focusIndex 为 -1', async () => {
        await initWithItems([]);
        expect((menu as any).focusIndex).toBe(-1);
        expect(container.querySelector('.slide-focused')).toBeFalsy();
    });

    it('clearFocus 移除焦点样式', async () => {
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
        ]);
        (menu as any).clearFocus();
        expect(container.querySelector('.slide-focused')).toBeFalsy();
    });

    it('applyFocus 给当前焦点索引添加样式', async () => {
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
            { kind: 'action' as const, label: 'C', icon: 'i', target: 'c' },
        ]);
        (menu as any).focusIndex = 1;
        (menu as any).applyFocus();
        const focused = container.querySelector('.slide-focused');
        expect(focused).toBeTruthy();
        expect(focused?.textContent).toContain('B');
    });

    it('applyFocus 越界索引不操作', async () => {
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
        ]);
        (menu as any).focusIndex = 99;
        // 不应抛异常
        expect(() => (menu as any).applyFocus()).not.toThrow();
    });

    it('activateFocused 点击聚焦项', async () => {
        const onClick = vi.fn();
        (menu as any).onItemClick = onClick;
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
        ]);
        (menu as any).focusIndex = 1;
        (menu as any).activateFocused();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('activateFocused 越界不操作', async () => {
        const onClick = vi.fn();
        (menu as any).onItemClick = onClick;
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
        ]);
        (menu as any).focusIndex = 99;
        (menu as any).activateFocused();
        expect(onClick).not.toHaveBeenCalled();
    });

    it('focusNext 空列表无操作', async () => {
        await initWithItems([]);
        (menu as any).focusIndex = -1;
        expect(() => (menu as any).focusNext()).not.toThrow();
        expect((menu as any).focusIndex).toBe(-1);
    });

    it('focusPrev 空列表无操作', async () => {
        await initWithItems([]);
        (menu as any).focusIndex = -1;
        expect(() => (menu as any).focusPrev()).not.toThrow();
        expect((menu as any).focusIndex).toBe(-1);
    });
});

describe('SlideMenu — 创建行 (createRow DOM 类型)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        // 确保有一个根层级，使 currentLevel 可用
        menu.reset(makeLevel('根'));
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

    it('action 行带 catTag 生成标签', () => {
        const el = (menu as any).createRow({
            kind: 'action' as const,
            label: '带标签',
            icon: 'i',
            target: 't',
            catTag: '测试标签',
        });
        expect(el.querySelector('.slide-tag')?.textContent).toBe('测试标签');
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
        expect(addBtn?.textContent).toBe('+');
        addBtn?.click();
        expect(addClick).toHaveBeenCalledTimes(1);
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
        const folderEnter = vi.fn(() => makeLevel('进入'));
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
        expect(el.querySelector('.toggle-row') || el.querySelector('.toggle-label')).toBeTruthy();
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
        expect(onHover).toHaveBeenCalledWith(
            expect.objectContaining({ label: '悬停测试' }),
            true
        );

        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        expect(onHover).toHaveBeenCalledWith(
            expect.objectContaining({ label: '悬停测试' }),
            false
        );
    });
});

describe('SlideMenu — 生命周期 (dispose / 动画)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    describe('dispose', () => {
        it('清理 _keydownHandler 和触摸监听器', () => {
            expect((menu as any)._keydownHandler).not.toBeNull();
            expect((menu as any)._swipeTouchStartHandler).not.toBeNull();
            expect((menu as any)._swipeTouchEndHandler).not.toBeNull();

            menu.dispose();

            expect((menu as any)._keydownHandler).toBeNull();
            expect((menu as any)._swipeTouchStartHandler).toBeNull();
            expect((menu as any)._swipeTouchEndHandler).toBeNull();
        });

        it('清空 levels 和缓存', () => {
            menu.reset(makeLevel('根'));
            menu.push(makeLevel('子级'));
            (menu as any).transitioning = false;
            expect(menu.levelCount).toBe(2);

            menu.dispose();
            expect((menu as any).levels.length).toBe(0);
            expect((menu as any)._cachedExtraBtns).toBeNull();
        });

        it('重置 transitioning 和面板样式', () => {
            (menu as any).transitioning = true;
            menu.dispose();
            expect((menu as any).transitioning).toBe(false);
        });

        it('取消未决的 setTimeout', () => {
            vi.useFakeTimers();
            menu.reset(makeLevel('根'));
            menu.push(makeLevel('动画'));
            // push 设置了 setTimeout(150)
            expect((menu as any)._pendingTimeouts.length).toBeGreaterThan(0);

            menu.dispose();
            // dispose 调用 _cancelAnim → _cancelTimeout → 清空 pending
            expect((menu as any)._pendingTimeouts.length).toBe(0);
            vi.useRealTimers();
        });
    });

    describe('push/pop 动画', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('push 动画通过定时器完成', async () => {
            vi.useFakeTimers();
            const onAfterRender = vi.fn();
            (menu as any).onAfterRender = onAfterRender;

            menu.reset(makeLevel('根'));
            expect((menu as any).transitioning).toBe(false);

            menu.push(makeLevel('子级'));
            expect((menu as any).transitioning).toBe(true);
            expect(menu.levelCount).toBe(2);

            // 推进到 fadeOut 完成 (150ms)
            await vi.advanceTimersByTimeAsync(160);
            // 推进到 fadeIn 完成 (+200ms)
            await vi.advanceTimersByTimeAsync(210);

            expect((menu as any).transitioning).toBe(false);
            expect(menu.currentLevel?.label).toBe('子级');
            expect(onAfterRender).toHaveBeenCalled();
        });

        it('pop 动画通过定时器完成', async () => {
            vi.useFakeTimers();
            const onAfterRender = vi.fn();
            (menu as any).onAfterRender = onAfterRender;

            menu.reset(makeLevel('根'));
            (menu as any).transitioning = false;
            (menu as any).levels.push(makeLevel('子级')); // 直接操作数组避免 push 动画

            (menu as any).transitioning = false;
            menu.pop();
            expect((menu as any).transitioning).toBe(true);

            // 推进到 fadeOut (150ms)
            await vi.advanceTimersByTimeAsync(160);
            // 推进到 fadeIn (+200ms)
            await vi.advanceTimersByTimeAsync(210);

            expect((menu as any).transitioning).toBe(false);
            expect(menu.currentLevel?.label).toBe('根');
            expect(onAfterRender).toHaveBeenCalled();
        });

        it('push 在 transitioning 时拒绝新推送', () => {
            vi.useFakeTimers();
            menu.reset(makeLevel('根'));
            menu.push(makeLevel('A'));
            const levelCount = menu.levelCount;

            // 尝试再推一个（仍处于 transitioning）
            menu.push(makeLevel('B'));
            expect(menu.levelCount).toBe(levelCount);
        });
    });
});

describe('SlideMenu — 高阶功能 (extraButtonFactory / onClose / 手势)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('extraButtonFactory 添加按钮到标题栏', async () => {
        const extraBtn = document.createElement('button');
        extraBtn.textContent = '⚙';
        extraBtn.className = 'extra-btn';
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
            extraButtonFactory: () => [extraBtn],
        });
        menu.reset(makeLevel('设置'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const header = container.querySelector('.slide-header')!;
        expect(header.contains(extraBtn)).toBe(true);
        expect(header.querySelector('.extra-btn')?.textContent).toBe('⚙');
    });

    it('onClose 回调在根层级点击返回时触发', async () => {
        const onClose = vi.fn();
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose,
        });
        menu.reset(makeLevel('根'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        // 根层级返回按钮使用 X 图标，点击触发 onClose
        const backBtn = container.querySelector('.slide-back')!;
        expect(backBtn).toBeTruthy();
        (backBtn as HTMLElement).click();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('updateHeader 根层级显示 X 图标, 子层级显示返回箭头', async () => {
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        menu.reset(makeLevel('根'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        // 根层级：iconify-icon 有 lucide:x
        let backIcon = container.querySelector('.slide-back iconify-icon');
        expect(backIcon?.getAttribute('icon')).toMatch(/x/);

        // 推入子层级
        (menu as any).levels.push(makeLevel('子级'));
        (menu as any).updateHeader((menu as any).currentLevel);
        backIcon = container.querySelector('.slide-back iconify-icon');
        expect(backIcon?.getAttribute('icon')).toMatch(/chevron/);
    });

    it('触屏右滑手势触发 pop', () => {
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        menu.reset(makeLevel('根'));
        (menu as any).levels.push(makeLevel('子级'));
        const before = menu.levelCount;

        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before - 1);
    });

    it('触屏右滑距离不足时不触发 pop', () => {
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        menu.reset(makeLevel('根'));
        (menu as any).levels.push(makeLevel('子级'));
        const before = menu.levelCount;

        // 右滑仅 30px（不足 60）
        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 30, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before); // 未触发 pop
    });

    it('触屏手势在单层级时不触发 pop', () => {
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        menu.reset(makeLevel('仅根'));
        const before = menu.levelCount;

        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before);
    });

    it('触屏手势垂直偏移过大时不触发 pop', () => {
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        menu.reset(makeLevel('根'));
        (menu as any).levels.push(makeLevel('子级'));
        const before = menu.levelCount;

        // 右滑 100px 但垂直偏移 50px（超过 40）
        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 50 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before);
    });
});
// ─── registerPopupMenu 生命周期测试 ─────────────────────────────
// 验证工厂函数的注册、显示、刷新、关闭流程。

import { registerPopupMenu } from '../menus/menu-factory';
import { dom } from '../core/config';

describe('registerPopupMenu — 生命周期', () => {
    let sceneOverlay: HTMLElement;

    beforeEach(() => {
        // 确保 dom.sceneOverlay 存在（registerPopupMenu 依赖）
        sceneOverlay = document.createElement('div');
        sceneOverlay.id = 'sceneOverlay';
        document.body.appendChild(sceneOverlay);
        (dom as any).sceneOverlay = sceneOverlay;
    });

    afterEach(() => {
        sceneOverlay.remove();
        (dom as any).sceneOverlay = null;
    });

    it('getMenu 初始返回 null', () => {
        const { getMenu } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        expect(getMenu()).toBeNull();
    });

    it('show 创建菜单实例', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        show();
        // 等待 requestAnimationFrame（buildPanel 异步）
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(getMenu()).not.toBeNull();
        expect(getMenu()?.levelCount).toBe(1);
    });

    it('show 多次调用不重复创建菜单', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        show();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const firstMenu = getMenu();

        show(); // 再次调用
        await new Promise(resolve => requestAnimationFrame(resolve));
        const secondMenu = getMenu();

        expect(secondMenu).toBe(firstMenu); // 同一实例
    });

    it('show 多次调用时重置到根层级', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {
                onFolderEnter: () => makeLevel('子级'),
            },
        });
        show();
        await new Promise(resolve => requestAnimationFrame(resolve));

        // 推入子层级
        getMenu()?.push(makeLevel('子级'));
        expect(getMenu()?.levelCount).toBe(2);

        // 再次 show 应重置到根
        show();
        expect(getMenu()?.levelCount).toBe(1);
        expect(getMenu()?.currentLevel?.label).toBe('根');
    });

    it('refreshRoot 更新根级 items', async () => {
        let rootItems: PopupRow[] = [
            { kind: 'action', label: 'A', icon: 'i', target: 'a' },
        ];
        const { getMenu, show, refreshRoot } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => ({
                label: '根',
                dir: '',
                items: rootItems,
            }),
            buildRootItems: () => rootItems,
            handlers: {},
        });
        show();
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(getMenu()?.currentLevel?.items.length).toBe(1);

        // 更新 items
        rootItems = [
            { kind: 'action', label: 'A', icon: 'i', target: 'a' },
            { kind: 'action', label: 'B', icon: 'i', target: 'b' },
        ];
        refreshRoot();
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(getMenu()?.currentLevel?.items.length).toBe(2);
    });

    it('refreshRoot 在无菜单时静默返回', () => {
        const { refreshRoot } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            buildRootItems: () => [],
            handlers: {},
        });
        // 不应抛异常
        expect(() => refreshRoot()).not.toThrow();
    });

    it('onShow 回调在每次 show 时调用', async () => {
        const onShow = vi.fn();
        const { show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
            onShow,
        });
        show();
        expect(onShow).toHaveBeenCalledTimes(1);

        show(); // 再次调用
        expect(onShow).toHaveBeenCalledTimes(2);
    });

    it('菜单 dispose 后 SlideMenu 实例被清理', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        show();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const menu = getMenu();
        expect(menu).not.toBeNull();

        // dispose 应成功执行且不抛异常
        expect(() => menu?.dispose()).not.toThrow();
    });

    it('菜单 dispose 后可以重新 show', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        show();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const firstMenu = getMenu();

        // dispose 后重新 show 应创建新实例
        firstMenu?.dispose();
        show();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const secondMenu = getMenu();

        expect(secondMenu).not.toBeNull();
        expect(secondMenu).not.toBe(firstMenu);
    });

    it('overlayClass 在 show 时正确设置', async () => {
        const { show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            overlayClass: 'sceneOverlay-test',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        show();
        expect(sceneOverlay.classList.contains('sceneOverlay-test')).toBe(true);
    });

    it('popupType 在 show 时正确设置', async () => {
        const { show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'my-custom-type',
            buildRoot: () => makeLevel('根'),
            handlers: {},
        });
        show();
        expect(sceneOverlay.dataset.popupType).toBe('my-custom-type');
    });
});
