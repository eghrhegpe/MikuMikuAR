# [material-sss 状态管理] — 第 21 轮审核结果

**审核范围：**
- 测试文件：`frontend/src/__tests__/material-sss.state.test.ts`（165 行）
- 被测源码：`frontend/src/scene/manager/material-sss.ts`（222 行，全模块）
  - `getMatSssParams` L45-52 / `setMatSssParams` L63-95 / `applySss` L106-124 / `applySssToMaterial` L131-173 / `disposeModelSssState` L178-180 / `getMatSssState` L186-205 / `applyMatSssState` L210-221 / `DEFAULT_SSS_PARAMS` L31-37
- 上游依赖核验：`@/core/clamp`（clamp01）、`@/core/logger`（logWarn）、`@/core/config`（modelRegistry / triggerAutoSave）、`./material`（getMatCatGroups）、ADR-188 / ADR-245、知识卡 `docs/knowledge/material.md`

**总体结论：** ⚠️ 有条件通过 —— 无 P1，1 项 P2（潜在全局状态污染，当前未触发），3 项 P3，其余为 P4 级优化项。测试 12/12 通过，`npm run check` 全绿。

---

## 亮点

- **写入/读取/清除三路对称，无幽灵路径**：`_sssState` 写入点仅 `setMatSssParams`（L92 `catMap.set`），删除点仅 `disposeModelSssState`（L179 `Map.delete`），读取点 `getMatSssParams` / `getMatSssState` / `applySss` 均只读。可 grep 全模块验证，无遗漏旁路。
- **dispose 链路完整且幂等**：`disposeModelSssState`（L178-180）→ 被 `material.ts:905` 的 `disposeModelMaterialState` 聚合 → `model-manager.ts:361` 在模型销毁路径统一调用。`Map.delete` 对不存在键返回 false 无副作用，重复 dispose 安全。SSS 状态只存参数值、不持有材质引用，材质本身的 `dispose()` 由 `model-manager.ts:342-344` 负责，无二次释放风险。
- **失败可见性兜底（ADR-245 落地成果）**：`applySssToMaterial`（L143-149）对 `mat.subSurface` 为 null 时 `logWarn` 显式告警后 return，不再静默失效；`applySss`（L108-111）对未知模型同样 logWarn。注释明示 9.x 只读 `subSurface` 公开属性，废弃 plugins 数组桥接，与 ADR-245 一致。
- **类型安全达标**：material-sss.ts 全模块 0 处 `as any` / `@ts-ignore` / `@ts-expect-error` / `as unknown`（grep 验证，同目录其他文件的 12 处逃生均不在本模块）。
- **钳制与克隆语义正确且有测试锚定**：`clamp01` 复用零依赖叶子（ADR-191）；`setMatSssParams` 对 Color3 输入克隆（L87）、平对象重建（L89）；测试「接受 Color3 格式并克隆」（L97-107）验证了修改原 color 不影响存储值。
- **反序列化兼容设计**：`applyMatSssState`（L210-221）复用 `setMatSssParams` 的 Color3/平对象双格式兼容，注释明示 JSON 反序列化后 sssColor 为 `{r,g,b}` 平对象，单一写入路径无重复逻辑。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | `frontend/src/scene/manager/material-sss.ts` | L48 / L51 | `getMatSssParams` 默认值路径 `{ ...DEFAULT_SSS_PARAMS }` 为**浅拷贝**：`sssColor` 字段与模块级 `DEFAULT_SSS_PARAMS.sssColor` 共享同一 Color3 引用。调用方若修改返回值的 `sssColor`（如 UI 拖拽改色直接写返回对象），会污染全局默认色，波及所有未设置分类的读取，并漂移 `getMatSssState`（L193）的 `defaultJson` 比较基准。当前唯一消费者 `model-material.ts:205-207` 只读属性、未触发；但 API 语义「返回副本」被违背，属潜伏全局状态污染点。 | `getMatSssParams` 两处返回改为深拷贝：`{ ...DEFAULT_SSS_PARAMS, sssColor: DEFAULT_SSS_PARAMS.sssColor.clone() }`（catMap 已存条目 L51 同理可补 `sssColor: p.sssColor.clone()` 与 L87 克隆语义对齐）；并补一条「修改返回值 sssColor 不影响后续读取」的回归测试。 |
| 🟡 P3 | `frontend/src/scene/manager/material-sss.ts` | L112-115 | `applySss` 中 `const meshes = inst.meshes; if (!meshes) return;` 为**死代码**：`meshes` 取值后从未使用（实际遍历依赖 `getMatCatGroups`），且 `ModelInstance.meshes` 类型为 `Mesh[]`（非可选），`if (!meshes)` 恒假。冗余变量 + 无效守卫易误导后续维护者以为存在空 mesh 分支。 | 删除 L112-115 的 `meshes` 取值与空守卫，只保留 `modelRegistry.get` 判空（L107-111）。 |
| 🟡 P3 | `frontend/src/scene/manager/material.ts` ↔ `material-sss.ts` | L15 ↔ L14 | **循环依赖**：`material.ts:15` import `material-sss`（getMatSssState/applyMatSssState/disposeModelSssState），`material-sss.ts:14` import `material`（getMatCatGroups）。当前为良性（均为函数体内运行时引用，非模块顶层执行），`dep:graph` 成环，破坏分层清晰度；若任一方未来在顶层执行对方导出将触发 TDZ。 | 维持函数级引用现状（注明良性），或择机下沉 `getMatCatGroups` 至共同叶子（如 material-proxy-resolver 域）破除环；`npm run dep:graph` 核验。 |
| 🟡 P3 | `frontend/src/__tests__/material-sss.state.test.ts` | L127-136 | 测试「当所有分类均为默认值时返回 null」**断言无效、目标漂移**：`const state = getMatSssState(MODEL_ID)` 赋值后从未使用（L131-133 注释已自认比较方式不可行）；随后 `disposeModelSssState` 清空 Map，最终断言走的是 `!catMap` 早退分支（L190-192），**未覆盖**「全默认分类被 JSON 过滤」分支（L195-200），且与下一用例 L138-141 完全重复。 | 改为不 dispose：仅 `setMatSssParams(MODEL_ID, CAT_SKIN, { sssPower: 0 })`（全字段默认）后断言 `getMatSssState` 为 null，真正压到过滤分支；或删除本用例保留下一用例。 |
| 🟢 P4 | `frontend/src/scene/manager/material-sss.ts` | L136 | `const p = params as SssParams;` 冗余 cast：`params` 参数类型已是 `SssParams`，cast 无类型收敛作用，且与 `??` 兜底（L159/162/169/170）共同暗示字段可空——实际 `SssParams` 五字段全部必填，`??` 永不触发。 | 删除 `as SssParams` 与四处 `?? ` 兜底，或（若意图防御未来可空化）在接口层显式标可选并补默认值逻辑。 |
| 🟢 P4 | `frontend/src/scene/manager/material-sss.ts` | L165 | 魔法数值：`ss.diffusionDistance = new Color3(1, 1, 1)` 硬编码扩散距离，无常量名，与 `DEFAULT_SSS_PARAMS` 集中管理风格不一致；`ss.tintColor` / `ss.tintColorAtDistance` 的兜底值 `(1,1,1)` / `0.5` 同样与默认参数重复。 | 扩散距离如需固定，提取为模块常量或并入 `DEFAULT_SSS_PARAMS` 语义扩展；兜底值统一引用常量。 |
| 🟢 P4 | `frontend/src/__tests__/material-sss.state.test.ts` | L32-34 | mock 冗余：注释称 material mock「让 applySss 成为空操作」，但实际 `applySss` 因未 mock 的 `core/config` 真实 `modelRegistry` 空 Map（L107）已提前 return，`getMatCatGroups` mock 属次要保险。若未来测试补 modelRegistry 条目，此 mock 反而会**遮蔽**材质应用路径。 | 明确注释「双保险」意图，或删除 material mock、在需要时补 `modelRegistry.set` 注入真实路径。 |
| 🟢 P4 | `docs/knowledge/material.md` | L104 | 文档微漂移：知识卡称「material.ts 的 `getMatSssState` / `applyMatSssState` 将 SSS 参数随材质状态持久化」，实际符号定义在 `material-sss.ts`（material.ts:15 仅 import 转发并在 L994/1081 调用）。语义不误但定位易混。 | 改为「material-sss.ts 提供序列化，material.ts 在 getMatState/applyMatState 中调用」。 |

