# ADR-263: 每帧回调收口：frame-registry 剩余裸 observer 清单与阶段锚点

> **状态**: 🔄 部分采纳（2026-10-22）
> **日期**: 2026-10-22
> **相关**: ADR-147（MotionPipeline 显式动作管线）、ADR-146（ObserverRegistry 收敛）、ADR-192（上游适配层：骨骼矩阵/坐标系契约）、ADR-116（帧钩子 order）、ADR-081 / ADR-084（PerFrameUpdateRegistry 首次落地）

## 背景与问题

### 一、治理目标

前几轮治理的主线是「把 N 份重复收进 1 份」：ADR-147 收掉了骨骼写入层的**双观察者隐式定序**，
本仓因此已有「每帧回调统一进 `core/frame-registry` 的 `PerFrameUpdateRegistry`」这条共识
（ADR-081 / ADR-084 落地该类，ADR-146 记录 ObserverRegistry 收敛）。

### 二、勘察结论：承诺与现实有落差

`core/frame-registry` 的设计意图是「**一个 scene 一条 observer**，所有每帧回调按 key 注册进同一张表」。
但全仓仍有一批裸 `scene.onBeforeRenderObservable` 订阅点，其中：

- **`lighting-tween.ts`（已在本轮修掉）**：每个活跃 tween 自持一条 `addOnce(tick)` 自续帧——
  N 个 tween = N 条一次性 observer；更糟的是 tick **未包 `safeCallVoid`**，
  tween 回调抛错会冒泡进 Babylon render loop，污染整帧的其它 observer。
  这是全仓**唯一**绕过 `safeCallVoid` 错误隔离的每帧回调。

### 三、三套每帧调度机制并存的现状（本轮新发现）

| 机制 | 位置 | 排序依据 | 宿主 |
|---|---|---|---|
| `MotionPipeline` | `scene/motion/motion-pipeline.ts` | 显式 `stage` + `order`（ADR-147） | `bone-override.ts` 的单一驱动 observer |
| `_frameHooks` | `scene/motion/bone-override.ts:142` | `order` 升序 | 寄生在 pipeline 的 `bone-override` 层内 |
| `PerFrameUpdateRegistry` | `core/frame-registry.ts` | Map 保序（= 注册先后序） | 自持一条 observer |

**旧注释说 pipeline「接入 scene.ts 属 Phase 1 step 2，待办」——已过时**：
`bone-override.ts:1049` 早已是整条管线的唯一驱动 observer
（`observe(scene.onBeforeRenderObservable, () => getMotionPipeline().runFrame({ scene }))`）。

### 四、关键技术事实（读源码核实，非逆工程推测）

1. **通知顺序 = observer 插入序**。`Observable.notifyObservers` 遍历 `this._observers` 实时数组。
2. **循环内 `remove()` 安全**：`Observable.remove()` → `_deferUnregister()` → 置 `_willBeUnregistered`
   + `setTimeout` 延迟 splice（`observable.pure.js:182/216`）；源码注释明写 `_remove`（立即 splice）
   「应在非迭代时调用，避免 callback skipping」（:227）。项目 `core/observer-handle.ts:43` 走公共
   `remove()` → 注册表在自身回调内摘除 observer 不会跳过下一个 observer。✅
3. **`makeObserverBottomPriority` 是立即 splice**（`_remove` + `push`），只能在通知循环**之外**调用。
4. **babylon-mmd 的物理求解 observer 在「场景初始化期」就挂上了**——
   这条是本轮**推翻旧前提**的更正：
   `scene/scene.ts:434` `_initMmdRuntime()` → `:765` `_initMmdRuntime()` → `:839` `runtime.register(scene)`
   → `babylon-mmd/esm/Runtime/mmdRuntime.js:337-338` `scene.onBeforeRenderObservable.add(this._afterPhysicsBinded)`。
   （Optimized 版 `esm/Runtime/Optimized/mmdWasmRuntime.js:473-478` 同构。）
   ⇒ **不是「模型加载时才注册」**。凡按「模型加载时」推理的结论都要作废。
