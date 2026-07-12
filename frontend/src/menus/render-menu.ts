// [doc:architecture] Single Renderer for MenuNode Schema — ADR-093
// 遍历 MenuNode 树，按 kind 分发到现有 ui-helpers 生成 DOM。

import type { MenuNode } from './menu-schema';
import { getStateValue, setStateValue, getBindFn } from './menu-schema';
import { addSliderRow, addColorSliderRow, addToggleRow, addModeSlider, addCollapsible } from '../core/ui-helpers';
import { t } from '../core/i18n/t';

/** 渲染一个 MenuNode 树到 container 中 */
export function renderMenu(schema: MenuNode[], container: HTMLElement): void {
    for (const node of schema) {
        renderNode(node, container);
    }
}

function renderNode(node: MenuNode, container: HTMLElement): void {
    switch (node.kind) {
        case 'folder':
            renderFolder(node, container);
            break;
        case 'slider':
            renderSlider(node, container);
            break;
        case 'colorSlider':
            renderColorSlider(node, container);
            break;
        case 'toggle':
            renderToggle(node, container);
            break;
        case 'modeSlider':
            renderModeSlider(node, container);
            break;
        case 'divider':
            // 无操作，未来可添加分隔线 DOM
            break;
    }
}

// ======== Folder ========

function renderFolder(node: MenuNode, container: HTMLElement): void {
    const children: MenuNode[] = node.children ?? [];
    if (children.length === 0 && !node.renderCustom) return;

    addCollapsible(container, {
        title: node.label ? t(node.label) : '',
        icon: node.icon,
        defaultOpen: node.defaultOpen ?? false,
        headerToggle: node.headerToggle
            ? {
                  value: node.headerToggle.get
                      ? node.headerToggle.get(getStateValue(node.headerToggle.bind))
                      : !!getStateValue(node.headerToggle.bind),
                  onChange: (v: boolean) =>
                      setStateValue(
                          node.headerToggle!.bind,
                          node.headerToggle!.set ? node.headerToggle!.set(v) : v,
                      ),
                  bind: () => {
                      const raw = getBindFn(node.headerToggle!.bind)();
                      return node.headerToggle!.get ? node.headerToggle!.get(raw) : !!raw;
                  },
              }
            : undefined,
        renderContent: (cc) => {
            // 先渲染子节点
            renderMenu(children, cc);
            // 如果有自定义渲染，追加
            if (node.renderCustom) {
                node.renderCustom(cc);
            }
        },
    });
}

// ======== Slider ========

function renderSlider(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl) return;

    const value = getStateValue(ctrl.bind) as number;
    const onChange = (v: number) => setStateValue(ctrl.bind, v);

    addSliderRow(
        container,
        node.label ? t(node.label) : '',
        value,
        ctrl.min ?? 0,
        ctrl.max ?? 1,
        ctrl.step ?? 0.1,
        onChange,
        node.icon ?? ctrl.icon,
        undefined,
        { bind: () => getBindFn(ctrl.bind)() as number }
    );
}

// ======== Color Slider ========

function renderColorSlider(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl) return;

    const value = getStateValue(ctrl.bind) as [number, number, number];
    const onChange = (v: [number, number, number]) => setStateValue(ctrl.bind, v);

    addColorSliderRow(
        container,
        node.label ? t(node.label) : '',
        value,
        onChange,
        { bind: () => getBindFn(ctrl.bind)() as [number, number, number] }
    );
}

// ======== Toggle ========

function renderToggle(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl) return;

    const value = getStateValue(ctrl.bind) as boolean;
    const onChange = (v: boolean) => setStateValue(ctrl.bind, v);

    addToggleRow(
        container,
        node.label ? t(node.label) : '',
        value,
        onChange,
        node.icon ?? ctrl.icon,
        { bind: () => getBindFn(ctrl.bind)() as boolean }
    );
}

// ======== Mode Slider ========

function renderModeSlider(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl || !ctrl.options) return;

    const value = getStateValue(ctrl.bind) as string;
    const onChange = (v: string) => setStateValue(ctrl.bind, v);

    addModeSlider(
        container,
        node.label ? t(node.label) : '',
        ctrl.options,
        value,
        onChange,
        node.icon ?? ctrl.icon,
        undefined,
        { bind: () => getBindFn(ctrl.bind)() as string }
    );
}