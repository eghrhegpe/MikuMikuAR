# ADR-247: 材质参数应用双路径收敛 —— PBR 与 StandardMaterial 语义必须一致

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；`material.ts` `_applyPbrMatParams` alpha 分支已对齐 StandardMaterial 语义：补 `clamp01` + `alphaCtx.opacity` 乘子 + transparencyMode 切换）
> **编号**: 247
>
> **关联**: [ADR-188](adr-188-pbr-material-builder.md)（PBR 材质系统）、[ADR-226](adr-226-ground-material-spec-single-source.md)（地面材质 spec 单源，双路径收敛先例）、[ADR-204](adr-204-unit-test-layering-and-hygiene.md)（测试分层）
>
> **来源**: 2026-08-06 第 13 轮代码审核（`docs/audit/`）P2：`material.ts` `_applyPbrMatParams`（L500-502）alpha 分支与 `_applyParamsToMaterial`（StandardMaterial 路径，L155-165）语义不一致——PBR 分支缺 `clamp01`、缺 `alphaCtx.opacity` 乘子、缺 transparencyMode 切换，且条件 `p.alphaMul !== 1` 与 SM 的 `if (alphaCtx)` 不一致。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据：同一套 `MaterialCategoryParams` 映射到两种材质，语义分叉（material.ts）

项目存在两套材质参数应用路径，消费同一份 `MaterialCategoryParams`：

| 路径 | 函数 | 适用材质 | alpha 处理 |
|------|------|---------|-----------|
| StandardMaterial | `_applyParamsToMaterial`（L155-165） | 标准材质 | `clamp01(o.alpha * alphaCtx.opacity * p.alphaMul)` + transparencyMode 切换 |
| PBRMaterial | `_applyPbrMatParams`（L500-502） | PBR 材质（ADR-188） | `orig.alpha * p.alphaMul`（无 clamp / 无 opacity 乘子 / 无 transparencyMode） |

PBR 分支问题（修复前）：
1. 不乘 `alphaCtx.opacity` → 模型透明度被忽略；
2. 不 `clamp01` → alpha 可越界 [0,1]；
3. 不切 transparencyMode → PBR 半透明材质不启用 ALPHABLEND；
4. 条件 `p.alphaMul !== 1` 与 SM 的 `if (alphaCtx)` 不一致 → alphaMul=1 时完全不设 alpha。

同族风险：diffuseMul/specularMul/emissiveMul 等其余映射字段若再次出现「一处改一处漏」，双路径会静默分叉。

## 决策

1. **同一 `MaterialCategoryParams` 在 PBR 与 StandardMaterial 两条路径上，语义必须等价**：同一参数（alphaMul / diffuseMul / emissiveMul …）在两路径产生一致的视觉效果（考虑材质通道差异，但 alpha/透明度语义必须完全对齐）。
2. **alpha 处理以 StandardMaterial 路径为基准**：`clamp01(orig.alpha * alphaCtx.opacity * alphaMul)` + transparencyMode 切换，PBR 分支必须复刻；两路径同条件触发（`if (alphaCtx)`）。
3. **transparencyMode 切换的 PBR 守卫**（code_review P2 修正）：仅当材质基线是 OPAQUE（`_capturePbr` 捕获的 `orig.transparencyMode === OPAQUE`）时才在恢复时强制回 OPAQUE；模型自设的 ALPHATEST/ALPHABLEND（alpha 纹理头发/蕾丝）不被改回——避免把「对齐语义」做成「覆盖模型自设模式」。
4. **映射表文档化**：`_applyPbrMatParams` 头部的「与 StandardMaterial 语义对齐」注释（diffuseMul→albedo 等）是唯一映射真相源，新增映射字段必须同时更新该表与两路径实现。
5. **优先复用而非平行实现**：若未来出现第三种材质类型，优先抽象共享的「params → 标量/颜色/纹理级别」纯函数，而非再复制一份路径。

## 影响

- **修改文件**：`scene/manager/material.ts`（`_applyPbrMatParams` alpha 分支 + `_capturePbr` 捕获 `transparencyMode` 基线）。
- **测试**：`material-editor.state.test.ts` 现有 StandardMaterial alpha 用例；PBR 分支建议补镜像用例（P3 建议，code_review 已提及）。
- **验证**：material-editor 相关测试 88/88 通过；无行为回归（SM 路径未动，PBR 路径语义补齐）。

## 回滚

若 PBR 材质引擎（babylon-mmd fork）对 alpha 有特殊语义需偏离 SM 路径，须在 ADR 中说明差异理由并更新映射表，不得静默分叉。

## 检查清单（供 code review / 子代理审核复用）

- [ ] `MaterialCategoryParams` 每个字段在 PBR / StandardMaterial 两路径均有对应实现
- [ ] alpha / transparencyMode 两路径行为一致（同条件触发、同 clamp、同 opacity 乘子）
- [ ] transparencyMode 切换不覆盖模型自设的 ALPHATEST/ALPHABLEND（基线守卫）
- [ ] 新增映射字段时同步更新 `_applyPbrMatParams` 头部映射表注释
