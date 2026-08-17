# ADR-269: scene 共享状态槽下移与耦合度量口径修正 — SCC 取代环计数作为判读指标 + type-only 边剔除 + scene-context 抽离

> **状态**: ✅ 已采纳（2026-10-23）
> **日期**: 2026-10-23

## 背景

### 起因：一次耦合度锐评暴露的四个失真

对 `docs/dep-metrics.md` 台账做交叉核查后，发现耦合数据本身可信、但**判读口径**全面失真：

1. **环计数没有分辨力。** 模块级 651 个「代表环」在结构上只对应 **1 个强连通分量**（size=14，全部 14 个模块互达）。环数是「路径等价类计数」，同一拓扑事实可以报出 651 也可以是 6000，它随边的增减剧烈抖动，却不告诉你哪块代码该动。
2. **type-only 边被算成运行时耦合。** `scripts/_lib/import-scan.mjs` 的 `isTypeOnlyBody()` 实现正确，`scripts/check-layering.mjs:125` 也正确调用了它；但 `scripts/_lib/source-graph.mjs` 的消费循环只写 `if (typeOnly) continue;`——而 `scanImportSpecs` 只在 `kind:'dynamic'` 时才赋 `typeOnly`，静态 `from` 语句的这个字段永远是 `undefined`。于是**分层门禁口径对、耦合台账口径错**，同一个仓库两把尺子。
3. **`scene/scene.ts` 的共享状态槽是 SCC 的粘合剂。** 它是装配器（938 行，import 47 个子系统 + Babylon 副作用入口），同时 `export let engine / scene / modelManager`。任何只想读一个 `scene` 的模块都必须穿过整个装配图，最大文件级 SCC 因此达 25 个文件。
4. **白名单 651 条零 `expires`。** 全靠一个整体 `reviewBy` 闹钟，条目级到期机制建好了但从未使用。

### 前序决策

- ADR-238：主张「消除依赖本身而非放宽检查」，以结构接口替代 type import 为范例。
- ADR-268：把环口径收窄为「加载期依赖」，动态 `import()` 不计入；白名单 key 改节点集合（`cycleSetKey`）抗漂移。

## 决策

### 决策 1：判读耦合用 SCC，环计数只作历史对照与门禁输入

`scripts/_lib/scc.mjs` 提供迭代式 Tarjan（显式帧栈，避免深递归爆栈）：
`tarjanScc(nodes, successors)` / `nontrivialSccs(sccs)` / `sccSummary(sccs)`。
`scripts/dep-metrics.mjs` 在 compute 期同时算文件级与模块级 SCC，台账新增「## 7. 强连通分量（结构口径 · 判读耦合用这个）」，并把原「残留环清单」降级为「## 8. …（历史对照 + 门禁输入）」。

**理由**：SCC 是拓扑不变量——它回答「哪些文件真的互为因果」，不随边的微调抖动。环计数回答的是「有哪些简单回路」，对 651 这种量级已经失去指导意义。

**补充（实施后追加）**：仅把模块级 SCC 摆上台面还不够——实测模块折叠法对 11 个真实 SCC 的可见度是 **0**。台账因此同时输出三项交叉校验读数：`realModuleSccCount`（由文件级 SCC 反推的模块集合）、`cyclesBacked`（有文件级支撑的代表环数）、`cyclesArtifact`（折叠假象数）。三者相加必须等于代表环总数，由 `scripts/check-cli.smoke.test.mjs` 断言。详见「影响 → 补充：模块级 SCC 与代表环都是折叠盲区」。

### 决策 2：`source-graph` 剔除 type-only 边，与 `check-layering` 统一口径

`scripts/_lib/source-graph.mjs` 的循环体新增一行：

```js
for (const { spec, typeOnly, kind, body } of scanImportSpecs(text)) {
    if (typeOnly) continue;
    if (kind === 'from' && isTypeOnlyBody(body)) continue;   // ← 新增
    if (!includeDynamic && kind === 'dynamic') continue;
    ...
}
```

