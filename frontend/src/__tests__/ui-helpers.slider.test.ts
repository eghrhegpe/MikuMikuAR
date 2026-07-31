// ui-helpers 拆分 — addSliderRow / sliderRow / addColorSliderRow / addVector3SliderRow / addModeSlider（滑块系）
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock createIconifyIcon so tests control whether it returns an element or null
vi.mock('../core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));

import { createIconifyIcon } from '../core/icons';
import { addSliderRow, sliderRow as sliderRowFn } from '../core/ui-helpers';
import { addColorSliderRow, addVector3SliderRow, addModeSlider } from '../core/ui-advanced-rows';

const mockIconify = vi.mocked(createIconifyIcon);

beforeEach(() => {
    mockIconify.mockReset();
    // By default, createIconifyIcon returns a valid element
    mockIconify.mockReturnValue(document.createElement('span'));
});

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
});
