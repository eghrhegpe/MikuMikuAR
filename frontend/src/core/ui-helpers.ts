// [doc:architecture] UI Helpers — 通用 DOM 构建函数
// 从 scene-menu.ts 和 model-detail.ts 提取的统一版本

import { createIconifyIcon } from './icons';

export function slideRow(
    container: HTMLElement,
    icon: string,
    label: string,
    hasArrow: boolean,
    onClick: () => void,
    sublabel?: string,
    tag?: string,
    headerToggle?: {
        value: boolean;
        onChange: (v: boolean) => void;
        disabled?: boolean;
        disabledHint?: string;
        onDisabledClick?: () => void;
    }
): void {
    const row = document.createElement('div');

    if (headerToggle) {
        // 使用 addCollapsible 的 header 样式：图标 + label + toggle + 箭头
        row.className = 'collapsible-header';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'collapsible-icon';
        const iconEl = createIconifyIcon(icon);
        if (iconEl) {
            iconSpan.appendChild(iconEl);
        } else {
            const fb = document.createElement('span');
            fb.className = 'cs-icon-fallback';
            fb.textContent = label.charAt(0) || '?';
            iconSpan.appendChild(fb);
        }
        row.appendChild(iconSpan);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'collapsible-label';
        labelSpan.textContent = label;
        row.appendChild(labelSpan);

        if (sublabel) {
            const sub = document.createElement('span');
            sub.className = 'slide-sublabel';
            sub.textContent = sublabel;
            row.appendChild(sub);
        }

        if (tag) {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'slide-tag';
            tagSpan.textContent = tag;
            row.appendChild(tagSpan);
        }

        // Toggle
        const toggle = document.createElement('label');
        toggle.className = 'toggle header-toggle';
        if (headerToggle.disabled) {
            toggle.classList.add('toggle-disabled');
        }
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = headerToggle.value;
        input.disabled = !!headerToggle.disabled;
        const slider = document.createElement('span');
        slider.className = 'slider';
        toggle.appendChild(input);
        toggle.appendChild(slider);

        if (!headerToggle.disabled) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                input.checked = !input.checked;
                headerToggle.onChange(input.checked);
            });
        } else if (headerToggle.onDisabledClick) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                headerToggle.onDisabledClick!();
            });
        }
        row.appendChild(toggle);

        // Arrow
        if (hasArrow) {
            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'collapsible-arrow';
            arrowSpan.textContent = '▾';
            row.appendChild(arrowSpan);
        }

        row.addEventListener('click', onClick);
    } else {
        // 原始 slide-item 样式（无 toggle）
        row.className = 'slide-item';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'slide-icon';
        const iconEl = createIconifyIcon(icon);
        if (iconEl) {
            iconSpan.appendChild(iconEl);
        } else {
            const fb = document.createElement('span');
            fb.className = 'cs-icon-fallback';
            fb.textContent = label.charAt(0) || '?';
            iconSpan.appendChild(fb);
        }
        row.appendChild(iconSpan);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'slide-label';
        labelSpan.textContent = label;
        row.appendChild(labelSpan);

        if (sublabel) {
            const sub = document.createElement('span');
            sub.className = 'slide-sublabel';
            sub.textContent = sublabel;
            row.appendChild(sub);
        }

        if (tag) {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'slide-tag';
            tagSpan.textContent = tag;
            row.appendChild(tagSpan);
        }

        if (hasArrow) {
            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'slide-arrow';
            arrowSpan.textContent = '>';
            row.appendChild(arrowSpan);
        }

        row.addEventListener('click', onClick);
    }

    container.appendChild(row);
}

export function addToggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    icon?: string
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
}

export function addSliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    icon?: string,
    onDragEndCb?: (v: number) => void
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
}

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

