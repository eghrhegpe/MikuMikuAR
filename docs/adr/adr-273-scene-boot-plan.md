# ADR-273: 场景启动顺序显式化 — 把装配序列从语句位置变成可校验清单（boot plan）

> **状态**: 🔄 部分采纳（phase 0 / phase 1 已落地 2026-10-24；phase 2 待做）
> **日期**: 2026-10-24

## 背景

### 先纠正一个数字

上一轮报告把这里描述成「888 行 God Object，`initScene()` 占 420-852 共 433 行」。读完代码，这个口径是错的：

- `initScene()`（`frontend/src/scene/scene.ts:420-432`）是 13 行并发守卫（`_initPromise`）；
- 真正的序列 `_doInitScene()`（`scene.ts:435-491`）只有 **56 行**，18 个动作；
- 433 行里剩下的部分是七个 helper：`_reinitSceneForHMR`（494-517）、`_bindSceneEvents`（519-583）、`_injectRuntimeCallbacks`（585-612）、`_initModelManager`（614-678）、`_injectModelCallbacks`（680-701）、`_initMotionSubsystems`（703-767）、`_initMmdRuntime`（769-850）。

所以「文件太长」不是问题的真身。真身是：**这 18 个动作之间的顺序契约，只写在注释和语句位置里。**

### 顺序契约现在住在三个地方，只有一个是机器能读的

**① 注释（机器读不到）。** `scene.ts` 里至少四处明确写着「必须先于/后于」：

- `scene.ts:449`：`// Loader（必须在 modelManager + setTriggerAutoSave 之后）`；
- `scene.ts:728-730`：`// 7.5 脚步声系统启动（ADR-088）… 必须在 startFeetAdjustment 之后注册（落地事件由脚部跟随产生）`；
- `scene.ts:673-677`：`// 必须注册真实实现 triggerAutoSaveImpl … 而非 @/core/utils 的 triggerAutoSave 包装器本身——后者会令 _triggerAutoSaveImpl 指回包装器自身，触发无限自递归`；
- `scene.ts:763-765`：`// 9. Motion Override Modules 注册 … 必须在 focusModel 可能被调用之前完成`。

**② 参数（机器能读，但只覆盖一半）。** `initLoader(scene, runtime, modelManager, …)`（`manager/model-loader.ts:91`）、`initEnvFacade(scene, pipeline)`、`_initModelManager(...)` 把依赖从形参递进来——这条是硬的，改顺序会直接 TypeScript 报错。

**③ 模块级 live binding（机器读不到，而且类型在撒谎）。** `initLighting` / `initRenderer` / `initPlaybackObservables` / `initMotionModules` 全部从 `@/core/config` 与 `scene/scene-context.ts` 读模块级 `let`：

```ts
// frontend/src/scene/scene-context.ts:37-38 —— 注意没有 `| undefined`
export let modelManager: ModelManager;
```

声明为非空，实际在 `setModelManager()` 之前是 `undefined`。于是把 `_initModelManager`（`scene.ts:447`）挪到 `initLoader`（`scene.ts:452`）之后，**`tsc` 一句不报**：`initLoader` 的第三个形参类型是 `ModelManager`，传进来的就是那个还没赋值的绑定。启动时在 `model-loader.ts:102` 的 `_modelManager = modelManager` 处留一个 `undefined`，第一次加载模型才炸，栈里还看不出是谁挪的顺序。

同类还有 `engine` / `scene` / `mmdRuntime` 三个槽（`scene-context.ts:32-35`、`core/config.ts` 的 live binding）。**这个仓库最密的一张依赖网，只有一半挂在类型系统上，另一半挂在语句的行号上。**

### 为什么「继续拆文件」不是答案

ADR-269 已经把共享槽拆进 `scene-context.ts`，ADR-271 拆过文件级 SCC。继续按行切片只会把「文件内隐式顺序」换成「跨文件隐式顺序」：读的人得在五个文件之间跳，而 `check:coupling` 的模块对只会涨——`scene-context.ts:8` 自己记着，`scene` 身上挂着 25 个文件的环群，每多一个小文件就多一条可被计入的边。

## 决策

### 1. 启动序列变成一张 `BootPlan`：有序、每步自带 `provides` / `requires`

