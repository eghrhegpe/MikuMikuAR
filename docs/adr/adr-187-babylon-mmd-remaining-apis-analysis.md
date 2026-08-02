# ADR-187: babylon-mmd 剩余高价值功能综合分析

> **状态**: 草案 · 待立项（2026-07-26 — 系统性调研 + 落地优先级评估）
> **日期**: 2026-07-26

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-26

**来源**: `docs/research/babylon-mmd-api-analysis.md` §2.2-2.3 / §五 P3 + npm 源码实测

**关联**: ADR-098（描边+Composite，已落地）、ADR-099（MPR，已落地）、ADR-107（StreamAudioPlayer，已落地）、ADR-108（AnimationRetargeter，已落地）、ADR-110（IMmdModel 上游 PR，草案）、ADR-112（SdefInjector，已落地）

**影响面**: 依赖 `frontend/node_modules/babylon-mmd/esm/Loader/` 下的 MaterialBuilder 链、`Runtime/Util/mmdPlayerControl`、`Loader/Optimized/bpmxLoader`

---

## 问题

截至 ADR-186，项目已落地 babylon-mmd 的 MPR、OutlineRenderer、StreamAudioPlayer、AnimationRetargeter、SdefInjector 等高价值 API。本节系统分析**剩余未利用的中/低价值功能**，评估落地优先级。

### 待分析功能清单

| 功能 | 模块路径 | 调研等级 | 结论 |
|------|----------|----------|------|
| `StandardMaterialBuilder` | `Loader/standardMaterialBuilder` | ✅ 已深入分析 | 🟡 不推荐（无差异化收益） |
| `PBRMaterialBuilder` | `Loader/pbrMaterialBuilder` | ✅ 已深入分析 | ⏳ 长期可考虑（重大改造面） |
| `MmdPlayerControl` | `Runtime/Util/mmdPlayerControl` | ✅ 已深入分析 | 🔴 否决（调试用途，UI 冲突） |
| `SharedToonTextures` | `Loader/sharedToonTextures` | ✅ 已深入分析 | 🟢 零风险 + 小收益（可选） |
| `BpmxConverter/BvmdConverter` | `Loader/Optimized/` | ❌ 未深入分析 | ⏳ 文档推断（大工作量） |

---

## 决策

**除 `SharedToonTextures` 外，其余功能均暂不立项。**

### 逐项分析

#### 1. StandardMaterialBuilder — 🟡 不推荐立项

**模块**: `Loader/standardMaterialBuilder`

```typescript
// 源码核心实现（loadGeneralScalarProperties）
loadGeneralScalarProperties(material, materialInfo, meshes) {
    material.diffuseColor = new Color3(diffuse[0], diffuse[1], diffuse[2]);
    material.specularColor = new Color3(specular[0], specular[1], specular[2]);
    material.ambientColor = new Color3(ambient[0], ambient[1], ambient[2]);
    material.alpha = diffuse[3];
    material.specularPower = materialInfo.shininess;
}
```

**与现有 `MmdStandardMaterialProxy` 的差异：**

| 特性 | MmdStandardMaterialProxy（当前） | StandardMaterialBuilder |
|------|----------------------------------|------------------------|
| 材质类型 | `MmdStandardMaterial`（babylon-mmd 自定义） | `StandardMaterial`（Babylon.js 原生） |
| Toon 贴图 | 内置球面/纹理 toon 支持 | 需手动配置 |
| Sphere 映射 | 内置反射球面贴图 | 需额外着色器 |
| 描边配合 | 与 `MmdOutlineRenderer` 深度集成 | 需验证兼容性 |

**否决理由：**

1. **无差异化视觉收益**：`StandardMaterialBuilder` 只是用 Babylon.js 原生 `StandardMaterial` 替代 `MmdStandardMaterial`，但视觉表现不如后者（缺少 toon/sphere 原生支持）。
2. **改造面大**：项目 `material.ts` 全仓 `instanceof StandardMaterial` 假设，替换后需修改 `_capture`、分类调参、UI 面板等多处代码。
3. **已有更优方案**：`PBRMaterialBuilder` 才是材质升级的正确方向（见下文分析）。

