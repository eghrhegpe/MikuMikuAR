# round-29-perception-perf — 感知层性能基准测试审核

**审核日期**：2026-08-15
**审核员**：子代理 round29-perception-perf（第 29 轮审核第 3 个测试之一）

## 审核范围

| 项 | 内容 |
|----|------|
| **测试文件** | `frontend/src/__tests__/perception.perf.test.ts`（757 行，单 test） |
| **被测目标** | 感知层 6 项热路径性能基准：合成骨骼图 stub（83 骨 / 20 morph），复刻 matchBone / RotationAxis / multiply / updateWorldMatrix / morph 扫描 / lipsync 等热路径；不导入 perception.ts（避免循环依赖）；软断言 + 硬断言结合；独立 `vitest.perf.config.ts` 运行，默认套件已排除 |
| **定位说明** | 本测试是**性能基准（非功能测试）**，对应 **ADR-165**（感知层性能基准，为 ADR-164 全员感知降级提供阈值依据）。注意：测试头注自述「ADR-154/155」，实为**编号错误**（ADR-154=LLM 聊天面板、ADR-155=NL 控场景，均与感知无关；正确编号为 ADR-164/165，见风险 R3）。断言有效性：软断言（console.warn）防 CI 波动误报 ✅，P50 硬断言 + `PERF_BUDGET_MULTIPLIER` 逃生阀 ✅，但 (a) 段基线因预热不足失真（见 R2） |

**运行验证**（本机实测，vitest 4.1.9）：

```text
模型骨骼数: 83   Morph 目标数: 20
[a] 单模型 P50=756.6μs  P95=1.335ms  P99=4.78ms   → 硬断言 0.5ms 失败（默认环境稳定失败，重跑 2 次一致）
[c] breathing 505.7ms(21.8%) | blinking 304.8ms(13.1%) | microExpression 281.8ms(12.1%)
    balanceSway 1187.2ms(51.1%) | lipSync 26.2ms(1.1%) | gaze 19.4ms(0.8%) | 合计 232.5μs/帧
[d] 100 模型 P50=22.37ms  P95=34.5ms > 16.67ms 预算
```

**总体结论：⚠️ 有条件通过**

测试整体设计合格：测量矩阵（单模型 / N 曲线 / 占比 / 100 模型）与 ADR-165 §3.2 完全对齐，balanceSway 占 51% 等数据**确实能为 ADR-164 降级决策提供依据**（low 档关闭 balance 的方向被实测支持）。但存在 2 个 P2 实质性缺陷：gaze 复刻的是已废弃的旧算法、单模型基线因 warm-up 不足失真 3 倍导致默认环境硬断言必红；另 ADR 编号引用错误（P3）与阈值回填未闭环（P2）为跨轮遗留。

## 亮点

