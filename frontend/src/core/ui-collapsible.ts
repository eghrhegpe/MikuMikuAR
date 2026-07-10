// [doc:architecture] ui-collapsible — 折叠面板 + preset-chip + 区块标题
// addCollapsible / addPresetChip / addSectionTitle

import { createIconifyIcon } from './icons';
import { getCurrentRenderingMenu } from '../menus/menu';

// ===================================================================
// addCollapsible
// ===================================================================

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
            /** 声明取值方式，updateControls() 时自动同步 toggle 状态 */
            bind?: () => boolean;
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

        // === headerToggle 自更新支持 ===
        if (config.headerToggle.bind) {
            let cachedValue = config.headerToggle.value;
            const update = (): void => {
                const newVal = !!config.headerToggle!.bind!();
                if (newVal === cachedValue) {
                    return;
                }
                cachedValue = newVal;
                input.checked = newVal;
            };
            getCurrentRenderingMenu()?.registerControl(update);
        }
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

// ===================================================================
// addSectionTitle
// ===================================================================

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

// ===================================================================
// addPresetChip
// ===================================================================

/**
 * 创建一个 preset-chip 按钮并追加到 container（通常是 .preset-group div）。
 * 极简工具：只管单个 chip 的创建+追加，group 容器和数据源由调用方管理。
 *
 * @param container 父容器（一般是 div.preset-group）
 * @param label     按钮文本
 * @param active    是否激活（追加 'active' class）
 * @param onClick   点击回调
 * @param opts      自更新选项（onUpdate 自定义更新逻辑）
 * @returns 创建的 button 元素（调用方可继续加内联 style 等）
 */
export function addPresetChip(
    container: HTMLElement,
    label: string,
    active: boolean,
    onClick: () => void,
    opts?: { onUpdate?: (btn: HTMLButtonElement) => void; wrap?: boolean }
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'preset-chip' + (active ? ' active' : '') + (opts?.wrap ? ' wrap-2' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    container.appendChild(btn);

    // === 自更新支持 ===
    if (opts?.onUpdate) {
        const update = () => opts.onUpdate!(btn);
        getCurrentRenderingMenu()?.registerControl(update);
        update();
    }

    return btn;
}
