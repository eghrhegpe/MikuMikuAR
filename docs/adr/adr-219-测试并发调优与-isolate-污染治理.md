# ADR-219: 测试并发调优与 isolate 污染治理 — vitest 全量提速：maxWorkers 落地 + isolate=false 障碍清理

> **状态**: 已完成（2026-08-01 决策 C 收口。Phase 1 maxWorkers 落地省 13%；Phase 2 idb 全局化落地，isolate=true 4135 全绿零回退；有界诊断判定「收集期蒸发」与「执行期污染」两债同土壤、不同修法，isolate=false 存在结构性风险 → 降级为非目标不采纳；剩余执行期污染债入测试卫生清单） ⚠️ 被 [ADR-257](adr-257-maxworkers-8.md) 取代（new-adr.mjs 自动标注）
> **日期**: 2026-07-31

## 背景

单个测试文件跑得快，但全量 `vitest run` 偏慢（实测 **37.5s**，242 文件 / 2707 用例 / 24 核机器）。诊断发现瓶颈不在测试逻辑，而在**每个 worker 的环境搭建与模块导入开销**。

实测耗时分解（默认配置，`reporter=dot` 尾部）：

```
Duration 37.56s (transform 34.72s, setup 9.32s, import 295.64s, tests 45.11s, environment 325.26s)
```

关键读数：

- **environment 325s / import 296s** 是累加值（各 worker 求和）；真正执行测试的 **tests 仅 45s**。
- 325s ÷ 37s ≈ 同时约 **8–9 路并发**——24 核机器上 vitest 默认策略偏保守，未吃满。
- 重模块 `babylon-mmd` 在每个 fork 子进程里被重复编译加载，是 import 累加值爆表的主因。

一句话：24 位外科医生各自从头刷手、拆一整套器械，真正动刀只占零头。

## 决策

分两阶段推进，先拿零风险收益，再还测试卫生债换取更大提速。

### Phase 1（已落地）— 显式并发上限 `maxWorkers/minWorkers: 12`

在 `frontend/vitest.config.ts` 的 `test` 块显式固定 worker 数为 12。

实测不同 worker 数（`--maxWorkers=N`，均全绿）：

| maxWorkers | 全量耗时 |
|-----------|---------|
| 默认（~8–9） | 37.5s |
| **12** | **32.6s** ✅ |
| 16 | 34.3s |
| 20 | 33.8s |

结论：**堆 worker 数收益非线性，12 路最优，16/20 反而变慢**。这印证瓶颈是环境搭建+模块导入而非 CPU 核数——加更多 worker 只是增加更多重复的 babylon-mmd 编译并争抢内存/IO。`minWorkers=12` 预热满池，省去动态扩容开销。

- 收益：**37.5s → 32.6s（省 13%）**，2707 用例全绿，零副作用。
- 落地后 environment 325s→139s、import 296s→136s（固定 worker 数避免反复起停的重复搭建）。

### Phase 2（实施中）— 清理测试污染以启用 `isolate: false`

开 `--no-isolate`（同 worker 内复用环境、不重建）实测降到 **23.7s（省 37%）**，但触发 **246 个失败**。逐一验证确认：**没有一个是业务代码 bug，全部是"测试卫生"债**——测试之间未做到「自己产生的副作用自己清理」，属 AGENTS.md 审核准则中的「隐式状态写入」反模式，测试代码自身大面积中招。

单独 `--no-isolate` 跑失败文件（如 `audio.volume.test.ts` + `backend.extract.test.ts`）为 **0 失败**，证明失败是**执行顺序相关的状态污染**，而非文件自身缺陷。

失败根因四类（全量 `reporter=json` 聚合，共 46 个文件受影响）——**注：下表为最初假设，最后一列「修复方向」已被 Phase 2 实测推翻，见后文**：

| 数量 | 报错特征 | 根因 | ~~最初设想的修复方向（已证伪）~~ |
|------|---------|------|---------|
| 43 | `Cannot read properties of undefined (reading 'mockReset')` | mock 顺序依赖：对象在别处被提前 reset | ~~`afterEach` 内还原，或改 `vi.hoisted`~~ |
| 48 | `No "envState"/"modelManager"/"mmdRuntime" export is defined on the mock` | 同模块被多文件 `vi.mock` 成不同形状 | ~~统一 mock 形状 / `vi.resetModules`~~ |
| 53 | `IndexedDB 不可用` / `window is not defined` / `window.removeEventListener is not a function` / `SpeechSynthesisUtterance is not defined` | 误判为 happy-dom 环境残留；实为**模块单例 mock 穿透**（见下） | ~~`afterEach` 恢复 window 全局~~ |
| 16 | `Quaternion.FromEulerAngles is not a function` / `createMaterialContext` null | Babylon 全局 mock 被某文件覆写未恢复 | ~~集中 mock + 还原~~ |

