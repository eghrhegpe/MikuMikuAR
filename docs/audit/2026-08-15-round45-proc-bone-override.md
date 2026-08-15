# Round 45 审核报告：proc-bone-override（程序化动作 + 骨骼覆盖管线契约）

## 审核范围

- **测试文件**：`frontend/src/__tests__/scene/proc-bone-override.test.ts`（77 行，3 用例，vitest node 环境）
- **被测源码**：
  - `frontend/src/scene/motion/motion-pipeline.ts:27-53`（`PipelineStage` 联合 + `STAGE_ORDER` 常量）、`:55-129`（`MotionPipeline` 调度器：register/unregister/ensureSorted/runFrame）、`:137-152`（单例 + `__resetMotionPipelineForTest`）
  - `frontend/src/scene/motion/bone-override.ts:1044-1058`（`startBoneOverride` 注册 `'bone-override'` stage、order 0 层）、`:828-842`（`_runFrameHooks` 帧钩子 order 排序）、`:844-871`（`_applyWasmOverride` 覆盖写入 worldMatrix）
  - **关联层（核对 stage 契约用）**：`wasm-layers-blender.ts:96-110`（vmd-layers 层）、`perception.ts:257`（perception 层）、`feet-adjustment.ts:455`（bone-override stage、order 5）
- **契约依据（核实优先级：源码 > ADR）**：`docs/adr/adr-147-explicit-motion-pipeline-scheduler.md`（R1/R2 根治、stage 显式声明契约、§九验收 1「顺序确定性」）、`docs/adr/adr-116-bone-override-ui-redesign.md:23-32`（§一 6 层动作管线顺序，STAGE_ORDER 的来源）
- **验证**：`cd frontend && npm run test -- src/__tests__/scene/proc-bone-override.test.ts` → 3/3 通过（33ms）；`npm run check`（tsc + i18n parity）→ exit 0 全绿

## 总体结论

✅ **通过** —— 被测生产源码（调度器内核 + bone-override 层注册）类型安全（0 处 `as any`/`@ts-ignore`）、异常隔离、资源释放完备，stage 排序由显式 `STAGE_ORDER` 常量（`proc-motion` index 2 < `bone-override` index 3）决定，与 ADR-147 契约逐字一致；测试 3 用例对「逆序注册下 stage 恒序」「同骨骼覆盖层写入覆盖程序化层（矩阵级真值验证）」「无覆盖层 pass-through」覆盖有效且断言非空转。测试与类型检查双绿。仅发现 1 个 🟡 P3（真实 bone-override 层的 stage 声明未被任何测试锁定）与 3 个 🟢 P4 观察，不阻塞。

## 亮点

