# ADR-219: 测试并发调优与 isolate 污染治理 — vitest 全量提速：maxWorkers 落地 + isolate=false 障碍清理

> **状态**: 实施中（2026-07-31；Phase 1 已落地省 13%；Phase 2 方案经实测纠偏——「统一 mock 形状」证伪，改走「关键单例模块 mock 全局化」，待 idb spike 验证）
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

**结论**：「关键单例模块 mock 全局化」是正解。剩余 113 个失败为 config/scene/babylon 同源类，待推广同手法（`@/scene/scene` 已有共享 `mockScene()` helper，收敛更易）。

## 备选方案

- **`pool: 'threads'`（隔离保留）**：实测 34.9s，收益仅 ~7%；且部分 Babylon/WASM 场景在线程池下不如进程稳。不选。
- **直接开 `isolate: false` 不修污染**：快 37% 但 246 用例红、结果不可信。违背"跑得快但不干净"，不可接受。
- **无脑堆 maxWorkers 到 24（吃满全核）**：实测 16/20 已转负，24 只会更差。不选。

## 影响

- `frontend/vitest.config.ts`：Phase 1 已加 `maxWorkers: 12` / `minWorkers: 12` + 决策注释。
- Phase 2 涉及约 46 个测试文件（`src/__tests__/` + `src/core/backend/` + `src/scene/` 下），补 `afterEach` 还原 mock/window/单例；试点先改 happy-dom 环境残留类。
- Phase 2 完成后再改 `vitest.config.ts` 加 `isolate: false`，并更新本 ADR 状态与收益数据。
- CI（`process.env.CI`）沿用同一配置；固定 worker 数在 CI 单核/双核环境需复核（当前 e2e workers 已按 CI 降级，单测未区分，Phase 2 一并评估）。

## 相关文档

- `frontend/AGENTS.md` — 零依赖架构与「隐式状态写入」反模式（Phase 2 根因所属准则）。
- ADR-191 — 整桶 import 触发 vitest fork worker 挂死（同属 worker/模块导入开销主题）。
- `frontend/src/__tests__/setup-wails.ts` — 全局 happy-dom + Wails mock 的 setup 入口。
