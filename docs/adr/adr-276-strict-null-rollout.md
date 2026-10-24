# ADR-276: 严格模式渐进收敛：Stage 2 打开 strictNullChecks — 362 处空值判断的三批收口与影子清零

> **状态**: ✅ 已采纳（2026-10-24）
> **日期**: 2026-10-24
> **前置**：ADR-274（Stage 1 `noImplicitAny`）——本 ADR 是同一阶梯的第二级。ADR-274 决策 5 写下「阶梯不预设，`strictNullChecks` 无法按目录分片，只能整体翻，所以它必须另立阶段」，本文就是那个阶段。

## 背景

### 数字（2026-10-24 重测，基线 HEAD `0bffbe4d`）

把 `strictNullChecks: true` 叠到当前 tsconfig 上做影子检查（开关不落地，见决策 2）：

| 口径 | 处数 | 文件数 |
|---|---|---|
| 合计 | **362** | **76** |
| 生产代码 | **163** | **46** |
| 测试与 mock | **199** | **30** |

按错误码：TS18047（对象可能为 null）113 · TS2345（参数类型不收 null/undefined）88 · TS2454（变量在赋值前被使用）72 · TS2322（赋值类型不兼容）43 · TS18048（对象可能为 undefined）16 · TS2722（调用可能为 null 的函数）10 · TS2783 · TS2339 · TS18049 · TS2531/2532 · TS2721 · TS2677 · TS2352 · TS2349 · TS2769 共 14。

生产侧热点：`scene/manager/model-loader.ts`(16)、`scene/motion/proc-motion-controller.ts`(13)、`scene/manager/outfit.ts`(11)、`menus/library-actions.ts`(9)、`menus/library-setup.ts`(9)、`menus/model-detail.ts`(9)、`scene/scene-serialize.ts`(9)、`menus/settings-system.ts`(6)、`scene/env/env-wetness.ts`(6)、`scene/manager/model-manager.ts`(6)、`scene/scene.ts`(6)。
测试侧热点：`__tests__/physics-contract.constraint.test.ts`(37，全是 TS2454)、`core/backend/backend.data-chain.test.ts`(20)、`__tests__/physics-contract.collision-worlds.test.ts`(19)、`__tests__/physics-contract.rigidbody.test.ts`(16)、`core/backend/browser-adapter.texture-collision.test.ts`(15)、`__tests__/model-ops.test.ts`(14)。

> 口径差异：ADR-274 记的 Stage 2 是 386 处。那是 2026-10-24 早些时候的树（脚部/脚步声那条线的代码尚未回位、还有一批标注未落），与本 ADR 的 362 不是手法差异。**排期用本 ADR 的数，别再引用 386。**

### 这一级与 Stage 1 是两种活

Stage 1 的 129 处是互不相干的显式标注，**零判断**：每个 `null as X | null` 都不改变任何语义，所以能一口气清零。
Stage 2 的每一处都是一道判断题：**这个值真的可能为 null 吗？** 答错有两种伤害方式，方向相反：

- 加 `!` 断言：把真实崩溃点伪装成"已确认安全"，编译器从此不再管它——**这是 362 个 `!` 就能让整关全绿的作弊路径**；
- 加 `?.`：把一次响亮的崩溃换成静默的 `undefined` 向下游扩散，症状离根因更远。

所以本阶段的验收不是"错误数归零"，而是"每处判断都有明确依据"。这也是它比 Stage 1 危险、但也更有价值的地方：Stage 1 只钉住未来，Stage 2 会**翻出存量 bug**。

### 判断点聚在少数几个根上（实测，不是估计）

抽查三个生产热点的 40 处，逐行读源码后，其中 21 处塌进 3 个根因：

| 根因 | 症状 | 收口 |
|---|---|---|
| `scene/manager/model-loader.ts:73` `let _modelManager: ModelManager \| null = null;`，`:102` 由初始化函数赋值；9 个调用点（`:596 :605 :629 :724 :749 :780 :802 :809` 与 `_refreshWaterRenderList`）默认它非空 | 9 | 一个 `requireModelManager()` 访问器，9 处变 `requireModelManager().x()`；顺带把"初始化前调用"从匿名 `TypeError` 变成带名字的错误 |
| `scene/motion/proc-motion-controller.ts:128` `const modelIdAtStart = modelIdOverride ?? focusedModelId ?? null;`，其下 12 处当 `string` 用 | 12 | 赋值处一次早返回，12 处一起消 |
| `scene/manager/outfit.ts:270` `_applySlot` 的参数类型是 `Texture \| null`，调用方传的是 `Texture \| null \| undefined`（`inst._origTextures` 的字段本身可选） | 9（+1 TS18048） | 签名放宽为 `Texture \| null \| undefined`，调用方不动 |