### Phase 2 实测纠错（2026-07-31）— 「统一 mock 形状」被证伪，真根因是模块单例穿透

以 `IndexedDB 不可用` 一类（原判为「happy-dom 环境残留」）作试点下钻，得到**推翻上表修复方向**的硬证据：

1. **形状收口无效**：`backend-mocks.ts` 早已提供单源 `makeIdbMock()` 工厂、11 个 backend 文件也已收口到统一形状（HEAD 基线即如此）。但在此完整收口的前提下，`--no-isolate` 下 `IndexedDB 不可用` 失败**不减反增**（20→62）。
2. **stack trace 铁证穿透**：失败调用栈显示 `at .../backend/idb.ts:63 → openDB → 抛 IndexedDB 不可用`——即调用穿透到了**真实 `idb.ts`**，而非命中任何 mock。
3. **机制还原**：`isolate: false` 下 `./idb` 模块全 worker **只解析/ mock 一次**；`browser-adapter.ts` 顶层静态 `import ... from './idb'` 且 `browserAdapter` 是 `export const` 单例，**绑定的是首个加载它的文件所注册的 mock**。后续文件无论把自己的 `vi.mock('./idb')` 写成什么形状，都无法让已加载的单例重新绑定 → 谁没「赢」谁就穿透到真实模块。

**结论**：文件级 `vi.mock` + `afterEach` 还原 + 统一形状，这套方案对「模块级单例被顶层静态 import」的依赖**根本无效**——形状对不对都不影响穿透。这解释了为何 `isolate: true` 全绿（每文件独立 registry）而 `isolate: false` 崩（共享 registry 只 mock 一次）。

### Phase 2 修正后方案 — 关键单例模块的 mock 必须全局化

真正的解法是**把关键单例模块的 mock 从「每个文件各自 `vi.mock`」上移到全局 setup（`src/__tests__/setup-wails.ts`）做一次**，使全 worker 共享同一份 mock 实例，从源头消除「首个加载者绑定」的顺序敏感性。

- **候选全局化模块**（被顶层静态 import 的单例、且被多文件 mock）：`@/core/backend/idb`、`@/core/config`、`@/scene/scene`。
- **前置 spike**：先在 `setup-wails.ts` 试 `vi.mock('@/core/backend/idb', ...)` 一个模块，`--no-isolate` 验证其 IndexedDB 类失败清零、且不破坏 `isolate: true` 现状，再决定是否推广其余两个。
- **风险**：全局 mock 会影响**所有**测试文件（包括需要真实实现的少数）；spike 需确认这类文件可用 `vi.unmock` / `importActual` 局部逃生。
- **形状收口仍保留**：`makeIdbMock()` 等单源工厂对 `isolate: true`（当前 CI 模式）是纯卫生增益，且为全局化提供现成形状，不回退。

原「先做 happy-dom 残留 53 个」的试点计划**作废**（该分类本身是误判）。新试点：**idb 模块全局化 spike**。目标不变：全部落地后开 `isolate: false`，**32.6s → ~24s（相对原始 37.5s 累计省 ~36%）**。

### Phase 2 spike 结果（2026-07-31，commit 0cc64abe）— 方向成立，超预期

在 `setup-wails.ts` 全局 mock **单个** idb 模块（`vi.mock('@/core/backend/idb', ...)`，双层 store Map 实现），实测：

| 指标 | spike 前 | spike 后 | 结果 |
|------|---------|---------|------|
| IndexedDB 类失败（no-isolate） | 62 | **0** | 清零 |
| 总失败（no-isolate） | 246 | **113** | 腰斩 54% |
| isolate=true 全量 | 全绿 | **4135 全绿** | 零回退 |
| config-store / chat-store | — | **20/20** | 本地 mock 覆盖生效 |
| lint + tsc | — | 通过 | — |

**三个关键假设全部验证成立**：
1. `@/core/backend/idb` 与 backend 文件的相对路径 `./idb` 被 vitest 视为同一模块 → 全局 mock 成功覆盖。
2. 文件级 `vi.mock` 优先级高于 setup → config-store（spy 断言）/ chat-store（独立桶）自动逃生，无需 `vi.unmock`。
3. 全局化单模块即连锁清掉一大批失败（不止 idb 自己的 62 个，总数 246→113）。

**结论**：「关键单例模块 mock 全局化」是正解。剩余失败为 config/scene/babylon 同源类，待推广同手法。