```ts
// frontend/src/scene/boot/boot-plan-types.ts —— 纯类型叶，零运行时 import
export type BootResource =
  | "mmd-runtime"
  | "lighting"
  | "renderer"
  | "pipeline"
  | "env"
  | "beat"
  | "model-manager"
  | "loader"
  | "playback"
  | "motion-subsystems"
  | "render-bridge"
  | "ai-bridge";

interface BootResourceMap {
  "mmd-runtime": IMmdRuntime;
  "model-manager": ModelManager;
  lighting: void;
  // …其余同形
}

export type BootDeps<R extends BootResource> = { [K in R]: BootResourceMap[K] };

export interface BootStep<R extends BootResource> {
  readonly id: string;
  readonly requires: readonly R[];
  readonly provides: readonly BootResource[];
  run(deps: BootDeps<R>): Promise<void> | void;
}
```

关键在于 `run(deps)` 的形参**只包含自己声明的资源**。这是让 `requires` 无法撒谎的机制：声明了却没被提供，执行器在构造 `deps` 时就抛错；没声明却想用，`deps` 里没有这个字段，`tsc` 直接拒绝。对比 ADR-272 里那张 `satisfies` 表——同一个手法：**把「记得同步」换成「忘了就编译失败」。**

### 2. 顺序门禁是纯函数 + 一条测试，不是文档

```ts
export function validateBootPlan(
  plan: readonly BootStep<BootResource>[],
): string[];
// 规则：id 唯一 / requires ⊆（前序 provides ∪ ambient）/ provides 不重复 / 不要求自己刚提供的东西
```

`boot-plan.ts` 零 scene 依赖，测试可以对它跑三条「故意改坏」用例：把 `loader` 提到 `model-manager` 之前 → 报错文本同时点名两个 id；删掉 `lighting` 的 `provides` → 依赖它的 `apply-env` 报错；重复 id → 报错。**注释不会失败，数据会。**

### 3. 执行器保持朴素：一个 for 循环 + 一张 satisfied 表

不引入 DI 容器、不引入状态机、不引入事件总线。`runBootPlan()` 约 30 行：按序取步、断言 `requires` 已满足、构造 `deps`、`await step.run(deps)`、把 `provides` 记进表。运行期这一层断言是给「有人绕过测试直接改 plan」留的兜底，报错文本必须带步 id 与两个依赖名。

### 4. 本 ADR 明确不碰 `disposeScene()`

`disposeScene()`（`scene.ts:300-357`）今天不是 init 的严格逆序：playback → proc-motion → gizmo → reflection → renderer → env-observer → wind → lighting → camera-system → `scene.dispose()` → `engine.dispose()`。而**headless 单测验证不了 dispose 顺序的正确性**——NullEngine 下多数 dispose 是空操作，顺序错也全绿。

把 teardown 挂到 plan 上、用「逆序」当唯一真源，听起来更美，但那是拿一个测不出来的重排去换一个漂亮的对称性。留作 phase 2，前置条件是 e2e 里有一次真实 WebGL 上下文的反复 init/dispose 冒烟。

### 5. 一次搬完，不留双轨

半张 plan + 半段函数 = 两套顺序，比现状更糟。迁移粒度是「整个 `_doInitScene` 序列」，七个 helper 的函数体原样搬进 `boot-steps.ts` 的闭包，**只改签名不改逻辑**，便于用 diff 逐行核对。

## 备选方案

**A. 按行拆文件（ADR-271 路线延伸）** — 否决。把 888 行切成五个 180 行的文件，隐式顺序从「一个文件从上到下」变成「五个文件的 import 先后」，`check:coupling` 的模块对上涨，而门禁一条也没多。这正是 ADR-271 之后仍然存在的熵：拆分只降低单文件认知负荷，不把顺序变成可校验的事实。

**B. 只补注释 / 写一份 `docs/scene-boot-order.md`** — 否决。文档不能失败。ADR-272 的同一课：靠人记得同步的清单，等于没有清单。

**C. 引入 DI 容器（typedi 一类）** — 否决。为 18 个步骤引入运行时解析器，换来的是「容器在我不知道的时候给了一个我以为是别的实例的对象」，错误信息比手写装配更差；且仓库硬约束是零依赖工具链。