结论：**362 不是 362 个决定，而是"少数根 + 一批同一根的回声"**。按根收口，成本是线性的一半；逐处打补丁，成本是平方级的 review 负担，且必然滑向 `!`。

### 为什么不能按目录分片

TypeScript 的严格性开关是 **project 级** option，一个 `tsconfig.json` 一套值，没有"目录级 strict"。ADR-274 备选 B 的双 tsconfig 是唯一的分片路线，代价是多一份真源 + 两份 `tsc`（pre-push 缓存键基于单 tsconfig 哈希，见 ADR-258）。

但**分片可以发生在"清零过程"里**：开关不落地，影子检查器按文件给计数，一批一批清。这正是 ADR-274 已经跑通的模式（批 0–4），且 Stage 2 比 Stage 1 更安全——收口写法在开关 off 时同样合法，随时可以停在半路而不留红灯。

## 决策

1. **收口优先，禁止逐处打补丁。** 只认三种改法：① 收口访问器（`requireX()`）；② 早返回收窄（`if (!x) return;`）；③ 签名放宽（`| undefined`）。同一个根因产生的多处报错必须一次性收口，不允许 N 个 `!`。
2. **影子清零，开关最后落地。** 唯一清点工具是 `frontend/node_modules/.tmp/strict-check.mjs`（`node node_modules/.tmp/strict-check.mjs --strictNullChecks [路径子串…]`，约 10s，输出 `SUMMARY errors=… prod=… test=…` 与逐行诊断）。每批提交时真 `tsc --noEmit` 必须保持 EXIT=0——开关不在，这只是"没弄坏"，不算验收通过。
3. **四批，每批独立可验证**（见实施计划）。批与批之间不共享工作区状态，避免 ADR-274 那种"两条线在同一棵树里互相踩"。
4. **验收铁律（每批五件事）**：影子检查该批文件计数归零 · 真 `tsc --noEmit` EXIT=0 · `node node_modules/prettier/bin/prettier.cjs --check <改动文件>` 通过 · 该批涉及的测试文件全绿 · eslint 该批文件 0 error。
5. **给 `!` 记账，但不翻转 eslint。** 实测全仓已有 900 处 `!`（`src/**`，`@typescript-eslint/no-non-null-assertion` 在 `frontend/eslint.config.js:59` 被显式设成 `off`）：测试 755 处（`expect(x!).toBe()` 这类惯用法），生产 145 处 / 57 文件（热点 `menus/render-menu.ts` 12、`scene/render/lighting-stage.ts` 8）。把规则翻成 `warn` 等于把 900 条存量噪声合法化，`npm run lint` 从此每次都刷屏——**噪声不是纪律**。
   替代做法：每批用 `eslint --rule`（不改配置）对**该批文件**做一次增量计量，数字写进本 ADR 的落地记录；生产侧 145 处作为基线。真正的 ratchet（基线文件 + 只许降不许升）留作本阶段收尾时的独立提案，因为它需要新脚本 + 钩子接线，不该混在类型迁移里。
   无论计量与否，一条不变：凡本阶段新增 `!`，必须在代码旁写一行"为什么这里不可能是 null"。
6. **行为改动必须显式。** 早返回会改变控制流；每处早返回都要在提交信息里写明触发条件，且**触发路径必须有测试覆盖**，否则退化为签名放宽——宁可让类型多带一个 `| null` 往下走，也不要在没有测试的路径上悄悄改变行为。

## 备选方案

