---
kind: motion_modules_body_posture
name: 动作模块 — 身体姿势
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/body-posture.ts
source_files:
  - frontend/src/scene/motion/motion-modules/body-posture.ts
adr: []
symbols:
  - BodyPostureModule
  - applyBodyPosture
invariants:
  - 姿势参数影响身体倾斜
  - 与 VMD 身体动作互补
tests: []
use_when:
  - 身体姿势
  - 姿势调整
  - 身体倾斜
---

## 系统概览
**身体姿势动作模块**。控制模型的身体姿势（如前倾、后仰、左右侧倾），作为 VMD 动作的补充。

## 核心职责
- `body-posture.ts` — 身体姿势动作模块封装。

## 对外 API（节选）
- `class BodyPostureModule` — 动作模块实现。
- `applyBodyPosture(context, bones, posture)` — 应用身体姿势。

## 与其他子系统关系
- 注册表：`./registry.ts`。

## 不变量
- 姿势参数在合理范围内，避免骨骼扭曲。
