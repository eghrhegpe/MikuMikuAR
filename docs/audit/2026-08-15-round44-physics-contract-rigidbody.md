# physics-contract.rigidbody.test.ts — 审核结果（round-44 / 真实 WASM 刚体 + RigidBodyBundle 批量刚体契约）

**审核范围：**
- 测试文件：`frontend/src/__tests__/physics-contract.rigidbody.test.ts`（623 行 / 29 用例，`@vitest-environment node`，ADR-204 拆分 4 文件之 rigidbody）
- 被测目标：babylon-mmd SPR WASM（`babylon-mmd/esm/Runtime/Optimized/wasm/spr`）真实 Bullet 刚体契约——`createMinimalPhysicsImpl` 装配 + `buildRigidBodyInfo` / `buildBundleInfoList` / `readLinearVelocity` / `readBundleLinearVelocity` helper + 刚体创建/施力/步进/速度读回/销毁 + RigidBodyBundle 批量刚体（创建/质量/施力/变换/速度/销毁）
- helper：`frontend/src/__tests__/helpers/minimal-physics-impl.ts`（257 行，共享初始化 + 构造信息/速度读取辅助）
- 验证方式：运行单文件测试 + `node -e` 只读行为探测（不落盘、不改文件）逐条验证行为断言物理真实性
- 测试结果：✅ `npm run test -- src/__tests__/physics-contract.rigidbody.test.ts` → **29 passed / 0 failed，32ms**（WASM 资产就绪）

**与 round-43 及历史 physics 审核链的关系与分工：**
- 实际 physics 测试链：**round-22**（`wind-physics.test.ts` 状态机契约快照）→ **round-28**（`wind-physics-state.test.ts` mock 层）→ **round-29**（`wind-physics-integration.test.ts` 真实 WASM 中央力物理真实性，L1.5 层）→ **round-43**（`physics-contract.core.test.ts` 世界/形状/内存/MmdRuntime + `physics-contract.constraint.test.ts` 6DOF Spring）。
- 本文件与 round-43 同族（ADR-204 P3 续拆 physics-contract 的编号切缝：**core 1-5（round-43）** / **rigidbody 6-7（本文件）** / **constraint 8（round-43）** / collision-worlds 9-10）。分工：core 守护「模块加载+世界生命周期+形状+内存」，本文件守护「**刚体单数与批量 bundle 的创建/施力/速度读回/销毁契约**」——是 core 世界之上、constraint 约束之下的实体层；`RigidBodyBundle` 是 babylon-mmd 为 MMD 模型批量为刚体设计的专用容器（wind-physics 实际场景），本文件为其核心契约（per-index 独立映射、批量施力、批量变换）。
- 与 round-29 的关系：round-29 守护「施力→牛顿响应」的物理前提（wind-physics 集成），本文件守护同物理前提在**裸 WASM 单数/bundle API 面**的逐符号契约；无重复用例。

**总体结论：✅ 通过** — 29/29 passed；行为断言经只读探测逐条验证为**真实物理行为**（非 mock 自证、无 constraint 文件式「名实不符」缺陷）；API 签名 40+ 处与 `spr/index.d.ts` 逐一核对全部吻合；无 P1/P2；1 项 P3（helper 内部 40 行重复）+ 8 项 P4。

---

## 亮点

- **端到端行为断言物理真实，经只读探测逐条实证**（rigidbody.test.ts:55-102、:213-226、:323-348、:382-427）：
  - 测试 1「施力→步进→速度非零」实测 `vy=1.5000001`，与注释推导 `F/m·dt = 100×(1/60) = 1.667` 减重力 `-9.8×(1/60) ≈ 0.163` → `≈1.5` **逐位吻合**（:87-90 推导完整正确，全文件数值推导标杆）；`vx/vz` 实测精确 0。
  - 测试 8「冲量立即改变速度」实测 `vy=10`（精确），匹配 `Δv=I/m`（:218 注释）。
  - 测试 15「torque 经步进累积」实测 `wz=0.125 = τ·dt/I_z`，其中 `I_z=(1/12)m(2²+2²)=2/3`（`createBoxShape(1,1,1)` 为**半尺寸**语义 → 全尺寸 2）——物理推导自洽。
  - 测试 18「bundle 批量施力轻的飘得更多」实测 `vy=0.333/0.167/0.083`，精确匹配 `F/m·dt`（0.5/1.0/2.0 质量）——**per-index 独立映射 + F/m 关系**是 RigidBodyBundle 契约的核心价值，断言 `vy0 > vy2`（:418）真实验证。