| 方案 | 为什么没选 |
|---|---|
| **A. 双 tsconfig：生产严格 / 测试宽松** | 多一份真源 + 两份 `tsc`（缓存键见 ADR-258）；且类型会在 project 边界上互相污染，边界文件必须两边都合法，等于要求"生产已全干净"。保留为清零停滞时的降级方案 |
| **B. 362 个 `!` 一把过** | 一天就能全绿，然后把 362 个"可能为 null"变成 362 个"编译器已批准的假设"。天体物理式的乐观：任何一处判断错都变成线上崩溃，且没有测试能提前发现 |
| **C. 只开生产，测试放 `exclude`** | 与 ADR-274 决策 1 同理：测试失去全部类型检查，比现在更差。而且测试侧 199 处里 TS2454×72 恰恰在提示"这些用例的夹具变量可能没初始化"——那是测试可靠性问题，不是噪声 |
| **D. 先删/跳过 physics-contract 系列测试** | 那 37+19+16 处是同一个模式（`let body: Body;` 声明后在分支里赋值），删测试等于把物理契约的回归网扯掉。正确做法是把夹具初始化收口（一个 helper） |
| **E. 不做** | `strictBindCallApply` / `useUnknownInCatchVariables` / `noImplicitAny` 已经把这条阶梯走到第二级；停在 `noImplicitAny` 意味着"参数必须有类型，但类型里的 null 全是装饰"——最容易被误读成"我们开了严格模式" |

## 影响

| 对象 | 改动 |
|---|---|
| `frontend/tsconfig.json` | +1 行 `"strictNullChecks": true`（**批 D 才落地**，与清零同提交；2026-10-24 已落地） |
| 生产代码 | 46 文件 / 163 处，按根收口后预计 60–80 个实际改动点 |
| 测试与 mock | 30 文件 / 199 处，其中 `physics-contract.*` 三个文件 72 处的 TS2454 应收口到夹具初始化 helper |
| `frontend/eslint.config.js` | **不改**（决策 5：存量 900 处噪声，翻 warn 无意义）；改为每批用 `eslint --rule` 增量计量 |
| 门禁 | 无新脚本。pre-push 的 `tsc --noEmit` 从"查隐式 any"升级到"查空值"——同一个进程，更强的谓语 |
| 与 ADR-274 的关系 | 同一个阶梯的下一级，共用影子检查手法；ADR-274 的 386 作废，以本 ADR 的 362 为准 |
| 与 ADR-093 的关系 | 菜单 Schema 的 `StatePath` 读 `uiState` 时天然产出 `T \| undefined`，本轮 `menus/*` 的 33 处大多是这个形状；收口方向是"读路径的 helper 返回收窄后的类型"，不是给每个菜单项加 `!` |

## 风险与止损

1. **以 `!` 换 null（masking）。** 这是本阶段唯一的真正失败模式，而且它"看起来完成了"。止损：决策 1 的三种改法白名单 + 决策 5 的 eslint 计量 + 每处 `!` 必须带理由注释。
2. **影子清零 ≠ 真清零。** 开关 off 时 `T | null` 会退化成 `T`，收窄写法在 off 下合法、在 on 下才对；反过来在 on 下清零了，off 下也可能因为类型加宽冒出新的 TS2345。止损：每批同时跑影子与真 `tsc` 两端（决策 4）。
3. **早返回改变控制流。** 例如 `proc-motion-controller` 的 `modelIdAtStart` 若为 `null` 时早返回，原本"用 null 继续跑并静默失败"的路径变成"什么都不做"。止损：决策 6，无测试覆盖的路径一律退化为签名放宽。
4. **与并行线互相踩。** ADR-274 已经付过学费（见 ADR-275 附注）。止损：本阶段每批一个工作区、一批一提交、提交即推送，不留半干净状态。

## 实施计划

| 批次 | 范围 | 处数 | 验收 |
|---|---|---|---|
| **批 A**（✅ 2026-10-24） | 热点 5 文件：`scene/manager/model-loader.ts`(16)、`scene/motion/proc-motion-controller.ts`(13)、`scene/manager/outfit.ts`(11)、`__tests__/physics-contract.constraint.test.ts`(37)、`core/backend/backend.data-chain.test.ts`(20) | 97 → 0 | 含 3 个收口点；影子 5 文件归零 + 真 tsc EXIT=0 + 5 个测试文件全绿（实测见落地记录） |
| **批 B**（✅ 2026-10-24） | 生产其余 43 文件（热点见背景） | 123 → 0 | 同上，按根分组：`menus/library-*`、`menus/model-detail`、`scene/scene-serialize`、`scene/env/*` |
| **批 C**（✅ 2026-10-24） | 测试其余 28 文件（`physics-contract.*` 两个兄弟、`texture-collision`、`model-ops`、`prune-history` 等） | 142 → 0 | 夹具初始化收口到 helper，禁止逐处 `let x!: T` |
| **批 D**（✅ 2026-10-24） | 打开 `strictNullChecks` + 全量门禁 | 0 | `tsc` EXIT=0；全量 `test:quick`；`check`/`deadcode` 绿 |