**D. 状态机 / 事件总线驱动启动** — 否决。把确定性顺序换成调度不确定性，把「第 3 行」变成「某个事件什么时候到」——这正是启动阶段最不该有的东西。

**E. 只加运行时断言，结构不动** — 部分采纳。执行器里保留断言（决策 3），但只有断言没有 plan 时，断言本身也得靠人写对，顺序依旧住在注释里。

## 影响

### 改动文件

| 文件                                             | 改动                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `frontend/src/scene/boot-plan.ts`                 | 新增：`BootResource` / `BootDeps` / `BootStep` 类型 + `validateBootPlan()` + `runBootPlan()`（零 scene 依赖） |
| `frontend/src/scene/boot-steps.ts`               | 新增：`BootHooks` 接口 + `buildBootPlan(hooks)`（phase 0：18 步 → phase 1：24 步）                              |
| `frontend/src/scene/boot-mmd.ts`                 | phase 1 新增：加载器 / 材质构建器注册                                                                           |
| `frontend/src/scene/boot-motion.ts`              | phase 1 新增：脚部跟随 / 脚步声 / 骨骼覆盖 / WASM IK / 动作模块五段                                            |
| `frontend/src/scene/scene.ts`                    | `_doInitScene` 收缩为「取 plan → run → 收尾」；`_createBootHooks()` 做转发；`_initMotionSubsystems` 删除         |
| `frontend/src/__tests__/scene/boot-plan.test.ts` | 新增：plan 合法性 + 顺序契约快照 + 破坏用例                                                                     |

### 预期读数

- `scene.ts` 从 888 行降到 ~520 行（迁出约 350 行闭包体，迁入约 20 行执行器调用）；**实际：涨到 993 行，见「落地记录（phase 0）」②**——闭包体没有搬，多出的是 17 个转发钩子；
- `check:coupling` 预期 62 / 4 SCC / 8 文件 / max 2 **不变**——新文件都在 `scene/` 模块内部，模块内边不计入跨模块对，但**以实测为准**，若涨则说明 `boot-steps.ts` 反向牵了外部模块，需要把闭包留在 `scene.ts` 侧；
- 类型叶 `boot-plan-types.ts` 只允许 `import type`，与 `scene-context.ts` 同一条纪律（否则它会立刻被卷进环群）。

### 风险

1. **HMR 路径单测覆盖不到。** `_reinitSceneForHMR` 会重建 engine/scene，plan 的 satisfied 表必须随之清空，否则 HMR 后第二个 `mmd-runtime` 步骤会因「已提供」被跳过。这是本次唯一的真风险，验收要求：`wails dev` 下真实热重载一次，确认场景重建后模型、灯光、水面都还在。
2. **闭包搬移的隐性顺序。** 闭包会捕获 `scene` / `engine` / `dom` 等模块级槽；搬移后仍应经 `scene-context.ts` 读取，不得改成传参——否则 HMR 替换 engine 后闭包读到旧引用。
3. **`_initMmdRuntime` 只退到「挑实例」。** phase 0 只把它包成一个步骤；phase 1 之后加载器段、风物理、地面碰撞都出去了，它剩下的 MPR/SPR 回退与 dispose observer 注册属于「运行时的选择」而非「装配顺序」，不再往外拆。

## 分阶段

- **phase 0（本 ADR）**：类型 + plan + 校验器 + 测试 + 迁移 18 步序列；`disposeScene` 与 `_initMmdRuntime` 内部不动。
- **phase 1（已落地，见下）**：把 `_initMmdRuntime` 的材质模式 / MPR 回退 / 风物理注册，以及 `_initMotionSubsystems` 的五个子步骤（feet / footstep / bone-override / wasm-ik-resolver / motion-modules）各自展开为 plan 里的独立步骤——它们当时的顺序契约只是注释。
- **phase 2**：teardown 逆序推导。前置条件：真实 WebGL 的 init/dispose 循环 e2e，否则不启动。

## 落地记录（phase 0，2026-10-24）

落地与草案有三处**有意的偏差**，都是执行过程中被实测推着改的，不是妥协：

### ① 文件平铺在 `scene/` 下，不建 `scene/boot/` 子目录

