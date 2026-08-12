// ui-helpers 系列合并（bone/layout/slide-toggle/slider 4 文件 → 1）
// [2026-08] 同系列合并以省 isolate 单文件 import 成本（vitest.config 同款先例）。
// 4 文件结构完全同构：相同 vi.mock('../core/icons') + 相同 beforeEach（mockIconify
// mockReset + 默认返回 span）+ 顶层 beforeAll 预填语言包（addBoneSelectRow 断言
// '左足IK (IK)' 依赖 zh-CN bundle），共享样板原在 4 文件重复 4 份，现收敛为一份。
// 各 describe 按原主题分区保留，行为不变。
import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';

// Mock createIconifyIcon so tests control whether it returns an element or null
vi.mock('../core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));

import { createIconifyIcon } from '../core/icons';
import {
    isIkBone,
    buildBoneGroups,
    addBoneSelectRow,
    addCollapsible,
    addPresetChip,
    addSectionTitle,
    addModeRow,
    slideRow,
    addToggleRow,
    toggleRow as toggleRowFn,
    addSliderRow,
    sliderRow as sliderRowFn,
} from '../core/ui-helpers';
import { addColorSliderRow, addVector3SliderRow, addModeSlider } from '../core/ui-advanced-rows';
import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';

// [doc:perf] 语言包改为运行时加载，测试环境直接预填缓存
beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

const mockIconify = vi.mocked(createIconifyIcon);

beforeEach(() => {
    mockIconify.mockReset();
    // By default, createIconifyIcon returns a valid element
    mockIconify.mockReturnValue(document.createElement('span'));
});

// ======== 骨骼选择（原 ui-helpers.bone.test.ts） ========
describe('isIkBone', () => {
    it('returns true for known IK bone names', () => {
        expect(isIkBone('左足IK')).toBe(true);
        expect(isIkBone('右足首')).toBe(true);
        expect(isIkBone('左ひざ')).toBe(true);
    });
    it('returns true for names ending with IK suffix', () => {
        expect(isIkBone('カスタムIK')).toBe(true);
    });
    it('returns false for non-IK bones', () => {
        expect(isIkBone('上半身')).toBe(false);
        expect(isIkBone('左腕')).toBe(false);
    });
    it('returns false for empty string', () => {
        expect(isIkBone('')).toBe(false);
    });
});

describe('buildBoneGroups', () => {
    it('groups known bones, collects unknown into その他, drops empty groups', () => {
        const groups = buildBoneGroups(['上半身', '左足IK', '首', '未知骨']);
        const groupMap = new Map(groups);
        expect(groupMap.get('上半身')).toEqual(['上半身', '首']);
        expect(groupMap.get('下半身')).toEqual(['左足IK']);
        expect(groupMap.get('その他')).toEqual(['未知骨']);
        // 空组被剔除
        expect(groupMap.has('左腕')).toBe(false);
    });

    it('matches bones by prefix (e.g. 上半身2 in 上半身 group)', () => {
        const groups = buildBoneGroups(['上半身2', '左腕ねじれ']);
        const groupMap = new Map(groups);
        expect(groupMap.get('上半身')).toEqual(['上半身2']);
        expect(groupMap.get('左腕')).toEqual(['左腕ねじれ']);
    });

    it('empty input yields only その他 as empty which is dropped', () => {
        const groups = buildBoneGroups([]);
        expect(groups.length).toBe(0);
    });
});

describe('addBoneSelectRow', () => {
    it('renders grouped select with IK tag on IK bones; change fires onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        const select = addBoneSelectRow(
            container,
            '骨骼',
            ['上半身', '左足IK', '左腕'],
            '上半身',
            onChange
        );
        expect(select.tagName).toBe('SELECT');
        // 分组存在
        const optgroups = select.querySelectorAll('optgroup');
        expect(optgroups.length).toBeGreaterThanOrEqual(2);
        // IK 骨骼选项文本带 (IK) 标记
        const ikOpt = select.querySelector('option[value="左足IK"]')!;
        expect(ikOpt.textContent).toBe('左足IK (IK)');
        // 非 IK 骨骼无标记
        const normalOpt = select.querySelector('option[value="上半身"]')!;
        expect(normalOpt.textContent).toBe('上半身');
        // 初始值
        expect(select.value).toBe('上半身');
        // change 事件
        select.value = '左足IK';
        select.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith('左足IK');
    });

    it('hides label when label is empty string', () => {
        const container = document.createElement('div');
        addBoneSelectRow(container, '', ['上半身'], '上半身', () => {});
        expect(container.querySelectorAll('.cs-label').length).toBe(0);
    });

    it('search input filters options by text content', () => {
        const container = document.createElement('div');
        const select = addBoneSelectRow(
            container,
            '',
            ['上半身', '左腕', '右腕'],
            '上半身',
            () => {}
        );
        const search = container.querySelector('input')!;
        // 输入"左"→ 左腕显示、右腕隐藏
        search.value = '左';
        search.dispatchEvent(new Event('input'));
        const leftOpt = select.querySelector('option[value="左腕"]') as HTMLElement;
        const rightOpt = select.querySelector('option[value="右腕"]') as HTMLElement;
        expect(leftOpt.style.display).toBe('');
        expect(rightOpt.style.display).toBe('none');
    });

    it('search clear restores all options to visible', () => {
        const container = document.createElement('div');
        const select = addBoneSelectRow(
            container,
            '',
            ['上半身', '左足IK', '右腕'],
            '上半身',
            () => {}
        );
        const search = container.querySelector('input')!;
        // 先过滤
        search.value = '左';
        search.dispatchEvent(new Event('input'));
        // 再清空
        search.value = '';
        search.dispatchEvent(new Event('input'));

        const leftOpt = select.querySelector('option[value="左足IK"]') as HTMLElement;
        const rightOpt = select.querySelector('option[value="右腕"]') as HTMLElement;
        expect(leftOpt.style.display).toBe('');
        expect(rightOpt.style.display).toBe('');
    });

    it('empty boneNames produces no optgroups', () => {
        const container = document.createElement('div');
        const select = addBoneSelectRow(container, '骨骼', [], 'none', () => {});
        expect(select.querySelectorAll('optgroup').length).toBe(0);
    });

    it('uses custom searchPlaceholder from opts', () => {
        const container = document.createElement('div');
        addBoneSelectRow(
            container,
            '骨骼',
            ['上半身'],
            '上半身',
            () => {},
            { searchPlaceholder: '自定义搜索...' }
        );
        const search = container.querySelector('input')!;
        expect(search.placeholder).toBe('自定义搜索...');
    });

    it('applies testId to wrapper', () => {
        const container = document.createElement('div');
        addBoneSelectRow(
            container,
            '骨骼',
            ['上半身'],
            '上半身',
            () => {},
            { testId: 'bone-select-test' }
        );
        const wrapper = container.querySelector('[data-testid="bone-select-test"]')!;
        expect(wrapper).not.toBeNull();
    });
});

