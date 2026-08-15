# 审核报告：perception-breathing（ADR-071 呼吸轴向回归）— round44

**审核范围**
- 测试文件：`frontend/src/__tests__/perception-breathing.test.ts`（219 行，10 个用例，无 skip/todo）
- 被测源码：`frontend/src/scene/motion/perception-breathing.ts`（81 行，`_applyBreathing` L23-72、`_updateBoneChain` L74-81）
- 关联共享：`frontend/src/scene/motion/perception-shared.ts`（`_q` L161-170、`_createPerceptionPool` L110-119、`_setContextPool` L128-130）、`frontend/src/motion-algos/proc-motion-shared.ts`（`matchBone` L295-308、`BONE_UPPER_CANDIDATES` L160）、生产调用方 `perception-observer.ts` L73-80
- 历史关系：round-8 审过 perception 拆分（`_updateBoneChain` 复用自 breathing → gaze-js，无重复）；round-15 审过 perception-breathing（✅，遗留 P1-2 linkedBone 未判空、P2-3 递归无深度限制）；round-25 审过 lipsync 算法（同感知层，非本文件）。本次为 ADR-071 呼吸轴向回归补测。

**总体结论：⚠️ 有条件通过**

轴向回归目标完全达成：测试断言数学上真实判别 X 轴俯仰 vs Y 轴偏航，10/10 全绿（Vitest 实测 76ms），mock 与对象池用法与生产 observer 流程同构。但 round-15 遗留两项**均未修复且新测试未覆盖**：`linkedBone` 未判空（round-15 原评 P1，本报告评 P2，因 observer try-catch 已隔离崩溃、仅剩每帧 logWarn）与 `_updateBoneChain` 递归无深度限制（round-15 原评 P2-3，本报告评 P3）。注：任务描述称"两项 P3"，实际 round-15 分级为 **P1-2 / P2-3**，此处按真实分级记录。

---

## 亮点

