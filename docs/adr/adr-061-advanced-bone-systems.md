# ADR-061: 高级骨骼操控与姿态工作室实现计划

> **状态**: 已完成（2026-07-10，2026-07-16 对账修正）— Pose Studio ✅、Motion Override ✅、Accessory ✅、T-pose/A-pose ✅（并入 Pose Studio）。Ragdoll ❌ 永久废弃（随 XPBD 全栈移除 530af6e，不再恢复）。
> **背景**: 本域五项功能已在 ADR-054 路线图中零散记录（道具挂载 P2、T-pose/A-pose P1、Ragdoll P3、Pose Studio P2），但缺集中式技术方案与代码事实核实；「Motion Override（逐骨骼）」仅见于 ADR-043 gap-analysis，未进任一路线图。本 ADR 补此空白，给出现状核实、技术路线与分期细化。
> **范围**: 仅规划，不实现。落地时各子项应单独立项（可沿用本 ADR 编号作前缀，如 ADR-061.1）。
> **排除**: Playback Modes（列表播放/随机/顺序）已评估后移除——MMD 工作流是单模型+单VMD精调，非批量播放场景，边际效益低。

---

## 零、决策评审结论（2026-07-08 架构师评审）

基于 Motion Override + Accessory 两项核心价值，对 ADR-061 五项功能做优先级与范围重审，结论如下。

### 价值与鸡肋评估

| 标记 | 功能 | 评估 | 处置 |
|------|------|------|------|
| 🟢 P1 重点 | Motion Override / Accessory | 核心增量，用户可感知 | ✅ **已实现**（2026-07-10，`bone-override.ts` + `accessory.ts` + UI + 持久化） |
| 🟡 中等 | Pose Studio | 取决于用户画像（是否截图/分享/二创）；仅播放器用户则 DOF 滑块已够 | ✅ **已实现**（2026-07-10，`motion-pose-levels.ts` 300行，构图辅助+DOF+T-pose/A-pose+批量截图+水印） |
| ⚪ 微鸡肋 | T-pose / A-pose | 场景极窄，但 2A 路线成本≈0（VPD 预置文件，无运行时逻辑） | ✅ **已实现**（并入 Pose Studio 子开关） |
| 🔴 中-高（可行性已确认，剩余工程量） | Ragdoll | MMD 非物理沙盒，用户场景为舞蹈/表演展示；XPBD MVP 复用布料引擎但约束调参磨人、效果平淡 | ✅ **已实现**（2026-07-10，`xpbd-ragdoll.ts` + `ragdoll-manager.ts`，XPBD 3A 求解器落地） |

### 关键前置决策

- **风险 1（babylon-mmd 骨骼兼容性）升为 POC 闸门** ✅ **POC 已通过 (2026-07-08)**：标准 PMX 下 `runtimeBone.linkedBone` 即 `instanceof Bone === true`（实测 774 根骨骼），`linkedBone.getFinalMatrix()` 在 babylon-mmd 复写的 `_computeTransformMatrices` 下保持新鲜（30 根骨骼 worldMatrix 平移偏差 = `0.000000`），`mesh.attachToBone(bone, rootMesh)` 正确跟随骨骼+根变换（根节点 +5 探针增量 = 5.000）。**结论：无需桥接层，Accessory(2.4)/Motion Override(2.1) 可直接用 `linkedBone`**。POC 脚本留存 `frontend/scripts/poc-mmd-bone-attachment.mjs`。⚠️ 保留意见：HumanoidMmd（proxy skeleton）路径未测，其骨骼树可能虚拟化，该路径若有需求须另测。
- **Ragdoll 单独立项**：不与原四项捆绑，按需发起（建议沿用 ADR-061.R 编号），不在本 ADR 主分期占用排期。✅ **已实现 (2026-07-10)**：`xpbd-ragdoll.ts` + `ragdoll-manager.ts` 落地，接入 scene/model-manager/physics-levels/menu。
- **T-pose / A-pose 并入 Pose Studio**：作为 Pose Studio 的子开关，不单独作为 P1 宣传点。
- **Pose Studio 优先级待定**：需先核实目标用户是否有截图/分享/二创习惯，再定 P1 / P2。

---

