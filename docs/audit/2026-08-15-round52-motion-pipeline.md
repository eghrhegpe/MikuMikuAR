# Round 52 审核报告：motion-pipeline 排序不变量单测

## 审核范围

- **测试文件**：`frontend/src/__tests__/scene/motion-pipeline.test.ts`（111 行，7 用例，`// @vitest-environment node`）
- **被测源码**：`frontend/src/scene/motion/motion-pipeline.ts`（152 行）
  - `:27-32`（`PipelineStage` 联合）、`:34-44`（`PipelineLayer` 接口）、`:47-53`（`STAGE_ORDER` 常量）
  - `:55-130`（`MotionPipeline`：register/unregister/size/ensureSorted/getOrderedLayers/runFrame）
  - `:137-152`（`getMotionPipeline` 懒单例 + `__resetMotionPipelineForTest`）
- **关联真实层（核对 stage 契约用，只读）**：`bone-override.ts:1053-1058`（`'bone-override'`/order 0）、`wasm-layers-blender.ts:96-110`（`'vmd-layers'`/order 0）、`perception.ts:255-259`（`'perception'`/order 0）、`feet-adjustment.ts:453-458`（`'bone-override'`/order 5）
- **契约依据（核实优先级：源码 > ADR）**：`docs/adr/adr-147-explicit-motion-pipeline-scheduler.md`（§五 方案 A、§九 验收 1「顺序确定性」、Phase 1 切片 1 落地 `5d7a63bd` 4 例排序单测）；`docs/adr/adr-116-bone-override-ui-redesign.md:23-32`（6 层管线顺序，`STAGE_ORDER` 来源）
- **验证**：`cd frontend && npm run test -- src/__tests__/scene/motion-pipeline.test.ts` → 7/7 通过（216ms，vitest 4.1.9）。`npm run check`（tsc + i18n parity）未跑——只读审核零源码改动，且 round-45 已对该模块 tsc 全绿核验，本次以目标测试运行结果为准

## 总体结论

✅ **通过** —— 被测生产源码（调度器内核）类型安全（0 处 `as any`/`@ts-ignore`）、异常隔离完备、`sorted` 脏标志双点置脏无幽灵路径、零运行时依赖无循环依赖；测试 7 用例对「排序只由 (stage, order) 决定、与注册序无关」的核心不变量覆盖有效且断言非空转：逆序注册（用例 1/4）、同 stage 内 order 序（用例 2）、边界 stage 首尾同管线（用例 1）、unregister 后不执行（用例 3）、异常隔离（用例 5）、浅拷贝防外部污染（用例 6）、单例 reset 生命周期（用例 7）。仅 2 个 🟡 P3（并列键稳定序依赖注册序未锁定 + register 同 id 覆盖分支无测试）与 2 个 🟢 P4 观察，不阻塞。

## 亮点

