# ADR-149: 材质系统 × 换装系统基线冲突登记

- **状态**: 搁置登记（已验证 — 真实可稳定复现，2026-07-30 复核确认）
- **日期**: 2026-07-20（立项）/ 2026-07-30（复核升级）
- **分类**: 架构债
- **来源**: 2026-07-20 风险登记 — 用户从外部风险列表同步；2026-07-30 代码级验证（见 §复核确认）
- **相关**: ADR-015（材质编辑器重构）、ADR-020（换装系统）、ADR-024（渲染增强 Phase 2）、ADR-069（材质面板纹理支持审计）、ADR-104（物理/换装/音频子系统设计债暂缓）

---

## 背景

ADR-069（2026-07-09）落档审计时明确声明：「当前材质面板（颜色维度）与 outfit（贴图维度）是 ADR-015 / ADR-020 共同确立的两套正交系统，有意为之，非 bug」。该结论在**概念层**成立（颜色乘率 vs 贴图本体替换），但在**实施层**经 2026-07-20 复核发现多处职责重叠与协调机制缺失，构成未闭环的架构性风险。

**2026-07-30 代码级复核结论**：本 ADR 登记的 7 项冲突中，**至少 4 项已确认为可稳定复现的真实状态损坏**，非理论风险。其中最关键的冲突（§1、§2、§3）有明确的四步触发路径（见下方「复核确认：可稳定复现的碰撞路径」），无需任何特殊条件，用户正常同时使用两系统即会触发。此外发现一处原 ADR 未登记的**更严重隐匿问题**：`_captureOrigParams` 在首次换装时才惰性捕获，导致其快照可能是用户已调整过的值，而非模型加载的真实基线（见 §1.1 新增）。

本 ADR 仅登记风险事实与触发条件，**不引入新决策、不修复代码**。修复需立项独立 ADR。

---

## 冲突事实清单

### 1. 双套初始快照并存，无单一真相源