## 落地记录（2026-10-24，批 A 完成）

### 结果

| 文件 | 原处数 | 收口手法 | 备注 |
|---|---|---|---|
| `scene/manager/model-loader.ts` | 16 | ①②③ | `requireModelManager()` / `callRefreshWaterRenderList()` 两个访问器吃掉 10 处；其余是返回值收窄与签名对齐 |
| `scene/motion/proc-motion-controller.ts` | 13 | ② | `modelIdAtStart === null` 处一次早返回，12 处一起消 |
| `scene/manager/outfit.ts` | 11 | ③ | `_applySlot` 的 `origTex` 放宽为 `Texture \| null \| undefined`；顺带去掉一处 `!` |
| `__tests__/physics-contract.constraint.test.ts` | 37（全 TS2454） | 夹具声明放宽 | 见下"两条新根因" |
| `core/backend/backend.data-chain.test.ts` | 20 | 测试侧 helper | 同上 |

影子检查全量：**362 → 265**（生产 163→123 /43 文件，测试 199→142 /28 文件），与三批预算（97+123+142）逐项对上；真 `tsc --noEmit` EXIT=0；`!` 增量：**+0 / −1**（生产基线 145 → 144）。

### 两条新根因（批 A 才暴露，批 B/C 会再遇到）

1. **闭包不吃 `let` 的收窄。** `physics-contract.constraint.test.ts` 的 37 处 TS2454 不是"变量没赋值"，而是 `expect(() => api.destroyConstraint(constraint)).not.toThrow()` 这类**箭头闭包里的使用**：TS 对 `let` 变量的窄化不穿透闭包（闭包可能在任意时刻执行）。把声明改成 `number | undefined` 只是把 TS2454 换成 8 处 TS2345。正确收口是**在赋值之后立刻把值接到一个 `const` 上**（`const constraintId = constraint;`），闭包只用 `const`——这不是注解，是把"创建成功后才使用"这个既有语义写进类型。批 C 的 `physics-contract.collision-worlds`(19) / `rigidbody`(16) 是同一模式，照此收口。
2. **契约宽于实现。** `browserAdapter` 的声明类型是 `BackendService`（`frontend/src/core/backend/browser-adapter.ts:1379`），而 `BackendService.GetConfig` 在契约上是可空的，实现（`:1454`）却是 `Promise<Config>`。于是 15 个使用点全在跟一个**不存在的 null** 缠斗。批 A 在测试侧收口（`getConfig()` helper：读到 null 就直接抛"GetConfig 返回 null"，比 `Cannot read properties of null` 更能指路）；**真正的收口是把 `BackendService.GetConfig` 收窄成 `Promise<Config>`**——那要改契约与所有后端实现，超出类型迁移的范围，留给批 D 之后单独评估（不要在批 B 里顺手改）。

### 环境

- 影子检查器重建：旧的 `node_modules/.tmp` 被清空过（`npm install --package-lock-only` 之后 `.tmp` 只剩 tsbuildinfo），所以 `strict-ladder-measure.mjs` / `noimplicitany-check.mjs` 都已不在。新脚本 `frontend/node_modules/.tmp/strict-check.mjs` 通过 `ts.getParsedCommandLineOfConfigFile(cfgPath, overrides, host)` 叠加 flag（host 必须含 `readDirectory: ts.sys.readDirectory`，否则 `include` 失效），断言 `noImplicitAny === true` 防误测。
- 基线实测 362 / 76：生产 163 / 46，测试 199 / 30（详见背景）。
- `!` 断言基线（`eslint --rule` 实测）：生产 145 处 / 57 文件，测试 755 处。批 A 开工时以此为准，收口过程不得净增。
- 批 A 验证：`model-loader.test.ts` 21 用例 · `outfit.test.ts` + `proc-motion-bridge.test.ts` + `proc-motion-migrate.test.ts` 111 用例 · `physics-contract.constraint.test.ts` 5 用例 · `backend.data-chain.test.ts` 22 用例，全绿；eslint 该批 5 文件 0 error（46 warning 全是既有 `curly`/complexity/max-lines 存量，未新增）。

## 落地记录（2026-10-24，批 B–D 完成）

### 推进曲线（每行都是影子检查器的实测，不是估算）