export function addColorSliderRow(
    container: HTMLElement,
    label: string,
    color: [number, number, number],
    onChange: (v: [number, number, number]) => void
): void {
    const block = document.createElement('div');
    block.className = 'clr-block';
    const header = document.createElement('div');
    header.className = 'clr-header';
    const title = document.createElement('span');
    title.className = 'clr-title';
    title.textContent = label;
    title.id = `color-${Math.random().toString(36).slice(2, 11)}`;
    header.appendChild(title);
    const swatch = document.createElement('span');
    swatch.className = 'clr-swatch';
    swatch.style.background = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
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
        fill.style.width = (color[ci] * 100) + '%';

        const thumb = document.createElement('div');
        thumb.className = 'cs-thumb';
        thumb.style.left = (color[ci] * 100) + '%';

        bar.appendChild(fill);
        bar.appendChild(thumb);

        function updateDisplay(v: number): void {
            current[ci] = v;
            val.textContent = v.toFixed(2);
            fill.style.width = (v * 100) + '%';
            thumb.style.left = (v * 100) + '%';
            bar.setAttribute('aria-valuenow', String(v));
            swatch.style.background = `rgb(${Math.round(current[0] * 255)},${Math.round(current[1] * 255)},${Math.round(current[2] * 255)})`;
            onChange([current[0], current[1], current[2]]);
        }

        function setValueFromClientX(clientX: number, rect: DOMRect): void {
            const x = (clientX - rect.left) / rect.width;
            const raw = Math.max(0, Math.min(1, x));
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
                    if (lower !== current[ci]) updateDisplay(lower);
                    break;
                }
                case 'ArrowRight':
                case 'ArrowUp': {
                    e.preventDefault();
                    const upper = Math.min(1, Math.round((current[ci] + delta) * 100) / 100);
                    if (upper !== current[ci]) updateDisplay(upper);
                    break;
                }
                case 'Home':
                    e.preventDefault();
                    if (0 !== current[ci]) updateDisplay(0);
                    break;
                case 'End':
                    e.preventDefault();
                    if (1 !== current[ci]) updateDisplay(1);
                    break;
            }
        }

        bar.addEventListener('click', (e) => {
            e.preventDefault();
            bar.focus();
            const rect = bar.getBoundingClientRect();
            setValueFromClientX(e.clientX, rect);
        });

        bar.addEventListener('keydown', handleKeyDown);

        sub.appendChild(bar);
        sub.appendChild(val);
        block.appendChild(sub);
    }
    container.appendChild(block);
}

export function addModeSlider<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void,
    icon?: string,
    onDragEndCb?: (v: T) => void
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
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    function updateDisplay(idx: number): void {
        currentIndex = idx;
        val.textContent = options[idx].label;
        const newPct = total > 1 ? (idx / (total - 1)) * 100 : 100;
        const clamped = Math.max(0, Math.min(100, newPct));
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        top.setAttribute('aria-valuenow', String(idx));
    }

    function setIndexFromClientX(clientX: number, rect: DOMRect): void {
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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
        document.removeEventListener('mousemove', onTopDragMove);
        document.removeEventListener('mouseup', onTopDragEnd);

        if (!didDrag) {
            // 点击：区分 1/4 大步 vs 1/2 小步
            const rect = top.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const quarter = Math.max(1, Math.floor(total / 4));
            let step: number;
            if (x < 0.25) {
                step = -quarter;       // 左 1/4：后退 quarter 步
            } else if (x < 0.5) {
                step = -1;             // 左半内：后退 1 步
            } else if (x < 0.75) {
                step = 1;              // 右半内：前进 1 步
            } else {
                step = quarter;        // 右 1/4：前进 quarter 步
            }
            const nextIdx = (currentIndex + step + total) % total;
            updateDisplay(nextIdx);
            onChange(options[nextIdx].value);
            onDragEndCb?.(options[nextIdx].value);
        } else {
            // 拖拽结束：提交最终值
            onDragEndCb?.(options[currentIndex].value);
        }
        topDragRect = null;
        didDrag = false;
    }

    // cs-top 处理所有交互（拖拽 + 点击）
    top.addEventListener('mousedown', (e) => {
        e.preventDefault();
        top.focus();
        topDragRect = top.getBoundingClientRect();
        didDrag = false;
        document.addEventListener('mousemove', onTopDragMove);
        document.addEventListener('mouseup', onTopDragEnd);
    });

    top.addEventListener('keydown', handleKeyDown);

    // cs-bar 纯装饰，无事件
    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);
}