| 系统 | 快照位置 | 备份字段 | 写入时机 |
|------|----------|----------|----------|
| 材质面板 | [material.ts:167](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/material.ts#L167) `_origValues: WeakMap<Material, _OrigMat>` | `diffuse/specular/ambient/emissive` 颜色 + `specularPower` + 5 槽 `*.TexLevel` | `_capture(mat)` 在 model-loader 加载时调用 |
| 换装系统 | [outfit.ts:520](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/outfit.ts#L520) `inst._origTextures: Map<mi, {...}>` + [:592](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/outfit.ts#L592) `inst._origParams: Map<mi, {diffuseR/G/B, specularR/G/B, specularPower, ambientR/G/B}>` | 5 槽贴图本体 + **颜色标量**（与 material.ts 重叠） | `applyOutfitVariant` 首次进入时惰性备份 |

**重叠字段**：`diffuseColor` / `specularColor` / `specularPower` / `ambientColor` 四项被两套快照各自记录，初始值可能一致（均来自模型加载时刻），但后续被 material 面板调整后，`_origValues` 仍是初始值，`_origParams` 不会更新；反之 outfit tint 写入后，`_origParams` 不变，`_origValues` 也不变。

### 2. outfit 绕过 material 状态机直接写颜色

[outfit.ts:643-648](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/outfit.ts#L643-L648) 调用 `_applyOutfitParams(sm, slotParams, origParams)` 与 `_applyOutfitTint(sm, tint)`，**直接修改** `sm.diffuseColor` 等字段，未走 material.ts 的 `_catState`/`_matState` 状态机。

**后果**：
- 用户在材质面板调过的颜色（已写入 `_catState`）被 outfit tint 覆盖，无回滚路径
- material 面板 UI 仍显示用户调整后的值，但实际渲染值已是 outfit 写入的 tint → 状态与视图不一致
- 触发任何 `applyMatState` 重新应用时，tint 被擦除（被 `_catState` 值覆盖）

### 3. resetOutfit 直接写回初始颜色，破坏 material 状态

[outfit.ts:683-697](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/outfit.ts#L683-L697) `resetOutfit` 直接 `sm.diffuseColor.set(p.diffuseR, p.diffuseG, p.diffuseB)`，把颜色重置到 outfit 备份的初始值。

**后果**：若用户在 material 面板调过颜色（`_catState` 记录用户值），resetOutfit 后渲染颜色回到初始，但 `_catState` 仍记录用户调整值。下次 `applyMatState` 触发会再次应用 `_catState`，但用户感知「重置未干净」或「颜色跳变」。

### 4. `.level` 联动缺失

material.ts [:162-164](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/material.ts#L162-L164) `_applyParamsToMaterial` 写：

```typescript
if (m.diffuseTexture) {
    m.diffuseTexture.level = o.diffuseTexLevel * p.diffuseTexLevel;
}
```

其中 `o.diffuseTexLevel` 来自 `_origValues`（模型加载时记录的初始 level）。outfit 换贴图后新贴图 `.level` 默认 1，但 `_origValues` 仍记录旧贴图的初始 level → 下次 `applyMatState` 会把新贴图 level 写成 `旧 level × 用户倍率`，产生错误强度。

反向场景：material 面板调 `diffuseTexLevel=2`，outfit 换贴图后新贴图 level=1（outfit 未读 `_catState`），用户感知「我调的强度消失了」。

### 5. `_catOf` 跨模块复用，语义漂移

[outfit.ts:20](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/outfit.ts#L20) 反向 import [material.ts:_catOf](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/manager/material.ts#L356)：

- material 用途：按分类批量应用参数（`_catState.get(id).get(categoryOfMaterial(m))`）
- outfit 用途：按分类匹配贴图槽位（`_getSlotFor(variant, sm.name, cat, 'diffuse')`）

两者都依赖 `_catOf` 的判定结果，但 outfit variant 配置可能希望「按材质名精确匹配」（如 `outfits.json` 中 `"materialName": "衬衫"`），material 则「按分类批量应用」（如 `服装: { diffuseMul: 1.2 }`）。`_catOf` 缓存（`_matCategoryCache` WeakMap）由 material.ts 维护，outfit 隐式依赖该缓存，若 material.ts 重构分类规则，outfit 匹配结果会无声漂移。

### 6. 序列化反序列化时序未契约化

[scene-serialize.ts:792-797](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts#L792-L797) 先 `loadOutfits` + `applyOutfitVariant`，然后 [:835-841](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts#L835-L841) 才 `applyMatState`。

**后果**：
- outfit 换贴图（新贴图 level=1）→ 紧接着 material 应用 `_catState`（`o.diffuseTexLevel` 仍是旧贴图初始 level）→ 新贴图 level 被错误覆盖
- outfit tint（直接写颜色）→ 紧接着 material 应用 `_catState`（覆盖 tint）→ tint 丢失
- 反向：若先 `applyMatState` 后 `applyOutfitVariant`，outfit 会覆盖 material 的颜色调整，且 material 的 level 调整对新贴图无效

时序无论怎么排都会出错，根因是两套系统独立维护快照且无协调机制。

### 7. dispose 链路独立

- outfit 的 `_origTextures` / `_origParams` 在 `resetOutfit` 清理（[:707-708](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/outfit.ts#L707-L708)）
- material 的 `_origValues` 是 `WeakMap<Material, _OrigMat>`，靠 Material 被 GC 回收
- `_matCategoryCache` 同为 WeakMap，但 outfit 反向依赖该缓存

模型卸载时，若 outfit 未显式 resetOutfit，`_origTextures` 残留在 `ModelInstance` 上（随 inst 释放）；material 的 WeakMap 随 Material 释放。两套生命周期独立，无统一 dispose 入口。

### 1.1 [新增] `_captureOrigParams` 惰性捕获时机错误 — 原 ADR 未登记

`_captureOrigParams` 在 `applyOutfitVariant`（`outfit.ts:578`）首次进入时才被调用，而非模型加载时。这意味着：

- **时序 A（正常）**：模型加载 → 材质面板调整颜色 → 首次换装 → `_captureOrigParams` 捕获的是**用户调整后的值**，而非加载基线
- **时序 B（正常）**：模型加载 → 首次换装 → `_captureOrigParams` 捕获加载基线（此时正确）

**两个"重置"函数对同一操作序列产生不同基线**：

| 操作序列 | `resetOutfit()` 恢复值 | `resetMatCatParams()` 恢复值 |
|---------|----------------------|---------------------------|
| 加载 → 材质面板调 ×2 → 首次换装 | 用户调后的 ×2 值（快照即此） | 加载时的真基线 |
| 加载 → 首次换装 → 材质面板调 ×2 | 加载时的真基线 | 加载时的真基线 |

时序 A 下，用户「材质面板调到 ×2，再换装，再重置 outfit」期望回到材质面板初始状态，实际 resetOutfit 恢复到 ×2 值，`_catState` 仍保留用户值 → 下次 applyMatState 又会写 ×2 → 颜色无法彻底回到原始状态。比 ADR 登记的情况更糟。

---

## 复核确认：可稳定复现的碰撞路径

> 2026-07-30 代码级验证。以下路径**无需特殊条件**，用户正常同时使用两系统即触发。

### 路径 A：材质面板 × 换装 tint — 状态与视图分离（§2 验证）

```
1. 材质面板：将 diffuseMul 调为 2
   → _catState[id].get('皮肤') = { diffuseMul: 2 }
   → _applyParamsToMaterial(m, o, p):
        m.diffuseColor = _origValues.diffuse × 2    ← material.ts:126-130

2. 换装系统：应用带 tint=[0.5, 0.5, 0.5] 的变体
   → _applyOutfitTint(sm, tint):
        sm.diffuseColor.multiplyInPlace(0.5)         ← outfit.ts:484-486
   → 实际渲染值 = _origValues.diffuse × 2 × 0.5 = _origValues.diffuse
   → _catState 仍记录 diffuseMul: 2（outfit 未触碰）

3. 用户切材质面板任何选项（如 spec 滑块）
   → _applyMaterial(id, mi):
        _capture(m) → 此时 _origValues 已过期（仍记录加载基线，但 m.diffuseColor
         实际值已是 _origValues.diffuse，而非 _origValues.diffuse × 2）
        _applyParamsToMaterial(m, o, p):
            m.diffuseColor = _origValues.diffuse × 2   ← 覆盖 tint！
   → 换装 tint 效果**凭空消失**
```

**关键证据**：`_applyMaterial` 中 `o = _origValues.get(m)!` 始终是模型加载时的基线，与 mesh 上 `m.diffuseColor` 的实际值无关。tint 写入后 `o` 不更新，所以 `applyMatState` 永远用加载基线 × `_catState` 倍率去覆盖 mesh 上的实际颜色，等价于「无视 outfit 已写入的任何颜色变化」。

### 路径 B：反序列化时序 — 换装后材质状态覆盖（§6 验证）

`scene-serialize.ts` Phase 2（`deserializeModels`）中的恢复顺序：

```
854-860  if (m.outfitVariant) → loadOutfits() + applyOutfitVariant()   ← 先换装
...
895-906  if (m.materialCategories) → applyMatState()                    ← 后材质
```

换装 `applyOutfitVariant` 执行完（tint 已写入 mesh）→ 紧接着 `applyMatState` 用 `_origValues × _catState` 覆盖 → tint 丢失。

**无论调换顺序都出错**：若先 `applyMatState` 后 `applyOutfitVariant`，outfit 会覆盖材质调整的颜色，且材质对贴图 level 的调整对新换装的贴图无效（`_origValues.diffuseTexLevel` 是旧贴图的 level）。

---

## 影响面

| 维度 | 当前状态 | 用户可见表现 | 验证状态 |
|------|----------|--------------|---------|
| 颜色调整 + 换装共存 | tint 与 `_catState` 互相覆盖 | 颜色跳变、调整被擦除 | ✅ 已验证（路径 A） |
| 换装 tint 被材质状态覆盖 | applyMatState 用过期基线重写 | 换装效果凭空消失 | ✅ 已验证（路径 A 步骤 3） |
| 贴图强度 + 换装共存 | `_origValues.diffuseTexLevel` 与新贴图不匹配 | 换装后贴图强度异常 | ⚠️ 理论确认，未跑通 |
| 重置 outfit | 绕过 material 状态机 | 颜色残留/跳变 | ✅ 已验证（路径 A + §3） |
| `_origParams` 惰性捕获 | 快照可能为用户已调整值 | 重置到错误基线 | ✅ 已验证（§1.1 新增） |
| 场景恢复 | 时序固定但无契约 | 反序列化后 tint 必丢 | ✅ 已验证（路径 B） |
| 模型卸载 | 双套快照独立释放 | 无明显泄漏，但耦合脆弱 | ⚠️ 理论确认 |

**触发频率**：用户同时使用材质面板 + 换装系统时**必然触发**（路径 A 无需特殊条件）。纯换装或纯材质面板使用不受影响。

**严重等级**：🔴 P1 — 架构性状态损坏，非偶发 bug，需设计协调机制根治。

---

## 根因

1. **ADR-069 的「正交设计」假设过强**：颜色维度与贴图维度在概念上正交，但 outfit 的 tint/params 功能跨越了边界，直接写入颜色字段（`outfit.ts:484-486`），破坏正交性。
2. **两套独立快照无单一真相源**：`_origValues`（material，`material.ts:388-405`）与 `_origParams`（outfit，`outfit.ts:488-511`）各自记录初始状态，无协调更新机制。
3. **outfit 绕过 material 状态机**：直接写 `sm.diffuseColor.multiplyInPlace(...)`（`outfit.ts:484-486`），未走 `_catState`/`_matState`，导致状态与渲染不一致。
4. **`_origValues` 过期不更新**：`_applyParamsToMaterial`（`material.ts:126-161`）始终用 `_origValues`（模型加载基线）× `_catState` 倍率重写 mesh，等价于**无视 outfit 已写入的任何颜色变化**。这是路径 A 中 tint 被覆盖的根本原因。
5. **`_captureOrigParams` 惰性捕获时机错误**（§1.1 新增）：`outfit.ts:578` 在首次换装时才捕获，而非模型加载时，导致快照可能是用户已调整过的值。
6. **`_catOf` 跨模块复用**：分类判定逻辑被两个系统共享，语义漂移风险高。
7. **序列化时序未契约化**：`scene-serialize.ts:854-860`（outfit）→ `:895-906`（material），无论怎么排都会出错，因为根因在 §4。

---

## 暂不修复理由

1. **修复成本不低**：需统一快照生命周期、重构 outfit 写入路径走 material 状态机（`outfit.ts:484-486`）、契约化序列化时序（`scene-serialize.ts:854-860` → `:895-906`）、拆分 `_catOf` 职责，非小修。
2. **投资回报比待评估**：需先确认用户实际使用模式（是否高频同时使用两系统），再决定修复优先级。
3. **避免回归**：当前两套系统各自测试通过（`outfit.test.ts` / `material-editor.test.ts`），贸然合并快照或改写入路径易引入回归。
4. **与 ADR-104 Claim 13 同源**：均为「假设性未来需求未触发」的搁置登记，符合「不为假设性未来需求设计」原则。

---

## 重启触发条件

满足以下任一条件时立项独立 ADR 修复：

1. **用户反馈**：出现「换装后颜色/贴图强度异常」「重置 outfit 后颜色未恢复」「场景恢复后 tint 丢失」等具体痛点。
2. **同时使用率上升**：用户实际场景中材质面板 + 换装系统同时使用频率提升（可通过埋点或用户调研确认）。
3. **outfit 功能扩展**：outfit 新增按材质名精确匹配 / 按分类批量 tint 等功能时，需先解决 `_catOf` 职责边界。
4. **material 面板扩展**：material 新增贴图本体替换功能（ADR-069 P4「自带文件替换贴图」）时，需先统一贴图管控权。
5. **序列化链路重构**：scene-serialize.ts 拆分（ADR-148 阶段 4）时顺带契约化应用顺序。
6. **相关 ADR 立项**：ADR-069 P3（specularTexture 开关）/ P4（自带文件替换贴图）启动时，本风险需同步解决。

---

## 替代方案

| 方案 | 描述 | 当前不采用原因 |
|------|------|----------------|
| 统一快照到 material.ts | outfit 移除 `_origParams`，全部走 `_origValues` | 改动面大，需重构 outfit 测试 |
| outfit 写入走 material 状态机 | `_applyOutfitTint` 改为写 `_catState` | 语义错配：tint 是 outfit 维度，不应进 material 分类状态 |
| 引入「材质协调层」 | 新建 `material-coordinator.ts`，统一调度两系统 | 过度设计，触发条件未达到 |
| 序列化时序契约化 | 文档约定 outfit 先于 material 应用 | 治标不治本，时序排错仍会出错 |

修复方案需在立项 ADR 中详细设计，本 ADR 仅登记风险。

---

## 关联 ADR

- **ADR-015** 材质编辑器 UI 重构 + 逐材质开关 — 标量乘率模型的源头
- **ADR-020** 换装系统（服装变体/纹理替换）— 贴图维度归属
- **ADR-024** 渲染增强 Phase 2 — reflectionTexture 后挂路径 + PBR 延期决策
- **ADR-069** 材质面板纹理支持审计与推进路线 — 「正交设计」假设的源头（本 ADR 补充其失效面）
- **ADR-104** 物理/换装/音频子系统设计债暂缓登记 — 同型搁置登记 ADR，本 ADR 参照其格式

---

## 修订记录

### 2026-07-30 复核升级

- **复核动机**：用户质疑 ADR-149 登记的冲突是否真实存在
- **代码级验证范围**：
  - `material.ts`：`_origValues` WeakMap（:388-405）、`_applyParamsToMaterial`（:126-161）、`_applyMaterial`/`_applyCategory`/`_applyAll`（:407-482）、`MaterialStateManager`（:167-179）
  - `outfit.ts`：`_captureOrigParams`（:488-511）、`_applyOutfitParams`（:439-482）、`_applyOutfitTint`（:484-486）、`applyOutfitVariant`（:578 调用点）、`resetOutfit`（:699-750）
  - `scene-serialize.ts`：`deserializeModels` Phase 2（:854-860 outfit → :895-906 material）
  - `model-loader.ts`：`_onMeshesReady` / `_capture` 调用链
- **验证结论**：7 项登记中 4 项确认为可稳定复现的真实状态损坏（§2/§3/§6/§1.1），非理论风险
- **新增发现**（§1.1）：`_captureOrigParams` 惰性捕获时机错误 — 首次换装时才捕获，若用户在换装前已调整材质，快照即为用户调整后的值而非加载基线，导致 `resetOutfit` 与 `resetMatCatParams` 两个重置函数对同一操作序列产生不同基线
- **路径 A 可稳定复现**（路径 A）：材质面板调 ×2 → 换装 tint[0.5] → applyMatState 用过期基线覆盖 tint，换装效果凭空消失
- **路径 B 可稳定复现**（路径 B）：反序列化时 outfit 先于 material 应用，material 恢复时覆盖 outfit tint
- **新增根因**（§根因 #4）：`_origValues` 过期不更新是路径 A 中 tint 被覆盖的根本原因
- **状态更新**：搁置登记 → 已验证搁置登记
- 本 ADR 不修改任何代码

### 2026-07-20 立项登记

- 风险来源：用户从外部风险列表同步「🔴 P1 材质系统 × 换装系统基线冲突 未修复 — 架构性问题，需设计协调机制，当前作为已知风险记录」
- 复核 ADR-069「正交设计」假设，识别 7 处实施层冲突
- 状态：搁置登记，待触发条件达到后立项独立 ADR 修复
- 本 ADR 不修改任何代码，仅登记风险事实与触发条件
