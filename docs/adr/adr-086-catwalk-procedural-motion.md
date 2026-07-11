# ADR-086: 猫步走秀程序化动作（Catwalk Procedural Motion）

**日期**: 2026-07-11
> **状态**: 通过
> **审核**: 2026-07-11 通过；P4 两处已修正（LIFT 常量定义、行号引用改函数名范围）

---

## 背景

竞品对标（`docs/competitive-analysis.md` §动作与动画）提取自 DanceXR 的能力：

> **Catwalk（猫步/T台动作）** — 程序化走秀动作：臀部摆动、刻意迈步、沿 Z 轴行走、可同步 BPM 节拍。

MikuMikuAR 当前程序化动作仅覆盖 `Idle` 与 `AutoDance`（`proc-motion-shared.ts:3` 的 `ProcMotionMode = 'off' | 'idle' | 'autodance'`），**无走秀/行走类动作**。DanceXR 此项标注为 ✅，本联邦为 ❌。优先级 🟢 低——本质属程序化动作，可完全复用现有 `Idle + AutoDance` 生成框架扩展，无新基础设施依赖。

用户价值：为角色提供「时装秀」式展示姿态，配合多模型同场 / 队形预设（ADR-037）可形成走秀场景；BPM 同步使其能与音乐节拍对齐，强化 AutoDance 生态。

### 现有基础设施（可直接复用）

| 能力 | 位置 | 说明 |
|------|------|------|
| 模式枚举 | `proc-motion-shared.ts:3` | `ProcMotionMode`，新增 `'catwalk'` 即可 |
| VMD 名称常量 | `proc-motion-shared.ts:5-7` | `PROC_VMD_NAME_IDLE/AUTODANCE/LIFELIKE`，仿增 `PROC_VMD_NAME_CATWALK` |
| 骨骼候选 | `proc-motion-shared.ts` | 已含 `BONE_GROOVE`（臀部摆动）、`BONE_WAIST`、`BONE_LEG_IK_L/R`、`BONE_*ARM` |
| 生成器范式 | `proc-motion-idle.ts` / `proc-motion-autodance.ts` | VMD 关键帧生成 + `buildVmd` 组装，autodance 已拆分 `_bones` / `_emotion` 子模块 |
| BPM 量化 | `proc-motion-bridge.ts:310 setBpmQuantizeEnabled` + `BeatDetector` | `bpmQuantizeEnabled` + `getBPM()`，可对齐步频 |
| 调度 | `proc-motion-bridge.ts` `startProcMotion` / `updateProcMotion` / `regenerateProcMotion` | 三处需增加 `catwalk` 分支 |
| UI 入口 | `motion-procmotion-levels.ts:65 addModeSlider` | 模式滑块增 `catwalk` 选项 |
| i18n | `core/i18n/locales/*` | 新增 `motion.modeCatwalk` 等键 |

### 缺口

- **无行走/迈步生成器**：现有生成器均原地（in-place），无「迈步 + 臀部摆动」步态。
- **无 Z 轴位移语义**：Catwalk「沿 Z 轴行走」在 VMD 内若做净位移会漂移/瞬移，需明确 in-place vs traverse 策略。
- **无步频对齐**：autodance 已用 BPM 对齐节拍，Catwalk 需复用同一通道对齐「步」而非「舞步」。

---

## 功能范围

### Phase A — 核心猫步（P3 低，规划）

| 设计要素 | 映射参数 | 说明 |
|----------|----------|------|
| 臀部摆动 (Hip Sway) | `catwalkHipSway` | groove + waist 正弦摆动幅度，默认 0.6，范围 0~1 |
| 刻意迈步 (Step Lift) | `catwalkStepHeight` | 左/右足 IK 交替抬腿高度，默认 0.5，范围 0~1（刻意、慢、幅度大） |
| 步频 (Step Cadence) | `catwalkStepCadence` | `'beat'`（每拍一步）/ `'2beat'`（每两拍一步，更慢更刻意），默认 `'2beat'` |
| 手臂姿态 (Arm Pose) | `catwalkArmPose` | `'swing'`（对侧自然摆动）/ `'posed'`（时装模特静态优雅姿态），默认 `'swing'` |
| BPM 同步 | 复用 `bpmQuantizeEnabled` | 开启且检测到 BPM 时，步频对齐 `beatFrames`；无音频时按 `state.speed` 默认慢走 |

### Phase B — 位移与进阶（待定）