### Phase 2 回退发现与修正（2026-07-31）— 全局 mock 必须复用共享存储

spike 初版用**自造双层 `__idbGlobalStore`** 作全局 mock 的内存实现，埋下回退：`browserAdapter` 单例在 no-isolate 下绑定到全局 mock 后，`backend.*` 测试往**另一套** `idbStore`（backend-mocks 的单例）播种的数据，全局 mock 读不到 → `readFileBytes` 回退为 `null`，backend 6 个文件在 no-isolate 全量下红（单独跑全绿，典型顺序污染）。

**修正**：全局 mock 不自造存储，改为 `await import('@/core/backend/backend-mocks')` 复用单源工厂 `makeIdbMock()`（基于单例 `idbStore`）。如此无论 `browserAdapter` 单例绑定到全局 mock 还是文件级 `makeIdbMock()`，播种皆可见，backend 测试的 `resetIdb()` 也清的是同一份存储。修正后：

| 指标 | 结果 |
|------|------|
| isolate=true 全量 | **243 文件 / 4135 全绿**（零回退，含 config-store/chat-store） |
| backend 系列 no-isolate 单跑 | **11 文件 / 95 全绿** |
| eslint（setup-wails.ts） | 通过 |

**教训**：全局 mock 的内存实现若与文件级 mock 各用一套存储，单例绑定到全局 mock 后会切断文件级播种的可见性。**全局化必须复用既有单源工厂/共享存储，而非另起炉灶**——这与 AGENTS.md「通用化、统一、复用已有函数」的取向一致。

### Phase 2 新顽疾（2026-07-31）— no-isolate 「收集期崩溃」致用例蒸发

no-isolate 全量两次实测：文件数恒为 243，但**用例总数从 isolate=true 的 4135 掉到 ~2682（蒸发 ~1453）**。蒸发的用例既非 passed 也非 failed——前置文件污染共享 worker 的模块状态后，后续文件的 `describe`/顶层 import 在**收集期**就抛错，整批用例不计入报告。这意味着「no-isolate 失败数」是**不稳定指标**（部分失败滑成了未收集），不能单看失败数下降就判定进展。真正可靠的真相锚是 isolate=true 全量（稳定、当前 CI 模式）。收集期崩溃与单例穿透同源（共享 registry），但更深一层，需在推广全局化时一并观察是否缓解。

### Phase 2 判定收口（2026-08-01）— 决策 C：两债不同源，isolate=false 结构性降级

「收集期崩溃」顽疾触发了一次**有界诊断**（时间盒：单次诊断会话，产出 `crash-nocache.log` + `zz-*` 探针 + 两次全量对拍），目标是回答唯一 gate 问题：**收集期崩溃与单例穿透是否同源、按 B 全局化推广后是否仍会发生**。结论如下。

**探针铁证（`crash-nocache.log`，2026-08-01）：**

- `PROBE_EVAL_A/B: 1`：`zz-marker-a/b` 两文件同读共享模块 `zz-src-mod`，顶层 eval 计数恒为 1 → 共享 worker 内模块只解析一次，单例穿透机制实锤。
- `PROBE_COLLECT_WINDOW_BROKEN typeof=object addEventListener=undefined`：`zz-probe-window` 在**收集期**发现 `window` 存在但 `addEventListener` 被掏空 → 「用例蒸发」的直接根因：后续文件顶层 import 链（`dom.ts:74 addDisposableListener` ← `load-refresh-registry.ts:61` ← `env-menu.ts:70` ← `menu-schema-register.ts:16`；以及 `scene-serialize.ts:1428`）在收集期调用 `window.addEventListener` 即抛错，整文件 0 test 蒸发。
- 全量对拍不稳定实锤：两次 no-isolate 全量用例数 **2590 vs 4113**（isolate=true 基线 4135）——蒸发量跑两次都不一样，「no-isolate 失败数不可信」从推断升级为实测。

**污染源归属（grep 定位）：** 测试文件对 `window` 的**裸全局修改**未还原泄漏进共享 worker：

- `browser-adapter.fsa-auth.test.ts`：`globalThis.window = { showDirectoryPicker, showOpenFilePicker }` —— **形状与探针报错完全吻合**（无 `addEventListener`）；
- `dialogue-speech.test.ts`：`delete globalThis.window`。

**判定：两债不同源，B 救不了收集期蒸发。**

