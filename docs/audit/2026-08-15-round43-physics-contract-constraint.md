# physics-contract.constraint.test.ts — 审核结果（round-43 / 真实 WASM 6DOF Spring 约束契约）

**审核范围：** `frontend/src/__tests__/physics-contract.constraint.test.ts`（264 行，5 用例）及其守护目标——真实 WASM Bullet 的 6DOF Spring 约束 API 契约（`createMinimalPhysicsImpl` helper 装配 + 约束创建/参数/行为/销毁验证）。

| 项 | 内容 |
|----|------|
| 被测目标 | `babylon-mmd/esm/Runtime/Optimized/wasm/spr`（真实 WASM Bullet，SPR），6DOF Spring 约束 8 个导出：`createGeneric6DofSpringConstraint` / `constraintEnableSpring` / `constraintSetStiffness` / `constraintSetDamping` / `constraintSetLinearLowerLimit` / `constraintSetLinearUpperLimit` / `constraintSetAngularLowerLimit` / `constraintSetAngularUpperLimit` / `destroyConstraint` / `physicsWorldAddConstraint` / `physicsWorldRemoveConstraint` |
| 支撑 helper | `frontend/src/__tests__/helpers/minimal-physics-impl.ts`（257 行，WASM 同步初始化 + RigidBodyConstructionInfo 构造/速度读取共享辅助） |
| 验证方式 | 运行单文件测试 + `node -e` 只读探测（不落盘、不改文件）验证行为断言有效性 |
| 测试结果 | ✅ `vitest run src/__tests__/physics-contract.constraint.test.ts`：5 passed / 0 failed，14ms（WASM 资产就绪） |

**与 round-10/13 及历史 physics 审核的关系：**
- **round-10 报告文件在 `docs/audit/` 现存（round-39 报告已核实澄清）**，round-13 审的是 `scene.ts`/`render`/`core/ui`（`docs/audit/2026-08-06-round13-scene-render-core-ui.md`），均非本测试范围；任务描述的「round-10/13 审过 physics」与现存审核记录不符，以实测为准。
- 实际 physics 相关审核链：**round-22**（`wind-physics.test.ts` = 状态机契约快照）→ **round-28**（`wind-physics-state.test.ts` = 生产逻辑分支/mock 层）→ **round-29**（`wind-physics-integration.test.ts` = 真实 WASM 中央力物理真实性，L1.5 层）。本文件与 round-29 **同类属真实 WASM 契约层**，但分工不同：round-29 守护「施力→牛顿响应」的物理前提，本文件守护「6DOF Spring 约束 API 契约」——按 ADR-204 P3 续拆 physics-contract 的编号切缝（core 1-5 / rigidbody 6-7 / **constraint 8（本文件）** / collision-worlds 9-10），测试体自原 `physics-contract.test.ts`（961 行）逐字搬运，非本轮新增用例。
- **总体结论：⚠️ 有条件通过** —— API 签名核对、类型安全、资源释放、异常路径均为优秀；但 1 项 P2 断言有效性缺陷：核心行为用例（测试 4「弹簧约束生效」）实际验证的是 6DOF **刚性锁定**而非**弹簧**，弹簧参数（enableSpring/stiffness/damping）无真实行为守护。

---

## 亮点

