# ADR-271: 文件级 SCC 拆分——IoC 挂载、菜单状态叶子、barrel 转发收口

> **状态**: ✅ 已采纳（2026-10-24）
> **日期**: 2026-10-24

## 背景

ADR-269 确立了判读口径：耦合看**文件级强连通分量（SCC）**，不看代表环数。ADR-270 把三个指标做成只许收紧的棘轮门禁（`modulePairs` / `fileSccFiles` / `fileSccMax`）。

基线（ADR-270 落地时）：模块对 62 / SCC 12 个覆盖 **56** 文件 / 最大 **9**。

本 ADR 处理其中 4 个真实 SCC。它们不是同一个病因，需要三套手法：

| SCC | 规模 | 形态 | 病因 |
|-----|------|------|------|
| `scene/env/*` | 9 | 星形 | 5 个子系统都要调 `ensureEnvUpdateObserver()`，只能向上 import 调度器 |
| `menus/motion-*` | 9 | 双星 | 8 个 `motion-*-levels` 都要 `getMotionMenu()`，`motion-popup` 又要它们的 builder |
| `menus/library-*` | 8 | 星形 | `library-core` 末尾三块 re-export 指向本来就要 import 它的三个文件 |
| `scene/motion/motion-modules` | 6 | 星形 | `registry` 收集 5 个模块的 DEF，5 个模块都要 `getModuleState()` |

共同点：**hub-and-spoke 的 spoke 需要 hub 的「读」能力，hub 需要 spoke 的「值」**。这类环不是逻辑纠缠，是注册方向与读取方向相反。

## 决策

### 决策 1：`scene/env` 的观察器挂载改走请求式 IoC

`env-impl` 把 `ensureEnvUpdateObserver` 注册进 `env-dispatcher` 的 handler 集合，子系统改调 `requestEnvObserver()`。dispatcher 是叶子（无 env 内部出边），子系统不再依赖调度器。

```ts
// frontend/src/scene/env/_bridge/env-dispatcher.ts
const _envObserverHandlers = new Set<() => void>();
export function registerEnvObserverHandler(fn: () => void): () => void { ... }
export function requestEnvObserver(): void { for (const fn of _envObserverHandlers) { try { fn(); } catch (e) { ... } } }
```

`env-impl` 侧 `registerEnvObserverHandler(() => ensureEnvUpdateObserver());`（函数声明提升，注册可放在定义之前）。

同时 `env-particles.ts` 的 `addRipple`/`addGroundRipple`/`getGroundHeightAt` 改直连 `env-water-fx.ts` / `env-ground.ts`（`env.ts:69`/`:85` 原本只是转发）。

**结果：`scene/env` 的 SCC 从 9 缩到 3。**

### 决策 2：`menus/motion-*` 的菜单实例抽成状态叶子

新建 `frontend/src/menus/motion-menu-state.ts`——与既有 `env-menu-state.ts` 同构的手法（该文件注释自述「从 env-menu.ts 拆分，切断 env-menu ↔ env-feature-levels 双向 import」）。

**关键细节：存 getter 而非实例。** 菜单由 `registerPopupMenu` 的 `buildRoot` 惰性构建，模块加载期求值 `_popupGetMenu()` 会永久拿到 `null`：

```ts
let _getMotionMenu: (() => SlideMenu | null) | null = null;
export function setMotionMenuGetter(fn: (() => SlideMenu | null) | null): void { _getMotionMenu = fn; }
export function getMotionMenu(): SlideMenu | null { return _getMotionMenu?.() ?? null; }
```

`refreshMotionRoot` 同理：它由 `registerPopupMenu` 生成、依赖 popup 内部状态，不能下移，改为 `setRefreshMotionRoot` 写入委托。

`motion-override-levels` 原本还经 popup 借 `renderModuleToggleList`（真实定义在 `motion-binding-ui.ts:59`），一并改直连——这是该环的第二条来源。

**结果：`menus/motion-*` 的 SCC 从 9 缩到 8（与 library 组并列最大）。**