| 债 | 特征 | 全局化（B）能否解决 |
|----|------|--------------------|
| 执行期污染（~287 失败：audio/model-ops/playback/env-* 等） | 模块单例穿透 + 状态残留 | ✅ 能继续压（idb 已验证路径） |
| 收集期蒸发（0-test 文件：schema-snapshot、model-preset.serialize、scene-serialize 系列） | 测试裸改 `window` → 共享 worker 泄漏 → 后续文件顶层副作用收集期抛错 | ❌ **不能**——全局化 config/scene/babylon mock 拦不住测试对 `window` 的裸写 |

**结构性结论**：no-isolate 下 `window` 是单点故障——任何一个测试的裸全局修改，都能让后续所有顶层碰 window 的文件（`scene-serialize.ts:1428`、`env-menu.ts:70` 的顶层副作用）整批蒸发。这不是「再清几个文件」的卫生债，而是「共享 worker + 裸全局修改 + 生产模块顶层副作用」三者的结构性不兼容。要根治需同时满足「所有测试严格还原 window」+「生产模块去顶层副作用」两件事，而收益仅省 ~37% 且随时可被新测试重新引爆，**ROI 为负**。

**收口决定：**

1. **isolate=false 降级为「非目标」，不采纳**：不写入 `vitest.config.ts`；Phase 1 的 `maxWorkers: 12` 收益（37.5s→32.6s）保留。
2. **B 降级为执行期污染的增量清偿**：config/scene/babylon 全局化可继续推进以压低 no-isolate 执行期失败（亦是 isolate=true 模式下的卫生增益），但**不再作为 isolate=false 的前置承诺**；config 的 god-barrel（6 种 mock 形状 + 4 个状态 store）ROI 存疑，暂缓。
3. **真相锚不变**：isolate=true 全量（4135 全绿）是唯一可信指标；no-isolate 失败数/蒸发量均不作为进展度量。
4. **ADR-219 收口为「已完成」**：Phase 1 + Phase 2 idb 全局化已落地，isolate=false 经判定不采纳——不是「债没还完」，而是「这个目标被判定不值得要」，明确写下防止后人再踩。
5. 诊断产物（`zz-*` 探针、`crash-nocache.log`、全量对拍 json）为一次性证据，**不入库**。

### Phase 2 收口修订（2026-08-01）— 污染源全部定位并修复，收集期崩溃清零

上文「判定收口」对收集期崩溃的定性**部分被硬证据推翻**，本小节为准：

**污染源修正（二分定位 + 单文件复现，`zz-probe-window` 为检测器，`--no-cache` 稳定顺序）：**

- **`browser-adapter.fsa-auth.test.ts` 不是污染源**（上文误判）——它有顶层 `realWindow` 捕获 + afterEach 恢复（line 37-45），单跑 10/10 全过；且排第 139 位，晚于崩溃起点。列为**受害者**而非污染源。
- **真凶共 4 个文件**（均为「裸改 window 无 afterEach 恢复」）：
  1. `src/core/ai/__tests__/dialogue-speech.test.ts` — afterEach `delete globalThis.window`（4 处），`window is not defined` 直接根因；
  2. `src/core/backend/backend.fsa.test.ts` — `setWindow({showDirectoryPicker,...})` 替换 window 无恢复；
  3. `src/core/backend/backend.capabilities.test.ts` — `setWindow(undefined)` / `setWindow({})` 无恢复；
  4. `src/core/backend/backend.resolve.test.ts` — `setWindow(undefined)` 无恢复。
- `setWindow` 实现（`backend-mocks.ts:9-11`）直接 `globalThis.window = w`；isolate=false 单 worker 下 `window === 共享 globalThis`（vitest `populateGlobal` 设 `global.window = global`，line 274），裸写后永久残留。

**修复**（commit dcf32da8）：4 文件统一改为 fsa-auth 模式——顶层捕获 `realWindow`，afterEach `if (realWindow===undefined) delete window else window = realWindow`，并保留其余清理。

**修复后验证（硬数据）：**

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| no-isolate 0-test 收集期崩溃 | 23 | **0** |
| no-isolate 用例总数 | 4000（蒸发 138） | **4138（= isolate=true 基线，零蒸发）** |
| isolate=true 全量 | 4135 全绿 | **246 文件 / 4138 用例全绿，零回归** |
| `npm run check` | — | EXIT=0 |

**判定修订：**

- 「收集期崩溃是结构性不兼容、ROI 为负」**不成立**——收集期崩溃就是这 4 个文件的 window 污染 bug，修完即清零，非「再清几个文件也拦不住」。
- `isolate=false` **仍不采纳**，但理由更新：剩余 **230 个执行期失败全是 vi.mock 跨文件泄漏**（19+ 文件 `vi.mock core/state`/`scene/scene` 形状各异，单例穿透，isolate=false 固有特性，vitest 官方亦警告）。这是「模块级单例 mock 穿透」债（上文「判定收口」中已定性），与 window 污染**不同源**：收集期崩已根治，执行期污染债 ROI 低（需形状收口 + 全局化组合拳），入测试卫生清单待后续增量清偿。
- 真相锚不变：isolate=true 全量（4138 全绿）是唯一可信指标。

