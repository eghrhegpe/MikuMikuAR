// [doc:architecture] ui-header-toggle — 标题栏小型开关（toggle.header-toggle）
// 从 ui-rows 抽出的零依赖叶子：断开 ui-rows ⇄ ui-slide-row 文件级双向环（见 ADR-191 桶文件反向再导出告警）。
// 复用点：menu.ts 弹窗标题 / ui-collapsible 折叠面板 / ui-slide-row 行 / model-material 材质行。
// 统一双触发去重 + bind 自更新 + disabled。

import { getCurrentRenderingMenu } from '../menus/menu';

export interface HeaderToggleConfig {
    value: boolean;
    onChange: (v: boolean) => void;
    /** 自更新：菜单重渲染时调用，返回值变化时同步 input.checked */
    bind?: () => boolean;
    /** 禁用态：input.disabled + toggle-disabled class，不响应 onChange */
    disabled?: boolean;
    /** 禁用态点击回调（如弹出提示） */
    onDisabledClick?: () => void;
    /** 禁用态提示文本（保留字段，由调用方自行消费） */
    disabledHint?: string;
}

/**
 * 创建标题栏小型开关。返回 `<label class="toggle header-toggle">`，
 * 含双触发去重（跳过 target===input 的 synthetic click + preventDefault）。
 * onChange 接收新状态；若需附加 DOM 副作用（如 row.classList.toggle），调用方自行处理。
 */
export function createHeaderToggle(config: HeaderToggleConfig): HTMLLabelElement {
    const toggle = document.createElement('label');
    toggle.className = 'toggle header-toggle';
    if (config.disabled) {
        toggle.classList.add('toggle-disabled');
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config.value;
    input.disabled = !!config.disabled;
    const slider = document.createElement('span');
    slider.className = 'slider';
    toggle.appendChild(input);
    toggle.appendChild(slider);

    if (!config.disabled) {
        // 修复：<label> 包裹 checkbox 时浏览器原生二次派发 click 到 input，导致 handler 双触发。
        // 跳过 synthetic click(target===input) 并 preventDefault 阻止原生切换造成的视觉错位。
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (e.target === input) {
                return;
            }
            e.preventDefault();
            input.checked = !input.checked;
            config.onChange(input.checked);
        });
    } else if (config.onDisabledClick) {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            config.onDisabledClick();
        });
    }

    // bind 自更新：菜单重渲染时同步 input.checked
    if (config.bind) {
        let cached = config.value;
        const update = (): void => {
            const v = !!config.bind!();
            if (v === cached) {
                return;
            }
            cached = v;
            input.checked = v;
        };
        getCurrentRenderingMenu()?.registerControl(update);
    }

    return toggle;
}