**理由**：`import type` 在编译期被完全擦除，不产生运行时模块求值，不可能造成部分初始化的 undefined 绑定。把它计入耦合，等于把「文档引用」算成「代码依赖」。

### 决策 3：`engine` / `scene` / `modelManager` / `isHeadless` 下移到 `scene/scene-context.ts`

新建 `frontend/src/scene/scene-context.ts`，**零运行时出边**（只允许 `import type`，不得引入 Babylon 运行时值或子系统模块）：

```ts
export const isTestEnv = import.meta.env.MODE === 'test';
export const isHeadless = !isTestEnv && typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('e2e');
export let engine: Engine;
export let scene: Scene;
export let modelManager: ModelManager;
export function setEngine(next: Engine): void { engine = next; }
export function setScene(next: Scene): void { scene = next; }
export function setModelManager(next: ModelManager): void { modelManager = next; }
```

`scene/scene.ts` 保留**写入权**（`createEngine()` / `new Scene()` / `new ModelManager()` 仍在这里发生），改为经 setter 写入；同时 re-export 四个槽，既有 `import { scene } from '../scene/scene'` 的消费者零改动。

**为什么用 setter 而不是直接赋值**：ESM import 绑定只读，装配器无法对外部模块的 `let` 赋值。setter 是唯一合法写法，且 live binding 语义保证 HMR 重建（`_reinitSceneForHMR` 内 `setEngine(createEngine())` / `setScene(new Scene(engine))`）后读取方立刻看到新实例。

**为什么零出边**：一个只有 `import type` 的模块在模块图里没有出边，**永远不可能进入任何环或 SCC**。这是这次改造有效的根本原因——不是「把边换个地方」，而是让装配图与状态读取图彻底分开。

## 备选方案

### A. 拆 `scene/scene.ts` 的 22 条 re-export（否决）

实测证伪：这 22 个 export-from 目标**全部同时被 import**（both=22 / onlyExport=0）。`scene.ts` 是真实装配点，删 re-export 不会删掉任何装配边；消费者改直连只会把边从「指向 scene.ts」换成「指向叶子」，SCC 不变。早期探针测到的 25→9 是假象（只删 export 边却假装消费者改直连，且没补回 scene.ts 自身的装配 import）。

### B. `core/dev-hooks.ts` 6 条静态 scene import 改动态（否决）

实测收益为 0：删 `init.ts → dev-hooks` 边后 cycles 551→551、SCC 10/64/25 全不变。且 `check-layering.mjs:124-126` **只豁免 type-only，不豁免 `kind === 'dynamic'`**，改动态也不会减少 `docs/.layering-baseline.json` 的 13 条反向边（基线里本就有动态边：`core/mmar-globals.ts:113`、`core/load-manager.ts:166/199/215`）。真正的问题在别处——`core/init.ts:644` 在 `bootstrap()` 里**无条件调用** `setupE2ECapture()`，DEV-only 是运行时门控而非模块图门控。

### C. 拆 `core/config.ts` barrel（否决，反而变差）

实测：拆散后边数 1796→**1940（+144）**，SCC 完全不变（10/64/25），各叶子新 Ca 最大 67。barrel 不在任何环上，只是扇入点——拆它只增边不改结构。它的低风险性由 `I=0.07` 已经说清（25 行纯转发器，无逻辑）。

### D. 把 4 槽直接内联到各消费者（否决）

会退化成「每个消费者各自持有 engine/scene」，破坏单例语义（HMR 重建后旧引用悬空）。setter + 单一槽模块保留了单例，只是把「谁能写」和「谁在读」分开。

## 影响

### 度量变化（`includeDynamic=false` 口径，逐阶段实测）