- **轴向断言真实判别俯仰/偏航**：`perception-breathing.test.ts:97-106`。`Quaternion.RotationAxis(Right, θ)` 产物为 `(sin θ/2, 0, 0, cos θ/2)`，断言 `|x|>1e-4 ∧ |y|<1e-6 ∧ |z|<1e-6` 在数学上排他：若回归为 Y 轴（Up），将得到 `(0, sin θ/2, 0, …)` 使 `y` 断言失败。阈值选择合理（信号 ≈ 0.0057 ≫ 1e-4，噪声门 1e-6），非"恒真断言"。与修复 commit `e3b5a9fb`（`Vector3.Up() → Vector3.Right()`，`perception-breathing.ts:59`）配对锁定。
- **对象池共享方式与生产同构**：`perception-breathing.test.ts:68-83`。`vi.resetModules()` + 动态 import 保证测试里 `_setContextPool`/`_q` 与 `_applyBreathing` 内部引用的 `perception-shared` 是同一模块实例（L70 注释说明意图）；`_setContextPool(ctx.pool)` + `_resetContextPool()` 与生产 `perception-observer.ts:67-68` 逐行一致，`afterEach` 恢复 `null`（对应生产 finally L164）。共享真实池而非 mock 池，使"池索引前进 +2"（L181-187）成为对 `perception-shared.ts:93` 注释预算（"breathing: 2q"）的真实验证。
- **delta 增量叠加状态流清晰**：`perception-breathing.ts:52-64`。`lastOffsets.breath` 单一写入点（L64），"撤销上帧偏移 + 应用本帧偏移"保留 VMD/Bone Override 基准旋转；`amp=0` 仍执行写入（L56 注释）防关闭瞬间残留冻结——与 `perception-balance.ts:72-84` 同款策略，两模块行为一致。
- **异常路径守卫较完整**：无脊柱骨早退（`perception-breathing.ts:40-42`）、`rotationQuaternion` null 早退（L48-50）、claimedBones 占用跳过（L43-45）；`_applyBreathing` 仅被 observer 调用且包 try-catch（`perception-observer.ts:76-79`），单模块异常不影响其他感知子模块。
- **重复代码与循环依赖均无问题**：`_updateBoneChain` 唯一实现于 `perception-breathing.ts:74-81`，被 `perception-gaze-js.ts:10,39` 复用（round-8 亮点保持）；`perception-balance.ts` 已无自建副本（round-15 P2-4 已随重构消解，`grep _updateBoneChain` 仅命中 breathing 与 gaze-js 两处 import）。依赖为 breathing → perception-shared / proc-motion-shared / core-types（单向，无环）。
- **魔法数值已命名化**：`perception-breathing.ts:17-21` `DEFAULT_BREATH_FREQ`/`DEFAULT_BREATH_AMP`/`BREATH_DELTA_FACTOR` 均为具名常量；测试 `_defaultState`（L16-39）与 `DEFAULT_PERCEPTION_STATE` 参数一致。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | `perception-breathing.ts` | L47 | **round-15 P1-2 未修复**：`spine.linkedBone.rotationQuaternion` 直读，`linkedBone` 为 null 时抛 TypeError。L48 的 `!curQ` 守卫只覆盖 rotationQuaternion（且该守卫 2026-07-15 引入、早于 round-15，非本次补修）。实际影响因 observer try-catch 降级为"每帧 logWarn + 呼吸静默失效"（无崩溃），故由 round-15 的 P1 降为 P2，但仍开放 | 改 `spine.linkedBone?.rotationQuaternion` 守卫（与兄弟模块 `perception-balance.ts:78,92` 的 `bone?.linkedBone` 模式对齐，gaze-js L35/L46 同族问题一并处理，符合"grep 全局同类调用点"约定） |
| 🟡 P3 | `perception-breathing.ts` | L74-81 | **round-15 P2-3 未修复**：`_updateBoneChain` 递归无深度限制。真实 MMD 骨骼树无环且深度 ≤10（`perception-shared.ts:186` 注释），栈溢出仅对畸形/环状数据成立，理论风险 | 增加最大深度参数（如 32）或循环引用访问集，成本低，可在下次触碰本文件时顺手补 |
| 🟡 P3 | `perception-breathing.test.ts` | L121-130 及其余 | **linkedBone 为 null 的用例缺失**：现有边界测试只覆盖 `rotationQuaternion: null`（L121-130）与"无脊柱骨"（L108-117），未覆盖 `linkedBone: null`/`undefined`——正是 round-15 P1-2 的崩溃点。测试反推应锁定该守卫，防止修复后回归 | 修复 P2 项时同步补 `linkedBone: null` 用例（断言不抛 + lastOffsets 不写），形成"修复+测试"配对提交 |
| 🟡 P3 | `perception-breathing.test.ts` | L190-218 | **递归深度/环状用例缺失**：`_updateBoneChain` 仅测 2 层递归（L191-209）与 WASM 跳过（L211-218），未测深层链与环状 childBones（防栈溢出回归） | 若采纳深度限制修复，补一条"超深/成环不爆栈"用例 |
| 🟢 P4 | `perception-breathing.ts` | L67, L76 | `updateWorldMatrix(false, false)` 布尔魔法参数无注释（gaze-js L50 同款），`false,false` 语义对读者不直观 | 抽具名常量或补一行注释说明参数含义 |
| 🟢 P4 | `perception-breathing.ts` | L59 | `_q().copyFrom(Quaternion.RotationAxis(...))`：`RotationAxis` 每次新建 Quaternion 再拷入池槽，热路径每帧多 1 次分配（balance L109-110 同款，round-29 已测 breathing 占感知预算 21.8% 第二高） | 可换 `Quaternion.RotationAxisToRef`（若 fork 版本提供）省一次分配；低优先 |
| 🟢 P4 | `perception-breathing.test.ts` | L86, 112, 126, 174, 207, 217 | 5 处 `as any` mock（`makeSpineModel` 返回 `{ model: any }`）。项目已有 `MmdModelLike` 最小接口（`perception-shared.ts:79-87`）本可避免 | 测试内 `as unknown as MmdModelLike` 或直接标注 `// test-only` 理由；纯测试侧风格问题 |
| 🟢 P4 | `perception-breathing.test.ts` | L161-179 | amp=0 用例使用**新模型**（model2/curQ2）跑零幅帧，验证的是 `lastOffsets.breath` 归零（符合用例标题"不残留冻结"），但"在同一骨骼上撤销上帧偏移"路径未实际演练（model1 的 curQ 残留 0.019rad 旋转未被回撤） | 若要锁定"撤销残留"行为，可对同一 model 连续跑两帧（幅值 0.02→0）断言 curQ 回到 identity |

---

## 测试质量评价

- **断言有效性：✅ 强**。轴向用例的 x/y/z 分量断言与 `RotationAxis` 数学产物严格对应，对 Y 轴偏航回归构成排他性判别（y 断言必失败），非装饰性断言。其余用例（claimedBones 跳过/放行、跨帧增量、amp=0、池索引、递归传播）均直接驱动生产分支，无恒真断言。
- **mock 合理性：✅ 优**。最小骨骼 mock（`makeSpineModel` 只含 `linkedBone.rotationQuaternion`、故意不带 `updateWorldMatrix`/`childBones`，L91 注释说明聚焦轴向）；真实共享 `_createPerceptionPool` + `_setContextPool`/`_resetContextPool` 复刻生产 observer 流程；`vi.resetModules()` + 动态 import 保证共享模块实例（L70）；`afterEach` 恢复全局池防跨测试污染。
- **边界覆盖：⚠️ 部分**。rotationQuaternion null ✓、无脊柱骨 ✓、claimedBones ✓、跨帧 ✓、amp=0 ✓、池消耗 ✓、WASM 跳过 ✓；但 round-15 两项遗留（linkedBone null、递归深度）**均无测试**，与源码未修复状态互为印证。
- **跳过测试：无**（10/10 执行，无 `it.skip`/`xit`/`todo`）。
- **可运行性：✅**。`cd frontend && npm run test -- src/__tests__/perception-breathing.test.ts` 实测 10 passed（76ms）；`@vitest-environment node` 声明合理（纯数学模块无 DOM 依赖，配合 round 分流提速）。`npm run check`（tsc 全量）耗时较长，本次未跑，基线由 round 门禁保证，特此注明。

---

**审核日期**：2026-08-15
**审核员**：子代理 round44-perception-breathing
