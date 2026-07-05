// [doc:architecture] slideRow — 菜单行组件
// 带图标+标签+箭头+可选 sublabel/tag/headerToggle 的通用菜单行

import { createIconifyIcon } from './icons';
import { getCurrentRenderingMenu } from '../menus/menu';

export function slideRow(
    container: HTMLElement,
    icon: string,
    label: string,
    hasArrow: boolean,
    onClick: () => void,
    sublabel?: string,
    tag?: string,
    focused?: boolean,
    headerToggle?: {
        value: boolean;
        onChange: (v: boolean) => void;
        disabled?: boolean;
        disabledHint?: string;
        onDisabledClick?: () => void;
        /** 声明取值方式，updateControls() 时自动同步 toggle 状态 */
        bind?: () => boolean;
    }
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
    return row;
}