| 阶段 | 文件级边 | 代表环 | 文件级 SCC | 最大 SCC | 覆盖文件 |
|------|---------|--------|-----------|---------|---------|
| 起点（ADR-268 后） | 1971 | 651 | 10 | 26 | 71 |
| 决策 2 落地（剔 type-only） | **1796** | **551** | 10 | 25 | 64 |
| 决策 3 落地（槽下移） | **1797** | 551 | **11** | **12** | **60** |
| 决策 4 落地（焦点门面） | **1803** | 551 | **12** | **10** | 60 |
| 决策 5 落地（camera 叶子直连） | **1804** | 551 | 12 | **9** | **57** |
| 决策 6 落地（节拍检测器走桥） | **1802** | 551 | 12 | 9 | **56** |

模块级折叠法 SCC 始终为 1 个 / size=14（整张模块图看似一个强连通分量）。但**由文件级 SCC 反推的真实跨模块 SCC** 从 1 个 / max 4 模块，经决策 5 降到 max 2，**决策 6 后归零**——模块图实际是 DAG，`menus`/`core` 的单向漏斗从未真正成环。

**最大 SCC 25→12、覆盖文件 64→60**，且与实施前的探针模拟（sim A：11 个 / 60 文件 / max 12）逐项吻合。决策 4 再把最大 SCC 降到 **10**，决策 5 降到 **9**，决策 6 后 12 个非平凡 SCC 全部落在单模块内部。

### 决策 4：`scene/scene-focus.ts` 焦点窄门面，让装配器退出最大 SCC

决策 3 之后最大分量仍是 12 文件，且 **装配器 `scene/scene.ts` 自己在里面**——`scene/camera` 与 `scene/motion` 反向取 `modelManager` / `focusedModel` / `focusModel` / `reattachPipeline` / `getProcBeatDetector`，而 `scene.ts` 又装配它们。装配器在环里意味着初始化顺序一旦调整就可能读到部分初始化的模块。

新建 `frontend/src/scene/scene-focus.ts`，只做 re-export（8 个焦点/装配访问器），模块归属仍是 `scene`。5 个反向依赖文件改指它：`scene/motion/{perception,proc-motion-controller,proc-motion-bridge}.ts`、`scene/camera/{camera-auto,camera}.ts`。

**为什么必须经门面而不是直连叶子定义处（这是本轮最重要的一条度量约束）**：直连叶子的方案（6 文件全改）实测把文件级 SCC 降到 max 9，但**新增 3 个跨模块有向对**（`scene/camera|scene/manager`、`scene/camera|scene/motion`、`scene/camera|scene/render`），代表环 **551 → 755**、白名单外环 **0 → 214**、`check:circular --strict` **EXIT=1**。原因是折叠法的环数按模块对组合爆炸增长——**模块对每多一条，环数按组合数放大**。门面同属 `scene` 模块，模块对 62 条一条不增，所以环数纹丝不动，只有 SCC 改善。

**装配器脱离纠缠**：`scene/scene.ts` 所在 SCC 从 size=12 缩到 **size=2**（仅与 `scene/scene-serialize.ts` 互指）。`scene-serialize` 保留那条边是刻意的——它 `:1502` 调 `disposeScene()`，而 `disposeScene`（`scene.ts:300`）级联 8 个子系统的 dispose，下移代价远大于收益。

### 决策 5：`scene/manager/model-ops.ts` 直连 camera 叶子，断开 manager↔camera 互指

决策 4 后最大分量仍是 10 文件，其中 `scene/manager/model-ops.ts → scene/camera/camera.ts` 是 `scene/manager→scene/camera` 模块对的**唯一**一条边，也是 `scene/manager` 与 `scene/camera` 互相可达的支点。