草案写的是 `frontend/src/scene/boot/boot-plan-types.ts`。实际落成两个文件：

- `frontend/src/scene/boot-plan.ts`（类型 + `validateBootPlan()` + `runBootPlan()`，零 Babylon / 零 scene 依赖）；
- `frontend/src/scene/boot-steps.ts`（`BootHooks` 接口 + `buildBootPlan(hooks)`）。

原因是耦合门禁的模块归属规则（`scripts/check-coupling.mjs:58-63`）：`moduleOf()` 把 `scene/x/y.ts` 归为模块 `scene/x`。建 `scene/boot/` 会凭空多出一个模块 `scene/boot`，于是 `scene → scene/boot` 与 `scene/boot → scene/motion`、`scene/boot → scene/env` 全部变成**新的跨模块对**，棘轮（基线 62）当场变红。平铺在 `scene/` 根下的文件归入既有的 `scene` 模块，实测模块对 62 不变。

> 教训：模块不是目录树里的文件夹，是门禁脚本算出来的那个东西。想拆目录，先看 `moduleOf()`。

### ② 闭包体不搬：七个 helper 留在 `scene.ts`

草案写「七个 helper 的函数体原样搬进 `boot-steps.ts` 的闭包」。实际没搬。搬它们需要把 `initLighting` / `initRenderer` / `initEnvFacade` / `initLoader` / `initPlaybackObservables` / `_initMotionSubsystems` / `applyEnvState` / `registerRenderBridge` / `registerAiSnapshotBridge` 连同 `scene` / `engine` / `triggerAutoSave` / `modelRegistry` / `pipeline` / `_envSys` 等约 40 个标识符一起搬——那只是**把 God Object 换个文件名**，隐式顺序一步也没变成数据，还要多一条 `boot-steps → 每个子系统` 的依赖面。

真正的门禁来自 `buildBootPlan(hooks)` 这个**数据**：顺序、依赖、产出都在数组里，与闭包住在哪个文件无关。所以实际做法是 `_createBootHooks()`（`scene.ts`）做 17 个一行转发，plan 只管顺序。

代价记录在案：`scene.ts` 从 888 行涨到 **993 行**（+105，全是转发钩子）。行数不是本次目标，顺序契约的机器可读性才是；phase 1 把 `_initMmdRuntime` / `_initMotionSubsystems` 的内部子序列也展开成步骤后，helper 里的注释式顺序会被逐步吃掉，行数再回落。

### ③ 执行器不保留运行期 `requires` 断言

草案的决策 3 要求执行器里断言「依赖已被前序提供」。实测发现那是**不可达分支**：`validateBootPlan()` 在跑第一个步骤之前就做了同一判断，且报错信息更全（步 id + 位置 + 资源名）。留着它会让 diff-coverage 变红，也违背「不留双轨」。

最终保留的运行期断言只有一条，也是唯一只能运行期发现的：**声明了 `provides` 却没在 `run()` 返回值里给出**。它对应的真实故障是「改代码时顺手删了 return 里的一项」——静态检查看不见，因为类型上 `BootOutputs` 是 Partial。

### 破坏验证（真能拦住）

把 `loader` 步骤整块挪到 `model-manager` 之前（这正是草案背景里那个「`tsc` 一句不报、首次加载模型才炸」的操作），`boot-plan.test.ts` 立刻红：

```
BootPlanError: invalid boot plan (1 problem(s)):
  - step "loader" (position 8) requires "model-manager", but no earlier step provides it
Test Files  1 failed (1)
      Tests  3 failed | 8 passed (11)
```

移回即全绿。注意这条错误是**静态校验**给出的，发生在任何步骤执行之前——plan 非法时一步都不跑（有专门用例断言这一点）。

### 落地读数

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | EXIT=0 |
| `npm run test:quick` | 263 files / 6082 tests（原 262 / 6071，+1 文件 +11 用例） |
| `frontend/src/__tests__/scene.test.ts` | 46 tests 通过（该文件真实调用 `initScene()` 约 30 次，是本次重构的实际执行验证） |
| `check:coupling` | **62 / 4 SCC / 8 文件 / max 2 不变** |
| `dep:metrics` | files=375 edges=1812 cycles=551（白名单外 0） |
| `check:layering` | 13 条唯一边不变 |
| `frontend/npm run check` | 通过（magic / boolean-naming / i18n 均未超棘轮） |

