// ui-action-bridge.ts — [doc:adr-238] UI 行为注入桥（纯叶子，零依赖）。
// 切断 core/shortcut-app → menus/* 反向依赖：
//   - menus 侧注册 UI 行为（closeAllOverlays / screenshotCurrent）
//   - core 快捷键层经本桥调用，不 import menus
// 与 e2e-state-bridge 同模式：core 持注入点，UI 层注册，方向单向。
// 分字段注册（registerUiAction），支持各菜单模块独立注册各自行为。

export interface UiActions {
    /** 关闭全部弹窗/遮罩（Escape 快捷键） */
    closeAllOverlays: () => void;
    /** 截取当前画面（F2 快捷键） */
    screenshotCurrent: () => Promise<void> | void;
}

const _uiActions: Partial<UiActions> = {};

/** 注册单个 UI 行为（menus 侧各模块启动时调用，可重复注册覆盖） */
export function registerUiAction<K extends keyof UiActions>(
    key: K,
    fn: UiActions[K]
): void {
    _uiActions[key] = fn;
}

/** 读取 UI 行为集（core 快捷键侧调用；未注册返回 null） */
export function getUiActions(): UiActions | null {
    if (_uiActions.closeAllOverlays && _uiActions.screenshotCurrent) {
        return _uiActions as UiActions;
    }
    return null;
}