`model-ops.ts` 从 `../camera/camera` 取 5 个符号，但其中 4 个真实定义在叶子：`getCameraMode` → `camera-state.ts:181`、`getOrbitBoneLock`/`setOrbitBoneLock`/`getFocusedModelBoneNames` → `camera-bone-lock.ts:47/32/62`。只有 `switchCameraMode`（`camera.ts:375`）是装配级函数——它按 ADR-238 范式改经 `scene-action-bridge`（`camera.ts:898` 已注册同名 action，与同文件下方 `disposeAudio` 走桥完全同构）。

**结果**：最大 SCC 10 → **9**，覆盖文件 60 → **57**，**真实模块级 SCC 从 max 4 降到 max 2**（`scene` 与 `scene/camera` 不再互相可达，只剩 `scene`↔`scene/motion` 一对）。代表环 551、模块对 62 不变。

### 决策 6：`getProcBeatDetector` 走桥，模块图变为 DAG

决策 5 后仍有**唯一一个**跨模块 SCC（size=7）：`scene/motion` 的 6 个文件 + `scene/scene-focus.ts`。支点是门面到 `scene/motion/proc-motion-bridge.ts` 的那条 `getProcBeatDetector` re-export。

两条路只有一条能走：

| 方案 | 边 | 模块对 | 代表环 | 真实跨模块 SCC |
|------|----|--------|--------|----------------|
| 删门面 re-export，`camera-auto` 直连 `proc-motion-bridge` | 1804 | **63**（+1） | **638**（+87） | 0 |
| 删门面 re-export，`camera-auto` 走 `scene-action-bridge` | **1802** | **62**（不变） | **551**（不变） | **0** |

直连方案虽然也清了跨模块 SCC，却新增 `scene/camera\|scene/motion` 模块对，折叠法环数暴涨 87 条、`--strict` 直接红灯——**和决策 4 是同一个教训：任何重构都要守住「不新增跨模块有向对」**。

最终按 ADR-238 范式走桥：`scene-action-bridge.ts` 的 `SceneActions` 接口新增 `getProcBeatDetector: () => unknown`，`proc-motion-bridge.ts:157` 注册，`camera-auto.ts:70` 用 `getSceneAction('getProcBeatDetector')?.()` 取（未注册时按「无 detector」处理，与原返回 `null` 语义一致）。

**结果：真实跨模块 SCC 归零。** 12 个非平凡 SCC 全部落在单个模块内部，模块图是 DAG——**全仓不存在任何跨模块的互相可达**。代表环 551、模块对 62 保持不变。

### 补充：模块级 SCC 与代表环都是折叠盲区（实施后追加）

上表里的「模块级 SCC 1 个 / size=14」**不能作为耦合读数**。后续探针证明模块折叠法对真实 SCC 有 100% 盲区（下表为决策 4/5 实施时的现场读数，决策 6 后真实跨模块 SCC 已归零）：

| 口径 | 读数 | 可信度 |
|------|------|--------|
| 模块折叠法 SCC | 1 个 / 最大 14 模块 | ❌ 只反映「模块间边是否存在」 |
| 文件级支撑的真实模块 SCC | 决策 4/5 时 1 个 / 最大 4；**决策 6 后 0 个** | ✅ 能指导拆分 |
| 代表环 | 551 个 | ❌ 决策 6 后**没有一个**有文件级支撑 |
| 代表环（剔除入度为 0 的入口文件后） | **139 个** | 更接近结构事实 |

**盲区成因（两条，已定量）**：

1. **模块内边被整类丢弃**。本仓 1802 条文件边里约 739 条是模块内边，`buildModuleGraph` 全部丢弃，模块内环折叠成自环，而 `detectCycles` 用 `path.includes` 排自环 ⇒ 单模块内部的 SCC 整类消失。
2. **跨模块环被「只留最短代表环」挤掉**。跨模块 SCC 在模块图上确实成环，但 `representativeCycles` 按节点集合归并后只保留最短路径，被 `scene↔scene/camera` 这类二元环覆盖，**节点集恰为该 SCC 模块集合的代表环 = 0 个**。

