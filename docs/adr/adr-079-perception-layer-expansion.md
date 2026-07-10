# ADR-079: 感知层扩展——always-on 实时叠加的适用边界

> **状态**: Phase 1-2 已实施（2026-07-10）；Phase 3 待排期
> **关联**: ADR-071（感知层边界重构，已实施）、ADR-016（视线追踪）、ADR-061（骨骼系统）

---

## 背景

ADR-071 把呼吸/眨眼/头部跟随/眼部跟随从程序化 VMD 生成器迁入 `scene/motion/perception.ts`，验证了 **always-on 实时叠加** 这一代码风格：

- 独立于 VMD 生命周期（不随 `stopProcMotion` 消失）
- 每帧直接计算（无关键帧预生成）
- WASM frontBuffer 直写 + JS `linkedBone` 双路径
- 对象池消除 GC 压力
- 统一 observer 调度（`onBeforeRenderObservable` 注册时序分层）

ADR-071 完成后，感知层覆盖 4 项（呼吸/眨眼/head gaze/eye gaze），但程序化生成器仍保留：

| 生成器 | 当前职责 | 实现方式 |
|--------|---------|---------|
| `proc-motion-idle.ts` | 躯干微晃 + 上肢微动兜底 | VMD 关键帧预生成 |
| `proc-motion-autodance.ts` | 节拍驱动律动 | VMD 关键帧预生成 |
| `proc-motion-lifelike.ts` | 情绪微表情 | VMD 关键帧预生成 |

**核心问题**：这三类功能中，有些在性质上更接近「感知行为」而非「动作编排」——它们应当 always-on，而非寄生在 VMD 生命周期内。ADR-071 因范围聚焦未处理它们，本 ADR 回答「gaze 风格的 always-on 叠加还能应用到哪些程序化动作」。

---

## 候选扩展项

按优先级与「是否符合 always-on 感知语义」分级。

### P1 — 高优先级（符合「角色永远活着」目标）

#### 1. 微表情叠加（替代 lifelike 的情绪 VMD）

- **当前**：`proc-motion-lifelike.ts` 预生成情绪 morph 关键帧 VMD
- **问题**：用户加载任意 VMD 后微表情消失；lifelike 图层与用户 VMD 抢骨骼
- **迁移后**：`_applyMicroExpression(mmdModel, time, emotion)` 实时叠加，emotion 状态可由 UI 或上下文驱动
- **是否符合感知语义**：✅ 微表情是 always-on 的生命体征
- **ADR-071 影响**：**推翻 ADR-071 对 lifelike 的保留定位**——lifelike 将退化为空壳或删除

#### 2. 重心微动（替代 idle 的躯干微晃）

- **当前**：`proc-motion-idle.ts` 预生成躯干 sin 微晃 VMD
- **问题**：用户 VMD 加载后微晃消失；idle 本应是「无动作时的待机感知」而非「动作」
- **迁移后**：`_applyBalanceSway(mmdModel, time)` 实时叠加，模拟站立平衡
- **是否符合感知语义**：✅ 重心微动是 always-on 的平衡感知
- **ADR-071 影响**：idle 退化为纯兜底（仅在无 VMD 且无其他动作时触发），或删除

#### 3. 实时 lip-sync（替代 VMD 关键帧方式）

- **当前**：lipsync 走 VMD 关键帧方式
- **问题**：无法实时响应音频；与用户 VMD 冲突
- **迁移后**：`_applyLipSync(mmdModel, audioAmplitude)` 实时音频振幅 → morph 权重
- **是否符合感知语义**：✅ lip-sync 是 always-on 的语音感知（音频在就张嘴）
- **特殊考虑**：需要音频输入源（`AudioContext` / `AnalyserNode`），感知层需扩展音频接入点

### P2 — 中优先级（增强真实感）

#### 4. 手指微动

- 细微颤动，可叠加在任意 VMD 之上
- 风险：finger 骨骼数量多，性能开销需评估

#### 5. 呼吸胸腔起伏

