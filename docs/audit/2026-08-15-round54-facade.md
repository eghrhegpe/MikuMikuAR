# 第 54 轮审核报告（测试 #1/3）— env-bridge applyEnvStateFacade 专项

> **审核范围**
> - 测试文件：`frontend/src/__tests__/env-bridge/facade.int.test.ts`（207 行，14 用例，拆自 env-bridge.test.ts，ADR-204 P2）
>   - describe「_applyEnvStateFacade (via setEnvState)」13 用例：facade.int.test.ts:52-189
>   - describe「Module-level edge cases」1 用例：facade.int.test.ts:193-206
> - 被测源码：`frontend/src/scene/env/_bridge/env-bridge.ts`（506 行）
>   - `applyEnvStateFacade`（任务称 `_applyEnvStateFacade`，实际导出名无下划线前缀）：env-bridge.ts:50-105
>   - `setEnvState` 中央入口（测试经此间接调用 facade）：env-bridge.ts:327-355
>   - 迁移器 `migrateEnvState`：env-bridge.ts:305-324（setEnvState 调用链必经，非本测试直接断言对象）
> - 关联生产模块（mock 桩覆盖的外部依赖）：`_bridge/env-dispatcher.ts`（回调注册与调度）、`scene/env/env-impl.ts`（key 分组回调）、`render/lighting.ts`（getLightState/getHemiLight）、`scene/env/env-lighting.ts`（deriveLighting）、`core/config.ts`（envState）、`scene/scene.ts`（ambientColor）
> - 验证：`npm run test -- src/__tests__/env-bridge/facade.int.test.ts` → **14/14 passed（129ms）**；`npx tsc --noEmit` → exit 0（类型检查无新增错误）

> **总体结论：⚠️ 有条件通过**

> **与既往审核关系（注明）**
> - **round-12 审 env-bridge（⚠️）**：P3「`applyEnvStateFacade` 状态直写 `state.groundReflectionQuality`（setEnvState 之外状态直写，副作用不可追踪）」本次确认**仍在**（env-bridge.ts:55-57），且本测试文件 **零覆盖** 该直写路径（无 reflectionQuality/groundReflectionQuality 用例）。
> - **round-53 审 middleware/cel（⚠️）**：其 P2 已登记「middleware 异常隔离测试名实不符」且点明 `facade.int.test.ts:198-206` 与 middleware.int.test.ts:103-124 的 facade 异常部分**跨文件重复**——本次确认该重复**未收敛**（本文件 edge case 保持原状）；round-53 P4 点明 env-mocks.ts:295 的 dispatcher mock 静默吞错 `catch (_) {}`，本文件 edge case 依赖此吞错行为，且该 mock 语义与生产隔离粒度存在偏差（见 P2#1）。
> - 本报告聚焦 facade 集成层（L2）：派发分组、半球光派生、环境色、异常兜底；中间件链与持久化防抖归 round-53 兄弟报告，不重复展开。

---

## 亮点