- **世界场景 4 用例全部 try/finally + 空值守卫**（:55-102 / :104-135 / :323-348 / :382-427）：清理顺序严格（`removeRigidBody(Bundle)` → `destroyRigidBody(Bundle)` → `deallocateBuffer` → `destroyShape` → `destroyPhysicsWorld`），空值守卫防 try 中途抛错——round-43 core 报告确认的 WASM 泄漏修复（ab79934e/70dacb06/acdb355a）已在本文件全量落地。
- **API 签名 40+ 处逐一核对成立**：单数 25 个（createRigidBody/destroyRigidBody/ApplyCentralForce/ApplyTorque/GetMass/SetLinearVelocity/SetDamping/SetMassProps/GetLocalInertia/SetGetAngularVelocity/ApplyCentralImpulse/ApplyTorqueImpulse/SetGetPushVelocity/SetGetTurnVelocity/Translate/GetWorldTransformPtr/GetMotionStatePtr/ClearForces/GetTotalForce 等）+ bundle 24 个（含 `rigidBodyBundleSetMassProps(ptr,index,mass,ix,iy,iz)` 六参、`rigidBodyBundleGetLinearVelocity(ptr,index,out)` 三参等）与 `spr/index.d.ts:71-393` 参数序/类型/返回值全部一致。
- **0 处 `as any` / `@ts-ignore` / `@ts-expect-error` / `it.only` / `it.skip` / `it.todo` / 空 `catch{}`**（grep 核实）；`Parameters<typeof _buildRigidBodyInfo>[2]`（:33）类型化 overrides，非 any 逃生；`api: typeof sprWasm`（helper:52）强类型命名空间。
- **describe 编号 6/7 保持 ADR-204 切缝连续性**（core 1-5 / rigidbody 6-7 / constraint 8 / collision-worlds 9-10），拆分可追溯性良好。
- **helper 薄包装收敛 + 通用 out 型 getter 读取器**：本文件薄包装（:31-35）保持调用面不变；`readVec3`（:42-51）分配 12 字节 out 缓冲、try/finally 释放，与 helper `readLinearVelocity`（minimal-physics-impl.ts:233-241）释放惯例一致，覆盖角速度/总力/局部惯量等 6 种 out 型 getter。
- **bundle 内存管理正确**：`buildBundleInfoList` 连续分配 `INFO_SIZE×count` 字节（helper:169-226），每 index 写入独立质量，`deallocateBuffer(listPtr, INFO_SIZE×N)` 尺寸严格配对（:364/378/423/441 等）；bundle 与 shape 生命周期分离（bundle 持有 shape 指针拷贝，销毁顺序 bundle → list 缓冲 → shape）。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/__tests__/helpers/minimal-physics-impl.ts | :117-162 vs :169-226 | `buildRigidBodyInfo` 与 `buildBundleInfoList` 内联重复 16 字段写入逻辑 ~40 行（仅差异：motionType 参数化 / DisableDeactivation 默认值 0 vs 1）。字段偏移虽来自共享 `PHYSICS_OFF` 表，但**默认值**（Friction=0.5、睡眠阈值等）改一处漏一处即成隐性契约漂移 | 抽内部 `writeInfoAt(ptr, shapePtr, mass, { motionType, disableDeactivation })`，两公开函数仅保留入口差异（单数版读 overrides、bundle 版按 index 取 masses） |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :92-93（及 :76-77） | `expect(vx1).toBe(0)` 精确浮点断言：实测当前 WASM 下 vx/vz 精确 0（无水平外力、无碰撞），但依赖 Bullet 积分路径；babylon-mmd 升级若引入浮点噪声即假阴性 | 改 `toBeCloseTo(0, 6)`（round-43 对同族断言提过同款建议） |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :351-622（bundle describe） | **越界索引零覆盖**：所有 index 均在 `[0, count)` 合法范围，无 `index=count` / 负数用例。越界属 WASM 未定义行为（可读越界内存或 abort），契约测试不强锁未定义行为——可接受，但未记录该取舍 | 可选补 1 条「越界 index 不崩溃」契约冒烟（仅断言 no-throw），或文件头注释声明「越界未定义行为不守护」 |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :323-339（测试 15） | torque=5 + 60 步无数值推导注释（断言仅「非零」故无碍，但维护者无从核对阈值合理性）；实测可推导：`Δw = τ·dt/I_z = 5×(1/60)/(2/3) ≈ 0.125`（`createBoxShape(1,1,1)` 为**半尺寸** → I_z=2/3） | 补推导注释；顺带注明 `createBoxShape(1,1,1)` 半尺寸语义（与测试 1 注释的 box 尺寸假设统一） |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :373-375 | `toBeCloseTo(0.5, 1)` 精度偏松：质量 0.5/1.0/2.0 为 float32 精确可表示，但 1 位小数精度允许 ±0.04 误差也通过 | 收紧至 `toBeCloseTo(0.5, 4)`（与同文件其他往返断言 :157-159 的 4 位精度一致） |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :137-148 等 13 个单资源用例 | 无 try/finally：断言失败泄漏 ≤3 个 WASM 指针 + 12B out 缓冲，由 worker 进程退出回收（round-5 单资源短链政策，可接受）；但**文件头未声明该取舍**（constraint 文件头有 `[audit:round5]` 注释，本文件头无） | 文件头补一句「单资源用例按 round-5 短链政策不包 try/finally；世界场景全部 try/finally」取舍声明，避免读者误判遗漏 |
| 🟢 P4 | frontend/src/__tests__/helpers/minimal-physics-impl.ts | :169-226 | `buildBundleInfoList` 无参数校验：`count≤0` 或 `masses.length < count` 时静默回落默认质量 1.0，无告警 | 加 `count > 0` 前置断言，或注释声明「测试专用，调用方保证 count/masses 一致」 |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :351-622（bundle describe） | bundle 侧 torque 面（`ApplyTorque`/`ApplyTorqueImpulse`/`GetTotalTorque`）与指针型 API（`GetBufferedMotionStatesPtr`/`GetKinematicStatesPtr`/`GetMotionStatesPtr`）零覆盖；单数侧 `ApplyForce(ptr)`/`ApplyImpulse`/`GetVelocityInLocalPoint` 等亦未测。存在性已由 `typeof sprWasm` 类型 + 调用点守护，但参数语义无验证 | 可选补 1-2 条高价值：`bundleApplyTorqueImpulse` 立即角速度（对称单数测试 9） |
| 🟢 P4 | frontend/src/__tests__/physics-contract.rigidbody.test.ts | :1-4（文件头） | 未注当前用例数 29（ADR-204 P3 记录拆分时 rigidbody 为 11，实际 29；round-43 已在 ADR 文档报 40→75 计数漂移 P3），文件头自文档化不足 | 补一行「29 用例（ADR-204 记录 11 → 扩充）」便于计数核对 |

