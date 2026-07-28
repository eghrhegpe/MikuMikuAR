# ADR-192: 上游适配层重构（MmdAdapter）

> **状态**: 已立项 · Phase 2 已完成（2026-07-27 — 条目 3 用公开 API 真正内化、条目 9 经调研确认能力内化不可行改为守卫式反射；tsc 零错误，契约测试 13 + wind-physics 1 + audio 48 全绿）
> **⚠️ 条目 3 后续勘误（ADR-200）**: 条目 3 将 `getRigidBodyBundleMap` 改为读公开 `rigidBodyBundleReferenceCountMap` 属性正确，但隐含假设「该 map 含模型自带刚体」是错的——模型 PMX 刚体走 buildPhysics 在 WASM C++ 侧独立构建，从不进此 map。详见 ADR-200。
> **日期**: 2026-07-27（初版）
> **关联**: ADR-110（上游差异登记册，已转为永久自治台账）、ADR-186（bone-override-frame-timing）、ADR-187（babylon-mmd 剩余 API 分析）、`docs/upstream/babylon-mmd-compatibility.md`（23 处应对清单 + 逆向审计）
> **来源**: 上游 PR #94/#95/#96 全关后战略转「永久自治下游」；`compatibility.md` 逆向审计识别出 4 处仅缓解、未根治的应对

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-27

---

## 背景

上游 PR 路径关闭后，联邦对 babylon-mmd 正式转为「永久自治下游」（见 `docs/upstream/README.md` 定位改写）。`compatibility.md` 逆向审计确认 23 处应对**全部与上游设计立场一致，无冗余、无误判**，但其中存在**质量分层**：

- **A 类（类型层必要补充，上游推荐模式）1/2/4/5/6/7/9/10/11/19/20/23**：上游最小接口策略下的正确消费方式（官方 `overview` §286 句柄模式、§74/§82 两 runtime 不可互换印证），**不是缓解，应保持**。
- **B 类（上游行为 workaround）12/13/14/17**：联邦自实现能力或 bug 规避，B 类中 13 已真正解决上游缺位，但 12/14 仍属**散落补丁**。
- **C 类（构建/测试/架构决策）3/8/15/16/18/21/22**：其中 3 为**反射私有字段**的依赖。

**核心问题**：23 处应对分散在 `frontend/src` 的 15+ 文件中，脆弱依赖（私有字段反射、未文档化时序、已知 bug 规避、`as unknown as` cast）**直接散落在业务代码里**，形成三类隐患：

1. **静默降级风险**：条目 3（反射 `_rigidBodyBundleMap`）、条目 9（反射 `_audio`）依赖上游内部字段名，上游重命名即静默失效，无守卫、无探测。
2. **时序契约缺失**：条目 12（逆工程 `worldMatrix` 时序/坐标系）依赖未文档化行为，散落多文件各自猜时序，无统一契约。
3. **bug 规避散落**：条目 14（`seekAnimation(0)` 补丁）绕过上游 `setRuntimeAnimation` 不重置时钟的已知 bug，补丁散落各调用点，易漏。
4. **维护面过大**：A 类 `as unknown as` cast 散落 15+ 文件（4/6/7/10/11/19/20/23），编译期虽可暴露类型错误，但类型网关无收敛点。

---

## 现状盘点（2026-07-27）

| ID | 应对类型 | 现状方案 | 性质 | 脆弱点 |
|----|---------|---------|------|--------|
| 3 | rigidBody 索引 | 反射 `_rigidBodyBundleMap` 私有字段 | 🔴 **仅缓解** | 依赖上游内部字段名，重命名即静默降级 |
| 9 | 音频句柄 | 反射 `_audio` 私有字段，无守卫 | 🔴 **仅缓解** | 同上；依赖开发者自查 |
| 12 | 骨骼世界矩阵时序 | 逆工程 `worldMatrix` 时序/坐标系，散落注释 | 🔴 **仅缓解** | 依赖未文档化行为，多文件各自猜 |
| 14 | 动画切换时钟 | `seekAnimation(0)` 补丁，散落调用点 | 🔴 **仅缓解** | 绕过上游已知 bug，易漏 |
| 4/6/7/10/11/19/20/23 | 类型网关 | `as unknown as` cast，散落 15+ 文件 | 🟡 **维护性缓解** | 无收敛点，维护面大 |
| 1/2/5/13/17/18/21/22/8/15/16 | 正确消费/自实现/架构决策 | augmentation、自定义 IK、构建/测试 mock 等 | 🟢 **已根治或正确** | — |

**真正需根治的仅条目 3/9/12/14 + 散落 cast 收敛**，其余保持。

---

## 决策

