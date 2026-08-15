# Round-48 审核 — vmd-evaluator.test.ts（VMD 求值器主测试） + vmd-evaluator.ts

**审核范围：**
- 测试文件：`frontend/src/__tests__/vmd-evaluator.test.ts`（571 行，13 个 describe / 25 用例）
- 被测源码：`frontend/src/motion-algos/vmd-evaluator.ts`（297 行：L17-26 类型、L28-271 `VmdEvaluatorImpl`、L273-280 `_getSharedScene`、L282-289 `createVmdEvaluator`、L295-297 `shutdownVmdEvaluator`）
- 测试依赖的生产模块：`frontend/src/motion-algos/vmd-writer.ts`（`buildVmd` / `INTERP_*` 预设 / `BoneKeyFrame` 类型）
- 上游第三方：`babylon-mmd` `VmdLoader`（vmdLoader.js L137-160 插值字节提取）+ `BezierInterpolate`

**总体结论：⚠️ 有条件通过**

- 测试可运行：`cd frontend && npm run test -- src/__tests__/vmd-evaluator.test.ts` → **25/25 通过**（334ms），无 skip/only/todo（grep 核实）；`npm run check`（tsc + lint 门禁）实测通过（exit 0）。项目基线全绿。
- 求值器源码健康度高：0 处 `as any`/`@ts-ignore`、二分 + Slerp/Lerp 数学正确、`_disposed` 守卫 + `dispose()` 幂等、双 Map 分离消除运行时类型断言、共享 Scene 生命周期清晰。
- 有条件项（🔴 P1×1）：测试文件两处「Bezier 非线性验证」断言（L290-319、L544-570）是**假阳性**——writer 的插值字节布局与 babylon-mmd loader 的提取位置不匹配，导致**所有 interp 预设（含 EASE_IN_OUT/EASE_OUT/SHARP）经实际管线求值后全部退化为线性**；测试之所以通过，仅仅是因为 `BezierInterpolate(x1,x1,x1,x1, 0.5)` 二分截断返回 0.4999666 < 0.5，而非缓动真的生效（用 INTERP_LINEAR 跑同一断言同样通过）。根因在 vmd-writer.ts:151-156（round-28 已审模块），本测试未能在 round-trip 层兜住。
- round-15 P2#2（NullEngine 引擎泄漏）与 P2#3（createVmdEvaluator 无 try/catch）复核仍开放，降级见风险表。

## 亮点

