---
kind: motion_history
name: 动作历史管理
category: motion
scope:
  - frontend/src/scene/motion/motion-modules/motion-history.ts
source_files:
  - frontend/src/scene/motion/motion-modules/motion-history.ts
adr: []
symbols:
  - MotionHistoryEntry
  - SnapshotBuilder
  - SnapshotApplier
  - pushHistory
  - undo
  - redo
  - canUndo
  - canRedo
  - getHistoryEntries
  - getHistoryCursor
invariants:
  - 动作历史管理
  - 可撤销/重做
tests: []
use_when:
  - 动作历史
  - 撤销
  - 重做
  - 动作记录
---

## 系统概览
**动作历史管理模块**。记录动作参数变更历史，提供撤销/重做功能，支持多步骤回退。

## 核心职责
- `motion-history.ts` — 动作参数历史记录、撤销/重做。

## 对外 API（节选）
- `interface MotionHistoryEntry` — 动作历史条目。
- `pushHistory(modelId, builder)` — 推送历史快照。
- `undo(modelId, applier)` / `redo(modelId, applier)` — 撤销/重做。
- `canUndo(modelId)` / `canRedo(modelId)` — 可撤销/重做状态。
- `getHistoryEntries(modelId)` / `getHistoryCursor(modelId)` — 取历史记录和光标位置。

## 与其他子系统关系
- 注册表：`./registry.ts`。
- 动作参数：`../motion-intent.ts`。

## 不变量
- 历史记录限制最大条目数，超出时丢弃最早记录。
- 每次参数变更自动保存历史快照。