| 节点 | 合计 | 生产 | 测试与 mock |
|---|---|---|---|
| 基线 | 362 / 76 文件 | 163 / 46 | 199 / 30 |
| 批 A 收尾 | 265 / 71 | 123 / 43 | 142 / 28 |
| 批 B 前段（两处访问器 + `menus/*` 集群） | 232 / 66 → 173 / 46 | 90 / 38 → 31 / 18 | 142 / 28 |
| 批 B 收尾 | 生产归零 | 0 / 0 | 140–142 / 26–28 |
| 批 C 收尾 | **0 / 0** | 0 / 0 | 0 / 0 |

终态 `SUMMARY errors=0 files=0 prod=0/0 test=0/0 programFiles=3951 noImplicitAny=true strictNullChecks=true strict=false`；开关落地后真 `tsc --noEmit -p tsconfig.json` **EXIT 0**。

### 批 B：两个访问器吃掉 20 处，其余是"契约宽于实现"

| 收口点 | 手法 | 消掉 |
|---|---|---|
| `menus/menu-stack-registry.ts` 新增 `requireModelStack()` | ① 收口访问器（`stack === null` 就抛"渲染前被点击？"） | `library-actions` / `model-detail` / `model-preset` 8 处 |
| `core/wails-bindings.ts` 新增 `requireConfig()` | ①（`GetConfig()` 返回 null 就抛"后端未就绪？"） | `menus/library-setup.ts:88` / `core/init.ts:247 :340` |
| `library-actions.ts` 两处 `ExtractZip().then(...)` | ② 早返回（`!result` 抛错，落进既有 `feedbackError('library.extractFailed')`） | 2 |
| `menus/model-detail.ts` / `settings-downloads.ts` / `settings-about.ts` | ②③（`?? []`、`if (!inst || !inst.filePath)`、`?.querySelector`） | 12 |
| `scene/manager/material.ts` `_isPbrMaterial` | ③ 签名放宽（`Material \| null \| undefined`，Babylon 的 `mesh.material` 本就含 null） | `menus/model-material.ts` 2 |
| `core/ui-rows.ts` / `core/ui-slide-row.ts` | ③ 参数与工厂类型放宽（`string \| null`、`() => HTMLElement \| null`） | `motion-camera-levels` / `outfit-ui` 3 |

### 批 B/C 又暴露的四条根因

3. **可选方法 ≠ 可空对象（TS2722）。** 一半的 TS2722 不是"对象可能是 null"，而是"接口把方法写成可选"。收口两条路：接口的实现本就必选（`SlideMenu.push` 在 `menus/menu.ts:422` 是必选方法）→ 把可选去掉；确实可能缺席（桥未注册）→ 显式抛错落进既有 catch，**不要用 `?.()`**——`ar-camera.ts` 里 `requestCameraPermission?.()` 会让 15s 超时才报错，显式抛错则立刻 settle(false)。
4. **TS 不能从索引反推容器。** `menus/model-material.ts` 原写 `const idx = detail ? detail.index : -1; if (idx === -1) continue;` 之后 `detail.modified` 仍报 TS18047：`idx` 收窄了，`detail` 没有。必须先判 `!detail` 再取 `idx`。
5. **模块级 `let` 的每次求值都是新的 null。** `menus/library-actions.ts:74` 的 `let _mmkuDisp: Disposable | null = null` 全文件唯一赋值在 :95，于是 :92 的 `_mmkuDisp?.dispose()` 被流分析判成 `never`（TS2339）——这一行 HMR 幂等清理**从来就是 no-op**。处置：删掉该行并把注释改成"真幂等要把句柄挂 `globalThis`，本次不做"。这是 Stage 2 翻出的第一处死代码。
6. **`safeCallAsync` 收到 undefined 回调会把整个初始化带崩（真 bug）。** `core/init.ts:175` 原写 `safeCallAsync('init', 'Library init', () => getSceneAction('initLibrary')?.())`：桥未注册时内层返回 undefined，`safeCallAsync`（`core/safe-call.ts:46` 签名 `fn: () => Promise<T>`）里 `fn().then` 抛 TypeError 冒到 `init()` 的 catch，**整个初始化失败**——而代码刚刚 warn 过"桥缺失"。已改为先取函数再判空。这类"静默跳过"的注释与实际行为相反，只有类型系统会逼你看第二眼。

### 批 C：mock 是签名源，改一处要同步全部副本

