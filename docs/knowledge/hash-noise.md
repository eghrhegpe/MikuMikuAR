---
kind: hash_noise
name: 确定性哈希与值噪声
category: core
scope:
  - frontend/src/core/math/hash-noise.ts
source_files:
  - frontend/src/core/math/hash-noise.ts
adr:
  - ADR-212
symbols:
  - hash2
  - hash2v
  - valueNoise
invariants:
  - 纯函数，零依赖，无副作用
  - seed 相同则结果可复现
  - 返回值域 [0,1]（hash2/valueNoise）或 [[0,1],[0,1]]（hash2v）
tests: []
use_when:
  - 确定性哈希
  - 值噪声
  - 水面细节法线
  - 焦散 Voronoi
  - 地形 FBM
  - 程序化纹理
---
## 系统概览
Hash Noise：从 `scene/env/env-noise.ts` 迁入 `core/math/` 的确定性哈希与值噪声纯函数族（ADR-212 命名 vs 功能审计）。原 `env-noise.ts` 降级为过渡期 re-export barrel。此模块无状态、零依赖，属纯叶子。

## 核心职责
- `hash-noise.ts` — 提供 `hash2`（整数哈希→[0,1]）、`hash2v`（二元组哈希→[[0,1],[0,1]]）、`valueNoise`（平滑值噪声→[0,1]）三个纯函数。

## 对外 API（节选）
- `hash2(ix: number, iy: number, seed = 0): number` — 确定性整数哈希，xorshift-mix + Math.imul
- `hash2v(ix: number, iy: number, seed = 0): [number, number]` — 二元组哈希，供 Voronoi 需要两个独立随机偏移的场景
- `valueNoise(x: number, y: number, seed = 0): number` — 平滑值噪声，四角哈希 + smoothstep 双线性插值

## 与其他子系统关系
- 被 `env-water.ts` 引用（小波细节法线）
- 被 `env-caustics.ts` 引用（焦散 Voronoi）
- 被 `env-terrain.ts` 引用（地形 FBM）
- 被 `env-noise.ts`（过渡期 barrel）re-export

## 不变量
- 纯函数，无副作用，无外部依赖
- seed 相同则 `hash2`/`hash2v`/`valueNoise` 结果确定可复现
- 返回值域始终在 [0,1] 范围内

## 验证入口
- 命令：`cd frontend && npm run test`