### phase 0 未消除的风险

草案风险 1 依旧成立并**明确留给人工验收**：`_reinitSceneForHMR` 之后 plan 必须重跑全部步骤。当前实现里 `satisfied` 表是 `runBootPlan()` 的局部变量、`buildBootPlan()` 每次返回新数组，所以 HMR 重入天然不会「因为上一轮提供过而跳过」——但这条只有单测（「每次执行都产生独立的资源表」用例）在结构上覆盖，**真机 `wails dev` 热重载仍需手动跑一遍**。

## 落地记录（phase 1，2026-10-24）

phase 1 把两个 helper 的内部子序列展开成独立步骤：plan 从 18 步变成 **24 步**，`_initMmdRuntime()` 退化为「只挑运行时实例」，`_initMotionSubsystems()` 整个删除（五段各成一个步）。

新增两个文件，都平铺在 `scene/` 下（同 phase 0 ①，避开 `moduleOf()`）：

- `frontend/src/scene/boot-mmd.ts`（34 行）— `bootMmdLoaders()`：加载器注册 + 材质模式日志 + `MmdRuntimeShared.MaterialProxyConstructor` + PBR 构建器切换。与运行时实例无关，只有「早于任何一次模型加载」这一条顺序契约；
- `frontend/src/scene/boot-motion.ts`（107 行）— `bootFeetAdjustment()` / `bootFootstep(scene)` / `bootBoneOverride(scene)` / `bootWasmIkResolver()` / `bootMotionModules()`，函数体逐字节搬自原 `_initMotionSubsystems`，`await import(...)` **原样保留**（改成静态 import 会造出 `scene → scene/motion` 的静态边，把环再缠紧一圈）。

### 24 步（数组顺序即执行顺序）

```
mmd-loaders → mmd-runtime → wind-physics(←mmd-runtime) → ground-collision(←mmd-runtime)
→ lighting → renderer → env-facade(←renderer) → beat-detector → beat-attach(←beat)
→ scene-events(←env) → runtime-callbacks(←mmd-runtime) → model-manager(←mmd-runtime)
→ model-callbacks(←model-manager,mmd-runtime) → loader(←mmd-loaders,mmd-runtime,model-manager)
→ playback(←mmd-runtime,model-manager) → feet-adjustment
→ footstep(←feet-adjustment) → bone-override → wasm-ik-resolver(←bone-override,mmd-runtime)
→ motion-modules → env-state(←lighting,env) → sun-disc(←lighting)
→ render-bridge(←lighting,renderer) → ai-bridge(←renderer,model-manager)
```

### 四条新 requires：把注释换成声明

| 步 | requires | 旧契约在哪 / 违了会怎样 |
| --- | --- | --- |
| `ground-collision` | `mmd-runtime` | 原 `scene.ts` 末尾的 `applyGroundCollision()`。它经 `getPhysicsImpl(mmdRuntime)` 取 impl（`frontend/src/scene/physics/ground-collision.ts:118-124` → `enableGroundCollision:51`）；早于 `setMmdRuntime` 时 impl 为 `null`，函数**直接 return**——没有异常、没有日志、地板就是不存在。这是本阶段最有价值的一条边。 |
| `footstep` | `feet-adjustment` | 原注释「必须在 `startFeetAdjustment` 之后注册（落地事件由脚部跟随产生）」，只住在注释里。 |
| `wasm-ik-resolver` | `bone-override`, `mmd-runtime` | 原注释说 HMR 重入时 `stopBoneOverride` 会清掉旧 resolver、`_initMmdRuntime` 设好新 `mmdRuntime` 后再重注——两条前提其实一直是注释，现在都是声明。 |
| `loader` | 追加 `mmd-loaders` | 加载器注册搬到 `boot-mmd.ts` 后，「`loader` 必须在这之后」必须显式化，否则搬动一下就静默挂了 PMX 加载。 |

### 两条**故意不写**的 requires