/**
 * 通用折叠面板组件
 * @param container 父容器
 * @param config.title 标题
 * @param config.icon Iconify 图标名（可选）
 * @param config.defaultOpen 默认是否展开（默认 false）
 * @param config.renderContent 内容渲染回调
 */
export function addCollapsible(
    container: HTMLElement,
    config: {
        title: string;
        icon?: string;
        variant?: 'default' | 'mat';
        defaultOpen?: boolean;
        headerToggle?: {
            value: boolean;
            onChange: (v: boolean) => void;
        };
        renderContent: (container: HTMLElement) => void;
    }
): void {
    const variant = config.variant ?? 'default';
    const wrapper = document.createElement('div');
    wrapper.className = 'collapsible-wrapper';

    // Header
    const header = document.createElement('div');
    header.className = 'collapsible-header' + (variant === 'mat' ? ' collapsible-mat' : '');

    if (config.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'collapsible-icon';
        const iconEl = createIconifyIcon(config.icon);
        if (iconEl) {
            iconSpan.appendChild(iconEl);
        }
        header.appendChild(iconSpan);
    }

    const label = document.createElement('span');
    label.className = 'collapsible-label';
    label.textContent = config.title;
    header.appendChild(label);

    // Header toggle (between label and arrow)
    if (config.headerToggle) {
        const toggle = document.createElement('label');
        toggle.className = 'toggle header-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = config.headerToggle.value;
        const slider = document.createElement('span');
        slider.className = 'slider';
        toggle.appendChild(input);
        toggle.appendChild(slider);
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            input.checked = !input.checked;
            config.headerToggle!.onChange(input.checked);
        });
        header.appendChild(toggle);
    }

    const arrow = document.createElement('span');
    arrow.className = 'collapsible-arrow' + (variant === 'mat' ? ' arrow' : '');
    arrow.textContent = '▾';
    header.appendChild(arrow);

    // Panel
    const panel = document.createElement('div');
    panel.className =
        'collapsible-panel' + (variant === 'mat' ? ' mat-slider-panel mat-cat-slider' : '');
    const inner = document.createElement('div');
    inner.className = 'collapsible-inner';
    config.renderContent(inner);
    panel.appendChild(inner);

    // State
    let isOpen = config.defaultOpen ?? false;

    function applyState(open: boolean) {
        panel.classList.toggle('open', open);
        header.classList.toggle('open', open);
        arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
        panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0';
    }

    header.addEventListener('click', () => {
        isOpen = !isOpen;
        applyState(isOpen);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(panel);
    container.appendChild(wrapper);

    // Init
    if (isOpen) {
        requestAnimationFrame(() => applyState(true));
    } else {
        panel.style.maxHeight = '0';
    }
}

/**
 * 区块标题（section-title），用于 cardContainer 内的视觉分组。
 * 11px 白色文字，底部 border，和设计规范一致。
 */
export function addSectionTitle(container: HTMLElement, text: string): void {
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = text;
    container.appendChild(title);
}

// ======== 便捷封装 — 新代码推荐使用 ========

/**
 * addSliderRow 的简化版：real-time 回调固定为空，只保留 onDragEnd。
 * 签名：sliderRow(container, label, value, min, max, step, icon, onDragEnd)
 */
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

/**
 * addToggleRow 的简化版：自动在 onChange 后调用 onSave（如 triggerAutoSave）。
 * 签名：toggleRow(container, label, value, icon, onChange, onSave?)
 */
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