// ======== 布局块（原 ui-helpers.layout.test.ts） ========
describe('addCollapsible', () => {
    it('creates collapsible with title and calls renderContent', () => {
        const container = document.createElement('div');
        const renderContent = vi.fn((inner: HTMLElement) => {
            inner.textContent = 'panel content';
        });

        addCollapsible(container, {
            title: 'Advanced',
            icon: 'settings',
            renderContent,
        });

        const wrapper = container.querySelector('.collapsible-wrapper')!;
        expect(wrapper).not.toBeNull();

        const header = wrapper.querySelector('.collapsible-header')!;
        expect(header.querySelector('.collapsible-label')!.textContent).toBe('Advanced');

        expect(renderContent).toHaveBeenCalledTimes(1);

        const panel = wrapper.querySelector('.collapsible-panel')!;
        expect(panel.querySelector('.collapsible-inner')!.textContent).toBe('panel content');
    });

    it('header click toggles panel open/closed', () => {
        const container = document.createElement('div');
        addCollapsible(container, {
            title: 'Toggle Test',
            renderContent: (inner) => {
                inner.textContent = 'content';
            },
        });

        const header = container.querySelector('.collapsible-header')!;
        const panel = container.querySelector<HTMLElement>('.collapsible-panel')!;

        // Initially closed (defaultOpen is undefined = false)
        expect(panel.classList.contains('open')).toBe(false);

        // Click to open
        (header as HTMLElement).click();
        expect(panel.classList.contains('open')).toBe(true);

        // Click to close
        (header as HTMLElement).click();
        expect(panel.classList.contains('open')).toBe(false);
    });

    it('with headerToggle fires onChange when toggle is clicked', () => {
        const container = document.createElement('div');
        const onToggle = vi.fn();
        addCollapsible(container, {
            title: 'Settings',
            headerToggle: { value: true, onChange: onToggle },
            renderContent: (inner) => {
                inner.textContent = 'content';
            },
        });

        const toggle = container.querySelector('.toggle.header-toggle')!;
        (toggle as HTMLElement).click();

        expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('openWhen: true auto-opens panel', () => {
        const container = document.createElement('div');
        addCollapsible(container, {
            title: 'Auto Open',
            openWhen: true,
            renderContent: (inner) => {
                inner.textContent = 'content';
            },
        });

        const panel = container.querySelector<HTMLElement>('.collapsible-panel')!;
        // openWhen=true 会在 requestAnimationFrame 中展开
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                expect(panel.style.maxHeight).not.toBe('0');
                resolve();
            });
        });
    });

    it('keyboard Enter toggles panel', () => {
        const container = document.createElement('div');
        addCollapsible(container, {
            title: 'Keyboard Test',
            renderContent: (inner) => {
                inner.textContent = 'content';
            },
        });

        const header = container.querySelector('.collapsible-header')!;
        const panel = container.querySelector<HTMLElement>('.collapsible-panel')!;

        // Initially closed
        expect(panel.style.maxHeight).toBe('0');

        // Press Enter to open
        header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(panel.style.maxHeight).not.toBe('0');

        // Press Enter to close
        header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(panel.style.maxHeight).toBe('0');
    });
});