| 模式 | 位置 |
|------|------|
| 双 Map 分离 `_boneMap` / `_movableBoneMap`，消除"一个 bone 两种轨道"的运行时类型断言，注释明示设计意图 | vmd-evaluator.ts:29-44 |
| `_upperBound` 标准二分（`>>>1` 防溢出）正确处理四类边界：首帧前(idx=0)、末帧后(idx≥len)、精确命中(idxA=idx-1, gradient=0)、单帧轨道(frameCount===1 提前返回) | vmd-evaluator.ts:90-105, 227-239 |
| 旋转/位置插值参数分轴独立：movable 轨道位置按 x/y/z 各取一组 Bezier 权重（`posInterp[idxB*12+0..3/4..7/8..11]`），三轴可分别缓动 | vmd-evaluator.ts:189-211 |
| 返回值引用独立性：每次求值 `new Quaternion/Vector3`，测试 L524-541 用 `a.rotation.x = 999` 污染验证互不影响（防缓存引用泄漏） | vmd-evaluator.ts:134, 218-224 + test.ts:524-541 |
| dispose 幂等 + 关闭后返回 null/空 Map：`_disposed` 标志 + Map clear + `_animation=null`，测试双覆盖（dispose 后求值、重复 dispose 不抛） | vmd-evaluator.ts:82-87 + test.ts:253-288 |
| 共享 Scene 惰性单例 + `shutdownVmdEvaluator` 用 `safeDispose`（ADR-146 收敛），测试覆盖 shutdown 后重建 evaluator | vmd-evaluator.ts:273-280, 295-297 + test.ts:408-432 |
| 输入防御：`byteLength < 50` 前置拒绝 + loader 签名校验，测试覆盖 0 字节与 50 字节坏签名 reject | vmd-evaluator.ts:282-285 + test.ts:12-21 |
| 异常帧号全覆盖：负帧/NaN/Infinity 经 `_upperBound` 天然回退首帧/末帧且不崩（`x <= NaN` 恒假 → idx=0） | vmd-evaluator.ts:227-239 + test.ts:479-522 |

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | vmd-evaluator.test.ts + vmd-writer.ts | test.ts:290-319, 544-570 / writer.ts:151-156 | **「Bezier 非线性验证」两测试为假阳性，且掩盖真实行为缺陷**。writer 将曲线 `[x1,y1,x2,y2]` 写入全部 16 个 4 字节组（每组完全相同）；而 babylon-mmd `VmdLoader` 按 VMD 规范从特定字节位提取插值：旋转取 interp[48/56/52/60]（vmdLoader.js:157-160）、位置 X/Y/Z 取各组的组首字节（L138-149）——这些位置**全部是组首字节 = x1**。故实际 `rotationInterpolations = [x1,x1,x1,x1]`（位置同理），`BezierInterpolate(x1,x1,x1,x1,g)` 控制点共线退化为 y=x 直线 → **weight = gradient = 线性**，与预设无关。测试 `distToA < distMidToA`（要求 weight<0.5）仅因二分在 eps=1e-5/15 次迭代下截断得 0.4999666<0.5 而通过（模拟验证），**改用 INTERP_LINEAR（x1 同为 20）跑同一断言同样通过**；若二分精度提高或 writer 修复，该测试会翻转或失效。生产影响：proc-motion-idle.ts:265、autodance-bones.ts:163-172 意图的 EASE_IN_OUT/SHARP/EASE_OUT 缓动经全管线**静默退化为线性**，round-5 回归 spec 注释（L19-25）已知情并镜像了该退化行为，但主测试却断言缓动生效 | ① 修 writer：按 VMD 规范把各轴曲线参数写到规范字节位（旋转 x1/y1/x2/y2 → interp[48/52/56/60]，位置各轴 → 对应组位），而非 16 组全同；② 测试补强：新增 round-trip 断言「EASE_IN_OUT 与 LINEAR 输出必须不同」+ 断言 weight 显著 < 0.5（如 < 0.45 或对数值 ≥ 1e-2 级差），杜绝噪声级通过；③ 本 P1 的修复归属 vmd-writer.ts（round-28 模块，其 vmd.test.ts:382-411 只验 writer 自身字节、未做 loader round-trip，故漏网） |
| 🟠 P2 | vmd-evaluator.ts | L273-280 + L295-297 | **round-15 P2#2 复核仍开放**：`_getSharedScene` 内 `new NullEngine()` 是局部变量，未存模块级；`shutdownVmdEvaluator` 仅 `safeDispose(_sharedScene)`（Scene），**引擎从不 dispose**。实测 scene.pure.js `Scene.dispose()` 只把 scene 从 `engine.scenes` 摘除、不调 `engine.dispose()`，引擎留在 `EngineStore.Instances` 直到进程结束。每次 create→shutdown 循环新增一个泄漏引擎（本测试 afterEach 即触发）。NullEngine 无 GPU 资源，实际危害低 | 引擎引用存模块级 `let _sharedEngine`，`shutdownVmdEvaluator` 内 `_sharedEngine = safeDispose(_sharedEngine)` 后再 dispose scene；或 `_getSharedScene` 内 `engine.dispose()` 兜底（注意与 scene 的释放顺序） |
| 🟠 P2 | vmd-evaluator.ts | L282-289 | **round-15 P2#3 复核仍开放**：`createVmdEvaluator` 无 try/catch，`loader.loadFromBufferAsync` 异常直接 reject 上抛。测试已覆盖 reject 路径（L12-21），但生产消费方 wasm-layers-blender.ts:171 `await createVmdEvaluator(...)` 亦无 try/catch，坏 VMD 会向上传播未处理拒绝 | 在本函数内 catch 后统一抛业务错误（如 `VMD parse failed: <msg>`），或确认所有消费方有兜底；至少补一条注释说明"错误由调用方负责" |
| 🟡 P3 | vmd-evaluator.ts | L113-134 vs L165-186 | 重复代码：`_evalBoneTrack` 与 `_evalMovableTrack` 的"旋转插值 + Bezier + Slerp"块（~20 行）几乎逐字重复，仅返回的 position 字段不同 | 抽 `_evalRotation(track, idxA, idxB, gradient)` 私有助手，两处共用 |
| 🟢 P4 | vmd-evaluator.ts | L283 | 魔法数值 `data.byteLength < 50`（VMD 最小头部 30 签名+20 模型名）无命名常量也无注释；`/127`、`*4`、`*12` 等为 VMD 结构常数，散落多处 | 抽 `const VMD_MIN_HEADER = 50` 并注释；结构步长可沿用 round-27/28 的布局常量实践 |
| 🟢 P4 | vmd-evaluator.test.ts | L380-405 | 测试名「重复 bone 名（两轨道）应各自独立求值」与内容不符：实际是**单轨道**两帧（同骨名 frame 0/10）验证插值单调性（r1.y < r2.y），并未构造两轨道。名字误导读者 | 改名如「同骨名多帧插值单调」，或真构造两条同名轨道验证 Map 覆盖行为 |

