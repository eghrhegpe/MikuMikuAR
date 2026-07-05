// [doc:architecture] ui-rows — 菜单行控件（toggle/slider/mode）
// addToggleRow / addSliderRow / addModeRow / sliderRow / toggleRow

import { createIconifyIcon } from './icons';
import { getCurrentRenderingMenu } from '../menus/menu';
import { ControlOptions } from './ui-types';
import { slideRow } from './ui-slide-row';

// ===================================================================
// addToggleRow
// ===================================================================

export function addToggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    icon?: string,
    opts?: ControlOptions<boolean>
): void {
    const row = document.createElement('div');
    row.className = 'toggle-row';

    const left = document.createElement('div');
    left.className = 'toggle-left';

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
        left.appendChild(iconBox);
    }

    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = label;
    lbl.id = `toggle-${Math.random().toString(36).slice(2, 11)}`;
    left.appendChild(lbl);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = value;
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-checked', String(value));
    toggle.setAttribute('aria-labelledby', lbl.id);
    toggle.addEventListener('change', () => {
        toggle.setAttribute('aria-checked', String(toggle.checked));
        onChange(toggle.checked);
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(slider);
    row.appendChild(left);
    row.appendChild(toggleLabel);

    // 整行点击（除 toggle 开关外）也可切换
    row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.toggle')) return;
        toggle.checked = !toggle.checked;
        toggle.setAttribute('aria-checked', String(toggle.checked));
        onChange(toggle.checked);
    });

    container.appendChild(row);

    // === 自更新支持 ===
    if (opts) {
        let cachedValue = value;
        const update = (): void => {
            if (opts.onUpdate) {
                opts.onUpdate(row);
                return;
            }
            if (!opts.bind) return;
            const newVal = !!opts.bind();
            if (newVal === cachedValue) return;
            cachedValue = newVal;
            toggle.checked = newVal;
            toggle.setAttribute('aria-checked', String(newVal));
        };
        getCurrentRenderingMenu()?.registerControl(update);
    }
}

// ===================================================================
// addSliderRow
// ===================================================================

export function addSliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    icon?: string,
    onDragEndCb?: (v: number) => void,
    opts?: ControlOptions<number>
): void {
    let currentValue = value;
    const range = max - min;

    const row = document.createElement('div');
    row.className = 'cs-row';

    const top = document.createElement('div');
    top.className = 'cs-top';

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
    val.textContent = step < 1 ? currentValue.toFixed(2) : String(Math.round(currentValue));

    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement('div');
    bar.className = 'cs-bar';
    bar.tabIndex = 0;
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', label);
    bar.setAttribute('aria-valuenow', String(currentValue));
    bar.setAttribute('aria-valuemin', String(min));
    bar.setAttribute('aria-valuemax', String(max));

    const fill = document.createElement('div');
    fill.className = 'cs-fill';
    const pct = ((currentValue - min) / range) * 100;
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    function snapToStep(v: number): number {
        if (!step || !Number.isFinite(step)) {
            return v;
        }
        const precision = 1 / step;
        return Math.round(v * precision) / precision;
    }

    function updateDisplay(v: number): void {
        currentValue = v;
        val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
        const newPct = ((v - min) / range) * 100;
        const clamped = Math.max(0, Math.min(100, newPct));
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        bar.setAttribute('aria-valuenow', String(v));
    }

    function setValueFromClientX(clientX: number, rect: DOMRect): void {
        const x = (clientX - rect.left) / rect.width;
        const raw = min + Math.max(0, Math.min(1, x)) * range;
        const snapped = snapToStep(raw);
        const clamped = Math.max(min, Math.min(max, snapped));
        if (clamped !== currentValue) {
            updateDisplay(clamped);
            onChange(clamped);
        }
    }

    function handleKeyDown(e: KeyboardEvent): void {
        const shiftMult = e.shiftKey ? 10 : 1;
        let delta = step * shiftMult;
        if (step >= 1) {
            delta = e.shiftKey ? 10 : 1;
        }

        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown': {
                e.preventDefault();
                const lower = Math.max(min, snapToStep(currentValue - delta));
                if (lower !== currentValue) {
                    updateDisplay(lower);
                    onChange(lower);
                    onDragEndCb?.(lower);
                }
                break;
            }
            case 'ArrowRight':
            case 'ArrowUp': {
                e.preventDefault();
                const upper = Math.min(max, snapToStep(currentValue + delta));
                if (upper !== currentValue) {
                    updateDisplay(upper);
                    onChange(upper);
                    onDragEndCb?.(upper);
                }
                break;
            }
            case 'Home':
                e.preventDefault();
                if (min !== currentValue) {
                    updateDisplay(min);
                    onChange(min);
                    onDragEndCb?.(min);
                }
                break;
            case 'End':
                e.preventDefault();
                if (max !== currentValue) {
                    updateDisplay(max);
                    onChange(max);
                    onDragEndCb?.(max);
                }
                break;
        }
    }

    bar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bar.focus();
        const rect = bar.getBoundingClientRect();
        setValueFromClientX(e.clientX, rect);
        onDragEndCb?.(currentValue);
    });

    bar.addEventListener('keydown', handleKeyDown);

    row.addEventListener('click', (e) => {
        const rect = row.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        let delta: number;
        if (x < 0.25) {
            delta = -(range * 0.15);
        } else if (x < 0.5) {
            delta = -(range * 0.05);
        } else if (x < 0.75) {
            delta = range * 0.05;
        } else {
            delta = range * 0.15;
        }
        let newVal = snapToStep(currentValue + delta);
        newVal = Math.max(min, Math.min(max, newVal));
        if (newVal !== currentValue) {
            updateDisplay(newVal);
            onChange(newVal);
            onDragEndCb?.(newVal);
        }
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);

    // === 自更新支持 ===
    if (opts) {
        let cachedValue = value;
        const update = (): void => {
            if (opts.onUpdate) {
                opts.onUpdate(row);
                return;
            }
            if (!opts.bind) return;
            const newVal = Number(opts.bind());
            if (!Number.isFinite(newVal)) return;
            if (newVal === cachedValue) return;
            cachedValue = newVal;
            updateDisplay(newVal);
        };
        getCurrentRenderingMenu()?.registerControl(update);
    }
}

