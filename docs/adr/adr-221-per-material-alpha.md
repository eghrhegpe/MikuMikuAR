# ADR-221: 逐材质透明度（alphaMul）—— 材质编辑器第 11 参数

> **状态**: 已完成
> **日期**: 2026-08-01
>
> **前置**: ADR-015（材质编辑器重构）、ADR-149（材质×换装基线冲突，搁置中）、Fix A（整模透明度倍乘，已合入 `20d979dd`）

## 1. 背景

### 1.1 现状

Fix A 解决了整模透明度：`mat.alpha = clamp01(_origAlpha[i] × inst.opacity)`。但用户无法对单个材质（如头发、眼睛、衣服）独立调透明度——只有整模一刀切。

材质编辑器已有 10 个标量参数（5 颜色倍率 + 5 贴图强度），均走 `_applyParamsToMaterial` 的 `baseline × param` 管线。alpha 是唯一未纳入该管线的材质属性。

### 1.2 冲突点

当前（Fix A 后）仅 `syncModelVisibility`（model-manager.ts）写 `mat.alpha`，`_applyParamsToMaterial`（material.ts）尚未写 alpha。Fix B 引入 alpha 写入后将产生双写，故须统一写入权。

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
- `syncModelVisibility` 在写完 enabled/wireframe 后，调用 material 系统的 `_applyAll(id, alphaCtx)` 触发 alpha 重算。

### 2.2.1 数据源接线（alphaCtx）

`_applyParamsToMaterial` 当前签名 `(mat, mmdMat, orig, params)` 无法获取 `inst.opacity` / `_origAlpha[i]`。引入可选上下文参数：

```ts
interface AlphaCtx {
    opacity: number;      // inst.opacity
    origAlpha: number[];  // inst._origAlpha（与 meshes 索引对齐）
}
```

- `_applyAll(id, alphaCtx?)` / `_applyMaterial(id, mi, alphaCtx?)` 透传至 `_applyParamsToMaterial`。
- `syncModelVisibility`（持有 `inst`）构造 `alphaCtx = { opacity: inst.opacity, origAlpha: inst._origAlpha ?? [] }` 后传入。
- material.ts 不 import model-manager，`AlphaCtx` 是纯数据接口，满足无循环依赖约束。
- `alphaCtx` 缺省时（如 category batch apply 路径），alpha 写入跳过（保持现有行为）。

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

### 2.4 与 ADR-149 / ADR-150 的边界

- 只扩展 material 侧 `_origValues`（加 `alpha` 字段），不碰 outfit 侧 `_origParams`。
- outfit 写颜色绕过 material 系统是已知债（ADR-149），Fix B 不加剧也不修复。
- `_origAlpha`（Fix A 引入，`ModelInstance` 上）作为 `_capture` 的 alpha 来源，避免重复捕获。
- **ADR-150（模型替换原子操作）**：替换后 `matState` 按材质 index 键迁移到 newId。若新旧模型材质数量/顺序不同，`alphaMul` 会错位。`_origAlpha` 在 model-loader 构造时重捕（正确），但 `alphaMul` 不重对齐。当前策略：替换时清空目标模型的 `matState` override（与现有颜色参数行为一致），不做跨模型材质名匹配。

## 3. 改动清单

| # | 文件 | 改动 |
|---|------|------|
| 1 | `material.ts:21-32` | `MaterialCategoryParams` 加 `alphaMul: number` |
| 2 | `material.ts:52-63` | `DEFAULT_MAT_PARAMS` 加 `alphaMul: 1` |
| 3 | `material.ts:66-77` | `CLAMP_RULES` 加 `alphaMul: [0, 1, 0.01]` |
| 4 | `material.ts:38-49` | `_OrigMat` 加 `alpha: number` |
| 5 | `material.ts:365-382` | `_capture(mat, mi, origAlpha)` 签名变更：仅从 `origAlpha[mi]`（pristine）取 alpha，删除 `mat.alpha` 兜底。调用点改造：`material.ts:394`、`material.ts:435`（`_applyAll` 路径，有 `_origValues.has` 早退守卫，幂等 no-op）、`model-loader.ts:580`、`model-loader.ts:730`（载入时真正捕获） |
| 6 | `material.ts:97-139` | `_applyParamsToMaterial` 末尾写 alpha + transparencyMode |
| 7 | `model-manager.ts:97-115` | `syncModelVisibility` 删除 alpha/transparencyMode 写入，改调 `_applyAll(id, alphaCtx)` |
| 8 | `scene-serialize.ts:744-753` | 删除 `mesh.material.alpha = inst.opacity` 直写，改为通过 `syncModelVisibility` / `_applyAll(id, alphaCtx)` 驱动重算 |
| 9 | `model-material.ts:43-96` | `MAT_PARAM_DEFS` 加 slider（icon: 💧, labelKey: `model-material.alphaMul`） |
| 10 | i18n × 5 语言 | 加 `model-material.alphaMul` 翻译 |
| 11 | 序列化 | 自动跟随 `getMatState`（非默认值时序列化） |

