// [doc:architecture] Motion Menu State — 动作菜单共享状态
// 从 motion-popup.ts 拆分，切断 motion-popup ↔ motion-*-levels 双向 import。
//
// 环的形态（ADR-271 之前）：
//   motion-popup.ts → 8 个 motion-*-levels.ts（build*Level）
//   8 个 motion-*-levels.ts → motion-popup.ts（getMotionMenu / refreshMotionRoot）
// 这是与 env-menu ↔ env-feature-levels 同构的 hub-and-spoke 互指，
// env 侧已由 env-menu-state.ts 用同一手法切断，本文件是它在 menus 侧的对应物。
//
// 约束：本文件只能是叶子——只允许 `import type`，不得引入任何 builder 或 popup 实现，
// 否则它自己会重新变成环的一部分。

import type { SlideMenu } from './menu';

// ======== 动作菜单实例注册表 ========
// 存的是 getter 而非实例：菜单在 registerPopupMenu 之后才由 buildRoot 惰性构建，
// 模块加载期求值会永久拿到 null。

let _getMotionMenu: (() => SlideMenu | null) | null = null;

/** motion-popup 在 registerPopupMenu 之后写入 getter */
export function setMotionMenuGetter(fn: (() => SlideMenu | null) | null): void {
    _getMotionMenu = fn;
}

/** 各 motion-*-levels 取菜单实例后调用 reRender() */
export function getMotionMenu(): SlideMenu | null {
    return _getMotionMenu?.() ?? null;
}

// ======== 根级刷新委托 ========
// refreshMotionRoot 由 registerPopupMenu 生成（依赖 popup 内部状态），不能下移到本文件；
// 改为 popup 注册时写入、levels 读取调用，避免 levels 反向 import popup 实现。

let _refreshMotionRoot: (() => void) | null = null;

export function setRefreshMotionRoot(fn: (() => void) | null): void {
    _refreshMotionRoot = fn;
}

export function refreshMotionRoot(): void {
    _refreshMotionRoot?.();
}