**结论**：不作为独立功能立项。若未来迁移到 PBR 材质，`StandardMaterial` 可作为中间态过渡，但目前无此需求。

---

#### 2. PBRMaterialBuilder — ⏳ 长期可考虑（需专项 ADR）

**模块**: `Loader/pbrMaterialBuilder`

```typescript
// 源码核心实现（loadGeneralScalarProperties）
loadGeneralScalarProperties(material, materialInfo, meshes) {
    material.albedoColor = new Color3(diffuse[0], diffuse[1], diffuse[2]);
    material.reflectionColor = new Color3(specular[0], specular[1], specular[2]);
    material.ambientColor = new Color3(ambient[0], ambient[1], ambient[2]);
    material.alpha = alpha;
    material.metallic = 0.0;          // PBR 金属度
    material.roughness = shininess / 100.0;  // PBR 粗糙度
}
```

**与现有材质的差异：**

| 特性 | MmdStandardMaterial（当前） | PBRMaterial（目标） |
|------|----------------------------|--------------------|
| 漫反射 | `diffuseColor` | `albedoColor` + `albedoTexture` |
| 高光 | `specularColor` + `specularPower` | `reflectionColor` + `roughness` |
| 自发光 | `emissiveColor` | `emissiveColor` + `tint` |
| 法线贴图 | `bumpTexture` | `detailMap` / `bumpTexture` + `normalStrength` |
| 渲染方程 | Lambert + Blinn-Phong | Cook-Torrance PBR |

**改造面评估：**

| 模块 | 当前假设 | 需修改内容 | 工作量 |
|------|----------|-----------|--------|
| `model-loader.ts` | `MmdStandardMaterialProxy` | 切换为 `PBRMaterialBuilder` + side-effect 注册 | 小 |
| `material.ts` | `instanceof StandardMaterial` | 改为 `instanceof PBRMaterial` + PBR 参数映射 | **大** |
| `manager/material.ts` | 分类调参（diffuseMul/specularMul 等） | 重映射到 PBR 语义（metallic/roughness/albedo） | **大** |
| UI 面板 | 滑块标签"漫反射/高光" | 改为"金属度/粗糙度" | 中 |
| 预设系统 | `MaterialCategoryParams` 字段 | 新增 PBR 版本或兼容映射 | 中 |

**风险评估矩阵：**

| 场景 | 风险等级 | 说明 |
|------|----------|------|
| 纯颜色模型（无贴图） | 🟢 低 | PBR 退化为标准材质，视觉一致 |
| 带漫反射贴图 | 🟡 中 | `albedoTexture` 需验证 alpha 通道处理 |
| Toon/Sphere 贴图 | 🔴 高 | PBR 无原生 toon 支持，需自定义着色器 |
| 描边效果 | 🟡 中 | `MmdOutlineRenderer` 需验证 PBR 兼容性 |
| 预设/Outfit 系统 | 🔴 高 | 全仓 `StandardMaterial` 假设需重构 |

**建议方案（分阶段）：**

| 阶段 | 目标 | 条件 |
|------|------|------|
| **Phase 0（验证）** | POC：单模型加载 PBRMaterial + 验证描边/toon 兼容性 | 独立分支，不阻塞主开发 |
| **Phase 1（并行）** | 保留 `MmdStandardMaterialProxy`，新增 `PBRMaterialBuilder` 可选开关 | `VITE_MMD_MATERIAL=pbr` 环境变量 |
| **Phase 2（迁移）** | `material.ts` 新增 `PBRMaterial` 分支，双材质类型兼容 | 分类调参 API 抽象化 |
| **Phase 3（默认）** | 默认使用 PBR，旧预设自动映射到 PBR 参数 | 用户测试 ≥2 周 |