describe('addPresetChip', () => {
    it('creates chip; active state adds active class', () => {
        const container = document.createElement('div');
        const chip = addPresetChip(container, 'Preset A', true, vi.fn());

        expect(chip.classList.contains('preset-chip')).toBe(true);
        expect(chip.classList.contains('active')).toBe(true);
        expect(chip.textContent).toBe('Preset A');

        // Not active
        const chip2 = addPresetChip(container, 'Preset B', false, vi.fn());
        expect(chip2.classList.contains('active')).toBe(false);
    });

    it('click handler fires', () => {
        const container = document.createElement('div');
        const onClick = vi.fn();
        const chip = addPresetChip(container, 'Chip', false, onClick);
        chip.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('addSectionTitle', () => {
    it('adds a section-title div with correct text', () => {
        const container = document.createElement('div');
        addSectionTitle(container, 'Section Header');

        const title = container.querySelector('.section-title')!;
        expect(title).not.toBeNull();
        expect(title.textContent).toBe('Section Header');
    });
});

describe('addModeRow', () => {
    it('creates mode buttons; active button has active class', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeRow(
            container,
            'Mode',
            [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
                { value: 'c', label: 'C' },
            ],
            'b',
            onChange
        );

        const btns = container.querySelectorAll('.mode-btn');
        expect(btns.length).toBe(3);
        expect(btns[0].textContent).toBe('A');
        expect(btns[1].textContent).toBe('B');
        expect(btns[2].textContent).toBe('C');

        // 'b' is active
        expect(btns[1].classList.contains('active')).toBe(true);
        expect(btns[0].classList.contains('active')).toBe(false);

        // Click button 'c'
        (btns[2] as HTMLButtonElement).click();
        expect(onChange).toHaveBeenCalledWith('c');
    });
});

// ======== 滑动行 + 开关行（原 ui-helpers.slide-toggle.test.ts） ========
describe('slideRow', () => {
    it('creates slide-item with icon, label, and arrow', () => {
        const container = document.createElement('div');
        const onClick = vi.fn();
        slideRow(container, 'icon-name', 'My Label', true, onClick);

        const row = container.querySelector('.slide-item')!;
        expect(row).not.toBeNull();

        const iconSpan = row.querySelector('.slide-icon')!;
        expect(iconSpan).not.toBeNull();

        const labelSpan = row.querySelector('.slide-label')!;
        expect(labelSpan.textContent).toBe('My Label');

        const arrowSpan = row.querySelector('.slide-arrow')!;
        expect(arrowSpan.textContent).toBe('>');

        expect(mockIconify).toHaveBeenCalledWith('icon-name');
    });

    it('includes sublabel when provided', () => {
        const container = document.createElement('div');
        const onClick = vi.fn();
        slideRow(container, 'icon', 'Label', false, onClick, 'sub');

        const row = container.querySelector('.slide-item')!;
        const subEl = row.querySelector('.slide-sublabel')!;
        expect(subEl.textContent).toBe('sub');
    });

    it('creates collapsible-header structure when headerToggle is provided', () => {
        const container = document.createElement('div');
        const onClick = vi.fn();
        const onToggle = vi.fn();
        slideRow(container, 'icon', 'My Label', true, onClick, undefined, undefined, undefined, {
            value: true,
            onChange: onToggle,
        });

        const header = container.querySelector('.collapsible-header')!;
        expect(header).not.toBeNull();

        const labelSpan = header.querySelector('.collapsible-label')!;
        expect(labelSpan.textContent).toBe('My Label');

        const toggle = header.querySelector('.toggle.header-toggle')!;
        expect(toggle).not.toBeNull();

        const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);

        const arrowSpan = header.querySelector('.collapsible-arrow')!;
        expect(arrowSpan.textContent).toBe('▾');
    });

    it('calls onDisabledClick when headerToggle is disabled and toggle is clicked', () => {
        const container = document.createElement('div');
        const onClick = vi.fn();
        const onDisabledClick = vi.fn();
        slideRow(container, 'icon', 'Label', false, onClick, undefined, undefined, undefined, {
            value: true,
            onChange: vi.fn(),
            disabled: true,
            disabledHint: 'Nope',
            onDisabledClick,
        });

        const header = container.querySelector('.collapsible-header')!;
        const toggle = header.querySelector('.toggle')!;
        expect(toggle.classList.contains('toggle-disabled')).toBe(true);

        (toggle as HTMLElement).click();
        expect(onDisabledClick).toHaveBeenCalled();
    });

    it('shows icon fallback when createIconifyIcon returns null', () => {
        mockIconify.mockReturnValue(null);

        const container = document.createElement('div');
        const onClick = vi.fn();
        slideRow(container, 'icon-name', 'My Label', false, onClick);

        const row = container.querySelector('.slide-item')!;
        const fallback = row.querySelector('.cs-icon-fallback')!;
        expect(fallback).not.toBeNull();
        expect(fallback.textContent).toBe('M');
    });
});

describe('addToggleRow', () => {
    it('creates toggle-row with label and checkbox reflecting initial state', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addToggleRow(container, 'Enable X', true, onChange);

        const row = container.querySelector('.toggle-row')!;
        expect(row).not.toBeNull();

        const labelSpan = row.querySelector('.toggle-label')!;
        expect(labelSpan.textContent).toBe('Enable X');

        const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        expect(checkbox.getAttribute('role')).toBe('switch');
        expect(checkbox.getAttribute('aria-label')).toBe('Enable X');
    });

    it('shows icon fallback when createIconifyIcon returns null', () => {
        mockIconify.mockReturnValue(null);

        const container = document.createElement('div');
        addToggleRow(container, 'Test', false, vi.fn(), 'some-icon');

        const fallback = container.querySelector('.cs-icon-fallback')!;
        expect(fallback).not.toBeNull();
        expect(fallback.textContent).toBe('T');
    });

    it('row click toggles the checkbox and fires onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addToggleRow(container, 'Toggle', false, onChange);

        const row = container.querySelector('.toggle-row')!;
        // Click the row (not the toggle label) to trigger the row-level handler
        const left = row.querySelector('.toggle-left')!;
        (left as HTMLElement).click();

        const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true);
    });
});

