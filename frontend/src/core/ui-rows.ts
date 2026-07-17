// [doc:architecture] ui-rows — 菜单行控件（toggle/slider/mode）
// addToggleRow / addSliderRow / addModeRow / sliderRow / toggleRow

import { createIconifyIcon } from './icons';
import { getCurrentRenderingMenu } from '../menus/menu';
import { ControlOptions } from './ui-types';
import { slideRow } from './ui-slide-row';
import { t } from './i18n/t';
import { clamp01, clampPct, swallowError } from '@/core/utils';

// ===================================================================
// addToggleRow
// ===================================================================

// 自增计数器，用于生成稳定的唯一 ID
let nextToggleId = 0;

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
    lbl.id = `toggle-${++nextToggleId}`;
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
        if ((e.target as HTMLElement).closest('.toggle')) {
            return;
        }
        toggle.checked = !toggle.checked;
        toggle.setAttribute('aria-checked', String(toggle.checked));
        onChange(toggle.checked);
    });

    container.appendChild(row);

    // === 自更新支持 ===
    initControl(row, opts, value, (v, cached) => {
        const b = !!v;
        if (b === cached) {
            return false;
        }
        toggle.checked = b;
        toggle.setAttribute('aria-checked', String(b));
        return true;
    });
}

// ===================================================================
// initControl — 控件自更新注册 + 立即初始化
// ===================================================================

/**
 * 封装 registerControl + immediate update 模式。
 * `apply` 返回 true 表示值已变更，用于更新缓存。
 */
export function initControl<T>(
    el: HTMLElement,
    opts: ControlOptions<T> | undefined,
    initial: T,
    apply: (v: T, cached: T) => boolean
): void {
    if (!opts) {
        return;
    }
    let cached = initial;
    const update = (): void => {
        if (opts.onUpdate) {
            opts.onUpdate(el);
            return;
        }
        if (!opts.bind) {
            return;
        }
        const v = opts.bind();
        if (apply(v, cached)) {
            cached = v;
        }
    };
    getCurrentRenderingMenu()?.registerControl(update);
    update();
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
    // 防御: 非有限数值（undefined/NaN）回落到 min ?? 0，避免 .toFixed() 崩溃导致整个面板渲染失败
    let currentValue = typeof value === 'number' && Number.isFinite(value) ? value : (min ?? 0);
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
    fill.style.width = clampPct(pct) + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = clampPct(pct) + '%';

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
        const clamped = clampPct(newPct);
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        bar.setAttribute('aria-valuenow', String(v));
    }

    function setValueFromClientX(clientX: number, rect: DOMRect): void {
        const x = (clientX - rect.left) / rect.width;
        const raw = min + clamp01(x) * range;
        const snapped = snapToStep(raw);
        const clamped = Math.max(min, Math.min(max, snapped));
        if (clamped !== currentValue) {
            updateDisplay(clamped);
            onChange(clamped);
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
        // 四分位分区增量：左区大幅减(-15%)→中左微调(-5%)→中右微增(+5%)→右区大幅增(+15%)
        if (x < 0.25) {
            delta = -(range * 0.15);
        } else if (x < 0.5) {
            delta = -(range * 0.05);
        } else if (x < 0.75) {
            delta = range * 0.05;
        } else {
            delta = range * 0.15;
        }
        // 确保 delta 至少为 step，避免小 range + integer step 下 snap 回原值
        if (Math.abs(delta) < step) {
            delta = Math.sign(delta || step) * step;
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
    initControl(row, opts, value, (v, cached) => {
        if (!Number.isFinite(v) || v === cached) {
            return false;
        }
        updateDisplay(v);
        return true;
    });
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
    return slideRow(
        container,
        icon,
        label,
        false,
        onClick,
        undefined,
        undefined,
        undefined,
        undefined,
        {
            variant: 'danger',
        }
    );
}

// ===================================================================
// addFieldRow — 键值字段行
// ===================================================================

/**
 * 创建字段行（左 label + 右 value），替代手动拼接的
 * `div.slide-item > span.slide-label.field-label + span.field-value`
 */
export function addFieldRow(container: HTMLElement, label: string, value: string): HTMLElement {
    return slideRow(
        container,
        '',
        label,
        false,
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        {
            rightLabel: value,
        }
    );
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
    addToggleRow(
        container,
        label,
        value,
        (v) => {
            onChange(v);
            onSave?.();
        },
        icon
    );
}

// ===================================================================
// addWatchDirRow — 监听目录行（状态 + 只读输入框 + 选择按钮）
// 替代 settings-filename.ts 中 ~40 行手写 DOM 孤岛代码
// ===================================================================

export function addWatchDirRow(
    container: HTMLElement,
    onRefreshStatus: (setStatusText: (text: string) => void) => Promise<void>,
    onSelectDir: () => Promise<string | undefined>
): void {
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-size:11px;color:var(--text);padding:4px 14px;';
    container.appendChild(statusEl);

    const setStatusText = (text: string) => {
        statusEl.textContent = text;
    };

    onRefreshStatus(setStatusText).catch(() => setStatusText(t('settings.paths.watchStopped')));

    const dirRow = document.createElement('div');
    dirRow.style.cssText = 'display:flex;gap:6px;padding:6px 14px;';

    const dirInput = document.createElement('input');
    dirInput.type = 'text';
    dirInput.placeholder = t('settings.paths.watchDirPlaceholder');
    dirInput.readOnly = true;
    dirInput.style.cssText =
        'flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;';

    const selectBtn = document.createElement('button');
    selectBtn.textContent = '📁';
    selectBtn.className = 'mode-btn';
    selectBtn.addEventListener('click', async () => {
        const dir = await onSelectDir();
        if (!dir) {
            return;
        }
        dirInput.value = dir;
        await onRefreshStatus(setStatusText);
    });

    // 回填初始目录
    swallowError(
        onRefreshStatus(async (text) => {
            const prefix = t('settings.paths.watching')
                .replace(/\{dir\}/g, '')
                .replace(/\s+$/, '');
            const match = text.match(new RegExp(prefix + '\\s*(.+)'));
            if (match) {
                dirInput.value = match[1];
            }
        })
    );

    dirRow.appendChild(dirInput);
    dirRow.appendChild(selectBtn);
    container.appendChild(dirRow);
}
