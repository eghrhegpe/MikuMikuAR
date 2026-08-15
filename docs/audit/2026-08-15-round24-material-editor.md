# 审核报告：material-editor 测试与生产源码（round24-2）

## 审核范围

| 项 | 文件 | 说明 |
|----|------|------|
| 测试文件 | `frontend/src/__tests__/material-editor.test.ts`（1277 行，`@ts-nocheck`） | 由 apply-all / cat-of / p1p2 / state 四个文件合并（commit a5ebc464，4→1，import 累加 201→164s），103 用例，24 个 describe |
| 共享 mock | `frontend/src/__tests__/material-editor-mocks.ts`（52 行）+ `mocks/babylon-factories.ts` / `babylon-classes.ts` | ADR-206 单一规范源，32 条 vi.mock |
| 被测源码 | `frontend/src/scene/manager/material.ts`（1082 行） | 材质编辑器核心：分类参数 / 逐材质参数 / 可见性 / alphaMul（ADR-221）/ PBR 分支（ADR-188）/ SSS 接线 |
| 间接依赖 | `scene/scene.ts:146-172`（re-export）、`material-sss.ts:14`（循环依赖见风险表）、`model-manager.ts:35,111`（disposeModelMaterialState / _applyAll 调用点）、`model-loader.ts:582,605`（_origAlpha 捕获）、`docs/adr/adr-015/188/221/206` | 消费者与覆盖核对 |

**总体结论：✅ 通过**（103/103 全绿；生产代码 0 处 `as any`/`@ts-ignore`；含 1 项 P2 重复代码建议 + 5 项 P3 观察）

## 亮点

