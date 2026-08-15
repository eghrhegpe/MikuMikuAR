# round-46 — menu-schema motionModule StatePath 前缀专项审核报告

> 审核员：子代理 round46-menu-schema-motion-module（第 46 轮第 3 个测试）
> 审核日期：2026-08-15

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/menu-schema.motion-module.test.ts`（78 行，4 用例，`@vitest-environment node`） |
| 被测源码 | `frontend/src/menus/menu-schema.ts:40-64`（getStateValue motionModule 分支）、`:97-115`（setStateValue motionModule 分支）、依赖 `frontend/src/scene/motion/motion-modules/registry.ts:165-240`（getModuleState / getModuleDefaultParam / setModuleParam）、`frontend/src/scene/shared/menu-node-types.ts:8-14`（StatePath 类型契约，motionModule 前缀在列） |
| 测试 mock 工厂 | `frontend/src/__tests__/menu-schema-mocks.ts:109-115`（mockRegistry：getModuleState/setModuleParam/getModuleDefaultParam） |
| 运行验证 | `npm run test -- src/__tests__/menu-schema.motion-module.test.ts` → **4/4 通过**（336ms，node 环境）；`npm run check`（tsc + i18n 校验）→ **exit 0** |
| 历史关系 | ① round-37（`2026-08-15-round37-menu-schema.md`）审的合并主测试 `menu-schema.test.ts`（850 行/32 用例）——其 StatePath describe 仅覆盖 env/ui/light/perception 四前缀，**motionModule 前缀当时未并入合并 7 文件、保持独立**，本测试与其互补不重叠；② round-12（`2026-08-06-round12-env-motion-core-ai.md`）审过 `motion-modules/registry.ts` 本体（有条件通过，P1#1/#2 + unregister 泄漏/bake 风暴等），本测试仅经 menu-schema 触及 registry 三个读写入口，round-12 风险项不在本测试覆盖面内；③ 本测试与 [fix:P2] 单源修复 commit `0226302e`（menu-schema motionModule bind 改走 registry 单源，消除双源断链）**同 commit 锁步更新**，第 3 用例即该修复的回归锁 |

## 二、总体结论

✅ **通过**（无 P1/P2）

4 个用例真实覆盖 motionModule 前缀读写的四象限（读 registry / 默认值回退 / 写 registry / 无焦点模型守卫），断言含 `toHaveBeenCalledWith` 调用签名锁定，mock 隔离模式（vi.resetModules + vi.doMock + 动态 import）符合 AGENTS.md §2.3 测试卫生铁律。生产代码 motionModule 分支 0 处新增 `as any`/`@ts-ignore`，状态流单一（registry 单源），无资源泄漏点。发现 1 处死导入（P3）与若干测试补强项（P3/P4），均非阻塞。

## 三、亮点

- **单源回归守卫设计精妙**：`menu-schema.motion-module.test.ts:23-32` 的 mock `modelRegistry` 仍种入 `motionOverrideModules: [{ id:'gaze', enabled:true, params:{ headYawRange:45 }}]` 作为**诱饵**——若生产回退到旧 `inst.motionOverrideModules` 读取路径，测试 1 的 `toBe(45)` 仍会通过（旧源里恰好有同值），但 `expect(gms).toHaveBeenCalledWith(TEST_MID, 'gaze', undefined)`（:50）会失败。值断言 + 调用断言双保险，真正锁死「读走 registry 单源」而非仅锁值。
- **隔离模式正确且自解释**：`menu-schema.motion-module.test.ts:16-39` 的 beforeEach 用 `vi.resetModules()` + `vi.doMock('@/core/state', async (importOriginal) => ({ ...actual, focusedModelId, modelRegistry }))`，用例内动态 `await import` 取重置后实例（:42-76）；`afterEach` 对称 `vi.doUnmock`（:37-39）。`importOriginal` spread 原样保留（非静态化超集，规避 god-barrel 活绑定断链），`doMock` 运行期执行无 vi.mock hoist TDZ 问题，头注释（:3-4）如实说明原因——与 AGENTS.md §2.3 铁律逐条吻合。
- **测试名与断言名实相符**：4 用例各对应生产一个分支——读（`menu-schema.ts:40-64`）、回退（:60-62）、写（:97-115）、无模型守卫（:51-53），无「只断言容器非空」式弱断言（对比 round-37 记录的 windDirection 名实不符遗留）。
- **锁步交付**：commit `0226302e` 同时改生产（inst.motionOverrideModules → registry 委托）与测试（+19 行同步更新），测试 3 用例名「不再写 inst.motionOverrideModules」直接编码修复意图，无 test-after 漂移。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | menu-schema.ts | :8 | `modelRegistry` import 在 [fix:P2] 单源修复后**不再被使用**（grep 全文仅此 1 处）——旧 motionModule 分支被 registry 委托取代后遗留的死导入，误导读者以为 menu-schema 仍直接读 modelRegistry；`strict:false` 下 `noUnusedLocals` 默认关闭，`npm run check` 不会捕获 | 从 import 删除 `modelRegistry`（`focusedModelId/uiState/setUIState` 仍需要），重跑 `npm run check` 验证零新错误 |
| 🟡 P3 | menu-schema.motion-module.test.ts | :70-77（对生产 :108-110） | **set 侧无焦点模型守卫零覆盖**：测试 4 只测 `getStateValue` 返回 undefined，`setStateValue` 的 `if (!mid) return;` 分支（生产 :108-110）未测；同时 `modelId` 显式覆写参数在 motionModule 分支零覆盖（`menu-schema.modelid.test.ts` 只测 perception，且注释明言「modelId 仅对 motionModule 生效」——即显式 modelId 恰恰是 motionModule 特有通路却无人测） | 补 2 用例：① focusedModelId=null 时 `ssv('motionModule.x.y', v)` 不调用 `setModuleParam`；② `gsv('motionModule.gaze.headYawRange', 'other-model')` 时 `gms` 收到 `'other-model'`（mid 优先于 focusedModelId） |
| 🟡 P3 | menu-schema.motion-module.test.ts | :53-60 | **隐式跨用例耦合**：测试 2 的回退触发依赖测试 1 遗留的 `gms.mockReturnValue({ enabled:true, params:{ headYawRange:45 } })`（vitest 默认不 clear mocks，本文件无 `vi.clearAllMocks`）；当前因 `breathAmp` ∉ params 恰好成立，若将来测试 1 的 mock 值含 breathAmp，测试 2 静默变红且报错信息费解 | beforeEach 加 `vi.clearAllMocks()`（本文件 mock 均为共享 vi.fn，clear 不影响 mockReturnValue 之外的状态），或测试 2 显式重置 `gms.mockReturnValue({ enabled:false, params:{} })` 使用例自包含 |
| 🟡 P3 | menu-schema.ts | :40-64 / :97-115 | **get/set 两处 motionModule 解析逻辑逐字重复**（`path.slice('motionModule.'.length)` + `indexOf('.')` 两段解析 + `mid = modelId ?? focusedModelId` + 无 dot 早退），历史上该解析已出过一次 bug（adr-116 P0 审计：原 `split('.')` 仅取前两段致 paramKey 丢失）——get/set 若只修一边即静默漂移 | 抽共享助手 `parseMotionModulePath(path, modelId): { moduleId, paramKey, mid } | null`，get/set 共用，单点修复 |
| 🟢 P4 | menu-schema.ts | :43 / :100（+ 测试 :49/58/66/76） | 魔法字符串 `'motionModule.'` 前缀在 get/set 各硬编码 2 次，且与测试字面量重复，若前缀改版需 4+ 处同步 | 提为 `const MOTION_MODULE_PREFIX = 'motionModule.'`（生产侧至少一处） |
| 🟢 P4 | 测试头注释 | :2 | 声称「ADR-093 §6.10」，但 adr-093 现行版 §6 为「验证」无子节，git 历史（3de0e454）亦无 §6.10；motionModule 前缀权威规范实为 **ADR-116**（`docs/adr/adr-116-bone-override-ui-redesign.md:53/63`） | 注释改指 ADR-116（或 ADR-204 拆分记录），消除不可解析引用 |
| 🟢 P4 | menu-schema.motion-module.test.ts | :23 / :45 / :56 | 测试代码 `Map<string, any>` + `(gms as ReturnType<typeof vi.fn>)` 断言转型——AGENTS.md §2.2 面向生产代码，但测试侧同样宜收敛 | `any` 改 `Record<string, unknown>` 子集或复用 `ModelInstance` 类型；`as ReturnType<typeof vi.fn>` 改 `vi.mocked(gms)` |
| 🟢 P4 | menu-schema.motion-module.test.ts | :62-68 | 测试 3 名「不再写 inst.motionOverrideModules」但未直接断言 mock 注册表条目的 `motionOverrideModules` 未被改动——「不再写」由生产代码审查 + `smp` 调用断言间接保证，非直接断言 | 可选补 1 行：断言后检查 mock `modelRegistry.get(TEST_MID).motionOverrideModules` 长度/内容不变，把「不写旧源」从间接变直接 |

## 五、测试质量评价

- **断言有效性：高。** 前缀解析链路被真实验证：测试 1 断言值 45 从 registry mock 流出 + `gms` 以 `(TEST_MID, 'gaze', undefined)` 被调用（锁定 modelId 默认解析 + actionId 默认缺省）；测试 2 验证 `params[paramKey] === undefined` 时回退 `getModuleDefaultParam('gaze','breathAmp')`（对应生产 :60-62，ADR-116 滑块负值 min 修复）；测试 3 验证写路由 `setModuleParam(TEST_MID,'newMod','someParam',0.75,undefined)`（对应生产 :113）；测试 4 验证无焦点模型返回 undefined（生产 :51-53）。四象限 + 调用签名双保险，无弱断言。
- **mock 合理性：正确。** `vi.doMock + vi.resetModules + 动态 import` 是本场景的唯一正确模式（focusedModelId 需 per-test 变化，vi.mock 工厂 hoist 期无法参数化）；`importOriginal` spread 保留活绑定（AGENTS.md §2.3 禁静态化铁律）；`afterEach doUnmock` 对称还原；共享工厂 `mockRegistry`（menu-schema-mocks.ts:109-115）复用而非内联，规避 round-20 schema-snapshot 同类问题。
- **边界覆盖：中等偏上，有明确缺口。** 已覆盖：读/回退/写/无模型守卫、actionId 缺省透传（undefined）。未覆盖：① 非法 StatePath（`motionModule` 无参数段 → 生产 :45-47/:102-104 早退分支）；② `modelId` 显式覆写（motionModule 特有通路，且 modelid.test.ts 明言只对 motionModule 生效却不测）；③ set 侧无模型守卫；④ actionId 非缺省值（如查看非激活动作 A）；⑤ 未知 moduleId/paramKey 的 undefined 收敛。②③ 为 P3，其余为 P4 级补强。
- **无跳过**：无 `it.skip/.only/.todo`、无 fake timers、无 `@ts-ignore/as any`（测试侧）。
- **78 行充分性：合理。** 对「motionModule 前缀读写路由」这一窄范围，4 用例呈四象限覆盖、单文件 ≤300 行符合 ADR-204 拆分约束；密度高（平均 19.5 行/用例），无冗余样板。短板在 set 侧守卫与 modelId 覆写两个低成本缺口（P3）。

## 六、与既有审计的关系说明

- **round-37**（menu-schema 合并主测试）：其 StatePath describe 覆盖 env/ui/light/perception 四前缀 set 链路，motionModule 前缀保持独立文件（合并 7 文件不含 motion-module）——本测试是其前缀覆盖的**补全**而非重复；round-37 遗留的 P3「getBindFn 丢弃 modelId/actionId」（menu-schema.ts:120-122）与本测试的 actionId 通路直接相关：`getBindFn` 仍不传 actionId，motionModule 控件自更新 bind 仍按焦点模型+激活动作读值——本测试未覆盖该缺口（超出本文件范围，建议由 render-menu 侧用例承接，与 round-37 同源）。
- **round-12**（motion-modules/registry.ts）：其 P1/P2（unregisterModule 泄漏、applyMotionModulesToModel 无 try/catch、setTargetModel bake 风暴、_fallbackModuleStates 双源）均位于本测试不触及的 registry 内部路径；本测试仅验证 menu-schema → registry 的**接口契约**（参数透传 + 返回值流转），两者互补无冲突。测试 3 的「单源」断言与 round-12 登记的「_fallbackModuleStates↔intent.motionModules 双源」P3（adr-254 D6 已判为有意分治）不矛盾——menu-schema 层已是单源委托。

## 七、结论

- 总体结论：✅ **通过**
- P1：0 ｜ P2：0 ｜ P3：4 ｜ P4：4
- 一句话摘要：测试质量高（单源回归守卫 + 隔离模式合规），生产 motionModule 分支状态流清晰，仅余 1 处死导入（menu-schema.ts:8）与 set 守卫/modelId 覆写两个低成本测试缺口，均不阻塞合并。
