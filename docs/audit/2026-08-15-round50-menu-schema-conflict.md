# round-50 menu-schema-conflict — conflictHint 冲突标记专项审核报告

> 审核员：子代理 round50-menu-schema-conflict（第 50 轮第 2 个测试）
> 审核日期：2026-08-15

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/menu-schema.conflict.test.ts`（73 行，2 用例）— conflictHint 冲突标记（ADR-163 §2.5.2，拆自 menu-schema.test.ts 的独立文件） |
| 被测源码 | `frontend/src/menus/render-menu.ts:167-184`（renderSlider 内 conflictHint 冲突标记块：查询 + 图标插入）、`:20`（focusedModelId 模块级活绑定导入）、`:26-39`（renderMenu 分发）；`frontend/src/scene/motion/motion-modules/registry.ts:279-301`（BoneConflict 类型 + getModuleConflicts loser 视角过滤）、`:303-328`（getAllConflicts/getConflictCount）；类型契约 `frontend/src/scene/shared/menu-node-types.ts:76`（MenuNode.conflictHint 字段）；联动 `frontend/src/core/icons.ts:12-21`（createIconifyIcon）、`frontend/src/core/ui-rows.ts:149-188`（addSliderRow `.cs-top` 结构）、`frontend/src/core/i18n/t.ts:54-99`（缺失 key 回退链） |
| 测试 mock 工厂 | `frontend/src/__tests__/menu-schema-mocks.ts:109-115`（mockRegistry：getModuleConflicts 默认 `vi.fn(() => [])`） |
| 运行验证 | `cd frontend && npm run test -- src/__tests__/menu-schema.conflict.test.ts` → **2/2 通过**（312ms，基线全绿）。stderr 实证 i18n 缺口：`[i18n] key "motion.conflictHint" not found in zh-CN base bundle — possible typo`（用例 1）。`npm run check`（全量 tsc）未执行（与测试无关、耗时较长，跳过并在本报告注明）。 |
| 历史关系 | ① **round-37**（`2026-08-15-round37-menu-schema.md`）审的合并主测试 `menu-schema.test.ts`（850 行/32 用例）文件头注释（L1-6）已记录 conflict 文件因依赖 `vi.resetModules` 文件级隔离而保留独立——本测试即该独立文件，与主测试互补不重叠；② **round-43**（`2026-08-15-round43-perception-multi-model.md`）报告的 P2-2「冲突 banner 恒显感知层内部子模块冲突」（motion-gaze-levels.ts banner 无内部冲突过滤）与本测试共享 `getModuleConflicts` 查询与 ADR-163 可视化闭环——本测试的滑块 conflictHint 标记是**同一根因的第二表现面**（详见 P3-2）；③ **round-46**（`2026-08-15-round46-menu-schema-motion-module.md`）审的 motion-module 测试与本测试同为「vi.resetModules + vi.doMock('@/core/state') + 动态 import」隔离模式，round-46 判该模式合规，本测试同款；④ **round-49**（`2026-08-15-round49-menu-schema-modelid.md`）审 modelId 覆写（⚠️ 有条件通过，modelId 覆写通路零覆盖 P3）——本测试的 focusedModelId 是 conflictHint 查询的模型来源，但两者主题不同（modelId 显式覆写 vs conflictHint 标记），无重叠。 |

## 二、总体结论

⚠️ **有条件通过**（0 个 P1 / 0 个 P2 / 5 个 P3 / 4 个 P4）。

核心两态（有冲突→警告图标、无冲突→无图标）覆盖真实、mock 隔离模式合规（与 round-46 同款、符合 AGENTS.md §2.3 铁律）、测试运行实测通过。但发现 2 个**生产缺陷**与 1 个**测试掩盖缺陷**，均在本次被测特性（conflictHint 标记）的主链路上：

1. **`motion.conflictHint` i18n key 五语言包全缺**（`t.ts` 回退链返回原始 key）→ 生产 hover 警告图标 title 显示字面量 `"motion.conflictHint"` 而非人类可读文案（ADR-163 §2.5.2「tooltip 显示被覆写说明」未落地）；测试用例 1 只断言 `title` truthy，恰好掩盖该缺陷（测试 stderr 已实证缺失告警）。
2. **滑块 conflictHint 与 round-43 P2-2 同根因**：`render-menu.ts:168-184` 与 banner 共享 `getModuleConflicts`，无感知层内部冲突过滤 → 生产 `motion-gaze-levels.ts:234` 的 breath 滑块（被 gaze.head 以 92<93 抢占 首/頭）**恒显警告图标**，「无冲突不显示」分支（本测试用例 2）对感知层滑块生产不可达。
3. `render-menu.ts:171` 用 `container.lastElementChild` 反查刚渲染的行，隐式耦合 addSliderRow 的同步 append 顺序，测试仅单节点 schema 未暴露该脆弱性。

## 三、亮点

- **隔离模式正确且自解释**（`menu-schema.conflict.test.ts:15-23,26-30`）：beforeEach `vi.resetModules()` + 用例内 `vi.doMock('@/core/state', async (importOriginal) => ({ ...actual, focusedModelId: TEST_MID }))` + 动态 `await import` 取重置后实例；`afterEach` 对称 `vi.doUnmock('@/core/state')`。`importOriginal` spread 原样保留（非静态化超集，符合 AGENTS.md §2.3「async importOriginal spread 禁静态化」铁律），`doMock` 运行期执行无 hoist TDZ 问题；文件头注释（L1-2）如实说明依赖 resetModules 隔离的原因——与 round-46 判合规的模式逐条吻合。
- **共享 mock 工厂复用**（`menu-schema-mocks.ts:109-115`）：4 条顶层 `vi.mock` 全部经共享工厂构造（mockScene 扩展自 sceneMockSuperset），无内联差异化 mock，规避 round-20 schema-snapshot 同类问题；`mockRegistry.getModuleConflicts` 默认 `vi.fn(() => [])` 与真实模块默认无冲突语义一致。
- **两态断言与 DOM 结构对应真实**（`menu-schema.conflict.test.ts:43-48,69-71`）：用例 1 断言 `iconify-icon` 存在 + icon 属性 + title（验证 render-menu.ts:174-180 的 createIconifyIcon → setAttribute('icon') → title 全链路）；用例 2 断言 `querySelector('iconify-icon')` 为 null——经核实 `ui-rows.ts:175`（`if (icon)` 缺省不生成图标）与 `render-menu.ts:170`（`conflicts.length > 0` 守卫）后成立，非空断言是安全的。
- **测试用例命名名实相符**（`:25/:51`）：「shows warning icon when module conflicts exist」「no icon when no conflicts」各对应生产 `render-menu.ts:170`（length>0）与 `:168-170`（falsy 短路 + length=0）分支，无「只断言容器非空」式弱用例。
- **生产 conflictHint 链路状态流单一**：`menu-node-types.ts:76` 类型契约（`conflictHint?: string`）→ `render-menu.ts:168-184` 查询渲染 → `registry.ts:291-301` 纯函数过滤（loser 视角 filter + 字段映射）→ `bone-override-store.ts:285-287`（`getConflicts` 返回副本防外部 mutate）。无幽灵路径；`registry.ts:291-301` 每次菜单刷新重算与 ADR-163 开放问题 #2「当前设计是每次菜单刷新时重算」一致。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | render-menu.ts + core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts | :179 / 全包 | **`motion.conflictHint` i18n key 五语言包全缺**：`t('motion.conflictHint', { module })` 走 `t.ts:66` 回退链返回 key 本身，且 params 替换（`t.ts:92-97`）在 key 字符串中无 `{module}` 占位符不生效 → warnIcon.title 恒为字面量 `"motion.conflictHint"`，用户 hover 看到乱码；ADR-163 §2.5.2「tooltip 显示被 Bone Override 覆写」交付物实际未完成；测试运行 stderr 实证 `[i18n] key "motion.conflictHint" not found`。生产构建下 DEV 告警被 tree-shake（`t.ts:44`），无任何提示 | 五语言包补 `motion.conflictHint` key（如 zh-CN「骨骼被 {module} 抢占」）；测试用例 1 将 `title` 从 truthy 升级为 `toContain('perception.gaze.head')` 或直接断言翻译后文案，锁死回退缺陷回归 |
| 🟡 P3 | render-menu.ts + motion-gaze-levels.ts | :168-184 / :141,:234,:341 | **滑块 conflictHint 无感知层内部冲突过滤，与 round-43 P2-2 同根因第二表现面**：滑块与 banner 共享 `getModuleConflicts`（`registry.ts:291-301`），感知层内部优先级重叠（gaze.head=92 < breath=93 重叠 首/頭/head/Head）→ 生产 `motion-gaze-levels.ts:234` 的 breath 滑块（conflictHint='perception.breath'）恒显警告图标，ADR-163「感知层 vs 模块层冲突可视化」意图被自身内部冲突噪音稀释；本测试用例 2「no icon when no conflicts」对感知层滑块生产不可达（round-43 已登记 banner 侧 P2-2，本项为其滑块侧，修复应联动） | 与 round-43 修复联动：`getModuleConflicts` 增加 `excludeInternal` 参数（过滤 winner 亦为 `perception.*` 的冲突卡），或 renderSlider 侧过滤；补「感知层正常激活 + 无外部模块 → 滑块无图标」用例（现用例 2 未先激活感知层而漏测生产常态） |
| 🟡 P3 | render-menu.ts | :171 | **`container.lastElementChild` 隐式 DOM 结构耦合**：conflictHint 图标通过「容器最后一个子元素」反查刚渲染的 `.cs-row`，依赖 addSliderRow 同步 append 且为该节点最后一个子元素这一未声明契约；当前 addSliderRow（`ui-rows.ts:166-188`）总是 append 故成立，但若未来条件插入/异步化渲染，冲突图标会挂到错误行；测试仅单节点 schema 未覆盖多节点场景 | addSliderRow 返回 row 元素引用（或 renderSlider 自建 row 上下文），renderSlider 直接用返回值而非 lastElementChild 反查；补多节点 schema 用例 |
| 🟡 P3 | 测试文件 | :25-49 / 全文件 | **focusedModelId null 守卫与 conflictHint 未设分支零覆盖**：生产 `render-menu.ts:168` 的 `&& focusedModelId`（无焦点模型时不查询不显示）是显式守卫分支，测试两用例 focusedModelId 恒为 TEST_MID，未测 null 时；`conflictHint` 未设置（undefined 短路）亦未测；嵌套 folder 内滑块带 conflictHint 未测 | 补 3 用例（各约 8 行）：① focusedModelId=null → 无图标（断言 getModuleConflicts 未被调用）；② schema 无 conflictHint → 无图标；③ folder 子节点 slider + conflictHint → 图标在子节点行内 |
| 🟡 P3 | 测试文件 | :46-48 | **断言弱，掩盖 i18n 缺陷**：用例 1 的 icon 属性只断言 truthy（实际值恒为 `'lucide:alert-triangle'`，可精确断言）；title 只断言 truthy——测试注释（:47）声称「验证 title 包含冲突提示文案」，但实测 title 为原始 key `'motion.conflictHint'`（不含任何提示文案），**注释声称与事实不符**，且恰因 truthy 断言而静默放行 P3-1 缺陷 | icon 断言改 `toBe('lucide:alert-triangle')`；title 断言改 `toContain('perception.gaze.head')` 或翻译后文案；注释同步更正 |
| 🟢 P4 | registry.ts | :295-300 vs :309-314 | `getModuleConflicts` 与 `getAllConflicts` 重复 BoneConflict 字段映射（`{bone, byModule, winnerPriority, loserPriority}` 两处手写），字段增删需双点同步 | 提取 `toBoneConflict(c: StoreConflict): BoneConflict` 助手单点映射 |
| 🟢 P4 | 测试文件 | :1 | 头注释声称「ADR-163 §6.12」，ADR-163 现行版章节为 §2.5.2（滑块旁冲突标记）/ §六（验收标准），§6.12 不可解析（同类于 round-46 记录的「ADR-093 §6.10」引用错误） | 注释改指「ADR-163 §2.5.2」 |
| 🟢 P4 | 测试文件 | :32/:58 | mock 冲突数据 `[{ bone: 'Head', byModule: 'breath' }]` 缺 `winnerPriority/loserPriority` 字段（BoneConflict 类型 4 字段）——render-menu 当前只读 `length` 故测试通过，但若将来读取优先级字段（round-43 已建议 banner 显示覆盖者优先级）会漏测 | mock 数据补全 4 字段，形状与 `registry.ts:279-288` 对齐 |
| 🟢 P4 | 测试文件 | :15-23 | beforeEach 未重置 mock 返回值（无 `vi.clearAllMocks`），两用例均显式 `mockReturnValue` 故当前无跨用例耦合；若新增用例忘记设置会静默继承上一用例返回值 | beforeEach 加 `vi.clearAllMocks()` 或新用例显式重置，用例自包含（round-46 同款建议） |

## 五、测试质量评价

- **断言有效性：中，有 1 处名实不符。** 两态断言均真实对应生产分支：用例 1（有冲突→`conflicts.length>0`→图标插入全链路）、用例 2（无冲突→length=0→无图标）。但用例 1 的 title 断言名实不符——注释（:47）声称「验证 title 包含冲突提示文案」，实测 title 是缺失 key 回退的字面量 `'motion.conflictHint'`，truthy 断言让 i18n 缺口静默通过（测试 stderr 已实证）。icon 属性 truthy 断言可精确到 `'lucide:alert-triangle'`。
- **mock 合理性：正确。** 顶层 4 条 vi.mock 全部复用共享工厂（menu-schema-mocks.ts）；`vi.doMock('@/core/state')` spread 保留 `importOriginal` 原样（活绑定铁律）+ 覆写 focusedModelId + resetModules + 动态 import——与 round-46 判合规的模式逐条一致；afterEach `doUnmock` 对称还原；`getModuleConflicts` 被 mock 掉是**合理分工**——真实 loser 视角过滤逻辑由 `motion-modules-registry.conflict.test.ts:127-195`（node 环境直连 registry，含 winnerPriority/loserPriority 断言）覆盖，本测试专注 render-menu 渲染条件。
- **边界覆盖：核心两态覆盖，盲区 3 处（P3）。** 已覆盖：有/无冲突两态。未覆盖：① focusedModelId null 守卫（生产 :168 显式分支）；② conflictHint 未设置；③ 嵌套 folder 内滑块；④ 多冲突数组（只显示单图标是合理设计，未测）；⑤ `.cs-top` 缺失时静默跳过（防御分支）。对「conflictHint 专项」73 行 2 用例，用例密度低于 round-46 motion-module 专项（4 用例/78 行），mock 样板占比偏高（每用例约 15 行隔离样板），核心缺口是守卫分支与断言强度（均低成本可补）。
- **无跳过用例**：grep `it.skip/describe.skip/xit/todo/.only` 零命中；无 fake timers；无 `@ts-ignore/as any`（测试侧 `as ReturnType<typeof vi.fn>` 与 `Parameters<typeof rm>[0]` 为受限转型，round-46 同款已判可接受）。
- **生产代码类型安全**：render-menu.ts / registry.ts 0 处新增 `as any`/`@ts-ignore`（`:171 as HTMLElement | null` 为 DOM 反查受限转型）；无资源泄漏（warnIcon 为 DOM 元素随 container 生命周期，行控件归 SlideMenu registerControl 管理，round-37 dispose 契约一致）；异常路径完整（`createIconifyIcon` 内部 try/catch 返回 null，:175 判空跳过）。

## 六、与既往审核的关系说明（任务要求注明）

- **round-43（冲突 banner 恒显 P2）**：round-43 P2-2 报告 banner（motion-gaze-levels.ts:451-457）无内部冲突过滤导致感知层内部子模块互相抢占（gaze.head 92 vs breath 93 重叠候选骨）恒显噪音。本测试的滑块 conflictHint 标记与 banner **共享 `getModuleConflicts` 查询与同一根因**：生产 motion-gaze-levels.ts:234 的 breath 滑块恒显警告图标，本测试用例 2「无冲突不显示」分支对感知层滑块生产不可达（与 round-43 报告 banner 侧「无冲突时隐藏」分支不可达同构）。**round-43 的修复若只改 banner 不改 getModuleConflicts 或滑块侧，滑块标记缺陷仍存**——建议修复时联动（P3-2 已列）。另：本测试用例 1 的 mock 数据 `[{ bone: 'Head', byModule: 'breath' }]` 模拟「breath 抢占 gaze.head 的 Head」，与真实仲裁方向（gaze.head 92<breath 93，gaze.head 胜）相反——mock 数据不要求真实仲裁（仅驱动渲染条件），但暴露了测试未触及生产内部冲突噪音问题。
- **round-37（menu-schema.test.ts）**：主测试文件头注释已声明 conflict 文件因 `vi.resetModules` 文件级隔离保留独立，本测试即该文件；round-37 审的 dispose/guards/controlspec 等 describe 与本测试无重叠，conflictHint 块（render-menu.ts:167-184）在 round-37 中未专项覆盖（其 32 用例不含 conflictHint），本测试是补全而非重复。
- **round-46（motionModule 前缀）**：隔离模式同款（vi.resetModules + doMock core/state + 动态 import），round-46 判合规的结论适用于本文件；本测试的 doMock 覆写 `focusedModelId` 为静态 TEST_MID（core/state barrel re-export scene-state 活绑定，spread 静态化但测试只读常量，无读写分离风险——与 round-46 场景一致）。round-46 的 P3「getBindFn 丢弃 modelId/actionId」与本测试无关（本测试 slider bind 为 env 前缀）。

## 七、结论

- 总体结论：⚠️ **有条件通过**
- P1：0 ｜ P2：0 ｜ P3：5（i18n key 缺失 + 滑块内部冲突噪音 + lastElementChild DOM 耦合 + 守卫分支零覆盖 + 断言弱掩盖缺陷）｜ P4：4
- 一句话摘要：核心两态覆盖真实、mock 隔离合规，但生产 conflictHint 标记存在 1 个可直接修复的 i18n 交付缺陷（title 显示原始 key）与 round-43 同根因的滑块内部冲突噪音，测试的 truthy 断言恰好掩盖前者，建议补 key、联动 round-43 过滤内部冲突、升级 title 断言后转正。

---

审核日期：2026-08-15
审核员：子代理 round50-menu-schema-conflict
