# [round20] Schema Snapshot Generator — 审核结果

**审核范围：** 测试文件 `frontend/src/__tests__/schema-snapshot.test.ts`（453 行）及其守护目标：
Schema Snapshot Generator（menu-registry 全量 schema → 纯数据 JSON `frontend/e2e/schema-snapshot.json`，供 `e2e/schema-driven.spec.ts` 消费）。涉及生产代码：`frontend/src/menus/menu-schema-register.ts`、`frontend/src/menus/menu-registry.ts`、`frontend/src/core/dom-contract.ts`、`frontend/src/menus/menu-schema.ts`、`frontend/src/scene/shared/menu-node-types.ts`，以及共享 mock 工厂 `frontend/src/__tests__/menu-schema-mocks.ts`。

**总体结论：⚠️ 有条件通过**

测试本身断言有效、无跳过、确定性经实测成立（运行前后快照 SHA256 完全一致），守护机制（builder 失败显式红、nav/dom/action 完整性断言）设计优秀。但存在 1 个 P2：约 150 行 mock 与共享工厂 `menu-schema-mocks.ts` 完全重复且两处注释互相矛盾，违反 AGENTS.md 测试卫生铁律「同模块 mock 形状保持超集一致，禁止各自内联出差异化形状」——建议切换共享工厂后通过。

**实测验证（2026-08-15）：**
- `npm run test -- src/__tests__/schema-snapshot.test.ts`：2 tests passed（33ms 运行 + 14s import），exit=0
- 运行前后 `frontend/e2e/schema-snapshot.json` SHA256 均为 `04CB2DB6...44C19D`，**无文件变更**（git status 干净）——确定性成立
- `npm run check`：通过（i18n parity 1870 keys，5 语言全对齐）
- 快照统计：16 面板 / 197 节点 / 160 bind 路径 / 186 i18n label

---

## 亮点

| # | 模式 | 位置 |
|---|------|------|
| 1 | **builder 失败显式红，杜绝快照静默缩水**：ADR-229 审核修正将「DEV warn 后跳过」改为 `failed` 列表 + `expect(failed).toEqual([])`，面板从快照消失时测试直接失败而非 E2E 全绿 | schema-snapshot.test.ts:335-339 + menu-registry.ts:68-82 |
| 2 | **nav 完整性断言覆盖全部 16 面板**：settings 域强制 `subLevel2TestId`、其他域强制 `subLevelTestId`、entryTestId 强制 truthy，新增面板忘特例覆写立即红 | schema-snapshot.test.ts:351-362 |
| 3 | **DOM 契约单源（ADR-229 §9）**：快照携带 `nodes[].dom` 与 `panel.meta`（源自 `dom-contract.ts`），e2e 不再手写 KIND_SELECTOR_MAP；渲染层改 role/class 未同步 → 快照 diff 触发 CI 门禁 | schema-snapshot.test.ts:212,253-257,364-377 + dom-contract.ts:1-7 |
| 4 | **action 完整性断言**：slider/toggle/modeSlider 必须有策略描述，deriveAction 漏分支立即失败 | schema-snapshot.test.ts:379-392 |
| 5 | **cleanNode 序列化克制且有据**：conditional 标记（visibleWhen 节点 e2e 降级）、transformed 标记（get/set 变换值域）、action 存策略而非静态目标值（运行时初始值不可预知），每字段取舍均有 ADR 注释 | schema-snapshot.test.ts:259-305 |
| 6 | **注册表驱动自动覆盖**：新面板在 menu-schema-register.ts 加一行 registerSchema 即自动入快照（collectAllSchemasWithFailures 遍历整个 registry Map），零 E2E 维护成本 | menu-schema-register.ts:31-77 + menu-registry.ts:68-82 |
| 7 | **flattenNodes 泛型单实现**：元测试与 e2e 复用同一份扁平化实现（泛型服务 MenuNode 树与纯数据节点树），注释明示「勿再抄本地副本」 | menu-registry.ts:94-106 |
| 8 | **读回验证 + 统计输出**：写后 readFileSync + JSON.parse + 非空断言 + 面板/节点/bind/label 统计 console 输出 | schema-snapshot.test.ts:394-414 |

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | schema-snapshot.test.ts | 24-199（DEFAULT_RENDER_STATE/DEFAULT_PERCEPTION_STATE 61 行 + 19 个 vi.mock 约 90 行） | **mock 与共享工厂全量重复**：`menu-schema-mocks.ts` 已提供逐字相同的 `mockCoreConfig/mockCoreAsync/mockScene/mockRenderer` 等全部工厂，且其 117 行注释明确「新增工厂：供 schema-snapshot.test.ts 等使用」，但本文件完全内联、零引用。两处注释互相矛盾（本文件 15-16 行说「通用 mock 工厂见 menu-schema-mocks.ts」却未用；mocks 说「供本文件使用」却未被用）。违反 AGENTS.md「同模块 mock 形状保持超集一致，禁止各自内联出差异化形状」。已出现形状分化：内联 `mockScene` 缺 superset 字段（focusedModelId/modelManager/getModelMorphs 等），内联 `mockPerception` 缺 getPerceptionStateFor/setPerceptionStateFor——未来 builder 用到即 undefined 报错，而共享工厂不受影响 | 切换到共享工厂：`vi.mock('@/scene/scene', () => mockScene())` 等，删除内联常量与 vi.mock 块；仅保留本测试需要的差异化覆写（如共享 `mockScene().getRenderState` 返回 DEFAULT_RENDER_STATE 已一致，无需覆写）。或反之删除 menu-schema-mocks.ts 中"供 schema-snapshot.test.ts 使用"的注释，消除矛盾 |
| 🟡 P3 | schema-snapshot.test.ts | 341-414 | **测试自身不比对「已入库快照」**：只 writeFileSync 覆盖写入 + 读回非空断言，不与已提交的 e2e/schema-snapshot.json 深度比对。ADR-229 §2.4 已明示此局限——新鲜度完全依赖 CI 的「重生成 + git diff --exit-code」门禁，本地跑测试永远绿（schema 变更后快照过期不报）。本地开发时新增/改 schema 易产出过期快照 | 在测试内追加「读入已入库 JSON，与刚生成的 snapshot 深度相等断言，不等则失败并提示 `npm run test -- ...` 重生成后提交」——将漂移门禁从 CI 前移到本地测试；或在文件头注释显著标注「本测试不校验快照新鲜度，依赖 CI 门禁」 |
| 🟡 P3 | schema-snapshot.test.ts | 331-333 | **确定性无自证**：输出确定性依赖 registry Map 插入顺序（= 注册顺序，稳定）与 builder 纯函数性（mock 状态常量）。当前实测确定性成立（SHA256 一致），但 builder 若未来读取真实全局状态（Date.now/随机数/未 mock 的模块状态），快照会不稳定且测试不察觉 | 低成本自证：在测试内对 `collectAllSchemasWithFailures()` 连续调用两次，断言两次 `JSON.stringify` 结果相等——确定性回归即刻可见 |
| 🟡 P3 | schema-snapshot.test.ts | 运行 stderr | **i18n 警告噪音 + 环境耦合**：测试环境未预载 i18n bundle，`t()` 回退 key 本身（env.exp2/env.exp/env.linear/env.hardShadow/env.softShadow/env.pcf 6 条警告）。已核实这些 key 在 zh-CN.ts 存在且 parity 检查通过——**非漏译，是测试环境未 loadLocale**。快照 label 因此存 i18n key（设计上合理，e2e 只断言存在性），但若未来 setup 预载 bundle 或 t() fallback 行为改变，快照内容会静默变化 | vitest setup 预载 zh-CN bundle（或显式 `vi.mock('@/core/i18n/t', () => ({ t: (k) => k }))`），消除 stderr 噪音并锁定确定性 |
| 🟢 P4 | schema-snapshot.test.ts | 260-325, 401-453 | **any 泛滥**：cleanNode/deriveAction/count*/reduce 回调全部 `node: any`。虽为测试文件，但 MenuNode 类型完整存在（menu-node-types.ts:52-81），cleanNode 入参本可类型化。当前无类型约束保障「MenuNode 新增字段默认被 cleanNode 遗漏」——本次核对：defaultOpen/conflictHint/modelId/actionId/renderCustom/control.get-set-onChange/headerToggle.get-set-onChange 均未序列化（有意裁剪，e2e 不需要），但全靠人工记忆 | 定义 `SerializedNode` 纯数据接口 + `cleanNode(node: MenuNode): SerializedNode`，编译期强制「新增字段要么序列化要么显式排除」，并加注释说明裁剪理由 |
| 🟢 P4 | schema-snapshot.test.ts | 233 | `domainRaw as 'env'|'motion'|'settings'|'scene'` 为类型逃生断言：panelId 前缀若新增未知域（如 'foo:bar'），domain 被断言为合法类型，靠后续 entryTestId truthy 断言兜底（行为正确但类型不诚实） | 改为运行期校验：未知前缀时返回 undefined domain，由 nav 断言失败并给出「未知 domain 前缀」的清晰错误信息 |
| 🟢 P4 | schema-snapshot.test.ts | 289 | `options.map((o) => ({ value, label }))`：options 项缺 label 时产出 `label: undefined` 被 JSON.stringify 静默丢弃，countLabels 统计（439-453）只数含 '.' 的 label，无断言保护 | 若 options 项必须带 label，可在快照生成时断言；或明确注释「label 可选，缺省不序列化」 |