---

## 测试质量评价

- **有效性与覆盖**：12 用例全绿（52ms，无 skip/it.skip），覆盖 get/set 基本读写（L60-67）、未设置分类默认值（L69-73）、sssPower/sssDistance 双向钳制（L75-87）、颜色双格式（`{r,g,b}` 平对象 L89-95 / Color3 克隆 L97-107）、序列化含分类与过滤默认值（L110-126）、无状态返回 null（L138-141）、apply 恢复（L144-158）、空 state 容错（L160-163）。**「Color3 克隆」用例（L105-106）尤其有价值**，锚定了存储侧引用隔离语义。
- **mock 合理性**：Color3 内联 mock（L16-24）最小够用且 `instanceof` 一致性正确（生产模块与被测对象同享 mock 模块）；logger 只 mock 生产实际 import 的 `logWarn`（L27-29）；未 mock `core/config` 而依赖真实空 `modelRegistry` + `triggerAutoSave` 空指针 no-op（auto-save.ts:16 `?.()`），node 环境下安全无挂起——但这一点依赖 `scene-state.ts` 的 `export let` 活绑定，未来 config 若引入 node 不兼容副作用需重审。
- **`@ts-nocheck` 合理性**：符合项目惯例——`__tests__` 下 13 个测试文件均用 `@ts-nocheck`（camera*/library*/material-editor/model-manager/model-preset 等），注释「vi.mock 运行时替换」一致；frontend/AGENTS.md 测试卫生铁律针对**生产代码**逃生（本项目生产代码严格 0 `as any`/`@ts-ignore`），测试文件 @ts-nocheck 有先例背书，判定合理。副作用是屏蔽测试自身类型检查（如 `state!` L114-116 非空断言本可省略），属可接受的取舍。
- **覆盖缺口**：① `applySss` / `applySssToMaterial` 对真实 PBRMaterial 的 subSurface 应用断言**本文件未覆盖**（mock 空 Map + 空 modelRegistry 使 applySss 提前 return；材质侧传播断言在 `scene/sss-pbr-material.test.ts` 覆盖 SssPBRMaterial，material-sss 侧无直接测试）；② sssMinThickness/sssMaxThickness 无测试；③ 部分更新（只传 sssPower 应保留 sssColor/sssDistance）无显式断言，仅钳制用例隐式触发 merge 路径；④ applySss 未知模型 logWarn 分支无测试。
- **验证记录**：`npm run test -- src/__tests__/material-sss.state.test.ts` → 12/12 通过（Duration 3.96s，tests 52ms）；`npm run check`（含 i18n parity）→ exit 0 全绿。项目基线无回归。

---

审核日期：2026-08-15
审核员：子代理 round21-material-sss
