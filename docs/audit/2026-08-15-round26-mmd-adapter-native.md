# mmd-adapter.native 模块 — 审核结果（round-26 / 测试反推源码）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/mmd-adapter.native.test.ts`（323 行，18 用例，无跳过） |
| 被测源码（主目标） | `frontend/src/core/mmd-adapter.ts:210-249`（`applyForceToModelRigidBodiesNative`，P2 / ADR-201 2B 变体） |
| 被测源码（同文件附带） | `mmd-adapter.ts:270-310`（`solveIkNative`，ADR-202 A-class）、`mmd-adapter.ts:332-370`（`applyWindForceToModelRigidBodiesNative`，ADR-200 wind mass-aware） |
| 生产调用点 | `frontend/src/scene/physics/wind-physics.ts:114-131`（wind 导出缺失时降级走中央力导出） |
| ADR 核实 | ADR-201 §9.1/9.2（2B 变体：wasm 侧解析、JS 不碰 bundle ptr；两导出守卫 + ptr 守卫 + 返回施力数）与实现逐条一致；ADR-202 / ADR-200 同源 |

**验证结果**：`cd frontend && npm run test -- src/__tests__/mmd-adapter.native.test.ts` → **18/18 通过（62ms）**。`npm run check`（tsc + i18n 全量）未执行——单文件审核只需验证被测文件，基线全绿由本轮主模型汇总确认；如需要可在汇总阶段补跑。

## 二、总体结论

✅ **通过**

- **生产代码健康**：无 P1/P2。类型安全（0 处 `as any`/`@ts-ignore`，私有 API 全部用有界 `as unknown as X` 收口）；三处守卫（wasm 缺导出 / ptr 缺失 / len<=0）齐全且顺序正确，全部走显式降级返回 0，无静默失效、无崩溃路径；2B 方案彻底规避 `destroyRigidBodyBundle` 析构隐患；函数无 `new`/Observer，无资源释放问题；同步纯函数，无并发状态。
- **测试质量**：直接导入**真实** mmd-adapter（仅 mock logger），断言真实桥接行为而非 mock 重实现——有效护栏；三守卫 + 正常路径全覆盖，守卫"仅警告一次"与"ptr 缺失不读导出"均被真实验证。
- **附带发现**（不影响主目标结论）：4 项 P3 + 4 项 P4，集中在同文件的附带函数与测试脆弱性，见风险表。

## 三、亮点