5. **⇒ 场景初始化期的真实 observer 插入序**（`scene/scene.ts` 实测）：

   | # | observer | 注册位置 | 性质 |
   |---|---|---|---|
   | ① | mmd `_afterPhysicsBinded` | `:434` → `:839` | **写**本帧骨骼矩阵 |
   | ② | **共享表 observer** | `:435 initLighting` → `lighting.ts:193 register('render.lighting.cone')` | 首次 register 才创建 |
   | ③ | personalLightTick | `lighting.ts:205` | 读腰骨（**override 前**） |
   | ④ | stageFollowTick | `lighting.ts:212` | 读腰骨（override 前） |
   | ⑤ | footstep-fallback | `scene.ts:726` | 读 IK 骨（override 前） |
   | ⑥ | bone-override driver | `scene.ts:731` | **写** override 覆盖 |
   | ⑦ | camera-bone-lock / 骨骼叠加 / virtual-skirt | 运行时创建 | 读 **override 后** |

6. **⇒ 关键推论（更正后的）**：
   - 共享表在 ②，**排在 mmd ① 之后** → 表内回调读到的是**本帧**骨骼矩阵
     （`mmdModel.js:298-316` → `mmdRuntimeBone.js:312` 写 `bone.worldMatrix`），
     **不是上一帧**；
   - 真正被打破的是 **override 前后**：共享表排在 bone-override driver ⑥ **之前**
     → 表内读到的是**尚未应用 override** 的矩阵；
   - 因此收口判据不是「读不读骨骼」，而是「**要不要 override 后的骨骼**」。

### 五、站点清单与判定（生产代码，已剔除测试/注释/UI 层 rAF）

| 站点 | 回调体做什么 | 要 override 后骨骼? | 判定 |
|---|---|---|---|
| `scene/render/lighting-tween.ts:43,55`（旧） | tween 逐帧驱动（自续帧） | 否 | **已迁入共享表**（本轮 P0） |
| `scene/env/env-time-of-day.ts:340` | 光照预设动画 loop（自带 try/catch，`t≥1` 自销毁） | 否 | **可迁** |
| `scene/camera/camera-auto.ts:197` | 相机预设过渡（smoothstep，`t≥1` 自取消） | 否 | **可迁** |
| `scene/render/renderer.ts:916` | 渲染参数过渡动画（`_cancelRenderTransition` 自取消） | 否 | **可迁** |
| `scene/render/lighting.ts:529` | LightState 过渡动画 | 否 | **可迁** |
| `scene/render/lighting.ts:205` | 个人灯跟随腰骨（`_getLightBasePos`） | 否（现状即 override 前） | **可迁，语义不变**（③→②，仍在 driver 前） |
| `scene/render/lighting.ts:212` | 舞台灯追光（同上） | 否（同上） | **可迁，语义不变** |
| `scene/motion/footstep-detect-fallback.ts:129` | 逐帧检测落地（读 IK 骨上升沿） | 否（现状即 override 前） | **可迁，语义不变**（⑤→②） |
| `core/render-loop.ts:71` | 渲染循环 perf 计时 | 否 | **可迁** |
| `scene/camera/camera-bone-lock.ts:106` | 相机刚性跟随指定骨（`worldMatrix[12..14]`） | **是** | 需阶段锚点（post-override） |
| `scene/manager/model-manager.ts:1109` | 骨骼 overlay 调试线/关节球每帧刷新 | **是** | 需阶段锚点（post-override） |
| `scene/physics/virtual-skirt.ts:442` | 裙摆锚点跟随腰骨 | **是** | 需阶段锚点（post-override）——见 §六 |
| `scene/motion/bone-override.ts:1049` | **MotionPipeline 的唯一驱动 observer** | 驱动物 | 合理豁免（是管线宿主 = 写段锚点本体） |
| `scene/env/planar-reflection.ts:261,274` | RTT 渲染前存/渲染后恢复裁剪面 | 否 | 合理豁免（渲染管线内部） |
| `core/mmd-adapter.ts:423` | `onBoneMatricesUpdated` = `observe()` 改名 | 否 | 合理豁免（命名契约，注释已改写为如实描述） |
| `core/render-loop.ts`（循环本体） / `core/frame-registry.ts:103` | 循环本体 / 注册表本体 | — | 豁免 |

