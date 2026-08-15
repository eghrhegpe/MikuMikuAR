# physics-contract.collision-worlds.test.ts — 审核结果（round-44 / 碰撞检测 + 多物理世界共存契约）

> **审核范围**：
> - 测试文件：`frontend/src/__tests__/physics-contract.collision-worlds.test.ts`（402 行 / 8 用例，`@vitest-environment node`，ADR-204 拆分 4 文件之 collision-worlds，describe 9「碰撞检测」+ describe 10「多物理世界 — 独立共存」）
> - 被测目标：babylon-mmd SPR WASM（`babylon-mmd/esm/Runtime/Optimized/wasm/spr`）真实 Bullet 的碰撞响应行为契约 + 多物理世界独立共存契约——createPhysicsWorld / physicsWorldSetGravity / createStaticPlaneShape / createRigidBody / physicsWorldStepSimulation / rigidBodyGetWorldTransformPtr / rigidBodySetLinearVelocity 等
> - helper：`frontend/src/__tests__/helpers/minimal-physics-impl.ts`（257 行，共享初始化 + buildRigidBodyInfo / readLinearVelocity / buildBundleInfoList）
>
> **与 round-43 关系与分工**：round-43 审同族另外两文件——**core**（模块加载 + 世界生命周期 + 形状 + 内存 + MmdRuntime，报告 `2026-08-15-round43-physics-contract-core.md`）与 **constraint**（6DOF Spring，报告 `2026-08-15-round43-physics-contract-constraint.md`）。本文件是同族第 3 个切缝（ADR-204 P3 记录编号切缝 9-10）。分工互补、无重复：core 断「世界生命周期 + 重力/速度隔离的基础」（core.test.ts:86-140 已断 A 世界受重力下落 / B 世界静态体速度 0），本文件断「**碰撞响应行为**（不穿透 / 动量传递）+ **多世界隔离的操作面**（指针互异 / 销毁独立性 / 步进独立性 / 跨世界碰撞隔离）」——core 是「世界存在且独立」，本文件是「世界相互作用正确且跨世界不串扰」。三者共享同一 helper 与布局常量（PHYSICS_INFO_SIZE / PHYSICS_OFF），无重复定义。与 round-29 审的 `wind-physics-integration.test.ts`（施力→牛顿响应）也同属真实 WASM 契约层，但本文件守护的是碰撞/世界域而非力域。

**总体结论：✅ 通过** — 实测 `npm run test -- src/__tests__/physics-contract.collision-worlds.test.ts` **8/8 passed（37ms）**；18 个被用 WASM 导出逐一核对 `spr/index.d.ts` 签名全部一致；`MotionType.Static = 1`（motionType.d.ts）与测试地面构造相符；无 skip/only/todo、无 `as any`/`@ts-ignore`/`@ts-expect-error`。无 P1/P2；3 项 P3 + 5 项 P4。

---

## 亮点

