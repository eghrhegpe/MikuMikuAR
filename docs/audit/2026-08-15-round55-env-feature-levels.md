# round55-env-feature-levels 审核报告 — env-feature-levels 契约测试与其守护目标

## 一、审核范围

| 项 | 文件 | 行号范围 |
|----|------|---------|
| 测试文件 | `frontend/src/__tests__/env-feature-levels.contract.test.ts` | 全文 298 行（19 用例） |
| 守护目标（8 个 build*Level） | `frontend/src/menus/env-sky-levels.ts:202`、`env-ground-levels.ts:536`、`env-water-levels.ts:482`、`env-wind-levels.ts:44`、`env-cloud-levels.ts:138`、`env-fog-levels.ts:71`、`env-shadow-levels.ts:123`、`env-experimental-levels.ts:29` | 均为 `(): PopupLevel`，内部统一委托 `buildLevel(...)` |
| 守护目标（公共辅助） | `frontend/src/menus/env-level-helpers.ts` | `buildLevel` :14-43、`openTexturePicker` :46-76 |
| 契约类型源 | `frontend/src/core/types.ts:404-407` | `PopupLevel = { label; dir; items; renderCustom?; ... }` |
| mock 依赖链事实源 | `frontend/src/scene/scene.ts:245`（模块级 `new Scene(engine)`）、`env-water.ts`（barrel，子模块 re-export）等 | 见 §四 mock 核对 |

**与既往审核的关系**：round-12 审过 env 系列（env-bridge/gravity/time-of-day 等）、round-40 审过 `env-sky.test.ts`（sky 渲染实现）、round-54 审过 `env-time-of-day` 的 presets.int（`applyEnvPreset`/预设动画）。本测试是 **env-*-levels 的拆分契约层**：拆分前（commit `7bfeaae5`，2026-07-20，env-feature-levels.ts 1597 行 → 8 个 per-domain 文件 + helpers + menu-state）在同一个 commit 里写入，目的就是锁住 8 个 build*Level 的存在性与返回形状，保证搬迁不破坏接口——与 round-40（渲染实现）、round-54（预设行为）是**三个互补视角**：存在性契约 / 渲染逻辑 / 预设行为，互不重复。`env-preset-levels.ts:324` 的 `buildPresetLevel` 不在 8 之列，属 env-preset 另一谱系（round-54 presets.int 已覆盖其行为），排除合理。

**验证记录**：
- `cd frontend && npm run test -- src/__tests__/env-feature-levels.contract.test.ts` → **19/19 通过**（vitest，2612ms，1 文件通过）。
- `cd frontend && npm run check` → **通过**（exit 0：tsc --noEmit + i18n parity 全绿，4 语言 bundle 与 zh-CN 基准 1871 keys 对齐）。
- 8 个 i18n key（env.sky/ground/water/wind/cloud/fog/shadow/experimental）已核实存在于 `public/locales/zh-CN.json`（如 env.sky=天空）；测试运行输出中 8 条 `[i18n] key not found` 告警为 **node 环境 bundles 缓存为空的伪告警**，非真实 typo（详见风险 #4）。

## 二、总体结论

**✅ 通过**

测试 19/19 绿、`npm run check` 绿，无 P1/P2 风险。契约锁定的粒度（存在性 + PopupLevel 四字段形状）与 `buildLevel` 实际返回形状（env-level-helpers.ts:22-42）逐项对应，mock 布局与真实依赖图基本一致，无 skip/only/空断言。拆分契约自证成功：env-feature-levels.ts 已删除，8 个函数分散在 8 个文件，测试仍全绿——这正是该测试的存在意义。存在 3 项 P3（死 mock 与失配注释、签名未锁、envState 静态字面量漂移）与 5 项 P4 改进项，均为维护性缺口，不构成阻断条件。

## 三、亮点