## 4. 序列化兼容

- `getMatState` 已有 noise-filter（跳过全默认值的 override），`alphaMul: 1` 不会产生额外序列化体积。
- 旧存档无 `alphaMul` 字段 → `applyMatState` 时 `Object.assign(DEFAULT_MAT_PARAMS, saved)` 自动补 1。
- **`scene-serialize.ts:744-753` 残留直写**：当前载入路径有 `mesh.material.alpha = inst.opacity` 直写，绕过三层公式（忽略 `_origAlpha[i]` 和 `alphaMul`）。Fix B 删除该行，改为通过 `syncModelVisibility` → `_applyAll(id, alphaCtx)` 驱动重算。
- 无需版本号迁移。

## 5. 测试计划

| 用例 | 验证点 |
|------|--------|
| `alphaMul=0.5` + `_origAlpha=0.8` + `inst.opacity=1` | `mat.alpha ≈ 0.4` |
| `alphaMul=1` + `inst.opacity=0.5` + `_origAlpha=1` | `mat.alpha ≈ 0.5`（整模透明度仍生效） |
| `alphaMul=1` + `inst.opacity=1` + `_origAlpha=1` | `transparencyMode === OPAQUE` |
| `alphaMul=0.5` + `_origAlpha=1` + `inst.opacity=1` | `transparencyMode === ALPHABLEND` |
| `alphaMul` 从 0.5 恢复为 1（`_origAlpha=1`, `opacity=1`） | `transparencyMode` 回到 OPAQUE |
| cutout 材质（纹理 alpha 镂空）+ `alphaMul=1` + `_origAlpha=1` | 不被强转 ALPHABLEND，镂空保持 |
| `setOpacity` 后 material 系统重算 | alpha 公式三层一致 |
| 序列化 roundtrip | `alphaMul` 非默认值时保存/恢复正确 |
| 旧存档无 `alphaMul` | 加载后默认 1，无报错 |

## 6. 风险

| 等级 | 风险 | 缓解 |
|------|------|------|
| P2 | `syncModelVisibility` 改调 `_applyAll` 引入循环依赖 | `AlphaCtx` 纯数据接口透传（§2.2.1），material.ts 不 import model-manager |
| P2 | `scene-serialize.ts:744` 残留直写绕过公式 | 改动清单 #8 删除该行，统一走 `_applyAll(id, alphaCtx)` |
| P3 | cutout/alpha-test 材质（纹理 alpha 镂空）在 `finalAlpha===1` 时被强转 OPAQUE | 继承自 Fix A 同款限制，非新回归；补 cutout 材质测试用例（§5）；后续若需支持可检查 `mat.needAlphaBlending()` 或 texture.hasAlpha |
| P3 | ADR-150 替换后 `alphaMul` 按 index 错位 | 替换时清空目标模型 matState override（与现有颜色参数行为一致） |
| — | MMD runtime 每帧覆写 alpha | 已验证（Fix A 阶段）：babylon-mmd 不逐帧写 `material.alpha` |
| — | 性能：每次 `setOpacity` 触发全量 `_applyAll` | 模型 mesh 数通常 < 50，开销可忽略 |

## 7. 已知局限性

| # | 局限 | 影响 | 后续方向 |
|---|------|------|----------|
| 1 | `finalAlpha >= 1` 时强制 `MATERIAL_OPAQUE`（`material.ts:157-158`） | PMX 材质若故意以 alpha=1 + ALPHABLEND 实现 cutout/alpha-test 效果，会被覆盖为 OPAQUE 导致镂空失效 | 引入 `_origTransparencyMode` 基线或检查 `mat.needAlphaBlending()`；当前无用户报告，不阻塞 |
| 2 | `_applyCategory` 无 `!applied && alphaCtx` 兜底路径 | 首次 `setMatCatParams` 只更新目标分类 mesh 的 alpha，其余分类 mesh 不被触碰 | 实际无害（未触碰 mesh 保持 PMX 原始 alpha ≡ `o.alpha × 1 × 1`）；若未来 `_applyCategory` 承担更多职责需重新评估 |
| 3 | `scene-serialize.ts:744` 条件 `opacity < 1 \|\| wireframe` 控制是否调 `_applyAll` | opacity=1 且无 wireframe 时跳过，依赖后续 `applyMatState` 路径补写 alpha | 正确但隐式——`applyMatState` → `setMatCatParams`/`setMatParams` 内部 `_alphaCtxFor(id)` 补写；无 material state 时 alpha 保持 PMX 原值亦正确 |
| 4 | ADR-149 双基线冲突未解决 | outfit 写颜色绕过 material 系统，`_applyParamsToMaterial` 从 `_origValues` 重算时会覆盖 outfit 色调 | ADR-149 已登记为搁置 P1；本 ADR 不加剧也不修复 |
