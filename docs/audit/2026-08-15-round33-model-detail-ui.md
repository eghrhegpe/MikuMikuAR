# 第 33 轮审核（子代理 3/3）— model-detail-ui（模型详情 UI：信息 / 模型操作 / tags+morph）

**审核范围：**
- 测试文件：`frontend/src/__tests__/model-detail-ui.test.ts`（271 行，13 用例；info / model / tags-morph 3 文件合并，commit `bbad1430`）
- 被测源码：`frontend/src/menus/model-detail.ts`（1534 行）
  - `buildModelLevel`：627-640（schema：`buildModelSchema` 294-433）
  - `buildModelInfoLevel`：868-881（schema：`buildModelInfoSchema` 716-866）
  - `buildModelTagsLevel`：1083-1096（schema：`buildModelTagsSchema` 885-1081）
  - `buildMorphPreviewLevel`：1193-1202（schema：`buildMorphPreviewSchema` 1100-1191）
- 关联依赖（只读核对）：`model-detail-ui-helpers.ts`（94 行）、`model-detail-ui-mocks.ts`（154 行）、`model-preset-mocks.ts`（47 行，ADR-206 薄 shim）、`mocks/scene-superset.ts`、`mocks/babylon-factories.ts`、`scene/manager/model-ops.ts:257-271`（真实模块，经 mock scene 走 seam）、`core/i18n/t.ts`（运行时加载）、`core/i18n/locales/zh-CN.ts`（断言键核对）
- 验证：`cd frontend && npm run test -- src/__tests__/model-detail-ui.test.ts` → **13/13 通过**（import 13.04s / tests 78ms）。`npm run check` 未跑（全量 tsc 耗时长，且本审核无代码改动，基线全绿声明采信）
- 符号核实优先级：源码 > ADR-204（拆分/合并动机与验收）> knowledge/model-detail.md > function-map，均已核对

**总体结论：⚠️ 有条件通过**

生产源码质量高（无 `as any`/`@ts-ignore`、空状态引导齐全、异步回调有 isConnected 守卫、[audit-fix] 材质计数回归有测试成对保护），测试合并干净（44 条 mock 三文件完全同构、13 用例守恒）；但存在 1 处 P2（tags 收藏行读取路径无错误处理 → 后端失败时 unhandled rejection + 整行空白无反馈）、1 处 P3 状态同步缺口（picker 已选标签视觉不刷新）、若干 P3/P4 边界覆盖与文档漂移，建议修复后转正。

---

## 与既往审核的关系（专项核对）

| 既往报告 | 范围 | 与本次关系 |
|----------|------|-----------|
| `2026-08-06-round14-go-backend-ui-core.md`（round-14「UI 剩余 8」） | model-detail / model-preset / outfit-ui / nav-actions 等 | 已审 model-detail.ts 整体，结论「无 P1；P2×4（close 未清 timer、unpin 残留 VMD、loadOutfits null 竞态、disposeNavBindings 零调用）」。4 项 P2 均不在本次 4 个 build*Level 的职责线内（属 motion-slot/preset/outfit/nav），本次范围无遗留阻塞项 ✅ |
| `2026-08-15-round25-outfit.md`（round-25，实为 outfit 模块） | `scene/manager/outfit.ts`（loadOutfits/applyOutfitVariant/resetOutfit） | 与 model-detail.ts 相关：`buildModelSchema:39,368-371` 消费 `buildOutfitLevel`；round-25 的 P2（reset 与 in-flight apply 竞态）位于 outfit.ts，不在本次 4 个 build*Level 内，但影响经 `buildModelSchema` 渲染的换装入口，建议主模型跟踪其修复。注：任务书称「round-25 审过 model-preset 等」——经核对，model-preset 属 round-14「UI 剩余」覆盖，round-25 三份报告（lipsync/env-state/outfit）未审 model-preset，此处按核实事实记录 |
| `2026-08-15-round21-proc-motion-migrate.md` | P4：model-detail.ts:101 `{ ...DEFAULT_PROC_STATE }` 浅拷贝共享 params 引用 | 仍在，属 `buildModelSchema` 动作区（本次测试只冒烟），非本次风险 |
| `2026-08-15-round24-material-editor.md` | P3：真实 Babylon 模块（PBR）未被 mock、被加载拖慢 import | 与本次 P3-4 同模式（spotLight/meshBuilder 未被 mock，见风险表） |