7. **mock 的返回类型会被 null 字面量锁死。** `vi.fn(() => null)` 推出 `Mock<() => null>`，用例里 `mockReturnValue(x)` 就报 TS2345。收口是给工厂补显式返回类型：`vi.fn((): unknown => null)`。**共享 mock 是签名源**：`__tests__/perception/perception-mocks.ts` 的 `createMockState` 被 5 个 perception 测试文件以同名 hoisted 副本复制（`setupPerceptionTest(mockState: ReturnType<typeof createMockState>)` 把两边钉在一起），改一处必须同步 5 处，否则 `Mock<() => unknown>` 与 `Mock<() => null>` 不兼容。
8. **闭包与流分析会把未赋值的 `let` 窄化成 `null`。** `__tests__/camera.test.ts` 的 hoisted 工厂 `return { sceneObj, focusedModelId }` 里，这两个 `let` 在工厂内从未赋值，TS 认为它们恒为 `null`，于是下方 `shared.focusedModelId = 'm1'` 报 TS2322。修法是在 return 处显式宽化（`as string | null`），并删掉同名的短属性（否则 TS1117 重复属性）。
9. **`null` 字面量类型上的 `!` 得到 `never`。** `__tests__/lighting-stage.test.ts` 的 `StageLightEntry.indicator` 静态类型是 `null`，`entry.indicator!.material` 报 TS2339 `Property 'material' does not exist on type 'never'`。`!` 在 `never` 上是无效止痛药，只能 `as unknown as`。
10. **异步步钩子的类型是 `() => Promise<void>`，同步 recorder 不合法。** `__tests__/scene/boot-plan.test.ts` 的六个 init 步钩子（initMmdLoaders / initFeetAdjustment / initFootstep / initBoneOverride / initWasmIkResolver / initMotionModules）塞的是返回 undefined 的同步 recorder，收口成 `const recordAsync = (name: string) => async (): Promise<void> => { calls.push(name); }`。

### 批 D：开关与清零同批落地

- `frontend/tsconfig.json` 在 `noImplicitAny` 之后加 `"strictNullChecks": true`（`"strict": false` 保留，Stage 3 才翻）。
- 验收（全部实测）：真 `tsc --noEmit -p tsconfig.json` **EXIT 0**；全量 vitest **263 文件 / 6086 用例全过**（125s）；prettier 改动文件全过（首轮 11 个 offender 已 `--write`）；eslint 79 个改动文件 **0 error**（121 warning 全是既有 `curly`/complexity/max-lines 存量）；`npm run check:lint` EXIT 0；`npm run deadcode`（knip）EXIT 0；`npm run check:docs` EXIT 0（含 `gen:funcmap` 重生成，60 插入 / 60 删除）。
- `!` 记账终值：生产侧 145 → **143**（新增 0，删掉 2），测试侧未净增。

### 环境

- 影子检查器重建：旧的 `node_modules/.tmp` 被清空过（`npm install --package-lock-only` 之后 `.tmp` 只剩 tsbuildinfo），所以 `strict-ladder-measure.mjs` / `noimplicitany-check.mjs` 都已不在。新脚本 `frontend/node_modules/.tmp/strict-check.mjs` 通过 `ts.getParsedCommandLineOfConfigFile(cfgPath, overrides, host)` 叠加 flag（host 必须含 `readDirectory: ts.sys.readDirectory`，否则 `include` 失效），断言 `noImplicitAny === true` 防误测。**带路径过滤时 SUMMARY 仍报全量 programFiles=3849/3951，errors 只统计过滤结果，且 exit code 恒 0 —— 必须读 SUMMARY 行。**
- `! ` 断言基线（`eslint --rule` 实测）：生产 145 处 / 57 文件，测试 755 处。
- 批 A 验证：`model-loader.test.ts` 21 用例 · `outfit.test.ts` + `proc-motion-bridge.test.ts` + `proc-motion-migrate.test.ts` 111 用例 · `physics-contract.constraint.test.ts` 5 用例 · `backend.data-chain.test.ts` 22 用例，全绿。

## 相关文档

> ADR-274（Stage 1 noImplicitAny：本阶段的直接前置）/ ADR-258（pre-push tsc 实测耗时与缓存键）/ ADR-093（声明式菜单 Schema 的 StatePath）/ ADR-275（同一工作树并行的另一条线，误撤销的复盘）