---

## 测试质量评价

- **有效性：✅ 强**。核心断言针对真实 WASM 引擎输出（真实刚体速度 / 真实指针 / 字节级变换矩阵），零 mock。只读探测（5 场景对照）逐条实证：施力积分 vy=1.5（注释推导吻合）、冲量 vy=10（Δv=I/m）、torque 累积 wz=0.125（τ·dt/I）、bundle 批量施力 0.333/0.167/0.083（F/m·dt 精确）、translate 变换 tf[13]=5——**对比 round-43 constraint 的 P2（弹簧行为名实不符），本文件无同类缺陷**，行为验证名副其实。
- **合理性：✅**。helper 忠实映射 wasm API（与 `spr/index.d.ts` 逐符号核对 40+ 处全部吻合）；`// @vitest-environment node`（:1）与 helper 同步加载链路一致；零 mock、零 Babylon 依赖；`beforeAll` 单次初始化 WASM 单例（32ms 用例本体 / 321ms 全文件），无重复加载。
- **边界覆盖：⚠️ 中**。质量独立（0.5/1.0/2.0 per-index）、批量施力速度读回、变换读回、销毁不抛、per-index setter 往返覆盖完整；缺口为越界索引、bundle torque 面、指针型 API（均 P4，存在性已由类型+调用守护）。
- **数值推导：✅ 主 / ⚠️ 次**。测试 1（:87-90）与测试 8（:218）推导完整且实测吻合；bundle 质量速度比经实测精确匹配；测试 15 无推导注释（P4）。
- **可维护性：⚠️**。623 行超 ADR-204 300 软线（契约豁免 ≤~400 也超），但 **ADR-256（已采纳）已把行数阈值降级为 ≤1200 软建议**，且本文件依赖图成本极低（node + 零 mock，321ms 全绿，不触发合并判据），不违反现行政策；主要维护风险在 helper 40 行重复（P3）。
- **可执行性：✅**。29/29 passed，32ms；零跳过；WASM 单例一次初始化。
- **类型安全：✅**。0 处 `as any` / `@ts-ignore` / `@ts-expect-error`。
- **资源释放：✅**。世界场景 4 用例 try/finally + 空值守卫 + 严格销毁顺序；单资源 13 用例按 round-5 短链政策（文件头未声明取舍，P4）。

**总评：** 契约层「API 存在性 + 资源卫生 + 行为真实性」三线质量均为本轮 physics 四文件中的最优档（对比 core 33 用例 3 项 P3、constraint 1 项 P2）；29 用例行为验证充分、无名实不符缺陷。P3 仅 1 项（helper 内部重复，非测试正确性问题），建议下轮触碰时顺手收敛；其余 P4 为可选打磨。

---

**审核日期：** 2026-08-15
**审核员：** 子代理 round44-physics-contract-rigidbody（真实 WASM 只读探测佐证，未修改任何生产/测试文件）
