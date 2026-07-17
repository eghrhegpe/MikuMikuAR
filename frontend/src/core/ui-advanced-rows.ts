// [doc:architecture] ui-advanced-rows — 高级菜单行控件（color-slider / mode-slider）
// addColorSliderRow / addModeSlider

import { createIconifyIcon } from './icons';
import { ControlOptions } from './ui-types';
import { initControl } from './ui-rows';
import { clamp01, clampPct } from '@/core/utils';
import { addDisposableListener, type Disposable } from './dom';
import { col3FromTriple, rgbString } from './color-helpers';

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
        bar.setAttribute('aria-valuenow', String(color[ci]));
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '1');
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

        function setValueFromClientX(clientX: number, rect: DOMRect): void {
            const x = (clientX - rect.left) / rect.width;
            const raw = clamp01(x);
            const snapped = Math.round(raw * 100) / 100;
            if (snapped !== current[ci]) {
                updateDisplay(snapped);
            }
        }

        function handleKeyDown(e: KeyboardEvent): void {
            const delta = e.shiftKey ? 0.1 : 0.01;
            switch (e.key) {
                case 'ArrowLeft':
                case 'ArrowDown': {
                    e.preventDefault();
                    const lower = Math.max(0, Math.round((current[ci] - delta) * 100) / 100);
                    if (lower !== current[ci]) {
                        updateDisplay(lower);
                    }
                    break;
                }
                case 'ArrowRight':
                case 'ArrowUp': {
                    e.preventDefault();
                    const upper = Math.min(1, Math.round((current[ci] + delta) * 100) / 100);
                    if (upper !== current[ci]) {
                        updateDisplay(upper);
                    }
                    break;
                }
                case 'Home':
                    e.preventDefault();
                    if (0 !== current[ci]) {
                        updateDisplay(0);
                    }
                    break;
                case 'End':
                    e.preventDefault();
                    if (1 !== current[ci]) {
                        updateDisplay(1);
                    }
                    break;
            }
        }

        let didDrag = false;
        let dragRect: DOMRect | null = null;
        let moveDisp: Disposable | null = null;
        let endDisp: Disposable | null = null;

        function onDragMove(e: MouseEvent): void {
            if (!didDrag) {
                didDrag = true;
            }
            e.preventDefault();
            if (dragRect) {
                setValueFromClientX(e.clientX, dragRect);
            }
        }

        function onDragEnd(e: MouseEvent): void {
            moveDisp?.dispose();
            endDisp?.dispose();
            moveDisp = null;
            endDisp = null;
            if (!didDrag && dragRect) {
                setValueFromClientX(e.clientX, dragRect);
            }
            dragRect = null;
            didDrag = false;
        }

        bar.addEventListener('mousedown', (e) => {
            e.preventDefault();
            bar.focus();
            dragRect = bar.getBoundingClientRect();
            didDrag = false;
            moveDisp = addDisposableListener(document, 'mousemove', onDragMove);
            endDisp = addDisposableListener(document, 'mouseup', onDragEnd);
        });

        bar.addEventListener('keydown', handleKeyDown);

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

    function snapToStep(v: number): number {
        if (!step || !Number.isFinite(step)) {
            return v;
        }
        const precision = 1 / step;
        return Math.round(v * precision) / precision;
    }

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

        function setValueFromClientX(clientX: number, rect: DOMRect): void {
            const x = (clientX - rect.left) / rect.width;
            const raw = min + clamp01(x) * range;
            const snapped = snapToStep(raw);
            const clamped = Math.max(min, Math.min(max, snapped));
            if (clamped !== current[ai]) {
                updateDisplay(clamped);
            }
        }

        function handleKeyDown(e: KeyboardEvent): void {
            const shiftMult = e.shiftKey ? 10 : 1;
            let delta: number;
            if (step >= 1) {
                delta = e.shiftKey ? step * 10 : step;
            } else {
                delta = step * shiftMult;
            }
            switch (e.key) {
                case 'ArrowLeft':
                case 'ArrowDown': {
                    e.preventDefault();
                    const lower = Math.max(min, snapToStep(current[ai] - delta));
                    if (lower !== current[ai]) {
                        updateDisplay(lower);
                        onDragEndCb?.([current[0], current[1], current[2]]);
                    }
                    break;
                }
                case 'ArrowRight':
                case 'ArrowUp': {
                    e.preventDefault();
                    const upper = Math.min(max, snapToStep(current[ai] + delta));
                    if (upper !== current[ai]) {
                        updateDisplay(upper);
                        onDragEndCb?.([current[0], current[1], current[2]]);
                    }
                    break;
                }
                case 'Home':
                    e.preventDefault();
                    if (min !== current[ai]) {
                        updateDisplay(min);
                        onDragEndCb?.([current[0], current[1], current[2]]);
                    }
                    break;
                case 'End':
                    e.preventDefault();
                    if (max !== current[ai]) {
                        updateDisplay(max);
                        onDragEndCb?.([current[0], current[1], current[2]]);
                    }
                    break;
            }
        }

        let didDrag = false;
        let dragRect: DOMRect | null = null;
        let moveDisp: Disposable | null = null;
        let endDisp: Disposable | null = null;

        function onDragMove(e: MouseEvent): void {
            if (!didDrag) {
                didDrag = true;
            }
            e.preventDefault();
            if (dragRect) {
                setValueFromClientX(e.clientX, dragRect);
            }
        }

        function onDragEnd(e: MouseEvent): void {
            moveDisp?.dispose();
            endDisp?.dispose();
            moveDisp = null;
            endDisp = null;
            if (!didDrag && dragRect) {
                setValueFromClientX(e.clientX, dragRect);
            }
            if (didDrag) {
                onDragEndCb?.([current[0], current[1], current[2]]);
            }
            dragRect = null;
            didDrag = false;
        }

        bar.addEventListener('mousedown', (e) => {
            e.preventDefault();
            bar.focus();
            dragRect = bar.getBoundingClientRect();
            didDrag = false;
            moveDisp = addDisposableListener(document, 'mousemove', onDragMove);
            endDisp = addDisposableListener(document, 'mouseup', onDragEnd);
        });

        bar.addEventListener('keydown', handleKeyDown);

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

    function setIndexFromClientX(clientX: number, rect: DOMRect): void {
        const x = clamp01((clientX - rect.left) / rect.width);
        const newIdx = total > 1 ? Math.round(x * (total - 1)) : 0;
        if (newIdx !== currentIndex) {
            updateDisplay(newIdx);
            onChange(options[newIdx].value);
        }
    }

    function handleKeyDown(e: KeyboardEvent): void {
        const shiftMult = e.shiftKey ? Math.max(1, Math.floor(total / 4)) : 1;
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown': {
                e.preventDefault();
                const lower = Math.max(0, currentIndex - shiftMult);
                if (lower !== currentIndex) {
                    updateDisplay(lower);
                    onChange(options[lower].value);
                    onDragEndCb?.(options[lower].value);
                }
                break;
            }
            case 'ArrowRight':
            case 'ArrowUp': {
                e.preventDefault();
                const upper = Math.min(total - 1, currentIndex + shiftMult);
                if (upper !== currentIndex) {
                    updateDisplay(upper);
                    onChange(options[upper].value);
                    onDragEndCb?.(options[upper].value);
                }
                break;
            }
            case 'Home':
                e.preventDefault();
                if (0 !== currentIndex) {
                    updateDisplay(0);
                    onChange(options[0].value);
                    onDragEndCb?.(options[0].value);
                }
                break;
            case 'End':
                e.preventDefault();
                if (total - 1 !== currentIndex) {
                    updateDisplay(total - 1);
                    onChange(options[total - 1].value);
                    onDragEndCb?.(options[total - 1].value);
                }
                break;
        }
    }

    let didDrag = false;
    let topDragRect: DOMRect | null = null;
    let topMoveDisp: Disposable | null = null;
    let topEndDisp: Disposable | null = null;

    function onTopDragMove(e: MouseEvent): void {
        if (!didDrag) {
            didDrag = true;
        }
        e.preventDefault();
        if (topDragRect) {
            setIndexFromClientX(e.clientX, topDragRect);
        }
    }

    function onTopDragEnd(e: MouseEvent): void {
        topMoveDisp?.dispose();
        topEndDisp?.dispose();
        topMoveDisp = null;
        topEndDisp = null;

        if (!didDrag) {
            const rect = top.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const quarter = Math.max(1, Math.floor(total / 4));
            let step: number;
            if (x < 0.25) {
                step = -quarter;
            } else if (x < 0.5) {
                step = -1;
            } else if (x < 0.75) {
                step = 1;
            } else {
                step = quarter;
            }
            const nextIdx = (currentIndex + step + total) % total;
            updateDisplay(nextIdx);
            onChange(options[nextIdx].value);
            onDragEndCb?.(options[nextIdx].value);
        } else {
            onDragEndCb?.(options[currentIndex].value);
        }
        topDragRect = null;
        didDrag = false;
    }

    top.addEventListener('mousedown', (e) => {
        e.preventDefault();
        top.focus();
        topDragRect = top.getBoundingClientRect();
        didDrag = false;
        topMoveDisp = addDisposableListener(document, 'mousemove', onTopDragMove);
        topEndDisp = addDisposableListener(document, 'mouseup', onTopDragEnd);
    });

    top.addEventListener('keydown', handleKeyDown);

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
