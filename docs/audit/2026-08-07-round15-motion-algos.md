# 第 15 轮审核报告 — motion-algos 纯算法层

> **日期**: 2026-08-07
> **范围**: 18 模块（motion-algos/ 目录）
> **方法**: 知识卡 → 源码 → 5 维度 + 4 心理模拟；逐行核对源码
> **结论**: ✅通过 14 / ⚠️有条件通过 4 / ❌不通过 0（P1×1）

## 执行摘要

| 结论 | 模块数 | 模块 |
|------|--------|------|
| ✅ 通过 | 14 | feet-event, feet-adjustment-math, footstep-detect, lipsync, pose-preset, vmd-writer, vpd-parser, procedural-motion, proc-motion-autodance, proc-motion-autodance-bones, proc-motion-autodance-bones-trunk, proc-motion-autodance-bones-limbs, proc-motion-idle, proc-motion-presets |
| ⚠️ 有条件通过 | 4 | beat-detector, vmd-evaluator, proc-motion-shared, proc-motion-autodance-emotion |
| ❌ 不通过 | 0 | — |

## 🔴 P1 问题（必须修复）

| # | 模块 | 位置 | 问题 | 影响 |
|---|------|------|------|------|
| 1 | proc-motion-shared | proc-motion-shared.ts:294-305 | `matchBone` 在找到首个匹配的候选名后，若 `canEncodeName(c)` 返回 false，**立即 `return null`**，不再尝试后续候选。正确行为应是 `continue` 继续遍历。 | 当模型骨骼名恰好是第一个候选（如「センター」）但 Shift-JIS 编码失败时，即使后续候选（如 "Center"）可编码也会被跳过，导致该骨骼类别**静默缺失**，程序化动作少一块骨骼。 |

**修复建议（diff）：**
```diff
 export function matchBone(actualBones: string[], candidates: string[]): string | null {
     for (const c of candidates) {
         if (actualBones.includes(c)) {
             if (canEncodeName(c)) {
                 return c;
             }
-            logWarn('procedural-motion', `骨骼 "${c}" 无法编码为 Shift-JIS，跳过`);
-            return null;
+            logWarn('procedural-motion', `骨骼 "${c}" 无法编码为 Shift-JIS，尝试下一候选`);
+            continue;
         }
     }
     return null;
 }
```

## 🟠 P2 问题（建议修复）

| # | 模块 | 位置 | 问题 |
|---|------|------|------|
| 2 | vmd-evaluator | vmd-evaluator.ts:273-297 | `_getSharedScene()` 创建的 `NullEngine` 实例**从未被 dispose**。`shutdownVmdEvaluator()` 仅调用 `safeDispose(_sharedScene)`，引擎泄漏。 |
| 3 | vmd-evaluator | vmd-evaluator.ts:282-288 | `createVmdEvaluator` 是 `async` 函数，`loader.loadFromBufferAsync` 抛异常时**无 try/catch**，错误直接抛给调用方。调用方（proc-motion-bridge）若未捕获会产生未处理 Promise 拒绝。 |
| 4 | proc-motion-autodance-emotion | proc-motion-autodance-emotion.ts:215-228 | `genShyMorph` 生成的帧号 `shyStart + beatFrames * 2 + 2` 可能**超出 `loopFrames`**（当 `loopFrames < 6 * beatFrames` 时）。`pushFadeMorph` 无边界校验。 |
| 5 | beat-detector | beat-detector.ts:168-219 | `update()` 无 `_disposed` 标志守卫。虽然 `this.analyser` 在 dispose 后置 null 形成隐式守卫，但 `this.ctx`/`this.gain` 等仍可能被其他方法访问。 |
| 6 | beat-detector | beat-detector.ts:55-61 | `attach()` 在 `this.ctx` 已存在时**直接 `return true`**，不检查传入的 `audioElement` 是否与上次一致。 |

## 🟡 P3 关注项

- **vmd-writer.ts:183-184** — `buildVmd` 对 `boneFrames` / `morphFrames` 调用 `.sort()` **原地修改**传入数组。当前调用方传入新构造数组，安全；但未来若复用数组会产生意外副作用。建议 `[...boneFrames].sort(...)`。
- **proc-motion-autodance-emotion.ts:147-150** — `genEmotionCycles` 用 `logWarn` 输出匹配到的表情 morph 列表，这是**正常信息**而非警告，应降级为 `logInfo`/`logDebug`。
- **proc-motion-autodance-emotion.ts:7 / vpd-parser.ts:9** — 使用相对路径 `import { logWarn } from '../core/logger'`，而 beat-detector.ts / proc-motion-shared.ts 使用别名 `@/core/logger`。路径风格不一致（功能等价）。
- **proc-motion-autodance-bones-limbs.ts:212-213** — `genFootIkBones` 的 `stepAmp = 2.0 * intensity`，经 `clamp1` 钳制到 [-1,1]。`intensity < 0.5` 时钳制无效，低强度下脚部位移偏小。
- **proc-motion-autodance-emotion.ts:57-72** — `scoreMorph` 使用字符串 `includes` 匹配，精度较低（如关键词 "win" 误匹配 "window"）。代码中已有 `⚠️ P3` 注释，确认已知。
- **proc-motion-shared.ts:119** — `r.mode!` 非空断言前有 `PROC_MOTION_MODES.includes(...)` 守卫，**合理**。
- **beat-detector.ts:185/285** — `this.energyHistory.shift()!` 非空断言前有 `length > ENERGY_HISTORY_SIZE` 守卫，**合理**。
- **vmd-writer.ts:51/90/102** — `Encoding.convert(...) as number[]` / `as string`：encoding-japanese 库返回类型为 `unknown`，类型断言必要且合理。
- **beat-detector.ts:64** — `window as unknown as { webkitAudioContext: ... }`：webkitAudioContext 兼容性兜底，**合理**。