### 决策 3：`menus/library-*` 删掉 `library-core` 的转发块

`library-core.ts` 末尾三块 `export { ... } from './library-browse' | './library-actions' | './library-setup'` 是纯向后兼容转发，但这三个文件本来就 import `library-core` ——转发边正好把「core ↔ 三者」闭合成环。

删除后消费者改直连真实定义处：`settings-resources.ts` → `./library-setup`、`library.ts` → `./library-browse` + `./library-setup`、`plaza-download.ts` → `./library-setup`。

**结果：`menus/library-*` 的 SCC 从 8 缩到 4。**

### 决策 4：`scene/motion/motion-modules` 拆出 `registry-core` 状态机叶子（后续补充）

`registry` 原用 `getBuiltinModuleDefs()` 在 `initMotionModules()` 调用时读取 5 个模块的 DEF，正是为规避求值顺序 TDZ 而特意延后的（原 `registry.ts:502-518` 注释）。因此不能简单反转依赖——那会让注册表在装配层未加载时为空。

拆法：把**状态机**整体搬到 `registry-core.ts`（不含任何 DEF import），装配层 `registry.ts` 只保留「聚合 DEF + 幂等注册 + 注入钩子」三件事，并用 `export * from './registry-core'` 保持对外 API 完全不变。5 个消费者（4 个 DEF 工厂 + `module-base` + `preset-types`）改从 `registry-core` 取状态机。

`initMotionModules` 的 4 处幂等兜底调用点（`createModule` / `getModuleState` / `setTargetModel`）改为 `_ensureInit()`——状态机不再知道 DEF 存在，改由 `registerInitHook` 注入。**加载顺序契约**：若状态机先于装配层被使用，`_ensureInit()` 挂起请求，`registerInitHook` 注入时立即补执行。这条契约有专门的回归测试 `__tests__/scene/motion-modules-registry-core-order.test.ts` 锁死——测试特意**不调用** `initMotionModules()`，也不调用任何会走 `_ensureInit` 的函数，否则「钩子注入后任一次兜底都能注册」会把补执行的缺失掩盖掉（初版测试就是这样假绿的）。

**结果：`motion-modules` 的 SCC 从 6 元缩到 0（拆散），全仓最大 SCC 从 6 缩到 4。**

## 备选方案

**A. `scene/env` 五个子系统直连 `env-impl`**（而非走 dispatcher）。否决：`env-impl` 本身被 `env.ts` import，直连会让 `env-particles ↔ env-impl` 等新二元环冒出来（实测变体 V1：SCC 覆盖 52 文件，env 内部裂成 size=3 + size=2 两块）。走 dispatcher 的语义也更正确——子系统不该知道观察器实现在哪。

**B. `env-particles` 保留 `→ env.ts` 只把 observer 调用改走 dispatcher**（变体 V3）。指标与 V2 相同（12/50/max9），但粒子仍依赖门面，且 `addRipple` 本来就在 `env-water-fx.ts` 里，没有理由绕道。选 V2。

**C. 把 `getMotionMenu` 改成 `ui-action-bridge` 槽位**。否决：`motion-*-levels` 在模块加载期就调用它（多个文件的 `const menu = getMotionMenu()` 在函数体内，但 `motion-gaze-levels.ts:31` 等处在构建期），走桥会在注册顺序上引入新的时序脆弱性。状态叶子是同步可用的。

**D. `library-core` 的转发加 `@deprecated` 注解保留**。否决：注解不改变图结构，环照旧。向后兼容的价值在实测中为零——全仓非测试消费者只有 `settings-resources.ts` 一处。

**E. 直接把 4 个 SCC 全部推平**。否决：`motion-modules` 组的 DEF 聚合是为求值顺序服务的，强行反转依赖会复活「测试先 import hand-modules 再 import registry → DEF 为 undefined」这个已修复的 bug。后续补充的决策 4 走了另一条路——保留 DEF 聚合，只把状态机抽成叶子，故该风险不成立。

