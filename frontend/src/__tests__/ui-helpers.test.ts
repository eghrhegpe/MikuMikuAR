import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock createIconifyIcon so tests control whether it returns an element or null
vi.mock('../core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));

import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addCollapsible,
    addPresetChip,
    addSectionTitle,
    addModeRow,
    sliderRow as sliderRowFn,
    toggleRow as toggleRowFn,
} from '../core/ui-helpers';

const mockIconify = vi.mocked(createIconifyIcon);

beforeEach(() => {
    mockIconify.mockReset();
    // By default, createIconifyIcon returns a valid element
    mockIconify.mockReturnValue(document.createElement('span'));
});

// ─── slideRow ─────────────────────────────────────────────────

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

    it('includes sublabel and tag when provided', () => {
        const container = document.createElement('div');
        const onClick = vi.fn();
        slideRow(container, 'icon', 'Label', false, onClick, 'sub', 'tag');

        const row = container.querySelector('.slide-item')!;
        const subEl = row.querySelector('.slide-sublabel')!;
        expect(subEl.textContent).toBe('sub');

        const tagEl = row.querySelector('.slide-tag')!;
        expect(tagEl.textContent).toBe('tag');
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

// ─── addToggleRow ──────────────────────────────────────────────

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

// ─── addSliderRow ──────────────────────────────────────────────

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

    it('click on bar fires onChange with computed value', () => {
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

        bar.dispatchEvent(new MouseEvent('click', { clientX: 50 }));
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

// ─── addCollapsible ────────────────────────────────────────────

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
        const panel = container.querySelector('.collapsible-panel')!;

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
});

// ─── addPresetChip ─────────────────────────────────────────────

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

// ─── addSectionTitle ───────────────────────────────────────────

describe('addSectionTitle', () => {
    it('adds a section-title div with correct text', () => {
        const container = document.createElement('div');
        addSectionTitle(container, 'Section Header');

        const title = container.querySelector('.section-title')!;
        expect(title).not.toBeNull();
        expect(title.textContent).toBe('Section Header');
    });
});

// ─── addModeRow ────────────────────────────────────────────────

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

// ─── sliderRow (simplified wrapper) ────────────────────────────

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
        bar.dispatchEvent(new MouseEvent('click', { clientX: 80 }));

        expect(onDragEnd).toHaveBeenCalled();
    });
});

// ─── toggleRow (simplified wrapper) ────────────────────────────

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
