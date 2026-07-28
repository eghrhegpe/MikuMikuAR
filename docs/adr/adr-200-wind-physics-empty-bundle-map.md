# ADR-200: 风力对模型自带刚体无效 — 遍历 map 恒空的架构误解

> **状态**: ✅ 已实施（2026-07-28 — 根因定位后经守卫式反射扩展风力至模型原生真物理刚体 + 修复 lazy impl 订阅；tsc 零错误，wind-physics 16 + mmd-adapter 契约 16 + app.contract 17 全绿）
> **关联**: ADR-192（条目 3「rigidBody 索引内化」，本 ADR 推翻其等价性假设 + 复用条目9 守卫式反射范式）、ADR-194（风力系数 0.15→1.0，建立在同一错误假设上）、ADR-084（虚拟裙骨 — 仅对无裙骨模型生效，非主流模型可行替代）
> **症状**: WASM 物理运行完全正常，粒子/水面随风飘动明显，但对角色施加 10× 风力，头发/裙子纹丝不动。`window.__scene.rigidBodyBundleCount === 0`、`windPhysicsActive === false`。

---

## 一、症状与现场证据

| 观测（`window.__scene`） | 值 | 含义 |
|--------------------------|-----|------|
| `rigidBodyBundleCount` | **0** | 物理 impl 的 `_rigidBodyBundleMap` 为空 |
| `windPhysicsActive` | **false** | 风力 observer 未订阅 |
| 粒子 / 水面 | 随风飘 | JS 子系统正常 |
| 角色头发 / 裙子 | 僵硬（10× 风力无效） | 风力从未触达模型刚体 |

用户实测复现："babymmd 运行完全正常，往角色施加 10 倍风力都看不见效果，粒子都横着飞了，头发都没动静。"

---

## 二、根因（babylon-mmd 源码逐层核实）

### 2.1 模型自带刚体走独立构建，绕过 JS 侧 map

[mmdWasmModel.js:198-206](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/mmdWasmModel.js) 构造模型物理时：

```js
if (physicsParams !== null) {
    this._physicsModel = physicsParams.physicsImpl.buildPhysics(
        mmdSkinnedMesh, runtimeBones, rigidBodies, joints, wasmRuntime, physicsOptions
    );
}
```

模型的所有 PMX 刚体经 `buildPhysics(...)` 打包成一个 `MmdBulletPhysicsModel`，其内部持有私有 `_bundle`（[mmdBulletPhysics.js:40/59](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/mmdBulletPhysics.js)）。**该路径完全不调用 `impl.addRigidBodyBundle(...)`**。

### 2.2 `rigidBodyBundleReferenceCountMap` 只记录 JS 侧手动加入的刚体

[mmdWasmPhysicsRuntimeImpl.js:281-289](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl.js)：只有显式调用 `addRigidBodyBundle` 才会 `_rigidBodyBundleMap.set(bundle, count)`。而 `rigidBodyBundleReferenceCountMap` 只是 `_rigidBodyBundleMap` 的公开 getter（js:668-669）。

**结论**：这张 map 里只有联邦自己 `addRigidBodyBundle` 的东西——**虚拟裙骨（ADR-084）与地面碰撞（ground-collision.ts）**。模型自带的头发/裙子刚体永远不在其中。未加载虚拟裙骨、未开地面碰撞时，map 恒为空 → `size === 0`。

### 2.3 wind-physics 建立在错误假设上

[wind-physics.ts](../../frontend/src/physics/wind-physics.ts) 的 `_onPhysicsSync` 遍历 `getRigidBodyBundleMap(impl)`（即 `rigidBodyBundleReferenceCountMap.keys()`），对每个刚体 `applyCentralForce`。它**假设这张 map 含角色刚体**——该假设从 ADR-192 条目 3 内化时就是错的。map 为空 → 循环体一次都不执行 → 风力零施加。

### 2.4 ADR-192 / ADR-194 的连锁误判

