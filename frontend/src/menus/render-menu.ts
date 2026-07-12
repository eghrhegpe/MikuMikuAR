// [doc:adr-093] 菜单声明式 Schema —— 单渲染器
// 走查 MenuNode 树，按 kind 复用现有 ui-helpers 生成 DOM。

import type { MenuNode, MenuCtx } from './menu-schema';
import { t } from '../core/i18n/t';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    addPresetChip,
} from '../core/ui-helpers';
import { createIconifyIcon } from '../core/icons';
import { getCurrentRenderingMenu } from './menu';
import { envState } from '../core/config';
import { uiState } from '../core/state';

// ======== 状态访问器 ========

function resolveState(path: string): { obj: Record<string, unknown>; key: string } {
    const dot = path.indexOf('.');
    if (dot < 0) throw new Error(`[renderMenu] invalid StatePath: ${path}`);
    const prefix = path.slice(0, dot);
    const key = path.slice(dot + 1);
    switch (prefix) {
        case 'env':
            return { obj: envState as unknown as Record<string, unknown>, key };
        case 'ui':
            return { obj: uiState as unknown as Record<string, unknown>, key };
        default:
            throw new Error(`[renderMenu] unknown state prefix: ${prefix}`);
    }
}

function getState(path: string): unknown {
    const { obj, key } = resolveState(path);
    return obj[key];
}

function setState(path: string, value: unknown): void {
    const { obj, key } = resolveState(path);
    obj[key] = value;
}

// ======== 创建渲染上下文 ========

function createCtx(): MenuCtx {
    const menu = getCurrentRenderingMenu();
    if (!menu) throw new Error('[renderMenu] no current rendering menu');
    return {
        menu,
        registerControl: (update) => menu.registerControl(update),
        setStatus: (msg, isGood) => {
            // 导入 setStatus 有循环依赖风险，暂用简单方式
            const el = document.getElementById('statusBar');
            if (el) el.textContent = msg;
        },
    };
}

// ======== 绑定工具 ========

function makeBind(bind: { state: string; get?: (raw: unknown) => unknown; set?: (raw: unknown, v: unknown) => unknown }) {
    return {
        bind: () => {
            const raw = getState(bind.state);
            return bind.get ? bind.get(raw) : raw;
        },
        onChange: (v: unknown) => {
            const raw = getState(bind.state);
            setState(bind.state, bind.set ? bind.set(raw, v) : v);
        },
    };
}

// ======== 单渲染器 ========

/**
 * 渲染一个 MenuNode 树到 container 中。
 * 顶层调用：renderMenu(container, schema, ctx)
 * 递归调用：renderChildren(container, children, ctx)
 */
export function renderMenu(
    container: HTMLElement,
    nodes: MenuNode[],
    ctx?: MenuCtx
): void {
    const c = ctx ?? createCtx();
    for (const node of nodes) {
        if (node.visibleWhen && !node.visibleWhen(c)) {
            continue;
        }
        renderNode(container, node, c);
    }
}

function renderNode(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    switch (node.kind) {
        case 'folder':
            renderFolder(container, node, ctx);
            break;
        case 'divider':
            // 简单分隔线
            const div = document.createElement('div');
            div.className = 'menu-divider';
            container.appendChild(div);
            break;
        case 'action':
            renderAction(container, node, ctx);
            break;
        case 'toggle':
            renderToggle(container, node, ctx);
            break;
        case 'slider':
            renderSlider(container, node, ctx);
            break;
        case 'modeSlider':
            renderModeSlider(container, node, ctx);
            break;
        case 'color':
            renderColor(container, node, ctx);
            break;
        case 'dynamic':
            renderDynamic(container, node, ctx);
            break;
        default:
            // 未知 kind，尝试 renderCustom
            if (node.renderCustom) {
                const result = node.renderCustom(ctx);
                if (result) {
                    container.appendChild(result.el);
                }
            }
            break;
    }
}

function renderFolder(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    // 使用现有 addCollapsible 机制
    addCollapsible(container, {
        title: node.label,
        icon: node.icon,
        defaultOpen: node.defaultOpen ?? false,
        headerToggle: node.headerToggle
            ? {
                  value: node.headerToggle.bind.get
                      ? (node.headerToggle.bind.get(getState(node.headerToggle.bind.state)) as boolean)
                      : (getState(node.headerToggle.bind.state) as boolean),
                  onChange: (v) => {
                      const raw = getState(node.headerToggle!.bind.state);
                      setState(
                          node.headerToggle!.bind.state,
                          node.headerToggle!.bind.set ? node.headerToggle!.bind.set(raw, v) : v
                      );
                  },
                  bind: () => {
                      const raw = getState(node.headerToggle!.bind.state);
                      return node.headerToggle!.bind.get
                          ? (node.headerToggle!.bind.get(raw) as boolean)
                          : (raw as boolean);
                  },
              }
            : undefined,
        renderContent: (cc) => {
            if (node.children) {
                renderMenu(cc, node.children, ctx);
            }
            if (node.renderCustom) {
                const result = node.renderCustom(ctx);
                if (result) {
                    cc.appendChild(result.el);
                }
            }
        },
    });
    // 注册 collapsible 的自更新
    // addCollapsible 内部已有 registerControl 调用
}

function renderAction(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    slideRow(
        container,
        node.icon ?? 'lucide:chevron-right',
        node.label,
        false,
        () => {
            node.action?.(ctx);
        }
    );
}

function renderToggle(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    if (!node.control) return;
    const b = makeBind(node.control.bind);
    addToggleRow(
        container,
        node.label,
        b.bind() as boolean,
        b.onChange,
        node.icon,
        { bind: b.bind as () => boolean }
    );
}

function renderSlider(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    if (!node.control) return;
    const b = makeBind(node.control.bind);
    const value = b.bind() as number;
    addSliderRow(
        container,
        node.label,
        value,
        node.control.min ?? 0,
        node.control.max ?? 1,
        node.control.step ?? 0.1,
        b.onChange,
        node.icon,
        undefined,
        { bind: b.bind as () => number }
    );
}

function renderModeSlider(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    if (!node.control || !node.control.options) return;
    const b = makeBind(node.control.bind);
    addModeSlider(
        container,
        node.label,
        node.control.options,
        b.bind() as string,
        b.onChange,
        node.icon,
        undefined,
        { bind: b.bind as () => string }
    );
}

function renderColor(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    if (!node.control) return;
    const b = makeBind(node.control.bind);
    addColorSliderRow(
        container,
        node.label,
        b.bind() as [number, number, number],
        b.onChange,
        { bind: b.bind as () => [number, number, number] }
    );
}

function renderDynamic(container: HTMLElement, node: MenuNode, ctx: MenuCtx): void {
    if (!node.childrenResolver) return;
    const children = node.childrenResolver(ctx);
    if (children.length === 0 && node.emptyHint) {
        const hint = document.createElement('div');
        hint.className = 'menu-empty-hint';
        hint.textContent = node.emptyHint;
        container.appendChild(hint);
        return;
    }
    renderMenu(container, children, ctx);
}