// ===================================================================
// addModeRow
// ===================================================================

export function addModeRow<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void
): void {
    const row = document.createElement('div');
    row.className = 'type-row';
    const lbl = document.createElement('span');
    lbl.className = 'type-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    for (const opt of options) {
        const btn = document.createElement('button');
        btn.textContent = opt.label;
        btn.className = 'mode-btn' + (currentValue === opt.value ? ' active' : '');
        btn.addEventListener('click', () => onChange(opt.value));
        row.appendChild(btn);
    }
    container.appendChild(row);
}

// ===================================================================
// addEmptyRow — 空状态占位行
// ===================================================================

/**
 * 创建空状态占位行（灰色文字，不可点击），替代手动 `el.style.opacity = '0.5'` 模式
 */
export function addEmptyRow(parent: HTMLElement, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slide-item slide-item-muted';
    el.textContent = text;
    parent.appendChild(el);
    return el;
}

// ===================================================================
// addDangerRow — 危险/删除操作行
// ===================================================================

/**
 * 创建危险操作行（icon + red label），替代手动拼接 `div.slide-item > icon + label.danger-text`
 */
export function addDangerRow(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void
): HTMLElement {
    return slideRow(container, icon, label, false, onClick, undefined, undefined, undefined, undefined, {
        variant: 'danger',
    });
}

// ===================================================================
// addFieldRow — 键值字段行
// ===================================================================

/**
 * 创建字段行（左 label + 右 value），替代手动拼接的
 * `div.slide-item > span.slide-label.field-label + span.field-value`
 */
export function addFieldRow(
    container: HTMLElement,
    label: string,
    value: string
): HTMLElement {
    return slideRow(container, '', label, false, () => {}, undefined, undefined, undefined, undefined, {
        rightLabel: value,
    });
}

// ===================================================================
// sliderRow — addSliderRow 的简化版，只保留 onDragEnd
// ===================================================================

export function sliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    icon: string,
    onDragEnd: (v: number) => void
): void {
    addSliderRow(container, label, value, min, max, step, () => {}, icon, onDragEnd);
}

// ===================================================================
// toggleRow — addToggleRow 的简化版，onChange 后自动调用 onSave
// ===================================================================

export function toggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    icon: string,
    onChange: (v: boolean) => void,
    onSave?: () => void
): void {
    addToggleRow(container, label, value, (v) => {
        onChange(v);
        onSave?.();
    }, icon);
}