- **ADR-192 条目 3**："`getRigidBodyBundleMap` 改为 `rigidBodyBundleReferenceCountMap.keys()`，与私有 `_rigidBodyBundleMap` **key 同为 RigidBodyBundle**，彻底脱离私有字段反射。" —— 属性替换本身正确（二者确为同一 map），但**内化前后都不含模型刚体**，即「脱离私有字段」的同时也确认了「本就拿不到目标刚体」，只是当时未察觉。
- **ADR-194 §4**："`WIND_FORCE_SCALE` 0.15→1.0，风速 10 产生 10N，Dynamic 刚体摆动明显。" —— 调大一个从未生效的系数，自然无效。ADR-194 测试仅验证 `applyCentralForce` 被以正确力值调用（mock bundle），未验证 map 里真有模型刚体，故绿测未暴露此坑。

---

## 三、模型刚体能否被施力（可行性核实）

模型刚体 `_bundle` 类型为 `MmdRigidBodyBundle extends RigidBodyBundle`（mmdBulletPhysics.js:25），**确实拥有公开 `applyCentralForce` / `setLinearVelocity`**。因此「对模型刚体施力」在物理上可行，但访问路径与筛选存在硬约束：

| 障碍 | 说明 |
|------|------|
| **无公开访问路径** | bundle 藏在 `model._physicsModel._bundle`，两层均为 private，`MmdWasmModel` 只暴露只读 `rigidBodyStates: Uint8Array`（不能施力）。取 bundle 必须反射两层私有字段——正是 ADR-192 极力消除的脆弱依赖。 |
| **必须按 physicsMode 筛选** | bundle 内混合 `FollowBone`（Kinematic，骨骼跟随）与 Dynamic 刚体（mmdBulletPhysics.js:163）。MMD 头发/裙子多为 `FollowBone` 或物理+骨骼对齐型，对其 `applyCentralForce` 被 Bullet 忽略或每帧被骨骼位置拉回。无脑全施力仍看不出效果。 |
| **力对抗骨骼对齐** | 物理+骨骼对齐型刚体每帧被 `syncBodies` 拉向骨骼位置（js:193），瞬时 central force 对抗不过位置约束，须改用持续 velocity 或改物理模式。 |

**判定**：技术上可行，需（a）反射两层私有字段拿 bundle，（b）读 `rigidBodyData[i].physicsMode` 筛真物理刚体（Physics/PhysicsWithBone），（c）施力方式。虚拟裙骨（ADR-084）要求「模型无裙骨」，对主流正经模型 `build() 返回 false`，**非可行替代**。故最终决策：采用守卫式反射施力（详见 §四），套 ADR-192 条目9 已有先例。

---

## 四、决策（已实施）

**经守卫式反射扩展风力至模型原生真物理刚体，套用 ADR-192 条目9「反射 + 探测降级」范式。** 不引入散落私有反射——统一收口到 `mmd-adapter` 适配层一处。

### 4.1 实施内容

- **`mmd-adapter.applyForceToModelRigidBodies(model, force)`**：反射 `model._physicsModel._bundle`（MmdRigidBodyBundle），遍历 `bundle.count`，仅对 `rigidBodyData[i].physicsMode !== FollowBone(0)`（即 Physics(1)/PhysicsWithBone(2)）的真物理刚体 `applyCentralForce`。`_physicsModel`/`_bundle` 缺失 → 返回 0 + 一次性 dev 警告（升级回归可见）。
- **`wind-physics._onPhysicsSync`**：在原自建刚体（虚拟裙骨/地面）施力后，新增遍历 `modelRegistry` 对每个 `kind === 'actor'` 模型调 `applyForceToModelRigidBodies`。
- **`mmd-adapter.getPhysicsImpl` lazy impl 修复**：被动 `.impl` 为 null 时主动 `getImpl(MmdWasmPhysicsRuntimeImpl)` 强制创建（同 virtual-skirt），解决 §4.3 的 `windPhysicsActive === false`。
- **`CapabilityProbe.hasModelPhysicsBundle`**：升级回归探测。

### 4.2 判据来源

`physicsMode` 筛选依据 mmdBulletPhysics.js:150-151 官方注释 + :331-346 `syncBodies` 分支：Physics/PhysicsWithBone 在 syncBodies 中 `break`（纯 Bullet 自解算，施力生效）；FollowBone 每帧被骨骼位置拉回（施力无效，跳过）。