- **API 签名逐一核对成立**（constraint.test.ts:50-262 ↔ `spr/index.d.ts:73-130`）：`createGeneric6DofSpringConstraint(body_a, body_b, frame_a, frame_b, use_linear_reference_frame_a)`、`physicsWorldAddConstraint(world, c, disable_collisions)`、`constraintEnableSpring(ptr, index, on_off)` 等 10 个被用导出参数序/类型/返回值全部一致，axis 索引注释（:106「0=X, 1=Y, 2=Z linear; 3=AngX, 4=AngY, 5=AngZ」）与 Bullet 约定相符。
- **资源释放为全仓测试模范**（constraint.test.ts:55-83 等 5 处）：每用例 try/finally + 空值守卫（`!== undefined` 防 try 中途抛错），world 场景释放顺序严格（:213-229 removeConstraint → destroyConstraint → removeRigidBody → destroyRigidBody → deallocateBuffer(64/INFO_SIZE) → destroyShape → destroyPhysicsWorld）；`allocateBuffer`/`deallocateBuffer` 尺寸严格配对（64/64、INFO_SIZE/INFO_SIZE）。对比 round-29 审核的 `wind-physics-integration.test.ts`（8 用例**无** try/finally，当时报 P3）——本文件是 round-5 取舍原则的**严格化实现**。
- **0 处 `as any` / `@ts-ignore` / `@ts-expect-error`**，0 处 skip/todo/only（grep 核实），无 `catch{}` 吞错；`// @vitest-environment node`（:1）与 helper 同步加载链路一致，零 mock、零 Babylon 依赖。
- **helper 薄包装收敛良好**（minimal-physics-impl.ts）：`buildRigidBodyInfo`/`readLinearVelocity` 单一定义、本文件薄包装（:33-37）保持调用面不变；`createMinimalPhysicsImpl` 幂等单例（:61-74）+ `readLinearVelocity` 内部 try/finally 释放 out buffer（:234-240）；`PHYSICS_INFO_SIZE=144` + `PHYSICS_OFF` 偏移表单一真源，契约锁定不会漂移（round-29 已审 helper，本文件未引入新布局假设）。
- **行为探测验证了约束真实生效**（`node -e` 只读探测，未改任何文件）：无约束自由落体 1s 后 vy=-9.800（符合理论），创建约束后 vy≈0——「约束连接两刚体并抑制自由落体」的宏观行为为真，非 mock 自证。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | frontend/src/__tests__/physics-contract.constraint.test.ts | :160-230（测试 4「弹簧约束生效」） | **行为验证与断言目标不符**：未释放 6DOF 默认锁定行程（Bullet `btGeneric6DofConstraint` 默认全轴 lower=upper=0），`constraintEnableSpring`/`SetStiffness`/`SetDamping` 的设置对结果**零贡献**。只读探测实测（同一场景）——有弹簧 k=50：vy1=-0.000；**无弹簧：vy1=-0.000**；**k=0：vy1=-0.000**，三者完全相同。断言 `\|vy1\| < 9.0`（:212）在弹簧完全失效/未启用时同样通过（对照自由落体 -9.8 也会被刚性锁定拉回 0）。即：本文件守护核心「6DOF Spring 弹簧行为」实际只有「不抛异常」验证（测试 2），若 babylon-mmd 升级将这些函数静默 no-op，本文件全绿。 | 先 `constraintSetLinearLowerLimit/UpperLimit` 释放行程（如 ±10），再断言弹簧行为差异。探测证实释放行程后差异显著可断言：无弹簧 vy1=-9.80 / k=50,d=5 → -11.07 / k=200,d=20 → -29.16；或断言「有弹簧位移显著小于无弹簧」/「k 两档速度差异」。同时将阈值 9.0 换为有推导的区间断言（欠阻尼弹簧 1s 时点速度可**超过** 9.8，9.0 阈值在正确设置下会假阴性——探测 k=50 时已 -11.07）。 |
| 🟡 P3 | frontend/src/__tests__/physics-contract.constraint.test.ts | :55-83 / :90-119 / :126-157 / :169-229 / :236-261 | 清理序列 5 份重复（~8 行 × 5，其中 4 份完全相同，仅 world 场景多 2 行 remove）：改 API 或加用例时易漏改某份；已用 try/finally（优于 round-29 的 wind-physics 无 finally），但未收敛。 | 抽 `cleanup(...)` helper 或 `afterEach` 按用例注册（round-29 对同类问题提过同款建议），单资源用例可走「创建→断言→finally 单行释放」。 |
| 🟡 P3 | frontend/src/__tests__/physics-contract.constraint.test.ts | :107-109 / :142-147 / :195-197 / :212 | 魔法数值无推导：stiffness=100/damping=10、50/5、限位 ±1/±2/±0.5、阈值 9.0、60 帧 1/60；其中 9.0 阈值物理依据不足（见 P2）。 | 提为具名常量并注释推导（如 `SPRING_STIFFNESS_Y = 50`，阈值改为区间断言并注明自由度 ω=√(k/m) 与阻尼比推导）。 |
| 🟡 P3 | frontend/src/__tests__/physics-contract.constraint.test.ts | :142-147（测试 3） | limits 设置仅有「不抛异常」验证，无「limits 生效」行为验证（无 getter 可读回，但可行为验证）。 | 增强：释放行程设小限位（如 ±0.5）→ 步进 → 断言 body 位移/速度被限位约束（区分于自由行程），补足参数行为面。 |
| 🟢 P4 | frontend/src/__tests__/physics-contract.constraint.test.ts | :28-31（文件头注释） | 注释描述「断言失败会泄漏单指针——由 worker 进程退出回收」的宽松取舍，与本文件实际实现（5 用例全部 try/finally）不符；系自原 physics-contract.test.ts 继承的措辞。 | 更新注释为「本文件全用例 try/finally + 空值守卫；单指针泄漏取舍为原文件历史基线，已不再适用」。 |
| 🟢 P4 | frontend/src/__tests__/physics-contract.constraint.test.ts | :201 | `expect(vy0).toBe(0)` 精确浮点断言（刚创建未步进时物理上确定 0，风险极低）；round-29 对 wind-physics 同类断言建议过 toBeCloseTo。 | 可改 `toBeCloseTo(0, 6)` 消除浮点脆性（非必须）。 |
| 🟢 P4 | frontend/src/__tests__/helpers/minimal-physics-impl.ts | :90 | `PHYSICS_INFO_SIZE=144` 硬编码无推导注释（对齐 padding 13 字节未说明）——**round-29 已报同款 P4**，此处仅沿用注明，不重复计。 | 见 round-29 报告建议（补 144 推导注释）。 |

