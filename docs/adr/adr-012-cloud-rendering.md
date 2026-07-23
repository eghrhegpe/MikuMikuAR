# ADR-012: 云渲染改进 — Perlin 噪声 + 双分层

> **日期**: 2026-06-27
> **状态**: 已完成 — env-clouds.ts Perlin FBM 噪声 + 双分层云 + 风漂移视差

---

## 背景

当前云渲染实现（Phase 8 产物）使用单张 256×256 canvas，`Math.random()` 像素独立噪声 + alpha 硬裁，贴到单平面 200×200 上。视觉效果差：像「像素雪花毯子」，无体积感、无云朵形状、边缘锯齿。

## 决策

采用方案 **Perlin 噪声 + 双分层**（方案 A），不做 GPU 着色器云（方案 C），不做纹理持久化（方案 B）。

## 方案详述

### 纹理生成

- 内联 2D Perlin 噪声函数（~40 行纯 JS，不引入库）
- Canvas 尺寸 256→**512×512**
- 叠加两层噪声（低频 large blobs + 高频细节），`octaves=2`
- Alpha 输出改为 `smoothstep(threshold, 1.0, noise)`，消除硬裁边缘
- 受 `cloudCover` 参数控制阈值

### 双分层

- 两层 `MeshBuilder.CreatePlane`，高度差 30 单位（`y ± 15`）
- 下层缩放放大 1.2x，透明度略高（`alpha 0.4` vs 上层 `0.5`）
- 共享同一张纹理（`material.diffuseTexture` 复用）
- 风漂移速度差 15%（下层 ×0.85），产生 parallax 视差

### 每帧更新

- `_ensureEnvUpdateObserver` 同时漂移两层位置
- 下层速度 * 0.85，维持视觉深度感

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| Perlin 噪声生成阻塞主线程 | 低 | 512×512 单次 < 5ms，远低于 16ms 帧预算 |
| 双平面 fill rate | 低 | 每层 200×200 ≈ 40 万像素，x2 仍可忽略 |
| cloudCover 变化需重新生成纹理 | 低 | 仅参数变更时触发，毫秒级可接受 |
| Perlin 跨平台一致性 | 无 | 纯 JS 实现，与 GPU/浏览器无关 |

## 替代方案

### 方案 B（预计算纹理图集）

在方案 A 基础上将 Perlin 纹理缓存为 data URL，避免重启时重生成。**否决理由**：收益小于复杂度增加（重生成 < 5ms，不值得缓存逻辑）。

### 方案 C（GPU ProceduralTexture）

噪声计算移到 GLSL 着色器，由 GPU 并行生成。**否决理由**：部分设备 WebGL 兼容性风险 + 着色器维护成本 > 当前视觉收益。