**引入唯一适配层 `MmdAdapter`**，作为联邦业务代码接触 babylon-mmd 的**唯一边界**。所有脆弱依赖（私有字段反射、类型网关、时序控制、bug 规避）收敛到该层，把「缓解补丁」升级为「有意契约」。

```
联邦业务模块（scene/motion, scene/manager, scene/render...）
    │  只依赖联邦自有富类型：RuntimeModel / BoneHandle / PlaybackContract
    ▼
MmdAdapter  ← 唯一接触 babylon-mmd 的模块
    │  私有字段反射 / 类型网关 / 时序控制 / bug 规避 全部隔离于此
    ▼
babylon-mmd（上游：最小接口 + 未文档化行为 + 已知 bug）
```

### 对应 4 处缓解型的根治手段

| ID | 根治手段 | 真正解决什么 | 上游锚点 |
|----|---------|------------|---------|
| 3 | **能力内化**：模型创建时从公开 skeleton 数据自建 rigidBody 索引，`wind-physics` 读联邦索引而非 `_rigidBodyBundleMap` | 彻底摆脱对上游私有字段名的依赖 | — |
| 9 | **能力内化**：联邦自管 `HTMLAudioElement`（自建或传入播放器），不读 `_audio` | 同上 | — |
| 12 | **BoneFrameClock 服务**：把「必须在 onBeforeRender 之后、onAfterAnimations 之前读矩阵」逆工程知识，从散落注释提升为统一服务，对外提供 `getBoneWorldMatrix(bone)` + 坐标系转换 API | 时序契约固化，调用方不再各自猜 | `overview` §153–155（WASM 不能改 prototype/继承） |
| 14 | **PlaybackContract 封装**：`switchAnimation(anim)` 内部统一 `setRuntimeAnimation` + `seekAnimation(0, true)`，调用方不再各自补 seek；同时向上游提 **issue**（非 PR，不被拒）记录该行为为已知限制 | bug 规避从散落补丁变为有意时序契约 | `overview` §286（句柄模式） |

### 附带收益：散落 cast 收敛

A 类 `as unknown as` cast 收敛到适配层边界的**类型网关**一处（Phase 0 实测：`frontend/src` 中真正触及 babylon-mmd 私有字段的散落 cast 仅 **2 个生产文件**——`wind-physics.ts` / `outfit/audio.ts`，其余 `as unknown as` 多位于测试 mock 与联邦自身状态，与上游无关），内部统一用联邦富类型（RuntimeModel / BoneHandle）。类型网关对外暴露 `toRuntimeModel()` / `toBoneHandle()` 等窄接口。

### 探测式降级（条目 3/9 务实折中）

完全脱离上游内部需联邦自实现等价能力（自建物理索引、自管音频），有工程量。采用**探测式降级**：`CapabilityProbe` 在初始化时探测上游字段/行为是否存在，存在则用之，不存在则走联邦自实现降级路径，**绝不静默失效**（与现状「无守卫反射」相反）。

---

## 局限（诚实声明）

1. **A 类无法「真正解决」**：上游最小接口是明确设计决策（官方 §74/§82 印证两 runtime 不可互换）。适配层只能让其「优雅」，不能消除 cast。这是代价而非缺陷。
2. **条目 3/9 完全脱离上游内部需联邦自实现等价能力**，验证自实现与上游行为一致有工程量，故分最高优先级但最后实施。
3. **条目 14 源头 bug 只能由上游修**：联邦侧根治 = 封装 + 提 issue 推动文档化，而非等上游合并。

---

## 分阶段实施路径

| 阶段 | 目标 | 范围 | 风险 |
|------|------|------|------|
| **Phase 0（地基）** | 建 `MmdAdapter` 骨架 + 类型网关，收敛散落 cast | 4/6/7/10/11/19/20/23 → 网关一处 | 🟢 低（纯重构，无行为变更） |
| **Phase 1（契约固化）** | 14 → PlaybackContract；12 → BoneFrameClock | 动画切换、骨骼矩阵读取调用点迁移 | 🟡 中（需核对所有调用点时序） |
| **Phase 2（能力内化）** | 3 → 自建 rigidBody 索引；9 → 自管音频 + CapabilityProbe 降级 | wind-physics、音频播放器 | 🔴 高（需验证自实现等价性） |

**实施前置**：
- Phase 0 落地后，bump `babylon-mmd` 版本时仅需改适配层，业务代码不动。
- 高脆弱点（原条目 3 `_rigidBodyBundleMap` / 9 `_audio`）纳入 `babylon-mmd` 版本 bump 前的必查回归清单（已在 `compatibility.md` 登记）。

---

## 验证