## 知识卡偏差汇总

| 知识卡 | 偏差 |
|--------|------|
| motion-footstep.md | 知识卡描述 `detectFootLanding` 为 footstep-detect-fallback 复用；实际定义在 `motion-algos/footstep-detect.ts`，feet-adjustment 与 fallback 均消费。未明确标注该函数位于 motion-algos 层（轻微）。 |
| motion-feet-adjustment.md | 知识卡 symbols 列出 `detectFootLanding`，但该函数实际定义在 `footstep-detect.ts`（motion-algos 层），feet-adjustment.ts 仅调用。symbols 归属略有混淆。 |
| proc-motion-bridge.md | 知识卡描述 `ProcMotionController` 为"导出，组合 Base + ParamsMixin"，但该类在 scene/motion/proc-motion-bridge.ts，不在 motion-algos 层。scope 边界清晰，无实质偏差。 |
| perception-lipsync.md | 知识卡描述 `_applyLipSync` 为私有函数仅被 perception-observer 调用，与 motion-algos/lipsync.ts 的纯函数职责互补。无偏差。 |
| lipsync-bridge.md | 知识卡未提及 `multiMorphEnabled`（P0 开关）和 `LipSyncMorphSet` 类型，而 lipsync.ts 已实现 `findAllLipMorphs`。知识卡略滞后于实现（轻微）。 |

## 逐模块审核结论

### ✅ feet-event.ts — 通过
纯类型定义，零依赖，零副作用。ADR-238 切断循环依赖的设计意图清晰。

### ✅ feet-adjustment-math.ts — 通过
`solveFootTarget` 纯函数，无状态、无副作用。`clamp01` 来自 `@/core/clamp`（合规）。数学语义与注释一致：jumpThreshold 跳过、reachAngle 补偿、maxAngle 钳制、footSmooth 平滑、intensity 混合。

### ✅ footstep-detect.ts — 通过
`detectFootLanding` 纯函数，上升沿检测 + 去抖 + impactSpeed 估算。`safeDt = Math.max(input.dt, 1e-4)` 防除零。状态完全由调用方维护。

### ✅ lipsync.ts — 通过
`findLipMorph` / `findAllLipMorphs` / `amplitudeToWeight` 均为纯函数。`amplitudeToWeight` 正确处理 `sensitivity=1` 边界（range<=0 时仅振幅满时张嘴）。`Set` 查找 O(n) 但 morph 列表通常 <50，可接受。

### ✅ pose-preset.ts — 通过
`generatePoseVmd` 委托 `buildVmd` 生成 T/A/rest pose，复用 Shift-JIS 编码，消除手写二进制风险。`Quaternion.FromEulerAngles` 使用正确。

### ✅ vmd-writer.ts — 通过（P3 关注：sort 原地修改）
二进制写入器实现完整：Shift-JIS 编码（含双字节回退）、签名/模型名/帧计数/trailer 结构正确。`sanitizeName` 过滤控制字符。`canEncodeName` round-trip 校验。

### ✅ vpd-parser.ts — 通过
编码探测（UTF-8/UTF-16/Shift-JIS）+ 降级到 UTF-8。`parseVPDText` 状态机解析骨骼/morph，`_cleanNumericLine` 兼容注释/分号/XML entity。`loadVPDFromBuffer` 无骨骼时抛明确错误。`MAX_VPD_SIZE` 1MB 限制合理。

### ✅ procedural-motion.ts — 通过
Barrel 文件 + 两个纯判定函数 `shouldAutoDance` / `shouldIdle`。逻辑清晰，无副作用。

### ✅ proc-motion-autodance.ts — 通过
主入口编排 7 个阶段：参数计算 → 骨骼解析 → 三角缓存 → 骨骼帧生成 → 插值 → 情绪 morph → VMD 组装。`[...boneNames]` 拷贝防 sort 副作用。`beatFrames` 经 `Math.min(MAX_FRAMES, ...)` 钳制。

### ✅ proc-motion-autodance-bones.ts — 通过
节拍栅格模型：`beatInfo` / `beatBounce` / `downbeatWeight` / `swayAt` 均为纯函数。`resolveBones` 批量解析。`applyInterp` / `applyInterpOverride` 职责单一。