---

## 亮点

| 模式 | 位置 | 说明 |
|------|------|------|
| 材质计数审计修复 + 回归测试成对 | `model-detail.ts:773-779` ↔ `test.ts:166-184` | 「材质数以 PMX 材质列表为准，非 Babylon 网格数」的 [audit-fix] 有专门用例（7 材质 vs 1 网格）成对保护，是本次测试中**最真实的数据正确性断言** |
| 无模型 fallback 统一契约 | `model-detail.ts:630 / 871 / 1086` + `test.ts:139-142,197-200,242-245` | 三层级缺失模型时统一 `{label, dir:'', items:[]}` 降级，测试均覆盖 |
| 异步回调 isConnected 守卫 | `model-detail.ts:906,912,949,962,993,1002` | tags schema 所有异步 `.then` 回调先查 `container.isConnected`，detach 后不再改 DOM（防快速切换时旧闭包写屏） |
| 空状态引导齐全 | `model-detail.ts:1178-1183`（morph-empty+提示）、`:944,1008`（noPath）、`:789-796`（loading/空 comment） | 三处空态均有文案与提示，无「空白界面」 |
| 错误处理分层得当（除 P2 一处） | `model-detail.ts:763,977-979,991,915` | info 异步 catch→logWarn、tags 列表 catch→错误文案、picker 用 safeCallAsync、onclick 用 tryCatchStatus |
| 合并质量经 git 实证 | `bbad1430` | 旧 3 文件 vi.mock 均为 **44 条且完全同构**（git show 逐一核对），合并后 44 条去重一次付；用例 4+5+4=13 守恒；describe 按原主题分区保留；文件头 [doc:perf] 注释动机与先例引用准确 |
| mock 单源化 | `model-detail-ui-mocks.ts:10-19` + `model-preset-mocks.ts:8-43` | Babylon/BMD 工厂全部 re-export 自 `babylon-factories.ts`（单一规范源，ADR-206），应用桩与 `scene-superset.mockModelManagerBase` 同构，符合 frontend/AGENTS.md 2.3 |
| 测试规避真实后端调用 | `test.ts:151-154` | 预填 `modelMetaCache` 使 `modelMetaCache.has()` 命中，跳过 `GetModelMetaBatch` Wails 调用——无需 mock wails-bindings 即可测试 info 渲染 |
| i18n 运行时加载测试适配 | `test.ts:57-59` | `beforeAll` 预填 `bundles['zh-CN']`，与 t.ts 运行时加载设计（t.ts:9,23-37）对齐，断言真实语言键（'模型信息'/'未知模型'/'模型标签'/'表情预览'） |
| 真实 seam 而非整模块 mock | `model-ops.ts:257-271` ↔ `scene-superset.ts:27-30` | morph 三函数走**真实** model-ops，经 mock scene 的 `getMorphs/setMorphWeight/resetMorphs` 打桩——L2 集成层正确切法 |
| dispose 链可回收 | `render-menu.ts:26-35` | `renderMenu` 返回级联 dispose，4 个 build*Level 的 renderCustom 均经它渲染，层级退出可释放资源 |

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 高 P2 | `frontend/src/menus/model-detail.ts` | 901-928（refreshFav） | **收藏行读取路径无错误处理**：`await GetTagsByModel(libRef)`（905）无 `.catch`、`refreshFav()`（927）裸调用。后端失败时产生 unhandled promise rejection，且 favRow 的 innerHTML/onclick **仅在成功后**才写入（910-925）——失败则整行空白、无任何反馈、点击无效。对比同文件：refreshTags 有 `.catch` 错误文案（977-979）、onclick 有 tryCatchStatus（915）——此处是 tags 区唯一裸 Promise | 用 `tryCatchStatus(async () => {...}, t('model-detail.favFailed'))` 包裹读取，或 `.catch` 在 favRow 内写失败文案 + 保留重试入口（与 915 行兄弟路径对齐） |
| 🟡 中 P3 | `frontend/src/menus/model-detail.ts` | 1031-1061（picker chip）+ 970,1038,1050（仅 refreshTags） | **picker 已选状态不同步**：AddTag/RemoveTag 成功后仅 `refreshTags()` 刷新 tagContainer，picker 的 `assigned` 闭包集（996）不更新 → chip 的 ✓/`+` 文案与边框样式（1022-1027）停留在旧态，直到重进层级；重复点击可重复 AddTag（后端幂等性未知） | chip 操作后同步更新 `assigned` 并就地重绘该 chip（或整段重渲 picker）；与 tagContainer 刷新联动 |
| 🟡 中 P3 | `frontend/src/menus/model-detail.ts` | 734-763（info 异步 comment 更新） | **isConnected 守卫缺失不一致**：GetModelMetaBatch `.then` 回调不查 `container.isConnected`（tags schema 6 处均有）。快速切换模型后旧闭包仍对已 detach 容器做 querySelector/改值——实际无害（detached DOM 不可见），但与兄弟代码约定不一致，且若未来容器被复用有写错屏风险 | 与 tags 对齐：`.then` 首行加 `if (!container.isConnected) return;` |
| 🟡 中 P3 | `frontend/src/__tests__/model-detail-ui.test.ts` | 61-118（vi.mock 列表） | **mock 缺口：真实 Babylon 模块仍被加载**。`lighting-follow.ts:7,10` import 的 `spotLight`/`meshBuilder` 不在 44 条 mock 内（经 model-detail.ts:44-49 传递加载）；实测本文件 import 13.04s（文件头 [doc:perf] 称 ~5s/文件→3.3s，口径已过时）。真实模块能加载成功（未实例化）故测试绿，但属 round-24 material-editor P3 同款「mock 全量言过其实」模式，拖慢单文件 import | 补 `vi.mock('@babylonjs/core/Lights/spotLight', ...)` + `@babylonjs/core/Meshes/meshBuilder`（工厂若缺则补进 babylon-factories.ts），并核对/修正文件头 import 耗时注释 |
| 🟡 中 P3 | `frontend/src/__tests__/model-detail-ui.test.ts` | 131-271 | **边界覆盖缺口**（ADR-204 §2.3 UI builder 冒烟豁免内，但可补强）：morphs 非空滑块路径（slider/input→setModelMorphWeight spy、type 标签）、morph 重置按钮、tags renderCustom 全部交互（fav 切换/chip 删除/picker 增删/noPath 分支）、info 异步 comment 更新路径、快速切换模型 —— 均无用例 | 优先补 2 条高价值：①「morphs 非空 → 渲染 slider 且 input 触发 setModelMorphWeight」；②「tags chip 删除 → RemoveTag 被调 + 状态刷新」（覆盖 P3-2 修复后行为） |
| 🟢 低 P4 | `frontend/src/menus/model-detail.ts` | 777 | `m as unknown as { materials?: readonly unknown[] }` 双重 cast（有 [audit-fix] 注释背书，非 `any`） | 用 `'materials' in m` 收窄替代，或定义 `interface MmdMeshLike { materials?: ... }` 类型谓词 |
| 🟢 低 P4 | `frontend/src/menus/model-detail.ts` | 1159-1170 | morph slider `max='1'`（PMX 部分 morph 权重语义可 >1）；`parseFloat` 无 NaN 防御（range 输入实际保证合法，风险低） | 若产品接受 >1 权重则放宽 max（或按 morph 类型给上限）；parseFloat 后 `Number.isFinite` 防御 |
| 🟢 低 P4 | `frontend/src/menus/model-detail.ts` | 901-911 | favRow 的 onclick 在 `GetTagsByModel` resolve 后才挂载 → 首帧存在点击死区（后端慢时明显） | 先挂 `onclick`（内部先查 libRef/isConnected）再异步刷新文案，或加骨架占位 |
| 🟢 低 P4 | `frontend/src/__tests__/model-detail-ui.test.ts` | 161 | 断言 `toLocaleString()` 输出 `'1,000'`，依赖 Node ICU 默认 locale（zh-CN/en-US 恒过，de-DE 等会红） | 断言前固定 locale 或改为数字语义断言（`includes('1')` 或正则 `/1[,.]000/`） |
| 🟢 低 P4 | `frontend/src/__tests__/model-detail-ui.test.ts` | 139-142 | fallback 用例仅断言 label='模型信息'——与 existing 模型 label **相同**，无法区分两条路径；未断言 fallback 无 renderCustom | 补 `expect(hasRenderCustom(level)).toBe(false)`（info 是四层级中唯一 fallback label 与正常态相同的） |
| 🟢 低 P4 | `docs/knowledge/model-detail.md` | 24-27 | **文档漂移**：tests 段仍列 3 个已删除的拆分文件（`model-detail-ui.info/model/tags-morph.test.ts`），合并 commit `bbad1430`（2026-08-10）后未更新 | 改为 `frontend/src/__tests__/model-detail-ui.test.ts`（合并后） |

