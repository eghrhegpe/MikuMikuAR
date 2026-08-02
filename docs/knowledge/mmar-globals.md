---
tier: leaf
kind: mmar_globals
name: window.__mmar 运行时状态暴露
category: core
scope:
  - frontend/src/core
source_files:
  - frontend/src/core/mmar-globals.ts
adr: []
symbols:
  - MmarPhase
  - MmarStatus
  - MmarSceneSnapshot
  - MmarGlobal
  - updateMmarStatus
  - refreshSceneSnapshot
  - startSceneSnapshotPolling
  - stopSceneSnapshotPolling
invariants:
  - 轻量叶子模块：仅依赖普通 JS 全局与动态 import，无静态内部模块耦合
  - 模块加载即幂等 ensureMmar()，保证 window.__mmar 始终就绪（读取方无需 `!` 断言）
  - refreshSceneSnapshot 使用动态 import 避免与 scene/ 的循环依赖；引擎/配置未就绪时字段静默保持零值不抛错
  - 周期轮询（startSceneSnapshotPolling）幂等，重复注册安全
tests: []
use_when:
  - window.__mmar
  - 运行时状态
  - 场景快照
  - 外置 LLM 读取
---

# window.__mmar 运行时状态暴露

## 系统概览
将运行时结构化状态挂载到 `window.__mmar`，供外置 AI（LLM）直接读取快照。幂等初始化 + 周期轮询刷新场景 FPS/模型数/GPU/质量档位等，动态 import 避免循环依赖。

## 核心职责
- `MmarGlobal` / `MmarStatus` / `MmarSceneSnapshot` — 状态类型
- `updateMmarStatus(phase, text, detail?)` — 状态更新
- `refreshSceneSnapshot()` — 动态 import scene/config/gpu-capabilities 刷新快照
- `startSceneSnapshotPolling()` / `stopSceneSnapshotPolling()` — 周期刷新（幂等）

## 与其他子系统关系
- 动态读取 `scene/scene`、`core/config`、`core/gpu-capabilities`、`scene/manager/model-ops`、`scene/motion/motion-intent`
- 被 AI 诊断 / 外部 LLM 集成读取

## 不变量
- 轻量叶子模块：仅依赖普通 JS 全局与动态 import，无静态内部模块耦合
- 模块加载即幂等 ensureMmar()，保证 window.__mmar 始终就绪（读取方无需 `!` 断言）
- refreshSceneSnapshot 使用动态 import 避免与 scene/ 的循环依赖；引擎/配置未就绪时字段静默保持零值不抛错
- 周期轮询（startSceneSnapshotPolling）幂等，重复注册安全
