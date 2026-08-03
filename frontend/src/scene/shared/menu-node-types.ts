// menu-node-types.ts — [doc:adr-238] MenuNode 类型契约（纯类型叶，零运行时依赖）。
// 下沉自 menus/menu-schema（ADR-238 Phase 3：切 scene/motion→menus type-only 边）：
//   - menus/menu-schema 定义并 re-export（保持既有消费者兼容）
//   - scene/motion/motion-modules/{module-base,types} 从本叶引用（不再 import menus）
// 方向：domain 定义 schema 类型 → UI 渲染，双方都依赖本叶。

/** 状态路径：类型化字符串，由解析器按前缀映射到 reactive state 对象 */
export type StatePath =
    | `env.${string}`
    | `render.${string}`
    | `light.${string}`
    | `ui.${string}`
    | `perception.${string}`
    | `motionModule.${string}`;

export interface ActionMenuCtx {
    /** 通知 toast */
    toast: (message: string) => void;
    /** 设置状态栏文本 */
    setStatus: (message: string) => void;
    /** 关闭所有覆盖层 */
    closeAllOverlays: () => void;
}

export type MenuKind =
    | 'folder'
    | 'slider'
    | 'colorSlider'
    | 'toggle'
    | 'modeSlider'
    | 'modeRow'
    | 'sectionTitle'
    | 'action'
    | 'divider'
    | 'custom';

export interface ControlSpec {
    bind: StatePath;
    min?: number;
    max?: number;
    step?: number;
    icon?: string;
    options?: Array<{ value: string; label: string }>; // modeSlider 用
    /** 衍生控件：从状态值转控件显示值（如 windDirection→角度，或 frameCapEnabled 默认值→boolean） */
    get?: (v: unknown) => unknown;
    /** 衍生控件：从控件值转状态值（如 角度→[sin,y,cos]，或 boolean→状态值） */
    set?: (v: unknown) => unknown;
    /** 控件值变更后的副作用（如 reflectionQuality 变化后重建水体） */
    onChange?: (v: unknown) => void;
}

export interface MenuNode {
    id: string;
    kind: MenuKind;
    label?: string; // i18n key，folder/divider 不需要
    icon?: string;
    defaultOpen?: boolean; // 仅 folder
    headerToggle?: {
        bind: StatePath;
        /** 将状态值转为 boolean（如 groundType='terrain'→true） */
        get?: (v: unknown) => boolean;
        /** 将 toggle boolean 转为状态值（如 true→'terrain'） */
        set?: (v: boolean) => unknown;
        /** 切换后的额外回调（如 activatePerception + triggerAutoSave） */
        onChange?: (v: unknown) => void;
    };
    children?: MenuNode[]; // 仅 folder
    control?: ControlSpec; // slider/colorSlider/toggle
    /** 逃生舱：无法数据化的内容直接渲染。返回值（可选）为 dispose 函数，由 renderMenu 收集并级联释放 */
    renderCustom?: (container: HTMLElement) => (() => void) | void;
    /** 条件守卫：返回 false 时该节点不渲染（如 groundType !== 'terrain' 时隐藏 pitch/roll） */
    visibleWhen?: () => boolean;
    /** action 类型节点的回调（含 toast/setStatus/closeOverlays 上下文） */
    action?: (ctx: ActionMenuCtx) => void | Promise<void>;
    /** [doc:adr-163] 冲突提示：对应感知层/模块层 moduleId，渲染时若该模块骨骼被抢占则显示警告图标 */
    conflictHint?: string;
    /** [doc:adr-166] 模型 ID 覆写：感知层 path 时优先读/写指定模型的 ctx.state，而非焦点模型 */
    modelId?: string;
    /** [fix:P2] 查看的动作 id：motionModule path 时读写指定动作的模块配置，缺省回退激活动作 */
    actionId?: string;
}