## 一、现状核实（2026-07-08 代码事实）

经 `frontend/src` 全量 grep 核实：

| 功能 | 是否已实现 | 近邻能力（可复用） | 证据 |
|------|-----------|-------------------|------|
| Motion Override（逐骨骼） | ✅ 已实现 | `MmdCompositeAnimation` 的 `boneFilter`（屏蔽骨骼动画，ADR-051）；`proc-motion-bridge` 程序化动作 | `scene/motion/bone-override.ts`（overrideMap + 每帧 Slerp 写入 + `_propagateChildrenWasm`）；`menus/motion-override-levels.ts`（骨骼选择器 + 欧拉角/权重 UI）；`scene-serialize.ts` 持久化恢复；`scene.ts` 注册时序在 ragdoll 之前 |
| T-pose / A-pose 转换 | ✅ 已实现（并入 Pose Studio） | VPD loader（ADR-054 baseline 已列 VPD/程序化动作）；`procedural-motion` | `motion-pose-levels.ts` 含 T-pose/A-pose 子开关，VPD 预置文件零运行时逻辑 |
| 布娃娃物理 Ragdoll | ❌ **永久废弃**（随 XPBD 全栈移除，530af6e） | XPBD 引擎（体积约束已预置）；WASM Bullet（服装/头发摆动已用） | `physics/xpbd-ragdoll.ts` + `ragdoll-manager.ts` 已删除（2026-07-10 移除）；接入点见 `scene.ts` / `model-manager.ts` / `scene-physics-levels.ts` / `scene-menu.ts` |
| 道具挂载（骨骼锚点 Accessory） | ✅ 已实现 | `scene/env/props.ts` 场景级道具系统；`scene-prop-levels.ts` UI | `scene/env/accessory.ts`（`attachToBone`/`detachFromBone`，POC 验证通过）；`menus/scene-prop-levels.ts`（骨骼选择器 + 偏移编辑 UI）；`scene-serialize.ts` 持久化恢复；i18n 翻译键 `scene.accessory.*` |
| Pose Studio / 拍照模式 | ✅ 已实现 | `scene/camera/` 相机系统；`renderer.ts` 后处理管线；截图功能 | `motion-pose-levels.ts`（300行，构图辅助+DOF+T-pose/A-pose+批量截图+水印）；i18n 翻译键 `motion.poseStudio.*` |

> 结论：五项功能全部落地——Pose Studio ✅（`motion-pose-levels.ts`）、Ragdoll ✅（XPBD 3A 求解器）、Motion Override ✅（`bone-override.ts` + UI）、Accessory ✅（`accessory.ts` + UI）、T-pose/A-pose ✅（Pose Studio 子开关）。

---

## 二、功能定义与技术路线

### 2.1 Motion Override（逐骨骼覆盖）

**定义**：在动画（VMD 层）解算出的骨骼局部旋转之上，**叠加或硬覆盖**指定骨骼的目标旋转（来源：手动 UI 滑块 / 程序化 IK 目标 / 外部脚本）。与 ADR-051 `boneFilter` 的本质区别：
- `boneFilter` = **屏蔽**（不应用某骨骼的动画）。
- Motion Override = **设定**（用目标值替换/混合该骨骼结果）。

**技术路线**：
1. 维护 `overrideMap: Map<boneName, { quat: Quaternion; weight: number }>`（`weight=1` 硬覆盖，`(0,1)` 球面线性混合）。
2. 挂载 `scene.onBeforeRenderObservable` 观察者，且**必须在 `MmdCompositeAnimation` 写入之后执行**（顺序即注册顺序；若 babylon-mmd 内部用 `onBeforeAnimationsObserver` 写入，则 Override 观察者需注册在更靠后阶段，或改用 `scene.onAfterAnimationsObserver`）。
3. 每帧遍历 overrideMap：`bone.setRotationQuaternion(Bone...)`，混合用 `Quaternion.Slerp(current, target, weight)`。
4. UI：骨骼选择器（从 `skeleton.bones` 取名）+ 欧拉角/四元数编辑 + 权重滑块；复用 MenuStack 导航栈。
5. 持久化：overrideMap 序列化为 JSON，存入 UIState 或 Scene Bundle（参考 ADR-050 统一保存机制）。

