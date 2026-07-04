# ADR-024: 渲染增强 Phase 2 — SSR / SSAO / Reflection Probe / SSS 决策

**日期**：2026-07-04

---

## 背景

Phase 1（Motion Blur / Sharpen / GlowLayer）已完成，渲染管线从 10 类后处理扩展到 13 类。Phase 2 目标是引入更高级的渲染特性：SSR（屏幕空间反射）、SSAO（屏幕空间环境遮蔽）、Reflection Probe（环境反射探针）、SSS（次表面散射）。

核心约束：当前所有 PMX 模型材质使用 `StandardMaterial`（通过 `MmdStandardMaterialProxy`），babylon-mmd 的 morph 系统深度绑定 `StandardMaterial`。全量 PBR 迁移会导致 morph 权重、材质动画、outline 全部失效，且 MMD 专用的 toon/sphere 纹理在 PBR 中无对应。

---

## 决策

### 1. SSR（屏幕空间反射）— 已实施 ✅

**方案**：使用 Babylon.js `SSRRenderingPipeline`（独立 pipeline，不走 `DefaultRenderingPipeline`）。

**关键设计**：
- `SSRRenderingPipeline` 是 `PostProcessRenderPipeline` 的子类，与 `DefaultRenderingPipeline` 并行运行在同一相机上
- 读取 depth/normal/reflectivity buffer，与材质类型无关
- StandardMaterial 默认 reflectivity 为黑色（不反射），SSR 在标准材质上效果有限 — 这是已知限制
- 新增 6 个 RenderState 字段：`ssrEnabled` / `ssrStrength` / `ssrFalloff` / `ssrStep` / `ssrThickness` / `reflectionProbeEnabled`
- SSR + Bloom 互斥：Bloom weight > 0.5 时自动降低 SSR 强度防止白出
- 性能降级：L1 关闭 SSR，L2/L3 关闭 SSR + Reflection Probe

**映射关系**：
| UI 参数 | SSRRenderingPipeline 属性 | 范围 |
|---------|--------------------------|------|
| 反射强度 | `strength` | 0-1 |
| 边缘衰减 | `reflectionSpecularFalloffExponent` | 1-8（UI 0-1 线性映射） |
| 步长 | `step` | 1-32 |
| 厚度容差 | `thickness` | 0-2 |

### 2. Reflection Probe（环境反射探针）— 已实施 ✅

**方案**：使用 Babylon.js `ReflectionProbe` 捕获环境反射，绑定到 StandardMaterial 的 `reflectionTexture`。

**关键设计**：
- 反射探针渲染尺寸 256px（性能友好），`refreshRate = 0`（静态环境仅渲染一次）
- 自动刷新：通过 `scene.onBeforeRenderObservable` 每 10 秒检查环境变化并刷新 renderList
- renderList 包含 sky/env/ground/water mesh，模型 mesh 不包含（避免自身反射）
- 绑定到模型材质的 `reflectionTexture`，StandardMaterial 直接支持
- 环境预设切换时通过 `refreshReflectionProbe()` 强制刷新

### 3. SSAO（屏幕空间环境遮蔽）— 已实施 ✅

**方案**：使用 Babylon.js `SSAO2RenderingPipeline`（独立 pipeline，StandardMaterial 完全兼容）。

**关键设计**：
- `SSAO2RenderingPipeline` 是 `PostProcessRenderPipeline` 的子类，与 `DefaultRenderingPipeline`/`SSRRenderingPipeline` 并行运行
- 使用 Geometry Buffer Renderer 渲染 depth/normal，与材质类型无关
- 启用 bilateral denoising（`expensiveBlur = true`）减少噪点
- 新增 4 个 RenderState 字段：`ssaoEnabled` / `ssaoStrength` / `ssaoRadius` / `ssaoSamples`
- 性能降级：L1 保留 SSAO，L2/L3 关闭

**映射关系**：
| UI 参数 | SSAO2RenderingPipeline 属性 | 范围 |
|---------|----------------------------|------|
| 遮蔽强度 | `totalStrength` | 0-2（UI 0-1 线性映射） |
| 遮蔽半径 | `radius` | 0-4（UI 0-1 线性映射） |
| 采样数 | `samples` | 4-32 |

### 4. SSS（次表面散射）— 延期 ⏸

