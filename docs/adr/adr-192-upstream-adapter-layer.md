# ADR-192: 上游适配层重构（MmdAdapter）

> **状态**: 已立项 · Phase 0（2026-07-27 — 方案确认，尚未落代码）
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

A 类 `as unknown as` cast 收敛到适配层边界的**类型网关**一处，内部统一用联邦富类型（RuntimeModel / BoneHandle），15+ 文件不再各自 cast。类型网关对外暴露 `toRuntimeModel()` / `toBoneHandle()` 等窄接口。

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

- **Phase 0**：`tsc --noEmit` + 受影响模块单测全绿；确认 `frontend/src` 业务文件 `as unknown as` 计数从 15+ 降至适配层边界 1 处。
- **Phase 1**：骨骼矩阵读取统一经 `BoneFrameClock`，原散落时序注释清零；动画切换时钟重置统一经 `PlaybackContract`，`seekAnimation(0)` 散落调用点清零。
- **Phase 2**：`CapabilityProbe` 探测失败时能走联邦自实现降级路径并打日志；wind-physics / 音频播放器不再直接读 `_rigidBodyBundleMap` / `_audio`。

---

## 后续行动

1. **本次**：ADR-192 立项，更新 `docs/upstream/README.md` 关联索引、在 `compatibility.md` 标注 3/9/12/14 为「适配层根治中」。
2. **Phase 0 启动**：建 `MmdAdapter` 骨架，先收敛散落 cast（最低风险、最快见效）。
3. **Phase 1/2**：按上表分阶段推进，每阶段独立 commit + 单测回归。

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

1. **BoneFrameClock 缓存策略（性能）**：`getBoneWorldMatrix(bone)` 在 `onBeforeRender` 热路径被 `perception-gaze` / `lighting` 每帧调用。适配层须内部缓存上次结果 + dirty 标记，仅在 `onBeforeRenderObservable` 触发时 invalidate，避免每次调用走坐标转换路径引入可测帧开销。
2. **Phase 2 增加「守卫式反射」中间档（风险缓解）**：条目 3/9 的最终目标是能力内化，但应先做**守卫式反射**（`if (!field) { log + degrade }` + 单测覆盖）作为中间态，验证 `CapabilityProbe` 机制后再考虑完全内化。避免高工程量一步到位。
3. **适配层契约测试策略（测试覆盖）**：每个出口（类型网关 / BoneFrameClock / PlaybackContract）提供 contract test，参照项目 `*.contract.test.ts` 模式，验证 cast 后类型签名稳定、降级路径可测。
4. **PlaybackContract 范围界定（基于实测 5 处散落）**：只封装「`setRuntimeAnimation` + `seekAnimation(0)`」这一切换+重置组合（对应 `vmd-loader.ts:171` / `playback.ts:101` / `vmd-layers.ts:721` 的切换场景）；快进快退（`shortcut-app.ts:153/175`）、auto-loop、`seekTo(targetTime)`（`playback.ts:191`）属合法 seek，**不纳入** PlaybackContract，避免职责过载反模式。

### 附加约束

- **迁移期双轨并存**：先建适配层 + 契约测试（保留旧 cast），再批量迁移调用点；中间状态部分文件用适配层、部分仍直接 cast 不破坏现有测试。
- **Phase 0 真实动机澄清**：主要价值是为 Phase 1/2 提供落地锚点（MmdAdapter 骨架 + 类型网关），而非独立改善健壮性——A 类 `as unknown as` 是上游推荐消费模式（§286），散落无运行时风险。