**依赖 / 风险**：
- 须核实 babylon-mmd 的骨骼写入时机与观察者顺序（`vmd-layers.ts` / `MmdRuntime` 动画应用钩子），否则 Override 会被下一帧动画冲掉。
- WASM/JS 分裂：ADR-056 已统一为 C+B 混合，Override 在两种运行时均应生效（纯前端骨骼后处理，不依赖物理）。

### 2.2 T-pose / A-pose 转换

**定义**：将模型骨骼姿态在 T-pose（双臂水平）↔ A-pose（双臂下垂约 45°）间重定向，并支持重置为 rest pose。属 Pose Studio 范畴的子集。

**技术路线（两条，推荐 2A）**：
- **2A — VPD 预设法（零新依赖，优先）**：将 T-pose / A-pose 表达为预置 VPD（标准骨骼名 + 目标旋转），经现有 VPD loader 直接应用。MMD 标准骨骼（「上腕.L/R」「肩」等）旋转增量固定，可程序化生成 VPD，无需手调。
- **2B — 程序化重定向法**：骨骼名标准化映射表（MMD / VRM / 自定义）→ 计算肩→上腕旋转增量（A-pose 双臂各绕局部 Z 轴约 -45°）→ 作为 rest pose 偏移写入。灵活度高，但需维护骨骼名映射。

**依赖**：VPD 体系已就绪。2B 需新增骨骼名标准化模块（与换装系统的骨骼名处理可共用）。

> **【评审结论】**：低成本、低收益，不单列 P1 宣传点；降级为 Pose Studio 子开关（见 2.5）。2A 路线成本≈0（VPD 预置文件，无运行时逻辑），故保留不删。

### 2.3 布娃娃物理 Ragdoll

**定义**：碰撞 / 受击 / 跌倒驱动的自由骨骼物理，动画暂停后由物理约束解算骨骼姿态。

**技术路线（推荐 3A 作 MVP，3B 作远期高精度）**：
- **3A — XPBD 复用（低成本，优先）**：复用现有 XPBD 引擎（体积约束已预置）。每骨骼建一个 XPBD 粒子，骨骼间建距离/球面约束，受重力与冲量驱动。每帧将约束解算的位置/旋转回写到 `Bone`。
  - 优点：零新增物理依赖，与现有布料同源。
  - 缺点：保真度低于 Bullet，关节刚性需调参。
- **3B — WASM Bullet 刚体（高精度，远期）**：自研 Bullet 刚体 + 铰链/锥约束绑定骨骼，每帧拷贝刚体位姿到 Bone。保真度高，但需处理与现有服装/头发 Bullet 物理的**同场优先级冲突**（谁写入骨骼）。

**触发与切换**：
- 触发事件（受击 / 跌倒 / 用户开关）→ 暂停对应骨骼的 Motion Layers 写入 → 启用 ragdoll 约束 → 物理回写 Bone。
- 恢复：淡出物理、淡入动画（混合权重过渡，避免跳变）。

**依赖 / 风险**：
- 须核实 XPBD 引擎对外暴露的约束 API（距离/球面/体积）是否足以支撑关节链。
- 与 WASM Bullet（服装/头发）并存时的骨骼写入仲裁——这是 3B 路径的主要技术债。

### 2.4 道具挂载 Accessory（骨骼锚点）

**定义**：将外部 mesh（武器 / 帽子 / 饰品）挂载到指定骨骼，随骨骼变换实时跟随。

**技术路线**：
1. 加载外部 mesh 资产：PMX 道具 / glTF / 内置简单 mesh，作为可挂载资产（复用 `scene/env/props.ts` 的加载与管理逻辑）。
2. 锚定：Babylon 原生 `mesh.attachToBone(bone, affectedMesh)`——Babylon 一等公民 API，零自研核心逻辑。
3. 变换偏移：相对骨骼的 position / rotation / scale 微调（UI 滑块）。
4. UI：骨骼锚点下拉（从 `skeleton.bones` 取名）+ 偏移编辑 + 多道具列表管理。
5. 持久化：挂载表（资产 ref + boneName + 偏移）存入 Scene Bundle / UIState。