---

## 测试质量评价

- **有效性（部分失守）**：测试 1（创建返回非零指针）、测试 5（destroyConstraint 不抛异常）为有效 API 契约断言 ✅；测试 2/3 的「不抛异常」验证签名正确性 ✅ 但对参数语义零验证；**测试 4 是唯一行为用例，但其断言无法区分「弹簧生效」与「刚性锁定」**——只读探测（4 场景对照）实证：启用弹簧 / 无弹簧 / k=0 三者 vy 输出逐位相同（-0.000），断言在弹簧失效路径上存在假阳性；而若按正确测试设计（释放行程），9.0 阈值又会在欠阻尼弹簧下假阴性（k=50 实测 vy=-11.07 > 9.8）。即该用例**验证对象是 6DOF 约束整体而非 Spring 弹簧**，与标题/注释（:160、:194-197）宣称的「弹簧约束生效」不符。弹簧 API 的真实生效由本次探测证实（释放行程后 k=50 → -11.07、k=200 → -29.16、无弹簧 → -9.80，参数响应显著），但**测试文件本身未守住**。
- **合理性**：零 mock、零 Babylon 依赖，node 环境 + 真实 WASM 单实例（beforeAll 装配），符合 helper 定位；5 用例资源释放全部 try/finally + 空值守卫，异常路径无泄漏（测试运行 5/5 绿，14ms）。
- **边界覆盖**：创建/销毁/参数设置/limits 设置/行为/清理覆盖 6DOF Spring API 面；缺「弹簧参数行为」「limits 生效行为」两个行为面（P2/P3 已列）；无 skip/todo。
- **数值推导**：仅自由落体参考（-9.8，:210 注释）正确；弹簧 stiffness/damping 与 9.0 阈值无推导（P3）。
- **性能**：5 用例 14ms，WASM 单例一次初始化，无重复加载 ✅。
- **总评**：契约层「API 存在性 + 资源卫生」质量优秀，但「行为验证」名实不符，是继承自原 physics-contract.test.ts（逐字搬运）的历史设计缺陷，非本轮新增——按 ADR-204「触碰即改善」精神，建议本轮或下轮修复测试 4 使其真实验证弹簧行为。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round43-physics-contract-constraint（真实 WASM 只读探测佐证，未修改任何生产/测试文件）