---

## 测试质量评价

### 合并质量 —— 干净 ✅（git 实证）
`bbad1430`（refactor(test): model-detail-ui 3 文件合并为 1，import 累加 201s→184s）：删除 `model-detail-ui.model.test.ts`(166 行) / `model-detail-ui.tags-morph.test.ts`(160 行)，`model-detail-ui.info.test.ts` 改名并扩至 271 行。`git show bbad1430^:` 逐一核对：旧 3 文件 vi.mock 均 **44 条、列表完全同构**（文件头「三文件 mock 列表完全同构」声明成立）；用例 4+5+4=**13**，合并后 13 条逐条保留、无丢失无重复；describe 按原主题（info/model/tags-morph）分区保留，行为不变声明成立；性能动机（isolate 下每文件付一次依赖图）与 perception 先例 `682b1ba4` 引用准确。唯一瑕疵：性能数字口径已过时（实测单文件 import 13.04s，见 P3-4）。

### mock 合理性 —— 良好，1 处缺口 ⚠️
- 44 条 vi.mock（~36 条 Babylon/babylon-mmd + 8 条应用级）全部来自单一规范源：Babylon/BMD 经 `model-preset-mocks.ts` re-export `babylon-factories.ts`（ADR-206），应用桩（scene/scene-menu/outfit/lipsync/procedural-motion/beat-detector/audio）经 `scene-superset` 同构，符合 frontend/AGENTS.md 2.3「共享工厂优先、禁止内联差异化形状」。
- 无 `vi.importActual` 静态化陷阱、无 hoist TDZ（工厂均同步 + 静态 import，mocks 导入先于 SUT——ADR-204 P3 标准配方）；`mockModelManager` 普通 const 单例 + `cleanup()` 仅 `mockReset(get)` 保留其余默认实现（helpers.ts:83-90 注释解释清晰）。
- 缺口：`spotLight`/`meshBuilder` 未 mock（真实 Babylon 模块被传递加载），见 P3-4。