- **`setEnvState({})` 空变更路径设计巧妙**（facade.int.test.ts:159-188，3 用例）：空 partial 产生空 Set changed，恰好触发「子系统派发跳过但 hemiLight/ambientColor 派生无条件执行」的生产分支（env-bridge.ts:60-84），间接验证了 facade 派生逻辑不依赖 changed——有效断言，非实现细节。
- **skyColorMid 缺失分支覆盖真实守卫**（facade.int.test.ts:159-170 × env-bridge.ts:64-68）：`delete skyColorMid` 后断言 top/bot 均值派生（toBeCloseTo），真实触达 audit-P3 修复的可选链守卫（`guardNum(state.skyColorTop?.[0], 0)`），含旧存档/tests mock 不完整的容错路径。
- **hemiLight 三态覆盖完整**（facade.int.test.ts:131-178）：intensity 走 `getLightState().hemiIntensity * envBrightness`（mockReturnValueOnce 注入 0.6 精确断言）、diffuse 走 skyColorMid、groundColor 走 skyColorBot——facade 的半球光全部三个写入点均被数值断言锁定，且与生产派生公式（env-bridge.ts:69-74）逐行对应。
- **测试卫生合规**：无 it.skip/it.only；beforeEach `vi.clearAllMocks` + Object.assign 复位 13 个 envState 字段（:53-70）保证跨用例隔离；10 连 vi.mock 统一走 `env-mocks.ts` 共享桩（ADR-204 P2 标准配方），backend 桩复用 `fixtures/backend.ts:makeMockBackend`。
- **生产异常兜底结构清晰**（setEnvState `try { facade + post-middleware } finally { schedulePersistEnvState() }`，env-bridge.ts:343-350）：edge case 断言 `not.toThrow()` 验证了入口层「facade 异常不向上抛、不丢失持久化调度」的契约，与 round-53 已审的 `_runMiddlewares`/dispatcher 双层隔离构成完整异常防线。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | facade.int.test.ts × env-mocks.ts × env-impl.ts | :198-206 × env-mocks.ts:289-333 × env-impl.ts:86-117 | **edge case 断言固化 mock 语义，与生产隔离粒度相悖**。用例断言「applySky 抛错后 applyGround 仍被调用」，但生产 env-impl 的 sky/ground/fog 是**同一个回调**内的顺序 if（env-impl.ts:86-117），dispatcher 在**回调级** try/catch（env-dispatcher.ts:40-48）——applySky 抛错会中断同回调的 applyGround，**生产行为与断言相反**。mock dispatcher 把每个子系统做成独立 try/catch（env-mocks.ts:292-333）才让断言通过。后果：测试声称的「子系统级异常隔离」生产不具备；若生产引入「applySky 抛错中断 ground 更新」回归，本测试无法发现。 | 删除 `expect(mockImplApplyGround).toHaveBeenCalled()` 断言，仅保留 `not.toThrow()` + persist 仍调度（验证 setEnvState finally 兜底，此契约在 mock 与生产下均成立）；或在用例注释中明确「mock 为子系统级隔离，生产为回调级隔离」的差异，避免误导后续维护者。 |
| 🟡 P3 | facade.int.test.ts | :112-116 | **用例名与行为不符 + particleType='none' 分支零覆盖**。用例名「disposes particles when particleType is none」，实际 `setEnvState({ particleEnabled: false })` 触发的是 enabled=false 的 dispose 分支（mock dispatcher：`state.particleEnabled && type!=='none'` 为假 → dispose）。「enabled=true 但 particleType='none' → dispose」这一真实分支（env-mocks.ts:317-321 语义，对应生产 env-particles.ts:899-902 注册回调）无用例。 | 改名「disposes particles when disabled」；补一例 `setEnvState({ particleEnabled: true, particleType: 'none' })` 断言 dispose（真正覆盖 none 分支）。 |
| 🟡 P3 | facade.int.test.ts | :180-188 | **「capped at 0.5」用例名实不符，cap 分支未触达**。iblIntensity=2 → `ambientStrength = min(2*0.15*1, 0.5*1) = 0.3`，未压到 cap；断言仅验证 >0 且 ≤0.5（当前输入下恒真）。「cap at ENV_LIGHT_MAX」分支（env-bridge.ts:76-79）需 iblIntensity ≥ 3.34 才触发。 | 补用例：iblIntensity=4（或 >3.34）断言 ambientColor 各通道 = skyMid×0.5（精确值），使 cap 分支被真实验证；当前用例保留作「常规渗透」弱断言或合并。 |
| 🟡 P3 | facade.int.test.ts × env-bridge.ts | :52-189 × env-bridge.ts:92-104 | **方向光同步守卫零覆盖**。`_LIGHT_SYNC_KEYS` 分支（sunAngle/azimuth/skyColorTop/Bot → deriveLighting → setLightState）与 `_presetAnimActive` 跳过守卫在本文件无任何用例（13 用例全部避开这四个键）；presets.int.test.ts:154-232 覆盖的是预设动画期间的 setLightState（动画循环路径），非 facade 同步守卫。facade 三大派生（半球光/环境色/方向光）中方向光是唯一无断言的一块。 | 补 2 用例：`setEnvState({ sunAngle: 30 })` 断言 `mockSetLightState` 收到 deriveLighting 产物；`setPresetAnimActive(true)` 后同键变更断言 `mockSetLightState` 未被调用（守卫生效）。 |
| 🟡 P3 | env-mocks.ts × env-bridge.ts | env-mocks.ts:346-356 × env-bridge.ts:21,87-89 | **mock 面缺口：lightingModule 缺 `rebakeEnvBrightness` 导出**。生产 env-bridge.ts:21 静态导入并在 globalBrightness 变化时调用（:87-89），mock 无此导出。当前用例不含 globalBrightness 键故未触发，但未来新增相关用例会 `TypeError: rebakeEnvBrightness is not a function`（调 undefined）。 | 在 lightingModule 补 `rebakeEnvBrightness: vi.fn()`（一行），保持 mock 面与生产模块面一致；顺带可补一个 globalBrightness 变化触发 rebake 的用例。 |
| 🟡 P3 | facade.int.test.ts × middleware.int.test.ts | :198-206 × middleware.int.test.ts:103-124 | **跨文件断言重复未收敛**。本文件 edge case（applySky 抛错不抛 + ground 仍调用）与 middleware #7 的 facade 异常部分重复——round-53 P2 已登记并建议收敛归属（facade 异常归本文件、persist/入口归 set-env-state），本次确认维持原状。 | 采纳 round-53 建议：middleware #7 删除 facade 异常部分，本文件 edge case 作为唯一归属；删除前确保 `not.toThrow` + persist 兜底断言在 set-env-state 亦有等价覆盖。 |
| 🟢 P4 | env-mocks.ts | :185-286 | **key 分组列表 mock 静态复制，与生产 schema 派生漂移风险**。生产用 `getEnvKeys('sky'/'ground'/...)` 从 ENV_STATE_SCHEMA 派生（env-impl.ts:81-84），mock 手工维护 `_SKY_KEYS_M` 等静态数组。用例 1/2 的「只调相关子系统」断言实际验证 mock 复制逻辑而非生产 schema 分组；且 mock 列表含 `'groundMode'`（生产已迁移删除的字段，migrateGroundMode env-bridge.ts:118-131）——mock 与 schema 已现漂移实例。 | 接受 L2 取舍（集成测试不加载真实 env-impl），但建议：① 移除 mock 中已迁移的 groundMode；② 在 env-mocks.ts 顶部注释声明「key 列表为 schema 快照，schema 变更时需同步」，或改为从真实 env-state-schema 导入派生（若依赖图允许）。 |
| 🟢 P4 | env-bridge.ts | :77,95,35 | 魔法数值（round-53 已登记，本文件未新增，仅确认）：`0.15` ibl 渗透系数（:77）、`azimuth ?? -45` 与 schema 默认值重复字面量（:95）、`_prevEnvBrightness = 1`（:35）。 | 同 round-53 建议：`0.15` 提取命名常量（如 AMBIENT_IBL_FACTOR）；azimuth 默认从 schema 常量导入。 |
| 🟢 P4 | facade.int.test.ts | :159-170 | `setEnvState({})` 空 Set changed 的语义未被显式区分：空 Set（无变化）与 null（全量分发）在 mock 与生产处理一致（均不匹配分组），无 bug，但用例 11 依赖此隐式语义。 | 用例注释点明「{} → 空 Set → 子系统跳过、派生仍执行」，避免后续维护者误读为空分发。 |

