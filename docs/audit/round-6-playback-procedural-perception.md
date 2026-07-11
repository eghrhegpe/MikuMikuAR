# 第⑥轮审核 — 播放 + 程序化 + 感知

## playback.ts (205行)

**总体结论：✅ 通过**

**文件：** `frontend/src/scene/motion/playback.ts`
**测试：** `playback.test.ts` (515行)

### 各维度

| 维度 | 结论 |
|------|------|
| 类型安全 | ✅ 零类型逃生（0 处 as any / ts-ignore / 非空断言） |
| 资源管理 | ✅ `_disposed` guard 防双释放；`modelManager` 参数注入避循环依赖 |
| 功能正确性 | ✅ auto-loop 用 `_loopPending` + async 快照防竞态；`stop()` 使用 `_disposed` 标志防重复调用 |
| 测试覆盖 | ✅ 515行覆盖完整 |
| 设计质量 | ✅ 职责清晰，状态集中管理 |

---

## vmd-writer.ts (232行)

**总体结论：✅ 通过**

**文件：** `frontend/src/scene/motion/vmd-writer.ts`
**测试：** 与 `vmd.test.ts` 共享覆盖

### 各维度

| 维度 | 结论 |
|------|------|
| 类型安全 | ✅ 纯函数，无类型逃生 |
| 功能正确性 | ✅ `sanitizeName` 过滤控制字符；`encodeShiftJis` 双字节回退正确 |
| 测试覆盖 | ✅ VMD 帧大小/签名/插值/结构均已覆盖 |

---

## beat-detector.ts (296行)

**总体结论：✅ 通过**

**文件：** `frontend/src/scene/audio/beat-detector.ts`
**测试：** `beat-detector.test.ts` (231行)

### 各维度

| 维度 | 结论 |
|------|------|
| 类型安全 | ✅ |
| 资源管理 | ✅ `GainNode` 隔离；`dispose()` 完全清理 AudioNode 链 |
| 测试覆盖 | ✅ 231行覆盖核心检测逻辑 |
| 设计质量 | ✅ 静态方法暴露供测试——纯函数可独立验证 |

---

## lipsync.ts (90行) + lipsync-bridge.ts (105行)

**总体结论：✅ 通过**

**文件：** `frontend/src/scene/motion/lipsync.ts`, `frontend/src/scene/audio/lipsync-bridge.ts`
**测试：** `lipsync.test.ts` (173行)

纯函数模块，类型安全，测试覆盖完整。

---

## vpd-parser.ts (200行)

**总体结论：✅ 通过**

**文件：** `frontend/src/motion-algos/vpd-parser.ts`
**测试：** `vpd-parser-security.test.ts` (328行)

### 各维度

| 维度 | 结论 |
|------|------|
| 测试覆盖 | ✅ 328行安全测试覆盖注入攻击场景 |
| 功能正确性 | ✅ VPD 格式解析正确 |
| 设计质量 | ✅ 有安全意识的输入验证 |

---

## proc-motion-idle.ts (172行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/proc-motion-idle.ts`
**测试：** ❌ 0 测试

### 问题

| # | 问题 | 严重度 |
|---|------|--------|
| 1 | 0 测试 | 🟡 P3 |
| 2 | 骨骼帧代码 3 组高度相似（呼吸、眨眼、微动） | 🟢 P4 — 可抽象为循环 + 配置数组 |

---

## proc-motion-autodance.ts (540行)

**总体结论：❌ 不通过**

**文件：** `frontend/src/scene/motion/proc-motion-autodance.ts`
**测试：** ❌ 0 测试

---

### 🔴 P1 问题

| # | 问题 | 说明 |
|---|------|------|
| 1 | **540 行超 250LOC 天花板** | 是阈值的 **2.16 倍**。应拆分：autodance-config, autodance-choreography, autodance-timing |
| 2 | **0 测试** | 核心舞蹈编排逻辑无任何回归保护 |
| 3 | **sinVals/cosVals 未预分配** | 访问 `sinVals[i]` 时若数组长度 < i，返回 `undefined` → NaN → 骨骼变换异常 |
| 4 | **骨骼候选名与 shared.ts 重复定义** | `proc-motion-autodance.ts` 硬编码骨骼名列表，与 `proc-motion-shared.ts` 中的定义重复 |

### 设计质量

舞蹈编排的数学计算部分（节奏→骨骼变换映射）设计合理，但**可维护性问题严重**：
- 540 行单体函数
- 硬编码的骨骼动画序列
- 与共享模块的重复定义

---

## proc-motion-lifelike.ts (264行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/proc-motion-lifelike.ts`
**测试：** ❌ 0 测试

