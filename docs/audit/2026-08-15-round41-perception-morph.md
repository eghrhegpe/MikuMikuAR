# round-41 perception-morph 集成测试审核报告（微表情 + 唇形同步）

## 审核范围

| 类别 | 文件 | 说明 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/perception/perception-morph.int.test.ts`（360 行，24 用例 / 5 describe） | 微表情 + 唇形 morph 驱动集成补测（2026-08-10 合并 micro-expression + lipsync） |
| 被测源码 | `frontend/src/scene/motion/perception-expression.ts`（86 行，全量） | `_applyMicroExpression` 情绪脉冲 morph 驱动 |
| 被测源码 | `frontend/src/scene/motion/perception-lipsync.ts`（235 行，全量） | `_applyLipSync` + per-model runtime 状态机 |
| 被测源码 | `frontend/src/scene/motion/perception-observer.ts`（166 行，全量） | 帧回调调度（L90-106 微表情 / L127-133 唇形） |
| 被测源码 | `frontend/src/scene/motion/perception.ts`（820 行，抽查关键段） | 状态 API / activatePerception / deactivatePerception / _resetContextOffsets |
| 被测源码 | `frontend/src/scene/motion/perception-shared.ts`（484 行，抽查） | PerceptionState / DEFAULT_PERCEPTION_STATE / PerceptionPerfMonitor |
| 被测源码 | `frontend/src/scene/scene-migrate.ts`（104 行，全量） | migratePerceptionFromProcMotion / migrateLipSyncFromOldState |
| 间接依赖 | `frontend/src/motion-algos/lipsync.ts`、`proc-motion-shared.ts:295 matchBone`、`@/core/clamp`、`@/core/scene-action-bridge` | 均已 mock 或此前审核覆盖 |

**验证方式**：`cd frontend && npm run test -- src/__tests__/perception/perception-morph.int.test.ts` → **24/24 通过**（3.44s，含真实 bone-override-store 认领日志）。`npm run check`（全项目 tsc）**按任务允许跳过**——本轮零代码改动、测试全绿，类型基线不受影响。

**历史关系**：
- **round-8** 审 perception 拆分（`round-8-perception-split.md` ✅，P1 全修复，61 用例覆盖所有感知函数）；
- **round-15** 审 perception 全量（`round15-motion-pipeline-perception-proc.md` ✅：perception-expression「✅ 优」、perception-lipsync「✅ 通过」）；
- **round-25** 审 lipsync 纯算法层（`round25-lipsync.md` ✅，motion-algos/lipsync.ts 42 用例，遗留 P3 候选名重复 + P4 知识卡滞后，本次核实**仍存在**）；
- **本测试为微表情+唇形集成补测**：前几轮只覆盖算法层/单模块，本测试首次经真实 observer 调度链路（activatePerception → mockPipeline.register → triggerLastObserver）断言 morph 权重真实写入与复位。

## 总体结论：⚠️ 有条件通过

测试本身质量高（24/24 全绿、断言可推导、mock 合规），被测生产代码健康度良好（0 处 `as any`/`@ts-ignore`、资源释放链完整、per-model 隔离清晰）。但发现 **1 个 P2**：感知层**注销/切换焦点路径不主动清零 morph influence**，与测试所宣称锁定的「防残留/防冻结」语义不一致（测试只覆盖了开关路径，未覆盖注销路径）。修复或补测该路径后可通过。

## 亮点

- **真实调度链路而非直调内部函数**：测试通过 `activatePerception('m1')` → `triggerLastObserver(mockPipeline)` 触发完整帧回调（perception.ts:255-305 的 run 闭包），覆盖 `_ensureObserverRegistered` → tier 决策 → `_applyPerceptionForContext` → 子模块派发的整条链路，且真实运行 bone-override-store 骨骼认领（测试输出可见 `[adr-147] bone ... 占用` 日志），集成价值高。
- **时序模拟真实可推导**：`vi.spyOn(performance.now)` 驱动 `time = now/1000`，`happy 情绪周期性脉冲` 用例锁定 t=1s = MICRO_EXPR_PERIOD/4，sin²(π/2)=1 峰值推导注释清晰（perception-morph.int.test.ts:283-288 ↔ perception-expression.ts:79-81）。
- **防残留/防串味四象限覆盖**：关开关归零（L215-238 唇形 / L311-326 微表情）、切情绪旧 morph 归零（L328-344）、切 neutral 归零（L346-359）、morph 不存在静默跳过（L203-213 / L301-309）——与生产复位分支（perception-expression.ts:39-48, 71-76；perception-lipsync.ts:77-102）一一对应。
- **mock 架构合规**：全部 `vi.hoisted` 共享状态 + 纯工厂函数（ADR-204 P3 约束）、`setupPerceptionTest` 统一 reset 默认值、bridge 经 scene-action-bridge 注册（ADR-238）——符合 ADR-219 测试卫生铁律，无裸删 window、无静态化 god-barrel。
- **migration 纯函数双路径覆盖**：有旧 lipSync 字段 / 无字段默认值、`boneToggles.emotion=true/false` 语义映射（scene-migrate.ts:71-104）均有精确断言。
- **生产侧：单一参数源设计**：`_setFocusedState` 用 `Object.assign` 原地合并而非替换引用（perception.ts:148-150），context 共享 `_perceptionState` 引用（L115），使测试「setPerceptionState 后下一帧立即生效」成立，注释明确记录了 P3 修复动机。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | frontend/src/scene/motion/perception.ts | L158-164（_resetContextOffsets）、L348-355（焦点切换）、L396-421（deactivatePerception）、L660-664（unpin）、L232-243（_deactivateContext） | **注销/切换路径不主动清零 morph influence**：`_resetContextOffsets` 只清 `lastOffsets.emotion` 记账字段，不写回 morph；`_disposeLipSyncRuntime` 仅删 Map 条目也不清零。焦点从模型 A 切到 B（或 unpin/disableAll）后，A 的「笑み」脉冲权重或唇形「あ」权重**永久冻结在网格上**（morph 权重不会被其他动画系统覆写，与骨骼自愈不同），直到 A 重新激活才被下次 `_applyMicroExpression` 覆盖。测试的「防残留/防冻结」只覆盖开关路径（setLipSyncEnabled(false)/setPerceptionState），未覆盖注销路径 | deactivate/unpin/焦点切换时按 `lastOffsets.emotion` 与 lip-sync runtime 的 `morphName/morphSet` 显式清零 morph；或复用 `_applyMicroExpression(…, false, …)` 复位分支。并补 deactivate 路径测试（激活→写 morph→deactivatePerception→断言归零） |
| 🟡 P3 | frontend/src/scene/motion/perception-lipsync.ts | L86-96、L130-140、L225-233 | multiMorph（close/pucker/smile）复位循环在三处重复实现（开关关闭 / 衰减完成 / multiMorph 开关关闭），行为一致但易漂移（round-15 已修过 smile 残留同类问题） | 抽取 `_resetMorphSet(rt, morphManager)` 单源复用 |
| 🟡 P3 | frontend/src/scene/motion/perception-lipsync.ts | L118-119（0.85 衰减）、L120（0.005 阈值）、L170-171（0.7/0.3 滤波）、L202（0.8 pucker）、L215（0.3/0.1 smile） | 调参魔法数值：有注释（「约 20 帧淡出」）但未命名常量，与同文件 VOICE_BIN_*（L10-13）命名风格不一致；未来调参需逐帧找 | 收敛为命名常量（如 `SMOOTH_DECAY`/`SMOOTH_EPSILON`/`LOWPASS_KEEP` 等），可一并上移为可调参数（ADR-116 模式） |
| 🟡 P3 | frontend/src/scene/motion/perception-observer.ts | L90-106 | medium 档下 `_applyMicroExpression` 每 4 帧才执行（frameCounter % 4），关闭/切情绪后的 morph 复位延迟 ≤4 帧（~133ms@30fps），而 lipsync 每帧复位——两模块「防残留」保证强度不对称；测试默认 high 档（PerceptionPerfMonitor 默认 tier='high'），未覆盖 medium/low 分支 | 低危可接受，但建议把复位路径（enabled=false/neutral）移出降采样门控（复位成本低），或补 medium 档测试锁定「4 帧内归零」语义 |
| 🟡 P3 | frontend/src/__tests__/perception/perception-morph.int.test.ts | — | `lipSyncMultiMorphEnabled=true` 的多口型集成路径（close 反相 / pucker 高频 / smile 写入 + else 分支 L221-234 复位）**无任何集成测试**——算法层 round-25 有单测，但 `_applyLipSync` 集成层（含 multiMorph 开关块）无覆盖；tier='low' 守卫分支（expression L30-32 / lipsync L61-63）亦无测试 | 补 1-2 例：multiMorphEnabled=true 时 close/pucker/smile 各自写入与关闭归零；low tier 下不写入 |
| 🟢 P4 | frontend/src/scene/scene-migrate.ts | L56、L64、L82 | `unknown` → 类型断言（`as unknown as` 双断言取 boneToggles）无 shape 运行时校验；历史存档迁移代码可接受，但格式违约时断言静默通过产生坏状态 | 迁移入口加最小 shape 守卫（如 `typeof t === 'object'`），或复用 round-30 scene-serialize resilience 校验链 |
| 🟢 P4 | frontend/src/__tests__/perception/perception-morph.int.test.ts | L172-180 | 「lipSyncEnabled=false 时不写入任何 morph」断言 `getInfluence('あ') === 0` 在从未写入时恒真（弱断言），只验证了守卫路径入口 | 可先开启+写入再关闭断言归零（与 L215-238 用例合并），或断言 `getTargetByName` 未被写 |
| 🟢 P4 | frontend/src/__tests__/perception/perception-morph.int.test.ts | L287 | 脉冲峰值断言用范围 `toBeLessThanOrEqual(0.15)` 而非精确 0.12（time=1000ms 时 weight 可精确推导 = MICRO_EXPR_PEAK），未来峰值改 0.13 测试仍绿但注释语义漂移 | 断言精确 0.12（或 `toBeCloseTo(0.12, 3)`）并保留推导注释 |
| 🟢 P4 | frontend/src/motion-algos/lipsync.ts | L26 与 L45 | round-25 已报：`LIP_MORPH_CANDIDATES` 与 `MOUTH_MORPHS.open` 同一 7 项列表重复定义，本次核实**仍未修** | 令 `const LIP_MORPH_CANDIDATES = MOUTH_MORPHS.open` 单源复用 |

## 测试质量评价

**优点**：
- 断言有效性高：morph 权重通过 mock MorphTargetManager 的 `getInfluence` 真实验证（非自证式 mock），且大部分断言可手工推导（脉冲峰值 0.12、钳制边界 0/1）。
- 时序真实：`performance.now` 模拟 + 注释推导（MICRO_EXPR_PERIOD/4 = 1s），非拍脑袋数值。
- 边界覆盖相当完整：默认值精确断言、钳制（灵敏度/强度 0..1）、morph 不存在跳过（两模块各 1 例）、快速切换（happy→angry / happy→neutral）、关闭归零（两模块各 1 例）。
- 无 `.skip` / `.only` / `.todo`；24 用例全部真实执行。
- mock 合理：hoisted + 共享工厂（perception-mocks.ts），`setupPerceptionTest` 每用例重置全部默认值，`vi.restoreAllMocks` 与 beforeEach 重设顺序无跨用例污染。

**弱点（均低危）**：
- 未覆盖 multiMorph 集成路径与 tier 分支（见 P3#4，与生产多口型开关块、low 守卫对应缺口）。
- 「morph 不存在时静默跳过」用 `not.toThrow()` 断言偏弱（合理但验证力低）。
- 未覆盖 deactivatePerception / onPerceptionModelRemoved 注销路径——恰是 P2 风险所在，建议补测后可将本结论升级为 ✅。

## 结尾

- 审核日期：2026-08-15
- 审核员：子代理 round41-perception-morph
- 测试基线：`perception-morph.int.test.ts` 24/24 通过；`npm run check` 本轮跳过（零代码改动）
