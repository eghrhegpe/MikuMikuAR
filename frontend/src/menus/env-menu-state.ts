// [doc:architecture] Env Menu State — 环境菜单共享状态
// 从 env-menu.ts 拆分，切断 env-menu ↔ env-feature-levels 双向 import
// 包含：EnvTextureBindingTarget 状态 + 菜单实例注册表

import type { SlideMenu } from './menu';

// ======== Env Texture Binding Target ========

export type EnvTextureBindingTarget = 'ground' | 'particle' | 'sky' | 'stars' | null;

let _envTextureBindingTarget: EnvTextureBindingTarget = null;

export function setEnvTextureBindingTarget(target: EnvTextureBindingTarget): void {
    _envTextureBindingTarget = target;
}

export function clearEnvTextureBindingTarget(): void {
    _envTextureBindingTarget = null;
}

export function getEnvTextureBindingTarget(): EnvTextureBindingTarget {
    return _envTextureBindingTarget;
}

// ======== Env Menu 实例注册表 ========
// 被 env-*-levels.ts 用来获取菜单实例后调用 reRender()

let _envMenu: SlideMenu | null = null;

export function setEnvMenu(menu: SlideMenu | null): void {
    _envMenu = menu;
}

export function getEnvMenu(): SlideMenu | null {
    return _envMenu;
}
