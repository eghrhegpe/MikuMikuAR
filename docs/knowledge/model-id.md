---
tier: leaf
kind: model_id
name: 模型运行时 ID 解析
category: scene
scope:
  - scene/manager/model-id.ts
source_files:
  - frontend/src/scene/manager/model-id.ts
adr:
  - ADR-116
  - ADR-150
symbols:
  - resolveModelId
invariants:
  - 同一模型在存档恢复时复用 preferredId，不重新生成，避免材质/outfit/个人灯按 id 落盘后孤儿化
tests:
  - frontend/src/__tests__/scene/resolve-model-id.test.ts
use_when:
  - 模型运行时 id
  - 模型加载时 id 分配
  - resolveModelId
---

# 模型运行时 ID 解析

## 系统概览

模型运行时 id 的解析与分配模块。替代旧实现 `model_${Date.now()}_${Math.random()}`，保证每次加载同一模型时 id 稳定，避免材质、outfit、个人灯光等按 id 落盘的数据跨会话丢失。

## 核心职责

- `model-id.ts` — 导出唯一函数 `resolveModelId(preferredId?)`：优先复用存档传入的 preferredId，否则生成稳定 uuid

## 对外 API（节选）

- `resolveModelId(preferredId?)` — 解析模型运行时 id。优先复用传入的 preferredId（非空字符串），否则调用 `generateUuid()` 生成新 id

## 与其他子系统关系

- 被 `model-loader.ts` / `model-ops.ts` 在加载模型时调用来确定模型 id
- 依赖 `@/core/uuid` 的 `generateUuid`（ADR-191 去桶化后为零依赖叶直连）

## 不变量

- 同一模型在存档恢复路径中传入同一 preferredId 时，id 必须不变
- 不引入 Babylon.js 依赖，便于单测

## 验证入口

- 测试：`frontend/src/__tests__/scene/resolve-model-id.test.ts`
- 命令：`cd frontend && npm run test -- scene/resolve-model-id.test.ts`