# ADR-069: 材质面板纹理支持审计与推进路线

**日期**：2026-07-09
> **状态**: 调研落档 — 材质面板当前仅支持 4 标量乘率，贴图槽位归 outfit，PBR 流延续 ADR-024 决策延期

---

## 背景

用户问「材质功能是否支持除颜色贴图之外的纹理（高光、法线等）」。审计 `frontend/src/scene/manager/material.ts`、`frontend/src/menus/model-material.ts`、`frontend/src/outfit/outfit.ts`、`frontend/src/scene/render/renderer.ts`、`frontend/src/scene/manager/model-loader.ts`，并 grep 全仓贴图槽位使用。

结论：**当前材质面板（颜色维度）与 outfit（贴图维度）是 ADR-015 / ADR-020 共同确立的两套正交系统，有意为之，非 bug**。本 ADR 落档审计事实并给出推进路线，**不引入新决策**。

---

## 审计事实

### 1. 材质面板支持的维度（`material.ts` + `model-material.ts`）

`MaterialCategoryParams` (L42-47) 仅 4 个标量：

| 字段 | 类型 | 语义 | 对应 StandardMaterial 字段 |
|------|------|------|---------------------------|
| `diffuseMul` | number × 3（Color3 乘率） | 漫反射颜色乘率 | `diffuseColor.r/g/b` |
| `specularMul` | number × 3 | 高光色乘率 | `specularColor.r/g/b` |
| `shininess` | number | 光泽度 | `specularPower` |
| `ambientMul` | number × 3 | 环境光乘率 | `ambientColor.r/g/b` |

`_OrigMat` (L53-58) 备份同步也只有这 4 项。`_applyAll` (L285-319) 只写这 4 项，**不读不写任何 `*Texture` 字段，不调 `.level`**。`_capture` 仅 `instanceof StandardMaterial` 才备份。

UI（`model-material.ts`）三层菜单 `buildMatBatchLevel` / `buildPerMatLevel` / `buildMatRootLevel` / `buildMatListLevel` 全部只用 `addSliderRow × 4`，**无任何贴图控件**。

### 2. 贴图槽位走 outfit（`outfit.ts`）

- `TextureSlotKey` (L26-27) = `'diffuseTexture' | 'toonTexture' | 'sphereTexture' | 'bumpTexture' | 'emissiveTexture'` — 5 槽
- `_collectSlotMappings` (L55-60) 枚举：`sm.diffuseTexture` / `mmdSm.toonTexture` / `mmdSm.sphereTexture` / `sm.bumpTexture` / `sm.emissiveTexture`
- 三层优先级 `byMaterial > byCategory > all > 原始贴图`，逐材质备份 `_origTextures`
- arch §17 明确贴图替换归 outfit，颜色维度归材质面板 — **正交设计**

### 3. renderer.ts 里的后挂反射

`renderer.ts` L470-525：启用时把 `ReflectionProbe.cubeTexture` 强转注入所有 PMX 材质 `reflectionTexture`，用 `reflectionColor.set(intensity×3)` 调强度。**该路径未入 `_origValues` 快照、未进材质面板 UI、未关联 `_capture`**，属全局后处理开关，非材质级。

### 4. 全仓 grep 结论

- `specularTexture | opacityTexture | ambientTexture | lightmapTexture | roughnessTexture | metallicTexture` — frontend/src **零命中**
- 材质实例化只用 `StandardMaterial`；`MmdStandardMaterial` 仅 `outfit.ts` 通过 interface declaration 局部扩展
- 无 `PBRMaterial / NodeMaterial / CustomMaterial / PBRCustomMaterial` 实际 import 或实例化
- `model-loader.ts` 通过 `MmdStandardMaterialProxy` 注入，babylon-mmd PMX 加载器自动把 PMX 声明的贴图塞对应槽位，但本项目 `_capture` 未备份这些贴图

---

## 用户语义对照表

