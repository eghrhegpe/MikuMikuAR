// [doc:architecture] Menu stack registry — shared menu stack pointers.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Lives in menus/ because it holds SlideMenu references.

import type { SlideMenu } from './menu';
import type { LibraryModel, PopupLevel, BrowseOutcome } from '../core/types';

export const stackRegistry: {
    modelStack: SlideMenu | null;
    buildLevel:
        | ((
              dir: string,
              label: string,
              filter?: (m: LibraryModel) => boolean,
              targetStack?: SlideMenu,
              extraFolders?: { label: string; path: string }[],
              outcome?: BrowseOutcome
          ) => PopupLevel)
        | null;
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
