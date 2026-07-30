---
kind: env_water
name: 水面系统
category: env
scope:
  - frontend/src/scene/env/env-water.ts
source_files:
  - frontend/src/scene/env/env-water.ts
  - frontend/src/scene/env/env-noise.ts
adr:
  - ADR-062
symbols:
  - createWater
  - disposeWater
  - refreshWaterRenderList
  - updateWaterAnimSpeed
  - addRipple
  - clearRipples
  - addGroundRipple
  - clearGroundRipples
  - updateUnderwaterTransition
  - resetUnderwaterState
  - isUnderwaterActive
  - selectWaterLOD
  - getWaterPhase
  - computeWaveDirs
  - buildWaterPresetEnvState
  - applyWaterPresetToCurrent
invariants:
  - disposeWater 级联释放水面 RT + 材质 + 镜像相机
  - 涟漪（ripple）独立于水面主体
  - 水下过渡效果与水面可见性联动
tests: []
use_when:
  - 水面
  - 水池
  - 水面反射
---

## 系统概览
**水面系统**。在地面之上生成动态水面，支持波纹动画和反射效果。

## 核心职责
- `env-water.ts` — 水面网格创建、波纹动画、反射效果、资源释放。

## 对外 API（节选）
- `initWater(scene, options)` — 初始化水面。
- `disposeWater()` — 释放水面资源（含反射 RT）。
- `updateWater(deltaTime)` — 更新水面动画。

## 与其他子系统关系
- 被 `env-impl.ts` 调用初始化。
- 参数来源：`envState.water`。
- 反射：可能使用 `env-reflection.ts` 的反射技术。

## 不变量
- 水面反射 RT（RenderTexture）在 `disposeWater` 中释放。
- 水面对象在场景 dispose 时级联释放。
- 小波细节波受 `smallWaveEnabled` 门控：关闭时 `_syncWaterUniforms` 向 shader 送 `smallWaveHeight=0`（水面呈纯净反射面），字段缺失时 `?? true` 兜底为开启。此为水面功能开关体系试点，复用地面 `folder + headerToggle` 模式（开关只控 shader 输出，不联动置灰 slider）。
