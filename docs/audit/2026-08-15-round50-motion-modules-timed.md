# motion-modules riding 时间驱动接线（帧钩子→骨骼覆盖）— 审核结果

**总体结论：✅ 通过**（无 P1/P2；3 项 P3 测试覆盖缺口 + 5 项 P4 观察，均不阻断）

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/motion-modules-timed.test.ts`（143 行，2 用例，全部通过）
- 被测源码：
  - `frontend/src/scene/motion/motion-modules/riding-model.ts:78-141`（bake 静态写入 + 认领足骨记录）、`149-190`（ensureActive：autoPedal 驱动的钩子注册/注销）、`192-288`（createRidingModelModule）
  - `frontend/src/scene/motion/motion-modules/motion-math.ts:30-46`（computePedalPhase / computeFootPitch）
  - `frontend/src/scene/motion/motion-modules/module-base.ts:236-257`（createFrameHookManager）、`332-345`（prepareBake）
  - `frontend/src/scene/motion/motion-modules/registry.ts:165-214`（getModuleState）、`265-273`（claimBones/getOwnedBones）
  - `frontend/src/scene/motion/bone-override.ts:735-746`（FRAME_HOOK_ORDER）、`748-762`（registerBoneOverrideFrameHook）、`828-842`（_runFrameHooks）、`953-984`（startBoneOverride 渲染循环调用点）
  - 测试支撑：`frontend/src/__tests__/mocks/state-superset.ts`

**与既往轮次的关系：**
- **round-46 P2（computeSwayYaw 未接线）不影响 riding**：riding 只调用 `computePedalPhase`/`computeFootPitch`（motion-math.ts:29 导入，riding-model.ts:171,177 调用），两条链路均已接线并由此测试锁定；`computeSwayYaw` 的未接线状态是等待 ADR-116 P3 规划的 `sway-motion.ts` 落地（motion-math.ts:3-5 头注释明确记载），与 riding 正交。
- **round-47（side-hooks 帧钩子独立注册）**：riding 走同一个 `registerBoneOverrideFrameHook` 注册表，但使用独立 order 槽 `FRAME_HOOK_ORDER.RIDING=10`（bone-override.ts:741），与 FEET=0 / BODY_POSITION=5 / SWAY=20 / HAND_SYMMETRY=30 分槽，无同序「同骨获胜者」歧义。riding 用模块级 `_ridingFrameHooks` 单例（riding-model.ts:50）而非工厂闭包实例——round-47 的闭包化修复针对 foot/hand 的左右侧歧义，riding 全局仅一个模块实例，模块级单例无歧义问题。
- **round-12（foot/hand 互斥 P1）**：与本次审核无直接交集，riding 的足骨归属经 registry claimBones/ownedBones 与 foot 模块共享仲裁机制，本测试未 mock bone-override-store，真实仲裁路径被实际执行。

---

**亮点：**
- 断言真正穿透「帧钩子→骨骼覆盖」链路（test:102-117）：直接调用 `data.frameHooks[0](0.5, 'ride-auto')`，断言 `setBoneOverrideSpy` 收到精确 `('左足',[20,0,0],1,true,'ride-auto')` / `('右足',[-20,0,0],1,true,'ride-auto')`——不是「注册过」而是「钩子确实写入骨骼覆盖」；`mockClear()`（test:98）先清掉 bake 写入的腰/膝静态骨，验证钩子写入与 bake 写入互不串扰。
- ensureActive 顺序正确（riding-model.ts:149-190）：先 `bake()` 按当前参数重烤静态骨骼并记录认领足骨（`_ridingFeet`），再按 autoPedal 状态幂等注册/注销钩子（`has(modelId)` 判重），与 module-base.ts:262-279 固化的 91dbe42a 同源 bug 顺序（bake 先于钩子注册）一致，滑块调参不会冻结。
- 帧钩子每帧读活状态（riding-model.ts:160-169）：`getModuleState(modelId, MODULE_ID, getModuleActionId(modelId))` 每帧取最新 enabled/pedalSpeed，用户调 pedalSpeed 下一帧即生效，无模块级参数缓存。
- 让位语义双保险（riding-model.ts:173-175）：钩子内 `owned.has(bone)` 检查，骨骼被其他模块抢占时跳过该足——bake 时的 claim 结果与每帧所有权现状双重防御，与 ensureActive 文档「被占用时让位，不争抢」一致。
- 资源释放闭环（riding-model.ts:196-199 + module-base.ts:236-257）：`onDisable` → `_ridingFrameHooks.unregister(mid)`（调用注册返回的注销函数 + 删 Map 条目）+ `_ridingFeet.delete(mid)`；`createFrameHookManager` 封装 per-model 注册/注销，消除手工 Map get/delete 重复。
- 纯数学抽离（motion-math.ts:30-46）：`computePedalPhase`/`computeFootPitch` 无引擎/状态依赖；t=0.5、pedalSpeed=0.5 → phase 恰为 90°，sin(90°)=1、sin(270°)=-1 为精确值，断言无浮点抖动风险。
- mock 卫生合规（test:7-62）：复用 `stateMockSuperset` 共享工厂（frontend/AGENTS.md 2.3 铁律）、motion-intent 用 `async importOriginal` spread 保留活绑定（registry 的 getSceneMotions/findOrCreateModuleState 走真实实现）、vi.mock 工厂仅引用 `vi.hoisted` 绑定。
- 真实冲突仲裁路径被执行：`bone-override-store` 故意不 mock，`claimBones`/`getOwnedBones`（registry.ts:265-273）走真实 BoneOverrideStore，钩子内 `owned.has` 分支在测试中非空壳。

**风险：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | motion-modules-timed.test.ts | :90-118 | 注销路径零覆盖：autoPedal true→false 的钩子注销分支（riding-model.ts:187-189）、disable() 注销（riding-model.ts:196-199）、帧钩子守卫分支（mid 不匹配 / !s.enabled / feet 空 / owned.has 抢占跳过，riding-model.ts:157-175）均未测 | 补用例：1) setParam('autoPedal', false) 后断言 frameHooks 数组清空；2) disable() 后断言清空 + _ridingFeet 清理；3) 模拟足骨被抢占后钩子跳过该足、另一足仍写入 |
| 🟡 P3 | motion-modules-timed.test.ts | :90-118 | 断言隐式依赖 `DEFAULTS.pedalSpeed=0.5`：test:100 声明 `const _pedalSpeed = 0.5` 却从未使用/显式设置，靠默认值 0.5 凑出 phase=90° 的精确 sin 值 ±20；若默认值改为非二进小数（如 0.3），相位变 54.00000000000001，sin 非精确，toBeCalledWith 将因浮点误报失败 | 显式 `riding.setParam('pedalSpeed', 0.5)` 消除隐式依赖；删除死变量 `_pedalSpeed`；或改用 `toBeCloseTo` 断言欧拉角 |
| 🟡 P3 | motion-modules-timed.test.ts | :34-48 | mock 硬编码 `FRAME_HOOK_ORDER`，`registerFrameHookSpy` 未断言 (hook, order, source) 参数——若生产误传 order（如 SWAY=20）或 source，测试仍绿，无法守护执行序契约 | 断言 `expect(data.registerFrameHookSpy).toHaveBeenCalledWith(expect.any(Function), 10, 'riding-model')` |
| 🟢 P4 | riding-model.ts:43-47,101,131-132；motion-math.ts:45 | 魔法数值跨模块重复：足幅 20°（motion-math `×20` 与 riding bake 静态路径 `×20` 两处）、膝弯 `(1-saddle)*90`、PRESET_LEAN 各预设 | 提为命名常量（如 `FOOT_PITCH_AMP=20`）供 motion-math/riding-model 共用，防两处漂移 |
| 🟢 P4 | riding-model.ts:176 | 左右足判定用 `bone.startsWith('左')` 启发式 | 当前 feet 恒来自 MANAGED_BONES 的 `'左足'/'右足'`，可改为显式左右索引映射（index 0=左），消除命名依赖 |
| 🟢 P4 | docs/adr/adr-116 | :120 | ADR-116 P3 仅列「预设/鞍高/踏板角」，autoPedal/pedalSpeed 自动循环只存于 riding-model.ts:8-15 模块头注释，ADR 未回写 | ADR-116 或 riding 知识卡补一行 autoPedal 规格 |
| 🟢 P4 | riding-model.ts:164-181 | 帧钩子每帧执行 getModuleState（registry+intent 查找）+ getOwnedBones + 每足一次 `bones.find` O(n) 扫描 | 量级轻（2 足/模型）P3 功能可接受；多模型场景可缓存 runtimeBones 索引，观察即可 |
| 🟢 P4 | motion-modules-timed.test.ts | :7-30,67-69 | 测试用 `Map<string, any>`/`makeModel(): any` 逃生；且 riding-model.ts:50 模块级 `_ridingFrameHooks` 单例在用例间残留（本文件因 modelId 各异不串扰，但 resetAll 无法清 SUT 模块级状态） | 定义最小 ModelLike 接口替代 any；如需彻底隔离可给 riding-model 暴露测试重置入口（非阻塞） |

---

**测试质量评价：**

- **断言有效性**：高。核心断言直接穿透帧钩子数组调用并校验 `setBoneOverride` 的精确五元组（骨名/欧拉/权重/enabled/modelId），`mockClear` 分离 bake 静态写入与钩子动态写入——验证「钩子真正写入骨骼覆盖」而非仅「注册过」。test 2 同步锁定 bake 静态路径（pedalAngle=90 → ±20），与钩子路径形成对照。
- **mock 合理性**：高。`stateMockSuperset` 共享工厂复用、motion-intent 用 async importOriginal spread 保活绑定（registry 的 getSceneMotions/findOrCreateModuleState 保持真实）、bone-override mock 中 `applyBoneOverrideIK` 降级转发并有 [doc:adr-122] 注释（丢弃 getRuntimeBones 第 6 参，行为有注释可循）。`bone-override-store` 不 mock 使真实 claimBones/ownedBones 仲裁被执行，属加分项。
- **边界覆盖**：中。仅覆盖 autoPedal=true/false 两条 happy path；钩子注销、disable、让位（抢占跳过）、mid 过滤等守卫分支未覆盖（见 P3 1/3 项）。
- **跳过测试**：无 `.skip`/`.todo`/`.only`。
- **类型安全**：生产代码 0 处新增 `as any`/`@ts-ignore`（grep motion-modules 目录零命中）；测试内 `any` 为测试代码常规做法（P4）。
- **运行验证**：`npm run test -- src/__tests__/scene/motion-modules-timed.test.ts` → 2/2 通过（vitest 4.1.9，562ms）。`npm run check` 未运行（任务允许跳过；本次未改动任何源码，类型基线不受影响）。

---

审核日期：2026-08-15
审核员：子代理 round50-motion-modules-timed
