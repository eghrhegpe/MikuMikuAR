---
kind: global_state
name: 全局状态与场景运行时 Store
category: core
scope:
  - frontend/src/core/state.ts
  - frontend/src/core/scene-state.ts
  - frontend/src/core/playback-state.ts
  - frontend/src/core/library-state.ts
  - frontend/src/core/ui-state.ts
source_files:
  - frontend/src/core/state.ts
  - frontend/src/core/scene-state.ts
  - frontend/src/core/playback-state.ts
  - frontend/src/core/library-state.ts
adr:
  - ADR-141
  - ADR-137
---

## 系统概览
全局可变状态的唯一来源（single source of truth）。原 `state.ts` 在 ADR-141 拆分为 `scene-state` / `playback-state` / `library-state` / `ui-state` 四个独立 store，`state.ts` 本身仅作为 barrel re-export，保证 `from '@/core/state'` 与 `from '@/core/config'` 的外部 import 路径零变化。环境状态（EnvState）的字段定义另见 `env-state-schema.ts`（ADR-137）。

## 核心职责
- `scene-state.ts` — 场景运行时：`mmdRuntime`、`modelRegistry`、`propRegistry`、`focusedModelId`、脚部地面跟随 `FeetState`
- `playback-state.ts` — 播放控制：`isPlaying`、`autoLoop`、`seekDragging`
- `library-state.ts` — 资源库：`libraryRoot`/`resourceRoot`、`overridePaths`、`allModels`、缩略图缓存

> 注：`ui-state.ts`（UI 持久态 `popupOpen` / `uiState` / `activeTimeOfDayPreset`）另有独立卡片 `ui-state.md` 详述，本卡仅将其列为 ADR-141 拆分家族一员。

## 对外 API（节选）
- `setMmdRuntime(r)` / `setModelRegistry(m)` / `setPropRegistry(m)` / `setFocusedModelId(id)` — 场景运行时唯一写入点
- `getMmdRuntimeType()` / `setMmdRuntimeType('wasm'|'js')` — localStorage 持久的运行期类型切换（Fail-Fast：localStorage 不可用直接抛错，ADR-105）
- `createDefaultFeetState()` — 脚部地面跟随默认参数（ADR-085）
- `setResourceRoot(r)` — 同步联动 `libraryRoot`（历史兼容，P2 防御）
- `setUIState(state)` — `Object.assign` 后触发持久化回调；回调异常被 `try/catch` 吞掉不阻塞 UI（P3 防御）
- `setActiveTimeOfDayPreset(key)` — 预设芯片高亮唯一来源，env-menu 顶层与 sky 子菜单共享

## 状态访问规约（[fix:ghost-state] P3 防御）
- 所有 `export let` 仅供读取，外部模块禁止直接赋值
- 修改必须走对应 `setXxx()` 写入点，保证状态变更可追踪（单一写入点原则）
- 引用类型变量（Map/Set/数组）**内容**可被 mutate，但**引用本身**替换必须走 setter

## 与其他子系统关系
- `env-state-schema.ts` 派生 EnvState 默认值与 dispatch 分组
- `reactivity.ts` 的 `setEnvState` 经 Proxy 整体赋值触发刷新
- 所有场景子系统（env/motion/render）只读这些 store，写入经 setter