- 当前呼吸只动躯干骨骼，可扩展胸部骨骼缩放微动
- 与 P1.2 重心微动协同

#### 6. 眨眼节奏变化

- 当前眨眼固定 0.15Hz，可根据情绪状态（紧张→快、放松→慢）调整
- 依赖 P1.1 微表情的 emotion 状态

### P3 — 低优先级（特殊场景）

#### 7. 注视点记忆

- 记录上次 gaze 目标，实现「回忆」「走神」效果

#### 8. 视线回避

- 羞涩/紧张时的视线偏移（与 P1.1 emotion 协同）

#### 9. 瞳孔缩放

- 根据光照/情绪调整（需要 PMX morph 支持，非通用）

---

## 决策

### 已采纳

- **P1 三项纳入感知层扩展路线**，按 1→2→3 顺序推进
- **P2 三项为可选增强**，在 P1 落地后视需求排期
- **P3 三项为远期探索**，不承诺实施

### 关键约束

1. **分层叠加而非互斥**：新增感知项必须采用 gaze 已验证的「读后写 + Slerp/Lerp 叠加」方式，不覆盖既有骨骼写入，而是在其上叠加。参考 [xpbd-ragdoll.ts:102-108](../../frontend/src/physics/xpbd-ragdoll.ts#L102-L108) 的分层注释与 ADR-061 §五.3。

2. **observer 时序**：新增感知项注册到 `perception.ts` 的统一 observer，不另起 observer。ragdoll（启动期注册）→ perception（模型加载时注册）的时序分层须保持。

3. **职责划分非技术禁令**：感知层扩展不意味着「所有程序化动作都必须迁入」。autodance（节拍驱动律动）本质是动作编排，应保留为 VMD 生成器——它的生命周期绑定（用户主动播放舞蹈）是合理的。本 ADR 迁移的是「应当 always-on 的感知行为」，不是「消灭所有程序化生成器」。

4. **性能门禁**：新增感知项不得显著增加每帧开销。对象池、避免 `new`、控制骨骼写入数量是硬约束。P2.4 手指微动若性能不达标则降级或跳过。

5. **可配置**：所有新增感知项必须通过 `PerceptionState` 暴露开关，与现有呼吸/眨眼/gaze 开关一致，支持序列化与 UI 控制。

### 推翻 ADR-071 的定位

- ADR-071 §决策表将 lifelike 定位为「保留情绪微表情 VMD」——本 ADR 推翻该定位，lifelike 微表情迁入感知层后，lifelike 生成器删除或退化为空壳。
- ADR-071 未触及 idle 的躯干微晃——本 ADR 将其迁入感知层，idle 退化为纯兜底或删除。
- ADR-071 未触及 lipsync——本 ADR 将其改为实时叠加。

---

## 迁移路径

### Phase 1：微表情迁移（对应 P1.1）

| 步骤 | 内容 |
|------|------|
| 新增 | `perception.ts` 内 `_applyMicroExpression`，emotion 状态纳入 `PerceptionState` |
| 重构 | `proc-motion-lifelike.ts` 移除情绪 morph 生成，或整体删除 |
| UI | `motion-gaze-levels.ts` 新增 emotion 选择 + 微表情开关 |
| 测试 | `perception.test.ts` 新增微表情叠加测试 |

### Phase 2：重心微动迁移（对应 P1.2）

| 步骤 | 内容 |
|------|------|
| 新增 | `perception.ts` 内 `_applyBalanceSway` |
| 重构 | `proc-motion-idle.ts` 移除躯干微晃，保留上肢微动或整体删除 |
| 测试 | 平衡微动叠加测试 |

### Phase 3：实时 lip-sync（对应 P1.3）

| 步骤 | 内容 |
|------|------|
| 新增 | `perception.ts` 内 `_applyLipSync`，接入 `AudioContext`/`AnalyserNode` |
| 重构 | 现有 lipsync VMD 方式改为实时叠加 |
| UI | 音频源选择 + lip-sync 开关 |
| 测试 | 音频振幅 → morph 权重测试 |

---

## 风险

1. **lifelike/idle 删除的兼容性**：现有存档若引用 lifelike/idle 图层，删除后需迁移逻辑。参考 ADR-071 的 `procMotion → perception` 旧存档迁移模式。

2. **autodance 边界澄清**：autodance 保留为 VMD 生成器，但若用户期望「节拍感知也 always-on」（如用户 VMD 播放时仍随节拍微动），则需重新评估。当前决策：autodance 不迁。

3. **emotion 状态来源**：P1.1 微表情的 emotion 由谁驱动？UI 手动选择 / 上下文推断 / 音频分析？需在 Phase 1 设计时确定。

4. **性能回归**：感知层从 4 项扩展到 7+ 项，每帧开销叠加。需在 Phase 1 后做性能基准测量。

---

## 与 ADR-071 的关系

- ADR-071 解决「呼吸/眨眼/gaze 寄生在 VMD 生命周期」的核心矛盾，范围已落地。
- 本 ADR 是 ADR-071 的**延伸**，把 always-on 叠加风格扩展到更多感知行为，并推翻 ADR-071 对 lifelike/idle 的保留定位。
- ADR-071 的「程序化生成器退化为微晃兜底」方向在本 ADR 中进一步推进——idle/lifelike 兜底职责也被迁入感知层。

---

## 相关 ADR 索引

- [ADR-071](adr-071-proc-vs-perception-boundary.md) — 感知层边界重构（本 ADR 的前置）
- [ADR-061](adr-061-advanced-bone-systems.md) — 骨骼系统（§五.3 头部骨骼分层写入）
- [ADR-016](adr-016-gaze-tracking.md) — 视线追踪（gaze 风格的起源）
- [ADR-021](adr-021-procedural-motion.md) — 程序化动作（idle/autodance/lifelike 的起源）

---

## 实施记录

### Phase 1: 微表情迁移（2026-07-10）

- ✅ `PerceptionState` 扩展 `emotion` + `microExpressionEnabled`（commit 9e3aefb）
- ✅ `_applyMicroExpression` 实时叠加实现（commit 9d4e2ee）——周期性 sin² 脉冲，4s 周期，0.12 峰值；morph API 与 `_applyBlinking` 一致（`morphTargetManager` + `getMorphTargetByName` + `.influence`）
- ✅ `proc-motion-lifelike.ts` 移除 emotion morph 生成（commit 44fd0c6）；emotion category 保留（autodance 仍使用）
- ✅ 序列化扩展 + `migratePerceptionFromProcMotion` 导出 + 旧存档迁移（commit 0f4c8c6）；`boneToggles.emotion`（boolean）→ `microExpressionEnabled`，`emotion` 恒为 `neutral`
- ✅ UI 接入：motion-gaze-levels 新增微表情开关 + 情绪 5 选（commit 27f8f62）；i18n `motion.xxx` 命名空间 7 键 5 语言
- ✅ `setMicroExpressionEnabled` / `setEmotion` 独立 setter（与 `setBreathEnabled` 同款）
- ✅ 测试：1282 passed（2 个既有 scene-ragdoll-wiring 失败非本 Phase 引入）

### Phase 2: 重心微动迁移（2026-07-10）

- ✅ `PerceptionState` 扩展 `balanceSwayEnabled`（commit a290027）
- ✅ `_applyBalanceSway` 实时叠加实现（commit fb3f433）——4 骨骼：center/upper2/waist/allParent；rotation Slerp + position Lerp；period 2s；关闭时 position.y 复位
- ✅ `proc-motion-idle.ts` 移除躯干微晃生成块（commit dd58423）——手臂/肩膀/手腕保留；4 变量声明 + 4 import 清理；测试更新
- ✅ 序列化扩展 + `migrateBalanceSwayFromProcMotion`（commit 4a38251）——`boneToggles.center/upper2/waist/allParent` 任一 true → `balanceSwayEnabled: true`
- ✅ UI 接入：motion-gaze-levels 新增重心微动开关（commit 1a560cd）——i18n 5 语言同步
- ✅ 测试：1297 passed（无新增失败）