### 🟡 P3

0 测试。逼真运动参数（幅度、频率、阻尼系数）无任何验证。

---

## proc-motion-bridge.ts (448行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/motion/proc-motion-bridge.ts`
**测试：** `proc-motion-bridge.test.ts` (631行，覆盖部分路径)

---

### 各维度

| 维度 | 结论 |
|------|------|
| 模块大小 | 🟠 P2 — 448 行超 250LOC |
| 测试覆盖 | 🟡 P3 — 631 行测试但 **核心 `startProcMotion` 异步路径 0 覆盖** |
| 功能正确性 | 🟠 P2 — `setGazeLayerActive` 间接触发 `triggerAutoSave` 副作用（函数名未体现） |

### 问题

| # | 问题 | 严重度 |
|---|------|------|
| 1 | 448 行超限 | 🟠 P2 |
| 2 | `startProcMotion` 异步路径（多进程编排、错误恢复）0 测试 | 🟠 P2 |
| 3 | `setGazeLayerActive` 隐式触发 `triggerAutoSave` | 🟡 P3 — 副作用不透明 |

---

## perception.ts (1155行)

**总体结论：❌ 不通过**

**文件：** `frontend/src/scene/motion/perception.ts`
**测试：** `perception.test.ts` (876行)

---

### 模块大小 — 🔴 P1

**1155 行，是 250LOC 阈值的 4.6 倍。** 超出过多，必须拆分。

建议拆分结构：
- `perception-gaze.ts`（视线跟踪/覆盖逻辑）
- `perception-expression.ts`（表情生成）
- `perception-pipeline.ts`（更新管线编排）
- `perception-debug.ts`（调试可视化）

### 循环依赖 — 🟡 P3

`perception.ts` 与 `scene.ts` 存在循环引用模式，与 `wasm-layers-blender.ts` 类似。

### 测试覆盖 — 🟠 P2

虽然 `perception.test.ts` 有 876 行，但 **实时渲染路径（onBeforeRender 中的核心更新管线）0 覆盖**。大部分测试覆盖工具函数和配置逻辑，核心的每帧更新/混合/覆盖逻辑未被测试。

### 功能正确性 — 🟠 P2

| # | 问题 | 位置 | 风险 |
|---|------|------|------|
| 1 | `activatePerception` 跳过检测有逻辑漏洞 | L~200 | 在特定条件下跳过状态验证，可能以不一致状态激活 |
| 2 | 对象池不防多帧交织 | L~500 | 多帧并发访问对象池时可能返回同一对象 |

### 设计质量 — ✅（核心架构）

| 模式 | 说明 |
|------|------|
| 对象池 | 高频对象复用，减少 GC |
| 分层架构 | gaze → expression → 最终变换，各层职责清晰 |
| 调试可视化 | Debug 模式可叠加显示感知状态 |

### 性能 — 🟡 P3

`_writeMatToBuffer` 中遍历赋值，可用 `buf.set(src)` 批处理替代逐元素设置，提升约 3-5 倍。

---

## proc-motion-shared.ts (164行)

**总体结论：✅ 通过**

纯常量/配置共享模块，无运行时逻辑。

---

## 风险清单

| 文件 | 观察 | 建议 |
|------|------|------|
| 🔴 P1 | proc-motion-autodance.ts | 540 行 + 0 测试 + undefined 问题 | 拆分、添加测试、sinVals 预分配、消除与 shared.ts 重复定义 |
| 🔴 P1 | perception.ts | 1155 行超限 | 拆 4 子模块 |
| 🟠 P2 | perception.ts | 实时渲染路径零测试 | 添加 onBeforeRender 核心更新管线测试 |
| 🟠 P2 | perception.ts | activatePerception 跳过检测 | 修复状态验证逻辑 |
| 🟠 P2 | proc-motion-bridge.ts | startProcMotion 异步路径零测试 | 添加多进程编排测试 |
| 🟡 P3 | proc-motion-idle.ts | 0 测试 | 最小添加：呼吸/眨眼生成测试 |
| 🟡 P3 | proc-motion-lifelike.ts | 0 测试 | 最小添加：参数范围验证 |
| 🟡 P3 | perception.ts | _writeMatToBuffer 逐元素赋值 | 改用 `buf.set(src)` |
| 🟡 P3 | perception.ts | 对象池不防多帧交织 | 加 generation counter 或锁机制 |
| 🟡 P3 | proc-motion-bridge.ts | setGazeLayerActive 隐式 triggerAutoSave | 函数名体现副作用或改为显式调用 |