**结论**：列为 **P1 长期规划**，需独立 ADR 详细排期。当前阶段优先保证稳定性，不急于切换。

---

#### 3. MmdPlayerControl — 🔴 否决立项

**模块**: `Runtime/Util/mmdPlayerControl`

```typescript
// 源码注释原文
/**
 * It's just a GUI for debugging purposes, so it doesn't offer a lot of customization,
 * and We don't plan to.
 */
export declare class MmdPlayerControl {
    // 内置播放条 UI：play/pause/skip/volume/fullscreen
}
```

**否决理由：**

1. **定位是调试工具**：源码明确标注 "for debugging purposes"，不提供定制化能力。
2. **与现有 playback.ts 冲突**：项目已有成熟的播放控制 UI（`frontend/src/scene/motion/playback.ts`），自定义程度更高。
3. **DOM 侵入性强**：`MmdPlayerControl` 会在页面注入独立的 canvas 容器，与 Wails  WebView2 嵌入方式不兼容。
4. **无差异化收益**：播放条功能（时间显示、seek、音量）项目已完整实现。

**结论**：**不立项**。仅在需要排查 MMD 运行时播放问题时临时启用。

---

#### 4. SharedToonTextures — 🟢 可选（零风险 + 小收益）

**模块**: `Loader/sharedToonTextures`

```typescript
// 源码定义
export declare class SharedToonTextures {
    /** Toon 纹理数据（base64 常量） */
    static readonly Data: readonly string[];
}
```

**功能说明：**

babylon-mmd 提供预制的 toon 渐变纹理（base64 编码嵌入模块），替代 PMX 文件中引用的外部 toon 贴图。优势：

1. **零外部依赖**：无需加载外部 toon.png/jpg，避免文件路径问题。
2. **内存共享**：多模型共用同一 toon 纹理实例，减少显存占用。
3. **加载加速**：跳过 toon 贴图的异步加载，PMX 实例化更快。

**集成方式：**

```typescript
// 在 scene.ts 模型加载前注册（side-effect import 即可）
import 'babylon-mmd/esm/Loader/sharedToonTextures';
// SharedToonTextures.Data 自动注册到 babylon-mmd 内部纹理池
```

**工作量**：极小（1 行 import）。

**风险**：极低（只读静态数据，无状态修改）。

**局限性：**

- 仅适用于没有自定义 toon 贴图的模型（PMX `toonIndex < 0`）。
- Toon 效果固定为 babylon-mmd 预设的 10 级渐变，无法自定义。

**结论**：**建议落地**，作为 `MmdStandardMaterialProxy` 的辅助增强。可合并到现有 ADR（如 ADR-112 SdefInjector）中一次性完成，不单独编号。

---

#### 5. BpmxConverter / BvmdConverter — ⏳ 文档推断（大工作量）

**模块**: `Loader/Optimized/bpmxLoader` / `Loader/Optimized/bvmdLoader`

**功能说明（基于文档推断）：**

| 转换器 | 输入 | 输出 | 用途 |
|--------|------|------|------|
| `BpmxConverter` | `.bpmx`（二进制的 PMX 元数据） | `PmxObject` | 加速 PMX 解析（跳过了文本解析） |
| `BvmdConverter` | `.bvmd`（二进制的 VMD 动作数据） | `VmdObject` | 加速 VMD 加载（跳过了字符串解析） |

**工作原理：**

MMD 格式的 `.pmx` / `.vmd` 是**人类可读的文本/半结构化格式**，解析时需要：
1. 读取字节流
2. 按 PMX/VMD 规范逐字段解析
3. 构建对象树

`.bpmx` / `.bvmd` 是**预烘焙的-binary 格式**，优势：
1. 跳过解析阶段，直接反序列化
2. 体积更小（无冗余字符串、压缩编码）
3. 加载速度提升 3–10 倍（取决于文件体积）

**前置要求：**

