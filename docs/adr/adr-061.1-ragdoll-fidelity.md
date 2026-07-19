# ADR-061.R: Ragdoll 保真度补齐（球面关节 + 旋转求解 + 暂停/过渡仲裁 + 关节参数化）

> **状态**: 已交付（2026-07-10）— ①④③ 全部实施完成，14 个 TDD Task 全绿（1351 测试 + tsc 零错误）。③ 方案修订：boneFilter 不可运行时暂停基础 VMD，改用 blendWeight Slerp 混合。
> **背景**: ADR-061 Ragdoll MVP 已落地（`xpbd-ragdoll.ts` + `ragdoll-manager.ts`），代码审计确认骨架可行 ✅ 但保真度属 MVP 占位 ⚠️：仅 `distance` 约束、旋转强制 `Identity`、仲裁靠 observer 时序"覆盖"而非"暂停"、关节参数硬编码。本立项补齐 ①③④，把布娃娃从"覆盖式 limp"升级为"真物理布偶 + 平滑切换"。
> **范围**: 仅实施下述 ①③④（② 碰撞体调参已在 MVP 完成，排除）。
> **关联**: ADR-061 §五.2 四项挑战；代码审计结论（m0013）。

---

## 零、决策评审结论（2026-07-10）

- **球面关节约束类型 = 扩展 `XpbdSolver` 新增 `'sphere'` 类型**（已与架构师确认）。
  理由：`XpbdSolver` 当前约束类型联合仅 `'distance' | 'bend' | 'volume' | 'ground'`（`xpbd-solver.ts:29`），**无球窝关节**。字面"复用现有约束类型"不可行——正确读法是**复用其约束框架与求解循环，新增 `'sphere'`（3-DOF 角向限位）类型**，而非照搬不存在的类型。

### 0.1 实施前阻塞核实（须先于对应子项完成）

- **`XpbdParticle` 角向状态缺口（阻塞 ① · ✅ 已核实 2026-07-10）**：`xpbd-solver.ts:15-26` 实测字段仅 `p/prevP/v/invMass/radius`，**确无** `orientation/invInertia/angularVelocity`；`XpbdConstraint.lambda`（`xpbd-solver.ts:41`）为 `Float32Array` 标量；`ConstraintType`（`xpbd-solver.ts:29`）联合仅 `distance|bend|volume|ground`，无 `sphere`。→ 缺口真实，须先扩粒子角向状态 + 新增 `'sphere'` 类型 + 角向求解方可进入 ①。决策已定（§2.1）：(a) 粒子扩 `orientation` + `invInertia`；(b) λ 维度 swing 2D + twist 1D 分解复用标量 λ。**阻塞解除，可进入 ① 实现。**
- **暂停边界 + perception 共存（阻塞 ③ · ✅ 已核实 2026-07-10）**：`writeBack`（`xpbd-ragdoll.ts:266` JS / `:290` WASM）对**所有非跳过骨骼（含 head）**写 `Quaternion.Identity()`；head 旋转靠 perception 晚注册于 `onBeforeRenderObservable` 覆写保留（gaze 优先），依注册时序成立。暂停 = 关 ragdoll observer → VMD/perception 正常接管，handoff 干净。→ 缺口真实（"隐性时序依赖"），① 写真实 rotation 后须显性划界。决策已定（§2.2）：ragdoll 默认不写 head `rotationQuaternion`，保留 perception 优先；如需 head 物理化经混合而非覆写。**阻塞解除，可进入 ③ 实现。**
- **babylon-mmd 骨骼写入钩子核实（阻塞 ③ · ✅ 已核实 2026-07-10）**：`babylon-mmd/esm/Runtime/mmdRuntime.js:324-325` 与 `mmdWasmRuntime.js:464-465` 实测双钩注册——`onBeforeAnimationsObservable.add(_beforePhysicsBinded)`（写 VMD 骨骼变换，较早）+ `onBeforeRenderObservable.add(_afterPhysicsBinded)`。我们的 ragdoll observer 在 `scene.ts:298` 的 `onBeforeRenderObservable`（严格晚于）→ 覆盖 VMD 成立。→ 钩子已知且位置正确，仲裁依赖成立；实施期须保持 ragdoll 在 `onBeforeRenderObservable` 以维持覆盖语义。**核实通过，非实施风险。**

---

## 一、现状核实（代码事实）