**F. 只改 4 个 DEF 工厂的 import 方向，不拆文件**。否决：`registry-core` 不存在时，DEF 工厂与 `registry` 必然互指；改 import 方向不改变图结构，必须先拆出叶子。

## 影响

### 度量变化（`node scripts/dep-metrics.mjs` / `check-coupling.mjs` 实测）

| 指标 | ADR-270 基线 | 决策 1-3 后 | 决策 4 后 | 决策 5-8 后（当前） |
|------|-------------|-------------|-----------|--------------------|
| 模块对 | 62 | 62（不变） | 62（不变） | **62（不变）** |
| SCC 个数 | 12 | 12 | 10 | **4** |
| SCC 覆盖文件 | 56 | 39 | 27 | **8** |
| 最大 SCC | 9 | 6 | 4 | **2** |
| 文件级依赖边 | 1802 | 1802 | 1802 | 1809 |
| 代表环 | 551 | 551 | 551 | **551（不变）** |

模块对与环数全程不变——这是有意的：ADR-269 已证明环数是折叠假象，本 ADR 只动真实结构指标。**每一条改动都满足「不新增跨模块有向对」这条硬约束**（ADR-270 门禁会拦）。

`check:coupling` 基线随之从「62 / 12 个覆盖 56 文件 / 最大 9」一路收紧到「62 / 4 个覆盖 8 文件 / 最大 2」——跨模块通道一条没多，纠缠面压到 1/7，最大分量压到 2（只剩互指，没有任何三元以上纠缠）。

### 决策 5-8 摘要（后续补充）

| 决策 | 动作 | 结果 |
|------|------|------|
| 5 | `_effectiveBumpLevel` 下移 `scene/env/_shared/ground-bump.ts`；三个地面 setter 走 `_bridge/ground-dispatcher.ts`；autodance 节拍工具抽 `proc-motion-autodance-beat.ts` | 22→21 文件 |
| 6 | 视线追踪骨架（钳制 + 写入策略 + `*_GazeCore`）抽 `perception-gaze-core.ts`，js/wasm 直连 core | 21→18 文件，size=3 解散 |
| 7 | `getEnvMenu` 改指 `env-menu-state`；plaza 刷新改点击时动态 `import('./library-setup')`；舞台灯光类型与默认值抽 `lighting-stage-types.ts` | 18→10 文件，最大 4→2 |
| 8 | 阴影重建拆成「shadow 做自己那半 + `lighting.ts` 组合调用」 | 10→8 文件 |

**决策 7 里动态 import 的性质**：`plaza-download` 的 `refreshLibrary()` 本就在 toast 按钮回调里执行（用户点「查看库」才跑），改成 `await import('./library-setup')` 只是把「加载期拉进来」改成「点击时才拉」——依赖方向变了，运行时语义没变。这与仓库既有手法一致（`core/load-manager.ts:166/199/215` 就是这么断开 core→scene 的）。

**决策 8 的启发**：`rebuildShadowCasters()` 原本一个函数里干两件事（env 阴影 + 舞台灯光阴影），于是 shadow 必须 import stage。拆成「各自只做自己那半，装配面组合」后，两模块再无互相依赖——**复合动作应该住在装配面，而不是住在被复合的模块里**。

### 剩下 4 个 size=2：为什么停在这里

`library-actions ⇄ library-core`、`env-ground-spec ⇄ env-ground`、`material-sss ⇄ material`、`scene-serialize ⇄ scene` 四个都是「状态 + 逻辑同住一个模块」的互指，不是聚合器形态：

- `library-core` 的 `resolveDisplayBrowseDir` 读模块级 `allModels`，抽走就得把状态一起搬，属于状态归属重构。
- `env-ground-spec` 定义的 `GroundMaterialSpec` 等类型是 `env-ground` 那几个函数的入参——类型与实现分居两个文件，抽任何一半都要连带搬类型。
- `material-sss` 的 `setMatSssParams` 内部会调 `applySss`，而 `applySss` 又要 `material.ts` 的 `getMatCatGroups`——状态抽出去仍然拉回 material.ts。
- `scene ↔ scene-serialize` 双向 25 个符号，且 `scene.ts:894` 还有 `export * from './scene-serialize'`，删任一条都不足以断环。

