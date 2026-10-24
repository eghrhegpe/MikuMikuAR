// [doc:architecture] Menu stack registry — shared menu stack pointers.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Lives in menus/ because it holds SlideMenu references.

import type { SlideMenu } from './menu';
import type { LibraryModel, PopupLevel, BrowseOutcome } from '../core/types';

/** buildLevel 的签名：由 library-core 注册进来，避免 menus 子系统反向依赖。 */
export type BuildLevelFn = (
    dir: string,
    label: string,
    filter?: (m: LibraryModel) => boolean,
    targetStack?: SlideMenu,
    extraFolders?: { label: string; path: string }[],
    outcome?: BrowseOutcome
) => PopupLevel;

export const stackRegistry: {
    modelStack: SlideMenu | null;
    buildLevel: BuildLevelFn | null;
} = {
    modelStack: null,
    buildLevel: null,
};

/**
 * [doc:adr-276] 取模型菜单栈，未建立则抛名字明确的错误。
 *
 * 栈在渲染菜单时建立、在点击回调里使用；读到 null 意味着「点击发生在渲染之前，或栈已被销毁」。
 * 此前 8 处 `stackRegistry.modelStack.push(...)` 会各自抛 `Cannot read properties of null`，
 * 堆栈指向调用者而不指向真正的时序问题。
 */
export function requireModelStack(): SlideMenu {
    const stack = stackRegistry.modelStack;
    if (stack === null) {
        throw new Error('menu-stack-registry: modelStack 未建立（渲染前被点击？）');
    }
    return stack;
}

/**
 * [doc:adr-276] 取浏览层级构建函数，未注册则抛名字明确的错误。
 *
 * 此前 4 处 `stackRegistry.buildLevel!(...)` 在 library-core 尚未执行到
 * `stackRegistry.buildLevel = buildLevel` 时点击会抛 "stackRegistry.buildLevel is not a function"，
 * 指向调用者而不指向注册顺序。与 requireModelStack 同一收口形态。
 */
export function requireBuildLevel(): BuildLevelFn {
    const build = stackRegistry.buildLevel;
    if (build === null) {
        throw new Error('menu-stack-registry: buildLevel 未注册（library-core 尚未加载？）');
    }
    return build;
}