- **行为级碰撞验证，非 mock 自证**（:39-84 / :86-138）：真实 Bullet 上验证「下落不穿透」——方块自 (0,5,0) 落 180 帧后 `expect(tf[13]).toBeGreaterThan(0.4)`（tf[13] 为列主序变换 Y 平移，方块半高 0.5，0.4 留容差；若碰撞管线失效，方块将落到 y≈-39，断言必然变红）；「动量传递」——等质量两方块，B 以 -5 m/s 撞 A，断言 A 获速（|vzA1| > 0.01）且 B 减速（|vzB1| < 5）。两断言均为方向无关，稳健。
- **跨世界隔离对照实验，双向验证「隔离」真定义**（:323-400）：同世界 vs 跨世界**同布局**对照——① 同世界：bodyB 在 (0,0,0.9) 以 -5 撞向原点 bodyA，碰撞推开（|vzA| > 0.01）；② 跨世界：同坐标分属两世界，body1 三轴速度恒 0（不被撞），body2 匀速穿过（`toBeCloseTo(-5, 1)`，空世界无阻尼无外力）。同一布局正反对照，是全文件信息密度最高的用例。
- **多世界独立性多维覆盖，五个操作面各一用例**：指针互异（:175-184 `not.toBe`）→ 重力独立（:186-230，世界 1 恒 0 / 世界 2 下落，双向断言，世界 2 的 -9.8 若泄漏到世界 1 立即红）→ 销毁互不干扰（:232-276，use-after-free 回归：销毁世界 1 后世界 2 继续步进加速，vy2After < vy2Before）→ 步进隔离（:278-321，只步进 A，B 三轴恒 0，验证无隐式全局步进）→ 跨世界碰撞隔离（:323-400）。
- **restitution 用例诚实降级，杜绝假阳性**（:140-171）：[fix] 注释以实测证据（「0.9 与 0.0 两方块 2 秒后位置完全相同」）说明 SPR 引擎碰撞响应不使用 Restitution，将原「高弹性反弹更明显」断言降级为字段读写契约 + 引擎接受性验证，并明确警告「本用例不验证反弹行为…勿误读为契约」。对照 round-43 constraint 报告的 P2「行为验证与断言目标不符」（弹簧用例断言在引擎静默 no-op 时同样通过）——同一类陷阱，本文件已按「触碰即改善」先行处理，是正面反例。
- **资源清理与空值守卫**（:71-83 等）：describe 9 三用例全部 try/finally + `!== undefined` 守卫（try 中途抛错不中断清理链，注释 :41/:72-73 说明提升声明原因）；allocateBuffer/deallocateBuffer 尺寸严格配对（INFO_SIZE/INFO_SIZE）；清理顺序符合「先 remove 再 destroy body，body 先于 shape，world 最后」的家族惯例。
- **disableDeactivation: true 钉死休眠**（:55/:98/:104 等全部动态刚体）：避免 Bullet 休眠导致时序不稳定（round-29 报告同类最佳实践）。
- **API 签名全对**：18 个被用导出（createPhysicsWorld / createStaticPlaneShape / rigidBodyGetWorldTransformPtr / physicsWorldStepSimulation 等）与 `spr/index.d.ts` 逐一核对参数序/类型/返回全部一致；`createStaticPlaneShape(0,1,0,0)` = 法线 (0,1,0) 平面常数 0 = y=0 平面，语义正确。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | physics-contract.collision-worlds.test.ts | :174-400（describe 10 全部 5 用例） | **清理风格文件内不一致**：describe 9（:71-83 等）try/finally + 空值守卫，describe 10 全部为顺序清理无 try/finally——断言失败时泄漏 6+ WASM 指针（2 世界 + shape + 2 刚体 + 2 info）。单次运行影响有限（worker 退出回收、泄漏对象不再被步进无串扰），但同文件标准不一致，且 round-43 对 constraint 的清理重复已按 P3 登记，此处应一并收敛 | describe 10 补 try/finally + 空值守卫，或抽 `cleanupWorlds(worlds, bodies, infos, shape)` helper 统一两 describe（round-43 对 constraint 提过同款建议） |
| 🟡 P3 | physics-contract.collision-worlds.test.ts | :121/:218/:303/:348、:342/:375、:388 | **魔法数值部分无推导**：动量传递阈值 0.01、重力下落阈值 -1、撞击初速 -5、30 帧步进窗、`toBeCloseTo(-5, 1)`。多数数值有注释推导（180 帧/0.4 容差/0.9 重叠均注明了物理依据，优于 constraint 文件），但 0.01 / -1 等阈值为何「足够」未说明 | 提为具名常量并注释推导（如 `MOMENTUM_TRANSFER_MIN_V = 0.01`、`FALL_VELOCITY_MIN = -1`），或补一句「阈值远小于理论值（1s 自由落体 vy≈-9.8），仅需区分 0 与下落」 |
| 🟡 P3 | physics-contract.collision-worlds.test.ts（+ helper） | helper:155-159 ↔ 本文件碰撞用例 | **碰撞过滤字段零行为验证**：helper 写入 CollisionGroup=1 / CollisionMask=0xffff / NoContactResponse=0，但全仓（4 文件 + wind-physics）无任何用例行为验证这些字段是否生效——若引擎升级后 mask/NoContactResponse 静默失效（碰撞变成永远开启），本文件全绿。这是碰撞契约族的真实覆盖缺口 | 补一个负向用例：`CollisionMask=0` 或 `NoContactResponse=1` 的方块以 -5 穿过静止方块，断言速度不变（`toBeCloseTo(-5, 1)`）——复用测试 8 的对照布局 |
| 🟢 P4 | physics-contract.collision-worlds.test.ts | :339/:372 | **对照 ① 初始重叠 0.1 依赖求解器穿透推开**：两方块初始已重叠（间距 0.9 < 1.0），断言 |vzA|>0.01 依赖 Bullet 求解器把穿透推开产生足够速度。实测稳定（无随机性、确定性求解），但注释未说明「初始重叠由求解器推开」这一语义 | 注释补「初始重叠由穿透求解推开，断言其速度足以证明接触响应」；或改为间距 1.05 非重叠起步（接触时间 0.01s 仍在 30 帧窗内） |
| 🟢 P4 | physics-contract.collision-worlds.test.ts | :111/:212-214/:307-309 | 精确浮点 `toBe(0)`：刚创建未步进的刚体速度物理上确定 0，风险极低（round-29 对同类断言建议过 toBeCloseTo，非必须） | 可改 `toBeCloseTo(0, 6)` 消除浮点脆性 |
| 🟢 P4 | physics-contract.collision-worlds.test.ts | :49 | `motionType: 1` 无注释：constraint 文件同款写法带 `// Static` 注释（constraint.test.ts:56），本文件未注。语义本身正确（motionType.d.ts: Static = 1，已核实），纯可读性 | 补 `// Static` 注释，或经 helper 的 overrides 引语义名 |
| 🟢 P4 | physics-contract.collision-worlds.test.ts | 文件头 :1-4 / describe 10 标题 | **范围说明**：本文件「多物理世界」= 独立 `createPhysicsWorld` 实例共存；babylon-mmd 模型物理实际使用的 `createMultiPhysicsWorld`（global + subworld shadow 模型）裸 API 族（multiPhysicsWorldAddRigidBody/AddRigidBodyToGlobal 等 15 个导出）在全仓零契约覆盖（生产代码也不直接调 raw 层，属范围外，但可注明） | 文件头补一句「多世界 = 独立 world 实例；multiPhysicsWorld* API 族不在本文件范围」，避免误读为覆盖了完整多世界模型 |
| 🟢 P4 | helpers/minimal-physics-impl.ts | :90-111 | `PHYSICS_INFO_SIZE = 144` 无来源注释——round-29 / round-43 已两轮登记 P4 未修，本轮复核仍成立（与上游 `Bind/constants.js` 逐字节一致，但维护者无从得知推导） | 补注释「144/偏移表镜像上游 babylon-mmd `Bind/constants.js` 布局，勿改，改前同步 physics-contract 套件」 |

