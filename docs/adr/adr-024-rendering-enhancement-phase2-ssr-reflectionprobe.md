# ADR-024: 渲染增强 Phase 2（精简版）

> **状态**: ✅ SSR/ReflectionProbe/SSAO 已完成，SSS 阻塞已解除（2026-07-27 babylon-mmd fork 新增 PBRMaterialProxy，PBR material morph 通路打通，SSS 着色器可自实现）
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
| 性能降级 | 原策略 L1 关闭 SSR，L2/L3 关闭 SSR + Reflection Probe；**ADR-151 收口后改为**由 qualityProfile 写入 `env.reflectionQuality`（SSR 仅 `high` 档启用、Probe 各档保留），不再经 `setRenderState` 切换开关，详见 [ADR-151](adr-151-reflection-unified-architecture.md) |

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
- **管理入口已并入 ADR-151**：Probe 的创建 / 绑定 / 刷新 / 销毁现统一由 `env-reflection.ts` 的 `applyReflection` / `bindProbeToMeshes` / `disposeReflection` 驱动（新增 `reflectionMode` 字段控制激活），本 ADR 仅保留设计动机与参数基线，详见 [ADR-151](adr-151-reflection-unified-architecture.md)

### SSAO（屏幕空间环境遮蔽）✅

与 StandardMaterial 兼容，实现细节见原文件 §3。

---

## SSS（次表面散射）✅ — 阻塞已解除

**原阻塞原因（已解决）**：依赖 babylon-mmd 支持 PBR 材质的 material morph。2026-07-27 babylon-mmd fork 新增 `PBRMaterialProxy` / `MmdPBRMaterialProxy`（IMmdMaterialProxy 注册表 + per-material 自动查找），PBR material morph 通路已打通。

**现策略**：SSS 着色器逻辑由项目自行实现（路径B），基于 PBRMaterialBuilder 加载的 PBRMaterial 编写次表面散射效果，无需上游阻塞。待 ADR-188 PBR 迁移完成后即可启动。

---

## 相关 ADR

- ADR-062（水面反射）：本 ADR 的 ReflectionProbe 是 cubemap 反射源，与 planar RT 分层混合
- [ADR-151](adr-151-reflection-unified-architecture.md)（反射系统统一架构）：**本 ADR 的 ReflectionProbe 管理已合并至 ADR-151**（SSR/Probe 单源收口到 `reflectionMode`/`reflectionQuality`，降级策略亦改由 `reflectionQuality` 驱动）。后续维护以 ADR-151 为准。