---

## 测试质量评价

**分层与 mock 策略（优）**：符合 ADR-204 L2 集成层规范——mock 面收敛于 `env-mocks.ts` 共享桩（10 连 vi.mock 统一走 `await import('./env-mocks')`，vitest 按文件隔离模块图），backend 复用 fixtures 层；被测核心契约（hemiLight 三态派生、环境色、异常兜底入口）断言有效性高，多为数值级断言（toBe/toBeCloseTo），非「测实现细节」。

**断言有效性的两个反向点**：① edge case 的 `applyGround` 断言与生产隔离粒度相悖（P2#1）——mock 把「回调级隔离」放大成「子系统级隔离」，测试绿灯给出错误的保证信号；② 「capped at 0.5」用例未触达 cap 分支（P3），属弱断言。这两点合起来说明：facade 测试对「mock 行为」的验证强，对「生产隔离/边界行为」的验证存在失真与盲区。

**覆盖图谱**：13 用例覆盖 facade 的派发分组（sky/ground/fog/water/particle/cloud 六组 on/off 成对）、hemiLight 三态、ambientColor、异常入口。缺口：方向光同步守卫（P3）、reflectionQuality 直写路径（round-12 遗留，零覆盖）、particleType='none' 分支（P3）。既有 round-12 P3 遗留（groundReflectionQuality 状态直写）与 round-53 P2 遗留（跨文件重复）均未在本文件解决——属预登记遗留，非本轮新增缺陷。

**稳定性与卫生**：14/14 实跑通过（129ms，exit 0），无 skip/only、无 flaky 迹象；beforeEach 复位 + clearAllMocks 配对正确；`tsc --noEmit` 全仓通过。`npm run check` 未整体执行（含 lint 全仓，耗时长），以 tsc + 目标测试双绿为准。

---

> 审核日期：2026-08-15
> 审核员：子代理 round54-facade
