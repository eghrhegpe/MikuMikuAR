# ADR-036: ShortcutRegistry — 可配置快捷键系统

> **日期**: 2026-07-05
> **状态**: 已完成 — ShortcutRegistry 核心 + main.ts 迁移 + 设置面板 UI 全部就位

---

## 背景

快捷键系统此前是 5 处分散的 `keydown` 监听器，分布在以下文件：

| 文件 | 作用域 | 快键键 | 行数 |
|------|--------|--------|------|
| `core/main.ts` | 全局 window | Ctrl+1~5(弹窗)、Space(播放)、Escape(关闭)、←→(seek) | ~70 |
| `menus/menu.ts` | 菜单容器 | ↑↓(导航)、←(返回)、→/Enter(触发) | ~25 |
| `core/dialog.ts` | 文档 | Escape(取消)、Enter(确认) | ~3 |
| `core/ui-rows.ts` | slider 元素 | ←↓(减)、→↑(加)、Shift×10 | ~30 |
| `core/ui-advanced-rows.ts` | color slider | ←↓(减0.01)、→↑(加0.01)、Home/End | ~25 |

主要问题：
- **无可配置性**：所有快捷键硬编码 keyCode，用户无法修改
- **无集中注册表**：新增快捷键需要再写一个 `addEventListener`，无冲突检测
- **Arrow 键冲突**：main.ts 的 seek(←→) 和 slider 的调节(←→) 互相干扰
- **无可发现性**：新开发者/用户不知道有哪些快捷键可用

## 决策

### 1. 递增迁移，不一步到位

**只迁移 main.ts 的全局快捷键**，保持 menu/dialog/slider 内部键盘导航不动。理由：

| 迁移对象 | 迁移复杂度 | 用户感知价值 |
|----------|-----------|------------|
| main.ts 全局快捷键 | 中（12 个，独立作用域） | 高（最常用、最需可配置） |
| menu.ts 导航键 | 低（4 个，内部 UX） | 低（用户不会改 ↑↓） |
| dialog.ts 确认/取消 | 低（2 个，内部 UX） | 低 |
| ui-rows slider 控制 | 中（作用域冲突复杂） | 低（slider 键盘是专业行为） |

### 2. ShortcutRegistry 设计

**新建 `core/shortcut-registry.ts`**，纯 TS 模块级状态，无框架依赖。

核心概念：

```typescript
interface ShortcutDef {
  id: string;              // 唯一标识 'toggle:models' 'playback:seek-back'
  label: string;           // 人类可读 '模型库' '后退5秒'
  defaultKey: string;      // KeyboardEvent.code 值 'Digit1' 'ArrowLeft'
  defaultCtrl?: boolean;
  defaultShift?: boolean;
  defaultAlt?: boolean;
  prevent?: boolean;       // 是否 preventDefault
  handler: () => void;
  group: string;           // UI 分组 '弹窗导航' '播放控制'
}
```

API：

| 函数 | 用途 |
|------|------|
| `registerShortcut(def)` / `registerShortcuts(defs)` | 注册快捷键 |
| `getAllShortcuts()` | 返回所有快捷键及其当前绑定值 |
| `setKeyBinding(id, key, ctrl?, shift?, alt?)` | 自定义绑定，返回 `{ok:bool}` 或 `{ok:false, conflictId, conflictLabel}` |
| `resetKeyBinding(id)` / `resetAllKeyBindings()` | 恢复默认 |
| `loadKeyBindings(bindings)` / `exportKeyBindings()` | 持久化 round-trip |
| `initShortcutDispatcher()` | 挂载单个全局 keydown 监听，自动分发最快的匹配 |

### 3. 冲突解决方案

**slider Arrow 冲突**（←→ 被 slider 和 seek 同时捕获）：
- `initShortcutDispatcher()` 内部自动检测：当 event target 在 `.cs-slider` 或 `.color-slider` 内时，跳过 ArrowLeft/ArrowRight 的分发
- 这意味着 slider 聚焦时全局 seek 不触发，slider 元素级 handler 正常接收事件

**全局 vs 局部作用域**：
- registry 只负责 global 作用域的快捷键
- menu/dialog/slider 的 handler 保持元素级 `addEventListener`
- 元素级 handler 通过 `stopPropagation` 和事件捕获顺序自然优先于全局分发

### 4. 持久化方案

自定义键位绑定存入 `uiState.keyBindings`：

```typescript
// UIState (types.ts) — 通过 index signature 承载，不修改接口
uiState.keyBindings: Record<string, {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}>
```

通过 `setUIState()` 写入，Go 后端自动持久化到 config。

### 5. 设置面板 UI

Settings > 快捷键（`buildSettingsShortcutsLevel()`）：

- 按 `group` 分组展示所有快捷键
- 每行显示 label + 当前键位组合
- 点击行进入「等待按键」模式（标签变为「按下新组合键...」，背景高亮）
- `setKeyBinding()` 检测冲突 → 有冲突弹出 `showConfirm` 确认覆盖
- 修改后立即持久化 + reRender
- 底部「恢复默认」按钮

### 6. 快捷键分组

| 组 | 快捷键 | 数量 |
|----|--------|------|
| 弹窗导航 | Ctrl+1~5 | 5 |
| 播放控制 | Space, ←, → | 3 |
| 全局 | Escape | 1 |

---

## 实现结果

| 指标 | 值 |
|------|-----|
| 新增文件 | `core/shortcut-registry.ts` (237行) |
| 新增测试 | `core/__tests__/shortcut-registry.test.ts` (445行, 24 tests) |
| 迁移文件 | `core/main.ts` (~70行减少→~30行) |
| 设置面板 | `menus/settings.ts` 追加 (~80行) |
| 构建状态 | tsc 零错误, 982 tests 全绿, build 1.62s |

## 不 scope

- **menu.ts 键盘导航** — 内部 UI 行为，用户极少想改
- **dialog.ts 确认/取消** — 同上
- **ui-rows/ui-advanced-rows slider 键盘** — 元素级控件，scope 特殊
- **WASD freefly** — 连续输入，不是按键映射
- **Ctrl-hold shortcuts-visible** — 修饰键自身状态显示，不是快捷键