| 设计要素 | 映射参数 | 说明 |
|----------|----------|------|
| 沿 Z 轴行走 (Traverse) | `catwalkTraverse` | 默认 false（原地猫步）。true 时 `center.position.z` 在循环内前进 + 平滑折返（0→+D→0），避免净位移瞬移；或接入队形/运镜（ADR-037）做场景级位移 |
| 转身回程 (U-turn) | `catwalkUTurn` | traverse 模式下循环末段加入 180° 转身走回，形成完整 T 台往返 |
| 手臂静态姿态自定义 | `catwalkPoseArmAngle` | `'posed'` 模式下的肩/肘固定角度 |

### 不 scope

- **路径行走（waypoint / 巡场）**：属队形系统（ADR-037），Catwalk 仅做步态，位移策略 Phase B 限定为直线往返。
- **足部 IK 地面贴合**：与 ADR-085 脚部调整正交，Catwalk 仅生成意图姿态，落地约束由 Feet Adjustment 处理。
- **真实步态生物力学**：Catwalk 是「刻意夸张」的展示步态，非自然行走，不做重心/动力学仿真。

---

## 技术方案

### 架构

新增 `proc-motion-catwalk.ts`（主入口）+ `proc-motion-catwalk-bones.ts`（骨骼帧 + 三角函数缓存，mirror `proc-motion-autodance*` 拆分），挂载至既有程序化动作调度链：

```
用户选 catwalk → updateProcMotion 分支 → startProcMotion('catwalk', bpm)
  → generateCatwalkVmd(state, bpm, morphNames, boneNames)
  → loadVMDMotion(buf, PROC_VMD_NAME_CATWALK)
```

生成器与 `generateAutoDanceVmd` 同签名（`state, bpm, morphNames, boneNames`），便于 `startProcMotion` 统一调用。

### 步态设计

```
输入: state, bpm, boneNames
clampedBpm = clamp(bpm, 60, 200)
beatFrames = round((60/clampedBpm)*FPS / speed)   // 复用 autodance 节拍帧
stepCycle  = catwalkStepCadence==='2beat' ? beatFrames*2 : beatFrames
loopFrames = stepCycle * 8                          // 8 个步循环
const LIFT = 0.3;   // 抬腿世界高度系数（相对模型身高），刻意迈步幅度

// 1. 臀部摆动 (groove + waist)
groove.position.x = sin(phase * 2) * hipSway * 0.6   // 左右摆胯
waist.rotation.z   = sin(phase * 2 + π) * hipSway * 0.3

// 2. 刻意迈步 (legIk L/R 交替抬)
legPhaseL = sin(phase)           // 0..1 抬腿
legPhaseR = sin(phase + π)
legIkL.position.y = max(0, legPhaseL) * stepHeight * LIFT
legIkR.position.y = max(0, legPhaseR) * stepHeight * LIFT
// （footIk 同步微抬，避免穿地由 ADR-085 处理）

// 3. 手臂 (对侧摆动 / 静态)
if (armPose==='swing') {
  armL.rotation.x = -legPhaseL * 0.15
  armR.rotation.x = -legPhaseR * 0.15
} else { // posed：肩外展 + 肘微曲固定
  armL.rotation.z = +0.35; armR.rotation.z = -0.35  // 静态优雅
}

// 4. 沿 Z 轴 (Phase A 默认 in-place：center.z 仅做重心前后微移，无净位移)
center.position.z = sin(phase * 2) * 0.02   // 重量转移错觉，非前进
//    Phase B traverse: center.position.z = ramp(0→+D→0) over loopFrames
```

相位 `phase = f / loopFrames * 2π`，与 BPM 帧对齐保证「步」踩在拍点上（开启 `bpmQuantizeEnabled` 时）。

### 状态管理

在 `ProcMotionState` 内新增嵌套配置（mirror autodance 自有字段，不污染顶层）：