1. **契约粒度与实现一一对应**（`env-feature-levels.contract.test.ts:265-277`）：8 个 build*Level 的返回形状断言（label:string / dir:string / items:array / renderCustom:function）与 `env-level-helpers.ts:22-42` 的 `buildLevel` 实际返回精确匹配；`renderCustom` 在 `PopupLevel` 类型中是可选字段（types.ts:408），测试按「buildLevel 实际输出契约」断言其必有——锁的是实现契约而非类型最小集，方向正确。
2. **循环驱动 + 新增成本极低**（:248-278）：`funcNames` 数组 + for 循环生成 16 个用例，未来新增 domain 级文件只需在数组加一行；拆分后每个函数「存在性」与「形状」独立成例，可精确定位是哪个文件丢了导出。
3. **分文件 importActual 再合并**（:224-246）：8 个文件 + helpers 分别 `vi.importActual` 后对象合并，直测 per-domain 文件本身（而非 barrel re-export）——若走 env-menu.ts barrel 验证，丢导出的错误会在 barrel 加载期被吞掉或报错位置混淆，现方案能精确指向破损文件。
4. **god-barrel mock 保留活绑定**（:71-78 core/state、:91-203 core/config）：均采用 `...(await importOriginal())` spread 后仅覆盖特定字段，符合 frontend/AGENTS.md 测试卫生铁律（ADR-219）「god-barrel spread 禁静态化」；`activeTimeOfDayPreset: 'day'` 等覆盖值语义正确（env-sky-levels.ts:11 导入对）。
5. **scene/scene mock 必要且最小**（:16-19）：真实 scene.ts:245 模块级 `new Scene(engine)`、:234 `new Engine(dom.canvas, …)` 在 node 环境无法加载，mock 是硬需求；mock 形状（`setEnvState` + `scene.onBeforeRenderObservable.{add,remove}`）与生产导入面（env-*-levels 仅导入 `setEnvState`）精确匹配，是共享 `sceneMockSuperset`（scene-superset.ts:41,75）的合法子集，无形状漂移。
6. **测试头注释诚实标注环境约束**（:1,7-8）：`// @vitest-environment node` 正确（不依赖 DOM），「模块加载时触发 new Scene(engine)」的 mock 动机与 scene.ts 事实一致。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | env-feature-levels.contract.test.ts | :37-40（env-ground）× :52-57（env-menu）× :59-63（scene-menu） | **三处死 mock + 失配注释**：`vi.mock('../scene/env/env-ground')` 目标模块与生产导入不符——env-ground-levels.ts:9 实际导入 `env-ground-presets`（纯数据模块，无 Babylon），env-ground mock 从未生效，注释 :37 声称的依赖不存在；`vi.mock('../menus/env-menu')` 落空——env-level-helpers.ts:10-11、env-water-levels.ts:19 实际直连 `./env-menu-state`（纯状态模块），mock 目标是从未被加载的 env-menu barrel（注释 :52 自述「env-menu.ts barrel re-export」但消费者不经过 barrel）；`vi.mock('../menus/scene-menu')` 落空——env-ground-levels.ts:13 导入 `./scene-menu-state`（:59-60 注释自认「无需显式 mock」，仅作防御）。危害：a) 误导对依赖图的理解（注释与事实不符）；b) 若将来 env-ground-levels 改从 env-ground 导入，mock 会静默拦截并提供部分形状（`GROUND_PRESETS:{}`）掩盖真实依赖加载失败。 | 删除这三个 mock，改为在注释中说明「env-ground-presets / env-menu-state / scene-menu-state 为纯状态模块，可真实加载」；或至少把 mock 目标改为实际依赖模块并修正注释。 |
| 🟡 P3 | env-feature-levels.contract.test.ts | :260-263、:281-297 | **「签名契约」未锁签名本身**：任务宣称锁「8 个 build*Level 函数签名」，但实际仅断言 `typeof === 'function'` + 返回形状，未断言 `fn.length`——8 个函数均声明 `(): PopupLevel`（零参），若被改成带参（如 `buildSkyLevel(extra?)`）测试仍绿；`buildLevel` 只验证 2 参调用结果，`openTexturePicker` 仅存在性。对零参函数而言存在性+返回形状已能捕获绝大多数搬迁破坏，但「签名」二字言过其实。 | 每个 build*Level 补一行 `expect(fn.length).toBe(0)`；buildLevel 断言 `length >= 2`、openTexturePicker 断言 `length >= 2`（两必选参），成本一行，把「签名」落到实处。 |
| 🟡 P3 | env-feature-levels.contract.test.ts | :95-199（envState 静态字面量） | **envState 90+ 字段静态快照的漂移风险**：mock 以静态对象字面量整体覆盖 core/config 的 `envState`（活绑定），与 `deriveDefaultEnvState()`（core/env-state-defaults.ts:18，ADR-243 env-state-schema 的默认源）无共享——envState 字段演进后字面量漏字段，未来测试若触发 schema 构建读取新字段会静默 undefined；且静态快照覆盖活绑定偏离「保留活绑定」原则（当前测试不写 envState，无实际危害，属模式风险）。 | 在 mock 工厂内 `const { deriveDefaultEnvState } = await import('@/core/env-state-defaults')`，以 `envState: { ...deriveDefaultEnvState(), skyMode:'color', ...少量覆盖 }` 派生，消除与 schema 默认源的漂移；或抽取共享工厂（参照 env-bridge/env-mocks.ts 的 mockConfigEnvState）。 |
| 🟢 P4 | env-feature-levels.contract.test.ts | 运行输出（8 条 stderr） | **i18n 伪告警噪音**：8 个 build*Level 形状用例各触发一条 `[i18n] key "env.sky" not found in zh-CN base bundle — possible typo`（t.ts:88）——node 环境 `bundles` 缓存为空（loadLocale 需 fetch），t() 永远回退 key 本身；8 个 key 在 zh-CN.json 全部存在已核实。告警会掩盖未来真实 typo 回归（CI 里真假告警不可区分）。 | mock `../core/i18n/t` 为 `{ t: (k) => k }`（契约测试不关心翻译值），或断言级别把该 stderr 列入已知噪音白名单。 |
| 🟢 P4 | env-feature-levels.contract.test.ts | :16-19 | **未复用共享 mock 工厂**：scene/scene 内联 mock 未用 `sceneMockSuperset`（src/__tests__/mocks/scene-superset.ts:34），违反 frontend/AGENTS.md「核心模块 mock 优先复用共享工厂」铁律；当前内联形状是超集合法子集（字段名一致）无漂移，测试创建于 2026-07-20（早于 ADR-219 规则 2026-08-01），但 2026-08-10 修改时未收敛。 | 改用 `vi.mock('../scene/scene', async (importOriginal) => { const actual = await importOriginal(); return { ...actual, ...sceneMockSuperset() } })` 或直接复用超集工厂。 |
| 🟢 P4 | env-feature-levels.contract.test.ts | :286-292 | **buildLevel 断言不对称**：8 个 build*Level 断言 dir:string / items:array / renderCustom:function 全类型，而 buildLevel（helpers 断言）只验 label 值与字段存在，未验 dir/items 类型；`openTexturePicker` 仅存在性（:294-296），其行为（closeAllOverlays/getEnvMenu/stackRegistry 守卫）零覆盖——对契约测试可辩护，但可低成本对齐。 | buildLevel 断言补 `typeof level.dir === 'string'` 与 `Array.isArray(level.items)`，与 8 个 build*Level 对称。 |
| 🟢 P4 | env-feature-levels.contract.test.ts | :205 | **头部注释过时**：「拆分后只需改这一个 import 路径」——实际 :224-234 是 9 条 importActual 路径（8 文件 + helpers），拆分早已完成，注释是拆分前的设想残留。 | 更新注释描述现状（分文件 import 再合并）。 |
| 🟢 P4 | env-feature-levels.contract.test.ts | :235-245 | **对象 spread 合并的同名导出静默覆盖**：9 个模块 spread 进一个对象，若未来两个拆分文件导出同名符号（如都导出 buildLevel），spread 顺序静默决定胜者，测试不察觉。当前无冲突（buildLevel/openTexturePicker 仅 helpers 导出）。 | 合并后加一条「同名冲突检测」断言（如遍历各模块导出名求交集断言为空），或改用 Map 按模块分组验证。 |

