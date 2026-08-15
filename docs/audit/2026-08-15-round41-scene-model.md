# Round 41 — scene-model 审核报告

## 审核范围

- **测试文件**：`frontend/src/__tests__/scene-model.test.ts`（234 行，14 用例 / 4 describe，`@vitest-environment node`，无 `@ts-nocheck`）
  - 定位：早期纯注册表测试（无真实 Babylon Scene），覆盖 ModelManager 注册表/属性/焦点/布局/物理分类正则。
- **被测源码**：`frontend/src/scene/manager/model-manager.ts`（1352 行，仅审本测试触及的区段）
  - 物理分类规则/正则：`PHYSICS_CAT_RULES` 50-67、`PHYSICS_CAT_PATTERNS` 69-71、`_classifyBonePhysics` 73-81
  - 注册表：`get` 241-243、`getAll` 246-248、`size` 251-253、`register` 256-266、`findByFilePath` 290-297、`remove` 302-380
  - 焦点/布局：`focus` 393-429、`arrange` 432-443
  - 属性：`setVisibility` 479-487、`setOpacity` 489-501、`setWireframe` 503-511
  - 类型导入：`core/config.ts`（re-export `core/scene-state.ts` 的 `focusedModelId`/`setFocusedModelId`，scene-state.ts:66-69）
- **验证**：`cd frontend && npm run test -- src/__tests__/scene-model.test.ts` → **14/14 通过（8ms 用例 / 1.01s 墙钟）**，无 skip/todo/only。`npm run check` 未跑（本轮仅审早期纯注册表测试，源码未改动；耗时考量见 round-39 基线已绿）。

## 与既往审核关系（round-13 / round-39）

- **round-13**（`2026-08-06-round13-scene-render-core-ui.md`）：`remove()` 隐式 reframe 副作用已修复（源码 377-379 注释）；本测试 `remove transfers focus to remaining model`（test:122-131）与 `remove clears focus when no models remain`（test:133-138）正是该修复的行为锁定，无残留。
- **round-39**（`2026-08-15-round39-model-manager.md`，122 用例主测试）：**本文件与其高度重叠**——registry CRUD、focus、arrange、visibility/opacity/wireframe、remove 清理+焦点转移、classifyBonePhysics 在 `model-manager.test.ts` 中均有对应 describe（80-111 / 290-375 / 377-456 / 767-870 / 725-765）。本文件是早期（合并前）纯注册表测试，round-39 合并 7 文件时未将其并入，二者并存。详见「测试质量评价 § 重叠」。

## 总体结论

⚠️ **有条件通过**（生产源码无新增 P1/P2；测试文件 1×P2、3×P3、5×P4）

生产源码健康度良好：注册表增删查路径清晰、`register` 同 ID 覆盖有释放防御（256-263，round-17 修复）、`remove` 清理链完备且顺序有注释（302-380）、`setOpacity` 有 NaN/Infinity 守卫（494-497）、0 处 `as any`/`@ts-ignore`（唯一逃生口为 round-22 遗留 `as unknown as` cast，1244，round-39 已记 P4）。本测试 14 用例全绿且核心注册表断言真实有效。

**主要条件**：① describe 4「_classifyBonePhysics」是复制粘贴源码关键词的自证测试（见 P2-1），覆盖虚假；② 与 round-39 主测试重复覆盖高，双文件并行演进有漂移成本；③ focus 测试依赖 config 模块级 `focusedModelId` 无显式重置，顺序敏感。

---

## 亮点