- **真实生产函数直连**：`matchBone` / `findLipMorph` / `findAllLipMorphs` / `amplitudeToWeight` 直接导入 `motion-algos/proc-motion-shared.ts` 与 `lipsync.ts`（测试文件:16-25），算法层基准测的是真实现，非自造近似
- **对象池复刻规避 GC 噪音**：模块级 `_v3Pool=16 / _mPool=16 / _qPool=32`（测试文件:242-257），与生产 perception-shared 的池化模式一致，长时间测量稳定
- **软硬断言分层 + 逃生阀**：P95 软断言（console.warn）防 CI 波动误报，P50 硬断言拦截真实回归（测试文件:577-588、628-630、747-751），`PERF_BUDGET_MULTIPLIER` 环境变量放宽慢机（数值校验 `Number.isFinite`）；git 历史显示第三/四轮审核已将「恒绿软断言」演进为软硬结合
- **合成骨骼图自包含**（测试文件:58-194）：83 骨覆盖全部感知候选命名（BONE_UPPER/WAIST/ALLPARENT/眨眼 morph 等），无 PMX 资产依赖，`cloneModelStub` 深拷贝语义正确（父/子指针重建 + morph manager 独立克隆）
- **测量矩阵完整**：a) 单模型 1000 帧 / b) 1-100 模型曲线 / c) 6 项占比 10000 帧 / d) 100 模型 60fps 预算，与 ADR-165 §3.2 逐项对应；分位数统计与 formatMs 输出简洁
- **工程隔离到位**：`vitest.config.ts:102` 默认排除 `**/*.perf.test.ts`，独立 `vitest.perf.config.ts` 运行，不污染常规套件（ADR-206 §Phase 4 明确「保持整体」）；`// @vitest-environment node` 与 config 的 happy-dom 正确覆盖
- **卫生项全绿**：0 处 `as any` / `@ts-ignore` / `@ts-expect-error`；0 处 `skip` / `only`；创建对象仅 math 值类型 + Float32Array + 模块级池，无 GPU/引擎资源，无 dispose 需求（Babylon math 类为值类型，不适用 dispose 语义）；超时 180s 合理

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | frontend/src/__tests__/perception.perf.test.ts | L480-489 | **gaze 热路径复刻过时**：注释称「复刻 _clampHeadGazeTarget（_clampImpl 内联）」，但实现是旧版 toEulerAngles 分解（`desiredLocal.toEulerAngles()` → yaw/pitch 分别 clamp → FromEulerAngles）；生产 `perception-gaze.ts:65-111 _clampImpl` 已改为 **Swing-Twist 分解**（`_swingTwistDecompose` + twist/swing 分别限位 + `SlerpToRef` 缩放，注释明确「避免 toEulerAngles 在大角度复合旋转下的信息丢失」）。实测 gaze 仅占 0.8%（19.4μs/帧），生产算法含 decompose + 2×acos + SlerpToRef，明显更贵，gaze 项占比/基线系统性低估 | 按生产 `_clampImpl` 当前实现重写 benchApplyGaze 的 clamp 段（swing-twist 分解 + clampedTwist/clampedSwing 重组），保持与生产同构；并核对 perception-gaze.ts 是否有该旧算法对应的历史分支（若有版本差异需在注释注明所复刻的生产 commit） |
| 🟠 P2 | frontend/src/__tests__/perception.perf.test.ts | L602-620 | **(a) 段单模型基线失真**：warm-up 仅 50 帧（L602-604）即测量 1000 帧。本机实测 (a) 段 P50=756μs，而 (d) 段（跑在 a/b/c 之后，JIT 已充分预热）100 模型均摊仅 224μs/模型——单模型基线比稳态慢 **3.4 倍**。硬断言 0.5ms（L630）在默认环境**稳定失败**（重跑 2 次一致），拦截的是 JIT 冷态而非真实回归，与注释「实测 ~0.13ms/模型」脱节 | 将 (a) 段 warm-up 提升至 500-1000 帧，或把 (d) 段提到 (a) 前先行预热全函数族；若硬断言保留，须以本机稳态 224μs 为基线校准 0.5ms 预算并文档化各环境基线，避免默认环境必红 |
| 🟠 P2 | docs/adr/adr-164-perception-permodel-phase2.md | §3.1（L55-61） | **阈值未回填、数据流未闭环**：ADR-165 §四承诺「实际阈值以基准实测为准，完成后回填 ADR-164 §3.1」，ADR-164 §3.1 仍是初始估计（high ≤20 / medium 20-50 / low >50），无「实测回填」标注；生产 `_forceLowModelCount=50/_forceHighModelCount=20` 亦未按实测校准。2026-07-21 审核（2026-07-21-adr-164-165-perception-perf-audit.md:286）已列为 P2，至今未解决 | 运行基准 → 将本机实测（单模型稳态 ~224μs、100 模型 P50=22.4ms 超预算、balanceSway 占 51%）回填 ADR-164 §3.1 并标注日期；按 ADR-165 §四要求，实测与估计偏差 >20% 时应调整降级阈值常量 |
| 🟡 P3 | frontend/src/__tests__/perception.perf.test.ts | L1-12（头注） | **ADR 编号错误**：`[doc:adr-155] 感知层性能基准测试` 与「为 ADR-154『全员感知降级』提供阈值数据」引用错误——ADR-154=LLM 聊天面板（已被 ADR-196 取代）、ADR-155=NL 控场景；感知基准正确编号为 **ADR-165**，全员感知降级为 **ADR-164**。`[doc:adr-155]` 标签若被 gen-funcmap/gen-knowledge-adr 扫描会错挂函数→ADR 关联 | 头注改为「[doc:adr-165]」「为 ADR-164『全员感知降级』提供阈值数据」 |
| 🟡 P3 | frontend/src/__tests__/perception.perf.test.ts | L242-244 vs perception-shared.ts:112-114 | **「复刻 perception-shared 同款」注释失实**：测试池 `_v3Pool=16/_mPool=16/_qPool=32`，生产现为 `_v3=8/_m=16/_q=32`（v3 不一致；生产曾为 16，后被调整）。池容量差异影响 GC 特性近似度（v3 单帧消费 <8，无越界风险） | 同步为 8/16/32 或注释注明偏差及理由 |
| 🟡 P3 | frontend/src/__tests__/perception.perf.test.ts | L57 / L376 | 注释与实现不符：L57「约 100 骨」实际 **83 骨**（合成骨架 + 20 手指×2 + 6 IK + 12 補助骨）；L376「6 骨骼增量叠加」实际仅 **4 组候选**（center/upper2/waist/allParent，与生产 perception-balance.ts:67-70 一致） | 修正注释（「6 骨骼」疑为「6 感知项」笔误） |
| 🟢 P4 | frontend/src/__tests__/perception.perf.test.ts | L597 与 L756 | `expect(totalBones).toBeGreaterThan(0)` 重复断言两次 | 删除 L756 冗余断言 |
| 🟢 P4 | frontend/src/__tests__/perception.perf.test.ts | L388-443 | benchApplyBalanceSway 内 4 段「matchBone → find → FromEulerAngles → multiplyToRef → updateWorldMatrix」结构几乎相同，重复约 60 行 | 提取 `applyBoneDeltaQ(stub, name, deltaQ, updateChain)` 辅助函数（注意：作为基准复刻，保留生产同构重复亦可辩护，属可选优化） |
| 🟢 P4 | frontend/src/__tests__/perception.perf.test.ts | L329-332 / L351-354 / L510-513 | morphNames 扫描循环重复 3 次（blinking/microExpression/lipSync 各自重建）——如实复刻生产各子模块独立扫描（生产亦如此），但可注明为「复刻生产重复」避免被误读为冗余 | 加一行注释说明该重复是对生产行为的如实复刻 |

