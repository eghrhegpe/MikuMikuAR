---
kind: scene_serialize
name: 场景序列化与自动保存
category: scene
scope:
  - frontend/src/scene/**
source_files:
  - frontend/src/scene/scene-serialize.ts
adr: []
symbols:
  - SceneFile
  - canUndo
  - deserializeScene
  - offerSceneUndo
  - offerSceneUndoAndRefresh
  - popUndoSnapshot
  - pushUndoSnapshot
  - resolvePathFromRef
  - restoreUndoSnapshot
  - saveSceneImmediate
  - serializeScene
  - setSuppressAutoSave
  - triggerAutoSaveImpl
  - tryRestoreLastScene
invariants:
  - 自动保存防抖由 scene.ts 的 viewMatrix observer/change observer 触发 scheduleAutoSave
  - undo/redo 使用栈式快照（pushUndoSnapshot → popUndoSnapshot），栈满丢弃最旧
  - deserializeScene 调用 scene-migrate 处理旧档格式迁移
  - tryRestoreLastScene 在启动时经 Go 后端 LoadLastScene 恢复上次关闭场景
tests: []
use_when:
  - 场景序列化
  - 场景保存
  - 场景恢复
  - 撤销/重做
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