- **`remove` 清理链设计与 round-13 修复的行为锁定**：`model-manager.ts:302-380` — onRemoveModel 包 try/catch（321-325，round-17）、材质 Set 去重 + `detachSharedTextures` 再 dispose（330-344）、`destroyBoneOverlay` 在 registry delete 后调用且有注释（357-359）；测试 `remove transfers focus to remaining model`（test:122-131）断言焦点转移到剩余首个 key，`remove clears focus`（test:133-138）断言清空——把 round-13 的「仅删焦点模型才重取景」语义固化为回归护栏。
- **重复注册防御 + 未知 id no-op 矩阵**：`register` 同 ID 不同实例先 `remove` 释放（256-263）；测试对 register/get/findByFilePath/remove/focus/setVisibility/setOpacity/setWireframe 的未知 id 路径全部断言「不抛错 + 状态不变」（test:59, 84-88, 94, 117-120, 190-194），与 round-39 主测试的 no-op 矩阵互为印证。
- **`setOpacity` 钳制断言**：test:171-182 对 0.5/2/-1 三档断言 clamp 落点（2→1、-1→0），与源码 `clamp01`（498）+ NaN 守卫（494-497）对应；round-39 主测试 1358 已补 NaN 用例，本文件未重复。
- **测试声明纪律**：文件头注释（test:6-8）明确「Physics / morph / bone-overlay paths are skipped (require full Babylon mock)」，职责边界清晰；14 用例 8ms 全绿，无 skip/todo/only。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | frontend/src/__tests__/scene-model.test.ts | 202-207 | **复制粘贴自证测试**：`patterns` 数组内联复制了源码 `PHYSICS_CAT_RULES`（model-manager.ts:50-67）的全部关键词，而非从源码导出引用。测试实际验证的是「测试自己复制的正则」而非源码的 `_classifyBonePhysics`/`PHYSICS_CAT_PATTERNS`——源码删改分类规则（如移除 '裾'）时本测试**不会失败**，却给维护者「物理分类有测试」的虚假安全感；且 `name.toLowerCase()` 语义与源码 `_classifyBonePhysics`（73-81，同样 toLowerCase）重复实现 | 从源码导出 `PHYSICS_CAT_PATTERNS`（或 `PHYSICS_CAT_RULES`）供测试引用，消除复制；或直接删除该 describe——round-39 主测试 725-765 已对四类规则做真实覆盖（`classifyBonePhysics matches skirt/chest/hair/accessory patterns`） |
| 🟡 P3 | frontend/src/__tests__/scene-model.test.ts | 98-138 | **测试间共享模块级状态、顺序敏感**：`focusedModelId` 是 `core/scene-state.ts:66` 的模块级 `export let`，本 describe 的 beforeEach（103-107）不重置它。当前 4 个用例序列恰好自洽（`focus('nope')` 与 `remove` 焦点分支会把状态清回 null），但加 `.only`、重排或新增用例会误报（前一个用例泄漏的焦点污染后一个断言） | `beforeEach` 显式 `setFocusedModelId(null)` 重置模块状态，或断言前不依赖历史状态 |
| 🟡 P3 | frontend/src/__tests__/scene-model.test.ts（全文件） | 与 round-39 主测试重叠 | **重复覆盖**：registry CRUD ↔ `model-manager.test.ts:80-111`、focus+arrange ↔ 290-375、remove 清理+焦点 ↔ 377-456、visibility/opacity/wireframe ↔ 767-870、classifyBonePhysics ↔ 725-765。本文件唯一增量是：arrange 断言偏移具体值（test:148-150，-1.5/+1.5）与 remove 探私 map 清理（test:73-81） | 评估将增量断言并入主测试后删除本文件（round-39 合并 7 文件时未含本文件，属历史遗留）；若保留，头注释明示与 round-39 的重叠关系与保留理由 |
| 🟡 P3 | frontend/src/__tests__/scene-model.test.ts | 12-34（makeModel） | **未复用共享 mock 工厂**：内联独立实现 `makeModel`，未复用 round-39 收敛的 `model-manager-mocks.ts`（263 行，ADR-206）；`ModelInstance` 字段增删需两文件双点同步（如新增必填字段时本 helper 靠 `as unknown as` 逃生，主测试 mock 却可能编译失败——两文件对类型演进的敏感度不一致） | 复用 `model-manager-mocks.ts` 的模型构造，或头注释注明本文件为历史早期测试不参与 mock 收敛 |
| 🟢 P4 | frontend/src/__tests__/scene-model.test.ts | 43, 106, 141-142, 159 + 33 | 测试文件内 8 处类型逃生：`{} as any` scene mock ×4、`as unknown as ModelInstance` ×1、mesh 桩 `as any` ×2、`(mgr as any)` 探私 ×4（73-74, 80-81）。测试文件合法但耦合实现细节，与 frontend/AGENTS.md「不新增 any 逃生」精神相悖（生产代码 0 处，此处仅为测试侧） | 探私断言处加注释说明动机；mesh 桩可用最小接口类型替代 `as any` |
| 🟢 P4 | frontend/src/__tests__/scene-model.test.ts | 68-82（触发） | `remove deletes model and cleans up internal maps` 走真实 `remove()` → `getSceneAction('disposeOverlay'/'restoreMaterials')` 未注册，运行输出产生一次性 `console.warn`（'disposeOverlay' 未注册——调用将静默跳过，source `core/scene-action-bridge.ts`）；round-39 P4 已记录同类问题 | 测试 setup 中 `registerSceneAction` 注册 no-op 消除告警（与 round-39 建议一致） |
| 🟢 P4 | frontend/src/__tests__/scene-model.test.ts | 109-115 | `focus updates focusedModelId` 对 autoFrame 显式放弃断言（114 注释 "can't assert the args without real meshes"）；且 setVisibility/setOpacity/setWireframe 用例只断言 inst 字段，mesh/material 链路零验证（meshes 为空 + `material.ts:_applyAll` 对未注册 id 静默早退，624-627）——断言「字段写入」真实有效，但测试名暗示「属性应用」 | 保留字段级断言并注明「链路级断言见 round-39 主测试 311-316 / 788-870」；或补最小 mesh 桩走真实 `_applyAll` |
| 🟢 P4 | frontend/src/__tests__/scene-model.test.ts | 148-149 | arrange 用例硬编码 `spacing = 3`（注释），与源码 `arrange()` 内魔法数 `const spacing = 3`（model-manager.ts:435）双点同步漂移（round-39 P4 已提源码侧魔法数值） | 源码侧提取 `FORMATION_DEFAULT_SPACING` 常量后，测试引用常量或断言相对间距而非绝对值 |