### ✅ proc-motion-autodance-bones-trunk.ts — 通过
躯干骨骼生成器（Center/Upper/Upper2/Waist/Groove/AllParent）。单一 `swayAt` 相干源驱动，`clamp1` 钳制，`quatW` 计算 w 分量。循环含端点 `f=loopFrames` 保证无缝。

### ✅ proc-motion-autodance-bones-limbs.ts — 通过
四肢骨骼生成器（Arm/Elbow/Shoulder/Wrist/FootIK）。平滑连续正弦替代逐拍脉冲，`beatBounce` + `downbeatWeight` 制造节奏层次。`genElbowBones` 滞后样本制造 follow-through。

### ✅ proc-motion-idle.ts — 通过
待机呼吸生成器。各骨骼类别独立循环，`closingFrame` 闭合帧保证无缝。`swayAmp` 从感知层原值缩减 50%。`clamp1` 钳制旋转分量。

### ✅ proc-motion-presets.ts — 通过
纯数据 + 纯函数。`mk` 工厂函数用 `...base, ...(partial.boneToggles ?? {})` 合并，`as` 断言必要。`makeProcPreset` 深拷贝防共引用。`upsertProcPreset` / `removeProcPreset` 返回新数组（不可变）。

### ⚠️ beat-detector.ts — 有条件通过（P2×2）
`BeatDetector` 类实现完整：AudioContext 管理、能量峰值法、BPM 量化、回调机制、`dispose` 资源释放。`safeCallVoid` 包裹回调防单回调崩溃。`swallowError` 用于 `ctx.resume()`（最佳努力，合理）。
- P2#5：`update()` 无显式 `_disposed` 守卫（隐式靠 `analyser` null）。
- P2#6：`attach()` 二次调用静默忽略新 audioElement。

### ⚠️ vmd-evaluator.ts — 有条件通过（P2×2）
`VmdEvaluatorImpl` 实现完整：二分查找 + Slerp/Lerp 求值，`_disposed` 守卫正确。`createVmdEvaluator` 异步创建。
- P2#2：`NullEngine` 未 dispose（引擎泄漏）。
- P2#3：`createVmdEvaluator` 无 try/catch，loader 错误未处理。

### ⚠️ proc-motion-shared.ts — 有条件通过（P1×1）
类型/常量/默认值/迁移函数/骨骼候选名/工具函数集合。`migrateProcState` 迁移逻辑完整（枚举校验 + 深合并 boneToggles + 旧扁平→新嵌套）。
- P1#1：`matchBone` 首个不可编码候选即 `return null`，应 `continue`。

### ⚠️ proc-motion-autodance-emotion.ts — 有条件通过（P2×1）
情绪引擎：`scoreMorph` 评分、`findBestEmotionMorphs` 最佳匹配、`genEmotionCycles`/`genAccentMorph`/`genShyMorph` 帧生成。`canEncodeName` 过滤不可编码 morph。
- P2#4：`genShyMorph` 帧号可能超出 `loopFrames`。
- P3：`logWarn` 用于正常信息输出。

## 心理模拟

1. **某行抛异常，清理代码是否执行？**
   - `BeatDetector.attach`：`createMediaElementSource` 抛异常时 catch 块清理自建 ctx + 清空节点引用，**正确**。
   - `createVmdEvaluator`：loader 抛异常时无清理，但此时 `VmdEvaluatorImpl` 尚未构造，无泄漏。**可接受但建议加 try/catch**。
   - `buildVmd`：纯同步函数，无资源需清理。

2. **异步操作是否接受 AbortSignal？**
   - `createVmdEvaluator` 不接受 AbortSignal。当前调用方（proc-motion-bridge）未传递取消需求，**可接受**，但长期建议支持。

3. **用户快速操作 3 次会怎样？**
   - `generateAutoDanceVmd` / `generateIdleVmd`：纯函数，无状态，快速调用 3 次产生 3 个独立 ArrayBuffer，**安全**。
   - `BeatDetector.attach`：二次调用 `return true` 不重建，**安全但静默忽略新元素**（P2#6）。
   - `BeatDetector.dispose`：清空所有引用，二次 dispose 幂等（各字段已 null/空），**安全**。
   - `VmdEvaluator.dispose`：`_disposed` 标志守卫，二次 dispose 幂等，**安全**。

4. **finally 块是否有 disposed 标志守卫？**
   - 本层无 `try/finally` 块（纯算法层无异步资源清理需求）。`VmdEvaluatorImpl` 的 `_disposed` 守卫在 `evalBoneFrame`/`evalAllBones` 入口处，**正确**。
   - `BeatDetector` 无 `_disposed` 标志，靠 `analyser` null 隐式守卫（P2#5）。

## 验证

- [x] 已检查所有 18 个文件
- [x] 已核对知识卡（motion-math, motion-footstep, motion-module-types, motion-preset-types, perception-lipsync, motion-pipeline, proc-motion-bridge, footstep-detect-fallback, motion-feet-adjustment, lipsync-bridge）
- [x] 已 grep 扫描 `as any` / `@ts-ignore` / `catch{}` / `@/core/utils`（均未发现违规）
- [x] 已确认无静默吞错（`catch{}`）
- [x] 已确认无 `@/core/utils` 神桶导入（ADR-191 合规）
