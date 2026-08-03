# babymmd 骨骼绑定告警刷屏（Binding failed 预期行为 + 生产静音）

> **状态**: 🟢 已修复

**日期**: 2026-08-03
**严重程度**: 🟡 P3
**影响范围**: `frontend/src/scene/scene.ts`（loggingEnabled 门控）
**发现方式**: 用户反馈
**修复提交**: `ba17bc2f`

---

## 问题描述

加载模型/动作后，控制台刷屏大量 babylon.js 告警：

```
BJS - Binding failed: bone スカート_1_10 not found
BJS - Binding failed: IK bone 右ひじＩＫ not found
BJS - Binding failed: runtime bone 髪BCL3 not found
```

但视觉上模型动作/物理完全正常，无任何可见异常。

## 复现步骤

1. 加载含物理骨（裙摆/头发）的 PMX 模型并绑定 VMD
2. 观察控制台：加载瞬间刷出几十条 `Binding failed` 告警
3. 画面照常播放，物理照常模拟

## 根因分析

babymmd fork 的骨骼绑定是**「精确匹配 + 失败跳过」设计**（`mmdRuntimeModelAnimation.pure.js` `MmdRuntimeModelAnimation.Create`）：

| 告警类型 | 查表 | 失败后果 | 视觉影响 |
|----------|------|---------|---------|
| `bone スカート_*`（普通骨骼轨道） | `linkedBoneMap`（模型骨架） | 轨道置 null 跳过 | 无——物理骨由物理引擎驱动，不依赖动画轨道 |
| `IK bone 右ひじＩＫ`（IK 开关轨道） | `runtimeBoneMap`（运行时骨骼） | `ikSolverBindIndexMap[i] = -1` | 无——IK 求解由 `beforePhysics` 每帧驱动（`mmdRuntime.js:356/404`），不依赖动画开关轨道 |
| `runtime bone 髪BCL3`（骨骼-刚体联动） | `runtimeBoneMap` | `boneToBodyBindIndexMap[i] = null` | 骨骼-刚体状态联动降级，骨骼动画照播 |

**关键点**：
1. 告警级别是 `warn` 而非 `error`——失败只丢弃该轨道，不崩溃
2. `runtimeBoneMap` 从 `model.runtimeBones` 构建，**不受 retargetingMap 影响**——所以 `IK bone`/`runtime bone` 类告警无法靠传入 retargetingMap 消除
3. 全角/半角命名不一致（如 `右ひじＩＫ` 全角 vs `左ひじIK` 半角）是模型作者命名不规范，逐字符精确匹配天然漏

**为什么刷屏**：`scene.ts:740` 硬编码 `runtime.loggingEnabled = true`——而 babymmd **默认是静音的**（`mmdRuntime.js:84` 把 `log/warn` 指到 `_logDisabled`）。项目主动打开了告警开关，导致每次加载都全量输出。

## 修复方案

`scene.ts:740` 将 `loggingEnabled` 改为**仅 dev 构建开启**：

```ts
// 生产静音：Binding failed 告警是「失败跳过」设计、视觉无影响，属预期噪音。
// 默认 loggingEnabled=false（babymmd 静音），仅 dev 构建开启以便调试绑定问题。
if (import.meta.env.DEV) {
    runtime.loggingEnabled = true;
}
```

- 生产构建：默认静音，用户不再被刷屏
- dev 构建：保留告警，调试绑定问题时诊断信息还在

## 顺带探查结论（三链路健康）

| 探查方向 | 结论 |
|----------|------|
| vmd-loader 加载链路 | ✅ 健康（generation counter 防竞态 / WASM 句柄清理 / 时钟归零齐全） |
| babymmd fork KTX2 修改点（ADR-189 `ResolveForcedExtension`） | ✅ 健康（双版本 magic 兼容 Ktx2Magic/Ktx21Magic，<12 字节边界无实际影响） |
| retargetingMap 死参数 | ✅ 不影响 mixamo/vrm（外部动画走自研 `AnimationRetargeter` 独立链路，不经 babymmd retargetingMap） |

## 教训

1. **babymmd 绑定告警 ≠ 绑定错误**：`Binding failed` 是「精确匹配 + 失败跳过」的预期日志，丢的全是可选项轨道（物理骨/IK 开关/刚体联动），视觉无损。
2. **`loggingEnabled` 是全局开关**：babymmd 默认静音，项目主动打开后刷屏——排查告警前先确认是「项目设置的」还是「babymmd 默认的」。
3. **retargetingMap 覆盖范围有限**：只影响 `linkedBoneMap`（普通骨骼轨道），不影响 `runtimeBoneMap`（IK/物理骨）——想根治全角/半角命名需在 fork 层给 runtimeBoneMap 加别名匹配（ADR-189 §3.5 修改指南范围内），属独立增强。
