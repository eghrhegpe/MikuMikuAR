// [doc:architecture] ui-advanced-rows — 高级菜单行控件（color-slider / mode-slider）
// addColorSliderRow / addModeSlider

import { createIconifyIcon } from './icons';
import { ControlOptions } from './ui-types';
import { initControl } from './ui-rows';
import { clampPct, clamp01 } from '@/core/clamp';
import { col3FromTriple, rgbString } from './color-helpers';
import { DragSliderController } from './ui-slider-controller';
// [doc:adr-229] DOM 契约单源：role/class 由 dom-contract 提供，禁止手写字符串
import { ROLE, SLIDER_BAR_CLASS, ARIA_ATTR } from './dom-contract';

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
    // [defense] 与 addSliderRow 对齐：非有限通道值回落到 0，避免 .toFixed()/width 渲染 "NaN"；
    // 同时把越界通道钳到 [0,1]，防止外部状态异常时渲染出 150% 宽或 aria-valuenow=2
    const safeColor: [number, number, number] = [
        Number.isFinite(color[0]) ? clamp01(color[0]) : 0,
        Number.isFinite(color[1]) ? clamp01(color[1]) : 0,
        Number.isFinite(color[2]) ? clamp01(color[2]) : 0,
    ];

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
    swatch.style.background = rgbString(col3FromTriple(safeColor));
    header.appendChild(swatch);
    block.appendChild(header);
    const channelColors = ['#f66', '#6f6', '#66f'];
    const current: [number, number, number] = [safeColor[0], safeColor[1], safeColor[2]];
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
        val.textContent = safeColor[ci].toFixed(2);

        const bar = document.createElement('div');
        bar.className = SLIDER_BAR_CLASS;
        bar.tabIndex = 0;
        bar.setAttribute('role', ROLE.slider);
        bar.setAttribute(ARIA_ATTR.label, `${label} ${['Red', 'Green', 'Blue'][ci]} channel`);
        bar.setAttribute(ARIA_ATTR.valuemin, '0');
        bar.setAttribute(ARIA_ATTR.valuemax, '1');
        bar.setAttribute(ARIA_ATTR.valuenow, String(safeColor[ci]));
        bar.setAttribute(ARIA_ATTR.labelledby, ch.id);

        const fill = document.createElement('div');
        fill.className = 'cs-fill';
        fill.style.background = channelColors[ci];
        fill.style.width = safeColor[ci] * 100 + '%';

        const thumb = document.createElement('div');
        thumb.className = 'cs-thumb';
        thumb.style.left = safeColor[ci] * 100 + '%';

        bar.appendChild(fill);
        bar.appendChild(thumb);

        function updateDisplay(v: number): void {
            current[ci] = v;
            val.textContent = v.toFixed(2);
            fill.style.width = v * 100 + '%';
            thumb.style.left = v * 100 + '%';
            bar.setAttribute(ARIA_ATTR.valuenow, String(v));
            swatch.style.background = rgbString(col3FromTriple(current));
            onChange([current[0], current[1], current[2]]);
        }

        const controller = new DragSliderController({
            value: safeColor[ci],
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
        initControl(block, opts, [safeColor[0], safeColor[1], safeColor[2]], (v, cached) => {
            if (!Array.isArray(v) || v.length < 3) {
                return false;
            }
            let changed = false;
            for (let i = 0; i < 3; i++) {
                const safe = Number.isFinite(v[i]) ? clamp01(v[i]) : 0;
                if (safe !== cached[i]) {
                    changed = true;
                    current[i] = safe;
                    vals[i].textContent = safe.toFixed(2);
                    fills[i].style.width = safe * 100 + '%';
                    thumbs[i].style.left = safe * 100 + '%';
                    bars[i].setAttribute(ARIA_ATTR.valuenow, String(safe));
                    controllers[i].setValue(safe);
                }
            }
            if (changed) {
                swatch.style.background = rgbString(col3FromTriple(current));
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
    const hasRange = Number.isFinite(range) && range > 0;
    // [defense] 与 addSliderRow 对齐：非有限轴值回落到 min，避免 .toFixed()/width 渲染 "NaN"；
    // 越界轴值钳到 [min,max]，保持显示、ARIA 与控制器状态一致
    const safeValue: [number, number, number] = [
        Number.isFinite(value[0]) ? Math.min(max, Math.max(min, value[0])) : min,
        Number.isFinite(value[1]) ? Math.min(max, Math.max(min, value[1])) : min,
        Number.isFinite(value[2]) ? Math.min(max, Math.max(min, value[2])) : min,
    ];

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

    const current: [number, number, number] = [safeValue[0], safeValue[1], safeValue[2]];
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
        bar.className = SLIDER_BAR_CLASS;
        bar.tabIndex = 0;
        bar.setAttribute('role', ROLE.slider);
        bar.setAttribute(ARIA_ATTR.label, `${label} ${axes[ai]}`);
        bar.setAttribute(ARIA_ATTR.valuenow, String(current[ai]));
        bar.setAttribute(ARIA_ATTR.valuemin, String(min));
        bar.setAttribute(ARIA_ATTR.valuemax, String(max));
        bar.setAttribute(ARIA_ATTR.valuenow, String(current[ai]));
        bar.setAttribute(ARIA_ATTR.labelledby, ch.id);
        barEls[ai] = bar;

        const pct = hasRange ? ((current[ai] - min) / range) * 100 : 0;

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
            const safe = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
            current[ai] = safe;
            val.textContent = step < 1 ? safe.toFixed(2) : String(Math.round(safe));
            const newPct = hasRange ? ((safe - min) / range) * 100 : 0;
            const clamped = clampPct(newPct);
            fill.style.width = clamped + '%';
            thumb.style.left = clamped + '%';
            bar.setAttribute(ARIA_ATTR.valuenow, String(safe));
            onChange([current[0], current[1], current[2]]);
        }

        const controller = new DragSliderController({
            value: current[ai],
            min,
            max,
            step,
            onChange: (v) => updateDisplay(v),
            onDragEnd: (_v) => onDragEndCb?.([current[0], current[1], current[2]]),
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
        initControl(block, opts, [safeValue[0], safeValue[1], safeValue[2]], (v, cached) => {
            if (!Array.isArray(v) || v.length < 3) {
                return false;
            }
            let changed = false;
            for (let i = 0; i < 3; i++) {
                const safe = Number.isFinite(v[i]) ? Math.min(max, Math.max(min, v[i])) : min;
                if (safe !== cached[i]) {
                    changed = true;
                    current[i] = safe;
                    valEls[i].textContent = step < 1 ? safe.toFixed(2) : String(Math.round(safe));
                    const newPct = hasRange ? ((safe - min) / range) * 100 : 0;
                    const clamped = clampPct(newPct);
                    fillEls[i].style.width = clamped + '%';
                    thumbEls[i].style.left = clamped + '%';
                    barEls[i].setAttribute(ARIA_ATTR.valuenow, String(safe));
                    controllers[i].setValue(safe);
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
    // [audit:round6] ARIA 合规：modeSlider 是循环步进控件（键盘方向键 cycleIdx），
    // 语义为 slider——原 role=listbox + aria-valuemin/max/now 违反 ARIA 规范
    // （valuenow 等仅允许 slider/scrollbar/spinbutton/progressbar/meter）。
    top.setAttribute('role', ROLE.slider);
    top.setAttribute(ARIA_ATTR.label, label);
    top.setAttribute(ARIA_ATTR.valuenow, String(currentIndex));
    top.setAttribute(ARIA_ATTR.valuemin, '0');
    top.setAttribute(ARIA_ATTR.valuemax, String(total - 1));

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
    bar.className = SLIDER_BAR_CLASS;

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
        top.setAttribute(ARIA_ATTR.valuenow, String(idx));
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
        const x = clamp01((e.clientX - rect.left) / (rect.width || 1));
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
        // 外部值不在选项内时显示回落到第一个选项；仍返回 true 让缓存跟踪原始值，
        // 以便后续从非法值恢复合法值时能触发更新
        updateDisplay(idx >= 0 ? idx : 0);
        return true;
    });
}