## 测试质量评价

- **有效性：✅ 强**。核心断言针对真实 WASM 引擎输出（真实刚体 Y 平移 / 线速度 / 指针），零 mock；「不穿透」与「动量传递」若引擎碰撞管线静默失效立即变红；跨世界对照实验（:323-400）是双向验证「隔离」的最强形式——同布局正反两场景互证。多世界五个操作面（指针/重力/销毁/步进/跨世界碰撞）各一用例，覆盖完备且与 core 文件无重复（core 断重力/速度隔离，本文件断碰撞响应 + 销毁/步进/碰撞隔离）。
- **合理性：✅**。18 个被用导出签名逐一核对 `spr/index.d.ts` 一致；`createStaticPlaneShape` 法线/平面常数语义正确；`rigidBodyGetWorldTransformPtr` 返回列主序 16 浮点，tf[13] = Y 平移读取正确；MotionType.Static=1 与 ground-collision.ts 生产用法一致；等质量弹性碰撞物理量纲自洽（B 自 3m 处以 5 m/s 撞向 A，接触时间 0.4s < 步进窗 1s）。
- **边界覆盖：✅ 良好，一处缺口**。正向行为覆盖完整；缺「碰撞过滤负向用例」（CollisionMask=0 / NoContactResponse=1 应互相穿过，见 P3-3）——这是碰撞域唯一可补的真实缺口。restitution 字段读写契约（:140-171）诚实标注了引擎不响应反弹的实测事实。
- **可执行性：✅**。8 用例 37ms；WASM 单例一次初始化（beforeAll 共享 phys/api/memory，:22-26）；零跳过测试；确定性（无随机、无真实时钟依赖）。
- **可维护性：⚠️ 轻微**。402 行在 ADR-204 契约测试豁免线（≤~400）边缘，8 用例未超 30 软上限；describe 9 清理样板 8 行 × 3 份与 describe 10 顺序清理 × 5 份重复且风格不一致（P3-1）；魔法数值多数有注释（优于 constraint 文件，见 P3-2）。

**验证记录**：`npm run test -- src/__tests__/physics-contract.collision-worlds.test.ts` → **8 passed（37ms）**，0 failed 0 skipped（Vitest 4.1.9）；`npm run check`（tsc --noEmit 全量 + 文档/翻译一致性检查）→ **exit 0 全绿**；上游签名/常量逐项核对一致。

---

**审核日期**：2026-08-15
**审核员**：子代理 round44-physics-contract-collision-worlds
