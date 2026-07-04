# ADR-021: 程序化动作系统（Idle/Auto Dance + LipSync + 视线追踪）

**日期**：2026-07-03

---

## 背景

用户在没有加载 VMD 动作文件时，模型处于静止 T-Pose，体验不佳。需要一套程序化动作系统在无 VMD 时提供基础动画：

1. **Idle Motion** — 呼吸 + 眨眼，保持模型自然
2. **Auto Dance** — 节拍驱动的律动，配合音乐使用
3. **LipSync** — 实时振幅驱动口型 morph
4. **Gaze Tracking** — 头部/眼球跟随相机

## 决策

### 核心方案：VMD 帧生成 + WASM 动画通道

程序化动作不直接操作骨骼矩阵，而是**每帧生成 VMD 关键帧**，通过标准 `createRuntimeAnimation` 注入 WASM 动画系统，确保与用户加载的 VMD 共享同一动画通道。

### 模块分工

| 模块 | 职责 | 文件 |
|------|------|------|
| `procedural-motion.ts` | Idle/Auto Dance VMD 帧生成 + 模式管理 | `motion/procedural-motion.ts` |
| `vmd-writer.ts` | VMD 二进制构建（含 Shift-JIS 骨骼名编码） | `motion/vmd-writer.ts` |
| `beat-detector.ts` | 音乐节拍检测（Web Audio API 能量峰值法） | `motion/beat-detector.ts` |
| `lipsync.ts` | 振幅→morph 权重映射 + morph 名查找 | `motion/lipsync.ts` |
| `vpd-parser.ts` | VPD 姿势文本解析→VMD 转换 | `motion/vpd-parser.ts` |
| `scene-proc-motion.ts` | 视线追踪 observer（linkedBone + updateWorldMatrix） | `scene/scene-proc-motion.ts` |

### 关键设计决策

**1. ProcMotion 状态机**

```
mode: "off" | "idle" | "autodance"
autoSwitch: boolean  ← 音乐播放/停止自动切换 idle↔autodance
```

- `autoSwitch=false` 时手动设模式仍然生效（`mode !== "off"` 即启动）
- `procActiveKind` 追踪实际加载类型，不篡改 `procState.mode`（修复 auto-switch 永久失效 bug）
- `procModelId` 精确追踪持有程序化 VMD 的模型，焦点切换/模型删除时正确清理

**2. Idle Motion**
- 呼吸：躯干骨骼正弦微动（频率 0.3Hz，幅度 0.02）
- 眨眼：`eyeClose` morph 周期性脉冲（频率 0.15Hz）
- 锁骨微动：`clavicle` 骨骼小幅旋转

**3. Auto Dance**
- 节拍检测驱动律动幅度
- 躯干上下弹跳 + 手臂微摆
- 无节拍时降级为 Idle Motion（`shouldIdle` 处理 autodance 模式）

**4. LipSync**
- `BeatDetector.getLevel(lowHz, highHz)` 获取人声频段能量
- `amplitudeToWeight(amp, sensitivity, strength)` → 映射到 "あ" morph 权重

**5. Gaze Tracking（2026-07-02）**
- `linkedBone.rotationQuaternion` 写局部旋转，非 worldMatrix
- 手动 `updateWorldMatrix` 递归重算骨骼链
- 四元数左乘：`parentInv × blended`
- `VITE_MMD_RUNTIME=js` 规避 WASM 双缓冲覆盖

### 拒绝的方案

| 方案 | 拒绝原因 |
|------|---------|
| 直接操作骨骼矩阵 | 绕过 WASM 动画系统，与用户 VMD 冲突 |
| babylon.js Animation 关键帧 | 不与 babylon-mmd 骨骼系统兼容 |
| 生成无限长单帧 VMD | 帧插值误差累积，长时间运行变形 |

## 后果

- ✅ 无 VMD 时自动 Idle，加载音乐自动切换到 Auto Dance
- ✅ 与用户 VMD 共享动画通道，无缝切换
- ⚠️ 程序化动作无 WASM 物理响应（头发/布料不摆动）
- ⚠️ VMD 帧每 tick 重建 → WASM 动画重建开销（约 0.5ms/帧，可接受）
- ⚠️ Gaze Tracking 需要 JS 运行时（`VITE_MMD_RUNTIME=js`），牺牲 WASM Bullet 物理
- ✅ 场景序列化支持（`ProcMotionConfig` + `LipSyncConfig`）

## 状态

✅ 已实现并验证（2026-07-03），测试套件 `procedural-motion.test.ts`（17 tests）、`beat-detector.test.ts`（10 tests）、`lipsync.test.ts`、`vpd-parser.test.ts`（21 tests）、`vmd-writer.test.ts`（10 tests）全部通过。