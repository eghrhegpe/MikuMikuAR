# ADR-262: Vitest isolate:false + vi.mock 污染机制、金丝雀诊断与护栏

> **状态**: ✅ 已采纳（2026-08-16）
> **日期**: 2026-08-16

## 背景

ADR-219 三次实验将 `isolate:false` 判为"结构性不可修"，但只记录了结论（"vi.mock
单例穿透"），未阐明**精确的污染机制**。这导致后续开发者在碰到同类问题时：
① 不知为何发生；② 不知如何定位；③ 不知如何防复发。2026-08-16 深度分析锁定机制，
并提炼可复用的诊断框架与静态护栏。

## 决策

### 一、精确污染机制：三个条件的合取

`isolate:false` + `vi.mock` 污染**不是单一因素**，而是**三个条件同时成立**才触发：

| 条件 | 含义 | 缺一不可 |
|------|------|----------|
| ① `isolate:false` | 所有测试文件共享同一 worker + 同一模块图 | isolate=true 每文件独立求值，无共享 |
| ② 文件级 `vi.mock` | mock 声明在测试文件内（非全局 setup） | 全局 setup mock 全 worker 唯一，无"先到" |
| ③ 被 mock 模块含**模块级可变状态** | 如 `let cache = new Map()`、`vi.hoisted` store | 纯函数模块无状态，mock 替换不影响行为 |

三者合取时，出现**"先到先得"绑定锁定**（first-file-wins binding lock）：

```
isolate:false 下执行顺序（shuffle 决定）：

文件A先跑:  vi.mock('./idb.ts')  →  A 的 mock 注册生效
            首次 import 触发 web-fs.ts 求值 → 捕获 A 的 vi.hoisted store 到闭包
            web-fs.ts 模块缓存就此冻结

文件B后跑:  vi.mock('./idb.ts')  →  B 想替换，但 web-fs.ts 已求值过
            捕获的闭包绑定不会变 → B 的 mock 静默失效
            B 的 beforeEach 清的是自己那份 store
            → 写入/读取错位
```

**关键区分**：不是"B 的 mock 静默失效"（B 的 `vi.mock` 确实注册了），而是
**"消费者已固化"**——`web-fs.ts` 顶层求值只发生一次，那次求值时闭包捕获的是当时
活跃的 mock 绑定。模块缓存冻结后，即使 B 的 mock 替换了模块导出，已有消费者持有的
闭包引用不会更新。

### 二、金丝雀诊断框架

偶发失败（flaky）不是噪音，是**信号**：

```
飘忽不定 = 顺序敏感 = 隐式时序耦合 = 共享单例上的隐式状态泄漏
```

`--sequence.shuffle` 打乱执行顺序是天然的"压力测试"：如果测试本身没改但结果随顺序
翻转，说明存在隐式时序耦合。而顺序敏感**只能发生在共享单例上**——isolate=true 下每
文件独立求值，根本不存在"谁先谁后"的问题。

**金丝雀的两个盲区**（须注意区分）：

1. **源码设计债 vs 测试抽象债**：如果模块级可变状态本是**应用级单例**（如 idb cache、
   全局配置），per-file mock 本身就是错误抽象——它假设了"每文件独立世界"，但生产里
   不存在。此时金丝雀指出的是测试与生产现实的错位，修复方向是**把测试拉回生产形状**
  （全局 setup mock），而非消除共享。如果状态**本不该是单例**（如临时计数器），
   则金丝雀指出的是源码设计债——应收敛为参数或工厂返回值，而非 globalThis 显式化。

2. **速度收益 vs 纪律税**：`isolate:false` 省掉的是每文件 happy-dom 环境重建（~285ms/
   文件）和模块图重复求值。对**只读不 mock** 的审计套件零成本；对**有 mock** 的套件
   则必须承担"全局 setup mock + 共享 store + beforeEach 显式 reset"的纪律税。

### 三、护栏模式（已落地）

对 `idb` 模块的修复（`setup-wails.ts:104-118`）是护栏模式的教科书实例：

```typescript
// setup-wails.ts — 全局 setup 一次性注册
vi.mock('@/core/backend/idb', async () => {
    const { makeIdbMock } = await import('@/core/backend/backend-mocks');
    return makeIdbMock();
});
```

```typescript
// backend-mocks.ts — 单源工厂，基于共享 idbStore
export const idbStore = new Map<string, unknown>();  // 全局单例

export function makeIdbMock() {
    return {
        idbGet: vi.fn(async (_store, key) => idbStore.get(key)),
        idbSet: vi.fn(async (_store, key, val) => idbStore.set(key, val)),
        // ...全 7 个导出
    };
}
```

