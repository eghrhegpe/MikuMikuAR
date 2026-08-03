// ui-action-bridge.ts — [doc:adr-238] UI 行为注入桥（纯叶子，零依赖）。
// 切断 core（shortcut-app / events / init）→ menus/* 反向依赖：
//   - menus 侧注册 UI 行为（closeAllOverlays / screenshotCurrent / navAction / navLabel / handleAndroidBack / toggleOverlayMode）
//   - core 快捷键层与事件层经本桥调用，不 import menus
// 与 e2e-state-bridge 同模式：core 持注入点，UI 层注册，方向单向。
// 分字段注册（registerUiAction），支持各菜单模块独立注册各自行为。

export interface UiActions {
    /** 关闭全部弹窗/遮罩（Escape 快捷键） */
    closeAllOverlays: () => void;
    /** 截取当前画面（F2 快捷键） */
    screenshotCurrent: () => Promise<void> | void;
    /** 导航按钮/快捷键分发（数字 → 弹窗函数），由 menus/nav-actions 注册 */
    navAction: (index: number) => void | Promise<void>;
    /** 画布点击切换「无 UI / 沉浸」模式，由 menus/nav-actions 注册 */
    toggleOverlayMode: () => void;
    /** 导航按钮标签（数字 → 显示文本），由 menus/nav-actions 注册 */
    navLabel: (index: number) => string;
    /** Android 返回键处理（优先菜单 pop/close，其次关遮罩/退出），由 menus/nav-actions 注册 */
    handleAndroidBack: () => boolean;
    /** 选择资源根目录（settings 动作），由 menus/library-core 注册 */
    selectResourceRoot: () => Promise<void>;
    /** 选择覆写路径（settings 动作），由 menus/library-core 注册 */
    selectOverridePath: (kind: string) => Promise<void>;
    /** 批量截图所有模型（scene 动作），由 menus/scene-menu 注册 */
    screenshotBatch: () => Promise<void>;
    /** 保存场景（scene 动作），由 menus/scene-menu 注册 */
    saveScene: () => Promise<void>;
    /** 获取动作菜单栈（motion 动作），由 menus/motion-popup 注册 */
    getMotionMenu: () => unknown;
    /** 刷新动作菜单根（motion 动作），由 menus/motion-popup 注册 */
    refreshMotionRoot: () => void;
    /** 构建动作菜单根项（motion 动作），由 menus/motion-root-ui 注册 */
    buildMotionRootItems: () => unknown[];
    /** 导入外部动画（motion 动作），由 menus/motion-root-ui 注册 */
    importExternalAnimation: (kind: string) => void;
    /** 处理模型动作（motion 动作），由 menus/motion-binding-ui 注册 */
    handleModelAction: (action: string, modelId?: string) => Promise<void>;
    /** 重置焦点图层（motion 动作），由 menus/motion-binding-ui 注册 */
    resetFocusedLayerId: () => void;
    /** 构建动作绑定层级（motion 动作），由 menus/motion-binding-ui 注册 */
    buildActionBindingLevel: (id?: string) => unknown;
    /** 构建动作详情层级（motion 动作），由 menus/motion-detail-ui 注册 */
    buildMotionDetailLevel: (sceneMotionId?: string) => unknown;
    /** 获取浏览目录（motion 动作），由 library/library-path 注册 */
    getBrowseDir: (kind: string) => string;
    /** 构建菜单浏览层级（motion 动作 browse-*），由 menus/motion-popup 注册 */
    buildBrowseLevel: (args: {
        dir: string;
        label: string;
        filter?: (m: { format?: string }) => boolean;
        targetStack?: unknown;
        extraFolders?: { label: string; path: string }[];
        outcome?: Record<string, unknown>;
    }) => unknown;
}

const _uiActions = new Map<keyof UiActions, unknown>();

/** 注册单个 UI 行为（menus 侧各模块启动时调用，可重复注册覆盖） */
export function registerUiAction<K extends keyof UiActions>(key: K, fn: UiActions[K]): void {
    _uiActions.set(key, fn);
}

/** 读取单个 UI 行为（core 侧调用；未注册返回 undefined） */
export function getUiAction<K extends keyof UiActions>(key: K): UiActions[K] | undefined {
    return _uiActions.get(key) as UiActions[K] | undefined;
}

// 兼容旧调用点（shortcut-app 的 closeAllOverlays/screenshotCurrent 用 getUiActions）
/** 读取 UI 行为集（未完整注册时返回 null） */
export function getUiActions(): UiActions | null {
    const needed: (keyof UiActions)[] = ['closeAllOverlays', 'screenshotCurrent'];
    for (const k of needed) {
        if (!_uiActions.has(k)) {
            return null;
        }
    }
    return _uiActions as unknown as UiActions;
}