- **NaN 防护形成闭环（`material.ts:102-113`）**：`_clampAndAssign` 对 `undefined`/`NaN`/`±Infinity` 统一跳过，注释明确解释 NaN 经 `Math.min/max` 传播会污染材质颜色且一旦写入状态 Map 便持续生效；测试 `material-editor.test.ts:1238-1277` 以 5 个用例逐项锁定（不写入 / 不污染颜色 / 不进 round 分支 / 不影响同次其它合法字段 / 不写入分类状态），是"修复 → 回归测试"的正面样板。
- **per-mat Partial 继承消除遮蔽（`material.ts:117-122,186-189` + 测试 `:408-418`）**：per-mat 仅存显式字段，`_mergedMatParams` 与分类参数合并，未设置字段继承 category——测试精确验证 `alphaMul 0.5` 不被 per-mat 的 DEFAULT 重置（`expect(mat.alpha).toBeCloseTo(0.9 * 0.5)`）。
- **状态流单一写入点（`material.ts:184-214`）**：`MaterialStateManager` 集中管理 `catState/matState/matEnabled` 三张 Map，`dispose(id)` 一处清理三张 Map + 委派 SSS，`resetMatEditorState`（测试 `:160-165`，round5 统一样板）与生产侧对称；`_catState/_matState/_matEnabled` 显式标注 `@internal` 仅供存量代码与测试。
- **原始值 WeakMap 无泄漏（`material.ts:181,393,445`）**：`_origValues` / `_catCache` / `_origPbrValues` 全部 WeakMap 键控材质，材质 dispose 后自动回收，无 observer 注册面。
- **断言真实验证应用结果**：`material-editor.test.ts:210`（specular 0.8×2=1.6）、`:256`（ambient 0.3×1.5=0.45）、`:393-395`（emissive 0.2/0.3/0.4 ×2）、`:770-776`（alphaMul×origAlpha×opacity=0.4）均为真实数学而非形式断言；MockStandardMaterial 的 `diffuseColor.set()` 真实改值（`babylon-classes.ts:487-523`），断言有效性有 mock 支撑。
- **merge 质量高**：合并后 24 个 describe 无重复、无冲突、无遗漏；`regModel`/`makeMockMat`/`cleanupModels`/`resetMatEditorState` 四个 helper 抽到文件顶部统一使用；边界覆盖完整（无材质/未知分类/部分参数/还原/NaN 五类齐备）；`.skip/.only/.todo` 零命中，103 用例全部真实执行。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | `frontend/src/scene/manager/material.ts` | `_applyMaterial` :530-600 vs `_applyCategory` :602-653 | 两个函数各自重复 PBR/Standard 双分支（捕获原始值 → 应用分类参数 → per-mat 合并再应用），约 60 行近乎逐行的复制粘贴；`setMatEnabled`（:695-716）与 `setMatCategoryEnabled`（:940-974）的可见性簿记（delete vs set + `matEnabled` 维护）同样重复 | 提取共享内部函数（如 `_applyOneMaterial(id, mi, catParams, alphaCtx)` 处理捕获+应用+per-mat 合并），分类批量循环只负责按 `categoryOfMaterial(m)===cat` 过滤后逐条调用；可见性簿记抽 `_setEnabledState(id, mi, enabled)` |
| 🟡 P3 | `frontend/src/scene/manager/material.ts:15` ↔ `material-sss.ts:14` | 循环依赖 | material.ts import material-sss（getMatSssState/applyMatSssState/disposeModelSssState），material-sss import material 的 `getMatCatGroups`（:126 运行时调用）。ESM 下因均为调用期引用而安全，但破坏分层清晰度 | 将 `getMatCatGroups` 下移或让 SSS 经回调注入分类分组；至少加注释声明双向依赖为调用期引用 |
| 🟡 P3 | `frontend/src/__tests__/material-editor.test.ts` | :177, :201, :224, :247, :271, :292, :304 等 | `_applyAll ordering` / P1 / P2 系列 describe 的 `modelRegistry.set(TEST_ID, { meshes: [...] })` 缺 `opacity` 字段；`setMatCatParams` 内部 `_alphaCtxFor(id)`（material.ts:675）返回 `opacity: undefined` → `finalAlpha = clamp01(o.alpha * undefined * …)` = NaN 写入 mock 材质。断言未查 alpha 故全绿，但 fixture 与生产（ModelInstance.opacity 必填）不一致，恰好绕过本文件主打的 NaN 防护 | 统一走 `regModel`（已默认 `opacity: 1`）或 fixture 显式补 `opacity: 1`；若目的是隔离 alpha 路径，用 `_applyAll(TEST_ID)`（无 alphaCtx）并注释说明 |
| 🟡 P3 | `frontend/src/__tests__/material-editor.test.ts` | vi.mock 列表 :43-90 | 未 mock `@babylonjs/core/Materials/PBR/pbrMaterial`，而生产 material.ts:7 import 真实 PBRMaterial 模块（model-preset.test.ts:105 已 mock）；与 library-core.test.ts:5「6 文件 vi.mock 列表完全同构」的说法不符。真实 PBR 模块被加载（本文件 import 11.7s 的主因之一），且本文件 PBR 分支零覆盖 | 补 `vi.mock('@babylonjs/core/Materials/PBR/pbrMaterial', () => mockPBRMaterial())` 与 model-preset 对齐，或修正"完全同构"注释 |
| 🟡 P3 | `frontend/src/__tests__/material-editor.test.ts` | :1041-1054 | `isPbrMaterial` 只有两个 false 用例（StandardMaterial / Material base），无 PBR 真值用例；`setMatCategoryEnabled` / `isMatCategoryAllEnabled`（scene.ts:166-167 导出）本文件与全仓均无直接测试（scene.test.ts 仅 vi.fn mock），`disposeModelMaterialState` 真实路径亦未覆盖 | 补 isPbrMaterial true 用例（MockPBRMaterial 已存在于 babylon-classes:692）+ 分类级可见性批量开关的最小契约用例 |
| 🟢 P4 | `frontend/src/scene/manager/material.ts` | :498 `(200 - p.shininess) / 200` | 200 与 CLAMP_RULES shininess max（:83）语义同源但未共享常量，改 clamp 上限时 PBR 粗糙度公式会静默漂移 | 引用 `CLAMP_RULES.shininess[1]` 或命名常量 `SHININESS_MAX` |
| 🟢 P4 | `frontend/src/__tests__/material-editor.test.ts` | :136, :176, :200… :435, :445… | 文件已 `@ts-nocheck`（:1 注释合理：vi.mock 运行时替换），但内部仍散布 `@ts-expect-error` 与 `(mat as any)`，在整文件关闭检查下为无效标注（仅文档价值） | 保留 `@ts-expect-error` 作意图标注可接受；`(mat as any)` 在 @ts-nocheck 下可删除，减少噪音 |
| 🟢 P4 | `frontend/src/__tests__/material-editor.test.ts` | :288-299, :497-528 | 测试名与行为轻微不符：「applies PBR alpha」实际走 StandardMaterial 路径（makeMockMat）；describe「resetMatCatParams restores P1+P2 values」体内实际调用 `resetSingleMatParams`（:511, :524），并非 resetMatCatParams | 改名 `applies alpha formula (fix P2)` 与 `resetSingleMatParams restores P1+P2 values`，避免误导读者 |
| 🟢 P4 | `frontend/src/__tests__/material-editor.test.ts` | :141-155, :118-124 | `cleanupModels` 硬编码部分 ID（`model_c`/`model_rm`/`model_as` 已含于 `startsWith('model')` 冗余）；`makeMockMat` 创建材质不 dispose（Mock 无真实 GPU 资源，WeakMap 亦不持有，无实际泄漏） | 冗余 ID 可删；dispose 一致性（:370/:1045/:1052 有、其余无）可统一，但优先级最低 |