| 用户问的「高光等」 | 能否调 | 原因 |
|---|---|---|
| 高光强度·色·光泽度 | ✅ 能 | `specularMul` + `specularColor` + `shininess` |
| 高光贴图 specular map | ❌ 不能 | `StandardMaterial.specularTexture` 全仓零使用，UI 未暴露 |
| 法线贴图强度 | ❌ 不能（bumpTexture 已挂但无 level 滑块） | material.ts 未备份未触及 |
| toon 贴图开关/替换 | ⚠️ 仅通过 outfit 系统 | 材质面板无 toon 感知 |
| sphere 贴图强度 | ❌ 不能 | 同上 |
| 自发光强度/颜色 | ❌ 不能 | `emissiveColor` 未备份；面板无 `emissiveMul` |
| 环境反射强度 | ⚠️ 半能（renderer.ts reflectionColor.set） | 全局开关非材质级 |
| 粗糙/金属 PBR | ❌ 完全不能 | 全仓只认 StandardMaterial，无 PBRMaterial |

---

## 根因（3 条）

1. **ADR-015 锁死标量分类乘率模型** — 底层 4 个 float + 39 个测试签名焊死，UI 重构只重新布局没扩维度
2. **贴图替换归 outfit（ADR-020）** — 颜色维度走材质面板，贴图维度走 outfit，两套正交，有意为之
3. **renderer.ts reflectionTexture 注入是后挂** — 绕过 material.ts 强转赋值，未入快照，故 reset 不影响它但它也不可被面板感知

---

## 推进路线（P0~P5）

延续 ADR-015 / ADR-020 / ADR-024 既有边界，不新立决策。

| 优先级 | 项目 | 改动量 | 与既有系统关系 | 默认推荐 |
|--------|------|--------|----------------|----------|
| P1 | 贴图强度滑块（`*.level`） | 小 | `_origValues` 备份 `diffuseTexture.level / bumpTexture.level / toonTexture.level / sphereTexture.level / emissiveTexture.level`，UI 加 level 滑块 — 与 outfit 不撞（outfit 换贴图本体，level 是强度） | **推荐先做**：收益直接，不破坏正交 |
| P2 | `emissiveMul` 颜色乘率 | 小 | 与现有 4 字段并列加一个，复用滑块位置 | 推荐，低风险补全 |
| P3 | `specularTexture` 开关+加载 | 中 | PMX 不原生带，需 `.mcupreset` 自定义扩展；多数 MMD 模型用 sphere 代替高光 | **低优先**，等用户场景出现实际诉求再启动 |
| P4 | 自带文件替换贴图 | 中大 | 与 outfit 撞，**建议统一到 outfit 走临时 variant 路线** | 不另起炉灶 |
| P5 | PBR 工作流（roughness/metalness） | 大 | 延续 ADR-024 延期决策 — babylon-mmd morph 绑死 StandardMaterial，未解 | **不提上路线**，等 babylon-mmd 支持 PBR material proxy |

### 路线原则

- **惰性推进**：P1/P2 是材质面板分内事，收益直接；P3~P5 全部等用户场景显性触发或上游依赖突破后再启动
- **正交不破坏**：P1 的 `level` 滑块与 outfit 换贴图本体互不冲突，outfit 换贴图后 level 仍可调
- **renderer.ts 反射**：暂不纳入材质面板控制，维持全局后处理语义；若未来用户明确要求逐材质反射，再开新 ADR
- **PBR 不再独立评估**：ADR-024 已给致命风险（morph 失效），本 ADR 不重复论证

---

## 三个拍板点（默认推荐）

1. **P1 贴图强度滑块** — 默认推荐做；改动小、不撞 outfit、MMD 模型的 sphere/toon 强度可调本身就是常见诉求
2. **renderer.ts reflectionTexture 纳入材质面板控制** — 默认推荐**不**纳入；维持 ADR-024 的全局后处理语义更清晰，逐材质反射属另一层概念
3. **PBR 流（roughness/metalness）提上路线** — 默认推荐**不**提；延续 ADR-024 延期决策，等 babylon-mmd 上游突破

---

## 不修改的文件

本 ADR 仅落档审计与路线，**无代码改动**。

---

## 关联 ADR

- ADR-015 材质编辑器 UI 重构 + 逐材质开关 — 标量乘率模型的源头
- ADR-020 换装系统 — 贴图维度归属
- ADR-024 渲染增强 Phase 2 — reflectionTexture 后挂路径 + PBR 延期决策（morph 致命风险）