## 测试质量评价

### 基准有效性

- **✅ 热路径复刻整体可信**：breathing 与生产 `perception-breathing.ts:36-71` 逐行同构（matchBone + `Quaternion.RotationAxis` + `multiplyToRef` + 子链 updateWorldMatrix，含每帧 `runtimeBones.map` 的数组重建——生产亦每帧重建）；balance 4 组候选与生产 `perception-balance.ts:67-70` 一致；lipsync 直接调用生产函数；blinking/microExpression 形状近似。
- **⚠️ 两处失真**：① gaze 复刻旧 toEulerAngles 算法（R2 详述，P2）；② updateWorldMatrix 用 `Matrix.Compose + asArray` 回写近似 babylon-mmd 的 `updateWorldMatrix(false,false)`（测试:261-270），结果仅反映算法层耗时、不含真实 scene graph 开销——测试注释已声明「轻量 stub」，可接受，但 ADR-165 §3.1 原设计（真实 PMX + NullEngine + MmdRuntime）与实现（合成 stub）的偏离仍未在 ADR 中注记（2026-07-21 审核 P4 建议的注记未落实）。
- **⚠️ (a) 段基线失真**：warm-up 50 帧不足，单模型 P50=756μs 为 JIT 冷态数据（稳态 224μs），P99=4.78ms 达 P50 的 6 倍，说明含 GC/调度噪声。(c)/(d) 段（充分预热）数据可信。
- **✅ 决策数据可用**：balanceSway 占 51.1% → 直接支持 ADR-164 low 档「仅 breath+blink」决策；100 模型 P50=22.4ms > 16.67ms → 确认 N=100 突破 60fps 预算，low 档 >50 模型方向正确。

### 断言合理性

- **✅ 软硬结合合理演进**：P95 软断言（warn 不 fail）防 CI 波动误报 + P50 硬断言拦截回归 + `PERF_BUDGET_MULTIPLIER` 逃生阀（含 NaN/≤0 校验），git 历史证实经第三/四轮审核迭代（「假绿修复 + 阈值校准 + perf 乘数」）。
- **✅ 无 skipped/only**，默认套件排除生效，超时 180s 覆盖最慢机器。
- **⚠️ 硬断言基线失真**：(a) 段 0.5ms 预算与本机稳态实测（224μs）差 2.2 倍、与冷态实测（756μs）差 1.5 倍——默认环境稳定失败使该断言在无 multiplier 时无法作为稳定门禁；其「拦截回归」意图被 JIT 预热状态干扰。(d) 段 16.67ms 预算合理（稳态 22.4ms 超预算，方向性结论成立）。
- **⚠️ (b) 段无断言**：N 模型曲线仅 console 展示 ✓/✗ 标记，无 expect——信息性输出，可接受但需知悉其不构成门禁。

## 附：运行命令与数据口径

- 运行：`cd frontend && npx vitest run --config vitest.perf.config.ts src/__tests__/perception.perf.test.ts`（默认失败于 (a) 段硬断言；`PERF_BUDGET_MULTIPLIER=3` 时全绿）
- 本机稳态基线（multiplier=3 全量输出）：单模型合计 232.5μs/帧（balanceSway 118.7μs 51.1% 居首，gaze 1.94μs 0.8% 居末）；100 模型 P50=22.4ms / P95=34.5ms
- `npm run check` 未运行：本次审核仅涉测试文件与只读生产代码，未做任何改动，无类型检查需求（grep 已确认测试文件 0 处类型逃生）

---
**审核结论**：⚠️ 有条件通过——数据可用、机制合理，但需修复 gaze 复刻过时与 (a) 段预热失真两个 P2，并完成 ADR-164 阈值回填闭环。
