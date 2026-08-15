# mmd-adapter 契约层 — 审核结果（round-40 / 契约测试反推源码）

## 头部

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/mmd-adapter.contract.test.ts`（246 行，16 用例，无 skip/only/todo） |
| 被测源码（主目标） | `frontend/src/core/mmd-adapter.ts`（506 行）：契约函数 `getPhysicsImpl` L39-57、`getRigidBodyBundleMap` L75-77、`getStreamAudio` L110-124、`applyForceToModelRigidBodies` L146-186、`CapabilityProbe` L390-397、`onBoneMatricesUpdated` L412-414、`transformWorldToRootLocal` L425-440、`getBoneWorldMatrix` L451-458、`switchAnimation` L478-506 |
| 关联依赖 | `@/core/observer-handle.ts`（observe/ObserverHandle，L62-71/L31-54）、`@/core/types.ts:176-186`（RuntimeModel augmentation）、babylon-mmd 真实类型（IMmdRuntime / IMmdRuntimeBone / IMmdBindableModelAnimation / MmdWasmPhysicsRuntimeImpl / StreamAudioPlayer） |
| 与历史轮次关系 | **round-12** 整体审 mmd-adapter（⚠️，含"native 桥无直接单测"）；**round-26** 审 native 施力层（`applyForceToModelRigidBodiesNative`/`solveIkNative`/`applyWindForceToModelRigidBodiesNative`，✅，由 `mmd-adapter.native.test.ts` 覆盖）；**round-28** 审 `switchAnimation` 的 dispose 契约（`vmd-layers.test.ts` 覆盖 dispose 抛异常/null 句柄）。本测试是第三视角：**ADR-192 网关/契约层**（私有字段反射收口 + Phase 1 时序/坐标系/切换契约），与 round-26 的 native 桥（wasm 导出）互补，二者共同覆盖 mmd-adapter 全函数面 |
| 验证结果 | `cd frontend && npm run test -- src/__tests__/mmd-adapter.contract.test.ts` → **16/16 通过（8ms）**。`npm run check`（tsc + i18n 全量）未执行——契约函数与 babylon-mmd 类型的 tsc 兼容性由本文件直接引用型签名部分佐证，全量基线由本轮主模型汇总确认；如需可汇总阶段补跑 |

**总体结论：✅ 通过**（P1×0 / P2×0 / P3×4 / P4×6；其中 1 条 P3 为 round-19 遗留告警文案漂移，非本层新引入）

---

## 亮点

- **契约测试是真"逻辑测试"而非自证式**（`contract.test.ts:24-37`）：测试直接 import 真实生产 `mmd-adapter.ts`（仅 mock logger 为副作用隔离不足——实际未 mock，见风险表），用最小形状 fake 对象驱动真实函数，与 round-22 批评的 wind-physics `_getBundles` 自证式 mock 形成对照；`getRigidBodyBundleMap` 用例（:40-52）正是 round-22 报告中"真实护栏在 mmd-adapter.contract.test.ts"所指的落点——若生产回退读私有 `_rigidBodyBundleMap`，mock 无该字段 → `undefined.keys()` 抛错 → 测试变红，语义契约真实可测。
- **真实数学验证坐标系契约**（`contract.test.ts:160-188`）：`transformWorldToRootLocal`/`getBoneWorldMatrix` 用真实 `Matrix`/`Vector3`（非 mock）断言 `m[12]=5` 与原点映射，把 ADR-071 坐标系陷阱（骨骼 worldMatrix 为 rootMesh 局部系）钉成可执行规格；`getBoneWorldMatrix` 对齐上游 `IMmdRuntimeBone.worldMatrix: Float32Array`（IMmdRuntimeBone.d.ts:47）真实类型。
- **生产端"守卫式反射 + 绝不静默失效"哲学落实**（`mmd-adapter.ts:110-124/163-186`）：`getStreamAudio`/`applyForceToModelRigidBodies` 对上游私有/半私有字段缺失均降级返回且首次打一次 dev 警告；`FOLLOW_BONE=0` 命名常量（:146）替代魔法数，筛选语义（FollowBone 每帧被骨骼变换覆盖故跳过）有官方注释依据（mmdBulletPhysics.js:150-151/:335-346）。
- **lazy impl 主动创建收口**（`mmd-adapter.ts:39-57`）：`physics.impl` 为 null 时主动 `getImpl(MmdWasmPhysicsRuntimeImplClass)`（对齐 virtual-skirt.ts:289），修 wind-physics `windPhysicsActive===false` 真因（ADR-200）；测试（`contract.test.ts:65-73`）断言 getImpl 恰好调用一次且返回值透传，行为契约锁定。
- **switchAnimation 五步序列契约完整固化**（`mmd-adapter.ts:478-506` + `contract.test.ts:213-244`）：解绑 → dispose 旧（回收 WASM AnimCurve）→ 创建 → 绑定 → `seekAnimation(0,true)` 归零，seq 断言逐序验证（含 seek 抛错不阻断切换的 try/catch 分支），与 round-28 的 vmd-layers 测试形成双保险。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | frontend/src/core/mmd-adapter.ts | :120 | **round-19 遗留告警文案漂移**：`getStreamAudio` 降级警告写"检查 apply-vendored-wasm.mjs"，但该脚本已孤儿化（package.json 无任何引用，postinstall 机制已被 ADR-202 `-dist` 分支取代，round-19 已标记未修）；升级排障时把排查者引向 404 机制 | 文案改为"fork -dist 分支产物缺失 get audio()，检查 vendored-patch.test.ts 与 babylon-mmd 版本"；同步刷新 docs/knowledge/mmd-adapter.md（round-12 亦已标记） |
| 🟡 P3 | frontend/src/__tests__/mmd-adapter.contract.test.ts | :24-37（mock 工厂）+ 全文 | **契约测试自身不构成类型级上游漂移探测器**：`mockPhysicsImpl`/`mockRuntime`/`mockPlayer` 全部 `as unknown as <上游类型>` 强转，绕过对真实 babylon-mmd 类型的 tsc 检查——上游重命名公开字段（如 `rigidBodyBundleReferenceCountMap`）时本测试**不会变红**；类型级漂移实际由 `npm run check`（mmd-adapter.ts:76/97 直接引用上游类型）兜底。文件头无注释说明这一分工，易误读为"升级漂移由本测试守护" | 文件头补契约边界注释：类型漂移→tsc、语义/降级契约→本测试、私有字段漂移→运行期 dev 警告 + bump 回归清单；或对 `getRigidBodyBundleMap` 侧改 `satisfies` 形状校验（受 `strict:false` 限制，注释方案更现实） |
| 🟡 P3 | frontend/src/core/mmd-adapter.ts | :483-486 + 测试未覆盖 | **`currentAnimation` 漂移→静默 WASM 泄漏**：`switchAnimation` 经 cast 读私有 `currentAnimation`，上游若移除该字段，`prevAnim` 恒 null → dispose 被跳过 → 旧 AnimCurve 泄漏，且**无任何降级警告**（对比 getStreamAudio/applyForce 均有 once 警告）；测试也未覆盖"currentAnimation 缺失"分支 | 与 getStreamAudio 同模式补 once 警告（`_currentAnimationMissingWarned` + logWarn），契约测试补"currentAnimation 缺失 → 跳过 dispose 不抛错"用例 |
| 🟡 P3 | frontend/src/core/mmd-adapter.ts | :96-98 | **`getRigidBodyMap`（单数容器）零直接测试**：与 `getRigidBodyBundleMap` 平行但语义不同（含 ADR-084 虚拟裙骨/地面碰撞刚体），仅在 wind-physics 两测试中被 mock（`getRigidBodyMap: () => []` / `vi.fn`）——真实实现 `impl.rigidBodyReferenceCountMap.keys()` 的行为无契约钉住，只靠 tsc 保属性名 | 在本契约测试补 1 用例（mock 提供 `rigidBodyReferenceCountMap` Map → 断言 keys 透传），与 :40-52 对称 |
| 🟢 P4 | frontend/src/__tests__/mmd-adapter.contract.test.ts | :109-123、:66-73 | logger **未 mock**：降级用例触发真实 `logWarn` 打到 stderr（实测输出可见），警告文案（漂移诊断的关键信息）未被断言，文案被改坏测试仍绿；`getImpl` 断言了调用次数但未断言参数（应传 `MmdWasmPhysicsRuntimeImplClass`） | mock `@/core/logger`（对齐 native.test.ts 先例）消除 stderr 噪音；警告用例加 `expect(logWarn).toHaveBeenCalledWith('mmd-adapter', expect.stringContaining(...))`；`getImpl` 用例断言 `toHaveBeenCalledWith(MmdWasmPhysicsRuntimeImplClass)` |
| 🟢 P4 | frontend/src/__tests__/mmd-adapter.contract.test.ts | :136-146 | `onBoneMatricesUpdated` mock 的 `add` 返回回调本身 cast 成 `ObserverHandle`——形状谎言（ObserverHandle 不是回调），仅因生产 `observe()` 只包裹不调用才不炸；dispose 移除行为未在本文件验证（由 round-17 observer-handle 层覆盖） | 可接受，建议注释声明"observe 包裹语义 + dispose 由 observer-handle 层测试负责"，防止后人误读 |
| 🟢 P4 | frontend/src/__tests__/mmd-adapter.contract.test.ts | :172-176、:425-440 | `transformWorldToRootLocal` 未覆盖 `getWorldMatrix` 返回 falsy 分支（mmd-adapter.ts:434 `if (!rootWorld) return false`）；`applyForceToModelRigidBodies` 未覆盖 `data` 短于 `count` 的稀疏边界（:180 `data[i]?.` 防御分支） | 补 2 个低成本用例：mock getWorldMatrix 返回 null → false；count=3 但 rigidBodyData 长 1 → 不抛错 |
| 🟢 P4 | frontend/src/core/mmd-adapter.ts | :53-54 | `physics.getImpl(...)` 无 try/catch：若上游 lazy 构造抛错，异常向上传播（契约测试未覆盖此分支；虚拟裙衣同模式，风险极低） | 可选：包 try/catch 降级返回 null + once 警告；或维持现状并在注释声明调用方契约 |

---

## 测试质量评价

- **有效性（断言是否落到生产逻辑）**：✅ 高。16 用例全部直接调用真实 `mmd-adapter.ts` 生产函数（仅 fake 上游对象），无一处 vi.mock 生产模块；`applyForceToModelRigidBodies` 用 `mock.calls[0][0]` 逐索引断言施力筛选（仅 Physics=1/PhysicsWithBone=2，跳过 FollowBone=0），`switchAnimation` 用 seq 数组断言五步严格顺序，均命中真实分支而非 mock 重实现。
- **mock 合理性（真实类型仅类型用？）**：⚠️ 部分。babylon-mmd 的 5 个 import 均为 `import type`（L5-9），类型层面确实"仅类型用、零实例化"；但 mock 工厂的 `as unknown as` 强转使这些类型退化为注释性形状声明，**真实类型契约并未被本测试执行**——类型契约的实际执行者是生产文件 mmd-adapter.ts 的直接类型引用 + tsc。fake 形状本身与上游 .d.ts 逐一核对一致（`rigidBodyBundleReferenceCountMap`/`rigidBodyReferenceCountMap` 公开 getter：mmdWasmPhysicsRuntimeImpl.d.ts:237/241；`audio` 公开 getter：streamAudioPlayer.d.ts:123；`worldMatrix: Float32Array`：IMmdRuntimeBone.d.ts:47；`seekAnimation(frameTime, forceEvaluate): Promise<void>`：IMmdRuntime.d.ts:185；`dispose?()` 可选：IMmdRuntimeAnimation.d.ts:46）。
- **边界覆盖**：✅ 良好。空实例（physics undefined/null → null）、无 physics impl 的 lazy 创建、`_physicsModel` 缺失降级返回 0、`audio` 缺失降级、`getWorldMatrix` 缺失降级、seek 抛错不阻断——降级/异常面覆盖完整；缺口集中在 P3/P4 表列的稀疏/极端分支（currentAnimation 缺失、getRigidBodyMap、data 短于 count、rootWorld falsy）。
- **跳过测试**：✅ 无（grep `.skip/.only/.todo` 零命中）。
- **能否防 babylon-mmd 升级漂移**：⚠️ **能防"语义回归"，不防"类型漂移"（须与 tsc 分工理解）**。本测试真正钉住的是适配层行为契约（读公开属性而非私有字段、缺失时按契约降级、五步切换顺序）；上游**公开字段重命名**（rigidBodyBundleReferenceCountMap 等）由 tsc 对 mmd-adapter.ts:76/97 的引用变红；上游**私有字段漂移**（physics/`_physicsModel._bundle`/currentAnimation）依赖运行期 once 警告——其中 getStreamAudio/applyForce 两条有警告、**currentAnimation 一条无警告**（P3）。升级回归清单已在 mmd-adapter.ts 头注释（:8-11）声明。结论：分层防护设计成立（tsc 结构层 + 本测试语义层 + 运行期警告反射层 + vendored-patch.test.ts fork 产物层 + bump 清单），但"契约测试"命名易高估其单层能力，且 currentAnimation 层存在无警告空洞，建议按 P3 补。

---

- 审核日期：2026-08-15
- 审核员：子代理 round40-mmd-adapter-contract
