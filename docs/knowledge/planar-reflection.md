---
kind: planar_reflection
name: 统一平面反射引擎
category: env
scope:
  - frontend/src/scene/env/planar-reflection.ts
source_files:
  - frontend/src/scene/env/planar-reflection.ts
adr:
  - ADR-092
---

## 系统概览
统一平面反射引擎（ADR-092）。水面（screenSpace：RenderTargetTexture + 镜像相机 + ShaderMaterial 屏空采样）与地面（mirrorTexture：MirrorTexture 引擎自动投影）共用同一套基础设施：RT 创建、BFC 存取、renderList 脏标记、帧跳过、try/catch 渲染、dispose、可恢复互斥。

## 核心职责
- `ReflectionMode = 'mirrorTexture' | 'screenSpace'`；`PlanarReflectionConfig`（name / mode / resolutionMap / getQuality / getBlend）
- 帧跳过：`FRAME_SKIP`（high 每帧、medium 每2帧、low 每4帧、off 跳帧），两模式共用
- 互斥可恢复：启用某面 `requestExclusive` 关闭另一面；某面关闭 `releaseExclusive` 触发另一面按各自 envState 重建 → 关地即开水、关水即开地，根治「双双失效」
- 地面 MirrorTexture 不再手动 `.render()` / push customRenderTargets（由 Babylon 随材质自动渲染），根除「双重驱动」稳态反射错乱

## 对外 API（节选）
- `PlanarReflectionConfig` / `ReflectionMode` 类型
- 引擎工厂（按 mode 创建 RT/镜像相机/ShaderMaterial，含脏标记 + 帧跳过 + 安全渲染）

## 关键约定
- 反射质量/混合由 envState 驱动；dispose 级联释放 RT + 相机 + 材质

## 与其他子系统关系
- 被 `env-water.ts`（screenSpace）、`env-ground.ts`（mirrorTexture）复用
- 依赖 `env-type-helpers.ts`（`REFRESHRATE_RENDER_ONCE` / `FrozenCamera`）
- 性能联动：`render/performance-env-bridge`（劣化时降反射）
