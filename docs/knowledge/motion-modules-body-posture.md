---
tier: leaf
kind: motion_modules_body_posture
name: 动作模块 — 身体姿势
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/body-posture.ts
source_files:
  - frontend/src/scene/motion/motion-modules/body-posture.ts
adr:
  - ADR-147
symbols:
  - createBodyPostureModule
  - BODY_POSTURE_DEF
invariants:
  - 姿势参数影响身体倾斜
  - 位置参数（bodyHeight/bodyDepth）归零时清除センター位置覆盖，防止残留高度不归零
  - 帧钩子注册于 FRAME_HOOK_ORDER.BODY_POSITION（升序执行在 FEET 之后、bone-override 合成前）
tests:
  - frontend/src/__tests__/motion-modules-registry.param.test.ts
use_when:
  - 身体姿势
  - 姿势调整
  - 身体倾斜
---

# 动作模块 — 身体姿势

## 系统概览
**身体姿势动作模块**。控制模型的身体姿势（如前倾、后仰、左右侧倾），作为 VMD 动作的补充。

## 核心职责
- `body-posture.ts` — 身体姿势动作模块封装。

## 对外 API（节选）
- `class BodyPostureModule` — 动作模块实现。
- `createBodyPostureModule(modelId)` — 创建身体姿势动作模块实例。
- `BODY_POSTURE_DEF` — 模块定义常量（优先级、配置等）。

## 与其他子系统关系
- 注册表：`./registry.ts`。

## 不变量
- 姿势参数在合理范围内，避免骨骼扭曲。
