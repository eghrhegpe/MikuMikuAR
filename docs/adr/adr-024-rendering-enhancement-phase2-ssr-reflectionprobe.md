# ADR-024: 渲染增强 Phase 2（精简版）

> **状态**: ✅ 部分完成 — SSR/ReflectionProbe/SSAO 已实施，SSS 阻塞未实施
> **日期**: 2026-07-04

---

## 背景

Phase 1（Motion Blur / Sharpen / GlowLayer）已完成，管线从 10 类后处理扩展到 13 类。Phase 2 目标：SSR、SSAO、Reflection Probe、SSS。

**核心约束**：所有 PMX 模型使用 `StandardMaterial`（babylon-mmd morph 系统深度绑定 StandardMaterial）。全量 PBR 迁移会导致 morph 权重/材质动画/outline 全部失效。

---

## 已实施的决策

### SSR（屏幕空间反射）✅

使用 Babylon.js `SSRRenderingPipeline`（独立 pipeline，与 `DefaultRenderingPipeline` 并行）。

| 要点 | 说明 |
|------|------|
| 与材质无关 | 读取 depth/normal/reflectivity buffer |
| 已知限制 | StandardMaterial 默认 reflectivity 黑色，效果有限 |
| SSR + Bloom 互斥 | Bloom weight > 0.5 时自动降低 SSR 强度 |
| 性能降级 | L1 关闭 SSR，L2/L3 关闭 SSR + Reflection Probe |

**UI 映射**：

| UI 参数 | SSR 属性 | 范围 |
|---------|---------|------|
| 反射强度 | `strength` | 0-1 |
| 边缘衰减 | `reflectionSpecularFalloffExponent` | 1-8 |
| 步长 | `step` | 1-32 |
| 厚度容差 | `thickness` | 0-2 |

### Reflection Probe（环境反射探针）✅

- 渲染尺寸 256px，`refreshRate = 0`（静态环境仅渲染一次）
- 每 10 秒检查环境变化并刷新 renderList
- renderList 含 sky/env/ground/water mesh，**不含模型**（避免自身反射）
- 绑定到 StandardMaterial 的 `reflectionTexture`

### SSAO（屏幕空间环境遮蔽）✅

与 StandardMaterial 兼容，实现细节见原文件 §3。

---

## SSS（次表面散射）❌ — 阻塞

**阻塞原因**：依赖 babylon-mmd 支持 PBR 材质，上游未支持 StandardMaterial 以外的 morph 目标。**上游阻塞，非本项目范畴。**

---

## 相关 ADR

- ADR-062（水面反射）：本 ADR 的 ReflectionProbe 是 cubemap 反射源，与 planar RT 分层混合