## 决策

### 决策 1：收口判据 —— 按「是否需要 override 后的骨骼」分流，不搞一刀切

- **可迁**：不需要 override 后骨骼 → 进 `getFrameRegistry(scene)` 共享表。
  注意「读骨骼」本身**不是**障碍（个人灯/舞台灯/落地检测今天就在 driver 之前，迁入后位置不变）。
- **需阶段锚点**：需要 override 后骨骼 → 留在 ⑦ 那批「运行时创建的 observer」上，
  等阶段锚点机制落地再决定是否并表。
- **合理豁免**：渲染管线内部（RTT 自身 observable）、管线宿主（bone-override 驱动 observer）、
  循环本体。

### 决策 2：不新增第四套调度器——「阶段锚点」复用既有的 `MotionPipeline`

本 ADR 曾考虑给 `PerFrameUpdateRegistry` 增加 `phase` 字段 + `makeObserverBottomPriority` 重新锚定。
**不采纳**（见「备选方案 A」）。理由：

- `MotionPipeline` 已经把「显式声明阶段」这件事做完了（`stage` + `order` + 快照迭代 + 层级错误隔离），
  再造一套 phase 概念是第 N+1 份重复；
- 读 override 后骨骼的回调多数语义上属于运动/感知，注册进 pipeline 的对应 stage 更贴切；
- pipeline 的驱动 observer 在 `scene.ts:731` 创建，位置天然在 mmd 之后 →
  **「模型后 observer」这个锚点已经存在**，只是没被统一命名与复用。

**各归其位**：

| 回调类型 | 归属 |
|---|---|
| 骨骼**写入**层 + 需要本帧骨骼的层 | `MotionPipeline`（stage + order） |
| 不需要 override 后骨骼的纯逻辑每帧回调 | `PerFrameUpdateRegistry` 共享表 |
| 需要 override 后骨骼的回调（⑦ 那批） | 待阶段锚点落地后统一（短期留在各自 observer） |
| bone-override 模块内部的帧钩子 | `bone-override._frameHooks`（寄生于 pipeline 层，暂不动） |

### 决策 3：本轮已落地——P0：`lighting-tween` 迁入共享表

- 改动：`scene/render/lighting-tween.ts` 的 `_tweenValue()` 改走
  `getFrameRegistry(scene).register('render.lighting.tween.<id>', tick)`；
  **N 条 `addOnce` 自续帧 → 共享表的 1 条 observer**。
- 错误隔离：tick 内 `try/catch` 捕获后 **`finish()` + `onComplete?.()` 再 rethrow**，
  由注册表的 `safeCallVoid` 统一记录，**不再冒泡进 Babylon render loop**。
  **catch 里必须调 `onComplete`**——`applyLightingPresetFromEnv` 的 `pendingTweens` 靠它归零，
  不调则 `lightingState.skipLightAutoSave` 永久 true（自动保存永久失效）。
- 无场景兜底：`lightingState.scene === null` 时直接落到终值 + `onComplete`，
  不再触发旧实现 `lightingState.scene!` 的 TypeError。
- `cancel()` 立即摘除注册（旧实现只 delete Map，留一条空 `addOnce` 到下一帧）。
- 验证：新增 `src/__tests__/lighting-tween.test.ts`（7 例：共用一条 observer / 推进 / 到期 /
  错误隔离 / cancel / 无场景 / 全量取消）；`npx tsc --noEmit` 通过；
  lighting 相关 6 个测试文件 146 例全绿；`npm run test:changed` 130 文件 / 3917 例全绿。

### 决策 4：文档修正（注释与实现对不上的五处，本轮已改）