- **矩阵级真值断言，非调用序 mock 摆样子**：`proc-bone-override.test.ts:43-59` 用例 2 用真实 Babylon `Matrix.RotationYawPitchRoll` → `copyToArray` 写入模拟的 `MmdRuntimeBoneExtended.worldMatrix`（`Float32Array(16)`）→ `Matrix.FromArray` 读回，验证到「最终 worldMatrix 内容」这一语义层，而非仅验证 run 被调用的顺序。
- **双断言互锁，杜绝空转否定**：`proc-bone-override.test.ts:58-59` `expect(m[2]).toBeCloseTo(-Math.sin(-0.5))` + `not.toBeCloseTo(-Math.sin(0.3))` 成对出现——两条候选值（+0.479 vs -0.296）与零缓冲（两层都没跑，m[2]=0）三者分离，覆盖未生效、程序化未胜出、双层全失效三种情况都会被至少一条断言捕获；`not` 断言因有正向断言兜底而非空转。
- **契约注释自文档化 + 与源码互文**：`proc-bone-override.test.ts:2-12` 明确「vmd-base/proc-motion 由 babylon-mmd 在 WASM 层写入、不经过 JS 管线（与 `motion-pipeline.ts:23-25` 注释互文一致）」，并自述「两半覆盖分工」：本测试锁排序半、`bone-override.test.ts` 锁 `computeOverride` 纯函数半——测试即文档，读测试可知管线边界设计。
- **排序契约三态三角**：用例 1 逆序注册（ov 先、proc 后 → 仍 `['proc','ov']`）锁「stage 决定序、注册序无关」；用例 2 自然序锁「同骨覆盖层后写者胜」；用例 3 无覆盖层锁「程序化写入不被任何隐式层篡改（pass-through）」——三态互补，无死角。
- **测试隔离干净**：每用例 `new MotionPipeline()`（`:32/:46/:66`），不触碰全局单例，无需 `__resetMotionPipelineForTest`，无跨用例状态泄漏。
- **纯测试提交纪律**：`a5f63b6b`（fix(motion): 程序化动作覆盖审计收尾 P3/P4）仅新增本测试 + UI 文案，零生产代码改动——契约测试作为纯护栏落地，未夹带行为变更。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/__tests__/scene/proc-bone-override.test.ts`（全文件，合成层）/ `frontend/src/scene/motion/bone-override.ts` | 1053-1058 | 契约测试用**合成层**（`makeLayer`）锁定 stage 排序不变量，但真实 bone-override 层的 stage 声明（`startBoneOverride` 注册 `stage: 'bone-override'`）**无任何测试断言**（grep 证实 motion-frame-hooks / ik-resolver-timing / feet-adjustment 各测试只 `runFrame` 不断言层 stage）。若未来误将 `bone-override.ts:1055` 改为 `'perception'` 或 `'proc-motion'`，本测试与现有全套仍全绿，stage 排序契约在真实层上静默失效 | 在 `motion-frame-hooks.test.ts` 或本文件补一条断言：`startBoneOverride` 后 `getMotionPipeline().getOrderedLayers().find(l => l.id === 'bone-override')?.stage === 'bone-override'`（顺带断言 `order === 0`，锁定与 feet-adjustment order=5 的帧内序） |
| 🟢 P4 | `frontend/src/scene/motion/motion-pipeline.ts` | 27-53 | `PipelineStage` 联合字面量与 `STAGE_ORDER` 数组**双份声明顺序**，TS 无法在编译期强制两者一致；未来新增 stage 时两处可能不同步（当前一致，且 `motion-pipeline.test.ts:16-26` 排序测试兜底） | 可加一条测试遍历 `STAGE_ORDER` 与类型声明逐项对齐（低成本），或维持现状依赖现有排序测试——记录在案即可 |
| 🟢 P4 | `frontend/src/__tests__/scene/proc-bone-override.test.ts` | 42 | `Float32Array(16)`（4×4 矩阵元素数）与 `m[2]` 索引为裸魔法数，依赖注释说明（`L42/L57` 已注释 Babylon m[2] = -sin(yaw) 语义） | 可提命名常量（如 `const MAT_ELEMS = 16`）或维持注释现状——低优先级 |
| 🟢 P4 | `frontend/src/__tests__/scene/proc-bone-override.test.ts` | 6、10 | 注释引用行号 `motion-pipeline.ts:22-25`，文件演进后可能漂移（当前核对仍准确） | 行号引用改为锚点描述（如「motion-pipeline.ts STAGE_ORDER 段注释」）抗漂移，或维持现状 |

## 测试质量评价

- **断言有效性**：用例 1 `expect(seq).toEqual(['proc', 'ov'])` 数组全等同时隐含「两层各执行恰一次」✅；用例 2 矩阵级双断言互锁（见亮点）✅；用例 3 pass-through 基线 ✅。三用例断言均真实作用于被测语义，无 `expect(vi.fn()).toHaveBeenCalled()` 类弱断言。
- **mock 合理性**：零 `vi.mock` 模块级 mock，仅 `vi.fn(run)` 包装回调（`:26`）用于可观测性；`ctx` 为最小桩（`:18` `{ scene: {} as Scene }`）——测试面刻意收窄到调度器契约，不引入 Babylon 运行时，隔离性与确定性最佳。测试侧 `as` 强转属 mock 惯例，非生产代码，不违反 0 `as any` 铁律。
- **边界覆盖**：逆序注册 ✅、同骨骼冲突（矩阵级）✅、无覆盖层 pass-through ✅；**未覆盖**：真实层 stage 声明（P3，见风险表）、同 stage 内 order 序（属 `motion-pipeline.test.ts:28-36` 职责，非本文件范围）。
- **跳过用例**：`it.skip`/`it.todo`/`it.only` 全文件 grep 零命中 ✅。
- **77 行充分性**：对声明契约（① stage 恒序 ② 同骨覆盖胜 ③ pass-through）3 用例恰如其分，无冗余也无明显缺口（P3 为「真实层声明」缺口，属测试面选择而非规模不足）。
- **与既有测试的关系（覆盖分工）**：本文件是管线契约层的**第 4 块拼图**——① 排序不变量：`motion-pipeline.test.ts`（6 例，锁 (stage,order) 决定序、异常隔离、浅拷贝）；② **stage 跨层契约锚点：本文件（3 例，锁 proc-motion→bone-override 相邻序 + 同骨覆盖语义）**；③ computeOverride 纯函数语义：`bone-override.test.ts`（ADR-116 P1 复合/Slerp 边界）；④ 真实层帧钩子 order：`motion-frame-hooks.test.ts`（4 例）。与 **round-12（motion-modules 共享帧钩子互斥 P1）** 的关系：本测试锁定的 stage 排序与帧钩子显式 order 体系同源（ADR-147 R1/R2 根治产物），round-12 审的是帧钩子互斥执行，本测试审的是跨层执行序，两者互补无重叠；与 **round-7/8（bone-override computeOverride）** 的关系：本测试与 `bone-override.test.ts` 构成测试注释自述的「两半」——排序半 + 语义半，共同闭合「程序化动作能继承骨骼覆盖」组合路径。

## 结论细节

- **类型安全**：被测生产代码 0 处 `as any`/`@ts-ignore`；`PipelineStage` 联合 + `PipelineLayer` 接口签名干净 ✅
- **异常处理**：`runFrame` 单层 try/catch 隔离（`motion-pipeline.ts:121-127`，对齐 Babylon 单 observer 语义）；`_runFrameHooks` 单钩子 try/catch（`bone-override.ts:836-840`，round-12 P2 产物）；无静默 `catch{}` ✅
- **资源释放**：`register` 返回 unregister（`:71`）；`stopBoneOverride` 释放 `_observerHandle` + 单一驱动 `_driverHandle` 并重置 `_driverScene`（`bone-override.ts:1062-1079`，ADR-147 审核 P2 修复）；`unregister` 置脏 `sorted` ✅
- **状态流**：stage 顺序唯一来源 `STAGE_ORDER` 显式常量（`:47-53`），`sorted` 惰性标志在 register/unregister 双点置脏（`:70/:79`），`ensureSorted` 单一入口（`:88-101`）——无幽灵路径；`grep setState` 不适用（无状态框架）✅
- **职责单一**：`MotionPipeline` 仅调度、不持有 Babylon 运行时对象（头部注释 `:7`）；`FrameContext` 只承载 scene、调度器不依赖其字段（`:14-16`）✅
- **并发安全**：`runFrame` 快照迭代允许 run 内 unregister（`:117`，perception 自注销场景）；`getOrderedLayers` 浅拷贝封死外部写入口（`:110`，round14 P3 修复）；单线程 JS 无 async 竞态 ✅
- **重复代码 / 循环依赖 / 魔法数值**：无跨文件重复逻辑；`motion-pipeline.ts` 仅 `import type { Scene }`，零运行时依赖，无循环依赖；stage 顺序零裸数字（`STAGE_ORDER` 数组），`bone-override.ts:1056` order=0 有注释上下文 ✅（唯一轻微点是类型联合与数组双份声明，见 P4）

---

审核日期：2026-08-15
审核员：子代理 round45-proc-bone-override
