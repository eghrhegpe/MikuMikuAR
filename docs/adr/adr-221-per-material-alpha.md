# ADR-221: 逐材质透明度（alphaMul）—— 材质编辑器第 11 参数

> **状态**: 规划
>
> **前置**: ADR-015（材质编辑器重构）、ADR-149（材质×换装基线冲突，搁置中）、Fix A（整模透明度倍乘，已合入 `20d979dd`）

## 1. 背景

### 1.1 现状

Fix A 解决了整模透明度：`mat.alpha = clamp01(_origAlpha[i] × inst.opacity)`。但用户无法对单个材质（如头发、眼睛、衣服）独立调透明度——只有整模一刀切。

材质编辑器已有 10 个标量参数（5 颜色倍率 + 5 贴图强度），均走 `_applyParamsToMaterial` 的 `baseline × param` 管线。alpha 是唯一未纳入该管线的材质属性。

### 1.2 冲突点

`syncModelVisibility`（model-manager.ts）和 `_applyParamsToMaterial`（material.ts）都会写 `mat.alpha`——双写必冲突。Fix B 必须统一写入权。

## 2. 决策

### 2.1 核心公式

```
mat.alpha = clamp01( _origAlpha[i] × inst.opacity × alphaMul )
```

三层正交：
| 层 | 来源 | 语义 |
|----|------|------|
| `_origAlpha[i]` | PMX 文件 diffuse[3] | 模型原始透明度 |
| `inst.opacity` | 整模透明度滑块 | 用户对整体模型的淡入淡出 |
| `alphaMul` | 材质编辑器逐材质滑块 | 用户对单个材质的透明度微调 |

### 2.2 写入权归属

**material 系统独占 `mat.alpha` 写入权。**

- `_applyParamsToMaterial` 负责计算最终 alpha 并写入，同时管理 `transparencyMode`（OPAQUE ↔ ALPHABLEND）。
- `syncModelVisibility` 退化为只写 `mesh.setEnabled` + `wireframe`，不再碰 `mat.alpha` / `transparencyMode`。
- `syncModelVisibility` 在写完 enabled/wireframe 后，调用 material 系统的 `_applyAll(id)` 触发 alpha 重算。

### 2.3 `transparencyMode` 管理

统一在 `_applyParamsToMaterial` 末尾：

```ts
const finalAlpha = clamp01(baseAlpha * params.alphaMul);
mat.alpha = finalAlpha;
if (finalAlpha < 1) {
    if (mat.transparencyMode === Material.MATERIAL_OPAQUE)
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
} else {
    mat.transparencyMode = Material.MATERIAL_OPAQUE;
}
```

### 2.4 与 ADR-149 的边界

- 只扩展 material 侧 `_origValues`（加 `alpha` 字段），不碰 outfit 侧 `_origParams`。
- outfit 写颜色绕过 material 系统是已知债（ADR-149），Fix B 不加剧也不修复。
- `_origAlpha`（Fix A 引入，`ModelInstance` 上）作为 `_capture` 的 alpha 来源，避免重复捕获。

## 3. 改动清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `material.ts:21-32` | `MaterialCategoryParams` 加 `alphaMul: number` |
| 2 | `material.ts:52-63` | `DEFAULT_MAT_PARAMS` 加 `alphaMul: 1` |
| 3 | `material.ts:66-77` | `CLAMP_RULES` 加 `alphaMul: [0, 1, 0.01]` |
| 4 | `material.ts:38-49` | `_OrigMat` 加 `alpha: number` |
| 5 | `material.ts:365-382` | `_capture` 加 `alpha`（从 `_origAlpha[mi]` 或 `mat.alpha` 取） |
| 6 | `material.ts:97-139` | `_applyParamsToMaterial` 末尾写 alpha + transparencyMode |
| 7 | `model-manager.ts:97-115` | `syncModelVisibility` 删除 alpha/transparencyMode 写入，改调 `_applyAll` |
| 8 | `model-material.ts:43-96` | `MAT_PARAM_DEFS` 加 slider（icon: 💧, labelKey: `model-material.alphaMul`） |
| 9 | i18n × 5 语言 | 加 `model-material.alphaMul` 翻译 |
| 10 | 序列化 | 自动跟随 `getMatState`（非默认值时序列化） |

## 4. 序列化兼容

- `getMatState` 已有 noise-filter（跳过全默认值的 override），`alphaMul: 1` 不会产生额外序列化体积。
- 旧存档无 `alphaMul` 字段 → `applyMatState` 时 `Object.assign(DEFAULT_MAT_PARAMS, saved)` 自动补 1。
- 无需版本号迁移。

## 5. 测试计划

| 用例 | 验证点 |
|------|--------|
| `alphaMul=0.5` + `_origAlpha=0.8` + `inst.opacity=1` | `mat.alpha ≈ 0.4` |
| `alphaMul=1` + `inst.opacity=0.5` + `_origAlpha=1` | `mat.alpha ≈ 0.5`（整模透明度仍生效） |
| `alphaMul=1` + `inst.opacity=1` | `transparencyMode === OPAQUE` |
| `alphaMul=0.5` | `transparencyMode === ALPHABLEND` |
| `alphaMul` 从 0.5 恢复为 1 | `transparencyMode` 回到 OPAQUE |
| `setOpacity` 后 material 系统重算 | alpha 公式三层一致 |
| 序列化 roundtrip | `alphaMul` 非默认值时保存/恢复正确 |
| 旧存档无 `alphaMul` | 加载后默认 1，无报错 |

## 6. 风险

| 风险 | 缓解 |
|------|------|
| `syncModelVisibility` 改调 `_applyAll` 引入循环依赖 | material.ts 不 import model-manager；由 scene.ts 编排层桥接 |
| MMD runtime 每帧覆写 alpha | 已验证（Fix A 阶段）：babylon-mmd 不逐帧写 `material.alpha` |
| 性能：每次 `setOpacity` 触发全量 `_applyAll` | 模型 mesh 数通常 < 50，开销可忽略 |
