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

export interface SlideAction {
    icon: string;
    title?: string;
    danger?: boolean;
    onClick: (e: MouseEvent) => void;
}

export interface SlideRowExtra {
    /** label 颜色变体：danger(红), accent(主题色) */
    variant?: 'default' | 'danger' | 'accent';
    /** 右侧操作按钮图标（如 '✕', '▶', '✎'）— 单个按钮快捷方式 */
    actionIcon?: string;
    /** 操作按钮点击回调（配合 actionIcon） */
    onActionClick?: (e: MouseEvent) => void;
    /** 多操作按钮数组（与 actionIcon 叠加渲染） */
    actionIcons?: SlideAction[];
    /** 自定义右侧 label（key-value 布局用） */
    rightLabel?: string;
    /** 动态图标工厂函数——替代 icon 字符串参数，每次渲染调用 */
    iconFactory?: () => HTMLElement;
    /** sublabel 内联在 label 后（而非右对齐），适合需要 text-overflow 的场景 */
    inlineSub?: boolean;
    /** label 允许双行显示（用于长文件名等场景） */
    wrapLabel?: boolean;
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
            // 修复：<label> 包裹 checkbox 时浏览器会原生二次派发 click 到 input，导致 handler 双触发。
            // 跳过 synthetic click(target===input) 并 preventDefault 阻止原生切换造成的视觉错位。
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.target === input) {
                    return;
                }
                e.preventDefault();
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
                if (newVal === cachedValue) {
                    return;
                }
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
        if (extra?.iconFactory) {
            const el = extra.iconFactory();
            if (el) {
                iconSpan.appendChild(el);
            }
        } else {
            const iconEl = createIconifyIcon(icon);
            if (iconEl) {
                iconSpan.appendChild(iconEl);
            } else {
                const fb = document.createElement('span');
                fb.className = 'cs-icon-fallback';
                fb.textContent = label.charAt(0) || '?';
                iconSpan.appendChild(fb);
            }
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
            let labelCls = 'slide-label';
            if (variant === 'danger') {
                labelCls += ' danger-text';
            } else if (variant === 'accent') {
                labelCls += ' accent-text';
            }
            if (extra?.wrapLabel) {
                labelCls += ' wrap-2';
            }
            labelSpan.className = labelCls;
            labelSpan.textContent = label;
            row.appendChild(labelSpan);
        }

        if (sublabel) {
            const sub = document.createElement('span');
            sub.className = 'slide-sublabel' + (extra?.inlineSub ? ' slide-sublabel-inline' : '');
            sub.textContent = sublabel;
            row.appendChild(sub);
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
        // 多操作按钮数组
        if (extra?.actionIcons?.length) {
            for (const act of extra.actionIcons) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-ghost btn-sm btn-icon slide-act-btn';
                if (act.danger) {
                    btn.classList.add('slide-act-danger');
                }
                btn.textContent = act.icon;
                btn.title = act.title || '';
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    act.onClick(e);
                });
                row.appendChild(btn);
            }
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
