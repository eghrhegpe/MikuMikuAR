// ui-helpers 拆分 — addCollapsible / addPresetChip / addSectionTitle / addModeRow（布局块）
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock createIconifyIcon so tests control whether it returns an element or null
vi.mock('../core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));

import { createIconifyIcon } from '../core/icons';
import { addCollapsible, addPresetChip, addSectionTitle, addModeRow } from '../core/ui-helpers';

const mockIconify = vi.mocked(createIconifyIcon);

beforeEach(() => {
    mockIconify.mockReset();
    // By default, createIconifyIcon returns a valid element
    mockIconify.mockReturnValue(document.createElement('span'));
});

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
