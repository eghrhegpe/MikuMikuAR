# round-49 — menu-schema.integrity 元测试（Schema 完整性）审核报告

> 审核日期：2026-08-15
> 审核员：子代理 round49-menu-schema-integrity（第 49 轮第 1 个测试）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/menu-schema.integrity.test.ts`（487 行，10 个 describe / 1466 个 it.each 用例，ADR-093/ADR-220 元测试：Schema 驱动的完整性校验） |
| 守护目标 | `frontend/src/menus/menu-schema-register.ts`（77 行，16 面板 getXxxSchema 集中注册）、`frontend/src/menus/menu-registry.ts`（111 行，collectAllSchemas/flattenNodes/collectAllSchemasWithFailures）、各 `*-levels.ts` 注册的 MenuNode[] schema（env 9 + scene 2 + motion 1 + settings 4 = 16 面板） |
| 类型契约 | `frontend/src/scene/shared/menu-node-types.ts`（81 行，StatePath/MenuNode/ControlSpec） |
| 共享 mock 工厂 | `frontend/src/__tests__/menu-schema-mocks.ts`（218 行，18 个工厂被本测试引用） |
| 运行验证 | `npx vitest run src/__tests__/menu-schema.integrity.test.ts` → **1466/1466 通过**（46ms 测试 + 737ms import，exit 0）；`npm run check`（tsc + i18n parity）→ **exit 0**（zh-CN 基准 1870 keys，en/ja/ko/zh-TW 全对齐，5 语言 AVAILABLE_LANGS 一致） |
| 相关 ADR | ADR-093（声明式菜单 Schema，本测试挂接点）、ADR-220（Schema 完整性元测试 ADR，本测试为其 P0 实现；原误编 200 顺延，编号说明确认测试文件挂接 ADR-093 正确） |

### 与既往轮次的关系（核实）

| 轮次 | 审核对象 | 与本测试关系 |
|------|---------|-------------|
| **round-37**（`2026-08-15-round37-menu-schema.md`） | `menu-schema.test.ts`（850 行/32 用例，渲染层） | 渲染层测「schema→DOM→状态写回」闭环（render-menu.ts），本测试测「schema 数据自身」结构完整性（bind 路径/i18n/id/folder）。同一 MenuNode 数据源的两个正交剖面，互补不重叠；round-37 遗留 P3（getBindFn 丢弃 modelId/actionId）与本测试无关（静态分析不触运行期取值） |
| **round-46**（`2026-08-15-round46-menu-schema-motion-module.md`） | `menu-schema.motion-module.test.ts`（78 行/4 用例，motionModule 前缀） | round-46 测 `getStateValue/setStateValue` 的 motionModule 分支**运行期路由**（registry 单源）；本测试 §1/§6 用 `MOTION_MODULE_PARAMS` 静态表（test:196-221）校验 motionModule 前缀 bind 的**编译期不可枚举字段集**。round-46 指出的 P4「测试头注释 §6.10 不可解析」在本测试不存在——本测试头注释指 ADR-093，与 ADR-220 编号说明一致 |
| **round-20**（`2026-08-15-round20-schema-snapshot.md`） | `schema-snapshot.test.ts`（453 行，快照生成） | 同族基础设施：共享 collectAllSchemas/flattenNodes（menu-registry.ts 单实现）+ menu-schema-mocks 工厂。分工：snapshot 断言 `failed=[]`（builder 失败显式红，schema-snapshot.test.ts:339）+ nav 完整性；本测试断言 schema 结构完整性。round-20 的 P2「150 行 mock 内联未复用共享工厂」在本测试**部分复发**（config mock 内联 8 行，见风险表 P3-5），但规模远小 |

## 二、总体结论

⚠️ **有条件通过**（测试主体质量高、1466 用例全绿、无跳过；但存在 2 个 P2：render./ui. 前缀的字段真相源被手维护副本偷换/漂移，削弱了元测试「捕获 state 字段重命名漂移」的核心承诺，建议修复后转通过）

- P1：0 ｜ P2：2 ｜ P3：5 ｜ P4：3

## 三、亮点

- **元测试对真实 schema 求值，mock 只隔离渲染依赖**：`import '../menus/menu-schema-register'`（test:100）触发 16 面板真实 builder 注册，`collectAllSchemas()`（menu-registry.ts:85-87）逐一执行真实 `getXxxSchema()`。关键前提已核实——`WATER_PRESETS/GROUND_PRESETS/TIME_OF_DAY_PRESETS/FILTER_PRESET_LABELS` 空 mock 均只在 `renderCustom` 内部消费（env-water-levels.ts:36-50、env-ground-levels.ts:34-48、env-sky-levels.ts:26、scene-render-levels.ts:62），**不掏空静态 schema 结构**；节点 id/kind/label/bind 全部来自真实生产代码。
- **§1 hasCustomAccessor 跳过是必要且正确的设计**：`perception.allEnabled`（motion-gaze-levels.ts:63）是派生聚合字段（`isAllPerceptionEnabled()` 计算），不在真实 `DEFAULT_PERCEPTION_STATE`（perception-shared.ts:47-58）中——若无该跳过必误报；有自定义 get/set 的控件 bind 视为逻辑标识，语义自洽。
- **bind 路径按前缀分流 + 动态三段解析**（test:233-260）：`env/render/light/perception/ui` 五前缀查对应字段集，`motionModule.<moduleId>.<paramKey>` 查 `MOTION_MODULE_PARAMS`；未知前缀/未知模块/缺段一律返回 false。核实 `MOTION_MODULE_PARAMS` 与真实模块 DEFAULTS 完全一致（body-posture:5 参数、hand:8 参数含 fingerIntensity、foot:6 参数、riding-model:5 参数含 preset/pedalSpeed）。
- **§3 五语言包校验（zh-CN/en/ja/ko/zh-TW）**：label + modeSlider options label 双来源收集；`render-menu.ts:90/276` 证实 label 经 `t()` 解析，key 语义成立。这比 ADR-220 原始设计的单 zh-CN 包更强（P0 精化已落实 5 包）。
- **id 全局唯一跨面板校验**（test:296-307）：全部节点扁平后单 Set 去重，16 面板间 id 冲突即红。且经核实 `env:sky:color-top` 与 `env:sky:zenith` **共享 bind `env.skyColorTop` 是有意设计**（env-sky-levels.ts:64-65 注释「故意的颜色继承」+ visibleWhen 互斥）——因此本测试**不做 bind 唯一性校验是正确取舍**，若机械加该检查反而误报。
- **builder 失败显式红分工清晰**：collectAllSchemasWithFailures（menu-registry.ts:68-82）的 `failed` 列表由 schema-snapshot.test.ts:339 断言为空，本测试专注结构完整性，职责不重叠。
- **运行效率符合 ADR-220「秒级」定位**：1466 用例 46ms（+ import 737ms），无浏览器/DOM 依赖；无 `.skip/.only/.todo`（grep 零命中）。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | menu-schema.integrity.test.ts | :97（vi.mock renderer）+ :105/:140（RENDER_KEYS） | **render.* 前缀真相源被 mock 偷换**：`import { defaultRenderState } from '../scene/render/renderer'` 命中 `vi.mock('@/scene/render/renderer', () => mockRenderer())`，`RENDER_KEYS` 实为 menu-schema-mocks.ts:8-41 的手维护副本而非真实 `defaultRenderState()`（renderer.ts:234-269）。今日两套键名恰好一致（31 字段），但**值已漂移**（真实 toneMapping:0/bloomKernel:64/celShadingMode:false，mock 为 'aces'/'box'/'none'），证明副本陈旧。后果：真实 renderer 字段重命名/删除而 schema 未跟时，20 个 render.* bind（scene-render-levels.ts:207-504）校验仍绿——恰是 ADR-220 §2.2 声称要捕获的「字段重命名后 schema 没跟」缺陷类，此前缀成盲区 | 让 mock 保留真实函数：`vi.mock('@/scene/render/renderer', async (importOriginal) => ({ ...mockRenderer(), ...(await importOriginal()) }))` 中 `defaultRenderState` 取真实实现（其余仍 stub）；或把 RenderState 默认值提取为纯叶子模块（ADR-191 风格）供 renderer 与测试同引，从根上消除副本 |
| 🟠 P2 | menu-schema.integrity.test.ts | :144-175（UI_KEYS） | **UI_KEYS 硬编码表已与真实 UIState 漂移**：对照 core/types.ts:448-513，表内 30 项 vs 真实 38 字段——**缺 10 个真实字段**（scale/popupWidth/accent/fontFamily/animations/blurBg/performanceMode/autoCameraEnabled/autoCameraBeatsPerSwitch/audioRepeatMode），新 schema 绑定 `ui.audioRepeatMode` 等合法字段会误红（假阴性）；**含 2 个幽灵字段** windowWidth/windowHeight（全 src 仓 grep 零命中，非 UIState 成员，疑为历史遗留）——误写 `ui.windowWidth` 的 bind 会静默通过（假阳性）。注释「硬编码自 init.ts 赋值」与事实不符（init.ts 无此二字段） | 字段清单改为从真实源派生：在 core/ui-state.ts 导出 `UI_STATE_KEYS` 常量（与 UIState 类型同文件，改类型必同步），测试直接 import；或加编译期哨兵 `type _KeysCover = (typeof UI_STATE_KEYS)[number] extends keyof UIState ? true : false` 锁同步 |
| 🟡 P3 | menu-schema.integrity.test.ts | :267（beforeAll） | **面板数下限过弱**：`expect(schemas.length).toBeGreaterThanOrEqual(3)`，实际注册 16 面板——注册表若丢失 13 个面板（registerSchema 行被删）本测试仍绿；snapshot 测试的 `failed=[]` 只兜「builder 抛错」，不兜「未注册」 | 断言精确 panelId 集合（`expect(schemas.map(s=>s.panelId).sort()).toEqual([...])`）或下限提到 `>=16`，新增面板时同步更新 |
| 🟡 P3 | menu-schema.integrity.test.ts | :400-403（§7 action） | **疫苗测试占位**：已注册 16 面板**零 action 节点**（grep `kind: 'action'` 的 17 处全在未注册文件：library-core/library-browse/motion-root-ui/motion-procmotion-levels/settings-system/settings-language），故 §7 永远走 `expect(true).toBe(true)` 分支——不校验任何真实属性，且掩盖「action 完整性零覆盖」事实 | 占位分支删除或改为显式记录（如断言 actionNodes 长度为 0 时输出信息性 message）；未来 action 节点进入注册面板时该节自动激活 |
| 🟡 P3 | 覆盖范围 | menu-schema-register.ts（16 面板） | **注册子集 16/57+ 面板**：`buildChatSchema/buildConfigSchema/buildSessionsSchema/buildDiagnosticSchema`（AI 诊断助手）、`buildProcMotionSchema`（带参，无法零参注册）等导出 schema 均未注册，不受本测试守护；文件头（test:4）「新增面板时注册即自动覆盖」未注明当前覆盖子集，易误导读者以为全量 57 面板受守护 | 头注释注明「当前覆盖 16 面板（ADR-220 §5），未注册面板需人工评估」，或对诊断助手类零参 schema 补注册 |
| 🟡 P3 | menu-schema.integrity.test.ts | :178-192（LIGHT_KEYS） | **LIGHT_KEYS 手维护副本**：与真实 LightState（lighting.ts:37-51）今日完全一致（13/13），但同属硬编码真相源——字段增删时测试表不自动跟随，与 UI_KEYS 同根风险（面小故降级） | 并入 UI_KEYS 修复方案：从 lighting.ts 或类型派生，消除手维护副本 |
| 🟡 P3 | menu-schema.integrity.test.ts | :89-96 vs menu-schema-mocks.ts:118-126 | **config mock 内联与共享工厂分化**：本测试内联 `vi.mock('@/core/config', ...)`（含 uiState/cardContainer/applyHudVisibility，**缺 envState**），而共享工厂已提供 `mockCoreConfig()`（含 envState）——两处形状不一致，违反 AGENTS.md §2.3「同模块 mock 形状保持超集一致，禁止各自内联出差异化形状」铁律（round-20 同类 P2 教训的小规模复发；当前因静态分析不触 envState 未爆雷） | 改用 `vi.mock('@/core/config', () => mockCoreConfig())`，删除内联块 |
| 🟢 P4 | menu-schema.integrity.test.ts | :313 | describe 标题「i18n key 存在性（zh-CN/en/ja/ko）」漏 zh-TW（实际校验 5 包，:131-137 含 zh-TW） | 标题改「（zh-CN/en/ja/ko/zh-TW）」 |
| 🟢 P4 | menu-schema.integrity.test.ts | :274/:314/:348/:367/:380/:397/:419/:444/:477 等 | `const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes))` 在 10 个 describe 逐字重复；§2/§8 的 Set 去重循环重复 | 提为模块级助手（如 `function allNodes()`），去重逻辑抽 `findDupes()` |
| 🟢 P4 | menu-schema.integrity.test.ts | :1-4 | 头注释只列 4 类缺陷（bind/i18n/id/folder 空），文件实为 10 节——§5 modeSlider 非空、§8 values 唯一、§9 min/max/step、§10 label 存在等未提及 | 更新头注释列全 10 个校验维度 |

## 五、测试质量评价

- **断言有效性：高（主体）+ 两处真相源瑕疵（P2）。** 真实有效的部分：bind 路径五前缀分流 + motionModule 动态三段校验（§1/§6，误写字段/换错前缀/未知模块均判无效）；id 全局唯一（§2，跨面板）；五语言包 label 存在性（§3，含 modeSlider options label）；folder 非空或 renderCustom（§4）；modeSlider options 非空 + values 唯一（§5/§8）；slider min≤max / step>0（§9）；非 custom 节点必须有 label（§10）。瑕疵：render.* 20 条 bind 校验基于 mock 副本键集（P2-1），ui.* 校验基于已漂移的手工表（P2-2）——这两处是元测试「字段重命名漂移」承诺的盲区。§7 为疫苗占位（P3）。
- **mock 策略：整体正确、局部违规。** 核心正确性：mock 只隔离渲染依赖（Babylon/Wails/DOM 副作用模块），被审的 schema 数据本身是真实生产代码求值结果——这是元测试成立的根本前提，且预设空 mock 不掏空结构（已逐一核实）；`vi.mock` 工厂只引用 import 绑定（test:7-26 → 工厂），符合 AGENTS.md §2.3 hoist 约束。局部违规：config mock 内联与共享工厂分化（P3-5）；`defaultRenderState` 被 mock 覆盖导致 RENDER_KEYS 非真相源（P2-1）——此点尤为隐蔽，测试注释（:105「从各 state 模块获取」）与实际取值来源不符。
- **边界覆盖：良好。** 已覆盖：未知前缀/未知模块/缺段早退、hasCustomAccessor 跳过（必要）、空 folder、modeSlider 空 options、重复 option values、min>max、step≤0、缺 label。未覆盖（可接受）：bind 唯一性（zenith 共享 bind 有意设计，做了反而误报）；`it.each([])` 空数组行为——若未来某类节点全数消失（如 modeSliders 清零），§5/§8 的 it.each 空表会静默 no-op（Vitest 对空表不报错），建议在 beforeAll 对各节统计量加 `>0` 守卫兜底。
- **无跳过**：grep 确认无 `.skip/.only/.todo/xit/xdescribe`。
- **资源/异常**：元测试为纯静态分析，无 DOM/定时器/句柄；builder 异常路径由 collectAllSchemasWithFailures 显式承接（menu-registry.ts:68-82），无静默吞错。
- **运行副作用：无。** 实测运行后 git 工作区无变更，1466 用例确定性通过（两次运行结果一致）。

## 六、结论

- 总体结论：⚠️ 有条件通过（2 个 P2 均不阻塞当前正确性——render 键集今日与真实一致、UI_KEYS 缺项/幽灵项当前无 schema 命中——但削弱元测试核心承诺，建议修复后转 ✅）
- P1：0 ｜ P2：2 ｜ P3：5 ｜ P4：3
- 一句话摘要：元测试主体质量高（真实 schema 求值 + 1466 用例全绿 + 五语言包校验），但 render./ui. 字段真相源被 mock/手维护表偷换（P2），且面板数下限 3、§7 疫苗占位、config mock 分化等 5 项 P3 待收敛。

---

审核日期：2026-08-15
审核员：子代理 round49-menu-schema-integrity