### 断言有效性 —— 中上 ⚠️
- **强**：`materials vs mesh 计数`（test.ts:166-184，7 材质 vs 1 网格，直接保护 [audit-fix]）；info 字段真实数据流（'1,000'/'20'/'10'，test.ts:161-163）；label 断言全部走真实 i18n 键（beforeAll 预填 bundles，验证 zh-CN 文案而非 mock 桩文案）；`items` 空数组契约（test.ts:239）。
- **弱**：`buildModelInfoLevel` fallback 与正常态 label 相同、未断言 renderCustom 缺失（P4-10）；tags 两用例只验 label/items，renderCustom 完全未执行（P3-5）；morph 用例只覆盖空态，slider/重置/权重写回零断言；`hasRenderCustom` 多为真值冒烟。均属 ADR-204 §2.3「UI builder 少量集成冒烟」豁免范畴，但 tags 交互是核心功能，建议至少补 1 条。

### 边界覆盖 —— 良好，集中在空态与 fallback ⚠️
无模型 fallback（3 层级）✅；空 tags（items=[]）✅；空 morphs（`.morph-list` + `.morph-empty` 存在）✅；材质数组（7 vs 1）✅；渲染不抛异常（morph renderCustom not.toThrow）✅。**无 skip/todo/only**（grep 确认 0 处）。缺口：快速切换模型（isConnected 守卫行为）、morphs 非空、tags 交互、info 异步路径（见 P3-5）。

### 未覆盖（对应 P3-5）
morphs 非空滑块与权重写回、morph 重置按钮、tags fav/chips/picker/noPath 交互、info 异步 comment 更新、快速模型切换。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round33-model-detail-ui
