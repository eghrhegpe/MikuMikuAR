// [doc:architecture] ui-advanced-rows — 高级菜单行控件（color-slider / mode-slider）
// addColorSliderRow / addModeSlider

import { createIconifyIcon } from './icons';
import { ControlOptions } from './ui-types';
import { initControl } from './ui-rows';
import { clampPct } from '@/core/utils';
import { col3FromTriple, rgbString } from './color-helpers';
import { DragSliderController } from './ui-slider-controller';

// ===================================================================
// addColorSliderRow
// ===================================================================

export function addColorSliderRow(
    container: HTMLElement,
    label: string,
    color: [number, number, number],
    onChange: (v: [number, number, number]) => void,
    opts?: ControlOptions<[number, number, number]>,
    testId?: string
): void {
    const block = document.createElement('div');
    block.className = 'clr-block';
    if (testId) {
        block.setAttribute('data-testid', testId);
    }
    const header = document.createElement('div');
    header.className = 'clr-header';
    const title = document.createElement('span');
    title.className = 'clr-title';
    title.textContent = label;
    title.id = `color-${Math.random().toString(36).slice(2, 11)}`;
    header.appendChild(title);
    const swatch = document.createElement('span');
    swatch.className = 'clr-swatch';
    swatch.style.background = rgbString(col3FromTriple(color));
    header.appendChild(swatch);
    block.appendChild(header);
    const channelColors = ['#f66', '#6f6', '#66f'];
    const current: [number, number, number] = [color[0], color[1], color[2]];
    const controllers: DragSliderController[] = [];

    for (let ci = 0; ci < 3; ci++) {
        const sub = document.createElement('div');
        sub.className = 'clr-row';
        const ch = document.createElement('span');
        ch.className = 'clr-channel';
        ch.style.color = channelColors[ci];
        ch.textContent = ['R', 'G', 'B'][ci];
        ch.id = `${title.id}-ch${ci}`;
        sub.appendChild(ch);

        const val = document.createElement('span');
        val.className = 'clr-value';
        val.textContent = color[ci].toFixed(2);

        const bar = document.createElement('div');
        bar.className = 'cs-bar';
        bar.tabIndex = 0;
        bar.setAttribute('role', 'slider');
        bar.setAttribute('aria-label', `${label} ${['Red', 'Green', 'Blue'][ci]} channel`);
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '1');
        bar.setAttribute('aria-valuenow', String(color[ci]));
        bar.setAttribute('aria-labelledby', ch.id);

        const fill = document.createElement('div');
        fill.className = 'cs-fill';
        fill.style.background = channelColors[ci];
        fill.style.width = color[ci] * 100 + '%';

        const thumb = document.createElement('div');
        thumb.className = 'cs-thumb';
        thumb.style.left = color[ci] * 100 + '%';

        bar.appendChild(fill);
        bar.appendChild(thumb);

        function updateDisplay(v: number): void {
            current[ci] = v;
            val.textContent = v.toFixed(2);
            fill.style.width = v * 100 + '%';
            thumb.style.left = v * 100 + '%';
            bar.setAttribute('aria-valuenow', String(v));
            swatch.style.background = rgbString(col3FromTriple(current));
            onChange([current[0], current[1], current[2]]);
        }

        const controller = new DragSliderController({
            value: color[ci],
            min: 0,
            max: 1,
            step: 0.01,
            onChange: (v) => updateDisplay(v),
        });
        controller.bind(bar);
        controllers[ci] = controller;

        sub.appendChild(bar);
        sub.appendChild(val);
        block.appendChild(sub);
    }
    container.appendChild(block);

    // === 自更新支持 ===
    if (opts) {
        const vals: HTMLElement[] = [];
        const fills: HTMLElement[] = [];
        const thumbs: HTMLElement[] = [];
        const bars: HTMLElement[] = [];
        const clrRows = block.querySelectorAll('.clr-row');
        clrRows.forEach((row, i) => {
            vals[i] = row.querySelector('.clr-value') as HTMLElement;
            fills[i] = row.querySelector('.cs-fill') as HTMLElement;
            thumbs[i] = row.querySelector('.cs-thumb') as HTMLElement;
            bars[i] = row.querySelector('.cs-bar') as HTMLElement;
        });
        initControl(block, opts, [color[0], color[1], color[2]], (v, cached) => {
            if (!Array.isArray(v) || v.length < 3) {
                return false;
            }
            let changed = false;
            for (let i = 0; i < 3; i++) {
                if (v[i] !== cached[i]) {
                    changed = true;
                    current[i] = v[i];
                    vals[i].textContent = v[i].toFixed(2);
                    fills[i].style.width = v[i] * 100 + '%';
                    thumbs[i].style.left = v[i] * 100 + '%';
                    bars[i].setAttribute('aria-valuenow', String(v[i]));
                    controllers[i].setValue(v[i]);
                }
            }
            if (changed) {
                swatch.style.background = rgbString(col3FromTriple(v));
            }
            return changed;
        });
    }
}