**Phase 2 二次证伪（2026-08-01，scene 超集实验）：**

- 对剩余 vi.mock 泄漏做「形状超集化」尝试：新建 `frontend/src/__tests__/mocks/scene-superset.ts`（`mockModelManagerBase` 30 方法 + `sceneMockSuperset` 核心导出超集，`modelManager` 闭包稳定单实例），改造 7 个 scene mock 工厂（camera-adr100 / outfit / library-core / model-ops / perception / menu-schema / model-detail-ui）统一 spread 超集。`npm run check` EXIT=0；isolate=true 243 文件 / 4135 用例全绿零回归。
- **no-isolate 全量验证：失败 230→229，几乎无变化，No-export 反增 28→35**（漏网：`mmar-globals.test.ts` 内联 mock scene/scene 仅 3 导出；core/config mock 缺 envState×10 / setIsPlaying×7；scene/scene mock 缺 modelManager×4 / setModelWireframe / applyMatState）。漏网内联 mock 缺任一导出、一旦被其他文件源码单例绑定即崩 → 打地鼠；断言类失败（行为/返回值不对）无法靠形状修。
- **结论：isolate=false 结构性不可修二次证实**（idb 统一形状无效 + scene 超集无效）。超集改动**保留**为测试卫生增益（isolate=true 更健壮、未来可再评估 isolate=false），no-isolate 治理**收手**，残余 229 执行期失败为「模块级单例 mock 穿透」债，持续挂测试卫生清单。

**Phase 2 三次证伪（2026-08-01，core/state 全局化实验）：**

- 尝试把 core/state 全局化到 setup-wails.ts（`vi.mock('@/core/state', async () => vi.importActual('@/core/state'))`，原样返回真实 namespace 以保留 `export let focusedModelId` 的活绑定——实测 `{...actual}` spread 会断开活绑定，isolate=true 回归 22 用例）。
- **isolate=true 243 文件 / 4135 用例全绿零回归；但 no-isolate 全量失败 229 不变** → 全局 mock 只兜底「未写文件级 mock 的文件」，而 229 失败**全部来自文件级 mock 缺导出**（文件级 vi.mock 覆盖全局 mock；isolate=false 下模块身份由首个 import 它的文件的文件级 mock 决定）→ 无兜底对象、零收益。实验改动已回滚（setup-wails.ts 恢复基线）。
- **结论：isolate=false 结构性不可修三次证实**（idb 统一形状 + scene 超集 + core/state 全局化均无效）。文件级 mock 形状差异即炸弹（谁成首加载者谁崩），断言类无法形状修——no-isolate 治理彻底收手，残余 229 执行期失败挂测试卫生清单。

## 备选方案

- **`pool: 'threads'`（隔离保留）**：实测 34.9s，收益仅 ~7%；且部分 Babylon/WASM 场景在线程池下不如进程稳。不选。
- **直接开 `isolate: false` 不修污染**：快 37% 但 246 用例红、结果不可信。违背"跑得快但不干净"，不可接受。
- **无脑堆 maxWorkers 到 24（吃满全核）**：实测 16/20 已转负，24 只会更差。不选。

## 影响

- `frontend/vitest.config.ts`：Phase 1 已加 `maxWorkers: 12` / `minWorkers: 12` + 决策注释。
- Phase 2 涉及约 46 个测试文件（`src/__tests__/` + `src/core/backend/` + `src/scene/` 下），补 `afterEach` 还原 mock/window/单例；试点先改 happy-dom 环境残留类。
- ~~Phase 2 完成后再改 `vitest.config.ts` 加 `isolate: false`，并更新本 ADR 状态与收益数据。~~（2026-08-01 收口：isolate=false 经判定降级为「非目标」，不采纳，见上文「Phase 2 判定收口」）
- CI（`process.env.CI`）沿用同一配置；固定 worker 数在 CI 单核/双核环境需复核（当前 e2e workers 已按 CI 降级，单测未区分，Phase 2 一并评估）。

## 相关文档

- `frontend/AGENTS.md` — 零依赖架构与「隐式状态写入」反模式（Phase 2 根因所属准则）。
- ADR-191 — 整桶 import 触发 vitest fork worker 挂死（同属 worker/模块导入开销主题）。
- `frontend/src/__tests__/setup-wails.ts` — 全局 happy-dom + Wails mock 的 setup 入口。
