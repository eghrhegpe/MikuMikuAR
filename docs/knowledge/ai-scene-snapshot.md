---
kind: ai_scene_snapshot
name: 场景运行时快照（AI 上下文）
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/scene-snapshot.ts
adr:
  - ADR-196
symbols:
  - SceneSnapshotBridge
  - registerAiSnapshotBridge
  - formatSceneSnapshot
  - captureSceneSnapshot
invariants:
  - 采用 bridge 模式（对齐 performance.ts 的 registerRenderBridge），scene.ts 在 initScene() 注入引擎引用
  - 避免 ai → scene 静态依赖（保持零循环依赖）；未注册 bridge 时 captureSceneSnapshot 返回占位文本
  - 格式化输出受 ≤2048 字符预算约束（NFR-3）
tests: []
use_when:
  - 场景快照
  - 诊断上下文
  - FPS / 模型数
---

## 系统概览
ADR-196 场景运行时快照采集，经 bridge 模式由 `scene.ts` 注入引擎读取接口，供 AI 诊断助手注入 FPS/模型数/材质数/活动动画/GPU 等上下文，避免 ai 模块与 scene 的循环依赖。

## 核心职责
- `SceneSnapshotBridge` — 引擎运行时读取接口（getFps / getModelCount / ... / getKtx2Support）
- `registerAiSnapshotBridge(bridge)` — scene.ts 在 initScene 注入
- `formatSceneSnapshot(d)` — 纯数据格式化（≤2048 字符预算）
- `captureSceneSnapshot()` — 采集当前快照文本，未初始化返回占位符

## 与其他子系统关系
- bridge 由 `scene/scene.ts` 注入
- 被 `menus/settings-diagnostic.ts` 调用

## 不变量
- 见 frontmatter
