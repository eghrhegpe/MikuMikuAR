---
kind: env_noise
name: 噪声 barrel 重导出
category: env
scope:
  - frontend/src/scene/env/env-noise.ts
source_files:
  - frontend/src/scene/env/env-noise.ts
adr:
  - ADR-212
symbols:
  - hash2
  - hash2v
  - valueNoise
invariants:
  - 纯 re-export barrel，无独立逻辑
  - 实现已迁至 @/core/math/hash-noise.ts（ADR-212 命名 vs 功能审计）
  - 待所有消费方迁移完成后可删除本文件
tests: []
use_when:
  - 噪声
  - hash-noise
  - 值噪声
---

## 系统概览
**过渡期 re-export barrel**。原 `env-noise.ts` 内的噪声实现已迁至 `core/math/hash-noise.ts`（ADR-212 经过命名 vs 功能审计），本文件仅作为兼容层 `export { hash2, hash2v, valueNoise }`。待所有消费方完成迁移后删除。

## 核心职责
- `env-noise.ts` — 重导出 `core/math/hash-noise` 的 `hash2` / `hash2v` / `valueNoise`。

## 对外 API（节选）
- `hash2(x, y)` — 二维确定性哈希。
- `hash2v(x, y)` — 返回二维单位向量。
- `valueNoise(x, y)` — 值噪声。

## 与其他子系统关系
- 实现真相源：`core/math/hash-noise.ts`（[确定性哈希与值噪声](./hash-noise.md)）。
- 消费方（如 `env-caustics.ts`、`env-underwater-fog.ts`）应逐步改为直接引用 `@/core/math/hash-noise`。

## 不变量
- 纯重导出：不含任何自有逻辑，改动应落到 `core/math/hash-noise.ts`。
- 删除条件：仅当无迁移方再引用 `env-noise` 时方可移除（避免破坏仍走老路径的消费者）。
