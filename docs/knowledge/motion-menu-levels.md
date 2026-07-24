---
kind: motion_menu_levels
name: 动作菜单层级系统
category: ui
scope:
  - frontend/src/menus/motion-*-levels.ts
source_files:
  - frontend/src/menus/motion-popup.ts
  - frontend/src/menus/motion-camera-levels.ts
  - frontend/src/menus/motion-cloth-levels.ts
  - frontend/src/menus/motion-gaze-levels.ts
  - frontend/src/menus/motion-override-levels.ts
  - frontend/src/menus/motion-pose-levels.ts
  - frontend/src/menus/motion-procmotion-levels.ts
  - frontend/src/menus/motion-root-ui.ts
adr:
  - ADR-071
symbols:
  - getMotionMenu
  - reRenderMotionMenu
  - buildCameraLevel
  - buildClothLevel
  - buildGazeLevel
  - buildOverrideLevel
  - buildPoseLevel
  - buildProcMotionLevel
invariants:
  - Schema 驱动 UI，数据绑定到 motionState
  - 与程序化动作解耦
tests: []
use_when:
  - 动作菜单
  - 动作层级
  - 感知面板
  - 相机动作
  - 布料动作
  - 视线面板
  - 动作覆盖
  - 姿势面板
  - 程序化动作面板
---

## 系统概览
**动作菜单层级系统**（Schema 驱动）。动作弹窗的各级面板（相机动作、布料、感知视线、动作覆盖、
姿势、程序化动作等），每个面板为独立的 `PopupLevel`。`motion-gaze-levels.ts` 是感知层统一入口
（ADR-071），与程序化动作解耦。

## 核心职责
- `motion-popup.ts` — 动作弹窗根构建 + 菜单实例注册表。
- `motion-*-levels.ts` — 各动作子系统的菜单 schema 定义。
- `motion-root-ui.ts` — 动作根面板 UI。

## 对外 API（节选）
- `getMotionMenu()` / `setMotionMenu(menu)` — 取/设动作菜单实例。
- `reRenderMotionMenu()` — 重渲染动作菜单。
- `buildGazeLevel()` — 感知视线面板（ADR-071 感知层统一入口）。
- `buildProcMotionLevel()` — 程序化动作面板。

## 与其他子系统关系
- 感知层：`../scene/motion/perception.ts`（状态读写）。
- 程序化动作：`../scene/motion/proc-motion-bridge.ts`。
- 动作注册表：`../scene/motion/motion-modules/registry.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- Schema 驱动 UI：所有控件定义在 `MenuNode[]` 中。
- 感知层（ADR-071）与程序化动作解耦，独立文件。
- 开关合并至 folder headerToggle（参考 env-menu 模式）。
