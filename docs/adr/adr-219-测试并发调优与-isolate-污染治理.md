# ADR-219: 测试并发调优与 isolate 污染治理 — vitest 全量提速：maxWorkers 落地 + isolate=false 障碍清理

> **状态**: 实施中（2026-07-31）
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

失败根因四类（全量 `reporter=json` 聚合，共 46 个文件受影响）：

| 数量 | 报错特征 | 根因 | 修复方向 |
|------|---------|------|---------|
| 43 | `Cannot read properties of undefined (reading 'mockReset')` | mock 顺序依赖：对象在别处被提前 reset | `afterEach` 内还原，或改 `vi.hoisted` |
| 48 | `No "envState"/"modelManager"/"mmdRuntime" export is defined on the mock` | 同模块被多文件 `vi.mock` 成不同形状，共享后注册表串了 | 统一 mock 形状 / `vi.resetModules` |
| 53 | `IndexedDB 不可用` / `window is not defined` / `window.removeEventListener is not a function` / `SpeechSynthesisUtterance is not defined` | happy-dom 环境残留：`delete window.xxx` 后不还原 | `afterEach` 恢复 window 全局 |
| 16 | `Quaternion.FromEulerAngles is not a function` / `createMaterialContext` null | Babylon 全局 mock 被某文件覆写未恢复 | 集中 mock + 还原 |

推进策略：**先做污染最集中的一类（happy-dom 环境残留，53 个）作为试点**，验证修复模式跑通、收益可量化后再铺开其余三类。全部清理后开启 `isolate: false`，目标 **32.6s → ~24s（相对原始 37.5s 累计省 ~36%）**。

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