// ===================================================================
// addVector3SliderRow — 三维向量滑块（X/Y/Z 三通道）
// ===================================================================

export function addVector3SliderRow(
    container: HTMLElement,
    label: string,
    value: [number, number, number],
    min: number,
    max: number,
    step: number,
    onChange: (v: [number, number, number]) => void,
    axisLabels?: [string, string, string],
    icon?: string,
    onDragEndCb?: (v: [number, number, number]) => void,
    opts?: ControlOptions<[number, number, number]>,
    testId?: string
): void {
    const axes: [string, string, string] = axisLabels ?? ['X', 'Y', 'Z'];
    const range = max - min;

    const block = document.createElement('div');
    block.className = 'vec3-block';
    if (testId) {
        block.setAttribute('data-testid', testId);
    }

    const header = document.createElement('div');
    header.className = 'vec3-header';
    if (icon) {
        const iconBox = document.createElement('span');
        iconBox.className = 'cs-icon';
        const iconEl = createIconifyIcon(icon);
        if (iconEl) {
            iconBox.appendChild(iconEl);
        } else {
            const fb = document.createElement('span');
            fb.className = 'cs-icon-fallback';
            fb.textContent = label.charAt(0) || '?';
            iconBox.appendChild(fb);
        }
        header.appendChild(iconBox);
    }
    const title = document.createElement('span');
    title.className = 'vec3-title';
    title.textContent = label;
    title.id = `vec3-${Math.random().toString(36).slice(2, 11)}`;
    header.appendChild(title);
    block.appendChild(header);

    const current: [number, number, number] = [value[0], value[1], value[2]];
    const axisColors = ['var(--accent)', 'var(--success)', 'var(--warning)'];

    const controllers: DragSliderController[] = [];
    const valEls: HTMLElement[] = [];
    const fillEls: HTMLElement[] = [];
    const thumbEls: HTMLElement[] = [];
    const barEls: HTMLElement[] = [];

    for (let ai = 0; ai < 3; ai++) {
        const sub = document.createElement('div');
        sub.className = 'vec3-row';
        const ch = document.createElement('span');
        ch.className = 'vec3-axis';
        ch.style.color = axisColors[ai];
        ch.textContent = axes[ai];
        ch.id = `${title.id}-ax${ai}`;
        sub.appendChild(ch);

        const val = document.createElement('span');
        val.className = 'vec3-value';
        val.textContent = step < 1 ? current[ai].toFixed(2) : String(Math.round(current[ai]));
        valEls[ai] = val;

        const bar = document.createElement('div');
        bar.className = 'cs-bar';
        bar.tabIndex = 0;
        bar.setAttribute('role', 'slider');
        bar.setAttribute('aria-label', `${label} ${axes[ai]}`);
        bar.setAttribute('aria-valuenow', String(current[ai]));
        bar.setAttribute('aria-valuemin', String(min));
        bar.setAttribute('aria-valuemax', String(max));
        bar.setAttribute('aria-valuenow', String(current[ai]));
        bar.setAttribute('aria-labelledby', ch.id);
        barEls[ai] = bar;

        const pct = ((current[ai] - min) / range) * 100;

        const fill = document.createElement('div');
        fill.className = 'cs-fill';
        fill.style.background = axisColors[ai];
        fill.style.width = clampPct(pct) + '%';
        fillEls[ai] = fill;

        const thumb = document.createElement('div');
        thumb.className = 'cs-thumb';
        thumb.style.left = clampPct(pct) + '%';
        thumbEls[ai] = thumb;

        bar.appendChild(fill);
        bar.appendChild(thumb);

        function updateDisplay(v: number): void {
            current[ai] = v;
            val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
            const newPct = ((v - min) / range) * 100;
            const clamped = clampPct(newPct);
            fill.style.width = clamped + '%';
            thumb.style.left = clamped + '%';
            bar.setAttribute('aria-valuenow', String(v));
            onChange([current[0], current[1], current[2]]);
        }

        const controller = new DragSliderController({
            value: current[ai],
            min,
            max,
            step,
            onChange: (v) => updateDisplay(v),
            onDragEnd: (v) => onDragEndCb?.([current[0], current[1], current[2]]),
        });
        controller.bind(bar);
        controllers[ai] = controller;

        sub.appendChild(bar);
        sub.appendChild(val);
        block.appendChild(sub);
    }

    container.appendChild(block);

    // === 自更新支持 ===
    if (opts) {
        initControl(block, opts, [value[0], value[1], value[2]], (v, cached) => {
            if (!Array.isArray(v) || v.length < 3) {
                return false;
            }
            let changed = false;
            for (let i = 0; i < 3; i++) {
                if (v[i] !== cached[i]) {
                    changed = true;
                    current[i] = v[i];
                    valEls[i].textContent = step < 1 ? v[i].toFixed(2) : String(Math.round(v[i]));
                    const newPct = ((v[i] - min) / range) * 100;
                    const clamped = clampPct(newPct);
                    fillEls[i].style.width = clamped + '%';
                    thumbEls[i].style.left = clamped + '%';
                    barEls[i].setAttribute('aria-valuenow', String(v[i]));
                    controllers[i].setValue(v[i]);
                }
            }
            return changed;
        });
    }
}

