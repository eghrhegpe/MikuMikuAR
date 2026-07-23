---
kind: scene_serialize
name: 场景序列化与自动保存
category: scene
scope:
  - frontend/src/scene/**
source_files:
  - frontend/src/scene/scene-serialize.ts
adr: []
---

## 系统概览
场景序列化与自动保存（[doc:architecture]）。定义 `SceneFile` 结构、serialize/deserialize、auto-save debounce、last-scene restore。从 `scene.ts` 静态导入但仅在函数体内访问（ES module live binding 保证安全）。

## 核心职责
- `scene-serialize.ts` — SceneFile 类型、场景序列化/反序列化、自动保存防抖、上次场景恢复

## 对外 API（节选）
- `serializeScene()` / `deserializeScene()` — 场景 ↔ SceneFile
- `SaveLastScene` / `LoadLastScene` 封装（Go 后端）
- auto-save debounce（基于 `core/utils` 的 `debounce`）

## 与其他子系统关系
- 引用 `core/config`（envState / modelRegistry / propRegistry）、`motion-intent`（场景动作）、`camera`（相机状态/FOV）、audio、`scene-migrate`（旧档迁移）
- 由 `scene-bundle` / `initScene` 在保存/恢复时调用
