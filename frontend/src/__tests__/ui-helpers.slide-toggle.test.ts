// ui-helpers 拆分 — slideRow / addToggleRow / toggleRow（滑动行 + 开关行）
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock createIconifyIcon so tests control whether it returns an element or null
vi.mock('../core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));

import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addToggleRow,
    toggleRow as toggleRowFn,
} from '../core/ui-helpers';

const mockIconify = vi.mocked(createIconifyIcon);

beforeEach(() => {
    mockIconify.mockReset();
    // By default, createIconifyIcon returns a valid element
    mockIconify.mockReturnValue(document.createElement('span'));
});

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