describe('toggleRow', () => {
    it('calls onChange and onSave when toggled', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        const onSave = vi.fn();
        toggleRowFn(container, 'Option', false, 'icon', onChange, onSave);

        const row = container.querySelector('.toggle-row')!;
        const left = row.querySelector('.toggle-left')!;
        (left as HTMLElement).click();

        expect(onChange).toHaveBeenCalledWith(true);
        expect(onSave).toHaveBeenCalled();
    });
});

// ======== 滑块系（原 ui-helpers.slider.test.ts） ========
describe('addSliderRow', () => {
    it('creates slider with correct structure, display, and aria attributes', () => {
        const container = document.createElement('div');
        addSliderRow(container, 'Brightness', 0.5, 0, 1, 0.01, vi.fn());

        const row = container.querySelector('.cs-row')!;
        expect(row).not.toBeNull();

        const labelEl = row.querySelector('.cs-label')!;
        expect(labelEl.textContent).toBe('Brightness');

        const valueEl = row.querySelector('.cs-value')!;
        expect(valueEl.textContent).toBe('0.50');

        const bar = row.querySelector('.cs-bar')!;
        expect(bar.getAttribute('role')).toBe('slider');
        expect(bar.getAttribute('aria-valuenow')).toBe('0.5');
        expect(bar.getAttribute('aria-valuemin')).toBe('0');
        expect(bar.getAttribute('aria-valuemax')).toBe('1');
    });

    it('click (mousedown + mouseup) on bar fires onChange with computed value', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 0, 0, 100, 1, onChange);

        const bar = container.querySelector('.cs-bar')! as HTMLDivElement;
        // Mock getBoundingClientRect for a deterministic click position
        bar.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 200,
                top: 0,
                height: 20,
                right: 200,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // 真实交互序列：mousedown 在 bar 上初始化 dragRect，mouseup 在 document 上触发跳转
        bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 50 }));
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 50 }));
        // clientX=50 on width=200 → x=0.25 → 0 + 0.25*100 = 25
        expect(onChange).toHaveBeenCalledWith(25);
    });

    it('keyboard ArrowRight increases the value', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 50, 0, 100, 1, onChange);

        const bar = container.querySelector('.cs-bar')!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(onChange).toHaveBeenCalledWith(51);
    });

    it('keyboard Home jumps to minimum', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 75, 0, 100, 1, onChange);

        const bar = container.querySelector('.cs-bar')!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it('keyboard End jumps to maximum', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 10, 0, 100, 1, onChange);

        const bar = container.querySelector('.cs-bar')!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it('keyboard ArrowLeft decreases the value', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 50, 0, 100, 1, onChange);

        const bar = container.querySelector('.cs-bar')!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        expect(onChange).toHaveBeenCalledWith(49);
    });

    it('ctrl+ArrowRight uses 100x step multiplier', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 0, 0, 1000, 1, onChange);

        const bar = container.querySelector('.cs-bar')!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true }));
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it('shift+ArrowRight uses 10x step multiplier', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 0, 0, 1000, 1, onChange);

        const bar = container.querySelector('.cs-bar')!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
        expect(onChange).toHaveBeenCalledWith(10);
    });

    it('cs-top leftmost quarter clicks large negative step', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 50, 0, 100, 1, onChange);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

        // 左 1/4 区域: delta = -(range * LARGE_STEP)
        top.dispatchEvent(new MouseEvent('click', { clientX: 10 }));
        expect(onChange).toHaveBeenCalled();
        // LARGE_STEP=0.15 → delta = -15 → 50 - 15 = 35
        expect(onChange).toHaveBeenCalledWith(35);
    });

    it('cs-top rightmost quarter clicks large positive step', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 50, 0, 100, 1, onChange);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

        // 右 1/4 区域: delta = range * LARGE_STEP
        top.dispatchEvent(new MouseEvent('click', { clientX: 190 }));
        // LARGE_STEP=0.15 → delta = +15 → 50 + 15 = 65
        expect(onChange).toHaveBeenCalledWith(65);
    });

    it('cs-top left-mid quarter clicks small negative step', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 50, 0, 100, 1, onChange);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

        // 左 2/4 区域 (25%-50%): delta = -(range * SMALL_STEP) = -5
        top.dispatchEvent(new MouseEvent('click', { clientX: 60 }));
        expect(onChange).toHaveBeenCalledWith(45);
    });

    it('cs-top right-mid quarter clicks small positive step', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addSliderRow(container, 'Test', 50, 0, 100, 1, onChange);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

        // 右 2/4 区域 (50%-75%): delta = range * SMALL_STEP = +5
        top.dispatchEvent(new MouseEvent('click', { clientX: 120 }));
        expect(onChange).toHaveBeenCalledWith(55);
    });

    it('defends against NaN initial value by falling back to min', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        expect(() => {
            addSliderRow(container, 'Test', NaN, 0, 100, 1, onChange);
        }).not.toThrow();
        const val = container.querySelector('.cs-value')!;
        expect(val.textContent).toBe('0');
    });
});

