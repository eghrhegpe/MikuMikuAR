// [doc:architecture] Scene Menu State — 场景菜单共享状态
// 从 scene-menu.ts 拆分，切断 scene-menu ↔ env-ground-levels 双向 import
// 对标 env-menu-state.ts，纯状态模块，零 UI 依赖

import type { SlideMenu } from './menu';

// ======== Scene Menu 实例注册表 ========
// 被 scene-*-levels.ts 用来获取菜单实例后调用 reRender()

let _sceneMenu: SlideMenu | null = null;

export function setSceneMenu(menu: SlideMenu | null): void {
    _sceneMenu = menu;
}

export function getSceneMenu(): SlideMenu | null {
    return _sceneMenu;
}