## 测试质量评价

**结构与运行**：13 个 describe / 25 用例，`@vitest-environment node` 恰当（babylon NullEngine 无 DOM 依赖）。实测 25/25 全绿（334ms），grep 确认无 `it.skip`/`it.only`/`describe.skip`/`todo`。

**有效性（真实绑定生产代码）**：全部断言直接 `import` 生产源码（`createVmdEvaluator`/`shutdownVmdEvaluator`）与真实 VMD 写入器（`buildVmd`），经真实 babylon-mmd `VmdLoader` 解析——不是 mock、不是镜像复刻。Slerp 数学用 Babylon 官方 `Quaternion.Slerp(rotA, rotB, 0.5)` 作 oracle 对比（L47-51），是真实数值验证。`evalAllBones` 空 VMD → 空 Map、movable 位置逐分量 toBeCloseTo、dispose 幂等、引用独立性污染实验（L538-539）均为有效强断言。

**边界覆盖（优秀）**：空 ArrayBuffer / 50 字节坏签名 reject；首帧前/末帧后/精确命中/负帧/NaN/Infinity 帧号；单帧轨道（任意帧号返回该帧，L434-477）；骨骼不存在返回 null；混合 bone + movable 的 position 有无区分；EASE_IN_OUT 位置缓入方向（L544-570）；shutdown 后可重建 + 幂等。异常路径（loader reject、dispose 后调用）均有覆盖。

**弱断言/盲区（核心问题）**：① **L290-319 与 L544-570 两处"缓入"断言是假阳性**（详见 P1）：断言方向正确（EASE_IN_OUT 中点应缓入），但实际断言落在 3.3e-5 的二分截断噪声上，无法区分 LINEAR 与 EASE_IN_OUT，也无法发现"缓动被静默丢弃"这一真实缺陷；② 无「EASE_IN_OUT 输出 ≠ LINEAR 输出」的差异化断言；③ 无 position 三轴独立插值（x/y/z 不同曲线）的测试；④ 无多轨道同名骨（真实 Map 覆盖语义）测试；⑤ `InterpCurve` 边界值（x1=0 / x2=127 极端曲线）未覆盖。均为 P1/P4 级，不阻断除 P1 外的通过。

**与历史审核的关系**：
- round-5 审过 vmd-evaluator（✅，431 行测试 + 610 行回归 spec）——回归 spec 注释（L19-25）**已知**「loader 从 48/56/52/60 取旋转插值、全为组首字节 x1 → 等效 (x1,x1,x1,x1)」并镜像之；但主测试文件反其道断言缓动生效，二者自相矛盾，本轮首次点破。
- round-6 审过（✅，覆盖 VMD 帧大小/签名/插值/结构）。
- round-15 审过（⚠️ P2×2：NullEngine 泄漏、createVmdEvaluator 无 try/catch）——**两项均未修复，本轮复核仍开放**（见风险表）。
- round-28 审过 vmd 格式层（vmd-writer/vpd-parser，✅）——writer 插值字节的**字节级**输出正确（vmd.test.ts:382-411 断言 47-50 位 = x1,y1,x2,y2），但未做 loader round-trip，导致「writer 布局 ≠ loader 提取位置」的 P1 缺陷漏网；本测试本应兜住却因假阳性断言而失效。

**其余维度**：类型安全 0 处逃生口；状态流——创建→求值→关闭三态清晰，`_disposed` 守卫无幽灵路径；并发安全——求值纯读（无内部可变缓存）、dispose 后立即置 null，重复求值/并发 dispose 安全；循环依赖——仅依赖 babylon-mmd + `@/core/dispose-helpers`，dep-graph 无环；魔法数值见 P4。

---

审核日期：2026-08-15
审核员：子代理 round48-vmd-evaluator