- **`wind-physics` 的 `mmd-runtime` 不是新门禁。** `initWindPhysics(runtime)` 的参数类型就是 `IMmdRuntime`，传早了的运行时 `tsc` 先拦。它单独成步的理由是可读性 + dispose 侧要对应（`disposeWindPhysics` 仍在 dispose observer 里），不是校验收益。
- **`feet-adjustment` 不 require `model-manager`。** 原 `_initMotionSubsystems(scene, _modelManager)` 的形参**没人用过**——脚部跟随读的是 `modelRegistry` 的 `runtimeBones`。留着它就是假依赖，status 步之前把 `model-manager` 挪走它也不会红。
- 同理 **`motion-modules` 的 requires 是空的**：实测 `initMotionModules()`（`frontend/src/scene/motion/motion-modules/registry.ts:37-45`）只往表里注册模块定义，不读 `mmdRuntime`。它的约束是「排在 `focusModel` 可能被调用之前」，而 `focusModel` 由用户操作触发、无法表达成资源——只能靠数组位置，不该伪装成依赖。

> 判断标准：**requires 里只写"不满足就静默坏掉"的边**。能被类型钉死的、或其实不需要的，写进去只会让后面的人以为它很重要。

### 已知欠账（本阶段只记录，不改行为）

原脚部 getter 的代码与注释互相矛盾，迁移时逐字节保留：

- 注释说「always-on：`enabled=true`, `intensity=1`」（`[doc:adr-116 重构]`）；
- 实际写的是 `feet: { ...createDefaultFeetState(), enabled: false }`，而 `createDefaultFeetState()`（`frontend/src/core/scene-state.ts:51-62`）默认本来就是 `enabled: false`；
- `frontend/src/scene/motion/feet-adjustment.ts:405` 的门是 `if (!feet.enabled || feet.intensity <= 0 || m.runtimeBones.length === 0) continue`。

即 **per-model 脚部解算默认被跳过**。这是行为问题，不是顺序问题，混进本次提交只会让「顺序显式化」这件事失去可信的对照基线。留给独立 ADR。

> **已收尾（2026-10-24）**：不是笔误，是 `88d75986`「废弃脚部地面跟随」有意为之，只是没收尾消费者的判据——详见 [ADR-275](adr-275-feet-adjustment-deprecation-landing-source.md)。现在 `enabled: false` 是明确决策；`footstep` 的 `requires: ['feet-adjustment']` 仍然成立（脚部跟随仍先启动，只是它不再供事件）。

### 破坏验证（与 phase 0 同一手法）

把 `footstep` 整块挪到 `feet-adjustment` 之前：

```
BootPlanError: invalid boot plan (1 problem(s)):
  - step "footstep" (position 15) requires "feet-adjustment", but no earlier step provides it
Test Files  1 failed (1)
      Tests  3 failed | 9 passed (12)
```

移回即全绿（文件 SHA-256 与改前一致已验证）。

### 落地读数

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | EXIT=0 |
| `npm run test:quick` | 263 files / **6083** tests（phase 0 后为 6082，+1 用例） |
| `check:coupling` | **62 / 4 SCC / 8 文件 / max 2 不变** |
| `dep:metrics` | files=**377** edges=**1816** cycles=551（白名单外 0）——+2 文件 +4 边，全在 `scene` 模块内部 |
| `check:layering` | 13 条唯一边 / 15 处 import 不变 |
| `check:docs` | 1137 md / 2709 链接 / 0 断链 |
| `scene.ts` | 993 → **938 行**（净 888 → 938，+50 全是钩子转发） |

### phase 1 未消除的风险

phase 0 的风险 1 **原样保留**：`_reinitSceneForHMR` 之后 plan 必须整轮重跑，`wails dev` 真机热重载仍需人工验收一次。phase 1 让 `disposeScene` 与 `_reinitSceneForHMR` 的清理面多了一维（`wind-physics` / `ground-collision` 现在是独立步，但 dispose 侧仍写在 observer 与原清理函数里，**plan 与 teardown 尚未对称**）——这正是 phase 2 的立项理由。

## 相关文档

> ADR-269（scene-context 共享槽）/ ADR-271（文件级 SCC 拆分）/ ADR-272（把「记得同步」换成「编译失败」的同一课）/ `frontend/src/scene/scene.ts:420-491` / `frontend/src/scene/scene-context.ts:32-53` / `frontend/src/scene/manager/model-loader.ts:91`