- **Phase 0**：`tsc --noEmit` + 受影响模块单测全绿；确认 `frontend/src` 中真正触及 babylon-mmd 私有字段的散落 cast 仅 2 个生产文件（`wind-physics.ts` / `outfit/audio.ts`），已全部收口到适配层类型网关一处（其余 `as unknown as` 位于测试 mock / 联邦自身状态，与上游无关）。
- **Phase 1**：骨骼矩阵读取统一经 `BoneFrameClock`，原散落时序注释清零；动画切换时钟重置统一经 `PlaybackContract`，`seekAnimation(0)` 散落调用点清零。
- **Phase 2**：`CapabilityProbe` 探测失败时能走联邦自实现降级路径并打日志；wind-physics / 音频播放器不再直接读 `_rigidBodyBundleMap` / `_audio`。

---

## 后续行动

1. **本次**：ADR-192 立项，更新 `docs/upstream/README.md` 关联索引、在 `compatibility.md` 标注 3/9/12/14 为「适配层根治中」。
2. **Phase 0 启动**：✅ 已完成 — 建 `frontend/src/core/mmd-adapter.ts`（`getPhysicsImpl` / `getRigidBodyBundleMap` / `getStreamAudio` 类型网关 + `CapabilityProbe` 骨架 + `BoneFrameClock`/`PlaybackContract` 占位），迁移 wind-physics/audio 私有字段访问，新增 `mmd-adapter.contract.test.ts`；`npm run check` 零错误、受影响单测全绿。
3. **Phase 1**：✅ 已完成 — BoneFrameClock 时序/坐标系契约 + PlaybackContract 切换契约固化（条目 12/14）。
4. **Phase 2**：✅ 已完成 — 见下方「Phase 2 实施记录」。

---

## Phase 2 实施记录（2026-07-27）

**关键调研结论（推翻原 ADR 的"能力内化"预设）**：Phase 2 启动前先核验上游源码（`node_modules/babylon-mmd`），发现两条目可行性不对称：

- **条目 3 可真正内化**：`MmdWasmPhysicsRuntimeImpl` 提供**公开属性** `rigidBodyBundleReferenceCountMap: ReadonlyMap<RigidBodyBundle, number>`（d.ts:233），其 key 与私有 `_rigidBodyBundleMap` 同为 `RigidBodyBundle`；`RigidBodyBundle` 的 `count` / `applyCentralForce` 亦为公开 API。`getRigidBodyBundleMap` 改为 `return impl.rigidBodyBundleReferenceCountMap.keys()`，**彻底脱离私有字段反射**，并删除内部 `RigidBodyBundleLike` 接口与 `CapabilityProbe.hasRigidBodyBundleMap`（已无私有依赖可探测）。
- **条目 9 能力内化不可行**：`StreamAudioPlayer` 构造不接收外部 `HTMLAudioElement` 注入，`_audio` 全程由内部持有且不暴露；联邦的 fade（WebAudio `MediaElementSource`）、`beatDetector.attach`、ended 监听均绑定在内部 `_audio` 上，上游无公开替代 API。故**降级为守卫式反射**：`getStreamAudio` 保留 `_audio` 反射，但首次探测缺失时打一次 dev 警告（`logWarn`），使 babylon-mmd 升级回归立即可见，不再静默失效。`CapabilityProbe.hasStreamAudio` 保留用于探测。

**验证**：`npm run check` 零错误；契约测试 13 + wind-physics 1 + audio 48 全绿（守卫式反射日志已测试触发）。ADR-192 全部 4 处缓解型（3/9/12/14）已收口至 `MmdAdapter` 适配层，联邦对 babylon-mmd 的脆弱依赖收敛完毕。

---

## 审核补遗（2026-07-27）：Phase 0 漏检 ground-collision.ts

**用户预感**："抛开上游处理模型物理的情况，巨容易失效+不可控"。审核 `frontend/src/scene/physics/` + `frontend/src/physics/` 后**部分证实**，并发现 Phase 0 盘点遗漏。

**漏检事实**：ADR-192 Phase 0 记录「`frontend/src` 中真正触及 babylon-mmd 私有字段的散落 cast 仅 2 个生产文件（`wind-physics.ts` / `outfit/audio.ts`）」。实测审核发现第 3 处——`ground-collision.ts:38-40` 的 `(mmdRuntime as unknown as { physics?: { impl?: MmdWasmPhysicsRuntimeImpl } }).physics`，与 `wind-physics` 同性质反射但未收口到适配层。

**判定**：`mmdRuntime` 类型为 `IMmdRuntime | null`（最小接口），不暴露 `.physics`；业务侧直接 `as unknown as` 反射读 `.physics.impl`，babylon-mmd 升级若改字段名即静默失效。**完全命中 ADR-192 立项动机 §22.1「静默降级风险」**，属 Phase 0 漏检。

