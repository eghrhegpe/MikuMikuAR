// [doc:architecture] Single Renderer for MenuNode Schema — ADR-093
// 遍历 MenuNode 树，按 kind 分发到现有 ui-helpers 生成 DOM。

import type { MenuNode } from './menu-schema';
import { getStateValue, setStateValue, getBindFn } from './menu-schema';
import type { PopupLevel } from '../core/config';
import {
    addSliderRow,
    addColorSliderRow,
    addToggleRow,
    addModeSlider,
    addModeRow,
    addCollapsible,
    addActionRow,
    addSectionTitle,
} from '../core/ui-helpers';
import { t } from '../core/i18n/t';
import { getModuleConflicts } from '../scene/motion/motion-modules/registry';
import { createIconifyIcon } from '../core/icons';
import { focusedModelId } from '../core/state';
import { showInfoToast } from '../core/toast';
import { closeAllOverlays } from './menu-overlay';
import { feedbackStatus } from '../core/feedback';

/** 渲染一个 MenuNode 树到 container 中。返回 dispose 函数，调用时级联释放所有 renderCustom 资源 */
export function renderMenu(schema: MenuNode[], container: HTMLElement): () => void {
    const disposes: (() => void)[] = [];
    for (const node of schema) {
        const d = renderNode(node, container);
        if (d) {
            disposes.push(d);
        }
    }
    return () => {
        for (const d of disposes) {
            d();
        }
    };
}

function renderNode(node: MenuNode, container: HTMLElement): (() => void) | undefined {
    if (node.visibleWhen && !node.visibleWhen()) {
        return undefined;
    }
    switch (node.kind) {
        case 'folder':
            return renderFolder(node, container);
        case 'slider':
            renderSlider(node, container);
            return undefined;
        case 'colorSlider':
            renderColorSlider(node, container);
            return undefined;
        case 'toggle':
            renderToggle(node, container);
            return undefined;
        case 'modeSlider':
            renderModeSlider(node, container);
            return undefined;
        case 'modeRow':
            renderModeRow(node, container);
            return undefined;
        case 'sectionTitle':
            renderSectionTitle(node, container);
            return undefined;
        case 'action':
            renderAction(node, container);
            return undefined;
        case 'divider':
            // 无操作
            return undefined;
        case 'custom': {
            const d = node.renderCustom?.(container);
            return typeof d === 'function' ? d : undefined;
        }
    }
}

// ======== Folder ========

function renderFolder(node: MenuNode, container: HTMLElement): (() => void) | undefined {
    const children: MenuNode[] = node.children ?? [];
    if (children.length === 0 && !node.renderCustom && !node.headerToggle) {
        return undefined;
    }

    let childDispose: (() => void) | undefined;

    addCollapsible(container, {
        title: node.label ? t(node.label) : '',
        icon: node.icon,
        defaultOpen: node.defaultOpen ?? false,
        testId: node.id,
        headerToggle: node.headerToggle
            ? {
                  value: node.headerToggle.get
                      ? node.headerToggle.get(getStateValue(node.headerToggle.bind, node.modelId, node.actionId))
                      : !!getStateValue(node.headerToggle.bind, node.modelId, node.actionId),
                  onChange: (v: boolean) => {
                      setStateValue(
                          node.headerToggle!.bind,
                          node.headerToggle!.set ? node.headerToggle!.set(v) : v,
                          node.modelId,
                          node.actionId
                      );
                      node.headerToggle!.onChange?.(v);
                  },
                  bind: () => {
                      const raw = getBindFn(node.headerToggle!.bind)();
                      return node.headerToggle!.get ? node.headerToggle!.get(raw) : !!raw;
                  },
              }
            : undefined,
        renderContent: (cc) => {
            childDispose = renderMenu(children, cc);
            if (node.renderCustom) {
                const d = node.renderCustom(cc);
                if (d) {
                    const prev = childDispose;
                    childDispose = () => {
                        prev?.();
                        d();
                    };
                }
            }
        },
    });

    return () => childDispose?.();
}

// ======== Slider ========

function renderSlider(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl) {
        return;
    }

    const raw = getStateValue(ctrl.bind, node.modelId, node.actionId);
    const value = ctrl.get ? (ctrl.get(raw) as number) : (raw as number);
    const onChange = (v: number) => {
        setStateValue(ctrl.bind, ctrl.set ? ctrl.set(v) : v, node.modelId, node.actionId);
        ctrl.onChange?.(v);
    };

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
        {
            bind: () =>
                ctrl.get
                    ? (ctrl.get(getBindFn(ctrl.bind)()) as number)
                    : (getBindFn(ctrl.bind)() as number),
            pathHint: ctrl.bind.split('.').pop()!,
        },
        node.id
    );

    // [doc:adr-163] 滑块冲突标记
    if (node.conflictHint && focusedModelId) {
        const conflicts = getModuleConflicts(focusedModelId, node.conflictHint);
        if (conflicts.length > 0) {
            const row = container.lastElementChild as HTMLElement | null;
            const top = row?.querySelector('.cs-top');
            if (top) {
                const warnIcon = createIconifyIcon('lucide:alert-triangle');
                if (warnIcon) {
                    warnIcon.style.color = 'var(--warn)';
                    warnIcon.style.marginLeft = '4px';
                    warnIcon.style.flexShrink = '0';
                    warnIcon.title = t('motion.conflictHint', { module: node.conflictHint });
                    top.appendChild(warnIcon);
                }
            }
        }
    }
}

