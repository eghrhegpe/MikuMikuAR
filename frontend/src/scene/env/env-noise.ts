// env-noise.ts — 过渡期 re-export barrel
// 实现已迁至 @/core/math/hash-noise.ts（ADR-212：命名 vs 功能审计）
// 待所有消费方迁移完成后可删除本文件。

export { hash2, hash2v, valueNoise } from '@/core/math/hash-noise';