## 五、测试质量评价

**断言有效性**：19 用例全部有效——存在性断言（typeof function）+ 形状断言（label 字符串 / dir 字符串 / items 数组 / renderCustom 函数）均为实质断言，无空断言、无 `it.skip`/`describe.skip`/`only`（grep 零命中）。`toHaveProperty` + `typeof` 组合既能防「字段缺失」也能防「字段类型漂移」，粒度合适（未锁 label 值或 dir=='' 等易碎细节，选择正确）。

**mock 合理性**：核心重依赖链 mock 全部命中真实导入面——scene/scene（env-sky/ground/water 导入 setEnvState，scene.ts:245 模块级 new Scene 证实必须）、env-water（:28-34 五个导出与 env-water-levels.ts:9-15 导入逐一对应）、env-lighting（:42-45 TIME_OF_DAY_PRESETS ↔ env-sky-levels.ts:9）、env-time-of-day（:47-50 applyEnvPreset ↔ env-sky-levels.ts:10）、render/lighting（:21-25 getLightState/setLightState ↔ env-shadow-levels.ts:9）、render-menu（:65-68 全 8 文件导入）、menu-overlay/library-path（env-level-helpers 依赖）；core/state 与 core/config 用 async importOriginal 保留活绑定符合 ADR-219 铁律；无 TDZ/hoist 陷阱（工厂仅引用字面量/importOriginal），无裸 window 操作。**失配集中在三处死 mock**（风险 #1），功能无害但注释误导。

**边界覆盖**：8 函数存在性 + 形状（16 例）、helpers 三例——对「存在性 + 返回形状」契约目标覆盖充分；未覆盖（可辩护）：renderCustom 实际执行（cardContainer 拼接/dispose 收集）、openTexturePicker 行为、buildLevel 第三参 buildExtraSegments、i18n 实际 label 值。这些属于行为层，由 env-menu 集成/其他测试负责，契约测试不越界是正确分工。

**契约-实现漂移风险评估**：测试与被守护实现（env-level-helpers.ts）同仓演进，buildLevel 返回形状变化会立即红灯；8 个文件任一丢导出/改名会红灯；**唯一静默漂移面**是「签名」（fn.length 未锁）与「envState 静态字面量」（未来字段读 undefined），均已在风险表登记。

---

审核日期：2026-08-15
审核员：子代理 round55-env-feature-levels