// ======== Color Slider ========

function renderColorSlider(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl) {
        return;
    }

    const value = getStateValue(ctrl.bind, node.modelId, node.actionId) as [number, number, number];
    const onChange = (v: [number, number, number]) => setStateValue(ctrl.bind, v, node.modelId, node.actionId);

    addColorSliderRow(
        container,
        node.label ? t(node.label) : '',
        value,
        onChange,
        {
            bind: () => getBindFn(ctrl.bind)() as [number, number, number],
            pathHint: ctrl.bind.split('.').pop()!,
        },
        node.id
    );
}

// ======== Toggle ========

function renderToggle(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl) {
        return;
    }

    const raw = getStateValue(ctrl.bind, node.modelId, node.actionId);
    const value = ctrl.get ? (ctrl.get(raw) as boolean) : (raw as boolean);
    const onChange = (v: boolean) => {
        setStateValue(ctrl.bind, ctrl.set ? ctrl.set(v) : v, node.modelId, node.actionId);
        ctrl.onChange?.(v);
    };

    addToggleRow(
        container,
        node.label ? t(node.label) : '',
        value,
        onChange,
        node.icon ?? ctrl.icon,
        {
            bind: () => {
                const r = getBindFn(ctrl.bind)();
                return ctrl.get ? (ctrl.get(r) as boolean) : (r as boolean);
            },
            pathHint: ctrl.bind.split('.').pop()!,
        },
        node.id
    );
}

// ======== Mode Slider ========

function renderModeSlider(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl || !ctrl.options) {
        return;
    }

    const value = getStateValue(ctrl.bind, node.modelId, node.actionId) as string;
    const onChange = (v: string) => {
        setStateValue(ctrl.bind, v, node.modelId, node.actionId);
        ctrl.onChange?.(v);
    };
    const opts = ctrl.options.map((o) => ({ value: o.value, label: t(o.label) }));

    addModeSlider(
        container,
        node.label ? t(node.label) : '',
        opts,
        value,
        onChange,
        node.icon ?? ctrl.icon,
        undefined,
        { bind: () => getBindFn(ctrl.bind)() as string, pathHint: ctrl.bind.split('.').pop()! },
        node.id
    );
}

// ======== Mode Row ========

function renderModeRow(node: MenuNode, container: HTMLElement): void {
    const ctrl = node.control;
    if (!ctrl || !ctrl.options) {
        return;
    }

    const value = getStateValue(ctrl.bind, node.modelId, node.actionId) as string;
    const onChange = (v: string) => {
        setStateValue(ctrl.bind, v, node.modelId, node.actionId);
        ctrl.onChange?.(v);
    };
    const opts = ctrl.options.map((o) => ({ value: o.value, label: t(o.label) }));

    addModeRow(container, node.label ? t(node.label) : '', opts, value, onChange, node.id);
}

// ======== Section Title ========

function renderSectionTitle(node: MenuNode, container: HTMLElement): void {
    if (!node.label) {
        return;
    }
    addSectionTitle(container, t(node.label), node.id);
}

// ======== Action ========

function renderAction(node: MenuNode, container: HTMLElement): void {
    addActionRow(
        container,
        node.label ? t(node.label) : '',
        () => {
            void node.action?.({
                toast: showInfoToast,
                setStatus: (msg: string) => feedbackStatus(msg, undefined, true),
                closeAllOverlays,
            });
        },
        { icon: node.icon, testId: node.id }
    );
}

/**
 * [doc:P6] 构建一个含增量 i18n 刷新的 schema 层级。
 * renderCustom + onLangChange 预绑，语言切换时原地重建 schema DOM，
 * 保留外层 panel 结构/滚动/折叠状态，避免全量 reRender。
 * @param labelKey 标题 i18n key
 * @param schemaBuilder schema 构建函数（每次调用返回新节点，含 t() 求值）
 */
export function buildSchemaLevel(labelKey: string, schemaBuilder: () => MenuNode[]): PopupLevel {
    const containerRef: HTMLElement[] = [];
    return {
        label: t(labelKey),
        dir: '',
        items: [],
        renderCustom: (container) => {
            containerRef[0] = container;
            return renderMenu(schemaBuilder(), container);
        },
        onLangChange: () => {
            const c = containerRef[0];
            if (c) {
                c.innerHTML = '';
                renderMenu(schemaBuilder(), c);
            }
        },
    };
}