### 4.3 lazy impl 订阅修复（原次要问题，已解决）

现场 `windPhysicsActive === false` 真因：WASM 内建物理下 `MmdWasmPhysicsRuntime._impl` 是 lazy 的（mmdWasmPhysicsRuntime.js:103-110），只有首次 `getImpl(ctor)` 才创建。wind-physics 经 `getPhysicsImpl` 走被动 `.impl` getter，无人主动取则恒 null → observer 订阅失败。已在 `getPhysicsImpl` 内改为被动 null 时主动 `getImpl`。

---

## 五、后续方向

1. **实测调优（P1）**：`wails3 dev` 加载正经模型验证头发/裙子摆动幅度。**实测发现 1.0 系数下摆幅偏弱**（MMD 头发刚体阻尼高），已为模型原生刚体引入**独立系数 `MODEL_WIND_FORCE_SCALE`（起点 5.0）**，与自建刚体 `WIND_FORCE_SCALE=1.0` 解耦（互不影响手感）。若 5.0 仍偏弱/过强，直接调该常量；若因 Bullet 阻尼持续耗散导致稳态摆幅不足，改用 `setLinearVelocity` 增量替代 `applyCentralForce`。

> **syncBodies 核实纠正**：原担心「PhysicsWithBone 每帧被骨骼拉回」——实测 mmdBulletPhysics.js:324-346，正常播放（无物理开关禁用）时 Physics/PhysicsWithBone 在 syncBodies 中仅 `break`（不拉回，纯Bullet 自解算）。摆幅偏弱是力 vs 阻尼/惯性的量级问题，非拉回，故调大系数有效。
2. **风力系数复核**：ADR-194 的 `WIND_FORCE_SCALE=1.0` 原针对空 map 无意义，现真正作用于模型刚体后需按实测手感重新标定。
3. **上游 Option（远期）**：向 babylon-mmd fork 暴露 `MmdWasmModel.applyForceToRigidBody(index, force)` 公开 API，绕开私有反射。仅在反射路径因上游变更频繁失效时启动。

### 虚拟裙骨（ADR-084）定位澄清

虚拟裙骨要求「模型无裙骨」（i18n `cloth.hint`：仅对无裙骨模型生效；`build()` 对已有裙骨模型返回 false）。故它**仅救简陋无骨模型**，非主流正经模型（自带裙骨+物理刚体）的风力方案。本 ADR 的反射施力才是正经模型受风的主路径。

---

## 六、验证方法

**修复前复现**（WASM runtime，加载角色，无虚拟裙骨/地面碰撞）：`rigidBodyBundleCount === 0`、`windPhysicsActive === false`，10× 风力头发纹丝不动。

**修复后验证**（`wails3 dev` 加载正经模型、开风、风速拉满）：
- `window.__scene.windPhysicsActive` 应为 `true`（lazy impl 主动创建、observer 订阅生效）
- 现象：头发/裙子随风摆动（对比修复前纹丝不动）
- 单测：`applyForceToModelRigidBodies` 仅对 Physics/PhysicsWithBone 施力、跳过 FollowBone（mmd-adapter 契约测试）；`_onPhysicsSync` 对 actor 模型调施力、跳过 stage（wind-physics 测试）

---

## 七、相关文件

| 文件 | 角色 |
|------|------|
| [wind-physics.ts](../../frontend/src/physics/wind-physics.ts) | `_onPhysicsSync` 双路径施力：自建刚体（map）+ 模型原生刚体（actor 遍历） |
| [mmd-adapter.ts](../../frontend/src/core/mmd-adapter.ts) | 新增 `applyForceToModelRigidBodies`（守卫式反射施力）+ `getPhysicsImpl` lazy impl 主动创建 + `CapabilityProbe.hasModelPhysicsBundle` |
| [virtual-skirt.ts](../../frontend/src/scene/physics/virtual-skirt.ts) | 自建 Dynamic 刚体（ADR-084，仅无裙骨模型） |
| [ground-collision.ts](../../frontend/src/scene/physics/ground-collision.ts) | 自建静态刚体，进 map |
| adr-192 / adr-194 | 隐含错误前提，已交叉引用本 ADR |