**问题**：SSS 需要 PBR 材质（`PBRSubSurfaceConfiguration` 仅在 `PBRMaterial` 上可用）。

**全量 PBR 迁移的影响评估**：

| 模块 | 影响 | 工作量 |
|------|------|--------|
| `MmdStandardMaterialProxy` | 需实现 `MmdPBRMaterialProxy`（IMmdMaterialProxy 接口） | 中 |
| `material.ts` | `diffuseColor`→`albedoColor`、`specularPower`→`roughness` 映射，5 处 `instanceof StandardMaterial` 守卫 | 大 |
| `outfit.ts` | `diffuseTexture`→`albedoTexture`，toon/sphere 纹理槽无 PBR 对应 | 大 |
| `config.ts` `_origParams` | 存储属性名变更 | 小 |
| `model-loader.ts` | babylon-mmd 内部创建 `MmdStandardMaterial`，转换后 morph 失效 | **致命** |

**核心风险**：babylon-mmd 的 PMX loader 内部创建 `MmdStandardMaterial`（继承 `StandardMaterial`），morph 权重/材质动画/outline 全部依赖此材质类型。转换为 PBR 后 morph 系统不工作。

**延期理由**：
1. 全量迁移风险远大于收益 — 一个渲染特性不应破坏整个材质管线
2. 可选转换方案（仅皮肤类材质转 PBR）仍需处理 morph 兼容性
3. SSR + Reflection Probe 已提供基础反射效果，SSS 的优先级相对较低
4. 等待 babylon-mmd 支持 PBR material proxy 或提供材质类型抽象层后再启动

**未来方案**：
- 短期：保持 StandardMaterial，SSS 延期
- 中期：调研 babylon-mmd 是否支持自定义材质创建（`materialProxyConstructor` 的 PBR 版本）
- 长期：若 babylon-mmd 支持 PBR，可选启动 SSS（仅皮肤材质）

---

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `renderer.ts` | +SSRRenderingPipeline / SSAO2RenderingPipeline / ReflectionProbe 初始化/释放/状态映射 +RenderState 10 字段 +observer 清理 |
| `scene-render-levels.ts` | +SSR toggle + 4 滑块 +SSAO toggle + 3 滑块 +Reflection Probe toggle + 3 个预设更新（cinematic/realistic/cyberpunk/warm） |
| `performance.ts` | +LevelConfig ssrEnabled/reflectionProbeEnabled/ssaoEnabled +levelDiff 差集计算 |

## 不修改的文件

- `outfit.ts`（保持 StandardMaterial 兼容）
- `model-loader.ts`（保持 MmdStandardMaterialProxy — morph 依赖）
- `material.ts`（SSS 延期，不改动材质编辑器）
- `env-bridge.ts`（Reflection Probe 通过 renderer 内部 observer 自动刷新）
- Go 后端（无 binding 变更）

---

## 验证结果

- `tsc --noEmit` ✅ SSAO 零错误（camera.ts/main.ts 已有错误非本次引入）
- `vite build` ✅（459 modules，980 kB）
- `vitest run` ✅ 363 tests / 20 files 全通过

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| SSR 在 StandardMaterial 上无效果 | 已知 | reflectivity 默认黑色，SSR 需反射面材质配合 |
| SSR + Bloom 白出 | 低 | `_applyRenderState` 中 Bloom weight > 0.5 时自动降低 SSR 强度 |
| SSAO + SSR 叠加性能开销 | 中 | 性能降级 L1 关闭 SSR 保留 SSAO，L2/L3 全关 |
| Reflection Probe 性能 | 低 | 256px 分辨率 + 每 10 秒刷新 + 静态环境仅渲染一次 |
| SSR 与 DXR 冲突 | 低 | 独立 pipeline，不走 DefaultRenderingPipeline |
| SSS 延期导致渲染差距 | 低 | SSR + SSAO + Reflection Probe 已覆盖主要渲染增强 |

---

## 后续方向

1. **短期**：手动验证 SSAO/SSR 在有反射面材质（水面/地面）的场景中的效果
2. **中期**：调研 babylon-mmd 是否支持 PBR material proxy，为 SSS 做技术储备
3. **长期**：若 babylon-mmd 支持 PBR，可选启动 SSS（仅皮肤材质转换）