| 文件 | 问题 | 修正 |
|---|---|---|
| `core/frame-registry.ts` 文件头 | 「排序契约」段把**表内 Map 序**与**表外 Babylon observer 插入序**混为一谈；且断言「本表早于 MMD 模型加载 → 读到上一帧骨骼」 | 改写为「两套顺序别混」+ 完整插入序表 ①～⑦；禁忌收窄为「**不要依赖 override 后的骨骼**」 |
| `core/mmd-adapter.ts` `onBoneMatricesUpdated` | 自称「时序契约固化点」，实现只是 `observe()` 改名，**无任何排序保证**；并称 mmd 在「模型加载时」注册 | 改写真实契约：排序由**注册时刻**决定；mmd 在 `scene.ts:434`（初始化期）注册；该性质是**依赖插入序的隐式契约**，非本函数保证 |
| `scene/motion/motion-pipeline.ts` 文件头 | 「接入 scene.ts 属 Phase 1 step 2，待办」——**已过时**；且称驱动 observer「模型加载后」创建 | 改写为已接入现状；驱动 observer 改述为「场景初始化末段 `scene.ts:731`」；补「生命周期寄生于 bone-override」的代价 |
| `core/mmd-adapter.ts:470` / `scene/render/lighting.ts:204` / `scene/motion/perception-gaze.ts:158` | 三处注释引用 **`BoneFrameClock`**——ADR-192 条目 12 规划的服务名，但全仓**不存在**该类（grep 只命中这 3 处注释），实际落地是 `mmd-adapter` 的自由函数 | 改为指向真实符号：`onBoneMatricesUpdated` / `transformWorldToRootLocal`，并注明 ADR-192 的命名沿革 |

### 决策 5（新增）：共享表 observer 的位置会漂移——这是「阶段锚点」必须显式化的理由

`frame-registry.ts` 的 `unregister()` 在**表空**时会 `_removeObserver()` 摘掉那条 observer；
下一次 `register()` 会**重新创建** observer，而 Babylon 的 `Observable.add` 是 `push` 到队尾
→ **共享表的位置从「初始化期第 ② 位」漂移到「队尾」**（= bone-override driver ⑥ 之后）。
后果：表内回调的「读到 override 前 / 后」语义会**静默翻转**。

现状里表几乎不会空（`env.*` / `camera.*` / `render.lighting.cone` 常驻），但这是**隐式不变式**，
没有断言、没有测试、没有注释保护。⇒ 阶段锚点落地时，**必须把「表内回调处在哪个阶段」变成显式契约**，
而不是继续依赖「谁先 register」。

## 备选方案

- **A（不采纳）：给 `PerFrameUpdateRegistry` 加 `phase` 字段 + `makeObserverBottomPriority` 重锚。**
  看起来最「统一」，但：
  (1) `makeObserverBottomPriority` 是**立即 splice**，只能在通知循环外调用；
  (2) 重锚时机依赖「模型加载完成」信号——项目虽有 `mmku:modelLoaded` DOM 事件与
      `model-loader.ts:79` 的单槽 `_onModelLoaded` 回调，但 core 层订阅 DOM 事件是分层倒挂；
  (3) 需求侧只有 3 个「需要 override 后骨骼」的站点，且它们语义上属于运动/感知管线，
      **放进 `MotionPipeline` 的对应 stage 比起新造 phase 更贴切**。
  ⇒ 保留为「将来确有纯非骨骼的『晚段』需求时」再评估。

- **B（不采纳）：把需要 override 后骨骼的回调也塞进共享表，靠注册顺序碰运气。**
  行为静默改变（跟的是 override 前的腰骨），且「碰运气」不可测、不可回归。

- **C（不采纳）：保留现状，只给裸回调补 `safeCallVoid` 错误隔离。**
  治标不治本：observer 数量、时序脆弱、生命周期泄漏一个都不解决。

## 迁移指南（后续实施时必须遵守）

1. **回调体内自销毁 → 改 `unregister(key)`**。共享表的快照迭代（`[...this.fns.values()]`）
   容忍回调内 unregister；`lighting.ts:529` 的 `_cancelLightingTransition()`、
   `camera-auto.ts:205`、`env-time-of-day.ts:252`、`renderer.ts:895/908` 都要改。
2. **observer 身份比较 → 改 key 级 token 比较**。`renderer.ts:890-897` 用
   `if (_renderTransitionObserver === currentObserver)` 防旧帧误杀新过渡；迁表后没有 observer 身份可比，
   必须用 key + 代次 token。
