// [doc:adr-093] 菜单声明式 Schema —— 类型定义
// 单一数据源 + 单渲染器，所有菜单从 MenuNode 树派生。
// 状态：规划 — 等待 P0 试点落地

import type { SlideMenu } from '../menus/menu';

// ======== 状态路径 ========

/**
 * 类型化状态路径，由 schema 引擎按前缀解析到已存在的 reactive 访问器。
 *   'env.*'    → envState（core/state.ts 中已是 reactive<EnvState>）
 *   'render.*' → getRenderState()
 *   'ui.*'     → uiState
 *   'motion.*' → motionState
 */
export type StatePath = `${'env' | 'render' | 'ui' | 'motion'}.${string}`;

// ======== 控件类型 ========

/** 控件参数 + 状态绑定，替代内联 onChange/bind 闭包 */
export interface ControlSpec {
    type: 'slider' | 'toggle' | 'modeSlider' | 'chips' | 'color';
    /** 状态绑定：type 化 state path + 可选的 get/set 转换器 */
    bind: {
        state: StatePath;
        get?: (raw: unknown) => unknown;
        set?: (raw: unknown, value: unknown) => unknown;
    };
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    /** modeSlider/chips 的选项 */
    options?: Array<{ label: string; value: string }>;
}

// ======== 菜单节点类型 ========

export type MenuKind =
    | 'folder'      // 静态子层，children 展开
    | 'action'      // 执行 action
    | 'divider'
    | 'slider'
    | 'toggle'
    | 'modeSlider'
    | 'chips'
    | 'color'
    | 'dynamic';    // 运行时由 childrenResolver 生成子项

/** 渲染上下文，由 renderMenu 创建并传入控件/自定义渲染函数 */
export interface MenuCtx {
    /** 当前 SlideMenu 实例，用于 registerControl / push / dispose */
    menu: SlideMenu;
    /** 注册一个自更新控件 */
    registerControl: (update: () => void) => void;
    /** 设置状态提示 */
    setStatus: (msg: string, isGood?: boolean) => void;
}

/** 声明式菜单节点 */
export interface MenuNode {
    /** 稳定唯一 id，路由由此派生 */
    id: string;
    /** 节点类型 */
    kind: MenuKind;
    /** i18n key，渲染时经 t() 解析 */
    label: string;
    /** lucide 图标名 */
    icon?: string;
    /** 初始是否展开（仅 folder 有效） */
    defaultOpen?: boolean;
    /** 标题栏开关（仅 folder 有效） */
    headerToggle?: {
        bind: { state: StatePath; get?: (raw: unknown) => boolean; set?: (raw: unknown, v: boolean) => unknown };
    };
    /** 静态子层 */
    children?: MenuNode[];
    /** dynamic 节点运行时子项生成器 */
    childrenResolver?: (ctx: MenuCtx) => MenuNode[];
    /** 控件参数 */
    control?: ControlSpec;
    /** action 行为 */
    action?: (ctx: MenuCtx) => void | Promise<void>;
    /** 破坏性操作确认文案 i18n key */
    confirm?: string;
    /** 自定义渲染逃生舱；返回 { el, dispose? } 或 void */
    renderCustom?: (ctx: MenuCtx) => { el: HTMLElement; dispose?: () => void } | void;
    /** 可见性守卫 */
    visibleWhen?: (ctx: MenuCtx) => boolean;
    /** dynamic 节点无子项时的空状态文案 i18n key */
    emptyHint?: string;
}