**修复**：`_getImpl()` 改走 `getPhysicsImpl(mmdRuntime)`，删除散落反射；JS 运行时下 `getPhysicsImpl` 返回 null（因 `.impl` 不存在），与原 `instanceof MmdWasmRuntime` 空转行为等价。`ground-collision.test.ts` 6 测试全绿。

**附带修复（virtual-skirt.ts）**：审核同时发现 `impl.addRigidBody` / `addConstraint` 返回值未检查（上游签名 `boolean`，失败返回 false 不抛异常），表现为"开了虚拟裙骨但裙摆不动"——正是用户预感的"巨容易失效+不可控"。已补返回值检查 + `logWarn` + `dispose()` + `return false`，并补 dispose 异常守卫（impl 已销毁时单个 remove 失败不阻断后续 dispose）。virtual-skirt 23 测试全绿。

**结论**：ADR-192 Phase 0 盘点应补「`ground-collision.ts` 反射收口」为本次审核补遗。物理子系统全量审核见会话记录。

---

## 审核记录（2026-07-27）

**总体结论：有条件通过** — 方向正确、分阶段合理，但需补 4 项细化后启动 Phase 0。

### 事实核验（审核前已做信任但验证）

| 审核引用的断言 | 核验结果 |
|---------------|---------|
| 条目 12 散落 `lighting.ts:196` / `perception-gaze.ts:150` | ✅ 与 `compatibility.md` 登记一致 |
| 条目 14 散落 `vmd-loader.ts:164` 缩略图场景 | ✅ 一致；且实测 `seekAnimation(0,true)` 实际散落 **5 处**：`vmd-loader.ts:171`、`playback.ts:101`、`vmd-layers.ts:721`、`shortcut-app.ts:153/175` |
| 参照 `app.contract.test.ts` 契约测试模式 | ⚠️ 文件名不精确，但项目确有 `*.contract.test.ts` 模式（`env-feature-levels` / `thumbnail-key` / `plaza` / `render-postprocess`） |

### 须追加的细化项（启动 Phase 0 前应落地）

1. **BoneFrameClock 缓存策略（性能）**：`getBoneWorldMatrix(bone)`（世界系版）若在 `onBeforeRender` 热路径每帧调用，适配层须内部缓存上次结果 + dirty 标记，仅在 `onBeforeRenderObservable` 触发时 invalidate，避免每次调用走坐标转换路径引入可测帧开销。**实测更新（2026-07-27 收尾核查）**：业务侧 `perception-gaze` 实际用反向版 `transformWorldToRootLocal`、`lighting` 用注册式 `onBoneMatricesUpdated`，均不每帧调 `getBoneWorldMatrix`；且 mmd-adapter 的世界系 `getBoneWorldMatrix` **当前无业务调用方、仅契约测试覆盖**。故缓存策略暂不落地，待该 API 被热路径采用时再补（同名局部系函数已在 `physics-bridge.ts` 更名为 `getBoneLocalMatrix` 以消除歧义）。
2. **Phase 2 增加「守卫式反射」中间档（风险缓解）**：条目 3/9 的最终目标是能力内化，但应先做**守卫式反射**（`if (!field) { log + degrade }` + 单测覆盖）作为中间态，验证 `CapabilityProbe` 机制后再考虑完全内化。避免高工程量一步到位。
3. **适配层契约测试策略（测试覆盖）**：每个出口（类型网关 / BoneFrameClock / PlaybackContract）提供 contract test，参照项目 `*.contract.test.ts` 模式，验证 cast 后类型签名稳定、降级路径可测。
4. **PlaybackContract 范围界定（基于实测 5 处散落）**：只封装「`setRuntimeAnimation` + `seekAnimation(0)`」这一切换+重置组合（对应 `vmd-loader.ts:171` / `playback.ts:101` / `vmd-layers.ts:721` 的切换场景）；快进快退（`shortcut-app.ts:153/175`）、auto-loop、`seekTo(targetTime)`（`playback.ts:191`）属合法 seek，**不纳入** PlaybackContract，避免职责过载反模式。

### 附加约束

- **迁移期双轨并存**：先建适配层 + 契约测试（保留旧 cast），再批量迁移调用点；中间状态部分文件用适配层、部分仍直接 cast 不破坏现有测试。
- **Phase 0 真实动机澄清**：主要价值是为 Phase 1/2 提供落地锚点（MmdAdapter 骨架 + 类型网关），而非独立改善健壮性——A 类 `as unknown as` 是上游推荐消费模式（§286），散落无运行时风险。