describe('sliderRow', () => {
    it('calls onChange on drag end with correct value', () => {
        const container = document.createElement('div');
        const onDragEnd = vi.fn();
        sliderRowFn(container, 'Volume', 50, 0, 100, 1, 'icon', onDragEnd);

        // Click on bar — the simplified version has empty real-time onChange,
        // so only onDragEnd is called by the click handler's onDragEndCb path.
        const bar = container.querySelector('.cs-bar')! as HTMLDivElement;
        bar.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 100,
                top: 0,
                height: 20,
                right: 100,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        // 真实交互序列：mousedown(bar) 初始化 dragRect，mouseup(document) 触发 onDragEnd
        bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 80 }));
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 80 }));

        expect(onDragEnd).toHaveBeenCalled();
    });

    it('cs-top quarter-step click calls onDragEnd', () => {
        // 验证 cs-top 四分区域点击也会触发 onDragEnd（修复后应通过）
        const container = document.createElement('div');
        const onDragEnd = vi.fn();
        sliderRowFn(container, 'Volume', 5, 0, 10, 1, 'icon', onDragEnd);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 200,
                top: 0,
                height: 20,
                right: 200,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // 右半区 click → 正方向大步（range * SLIDER_QUARTER_LARGE_STEP）
        top.dispatchEvent(new MouseEvent('click', { clientX: 190 }));
        expect(onDragEnd).toHaveBeenCalled();
    });
});

