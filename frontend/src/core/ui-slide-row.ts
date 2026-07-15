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

export interface TrailingAction {
    /** 图标：含 ':' 视为 iconify 名（如 'lucide:settings-2'）渲染为 SVG；否则作为字面字符（如 '▶'）。 */
    icon: string;
    title?: string;
    danger?: boolean;
    onClick: (e: MouseEvent) => void;
}

/**
 * 统一尾部第二动作按钮工厂——供 slideRow 与 menu.ts createRow 共用，
 * 确保两条渲染路径的第二按钮观感与行为一致（22px .slide-add-btn；iconify 名渲染 SVG，
 * 否则 textContent；点击 stopPropagation 防冒泡触发整行 onClick）。
 */
export function createTrailingBtn(act: TrailingAction): HTMLElement {
    const btn = document.createElement('span');
    btn.className = 'slide-add-btn' + (act.danger ? ' slide-act-danger' : '');
    if (act.icon.includes(':')) {
        const iconEl = createIconifyIcon(act.icon);
        if (iconEl) {
            btn.appendChild(iconEl);
        } else {
            btn.textContent = act.icon;
        }
    } else {
        btn.textContent = act.icon;
    }
    btn.title = act.title || '';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        act.onClick(e);
    });
    return btn;
}

export interface SlideRowExtra {
    /** label 颜色变体：danger(红), accent(主题色) */
    variant?: 'default' | 'danger' | 'accent';
    /** 统一尾部行为区：传入则在行最右侧渲染为可点击图标，并【不】渲染装饰性 `>`。
     *  用于「+ 加载」「▶ 播放」「✕ 删除」等第二动作；与 hasArrow 互斥，
     *  从构造上杜绝「文件行既渲染 + 又渲染 >」的误渲染。 */
    trailing?: TrailingAction;
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

        // === 统一尾部行为区：trailing 优先于装饰性 `>`（互斥，避免误渲染 `>`）===
        if (extra?.trailing) {
            row.appendChild(createTrailingBtn(extra.trailing));
        } else if (hasArrow) {
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