| 项 | 状态 | 证据 |
|----|------|------|
| ① 拓扑 | 仅 `distance` 约束，球面关节缺 | `xpbd-ragdoll.ts` `buildRagdoll` 沿 `parentBone` 建 distance（`compliance=0, stiffness=1` 硬编码）；`xpbd-solver.ts:29` 无 `sphere` |
| ② rotation 回写 | `Identity` 占位 | `xpbd-ragdoll.ts` `writeBack`：`linked.rotationQuaternion = Quaternion.Identity()` |
| ③ 仲裁 | 靠 `onBeforeRenderObservable` 注册时序"覆盖" VMD，无暂停/过渡 | `scene.ts:298` ragdoll 注册于 `startBoneOverride` 之后；无 Motion Layer 暂停 + 混合权重过渡 |
| ④ 关节参数 | 硬编码，无运行时入口 | `xpbd-ragdoll.ts` 约束构造 `compliance/stiffness/damping` 字面量 |
| ★ debug 可视化 | 原空壳，现已接入（**前置已交付**） | `ragdoll-manager.ts` 已镜像 `cloth-manager` 范式，`_syncDebugUpdateFn` 填实，接入 `XpbdRenderer`；36 测试 + tsc 全绿 |

---

## 二、实施范围与技术方案

### 2.1 ① 球面关节 + 旋转求解（核心）

**目标**：骨骼间除 `distance`（保长）外，补 `sphere` 球窝关节（3-DOF 角向限位），并让 `writeBack` 输出真实旋转而非 `Identity`。

**技术方案**：
1. `xpbd-solver.ts`：约束类型联合新增 `'sphere'`；新增 `XpbdSphereConstraint` 接口（`indices=[parent, child]`，含限位圆锥半角 `coneHalfAngle`、twist 范围 `twistRange`、`compliance/stiffness/damping`）；`step()` 新增 `case 'sphere'` 与 `_solveSphereConstraint`，实现 XPBD 球窝约束（基于相对旋转的四元数误差 → 角向 λ 修正，对称化到两端 `invInertia`——**角度约束，非位置约束**，不能复用 `invMass` 对称化）。
2. `xpbd-ragdoll.ts` `buildRagdoll`：沿 `parentBone` 建 `distance` 之外，为每对相邻骨骼补建 `sphere` 约束（复用骨骼 rest 姿态预计算 rest 相对四元数作为约束目标）。
3. `writeBack`：由 `position + Identity` 升级为 `position + 由 solver 解出的 child 相对父四元数`（JS 写 `rotationQuaternion`；WASM 直写 `worldMatrix` 并 `_propagateChildrenWasm` 传播）。旋转来源 = `sphere` 约束累积的姿态修正。

**设计决策（待 §0.1 核实后定稿）**：
- **λ 维度**：推荐将球面约束分解为 **swing（2D，锥面内摆动）+ twist（1D，绕轴扭转）** 两个子约束，各自复用现有标量 `lambda`（`Float32Array(1)`），避免引入 3D λ 数组与新的数据结构。
- **限位策略**：默认**软约束**（`compliance > 0`，XPBD 自然求解到限位附近）+ **硬 clamp 兜底**（违反 `coneHalfAngle`/`twistRange` 时强制投影回锥面），兼顾稳定与自然。
- **粒子角向状态**：`XpbdParticle` 需扩 `orientation: Quaternion` 与 `invInertia`（或简化为"球面质点"假设：仅追踪 child 相对 parent 的四元数误差，不维护完整惯性张量）。由 §0.1 决策确定。
- **与 `bend` 的关系**：现有 `bend` 实为"跳过中间点的距离约束"（路由至 `_solveDistanceConstraint`，纯位置），**非角向约束**，不能复用其求解逻辑；`sphere` 是独立新数学。

### 2.2 ③ 暂停/过渡仲裁

**目标**：把"覆盖式"改为"暂停 VMD 对应骨骼写入 + 物理回写 + 恢复时混合权重过渡"，消除对 observer 时序的脆弱依赖。

**技术方案**：
1. ragdoll 启用时：对参与 ragdoll 的骨骼集合，经 Motion Layer 控制（参考 ADR-061 §2.1 的 `boneFilter` 屏蔽机制）暂停其 VMD 动画写入；物理回写照常。**head 特殊处理（见 §0.1 决策）：默认 ragdoll 不写 head 的 `rotationQuaternion`，保留 perception 的 gaze 写入优先；若需 head 物理化，须经混合而非互相覆写。**
2. 恢复动画时：引入 `blendWeight`（0→1 缓动）在物理姿态与动画姿态间 `Quaternion.Slerp` 混合，经 N 帧淡入，避免突变。
3. 仍保留 `onBeforeRenderObservable` 回写时序作为兜底，但主路径为显式暂停 + 混合，不再"依赖"其覆盖语义。

### 2.3 ④ 关节约束参数化

