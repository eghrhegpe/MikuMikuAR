---
kind: scene_stage_lights
name: 舞台灯光菜单层级
tier: leaf
category: ui
scope:
  - frontend/src/menus/scene-stage-lights.ts
source_files:
  - frontend/src/menus/scene-stage-lights.ts
adr:
  - ADR-152
  - ADR-130
symbols:
  - buildStageLightLevel
invariants:
  - 从 scene-render-levels.ts 拆分而来，专注舞台灯光弹窗 UI 构建
  - 增删舞台灯光属破坏性操作，须接入 offerSceneUndo / pushUndoSnapshot（ADR-130）
  - 灯光预设仅存储 i18n key（LIGHTING_PRESET_KEYS），热切换安全，不含中文文案
  - 灯光状态读写经 scene.ts 转发到 lighting-stage 实现层（setStageLightState / addStageLight / removeStageLight）
use_when:
  - 舞台灯光
  - 灯光菜单
  - 聚光灯增删
  - 灯光预设
  - 灯光属性调节
---

# 舞台灯光菜单层级

## 系统概览
**舞台灯光弹窗菜单层级**（`buildStageLightLevel`）。从 `scene-render-levels.ts` 拆分，负责构建舞台灯光设置 UI：预设芯片组、灯光列表增删、单灯属性（位置 / 颜色 / 类型 / 阴影）调节。是 [lighting-stage.md](./lighting-stage.md)（rendering 实现层）的**菜单入口**，二者为「入口 ↔ 实现」配对关系。

## 核心职责
- `buildStageLightLevel(): PopupLevel` — 构建舞台灯光设置弹窗层级，返回 `PopupLevel`。

## 对外 API（节选）
- `buildStageLightLevel()` — 组装舞台灯光菜单（预设芯片、灯光 CRUD、属性滑块），返回 `PopupLevel` 供菜单栈渲染。

## 与其他子系统关系
- **实现层**：[lighting-stage.md](./lighting-stage.md)（rendering）提供 `setStageLightState` / `addStageLight` / `removeStageLight` 等 CRUD 与阴影 / 光锥重建。
- **Undo**：增删灯光调用 `offerSceneUndo` / `pushUndoSnapshot`（ADR-130 场景编辑 undo 系统）。
- **UI 基元**：复用 `ui-helpers` 的 `addSliderRow` / `addColorSliderRow` / `addModeSlider` / `addPresetChip` / `addCollapsible` 等。
- **状态源**：读取 `envState.lightingPresetName`；灯光列表来自 `getStageLights()`。

## UI 入口
- 菜单路径：场景菜单 → 舞台灯光设置
- 入口函数：`buildStageLightLevel(): PopupLevel`（文件 `menus/scene-stage-lights.ts`）

## 不变量
- 从 `scene-render-levels.ts` 拆分，专注舞台灯光 UI 构建。
- 增删灯光属破坏性操作，必须 `offerSceneUndo` / `pushUndoSnapshot`（ADR-130）。
- 灯光预设仅存 i18n key，热切换安全。
- 灯光状态读写经 `scene.ts` 转发到 `lighting-stage` 实现层。

## 验证入口
- 实现层回归：`cd frontend && npm run test -- src/__tests__/scene/lighting-stage.test.ts`
- 菜单层可经 e2e 快照断言（KIND_CONTROL_SELECTOR 读取选择器）
