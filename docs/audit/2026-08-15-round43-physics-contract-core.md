# [physics-contract.core.test.ts 真实 WASM 契约层] — 审核结果

> **审核范围**：
> - 测试文件：`frontend/src/__tests__/physics-contract.core.test.ts`（387 行 / 33 用例，`@vitest-environment node`，ADR-204 拆分 4 文件之 core）
> - 被测目标：babylon-mmd SPR WASM（`babylon-mmd/esm/Runtime/Optimized/wasm/spr`）真实 Bullet 底层 API 契约——createPhysicsWorld / destroyPhysicsWorld / physicsWorldStepSimulation / createBoxShape / allocateBuffer / createRigidBody / createMmdRuntime 等，经 initSync 同步加载
> - helper：`frontend/src/__tests__/helpers/minimal-physics-impl.ts`（257 行，共享初始化 + buildRigidBodyInfo / readLinearVelocity / buildBundleInfoList）
>
> **与历史轮次关系与分工**：round-10/13 审的是 physics **JS 包装层**（round-10 覆盖 `physics/*` 模块，报告文件未留存于 docs/audit，结论附于 round-11 文件对话记录；round-13 审 physics-bridge：P1#4 `getBoneWorldPosition` 局部/世界坐标系契约混淆、P3 lighting-follow 局部坐标错位、知识卡漂移）。本测试位于物理测试栈**最底层**——不经任何 JS 包装，直接验证真实 WASM Bullet API；physics-bridge 等 JS 层最终依赖的就是这份底层契约。四文件分工：**core（本文件）** = 模块加载 + 世界生命周期 + 形状 + 内存 + MmdRuntime；rigidbody = 刚体 + Bundle；constraint = 6DOF Spring；collision-worlds = 碰撞 + 多世界。helper 另被 `wind-physics-integration.test.ts`（round-29 已审，真实 WASM 物理真实性）复用——三者共享同一初始化与布局常量，无重复定义。

**总体结论：✅ 通过** — 实测 `npx vitest run src/__tests__/physics-contract.core.test.ts` **33/33 passed（26ms）**；兄弟 3 文件 42/42 passed；`npx tsc --noEmit` exit 0。无 P1/P2；3 项 P3（测试覆盖缺口 / ADR 计数漂移）+ 5 项 P4（含 round-29 遗留未修的 144 来源注释）。

---

## 亮点

