// [doc:architecture] slideRow — 菜单行组件
// 带图标+标签+箭头+可选 sublabel/tag/headerToggle + actionBtn + variant 的通用菜单行

import { createIconifyIcon } from './icons';
import { getCurrentRenderingMenu } from '../menus/menu';

export interface HeaderToggleConfig {
    value: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    disabledHint?: string;
    onDisabledClick?: () => void;
    /** 声明取值方式，updateControls() 时自动同步 toggle 状态 */
    bind?: () => boolean;
}

export interface SlideRowExtra {
    /** 危险操作行（label 变红） */
    variant?: 'default' | 'danger';
    /** 右侧操作按钮图标（如 '✕', '▶', '✎'）*/
    actionIcon?: string;
    /** 操作按钮点击回调 */
    onActionClick?: (e: MouseEvent) => void;
    /** 自定义右侧 label（key-value 布局用） */
    rightLabel?: string;
}

export function slideRow(
    container: HTMLElement,
    icon: string,
    label: string,
    hasArrow: boolean,
    onClick: () => void,
    sublabel?: string,
    tag?: string,
    focused?: boolean,
    headerToggle?: HeaderToggleConfig,
    extra?: SlideRowExtra
): HTMLElement {
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

        // === headerToggle 自更新支持 ===
        if (headerToggle.bind) {
            let cachedValue = headerToggle.value;
            const update = (): void => {
                const newVal = !!headerToggle!.bind!();
                if (newVal === cachedValue) return;
                cachedValue = newVal;
                input.checked = newVal;
            };
            getCurrentRenderingMenu()?.registerControl(update);
        }

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
        const variant = extra?.variant ?? 'default';
        row.className = 'slide-item' + (focused ? ' slide-focused' : '');

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

        // 右侧 label（key-value 布局）
        if (extra?.rightLabel !== undefined) {
            // 左侧 label（字段名）
            const leftSpan = document.createElement('span');
            leftSpan.className = 'slide-label field-label';
            leftSpan.textContent = label;
            row.appendChild(leftSpan);
            // 右侧 label（字段值）
            const rightSpan = document.createElement('span');
            rightSpan.className = 'field-value';
            rightSpan.textContent = extra.rightLabel;
            row.appendChild(rightSpan);
        } else {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'slide-label' + (variant === 'danger' ? ' danger-text' : '');
            labelSpan.textContent = label;
            row.appendChild(labelSpan);
        }

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

        // 操作按钮 (actionBtn)
        if (extra?.actionIcon !== undefined) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-ghost btn-sm btn-icon slide-act-btn';
            btn.textContent = extra.actionIcon;
            if (extra.onActionClick) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    extra.onActionClick!(e);
                });
            }
            row.appendChild(btn);
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
    return row;
}