describe('addColorSliderRow', () => {
    it('creates one clr-row per channel with a cs-bar', () => {
        const container = document.createElement('div');
        addColorSliderRow(container, 'Color', [0.2, 0.5, 0.8], vi.fn());

        const block = container.querySelector('.clr-block')!;
        expect(block).not.toBeNull();
        expect(block.querySelectorAll('.clr-row').length).toBe(3);
        expect(block.querySelectorAll('.cs-bar').length).toBe(3);
    });

    it('drag on R channel updates red value via onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addColorSliderRow(container, 'Color', [0.2, 0.5, 0.8], onChange);

        const bar = container.querySelectorAll('.clr-row .cs-bar')[0] as HTMLDivElement;
        bar.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 200,
                top: 0,
                height: 20,
                right: 200,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // clientX=0 → x=0 → 0；拖拽序列 mousedown(bar) + mouseup(document)
        bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 0 }));

        expect(onChange).toHaveBeenCalled();
        const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(last.length).toBe(3);
        expect(last[0]).toBeCloseTo(0);
    });

    it('defends against NaN channel values without crashing (fallback to 0)', () => {
        // 与 addSliderRow 的非有限值防御对齐：NaN 通道回落到 0，不渲染 "NaN"
        const container = document.createElement('div');
        const onChange = vi.fn();
        expect(() => {
            addColorSliderRow(container, 'Color', [NaN, 0.5, 0.8], onChange);
        }).not.toThrow();
        const vals = container.querySelectorAll('.clr-value');
        expect(vals[0].textContent).toBe('0.00');
        expect(vals[1].textContent).toBe('0.50');
        expect(vals[2].textContent).toBe('0.80');
    });
});

describe('addVector3SliderRow', () => {
    it('creates 3 vec3-rows with cs-bar', () => {
        const container = document.createElement('div');
        addVector3SliderRow(container, 'Pos', [0, 0, 0], -100, 100, 1, vi.fn());

        const block = container.querySelector('.vec3-block')!;
        expect(block.querySelectorAll('.vec3-row').length).toBe(3);
        expect(block.querySelectorAll('.cs-bar').length).toBe(3);
    });

    it('drag on X axis jumps to max via onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addVector3SliderRow(container, 'Pos', [0, 0, 0], -100, 100, 1, onChange);

        const bar = container.querySelectorAll('.vec3-row .cs-bar')[0] as HTMLDivElement;
        bar.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 200,
                top: 0,
                height: 20,
                right: 200,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // clientX=200 → x=1 → -100 + 1*200 = 100
        bar.dispatchEvent(new MouseEvent('mousedown', { clientX: 200 }));
        document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200 }));

        expect(onChange).toHaveBeenCalled();
        const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(last[0]).toBe(100);
    });

    it('keyboard ArrowRight increases X by step', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addVector3SliderRow(container, 'Pos', [10, 0, 0], 0, 100, 1, onChange);

        const bar = container.querySelectorAll('.vec3-row .cs-bar')[0]!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

        const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(last[0]).toBe(11);
    });

    it('keyboard ArrowLeft decreases X by step', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addVector3SliderRow(container, 'Pos', [10, 0, 0], 0, 100, 1, onChange);

        const bar = container.querySelectorAll('.vec3-row .cs-bar')[0]!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

        const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(last[0]).toBe(9);
    });

    it('keyboard Home jumps X to minimum', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addVector3SliderRow(container, 'Pos', [50, 0, 0], 0, 100, 1, onChange);

        const bar = container.querySelectorAll('.vec3-row .cs-bar')[0]!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));

        const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(last[0]).toBe(0);
    });

    it('keyboard End jumps X to maximum', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addVector3SliderRow(container, 'Pos', [50, 0, 0], 0, 100, 1, onChange);

        const bar = container.querySelectorAll('.vec3-row .cs-bar')[0]!;
        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));

        const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(last[0]).toBe(100);
    });

    it('defends against NaN axis values without crashing (fallback to min)', () => {
        // 与 addSliderRow 的非有限值防御对齐：NaN 轴回落到 min，不渲染 "NaN"
        const container = document.createElement('div');
        const onChange = vi.fn();
        expect(() => {
            addVector3SliderRow(container, 'Pos', [NaN, 0, 0], 0, 100, 1, onChange);
        }).not.toThrow();
        const vals = container.querySelectorAll('.vec3-value');
        expect(vals[0].textContent).toBe('0');
        expect(vals[1].textContent).toBe('0');
        expect(vals[2].textContent).toBe('0');
    });
});

