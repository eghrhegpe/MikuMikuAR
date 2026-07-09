# ADR-065: 纯 items 层级语言热切换刷新（精简版）

> **状态**: ✅ 已实施（2026-07-09）
> **关联**: ADR-059（i18n 框架）
> **来源**: ADR-065（精简版）

---

## 问题

`setLang() → scheduleRefresh() → SlideMenu.updateControls()` 只遍历 `_controls[]`，纯 `items` 层级（无 `registerControl`）标签在构建时通过 `t()` 冻结，切语言后不刷新。

| 层级类型 | 热刷新？ |
|----------|---------|
| `registerControl` 注册项（toggle/switch） | ✅ |
| `replaceCurrentLevel` 重建项（语言子菜单） | ✅ |
| 纯 `items` 根层（Settings 根目录文件夹） | ❌ |
| 纯 `items` 子层（scene 预设/布料物理等） | ❌ |

---

## 方案选择

| 方案 | 结论 |
|------|------|
| A. 全量 `reRender` | ❌ 丢失导航栈深度，破坏 toggle 状态 |
| **B. `itemBuilder` + 增量 `patchPanel`** | ✅ 原地刷新标签，保留 DOM/焦点/导航栈 |
| C. `scheduleRefresh` 直接 `reRender` | ❌ 同 A 问题 |

---

## 实施记录

### 方案 B 落地（含一处修正）

原方案 B 直接复用 `patchPanel()` 做 diff，但 `patchPanel` 按 `rowKey = kind:target` 比较，key 相同则跳过整行 DOM。语言切换只改 label、key 不变 → 标签不会刷新。

**修正**：key 匹配分支改为**原地刷新可见文本**（`refreshRowText`：更新 `.slide-label` / `.slide-tag` / `data-hint`），不重建 DOM、保留监听器与键盘焦点。

### 改动文件

| 文件 | 改动 |
|------|------|
| `core/types.ts` | `PopupLevel` 新增 `itemBuilder?: () => PopupRow[]` |
| `menus/menu.ts` | `updateControls()` 末尾加 itemBuilder 路径；新增 `refreshRowText()` |
| `menus/menu-factory.ts` | 构建 root level 后自动挂 `itemBuilder = config.buildRootItems` |
| `settings.ts` / `scene-menu.ts` / `motion-popup.ts` / `env-menu.ts` | 各 `onFolderEnter` 返回子层时挂 `itemBuilder = () => builder().items` |
| `src/__tests__/menu.test.ts` | 新增 4 个 itemBuilder 刷新测试 |

**验证**：`npm run check` 通过；`npm run test` 全量 1232 用例全绿；`npm run build` 通过。

---

## 关键设计要点

- `updateControls` 先遍历 `_controls` 再处理 `itemBuilder`，互不覆盖
- `patchPanel` 对 rows 数量变化的情况仍会重建整个 list（可接受）
- builder 在 `onFolderEnter` 时挂载，不影响懒构建时序
- 关闭 Settings 再切语言 → 无任何冗余 reRender 开销

---

## 验证

1. 打开 Settings → 切语言 → 根菜单文件夹名即时变为目标语言
2. 打开 Settings → 切语言 → 已开子菜单 toggle 标签即时翻译
3. 不打开 Settings → 切语言 → 无任何冗余开销
4. `npm run check && npm run test && npm run build` 全绿