**护栏三要素**：
1. **全局 setup 唯一 mock 入口**：禁止测试文件内重复 `vi.mock` 同一模块（除非需要差异化
   形状且显式声明理由，如 `config-store.test.ts` 用 `vi.resetModules()` + 动态 import
   做 per-test 隔离）。
2. **共享 store 单源**：`idbStore` 是模块级 `const` 单例，所有 mock 实例读写同一存储。
3. **beforeEach 显式 reset**：每个用例 `resetIdb()` / `resetMem()` 清空共享存储，
   防止跨用例状态泄漏。

### 四、可编码纪律

> **isolate:false 与 per-file vi.mock 互斥。** 二选一：
> - 用 `isolate:false` → 所有 mock 必须在 `test-setup` 全局注册，禁止文件内
>   `vi.mock`（差异化需求走 `vi.doMock` + `vi.resetModules` 模式），共享 store
>   挂 `globalThis` 约定键并在 `beforeEach` 显式 reset。
> - 用 per-file `vi.mock` → 该 suite 必须跑在 `isolate:true`（默认）。

配套静态检查：`npm run check:test-pollution`（`scripts/check-test-pollution.mjs`）
扫描所有 `.test.ts` 文件，检测：
- 文件级 `vi.mock` 与 setup 全局 mock 指向同一模块（冗余，warn）
- 文件级 `vi.mock` 与 setup 全局 mock 指向同一模块但工厂不同（形状漂移，warn）

## 备选方案

- **维持现状，靠人工记忆**：ADR-219 已判死 isolate:false，但后端 7 个测试文件仍保留
  冗余 per-file `vi.mock('./idb')`——靠"大家记得用 makeIdbMock"维持一致性，无静态
  护栏，新人或 AI 容易误改。弃。
- **退回到 isolate=true 掩盖**：ADR-219 已确认 isolate=true 下无此问题（每文件独立
  求值），但墙钟税太高（~285ms/文件 happy-dom 重建 × 数百文件），且掩盖而非解决。
  弃。

## 影响

- **新增**：`scripts/check-test-pollution.mjs`（静态检查 CLI，warn 不阻断）。
- **清理**：7 个后端测试文件（`backend.*.test.ts`）移除冗余 `vi.mock('./idb',
  () => makeIdbMock())`，依赖 setup-wails.ts 全局 mock；import 语句同步清理
  `makeIdbMock` 引用。
- **文档**：`docs/knowledge/core-backend.md` 补充全局 mock 机制说明；
  `frontend/AGENTS.md` §2.3 补充"先到先得绑定锁定"铁律。
- **无行为变化**：全局 mock 与 per-file mock 使用同一 `makeIdbMock()` 工厂，读写同一
  `idbStore`，测试行为不变。

## 五、实证：isolate:false 技术债务扫描（2026-08-16）

ADR-219 判 isolate:false "结构性不可修"，但未说清**哪些债务在污染**。本节用
`isolate:false` 作为金丝雀扫描器，四轮实验（3 轮 shuffle + 1 轮无 shuffle）定位
隐性时序耦合的分布与性质。

### 实验设置

| 轮次 | 命令 | 失败用例 | 失败文件 | 墙钟 |
|------|------|---------|---------|------|
| 基线 | `test:unit`（isolate:true，4 workers） | **0** | **0** | 63.43s |
| R1 | `test:unit --no-isolate --sequence.shuffle` | 65 | 12 | 26.60s |
| R2 | `test:unit --no-isolate --sequence.shuffle` | 59 | 10 | 25.46s |
| R3 | `test:unit --no-isolate --sequence.shuffle` | 61 | 11 | — |
| R4 | `test:unit --no-isolate`（无 shuffle） | 108 | 12 | 26.70s |

### 交叉比对结果：稳定 vs 飘移

四轮失败文件按出现频次分类：

| 类别 | 轮次命中 | 文件数 | 文件列表 | 性质 |
|------|---------|--------|---------|------|
| **🔴 稳定失败** | 4/4 | **6** | `camera.test.ts` / `library-core.test.ts` / `library-thumbnail-streaming.test.ts` / `lighting-stage.test.ts` / `mmd-adapter.contract.test.ts` / `model-manager.test.ts` | 结构性债务：与执行顺序无关，模块级单例状态（`env-context._scene`、engine 实例、observable 订阅）被共享后必然泄漏 |
| **🟠 强信号** | 3/4 | **5** | `env-ground.test.ts` / `lighting-follow.test.ts` / `performance-snapshot.test.ts` / `playback.observables.test.ts` / `thumbnail-capture.test.ts` | 结构性 + 顺序叠加：共享状态污染存在，但某些顺序下恰好不被触发 |
| **🟡 飘移失败** | 1/4 | **6** | `init.test.ts` / `library-actions.test.ts` / `motion-modules-registry.conflict.test.ts` / `motion-modules-registry.param.test.ts` / `motion-modules-registry.side-hooks.test.ts` / `water-preset-repro.test.ts` | 纯顺序敏感：是 ADR-262 金丝雀视角真正捕获的目标 |