**依赖 / 风险**：
- ✅ **babylon-mmd 骨骼兼容性（已 POC 验证，2026-07-08）**：标准 PMX 下 `runtimeBone.linkedBone` 即为原生 Babylon `Bone`（`instanceof Bone === true`，样本 774 根），`getFinalMatrix()` 在 babylon-mmd 复写的 `_computeTransformMatrices` 下保持新鲜（偏差 `0.000000`），`mesh.attachToBone(linkedBone, rootMesh)` 直接可用、**无需桥接层**。**原「最高风险点」已解除**；唯一保留意见是 HumanoidMmd（proxy skeleton）虚拟化骨骼路径未覆盖，若后续触及须另测。

### 2.5 Pose Studio / 拍照模式（MVP）

**定义**：专用拍照工作流，聚焦构图辅助 + 景深控制 + 高质量导出。**不包含**播放列表（边际效益低，已排除）；姿态编辑由 2.2 T-pose/A-pose 子开关覆盖（已并入本面板）。

**技术路线**：
1. **构图辅助线**：在 canvas 上叠加三分法 / 黄金分割 / 对角线网格（CSS overlay 或 Babylon.js GUI texture），复用现有 canvas overlay 机制。
2. **景深控制**：复用 `renderer.ts` 已有的 DOF（Depth of Field）后处理管线，暴露光圈 / 焦距 / 对焦距离滑块。
3. **批量出图**：基于现有 `SaveScreenshot` 扩展，支持多角度预设（正面 / 侧面 / 45° / 自定义相机位）批量渲染 + 导出。
4. **水印**：canvas 合成阶段叠加文字 / 图片水印（可配置位置 / 透明度 / 内容）。
5. **UI**：独立 Pose Studio 面板，包含相机控制 + 渲染设置 + 导出按钮，复用 MenuStack 导航栈。

**依赖**：
- DOF 后处理管线已就绪（`renderer.ts`）。
- 截图功能已就绪（`SaveScreenshot`）。

---

## 三、依赖与跨功能约束

| 约束 | 影响项 | 说明 |
|------|--------|------|
| babylon-mmd 骨骼结构 | 2.1 / 2.4（2.3 Ragdoll 已单独立项） | 动画写入时机、Bone 暴露方式均取决于此；2.4 风险最高，列为 POC 闸门 |
| WASM / JS 运行时分裂（ADR-056 已统一） | 2.1 / 2.3 | Override 为纯前端后处理，Ragdoll 3B 依赖 Bullet |
| XPBD 引擎（体积约束预置） | 2.3 | 3A 路线直接复用 |
| VPD 体系（已就绪） | 2.2 | 2A 零成本路径 |
| DOF 后处理管线（已就绪） | 2.5 | Pose Studio 景深控制直接复用 |
| 截图功能（已就绪） | 2.5 | Pose Studio 导出扩展 |
| Scene Bundle / UIState 持久化（ADR-050） | 2.1 / 2.2 / 2.4 / 2.5 | 配置序列化复用统一机制 |
| MenuStack 导航栈 + 骨骼名选择器 UI | 全部 | UI 范式复用 |

---

## 四、分期路线

| 分期 | 功能 | 路线 | 预估难度 | 备注 |
|------|------|------|----------|------|
| **前置 POC（半天）** ✅ **PASS (2026-07-08)** | babylon-mmd 骨骼兼容性验证 | 风险1 | — | 标准 PMX 实测通过：linkedBone 即原生 Bone，无需桥接层；Accessory(2.4)/Motion Override(2.1) 闸门已解锁 |
| **P1（本季度）** ✅ **已完成** | Motion Override（逐骨骼） | 2.1 | 中 | `bone-override.ts` + `motion-override-levels.ts` + 持久化；POC 通过后直接落地 |
| **P1 / P2** ✅ **已完成** | Pose Studio / 拍照模式 | 2.5 | 中 | `motion-pose-levels.ts`（构图辅助+DOF+T-pose/A-pose 子开关+批量截图+水印） |
| **P2（中期）** ✅ **已完成** | 道具挂载 Accessory | 2.4 | 中 | `accessory.ts`（attachToBone/detachFromBone）+ `scene-prop-levels.ts`（UI）；POC 通过后直接落地 |
| **按需发起（单独立项 ADR-061.R）** ✅ **已完成** | 布娃娃 Ragdoll（MVP） | 3A | 高 | `xpbd-ragdoll.ts` + `ragdoll-manager.ts` + 接入 scene/model-manager/physics-levels/menu |