- **2B 方案落地干净**（`mmd-adapter.ts:194-197` 注释 + `:245-247` 循环）：JS 不持有 bundle ptr，`mmdModelRigidBodyApplyCentralForce(ptr, i, fx, fy, fz)` 全部在 wasm 侧解析——从根上避开 `RigidBodyBundle` finalizer 调 `destroyRigidBodyBundle` 二次销毁模型原生物理的隐患（ADR-201 §9.1 决策偏差的正确执行）。
- **三处守卫 + 顺序正确**（`:216-237`）：① wasm 缺 `getMmdModelRigidBodyBundleLen`/`mmdModelRigidBodyApplyCentralForce` 任一导出 → `_nativeMissingWarned` 仅一次 dev 警告 + 返回 0（升级回归立即可见，绝不静默失效）；② `model.ptr` 非 number（非 WASM 模型）→ 返回 0 且**不读任何导出**（先取 ptr 再查 len 的顺序保证，测试 :94 断言背书）；③ `len <= 0` → 返回 0 且不施力。三守卫覆盖了"升级回归 / 模型形态 / 空 bundle"三个互斥降级面，无幽灵路径。
- **类型安全收口**（`:215`、`:230`、`:238-244`）：对上游未知形状的 `wasmInstance`/`model` 统一 `as unknown as Record<string, unknown>` / `{ ptr?: number }` 有界断言，导出调用前再次 cast 精确签名——生产代码 0 处裸 `as any`/`@ts-ignore`（grep 全文件确认）。
- **测试为"真实逻辑测试"而非自证式**（`test:16-26`）：`@/core/mmd-adapter` **未 mock**，只 mock `@/core/logger` 的 `logWarn`；`makeWasmInstance` 工厂（`:31-36`）构造最小可用 wasm 导出形状，直接驱动真实桥接函数——与 round22 报告的 `_getBundles` 自证式 mock 形成对照，属正确范式。
- **守卫断言有效**（`test:72-106`）：缺导出守卫**调用两次**验证"仅警告一次"（`logWarn` 恰 1 次，防刷屏语义被真实验证）；ptr 缺失守卫断言 `getMmdModelRigidBodyBundleLen` **未被调用**（验证守卫顺序，非仅返回值）；正常路径用 `toHaveBeenNthCalledWith` 验证首/尾索引参数 `(4242,0,...)` 与 `(4242,4,...)`（`:54-69`）。
- **限频日志边界覆盖完整**（`test:171-261`）：`performance.now` 注入，5 用例覆盖首次 / 1000ms 内 / 1001ms 后 / **恰好 1000ms 不触发** / 多次限频后放行（3 次调用仅 2 次日志），边界语义被测试锁定。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | frontend/src/core/mmd-adapter.ts | :354-355 | `applyWindForceToModelRigidBodiesNative` 只守卫 `mmdModelRigidBodyApplyWindForce` 导出，`wi.getMmdModelRigidBodyBundleLen` **无函数守卫直接 cast 调用**（`:355`）。若 wasm 实例有 wind 导出但缺 len 导出（ADR-201 与 ADR-200 补丁版本错配），抛 `TypeError` 而非降级返回 0——违背本模块"升级回归绝不崩溃、绝不静默失效"的守卫哲学（主目标函数两个导出都守卫了，此函数漏一个）。测试也未覆盖该分支（守卫用例只测缺 wind 导出，`test:289-300`）。 | 把 `typeof wi.getMmdModelRigidBodyBundleLen !== 'function'` 并入 :340 的守卫（两导出同查），警告文案同步；测试补"缺 len 导出"分支用例。 |
| 🟡 P3 | frontend/src/__tests__/mmd-adapter.native.test.ts | :171-261 | 限频日志 5 用例依赖模块级 `_solveIkLastWarnTime`（mmd-adapter.ts:269）在**用例间残留**：每个用例首调用时间戳故意比上一用例末时间戳大 1_000_000 才保证触发（如 :219 用 3_000_000、:235 用 4_000_000）。当前声明顺序全绿、单用例独立跑也绿，但**用例重排即失败**（例：用例"1000ms 内"排在"恰好 1000ms"之后时，`now=2_000_000 < last=4_000_000`，差值转负 → 首调用不警告 → 断言失败）。隐性顺序耦合，新增用例易踩坑。 | beforeEach 中 `vi.resetModules()` + 动态 `await import('@/core/mmd-adapter')` 重置模块态，或经 `vi.hoisted` 暴露重置钩子；至少文件头注释声明"限频用例依赖声明顺序"这一前提。 |
| 🟡 P3 | frontend/src/core/mmd-adapter.ts | :294-303 | `solveIkNative` 用 **logWarn（warn 级）打调试 trace**（`[solveIkNative] ptr=..., ikSolverIndex=..., usePhysics=...`），虽限频 1 次/秒，但语义上调试信息不应占 warn 通道——生产开启 warn 日志时每次 IK 重解都刷一条与警告无关的日志（ADR-202 调试用途，测试已锁定该行为，改动需同步测试）。 | 改走 debug 级日志或 `__feetDebug.value` 门控（对齐 AGENTS.md 日志门控精神）；或降级为 dev 构建才输出的 trace。 |
| 🟡 P3 | frontend/src/core/mmd-adapter.ts | :210 / :270 / :332 | 三个 native 桥函数重复同一守卫模板：模块级 `_xxxMissingWarned` 标志 + `wi = wasmInstance as Record<string, unknown> | null` + `typeof wi.xxx !== 'function'` 守卫 + `(model as unknown as { ptr?: number }).ptr` + `typeof ptr !== 'number'` 守卫（各 2 次，共 6 次同形）。单文件内 3 处复制粘贴，改一处漏三处的风险随新增导出函数累积。 | 提取 `_getModelPtr(model): number | null` 与 `_warnOnce(flag: { value: boolean }, message)` helper（同文件私有），三函数复用；不改变"显式守卫绝不静默失效"的语义。 |
| 🟢 P4 | frontend/src/__tests__/mmd-adapter.native.test.ts | :46、:48、:75 等 | `force as never` 后再 `as any` 是反模式：`as never` 把类型降到空集再绕过，意图混乱；`Parameters<NativeFn>[1]` 已有 `ModelArg` 类型（:28-29），force 侧也可 `as unknown as Vector3`。 | 统一改 `{ x, y, z } as unknown as Vector3`（Vector3 可从 `@babylonjs/core` 导入或保持 unknown 断言），删掉 `as never`。 |
| 🟢 P4 | frontend/src/core/mmd-adapter.ts | :296 | 魔法数值 `1000`（限频毫秒阈值）裸写，无常量名；测试侧（test:189-241）以注释"1000ms"隐式对齐，若调整阈值两侧会漂移。 | 提取模块常量（如 `const _SOLVE_IK_LOG_INTERVAL_MS = 1000`）并注释来源；测试同步引用语义。 |
| 🟢 P4 | frontend/src/__tests__/mmd-adapter.native.test.ts | :43-70、:72-84 | 边界覆盖缺口：正常路径只测 len=5 中间值，**len=1 最小有效边界**（首尾索引重合）与 len 极大值未测；缺导出守卫断言了调用次数但**未断言警告文案**——文案含关键诊断信息（导出名、检查指向 ADR-201），文案被意外改坏时测试不变红。 | 补 len=1 用例（断言 `toHaveBeenNthCalledWith(1, ptr, 0, ...)` 即覆盖首尾重合）；守卫用例加 `expect(logWarn).toHaveBeenCalledWith('mmd-adapter', expect.stringContaining('getMmdModelRigidBodyBundleLen'))`。 |
| 🟢 P4 | frontend/src/core/mmd-adapter.ts | :246 | `force.x/y/z` 未校验有限数：若调用方传入 NaN（如风力计算异常），NaN 会直传 wasm 施力。当前唯一调用点 wind-physics.ts:115 保证向量有效，风险极低。 | 可选：入口 `Number.isFinite` 校验 + 返回 0；或维持现状（注释声明调用方契约）。 |