**目标**：把硬编码的 `compliance/stiffness/damping` 暴露为可调参数，复用 `XpbdSolver` 约束既有参数字段。

**技术方案**：
1. `xpbd-ragdoll.ts`：约束构造从字面量改为读取 **per-joint / 关节组** 调参表（按骨骼名或关节组 `spine/shoulder/elbow/neck` 索引，`distance`/`sphere` 各自 `compliance/stiffness/damping` + `sphere` 专属 `coneHalfAngle/twistRange`）。真实人体各关节限位差异巨大（肩 ≈90°、肘 twist≈0°），**全局统一调参无意义**。
2. `ragdoll-manager.ts`：暴露 `setRagdollJointParams(jointName | group, params)`（或 `applyRagdollJointPreset(group, preset)`）写入 `envState`，供 UI/调试；提供按关节组的预设（loose / normal / stiff）。
3. `XpbdSolver` 约束已在 `distance`/`sphere` 持有这些字段，无需新增框架——纯"填参数"改造。

---

## 三、验收标准

- [ ] `XpbdSolver.step()` 含 `'sphere'` case 与 `_solveSphereConstraint`，单测覆盖球窝约束收敛与限位。
- [ ] **数值稳定性量化**：单摆/链测试 10s 能量漂移率 < 阈值（阈值待 §0.1 定），验证 swing+twist 分解无抖动。
- [ ] ragdoll 测试模型在"暂停 VMD + 物理驱动"下，骨骼姿态非 `Identity`（旋转被解算）。
- [ ] 启用 ragdoll 时 VMD 对应骨骼写入被显式暂停（非仅靠时序覆盖）；关闭时 N 帧混合过渡无明显突变。
- [ ] **perception 回归**：ragdoll 启停期间 head gaze 不抖动/不丢失（head rotation 划界按 §0.1 / §2.2 决策）。
- [ ] `setRagdollJointParams(jointName | group, params)` per-joint / 关节组调参生效，`envState` 可持久化恢复。
- [ ] 现有 36 ragdoll 测试 + `tsc` 保持绿。
- [ ] debug 可视化（粒子/约束/碰撞体）在真实场景下渲染；补一条"`sphere` 约束也分色显示"的验证（`xpbd-renderer.ts` `updateConstraints` 当前跳过非 distance/bend，需覆盖 `sphere`）。

---

## 四、排除

- **② 碰撞体调参**：MVP 已完成（`SdfCollider` `setRagdollCollider*` 全暴露 + autoFit），不在本 R 范围。
- **HumanoidMmd（proxy skeleton）虚拟化骨骼路径**：ADR-061 保留意见，本 R 不覆盖，除非后续需求。
- **布料/软体复用 `sphere`**：仅 ragdoll 受益，不强制 `cloth-manager` 改造。

---

## 五、风险

- **sphere 约束求解稳定性**：需调 `damping`/迭代次数避免抖动；经单测 + 真实 PMX 验证。
- **暂停 VMD 写入钩子**：已升级为 §0.1 实施前阻塞核实（须先于 ③ 完成），此处不再列为实施期风险。

---

## 六、交付进度

| 子项 | 状态 | 备注 |
|------|------|------|
| §0.1 三道阻塞核实 | ✅ 已完成 | `XpbdParticle` 角向缺口 / 暂停+perception 共存 / babylon-mmd 钩子 均于 2026-07-10 实测核实，gating 解除 |
| 前置：debug 可视化接入 `XpbdRenderer` | ✅ 已完成 | `ragdoll-manager.ts` 镜像 `cloth-manager` 范式，36 测试 + tsc 绿 |
| ① 球面关节 + 旋转求解 | ✅ 已完成 | `XpbdParticle` 角向扩展 + `sphere` 约束 + 纯 TS 四元数运算 + `_solveSphereConstraint`（swing 2D + twist 1D 分解）+ `buildRagdoll` 补 sphere + `writeBack` 真实旋转 + head 划界 + renderer 分色（绿）。commit 94a6d86→d91c1ff |
| ③ 暂停/过渡仲裁 | ✅ 已完成 | **方案修订**：boneFilter 不可运行时暂停，改用 `blendWeight`（0→1）Slerp 混合 + 延迟销毁（缓动到 0 后 dispose）。head rotation 划界保留 perception gaze 优先。commit c0efb9d→dd478cd |
| ④ 关节约束参数化 | ✅ 已完成 | `RagdollJointParams` 接口 + 4 关节组预设（spine/shoulder/elbow/neck）+ `getJointParams` + `setRagdollJointParams`/`applyRagdollJointPreset` API + envState 持久化 + 序列化默认值合并。commit 99cee2c→c71f8ef |
