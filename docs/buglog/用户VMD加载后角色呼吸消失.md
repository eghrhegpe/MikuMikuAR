# 用户 VMD 加载后角色呼吸消失

**日期**: 2026-07-09
**严重程度**: P1（体验缺陷，角色"不再活着"）
**影响范围**: `perception.ts`（重建）+ `proc-motion-bridge.ts`（触发）
**发现方式**: 代码逻辑审查

---

## 问题描述

角色在 idle 状态下有呼吸、眨眼、视线追踪。

加载用户 VMD 后，`updateProcMotion` 发现 `hasUserVmd` 就 `stopProcMotion()`。程序化动作停止，呼吸眨眼随之消失。

角色变成了一具精致的木偶——动作有，但生命没了。

## 根因分析

呼吸、眨眼、视线追踪寄生在程序化 VMD 的生命周期内。

```typescript
function updateProcMotion() {
    if (hasUserVmd) {
        stopProcMotion();  // 呼吸眨眼随之停止
    }
}
```

这是因为早期设计把呼吸/眨眼当作"程序化动作的一部分"——和 idle 动作、autodance 动作一起生成 VMD 关键帧。

但呼吸不是动画效果。呼吸是生命体征。

## 为什么没有暴露

联邦的设计意图是"角色总是活的"。但代码里，"角色活"的条件是"程序化动作在跑"。

当用户加载自己的 VMD 时，"程序化动作在跑"这个条件不成立了。

## 修复方案

ADR-071：感知层重构。

将呼吸、眨眼、视线追踪从程序化 VMD 中抽离，拆分为六个独立子模块（`perception-breathing.ts`、`perception-blinking.ts`、`perception-gaze.ts`、`perception-expression.ts`、`perception-balance.ts`、`perception-lipsync.ts`）。

每个子模块绑定 Babylon.js 的 `onBeforeRenderObservable`，每帧实时叠加，不随 VMD 生命周期变化。

## 教训

1. **生命体征不是动画效果** — 呼吸、眨眼、重心微动，这些是角色"活着"的证明。它们不应该寄生在动作系统里
2. **"总是活的"是一个契约，不是状态** — 代码里必须有机制保证这个契约成立，不管 VMD 在跑不在跑