- **逆序注册下全 stage 级真值断言，直击不变量核心**：`motion-pipeline.test.ts:16-26` 用例 1 以交错注册序（p→bo2→bo1→vl→vb）注册 5 层，`expect(order).toEqual(['vb','vl','bo1','bo2','p'])` 一次同时锁定「stage 粗序（vmd-base→vmd-layers→bone-override→perception）+ 同 stage 内 order 细序（bo1 order1 先于 bo2 order2）+ 首尾边界 stage」三件事，且与 `STAGE_ORDER`（`motion-pipeline.ts:47-53`）逐字对应。
- **runFrame 端到端反证注册序无关**：`:51-63` 用例 4 显式「逆序注册」（perception 先、vmd-base 后），但断言执行序仍为 `['vb','p']`——验证的是「实际执行序」而非 getOrderedLayers 返回值，直接兑现 ADR-147 §九 验收 1。
- **异常隔离与 Babylon observer 语义对齐，测试锁死**：`:65-79` 用例 5 注入抛错层，`not.toThrow` + 后续层 seq 双断言互锁（覆盖「未隔离 → 断言失败」「隔离但吞掉后续 → seq 失败」两种失效态），对应生产实现 `motion-pipeline.ts:121-127` 的逐层 try/catch，与 ADR-147 审核修复记录 P3 一致。
- **浅拷贝封死外部写入口，round-15 P3 闭环**：`:81-94` 用例 6 用 `push`+`splice` 篡改返回值后断言内部不受污染（`size` 仍为 2），对应生产 `motion-pipeline.ts:110` `this.layers.slice()`——round-15 审计指出的「readonly 数组不防 push/splice」P3 已被修复并被本用例锁死。
- **单例 reset 用例自带还原纪律**：`:97-110` 用例 7 断言同一单例 `toBe` 恒真、reset 后 `not.toBe` 且 `size===0`，末尾再次 reset 还原全局态（配合 vitest isolate=true 每文件环境重建，跨文件零泄漏），对应 `motion-pipeline.ts:150-151` round-14 P2 修复。
- **测试即文档，与既有测试形成契约拼图**：文件头 `:2-3` 自述「ADR-147 Phase 1 排序不变量」测试定位；`makeLayer` 工厂（`:8-10`）用最小 `vi.fn` 包装层回调，不引入任何 Babylon 运行时，与 round-45（proc-bone-override 矩阵级真值）、round-33（ik-resolver-timing 互斥）构成管线契约测试族的第 ① 块（排序不变量）——分工清晰无重叠。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `frontend/src/scene/motion/motion-pipeline.ts` | 92-99（sort 比较器）+ 测试文件全文件 | **同 (stage, order) 并列键时执行序仍依赖注册序**：ES2019 起 `Array.sort` 稳定，两键完全相等时保持插入序，严格读「执行序只由 (stage, order) 决定」这一不变量在并列键下退化为注册序依赖，且无任何告警。当前真实层未出现并列（bone-override 0/5、vmd-layers 0、perception 0，均不同键），属契约边界未锁而非现网缺陷 | 二选一：① 在 `register` 时检测同 stage 同 order 冲突并 `console.warn`（同 id 覆盖除外），把「并列键=编程错误」显式化；② 补一条测试锁定并列键行为（稳定序→注册序），并在 `PipelineLayer.order` 注释中写明并列键语义，消除不变量表述与实际行为的偏差 |
| 🟡 P3 | `frontend/src/scene/motion/motion-pipeline.ts` | 64-69（register 同 id 覆盖分支） | **同 id 覆盖分支无测试**：`this.layers[i] = layer` 替换路径是内核唯一未被任何测试触及的行为分支（注释声明服务 `startBoneOverride` 等幂等重入安全），现有 7 用例全部走 `push` 分支。若未来替换分支的 `sorted = false` 置脏（`:70`）或引用更新被误删，测试仍全绿 | 补一条用例：同 id 二次 register → `size` 不变、层实例被替换、新层的 (stage, order) 参与排序且旧层 run 不再被调用——直接锁定幂等重入语义 |
| 🟢 P4 | `frontend/src/scene/motion/motion-pipeline.ts` | 121-127（runFrame catch） | **持续抛错层会每帧刷 console.error**：单层实现 bug 时 catch 每帧触发（60Hz 日志洪泛）。非热路径不违反 ADR-248（错误路径豁免），但可观测性可再收一档 | 对同层同错误做节流（如每层记录最近抛错时间戳，≥1s 间隔再打印）或降级为 `console.warn` 一次性提示——低优先级，维持现状亦可 |
| 🟢 P4 | `frontend/src/scene/motion/motion-pipeline.ts` | 27-53 | `PipelineStage` 联合字面量与 `STAGE_ORDER` 数组双份声明顺序，TS 无法编译期强制一致；`STAGE_ORDER.indexOf` 对非法 stage 返回 -1 会静默排最前（联合类型拦截正常调用，但 `as` 可绕过） | 沿用 round-45 P4 记录：可加测试遍历 `STAGE_ORDER` 与类型声明逐项对齐；`ensureSorted` 可选加非法 stage 守卫——当前一致且有 `:16-26` 排序测试兜底，维持现状即可 |

## 测试质量评价