## 五、测试质量评价

- **有效性**：✅ 主目标 4 用例断言全部落到**真实生产函数**（仅 logger 被 mock）——正常路径验证返回值 + 调用次数 + 首尾索引参数（`toHaveBeenNthCalledWith`），三守卫各验证返回值 + 副作用（警告次数 / 导出未调用 / 未施力）。尤其 `test:94` 断言 ptr 缺失时 `getMmdModelRigidBodyBundleLen` **未调用**，实证了"先 ptr 后 len"的守卫顺序，非只比返回值。
- **合理性**：✅ mock 最小且形状对齐：`makeWasmInstance` 只构造被测路径需要的两个导出；`vi.clearAllMocks()` 每用例清理；`performance.now` spy 在 afterEach `mockRestore`。与 round22 报告批评的"自证式 mock"（wind-physics.test.ts `_getBundles`）形成正确范式对照。
- **边界覆盖**：⚠️ 主目标三守卫 + 正常路径全覆盖；缺口集中在**附带函数**——wind 函数缺 `getMmdModelRigidBodyBundleLen` 分支（生产 :355 无守卫，测试也未覆盖，P3）、len=1 最小边界、守卫警告文案内容、正常路径 len 极大值。
- **跳过**：✅ 无 `it.skip`/`describe.skip`/`xit`/`.only`/`.todo`（grep 确认）。
- **可执行性**：✅ 单文件 62ms 秒级完成；node 环境下 `performance.now` spy 稳定，无真实 WASM/Babylon 依赖，无脆弱环境耦合。
- **脆弱性**：⚠️ 限频 5 用例对模块级 `_solveIkLastWarnTime` 的声明顺序耦合（见风险表 P3-2），当前全绿但重构用例顺序即红。

## 六、附注

- 与 round22 报告的衔接：round22 已记录 wind-physics 侧 `applied === 0` 降级哨兵混淆（`wind-physics.ts:127-129`），本次新增的是 mmd-adapter 侧 wind 函数 `getMmdModelRigidBodyBundleLen` 无守卫（`mmd-adapter.ts:355`）——两侧视角互补，同一降级链的两处 P3。
- 生产代码与 ADR-201（§9.1 2B 变体、§9.2 守卫清单、§9.4 验证 5 级）逐条对齐；ADR-201 遗留项（e2e #4 本地回归、wasm 产物分发正式化、`MODEL_WIND_FORCE_SCALE` 标定）不属本次审核范围，仍待跟进。
- 审核日期：2026-08-15
- 审核员：子代理 round26-mmd-adapter-native