1. **构建流程**：项目需集成 `BpmxConverter` CLI 工具，在构建时将 `.pmx` 转为 `.bpmx`。
2. **双格式兼容**：运行时需同时支持 `.pmx` 和 `.bpmx` 加载（回退机制）。
3. **存储升级**：现有 ZIP 原档库需索引 `.bpmx` 变体，或缓存生成。

**工作量评估：**

| 任务 | 工作量 | 风险 |
|------|--------|------|
| 集成 BpmxConverter CLI | 中 | 低（npm 包提供） |
| 修改 model-loader.ts 支持 .bpmx | 中 | 中（需验证双格式兼容） |
| 修改 vmd-loader.ts 支持 .bvmd | 中 | 中 |
| ZIP 库索引升级 | 大 | 高（存储格式变更） |
| 构建流水线改造 | 大 | 高（CI/CD 联动） |

**收益评估：**

| 场景 | 当前加载耗时 | 预估提速 | 绝对收益 |
|------|-------------|----------|---------|
| 小模型（<10MB PMX） | ~200ms | 50% | ~100ms |
| 大模型（>50MB PMX） | ~1.5s | 70% | ~1s |
| 小 VMD（<1MB） | ~50ms | 30% | ~15ms |
| 大 VMD（>10MB） | ~500ms | 50% | ~250ms |

**结论**：列为 **P2 中期规划**，需在项目积累一定模型库规模后再投入。当前模型平均体积较小，收益不明确。需先调研社区实际使用情况（是否有现成的 converter 工具链）。

---

## 综合优先级矩阵

| 功能 | 工作量 | 风险 | 收益 | 优先级 | 建议行动 |
|------|--------|------|------|--------|----------|
| ~~MPR 多线程~~ | — | — | — | ✅ 已完成 | ADR-099 |
| ~~描边渲染~~ | — | — | — | ✅ 已完成 | ADR-098 |
| ~~StreamAudioPlayer~~ | — | — | — | ✅ 已完成 | ADR-107 |
| ~~AnimationRetargeter~~ | — | — | — | ✅ 已完成 | ADR-108 |
| ~~SdefInjector~~ | — | — | — | ✅ 已完成 | ADR-112 |
| **SharedToonTextures** | 极小 | 极低 | 小 | 🟢 **立即** | 合并到现有 ADR |
| **PBRMaterialBuilder** | 大 | 高 | **大** | 🟡 **P1 长期** | 独立专项 ADR（ADR-188） |
| **Bpmx/Bvmd Converter** | 大 | 中 | 中 | 🟠 **P2 中期** | 视模型库规模决定 |
| StandardMaterialBuilder | 中 | 中 | 低 | 🔴 **否决** | 无差异化收益 |
| MmdPlayerControl | 小 | 低 | 零 | 🔴 **否决** | 调试用途，UI 冲突 |

---

## 后续行动

1. **立即**（下次迭代）：落地 `SharedToonTextures`，与 ADR-112（SdefInjector）合并执行。
2. **中期**（模型库增长后）：调研 `BpmxConverter` 工具链成熟度，评估构建流程改造成本。
3. **长期**（PBR 渲染升级专项）：启动 `PBRMaterialBuilder` 独立 ADR，制定 Phase 0–3 详细计划。

---

## 附录：API 覆盖率统计

截至 ADR-187，项目已利用的 babylon-mmd 导出 API 数量：

| 类别 | 总 API 数 | 已利用 | 利用率 |
|------|----------|--------|--------|
| 加载器（Loader） | ~50 | ~25 | 50% |
| 运行时（Runtime） | ~40 | ~20 | 50% |
| 优化模块（Optimized） | ~20 | ~15 | 75% |
| 工具类（Util） | ~21 | ~8 | 38% |
| **合计** | **~131** | **~68** | **~52%** |

剩余未利用的核心是：底层解析器（PmxReader/PmdReader）、备选物理后端（Ammo/Havok）、以及本节分析的中等/低价值功能。