---

## 测试质量评价

### 断言有效性（✅ 核心注册表强，分类正则弱）
- **真实路径**：`size/get/getAll/register/remove/findByFilePath/focus/arrange/setVisibility/setOpacity/setWireframe` 全部走真实源码（仅 Babylon 场景/mesh 桩化）；`focusedModelId` 断言经真实 `core/scene-state.ts` 模块级变量，非 mock 自证。
- **具体行为**：arrange 断言偏移**具体值**（-1.5/+1.5，test:149-150），与源码 `(i - (n-1)/2) * 3`（437）公式真实验证（非 round-39 主测试的通用「水平排布」断言）；`setOpacity` 三档钳制落点断言（171-182）。
- **弱项**：describe 4「_classifyBonePhysics」为复制粘贴自证（见 P2-1），其断言（223-232）只验证测试自身副本，覆盖虚假。

### 与 round-39 主测试的重叠（🟡 高，冗余为主）
- 本文件 14 用例的覆盖面几乎全部被 `model-manager.test.ts`（122 用例）包含，唯一增量：arrange 偏移具体值、remove 探私 map 清理、setOpacity 三档 clamp。round-39 主测试在 autoFrame 数学、`_applyAll` 材质链路、NaN/Infinity 输入矩阵、serialize 往返等维度显著更深。
- **建议**：保留本文件作为「早期纯注册表回归」的价值有限；更优路径是并入主测试（增量断言迁移）后删除，或至少在头注释声明重叠关系，避免未来维护者误判为独立覆盖。

### 边界覆盖（🟡 基本齐全但浅）
- 已覆盖：空注册表（size=0/getAll=[]）、未知 id 全矩阵 no-op、重复注册路径（经 remove 防御）、焦点转移/清空、opacity 钳制边界（2/-1）、remove 内部 map 清理。
- 未覆盖（本文件声明跳过，round-39 主测试已覆盖）：autoFrame 边界数学、mesh/material 链路、NaN/Infinity 输入、physics 状态恢复。

### 跳过测试
- 无 `.skip`/`.todo`/`.only`（已 grep 核实）；14/14 全绿（8ms）。文件头注释（6-8）声明的跳过范围与 round-39 主测试互补，非空白覆盖。

---

审核日期：2026-08-15
审核员：子代理 round41-scene-model
