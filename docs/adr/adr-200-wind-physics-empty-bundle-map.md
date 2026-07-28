# ADR-200: 风力对模型自带刚体无效 — 遍历 map 恒空的架构误解

> **状态**: ✅ 已确认（根因定位，2026-07-28 — 经 babylon-mmd 源码逐层核实，wind-physics 遍历的 `rigidBodyBundleReferenceCountMap` 从不含模型自带刚体）
> **关联**: ADR-192（条目 3「rigidBody 索引内化」，本 ADR 推翻其等价性假设）、ADR-194（风力系数 0.15→1.0，建立在同一错误假设上）、ADR-084（虚拟裙骨 — 唯一真正受风的自建 Dynamic 刚体）
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

**判定**：技术上可行，但需（a）反射两层私有字段拿 bundle，（b）读 `rigidBodyData[i].physicsMode` 筛 Dynamic，（c）可能改施力方式。综合脆弱度 + 收益，直接对模型刚体施力**不推荐**。

---

## 四、决策

**推翻 ADR-192 条目 3 / ADR-194 的隐含前提「wind-physics 能作用于模型自带刚体」，将其如实标注为「仅作用于联邦自建刚体」。不改动风力系统的目标刚体范围。**

### 4.1 事实澄清（写入相关模块注释）

- `rigidBodyBundleReferenceCountMap` 的语义 = 「JS 侧经 `addRigidBodyBundle` 手动加入的刚体」，**不含模型自带 PMX 刚体**。
- 风力（ADR-194）对**虚拟裙骨（ADR-084）与地面碰撞刚体**有效——它们才是真正进入该 map 的联邦自建 Dynamic 刚体。这解释了为何虚拟裙骨受风、模型原生头发不受风。
- 角色原生头发/裙子的摆动，应由 **VMD 动画 + WASM 内建物理**驱动（模型自带刚体在 WASM C++ 侧自解算），而非外部风力注入。

### 4.2 非目标

- ❌ 不引入 `model._physicsModel._bundle` 两层私有字段反射（违背 ADR-192 收口原则）。
- ❌ 不为「风吹原生头发」加大 `WIND_FORCE_SCALE`（对空 map 无意义）。
- ❌ 不推动上游为 `MmdWasmModel` 增开施力 API（留作远期 Option）。

### 4.3 `windPhysicsActive === false` 的次要问题

即便 map 非空，现场 `windPhysicsActive === false` 说明 observer 未订阅。`_trySubscribe` 依赖 `getPhysicsImpl(runtime)` 返回非 null，且由 model-loader 在模型加载后 `retryWindPhysicsSubscription` 重试。此问题独立于主根因（订阅上了也是遍历空 map），本 ADR 不展开；若后续要让风作用于虚拟裙骨/地面刚体，需一并核查订阅时机。

---

## 五、后续方向（按优先级）

1. **文档止血（本 ADR + 注释）**：立即消除「风能吹角色头发」的错误预期，防后人再调系数。
2. **风只作用虚拟裙骨（ADR-084 路径）**：若产品需要「可被风吹的头发/裙」，走联邦自建 Dynamic 刚体（虚拟裙骨），它天然进 map、天然受风。这是已验证可行的正道。
3. **上游 Option（远期）**：向 babylon-mmd fork 暴露 `MmdWasmModel.applyForceToRigidBody(index, force)` 公开 API，绕开私有反射。仅在 2 无法满足需求时启动。

---

## 六、验证方法

复现（WASM runtime，加载角色，无虚拟裙骨/地面碰撞）：

```js
window.__scene.rigidBodyBundleCount   // 0（证实 map 空）
window.__scene.windPhysicsActive      // false
```

反证（加载虚拟裙骨或开地面碰撞后）：`rigidBodyBundleCount` 应 > 0，此时风力对这些自建刚体生效。

---

## 七、相关文件

| 文件 | 角色 |
|------|------|
| [wind-physics.ts](../../frontend/src/physics/wind-physics.ts) | 遍历 map 施力（目标集为空的受害方） |
| [mmd-adapter.ts](../../frontend/src/core/mmd-adapter.ts) | `getRigidBodyBundleMap` = `rigidBodyBundleReferenceCountMap.keys()`（语义需在注释澄清） |
| [virtual-skirt.ts](../../frontend/src/scene/physics/virtual-skirt.ts) | 唯一真正进 map 的自建 Dynamic 刚体（ADR-084） |
| [ground-collision.ts](../../frontend/src/scene/physics/ground-collision.ts) | 自建静态刚体，进 map |
| adr-192 / adr-194 | 隐含错误前提，需交叉引用本 ADR |
