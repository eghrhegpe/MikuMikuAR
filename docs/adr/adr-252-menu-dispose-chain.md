# ADR-252: 菜单资源释放链路缺失 —— disposeMenuWrapper/clearAllMenuWrappers 零调用与 _liveMenus 常驻

> **日期**: 2026-08-06
> **状态**: ✅ 已采纳（2026-08-11 实施；closeAllOverlays 内联 clearAllMenuWrappers + HMR dispose 接线，消除零调用死代码）
> **编号**: 252
>
> **关联**: [ADR-065](adr-065-pure-items-hot-render.md)（菜单 Schema / 声明式菜单）、[ADR-093](adr-093-menu-declarative-schema.md)（菜单 Schema 注册与渲染）、[ADR-191](adr-191-god-barrel-debarreling.md)（menu-overlay 抽离与 de-barrel）、[ADR-106](adr-106-timing-audit-and-async-lifecycle.md)（HMR 幂等生命周期）
>
> **来源**: 2026-08-06 第 13 轮代码审核（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`）——`menu-overlay.ts` 导出的 `disposeMenuWrapper`/`clearAllMenuWrappers` 全库零调用；模型菜单（`library-browse.ts` 的 `makeModelMenu`）onClose 只调 `closeAllOverlays` 不 dispose，SlideMenu 实例常驻 `_liveMenus`，隐藏时仍逐帧 `updateControls`。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据：菜单释放链路不完整

```ts
// menu-overlay.ts:64-76 —— 导出了释放入口，但全库无调用者
export function disposeMenuWrapper(menuId: string): void { ... }
export function clearAllMenuWrappers(): void { ... }

// library-browse.ts makeModelMenu —— onClose 只关浮层，不 dispose 菜单
onClose: () => {
    stackRegistry.modelStack = null;
    closeAllOverlays();   // ← 不调用 menu.dispose() / disposeMenuWrapper('model-popup')
}

// menu.ts:45,269,1093 —— _liveMenus 常驻集合
const _liveMenus = new Set<SlideMenu>();   // constructor 时 add，仅 dispose() 时 delete
```

| 现状 | 风险 |
|------|------|
| `disposeMenuWrapper`/`clearAllMenuWrappers` 导出但零调用 | wrapper 与隐藏菜单 DOM 常驻注册表（按 menuId 有界增长）；无主动释放路径 |
| 模型菜单 `onClose` 只 `closeAllOverlays`，不 dispose | SlideMenu 实例留在 `_liveMenus`，其响应式订阅（`subscribe(() => this.updateControls())`）常驻，隐藏时仍逐帧执行；android:back 等全局返回逻辑查询到已关闭的菜单 |
| `close()` ≠ `dispose()` 语义易混 | 外部直接构造 SlideMenu 且 onClose 未接 dispose 时，资源泄漏（menu.ts:287-291 已注释警告） |

## 决策

### 决策 1：`_liveMenus` 生命周期与关闭路径统一

1. `SlideMenu.close()` 语义保持不变（仅翻转可见状态 + 通知 onClose，不释放）；但**关闭后必须由 onClose 链完成 dispose**——所有菜单工厂（menu-factory 的 `registerPopupMenu`/`showPopupMenu`、library-browse 的 `makeModelMenu`）的 onClose 都要接 `menu.dispose()`。
2. `_liveMenus` 条目只增不减的现状需收口：dispose 已从集合删除（menu.ts:1093），缺的是「关闭即 dispose」的调用链，而非集合逻辑本身。
3. `android:back` / 全局返回逻辑查询 `_liveMenus` 时，先过滤 `isVisible`（当前已做），并在返回后按决策 1 触发 dispose。

### 决策 2：menu-overlay 释放入口接线（disposeMenuWrapper/clearAllMenuWrappers）

| 阶段 | 动作 | 说明 |
|------|------|------|
| A | `closeAllOverlays()` 内对非当前 wrapper 执行 `disposeMenuWrapper` 配对 | 复用既有释放入口，消除零调用死代码；wrapper 注册表随之收缩 |
| B | `clearAllMenuWrappers()` 接入 HMR/场景销毁链（disposeScene / disposeEventHandlers 同层） | 与 ADR-106 的 HMR 幂等清理对齐 |
| C | 常驻菜单（settings/assistant 等）改「隐藏不销毁」策略时，仅 `disposeMenuWrapper` DOM 而不 `dispose` SlideMenu，保持状态 | 需在 menu.ts 增加「卸载 DOM 但保留实例」的能力，避免重建开销 |

### 决策 3：治理期间红线（立 ADR 即生效）

1. **新菜单工厂必须接 dispose**：`new SlideMenu(...)` 的 onClose 一律包含 `menu.dispose()`（或委托给已接 dispose 的工厂函数）。
2. **禁止新增零调用释放入口**：导出 `dispose*` API 时须同步接线调用方，否则不导出（避免重复 disposeMenuWrapper 的零调用反模式）。
3. `_liveMenus` 的增删必须配对：constructor add、dispose delete 已在位，新增路径不得绕过。

## 与其他 ADR 的关系

- 不取代 [ADR-065](adr-065-pure-items-hot-render.md)/[ADR-093](adr-093-menu-declarative-schema.md)——本 ADR 管菜单**资源生命周期**（dispose 链路），ADR-065/093 管菜单**声明与渲染**（schema 结构），正交。
- 不取代 [ADR-191](adr-191-god-barrel-debarreling.md)——ADR-191 管 menu-overlay 的模块边界（抽离/de-barrel）；本 ADR 管其内部释放语义。
- 触及 menu-overlay.md 知识卡「disposeMenuWrapper/clearAllMenuWrappers 被各菜单/弹窗浮层消费」——**该表述与事实不符**（零调用），本 ADR 登记为偏差，实现接线后知识卡同步更正。

## 影响与验收

- **验收标准**：`grep -rn "disposeMenuWrapper\|clearAllMenuWrappers" frontend/src --include="*.ts"` 的调用方 ≥ 2 处（closeAllOverlays / HMR 链）；隐藏菜单关闭后 `_liveMenus` 无残留条目。
- **风险**：决策 2-A 改动涉及所有弹窗（settings/motion/library 等），需逐个验证关闭行为不变；建议拆独立 PR 分批落地，每批保持全量测试绿。
- **回退**：逐批独立，任一批回退不影响其他批。