**第三个假象源：入口文件被折叠进 `core`。** `core/main.ts` 入度 = 0（它是应用入口），却与 `core` 其余文件合并成同一个节点。排除它一个文件，代表环 **551 → 139**（−74.8%），效果与排除全部 25 个入度为 0 的源文件完全相同——那 412 个环的节点集全部含 `core+menus`。

**结论**：环数不是耦合强度，`check:circular` 的白名单棘轮仍有效（它防的是新增边导致的环数变化），但它**不能用来判断哪里耦合重**。判读请用文件级 SCC；需要模块粒度时，用「由文件级 SCC 反推的模块集合」，不要用模块折叠法。

### 文件变更

- 新增 `frontend/src/scene/scene-context.ts`、`frontend/src/scene/scene-focus.ts`、`scripts/_lib/scc.mjs`、`scripts/_lib/scc.test.mjs`。
- `frontend/src/scene/scene.ts`：删 4 个槽定义与 2 个 flag，改经 setter 写入 + re-export。
- 6 个纯槽消费者改指 `scene-context`：`menus/motion-cloth-levels.ts:11`、`scene/ar/ar-scene.ts:12`、`scene/env/env-time-of-day.ts:27`、`scene/env/_bridge/env-bridge.ts:27`、`scene/manager/model-ops.ts:24`、`scene/pose/camera-angle.ts:6`。
- 5 个焦点消费者改指 `scene-focus`：`scene/motion/perception.ts:14`、`scene/motion/proc-motion-controller.ts:28`、`scene/motion/proc-motion-bridge.ts:34`、`scene/camera/camera-auto.ts:15`、`scene/camera/camera.ts:27`。
- 决策 5：`scene/manager/model-ops.ts` 改从 `camera-state` / `camera-bone-lock` 取 4 个叶子符号，`switchCameraMode` 走 `scene-action-bridge`。
- 决策 6：`core/scene-action-bridge.ts` 新增 `getProcBeatDetector` 槽位、`scene/motion/proc-motion-bridge.ts:157` 注册、`scene/camera/camera-auto.ts:70` 走桥读取、`scene/scene-focus.ts` 删除该 re-export。
- `scripts/dep-metrics.mjs`：SCC 计算 + 台账新增第 7 节；折叠盲区说明改为动态读数（不再硬编码 738/1797/11/5/141/412）。
- `scripts/circular-allowlist.json`：651→551（`--update-allowlist` 自动移除 100 个已修复环）。
- 11 个测试文件补 `vi.mock('.../scene-context', ...)`、另 11 个补 `vi.mock('.../scene-focus', ...)`（原 mock 接缝是 `scene/scene`，符号迁走后 mock 拦不住新模块）；`camera.vmd-state.test.ts`、`model-ops.test.ts`、`scene/replace-model-inherit.test.ts` 另补桥/叶子 mock 与 `registerSceneAction` 桩。

### 测试口径反转

`scripts/_lib/source-graph.test.mjs` 原用例 `resolves inline type imports like import { type X } from` 断言纯类型导入**会**产生边——这是把旧行为固化成了契约。改为三条：纯类型 `import { type X }` → `[]`、`import type { X }` → `[]`、混合 `import { type X, value }` → `['runtime.ts']`。

### 未做

- 白名单 551 条仍零 `expires`（决策未涉及，仍是整体 `reviewBy` 一个闹钟）。
- `scripts/check-circular.mjs` 的 `findImportLine()` 仍用旧正则，只影响 `--edges`/`--diff` 归因行号。
- `scripts/gen-tier.mjs:70` 仍默认 `includeDynamic=true`（知识卡 tier 反向图，口径可不同，但未在 ADR 写明）。

## 相关文档

> ADR-238 / ADR-268 / ADR-242 / scene/scene.ts / scripts/dep-metrics.mjs / scripts/_lib/scc.mjs