## 测试质量评价

- **合并质量 — 优秀**：四个文件（apply-all 391 行 / cat-of 148 行 / p1p2 288 行 / state 510 行）合并为 1277 行单文件，header 注释交代动机（vitest isolate 下每文件独立构建 ~40 个 babylon mock 依赖图，import ~5s/文件 vs self ~100ms）；24 个 describe 分组与四文件主题一一对应，无重复 describe、无冲突、无遗漏；helper 抽取（resetMatEditorState 消除原 12 处内联样板，round5 注释追溯）与 `regModel` 默认 `opacity: 1` 的 fixture 设计均为合并副产品中的正面增量。实测 `npm run test -- src/__tests__/material-editor.test.ts` → **103/103 通过**（15.25s，其中 import 11.70s / 用例本体 93ms），与项目基线全绿一致。
- **断言有效性 — 良好**：核心 apply 路径断言真实数学值（diffuse/specular/ambient/emissive 乘率、alphaMul 三层公式、transparencyMode 双向切换、clamp 边界、NaN 防护、serialization 默认值过滤 `:1003-1009` 连 `_catState.has` 副作用都验证），非形式断言。
- **mock 合理性 — 良好但有 PBR 缺口**：32 条 vi.mock 全部来自 `babylon-factories.ts` 单一规范源（ADR-206），MockStandardMaterial 真实改值支撑断言；但未 mock pbrMaterial 使真实 PBR 模块被加载（P3），且 PBR 正分支/isPbrMaterial 真值/setMatCategoryEnabled 均无覆盖，依赖 model-preset.test.ts 间接兜底。
- **`@ts-nocheck` 符合项目测试卫生**：与 model-preset.test.ts 同模式，注释明确（vi.mock 运行时替换），符合 frontend/AGENTS.md 2.3 对 mock 重测试文件的惯例；生产代码 0 处 `as any`/`@ts-ignore`/`@ts-expect-error`（grep 全文件零命中）。
- **边界覆盖 — 全面**：无材质（:938/:960/:1201/:1227/:1233）、未知分类（:1003 含副作用断言）、部分参数（:408 per-mat 继承）、还原（resetSingleMatParams/resetPerMaterialParams/resetMatCatParams 三套）、NaN 五连（:1238-1277）齐备；唯一对称性缺口是 PBR 侧与分类级可见性侧。
- **无跳过测试**：grep `.skip(` / `.only(` / `.todo(` / `xit(` / `xdescribe(` 零命中。
- **总体**：测试质量高，合并无损、断言真实、边界完整，扣分项集中在 PBR/分类可见性覆盖缺口（P3）与若干 fixture/命名小瑕疵（P4）。

## 审核员备注

- 依赖分析：`material.ts` 上游 `@/core/config`、`@/core/clamp`（ADR-191 叶子）、`core/logger`、`material-sss`（循环依赖见风险表）；下游 `model-manager.ts:35,111`、`scene-serialize.ts:75,804,913` 为真实生产消费者。
- 资源释放：模块无 `new` 需 dispose 的对象（WeakMap 自动回收），无 observer 泄漏面；测试 Mock 无真实资源。
- `npm run check` 未执行：本审核只读不改码，`tsc` 结果不影响结论（文件级 vitest 已实测全绿）；如需可在主模型汇总轮补跑。

---

审核日期：2026-08-15
审核员：子代理 round24-material-editor