---

## 测试质量评价

- **断言有效性：强。** 不是「只验证文件存在」——生成 it 内包含三层内容级断言：① nav 完整性（逐面板字段级）；② dom 契约完整性（flatten 全部节点，kind 命中 KIND_CONTROL_SELECTOR 的必须携带且值相等）；③ action 完整性（slider/toggle/modeSlider 必须有策略）。读回断言（Array.isArray + length>0）只是最后一道，且伴随真实 JSON.parse（防写出坏 JSON）。统计输出（面板/节点/bind/label）为可读性加分。
- **mock 合理性：较重但有据，未复用共享工厂是硬伤。** 文件头注释自述「mock 需求较重（需完整状态数据），故保持内联」——理由成立（16 面板 builder 需完整 envState/uiState/render/perception 状态），19 个模块的 mock 覆盖面实测足以支撑全量 builder 执行。但共享工厂 `menu-schema-mocks.ts` 已存在且逐字等价，两处注释互相声称对方为事实，属未完成的迁移（P2）。按 AGENTS.md 铁律应切换，而非继续内联。
- **边界覆盖：良好。** 无 schema 注册场景由读回 length>0 隐式兜底；部分 builder 失败由 failed 断言显式覆盖（menu-registry 的 try/catch + translateGoError 错误翻译，失败信息可读）；conditional 节点标记入快照（实测 env:sky:color-top conditional:true）。
- **跳过测试：0。** grep 确认无 `.skip`/`.only`/`xit`/`xdescribe`。
- **资源释放：无泄漏。** writeFileSync/readFileSync 同步 API 无句柄问题；mkdirSync({ recursive: true }) 正确处理目录创建。
- **运行副作用：无。** 实测运行后 e2e/schema-snapshot.json 与 git 工作区均无变更（SHA256 一致），符合「生成物入库 + 确定性」设计。

---

审核日期：2026-08-15
审核员：子代理 round20-schema-snapshot