```typescript
// proc-motion-shared.ts
export type ProcMotionMode = 'off' | 'idle' | 'autodance' | 'catwalk';

export interface CatwalkParams {
    hipSway: number;        // 0~1
    stepHeight: number;     // 0~1
    stepCadence: 'beat' | '2beat';
    armPose: 'swing' | 'posed';
    traverse: boolean;      // Phase B
}
// 并入 DEFAULT_PROC_STATE: catwalk: { hipSway:0.6, stepHeight:0.5, stepCadence:'2beat', armPose:'swing', traverse:false }
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/motion-algos/proc-motion-shared.ts` | 修改 | `ProcMotionMode` 加 `'catwalk'`；`PROC_VMD_NAME_CATWALK = 'Catwalk'`；`CatwalkParams` 类型 + `DEFAULT_PROC_STATE.catwalk` |
| `frontend/src/motion-algos/proc-motion-catwalk.ts` | **新增** | 主入口 `generateCatwalkVmd(state, bpm, morphNames, boneNames)`：参数计算 + 组装 |
| `frontend/src/motion-algos/proc-motion-catwalk-bones.ts` | **新增** | 骨骼帧生成（groove/waist/legIk/arm/center）+ `buildTrigCache` |
| `frontend/src/motion-algos/procedural-motion.ts` | 修改 | `export { generateCatwalkVmd }` |
| `frontend/src/scene/motion/proc-motion-bridge.ts` | 修改 | `startProcMotion` 增 `catwalk` 分支（与 autodance 分支并列，loadVMDMotion 用 `PROC_VMD_NAME_CATWALK`）；`updateProcMotion` 增 catwalk 启动分支（置于 autodance 分支之后、idle 分支之前）；`regenerateProcMotion` 的 mode 映射增 `catwalk`；import |
| `frontend/src/menus/motion-procmotion-levels.ts` | 修改 | `addModeSlider` 选项增 `catwalk`（程序化动作模式滑块）；`buildProcMotionModeLevel` 列表增 `catwalk` 项 |
| `frontend/src/motion-algos/proc-motion-catwalk.test.ts` | **新增** | 单元测试：臀部摆动符号正确、迈步交替、BPM 步频对齐 |
| `frontend/src/core/i18n/locales/zh-CN.ts` | 修改 | 新增 `motion.modeCatwalk` 等 |
| `frontend/src/core/i18n/locales/{en,ja,ko,zh-TW}.ts` | 修改 | 同上 i18n 键 |

### 菜单结构

```
程序化动作 (mode slider) → 新增选项：猫步 (catwalk)
└─ 猫步参数 [folder]（mode==='catwalk' 时展开）
   ├─ 臀部摆动   [slider 0-1]
   ├─ 迈步高度   [slider 0-1]
   ├─ 步频       [mode: 每拍/每两拍]
   ├─ 手臂姿态   [mode: 摆动/静态]
   └─ 沿Z轴行走  [toggle]（Phase B）
```

---

## 依赖 / 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| **VMD 净位移漂移** | traverse 模式 `center.z` 净前进会瞬移 | Phase A 默认 in-place；traverse 用 0→+D→0 折返或场景级位移 |
| **babylon-mmd 骨骼写入时机** | 生成 VMD 被动画冲掉 | 与 idle/autodance 同路径 `loadVMDMotion` + `setRuntimeAnimation`，已验证 |
| **PMX 骨骼命名差异** | 部分模型无 `グルーブ`/`左足IK` | 回退：`matchBone` 候选列表已覆盖；缺失骨骼跳过该通道（同 autodance `resolveBones`） |
| **BPM 缺失降级** | 无音频时 `getBPM()` 返回默认 120 | 按 `state.speed` 推导慢走，不依赖真实 BPM |
| **与 Feet Adjustment (ADR-085) 叠加** | 抬腿 VMD + 地面 IK 可能冲突 | 优先级：Catwalk 生成意图姿态 → Feet Adjustment 在渲染前做地面约束，顺序已在 ADR-085 定义 |
| **性能** | 每帧 VMD 回放（非实时解算） | 生成一次 VMD 循环播放，零每帧成本，与现有生成器一致 |

---

## 分期

### Phase A（核心猫步）— 预计 1-2 天
1. `proc-motion-shared.ts`：`'catwalk'` 模式 + `PROC_VMD_NAME_CATWALK` + `CatwalkParams`
2. `proc-motion-catwalk.ts` + `proc-motion-catwalk-bones.ts`：臀部摆动 + 刻意迈步 + 手臂 + BPM 步频对齐
3. `proc-motion-bridge.ts`：三处调度分支
4. UI 模式滑块 + i18n
5. 单元测试覆盖步态符号/交替/BPM 对齐

### Phase B（位移与进阶）— 待定
1. `catwalkTraverse`：`center.z` 往返位移
2. `catwalkUTurn`：循环末段转身
3. `'posed'` 手臂静态姿态自定义角度

---

## 相关 ADR

- [ADR-061](adr-061-advanced-bone-systems.md) — Bone Override / 骨骼通道，Catwalk 复用同一骨骼写入路径
- [ADR-037](adr-037-formation-camera.md) — 队形预设 / 运镜，traverse 位移可与之联动
- [ADR-085](adr-085-feet-adjustment.md) — 脚部地面跟随，与 Catwalk 抬腿姿态正交、顺序已定义
- [ADR-079](adr-079-perception-layer-expansion.md) — 感知层（呼吸/眨眼），Catwalk 不应抑制 always-on 感知
- `docs/competitive-analysis.md` — Catwalk 竞品行已登记（MikuMikuAR ❌ / DanceXR ✅）
