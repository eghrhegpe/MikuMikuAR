# 设计审核：资源库全屏界面的「返回」机制

> 审核对象：`frontend/src/core/ui-fullscreen-overlay.ts`、`frontend/src/menus/library-core.ts`、`frontend/src/core/ui-resource-panel.ts`、`frontend/src/menus/menu.ts`
> 触发：用户反馈"资源库全屏界面似乎未采用通常的菜单返回功能，操作感怪怪的"
> 日期：2026-07-16

---

## 总体结论：不通过（设计缺陷）

资源库全屏界面**未复用 SlideMenu 的原生返回原语**，而是自造了一套 `navStack` + `←`/`✕` 返回机制；且同一全屏组件在 list 模式与 grid 模式下**各实现了一套导航逻辑**，行为互相矛盾。存在功能性死按钮、文件夹点击无响应、退出后位置丢失三类问题。

---

## 正常「菜单返回」 vs 全屏「返回」对照

| 维度 | 正常 SlideMenu（`menu.ts:819-833`） | 资源库全屏（`ui-fullscreen-overlay.ts`） |
|------|--------------------------------------|------------------------------------------|
| 返回原语 | `slide-back` 按钮 → `pop()`（levels>1 为 `chevron-left`，根级为 `x`→`onClose()`）；`ArrowLeft`→`pop()`；右滑→`pop()` | 自绘 `←`/`✕` → overlay 内部 `navStack.pop()` 或 `closeFullscreen()+onBack` |
| `onBack` 语义 | `pop()` 在 SlideMenu 自身导航栈上弹一层，位置精确可逆 | `() => setCurrentState('EMBEDDED_GRID')`（`library-core.ts:316/467`），**不调用 `SlideMenu.pop()`** |
| 是否复用菜单返回 | 是 | 否 |

---

## 风险表

| 文件:行 | 观察 | 建议 | 级别 |
|---------|------|------|------|
| `library-core.ts:315-328` vs `466-488` | 全屏下 list 模式用 `navigate()`（overlay 自有 `navStack`）做文件夹导航；grid 模式用 `stack.push(buildLevel())`（被冻结的隐藏 SlideMenu 栈）。同一全屏组件两套导航机制，返回行为不一致 | 统一为单一导航模型（overlay 自有 path 栈 + `updateItems` 重渲染），禁止直接 `stack.push` 到被冻结的 SlideMenu | 🔴 P1 |
| `library-core.ts:466-488` + `ui-resource-panel.ts:345-351` | grid 全屏 `onEnterFolder` 仅 `stack.push`，但 `createResourcePanel` 不重渲染（`currentItems` 不变），**点击文件夹界面无反应**；却把隐藏 SlideMenu 栈推深一层 | 改为 `panel.updateItems(newItems)` + 自有栈 push；或驱动真实 SlideMenu 并用 `pop()` 返回 | 🔴 P1 |
| `ui-fullscreen-overlay.ts:43-47` + `library-core.ts:443` | `openFullscreen` 硬门槛 `currentState==='EMBEDDED_GRID'`。list 模式（`addListViewToolbar`）从不置该状态（仅 `renderGridMode` 第 443 行置），而默认 `resourceViewMode='list'`。故 list 模式下点 `⛶` **静默无反应**（返回 no-op handle） | 解耦全屏开关与 `EMBEDDED_GRID` 状态：用独立 `isFullscreenOpen` 布尔；或 list 模式展开前先 `setCurrentState('EMBEDDED_GRID')` | 🔴 P1 |
| `library-core.ts:316/467` | 关闭全屏时 `onBack` 仅 `setCurrentState('EMBEDDED_GRID')`，未将 grid 全屏期间 `stack.push` 推深的层级弹回。从 A 目录进入全屏→点进 B 文件夹→退出后 SlideMenu 停在 B 而非 A——**返回丢失了原本位置** | 关闭时 `popTo` 到进入全屏前的层级（快照 restore），或全屏内导航不触碰 SlideMenu 栈 | 🟠 P2 |
| `ui-fullscreen-overlay.ts:156-166` | 全屏 `←` 在 overlay `navStack` 空时直接 `closeFullscreen()`；grid 全屏 `navStack` 恒空→永远直接关闭；list 全屏则逐层 pop。**两种模式下"返回"语义相反** | 统一：navStack 非空则 pop；空时返回到进入全屏前的层级（而非仅关 overlay） | 🟠 P2 |
| `ui-fullscreen-overlay.ts:214-249` | 全屏内 `ArrowLeft` 未被映射为返回（仅 Arrow 四向做卡片焦点、Enter 选择），与 SlideMenu 的 `ArrowLeft=pop` 不一致 | 卡片焦点用四向 Arrow；把"返回上一层"绑到 `Backspace` 或 navStack 非空时的 `ArrowLeft` | 🟡 P3 |
| `ui-fullscreen-overlay.ts:36-39,98-119` | overlay 全局单例状态（`currentState`/`_slideMenuFrozen`/`frozenSlideMenuElement`）；`freezeSlideMenu` 遍历全部 `.slide-menu-container` 但只恢复最后一个 | 状态收敛到 handle 实例字段；仅冻结调用方关联的容器 | 🟡 P3 |
| `ui-fullscreen-overlay.ts:98-119` | `unfreezeSlideMenu` 只恢复 `frozenSlideMenuElement`（最后一个），多 menu 容器会错配 | 仅冻结调用方关联的那个容器，或用 class 标记 | 🟢 P4 |

---

## 亮点

- ADR-066 已预见到"复用 SlideMenu 导航、DOM 不销毁"的优雅方向；overlay 的 `navStack + navigate` 机制（list 模式）本身可用。
- 键盘可达性（Arrow/Enter）、`IntersectionObserver` 懒加载、虚拟滚动阈值设计合理。

---

## 根因总结

全屏资源浏览器被**实现两次**：
- list 全屏：`renderFullscreenFolder` + overlay `navStack`（自管理）；
- grid 全屏：`createResourcePanel` + 直接 `stack.push` 到被冻结的 SlideMenu 栈。

`ui-fullscreen-overlay` 作为通用组件抛弃了 ADR-066 的"导航冒泡到 SlideMenu"方案，自造返回原语却未与 `SlideMenu.pop()` 对齐。后果：
1. list 模式展开按钮静默失效（状态门槛）；
2. grid 全屏文件夹点击无响应且污染隐藏栈；
3. 返回语义与常规菜单相反。

---

## 建议修复路线（按优先级）

1. **统一全屏导航**：改为"overlay 自有 path 栈 + `updateItems` 重渲染"模型；grid 全屏 `onEnterFolder` 改用 navigate 风格，不再 `stack.push`。
2. **解耦状态门槛**：`openFullscreen` 去掉 `EMBEDDED_GRID` 硬门槛，改独立 `isFullscreenOpen` 标志，消除 list 模式死按钮。
3. **关闭还原**：退出全屏时 `popTo` 到进入前层级，保证"返回原本位置"。
4. **返回键对齐**：全屏 `←`/Backspace 与 `ArrowLeft` 映射对齐 SlideMenu 的 `pop()` 语义。