- **断言有效性**：7 用例全部为语义级断言，无弱断言（无裸 `expect(vi.fn()).toHaveBeenCalled()`）——`toEqual` 数组全等（顺序+内容双重锁定，用例 1/2/4）、`mock.calls.length === 0`（用例 3 反证 unregister 后不执行）、`toBe` 单例恒真/`not.toBe` reset 后新实例（用例 7）、`not.toThrow` + seq 互锁（用例 5）。排序不变量被用例 1（交错序）与用例 4（严格逆序）双路径真实验证，非空转 ✅
- **mock 合理性**：零模块级 `vi.mock`（纯逻辑内核无需 mock Babylon），仅 `vi.fn` 包装 run 回调作可观测性；`ctx` 为最小桩（`:13` `{ scene: {} as Scene }`）测试面刻意收窄到调度器契约，隔离性与确定性最佳。测试侧 `as` 强转属 mock 惯例，不违反生产代码 0 `as any` 铁律 ✅
- **边界覆盖**：逆序注册 ✅（用例 1/4）、同 stage order 升序 ✅（用例 2）、首尾 stage 同管线 ✅（用例 1）、unregister 后不执行 ✅（用例 3）、异常隔离 ✅（用例 5）、外部写污染防护 ✅（用例 6）、单例生命周期 ✅（用例 7）；**未覆盖**：同 (stage, order) 并列键语义（P3-1）、register 同 id 覆盖分支（P3-2）、`proc-motion` stage（属 round-45 `proc-bone-override.test.ts:34-35` 的职责，本文件刻意不重复）——缺口为契约边界/分支选择而非规模不足
- **跳过用例**：`it.skip`/`it.todo`/`it.only`/`describe.skip` 全文件 grep 零命中 ✅
- **111 行充分性**：7 用例对排序不变量主题密度恰当，无冗余；与既有测试覆盖分工清晰（本文件=排序不变量+单例，round-45 文件=proc-motion→bone-override 相邻序矩阵级真值，round-33 文件=同 stage order 互斥编排），构成 ADR-147 §九 验收 4「回归护栏」的完整拼图
- **与既往审核关系**：round-10/15 审 motion-pipeline ✅（round-15 详审指出 `getOrderedLayers` readonly 数组可变异 P3，已在本文件用例 6 + 生产 `:110` slice 闭环）；round-45 审 stage 契约 ✅（本文件与 round-45 文件互为补集；round-45 遗留 P4「真实层 stage 声明无断言」仍开放，属真实层测试面缺口，与本文件无冲突）

## 结论细节

- **类型安全**：被测生产代码 0 处 `as any`/`@ts-ignore`；仅 `import type { Scene }`（`:11`）零运行时依赖 ✅
- **异常处理**：`runFrame` 逐层 try/catch（`:121-127`）对齐 Babylon 单 observer 语义；无静默 `catch {}`；错误含层 id 可追溯 ✅
- **资源释放**：`register` 返回 unregister 闭包（`:71`）；`unregister` splice 正确（`:78`）；单例无 Babylon 资源持有（头部注释 `:7` 自述纯逻辑内核），`__resetMotionPipelineForTest` 供测试/HMR 复位（`:150-151`）✅
- **状态流**：`sorted` 脏标志在 register（`:70`）/unregister（`:79`）双点置脏，`ensureSorted` 单一入口（`:88-101`），`getOrderedLayers`/`runFrame` 均汇入该入口——无幽灵路径；`grep setState` 不适用（无状态框架）✅
- **职责单一**：`MotionPipeline` 仅调度、不关心层内容；`FrameContext` 只承载 scene 且调度器不依赖其字段（`:14-16`）✅
- **并发安全**：`runFrame` 快照迭代允许 run 内 unregister 不跳过层（`:117`，perception 自注销场景）；`getOrderedLayers` 浅拷贝封死外部写入口（`:110`）；单线程 JS 无 async 竞态 ✅
- **重复代码 / 循环依赖 / 魔法数值**：无跨文件重复逻辑；零运行时依赖无循环依赖；stage 顺序零裸数字（`STAGE_ORDER` 显式数组），order 值由调用方声明且各有注释上下文（唯一轻微点是类型联合与数组双份声明，见 P4）✅

---

审核日期：2026-08-15
审核员：子代理 round52-motion-pipeline
