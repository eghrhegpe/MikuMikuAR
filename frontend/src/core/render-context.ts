// [doc:architecture] render-context — 菜单渲染上下文栈（零依赖叶子）
// 从 menus/menu.ts 抽出，断开 core → menus 的根因反向边：
//   core 层控件（ui-rows/ui-collapsible/ui-header-toggle）需在渲染期注册自更新控件，
//   过去经由 menus/menu.ts 的 getCurrentRenderingMenu 取得 SlideMenu，形成
//   menus 神桶 ↔ core 双向环。此处以最小 RenderContext 接口反转依赖：
//   core 只认接口，menus/menu.ts 单向 push/pop 具体 SlideMenu 实例。
//
// 本文件不得引入任何 core 之外（尤其 menus/）的依赖，保持零依赖叶属性。

/** 渲染期可注册自更新控件的最小上下文（由 SlideMenu 实现）。 */
export interface RenderContext {
    /**
     * 注册一个自更新控件，由菜单的 updateControls() 统一驱动刷新。
     * @param update 更新函数
     * @param pathHint [doc:PACU] 可选状态 key 提示；提供后仅当该 key 本帧变更时才调用 update。
     */
    registerControl(update: () => void, pathHint?: string): void;
}

/** 渲染上下文栈 — 控件创建函数通过 getCurrentRenderingContext() 获得当前上下文。 */
const _renderingStack: RenderContext[] = [];

/** 获取当前正在渲染的上下文（供控件函数自动注册）。 */
export function getCurrentRenderingContext(): RenderContext | null {
    return _renderingStack[_renderingStack.length - 1] ?? null;
}

/** 进入一个渲染上下文（renderCustom 前调用）。 */
export function pushRenderingContext(ctx: RenderContext): void {
    _renderingStack.push(ctx);
}

/** 退出当前渲染上下文（renderCustom 后调用，须在 finally 中配对）。 */
export function popRenderingContext(): void {
    _renderingStack.pop();
}