要继续就得动状态归属与类型归属，风险高于收益（每个只值 2 个文件）。ADR-270 的棘轮已经把这些数字钉住，后续谁要碰这块，门禁会先提醒。


### 改动文件

- `frontend/src/scene/env/_bridge/env-dispatcher.ts`（新增 observer 请求注册表）
- `frontend/src/scene/env/{env-impl,env-sky,env-clouds,env-ground,env-time-of-day,env-particles}.ts`
- `frontend/src/menus/motion-menu-state.ts`（新建）
- `frontend/src/menus/{motion-popup,motion-binding-ui,motion-root-ui,motion-detail-ui,motion-override-levels,motion-pose-levels,motion-camera-levels,motion-gaze-levels,motion-procmotion-levels}.ts`
- `frontend/src/menus/{library-core,library,plaza-download,settings-resources}.ts`
- `frontend/src/scene/motion/motion-modules/registry-core.ts`（新建，状态机叶子）
- `frontend/src/scene/motion/motion-modules/{registry,foot-modules,hand-modules,body-posture,riding-model,module-base,preset-types}.ts`
- 测试接缝：`__tests__/env-bridge/env-mocks.ts`、`__tests__/env-impl.test.ts`、`__tests__/scene/env-clouds.test.ts`、`__tests__/scene/env-time-of-day.test.ts`、`__tests__/library-core.test.ts`、`__tests__/perception-lipsync.test.ts`、`__tests__/scene/motion-modules-registry-core-order.test.ts`（新建）
- 知识卡：`docs/knowledge/library-core.md`（symbols 随转发删除而收缩）

### 测试接缝的教训

新增导出会打破既有 `vi.mock`。`requestEnvObserver`/`registerEnvObserverHandler` 加进 dispatcher 后，4 个 mock 了 dispatcher 的测试立即报 `No "requestEnvObserver" export is defined on the "..." mock`。**改任何被 mock 的模块导出面，必须 grep `vi.mock` 全仓补接缝。** 其中 `env-mocks.ts` 的 `requestEnvObserver` 必须映射到 `mockEnsureEnvUpdateObserver` 而非 `vi.fn()`，因为 `time-of-day.int.test.ts` 断言 observer 挂载行为。

同类教训在 `perception-lipsync` 走桥时再现：删掉 `vi.mock('../scene/motion/proc-motion-bridge')` 后，测试必须把节拍检测器分支并入 `vi.mock('@/core/scene-action-bridge')` 的 switch，否则静默返回 `undefined` 而用例仍「通过」——因为断言只看调用次数不看返回值。

**更隐蔽的一类：新写的回归测试自己假绿。** `motion-modules-registry-core-order.test.ts` 初版在装配层加载后显式调用了 `initMotionModules()`，于是即便删掉 `registerInitHook` 里的补执行，测试照样绿——兜底路径替它完成了注册。改成「加载装配层后不调用任何 init，直接读注册表」后，删补执行立刻变红。**验证「测试能否抓到回归」必须真的把代码改坏跑一遍**，否则拿到的是假绿灯。

### 未做

- 四个 size=2 的互指对（`menus/library-actions ⇄ library-core`、`scene/env/env-ground-spec ⇄ env-ground`、`scene/manager/material-sss ⇄ material`、`scene/scene ⇄ scene-serialize`）——停在这里的理由见上「剩下 4 个 size=2」。
- 已全部拆掉的形态（留档）：`scene/env` size=9、`menus/motion-*` size=9、`menus/library-*` size=8、`motion-modules` size=6、`perception` 家族 size=6、`perception-gaze` size=3、`motion-algos` autodance size=3、`scene/render` lighting size=4、`menus` plaza size=4。

## 相关文档

> ADR-269 / ADR-270 / ADR-238 / frontend/src/scene/env/_bridge/env-dispatcher.ts / frontend/src/menus/motion-menu-state.ts