describe('addModeSlider', () => {
    const opts = [
        { value: 'low', label: 'Low' },
        { value: 'mid', label: 'Mid' },
        { value: 'high', label: 'High' },
    ];

    it('creates cs-row with cs-bar and shows current label', () => {
        const container = document.createElement('div');
        addModeSlider(container, 'Mode', opts, 'mid', vi.fn());

        const row = container.querySelector('.cs-row')!;
        expect(row).not.toBeNull();
        expect(row.querySelector('.cs-bar')).not.toBeNull();
        expect(row.querySelector('.cs-value')!.textContent).toBe('Mid');
    });

    // ADR-140 后 7e8346fd 改为 cs-top 半区相对步进：左半 −1 / 右半 +1（非绝对位置映射）
    it('click on right half cycles to next option via onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeSlider(container, 'Mode', opts, 'low', onChange);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 200,
                top: 0,
                height: 20,
                right: 200,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // clientX=200 → x=1（右半）→ cycleIdx(+1)：'low' → 'mid'
        top.dispatchEvent(new MouseEvent('click', { clientX: 200 }));

        expect(onChange).toHaveBeenCalledWith('mid');
    });

    it('click on left half cycles to previous option via onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeSlider(container, 'Mode', opts, 'high', onChange);

        const top = container.querySelector('.cs-top')! as HTMLDivElement;
        top.getBoundingClientRect = () =>
            ({
                left: 0,
                width: 200,
                top: 0,
                height: 20,
                right: 200,
                bottom: 20,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // clientX=0 → x=0（左半）→ cycleIdx(−1)：'high' → 'mid'
        top.dispatchEvent(new MouseEvent('click', { clientX: 0 }));

        expect(onChange).toHaveBeenCalledWith('mid');
    });

    it('keyboard ArrowRight moves to next option', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeSlider(container, 'Mode', opts, 'low', onChange);

        const top = container.querySelector('.cs-top')!;
        top.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

        expect(onChange).toHaveBeenCalledWith('mid');
    });

    it('keyboard ArrowLeft moves to previous option', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeSlider(container, 'Mode', opts, 'mid', onChange);

        const top = container.querySelector('.cs-top')!;
        top.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

        expect(onChange).toHaveBeenCalledWith('low');
    });

    it('keyboard at minimum boundary does not cycle below 0', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeSlider(container, 'Mode', opts, 'low', onChange);

        const top = container.querySelector('.cs-top')!;
        top.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

        // Should not change (already at index 0)
        expect(onChange).not.toHaveBeenCalled();
    });

    it('empty options returns early without crash', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        expect(() => {
            addModeSlider(container, 'Empty', [], 'x' as string, onChange);
        }).not.toThrow();
        // No DOM appended
        expect(container.children.length).toBe(0);
    });

    it('single option shows 100% fill and does not cycle', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        const singleOpt = [{ value: 'only', label: 'Only' }];
        addModeSlider(container, 'Single', singleOpt, 'only', onChange);

        const fill = container.querySelector('.cs-fill') as HTMLElement;
        expect(fill.style.width).toBe('100%');

        const top = container.querySelector('.cs-top')!;
        top.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('currentValue not in options falls back to first', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        addModeSlider(container, 'Mode', opts, 'unknown' as string, onChange);

        const val = container.querySelector('.cs-value')!;
        expect(val.textContent).toBe('Low');
    });
});