- **真实物理行为断言，非 mock 自证**（core.test.ts:85-140）：多世界隔离测试在真实 Bullet 上验证三重规律——A 世界动态体受重力 30 步（0.5s）后 `expect(velA[1]).toBeLessThan(-0.1)`（理论 ≈ -9.8×0.5 = -4.9，50× 裕度）；B 世界静态体（mass=0）速度三轴 `toBeCloseTo(0)`；`expect(worldA).not.toBe(worldB)` 指针级隔离。`disableDeactivation: true` 钉死 Bullet 休眠避免时序不稳定（与 round-29 报告同类最佳实践）。
- **端到端布局契约锁定**（helper:117-162 + core.test.ts:100-118）：手写 144 字节 `RigidBodyConstructionInfo` → wasm `createRigidBody` → 步进 → `readLinearVelocity` 读回真实速度——间接验证 `PHYSICS_INFO_SIZE=144` 与 16 字段偏移表与上游 **逐字节一致**（我已逐项核对 `babylon-mmd/esm/Runtime/Optimized/Physics/Bind/constants.js`：`RigidBodyConstructionInfoSize=144`、Shape 0 / InitialTransform 16 / DataMask 80 / MotionType 82 / Mass 84 / LocalInertia 88 / LinearDamping 100 / AngularDamping 104 / Friction 108 / Restitution 112 / LinearSleepingThreshold 116 / AngularSleepingThreshold 120 / CollisionGroup 124 / CollisionMask 126 / AdditionalDamping 128 / NoContactResponse 129 / DisableDeactivation 130，与 helper:93-111 完全一致）。布局一旦漂移，行为断言立即变红。
- **系统性 try/finally 资源清理**：33 用例每个 create 均有对应 destroy/remove；多资源用例（:85-140）清理顺序注释明确「先 remove 再 destroy body，body 先于 shape 销毁」（world 持 body、body 持 shape 引用，与 rigidbody/collision-worlds 惯例一致）；`readLinearVelocity` 输出缓冲 try/finally 释放（helper:233-241）。
- **边界覆盖完整**：形状 12 用例覆盖零/负/超大/极小尺寸、零半径 sphere、零尺寸 capsule、非单位法线 staticPlane，均附 Bullet 语义注释（:249「btBoxShape 不校验半尺寸符号」、:285「内部归一化」）；内存 7 用例覆盖 1MiB 大块首尾写回、512B 逐字节一致性、零尺寸分配、10 次重复分配释放。
- **类型安全与卫生**：测试与 helper **0 处 `as any` / `@ts-ignore`**（`const b: unknown = memory.buffer` 是收窄非逃生）；无 `catch{}` 静默吞错（beforeAll 失败 fail-fast，符合契约测试预期）；无 skip/only/todo；魔法数值收敛为命名常量（`PHYSICS_INFO_SIZE` / `PHYSICS_OFF`，helper:90-111）。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | docs/adr/adr-204-unit-test-layering-and-hygiene.md | :119（P3 续拆 physics-contract 记录） | 拆分记录声称「core 16 / rigidbody 11 / constraint 5 / collision-worlds 8 = **40 用例守恒**」，实测当前 **33/29/5/8 = 75 用例**（拆分后经 e89eae3a 真世界隔离、ab79934e/70dacb06 WASM 泄漏修复、acdb355a 清理顺序等提交大幅扩充）。ADR-204 首部已标被 ADR-256 取代，但 40→75 计数漂移仍易误判「用例丢失」 | 在 ADR P3 记录补一行「后续扩充至 75（截至 2026-08-15 实测各文件 it 计数）」，或在测试文件头注明当前用例数 |
| 🟡 P3 | physics-contract.core.test.ts | :371-386（MmdRuntime describe） | MmdRuntime 覆盖仅 create + free 两个冒烟；`setPhysicsFixedTimeStep` / `setPhysicsMaxSubSteps` / `beforePhysics` / `afterPhysics` 等模型物理集成关键方法零覆盖（rigidbody / collision-worlds / wind-physics 系列亦未直接调用） | 补 1-2 用例：`setPhysicsFixedTimeStep` 后经 `getMultiPhysicsWorld` 读回，或空世界 `beforePhysics`/`afterPhysics` 不抛 |
| 🟡 P3 | physics-contract.core.test.ts | :154-175 | 「极端时间参数 / 固定子步长 0」用例仅断言 no-throw，注释却声称验证 Bullet 内部 `m_localTime` 行为——**注释断言强度 > 测试验证强度**；契约冒烟可接受，但维护者易误判行为已被验证 | 补行为用例（如 timeStep=0 步进后真实刚体速度不变），或把注释改为「仅验证不崩溃，内部 m_localTime 语义未断言」 |
| 🟢 P4 | helpers/minimal-physics-impl.ts | :90-111 | `PHYSICS_INFO_SIZE = 144` 无来源注释（round-29 已标 P4 未修）。本轮复核：与上游 `Bind/constants.js` 常量完全一致，但维护者无从得知推导（131 字节字段区 + 对齐 padding） | 补注释「144/偏移表镜像上游 babylon-mmd `Bind/constants.js` 的 RigidBodyConstructionInfoSize/Offsets，勿改，改前同步 physics-contract 套件」，或直接 import 上游常量（同包零依赖叶模块） |
| 🟢 P4 | helpers/minimal-physics-impl.ts | :80-83 | `resetMinimalPhysicsImpl` 全仓零调用点（死导出），且语义不实——wasm-bindgen 模块级 `wasm` 缓存（spr/index.js initSync 首行 `if (wasm !== undefined) return wasm`）使「重置」无法得到全新实例；注释已诚实声明，但导出易被误用 | 删除，或标注 @deprecated；如真需要重置需 worker/进程级隔离 |
| 🟢 P4 | physics-contract.core.test.ts | :332-338、:62-65、:382-385 | 循环分配测试无 try/finally（中途失败泄漏少量指针，按文件头 [audit:round5] 单资源短链政策可接受）；destroy(0)/free 失败句柄行为未定义，但 create 非零断言已在别处覆盖 | 维持现状，无需改动 |

## 测试质量评价

- **有效性：✅ 强**。核心断言针对真实 WASM 引擎输出（真实刚体线速度 / 真实指针 / 字节级写回），零 mock；多世界隔离测试验证真实重力积分与静态体语义；端到端布局锁定（buildRigidBodyInfo→createRigidBody→速度读回）是 144 字节布局契约的最强间接验证。
- **合理性：✅**。helper 忠实映射 wasm API（与 `spr/index.d.ts` 逐符号核对：createPhysicsWorld/StepSimulation/allocateBuffer/createMmdRuntime 等签名全部吻合）；加载链路 `readFileSync → WebAssembly.Module → initSync({module}) → init()` 正确（initSync 内部已跑 `__wbindgen_start`，额外 `init()` 调用 Rust 侧导出属标准协议）；不依赖 Babylon.js，符合文件头声明。
- **边界覆盖：✅**。形状 / 内存 / 世界参数极端输入覆盖完整；缺 MmdRuntime 方法级覆盖（见 P3-2）。
- **可执行性：✅**。单文件 26ms，四文件全套 75 用例 ~300ms；WASM 单例一次初始化；零跳过测试。
- **可维护性：⚠️**。387 行略超 ADR-204 软阈值 300（P3 记录已裁定契约测试豁免，允许 ≤~400）；用例数 33 略超 30 软上限（同类豁免）；与 collision-worlds 的多世界用例无重复（本文件断重力/速度隔离，彼断指针/销毁独立性）。

**验证记录**：`npx vitest run src/__tests__/physics-contract.core.test.ts` → 33 passed（26ms）；`physics-contract.rigidbody/constraint/collision-worlds` → 42 passed；`npx tsc --noEmit` → exit 0；上游常量逐项核对一致。

---

**审核日期**：2026-08-15
**审核员**：子代理 round43-physics-contract-core