**无中间态**（无 2/4 轮文件）——债务分布很干净：要么与顺序无关（结构性），要么
与顺序强相关（飘移），没有"偶尔碰巧"的灰色地带。

### 诊断公式

```
稳定失败（4/4轮）  =  模块级单例状态泄漏     →  需要源码重构（参数化/DI/工厂）
强信号（3/4轮）    =  结构性污染 + 顺序屏蔽    →  结构性修 + 可暂不处理
飘移失败（1/4轮）  =  纯顺序敏感                →  金丝雀真正指向的 bug，优先修
```

R4（无 shuffle）失败数 **108** 反而最多，说明某些固定执行顺序下积累的污染更集中
（如 `camera.test.ts` 75/75 全挂——前序测试 dispose 了 engine，camera 测试的
`initCameraSystem` 拿不到引擎）。shuffle 反而打散了某些污染路径，让部分用例"侥幸"
通过。这印证了 ADR-262 §一的"三条件合取"公式：**隔离税消掉后，模块级单例状态
这个第四条件才是真正的主污染源**。

### 与 ADR-219 判死的修正关系

- **ADR-219 结论保留**：`isolate:false` 在当前代码库不可用。
- **ADR-219 理由修正**：原表述"vi.mock 单例穿透结构性不可修"——实际 vi.mock 只是
  入口（入口污染 3300 用例），深层污染源是**模块级单例状态**（`env-context._scene`、
  engine 实例、observable 订阅），vi.mock 修复后从 3300 降到 60~110 用例，但结构性
  债务仍在。ADR-262 的护栏（全局 setup mock + per-file mock 纪律）只覆盖入口层，
  深层债务需要源码级重构（参数化 / DI / 工厂模式）。
- **速度收益真实但代价沉重**：26s vs 63s = 2.4 倍加速，但 60~110 用例（1~2%）失败
  且 shuffle 下不可预测。这是"用不确定性换速度"，不值得。

### 技术债务清单（待修，优先级按出现频次）

| 优先级 | 文件 | 根因推断 | 修复方向 |
|--------|------|---------|---------|
| P0 | `camera.test.ts` | engine 实例被前序测试释放 | 每个用例独立 initCameraSystem + disposeCameraSystem（当前已有但跨文件泄漏） |
| P0 | `library-core.test.ts` | modelRegistry/uiState 模块级单例 | 用例级 reset，或改 DI 注入 |
| P0 | `model-manager.test.ts` | mmdRuntime 模块级单例 | 用例级 createMmdRuntime + disposeMmdRuntime |
| P0 | `lighting-stage.test.ts` | 场景灯注册表跨文件共享 | 用例级创建独立 scene + disposeLighting |
| P1 | `env-ground.test.ts` | `env-context._scene` 被前序测试置空 | 用例级 initScene 保证，或改工厂返回 |
| P1 | `playback.observables.test.ts` | observable 订阅状态跨文件累积 | 用例级 unsubscribe + reset |
| P1 | `mmd-adapter.contract.test.ts` | mmdRuntime 跨文件共享 | 用例级独立 runtime |
| P2 | `motion-modules-registry.*` | 模块启用状态跨文件累积 | 用例级 setModuleEnabled(false) 或 reset |
| P2 | `library-thumbnail-streaming.test.ts` | 缩略图缓存跨文件共享 | 用例级 clearThumbnailCache |
| P3 | `water-preset-repro.test.ts` / `init.test.ts` | 仅特定顺序触发 | 金丝雀观察，暂不处理 |

## 相关文档

> ADR-219 测试并发调优与 isolate 污染治理（isolate=false 判死依据）
> ADR-256 性能导向的单测文件组织（协同：合并降依赖图税）
> `frontend/src/__tests__/setup-wails.ts:104-118`（idb 全局 mock 落地）
> `frontend/src/core/backend/backend-mocks.ts`（单源 idbStore + makeIdbMock 工厂）
> `scripts/check-test-pollution.mjs`（静态护栏 CLI）