// ===================================================================
// addModeSlider
// ===================================================================

export function addModeSlider<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void,
    icon?: string,
    onDragEndCb?: (v: T) => void,
    opts?: ControlOptions<T>,
    testId?: string
): void {
    const total = options.length;
    if (total === 0) {
        return;
    }

    let currentIndex = options.findIndex((o) => o.value === currentValue);
    if (currentIndex < 0) {
        currentIndex = 0;
    }

    const row = document.createElement('div');
    row.className = 'cs-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const top = document.createElement('div');
    top.className = 'cs-top';
    top.tabIndex = 0;
    top.setAttribute('role', 'listbox');
    top.setAttribute('aria-label', label);
    top.setAttribute('aria-valuenow', String(currentIndex));
    top.setAttribute('aria-valuemin', '0');
    top.setAttribute('aria-valuemax', String(total - 1));

    if (icon) {
        const iconBox = document.createElement('span');
        iconBox.className = 'cs-icon';
        const iconEl = createIconifyIcon(icon);
        if (iconEl) {
            iconBox.appendChild(iconEl);
        } else {
            const fb = document.createElement('span');
            fb.className = 'cs-icon-fallback';
            fb.textContent = label.charAt(0) || '?';
            iconBox.appendChild(fb);
        }
        top.appendChild(iconBox);
    }

    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'cs-value';
    val.textContent = options[currentIndex].label;

    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement('div');
    bar.className = 'cs-bar';

    const fill = document.createElement('div');
    fill.className = 'cs-fill';
    const pct = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
    fill.style.width = clampPct(pct) + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = clampPct(pct) + '%';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    function updateDisplay(idx: number): void {
        currentIndex = idx;
        val.textContent = options[idx].label;
        const newPct = total > 1 ? (idx / (total - 1)) * 100 : 100;
        const clamped = clampPct(newPct);
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        top.setAttribute('aria-valuenow', String(idx));
    }

    function cycleIdx(dir: -1 | 1): void {
        const next = Math.max(0, Math.min(total - 1, currentIndex + dir));
        if (next !== currentIndex) {
            updateDisplay(next);
            onChange(options[next].value);
            onDragEndCb?.(options[next].value);
        }
    }

    // 键盘方向键切换
    top.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            cycleIdx(-1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            cycleIdx(1);
        }
    });

    // 点击 cs-top：左半前一项、右半后一项
    top.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = top.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        cycleIdx(x < 0.5 ? -1 : 1);
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);

    // === 自更新支持 ===
    initControl(row, opts, currentValue, (v, cached) => {
        if (v === cached) {
            return false;
        }
        const idx = options.findIndex((o) => o.value === v);
        if (idx >= 0) {
            updateDisplay(idx);
        }
        return true;
    });
}
