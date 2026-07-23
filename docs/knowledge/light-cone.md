---
kind: light_cone
name: 光锥网格
category: rendering
scope:
  - frontend/src/scene/render/**
source_files:
  - frontend/src/scene/render/light-cone.ts
adr:
  - ADR-152
---

## 系统概览
为 SpotLight 生成可见锥形光柱（替代 ADR-152 的屏幕后处理假体积光）。使用锥体 Mesh + 自定义 ShaderMaterial（additive blending、距离衰减 + Fresnel 边缘辉光）。支持运行时更新 transform、uniforms、重建几何。

## 核心职责
- `light-cone.ts` — 光锥创建、transform 更新、uniform 更新、几何重建、释放。

## 对外 API（节选）
- `LightConeEntry` — 光锥条目接口（mesh / material / geoLength / geoAngle）。
- `createLightCone(scene, light, color, intensity, coneLength, softness)` — 为聚光灯创建光锥。
- `updateLightConeTransform(entry, light, coneLength)` — 更新光锥位置/朝向（每帧或灯光移动时调用，复用模块级临时向量避免 GC 压力）。
- `updateLightConeUniforms(entry, color, intensity, softness, coneLength)` — 更新 shader uniforms。
- `rebuildLightConeGeometry(entry, scene, light, coneLength)` — 锥长/锥角变化时重建几何。
- `setLightConeEnabled(entry, enabled)` — 设置光锥可见性。
- `disposeLightCone(entry)` — 释放光锥资源（先 mesh 后 material）。

## Shader 特性
- 距离衰减：`pow(1 - t, 1.5)`，t 为距锥顶归一化距离。
- Fresnel 边缘辉光：`pow(1 - |NdotV|, 1 + softness*2)`。
- Additive blending，不写深度（避免遮挡其他透明物体）。

## 与其他子系统关系
- 被 `lighting.ts` 的舞台灯光系统引用。
- 依赖 `dispose-helpers` 的 `safeDispose` 释放资源。