3. **共享表在 `dt <= 0` 或非有限的帧整帧跳过**（`frame-registry.ts:112-114`）。
   被迁站点若按「帧计数」语义（如 footstep 的上升沿检测）需确认首帧跳过无害。
4. **同一 key 不可并存两条动画**。`env-time-of-day` 新旧预设共用 key 时必须先 unregister 旧 key，
   否则两条动画并行互相覆盖。
5. **相机行为的表内顺序**：共享表已有 `camera.freefly / orbit / surround / concert`
   （`camera-behaviors.ts:52,201,272,312`），表内顺序 = register 序。
   迁 `camera-auto` 过渡时须确认不会覆盖相机行为 tick 的结果。
6. **骨骼跟随类要成对迁**：`personalLightTick` 与 `stageFollowTick` 共用 `_getLightBasePos`，
   只迁一条会导致同一帧出现两套腰骨位置（一条 override 前、一条 override 后）→ 要么都迁要么都不迁。
7. **table 空/非空切换会漂移 observer 位置**（决策 5）——迁移后需补一条断言型测试。

## 影响

- **改动文件**：
  - `frontend/src/scene/render/lighting-tween.ts`（P0 迁入共享表）
  - `frontend/src/__tests__/lighting-tween.test.ts`（新增 7 例）
  - `frontend/src/core/frame-registry.ts`（文件头排序契约注释改写）
  - `frontend/src/core/mmd-adapter.ts`（`onBoneMatricesUpdated` 注释 + `BoneFrameClock` 幽灵符号）
  - `frontend/src/scene/render/lighting.ts:204`（`BoneFrameClock` 幽灵符号 + override 时序说明）
  - `frontend/src/scene/motion/perception-gaze.ts:158`（`BoneFrameClock` 幽灵符号）
  - `frontend/src/scene/motion/motion-pipeline.ts`（文件头接入现状）
  - `docs/adr/adr-263-frame-registry-convergence-inventory.md`（本文件）+ `docs/adr/index.md` + `docs/status.md`
- **待办（后续 ADR）**：
  1. 迁 8 个「可迁」站点（`env-time-of-day` / `camera-auto` / `renderer` / `lighting` 过渡 /
     `personalLight` / `stageFollow` / `footstep-fallback` / `render-loop` perf 计时），
     按「迁移指南」7 条执行；
  2. 为 3 个「需要 override 后骨骼」站点定归属（`camera-bone-lock` / 骨骼 overlay / `virtual-skirt`），
     并把阶段锚点做成显式契约（决策 5）；
  3. `core/frame-registry.ts` 与 `core/ui-motion.ts` **仍无知识卡覆盖**
     （`scripts/check-doc-drift.mjs` INFO，非阻断）→ 补卡。
- **风险**：
  - 迁「可迁」站点会改变它们在 `onBeforeRenderObservable` 里的**相对位置**（移到共享表 observer 处）。
    对不依赖 override 后骨骼的回调无语义影响，但需逐站跑回归；
  - 共享表在 `dt <= 0` 或非有限的帧**整帧跳过**；
  - 共享表 observer 位置可能因「表空 → 再注册」而漂移到队尾（决策 5）。

## 相关文档

- `frontend/src/core/frame-registry.ts` — 每帧共享表本体
- `frontend/src/scene/motion/motion-pipeline.ts` — ADR-147 显式阶段管线
- `frontend/src/core/mmd-adapter.ts` — `onBoneMatricesUpdated`（注册时刻契约）/ `transformWorldToRootLocal`
- `frontend/src/scene/scene.ts:430-486` — `_doInitScene`：observer 插入序的事实来源
- `docs/adr/adr-147-*.md` — MotionPipeline 决策
- `docs/adr/adr-192-*.md` — 上游适配层（条目 12 骨骼矩阵/坐标系契约）
- `docs/adr/adr-081-xpbd-removal.md` / `docs/adr/adr-084-mesh-to-cloth-virtual-skirt-bones.md` — PerFrameUpdateRegistry 首次落地
- `frontend/node_modules/@babylonjs/core/Misc/observable.pure.js` — Observable 通知/移除语义
- `frontend/node_modules/babylon-mmd/esm/Runtime/mmdRuntime.js` — mmd runtime 的 observer 绑定时机