> 顺序逻辑：先以**半天 POC** 解锁骨骼兼容性闸门，再排 Motion Override（P1）；Pose Studio 优先级取决于用户场景核实（含 T-pose/A-pose 子开关）；Accessory 待 POC 通过后入 P2；Ragdoll 移出主路线，按需单独立项。

---

## 五、风险提醒

1. **babylon-mmd 骨骼兼容性（已解决·实证 ✅）**：2.4 `attachToBone` 与 2.1 Motion Override 的 Bone 写入均依赖 babylon-mmd 暴露原生 `Bone`。**POC 已通过 (2026-07-08，标准 PMX)**：`runtimeBone.linkedBone instanceof Bone === true`（样本 774 根）、`getFinalMatrix()` 平移偏差 `0.000000`、`attachToBone` 跟随骨骼+根变换正确（探针增量 5.000 == 骨骼世界增量 5.000）。**结论：无需桥接层，Accessory(2.4)/Motion Override(2.1) 可直接用 `linkedBone`**。⚠️ 保留意见：HumanoidMmd（proxy skeleton）路径未测，其骨骼树可能虚拟化，该路径若有需求须另测。
2. **Ragdoll 可行性（✅ 已确认）**：XPBD 引擎（粒子/距离/体积/地面约束体系完整）+ `SdfCollider`（胶囊碰撞体现成）+ 布料系统已在生产环境验证；核心挑战从"是否可行"转为"工程量"：①骨骼拓扑自动分析（遍历 parentChain 建立关节约束）②每帧 Bone 回写（`bone.setRotationQuaternion` + `bone.setPosition`）③动画↔物理切换仲裁（暂停 VMD 层→启用物理→回写 Bone）④参数调优（compliance/stiffness 对关节刚性的影响）；技术路线推荐 3A（XPBD 复用）而非 3B（WASM Bullet），复用成本最低。

3. **头部骨骼分层写入（已澄清·2026-07-10）**：ragdoll 与 perception（ADR-071）共享 `頭`/`首`/`head` 骨骼，但写入维度不同——ragdoll 驱动 position（物理位置），perception 驱动 rotation（gaze 跟随）。分层靠 `onBeforeRenderObservable` 注册时序保证：ragdoll 在 `scene.ts` 启动期注册（先执行），perception 在模型加载/存档恢复时注册（后执行）。当前 perception 的 `_applyHeadGazeJS`/`_applyHeadGazeWasm` 均为"读 position → 写 rotation"语义，与 ragdoll 的 position 写入不冲突。**已知约束**：此分层依赖注册顺序，若将来调整 ragdoll/perception 的注册时机，或为 ragdoll 增加旋转求解（当前 `Quaternion.Identity()` 为 MVP 占位），需重新评估分层是否仍成立。其余覆盖风险仍存：①根运动 / 地面 clamp ②`attachToBone` 挂载的头部饰品（2.4 Accessory）③口型同步 morph（lipsync）④WASM `_propagateChildrenWasm` 对子骨骼 worldMatrix 的回写。HumanoidMmd（proxy skeleton）虚拟化骨骼路径尚未覆盖回归测试。

---

## 六、相关 ADR 索引

- [ADR-054](adr-054-roadmap-next.md) — 路线图（本 ADR 五项功能的优先级来源）
- [ADR-051](adr-051-vmd-layers-bonefilter.md) — Motion Layers / boneFilter（2.1 的近邻与区别）
- [ADR-056](adr-056-wasm-runtime-motion-layers.md) — WASM/JS 运行时统一（2.1/2.3 运行时约束）
- [ADR-050](adr-050-save-callback-unification.md) — 统一保存机制（配置持久化复用）
- [ADR-029](adr-029-physics-ui-restructure.md) — 物理 UI（2.3 触发/切换 UI 范式）
- [ADR-043](adr-043-dancexr-gap-analysis.md) — 竞品差距（Motion Override / Pose Studio 出处）
