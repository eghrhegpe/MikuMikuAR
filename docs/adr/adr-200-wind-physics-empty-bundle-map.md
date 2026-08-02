# ADR-200: 风力对模型自带刚体无效 — 遍历 map 恒空的架构误解

> **状态**: ✅ 已定性（2026-07-28 — WASM 内建物理下 JS 侧根本无模型物理对象（`_physicsModel === null`），施力方案为死路已回退；保留 lazy impl 订阅修复（对自建刚体有效））
> **日期**: 2026-07-28
> **关联**: ADR-192（条目 3「rigidBody 索引内化」，本 ADR 推翻其等价性假设）、ADR-194（风力系数 0.15→1.0，建立在同一错误假设上）、ADR-084（虚拟裙骨 — 仅对无裙骨模型生效）
> **诚实纠正**：本 ADR 中途曾误判「可经守卫式反射 `_physicsModel._bundle` 施力」并实施，实测触发 `_bundle 缺失` 警告后经源码复核发现——**WASM 内建物理下 `_physicsModel` 恒为 null**（详见 §3.1-3.2），反射对象根本不存在。已回退施力改动，保留 lazy impl 修复。
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

### 2.2 `rigidBodyBundleReferenceCountMap` 始终为空——联邦从不调用 `addRigidBodyBundle`

[mmdWasmPhysicsRuntimeImpl.js:281-289](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl.js)：只有显式调用 `addRigidBodyBundle` 才会 `_rigidBodyBundleMap.set(bundle, count)`。而 `rigidBodyBundleReferenceCountMap` 只是 `_rigidBodyBundleMap` 的公开 getter（js:668-669）。

**结论（路径1 核实修正）**：grep 全 `src/` —— **联邦当前没有任何 `addRigidBodyBundle` 调用**，bundle map **恒为空**（`size === 0`）。虚拟裙骨（ADR-084，`virtual-skirt.ts:330/368`）与地面碰撞（`ground-collision.ts:71`）实际经**单数** `addRigidBody` / `addRigidBodyToGlobal` 注入，进的是**单数** `_rigidBodyMap`（`rigidBodyReferenceCountMap`），**不是** bundle 容器。模型原生刚体（C++ 侧）同样不在 bundle map。→ 真因不是「map 仅缺模型刚体」，而是「wind-physics 遍历了恒空的 bundle 容器，而自建刚体都在单数容器」。

### 2.3 wind-physics 遍历了恒空的 bundle 容器（路径1 根因）

[wind-physics.ts](../../frontend/src/physics/wind-physics.ts) 的 `_onPhysicsSync` 原本**只**遍历 `getRigidBodyBundleMap(impl)`（即 `rigidBodyBundleReferenceCountMap.keys()`），对每个刚体 `applyCentralForce`。而自建刚体（虚拟裙骨/地面）实际在**单数** `rigidBodyReferenceCountMap`，bundle 容器恒空 → 循环体一次都不执行 → 风力零施加。修复：补 `getRigidBodyMap()`（返回 `rigidBodyReferenceCountMap.keys()`）并在循环后追加单数刚体遍历（见 §四 4.2）。

### 2.4 ADR-192 / ADR-194 的连锁误判

- **ADR-192 条目 3**："`getRigidBodyBundleMap` 改为 `rigidBodyBundleReferenceCountMap.keys()`，与私有 `_rigidBodyBundleMap` **key 同为 RigidBodyBundle**，彻底脱离私有字段反射。" —— 属性替换本身正确（二者确为同一 map），但**内化前后都不含模型刚体**，即「脱离私有字段」的同时也确认了「本就拿不到目标刚体」，只是当时未察觉。
- **ADR-194 §4**："`WIND_FORCE_SCALE` 0.15→1.0，风速 10 产生 10N，Dynamic 刚体摆动明显。" —— 调大一个从未生效的系数，自然无效。ADR-194 测试仅验证 `applyCentralForce` 被以正确力值调用（mock bundle），未验证 map 里真有模型刚体，故绿测未暴露此坑。

---

## 三、校正版根因（推翻中途误判，逐层核实）

> 本节替换原「可行性核实」。原判断假设模型物理走 `MmdBulletPhysicsModel._bundle`（外部物理路径），实测复核发现——**WASM 内建物理下该路径根本不执行**，`_physicsModel` 恒为 null。

### 3.1 `physicsParams` 三元链在内建物理下必为 null

[mmdWasmRuntime.js:288-297](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime.js) 传给 `MmdWasmModel` 的 `physicsParams`：

```js
options.buildPhysics
    ? this._externalPhysics !== null   // ← 内建物理下 _externalPhysics = null
        ? { physicsImpl: this._externalPhysics, physicsOptions: ... }
        : null                          // ← 走这里 → physicsParams = null
    : null
```

构造函数 [mmdWasmRuntime.js:123-124](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime.js)：当 `physics?.createRuntime !== undefined`（即传入 `MmdWasmPhysics`）时，`_externalPhysics = null`，改建 `_physicsRuntime`。**内建物理必走此分支** → `physicsParams === null`。

### 3.2 `_physicsModel` 因此恒为 null，`_bundle` 对象根本不存在

[mmdWasmModel.js:198-206](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/mmdWasmModel.js)：

```js
if (physicsParams !== null) { this._physicsModel = physicsImpl.buildPhysics(...); }
else { this._physicsModel = null; }   // ← 内建物理走这里
```

`MmdBulletPhysicsModel`（含 `_bundle`，mmdBulletPhysics.js:35/40）**仅在外部物理 `buildPhysics(...)` 时构造**。内建物理下模型刚体全在 C++ 侧按 `model.ptr` 建（[mmdWasmPhysicsRuntime.js:9](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntime.js) `markMmdModelPhysicsAsNeedInit`）——**JS 侧没有任何 `RigidBodyBundle` 对象，也没有 `_physicsModel._bundle`**。

**致命结论**：`applyForceToModelRigidBodies` 反射 `model._physicsModel._bundle` 必拿 null → 触发 `_bundle 缺失` 警告 → 施力 0 个刚体。这不是「藏在私有字段」，而是「JS 侧压根没这个对象」——比 §二 最初判断更彻底。

### 3.3 但施力 API 存在——只是缺句柄（非彻底死路）

墙不在「没有 API」，而在「没有句柄」：

| 事实 | 核实 |
|------|------|
| JS 侧施力 API **存在** | [rigidBodyBundle.js:682+](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyBundle.js) `applyCentralForce/applyForce/applyTorque/applyCentralImpulse`，各封装 `wasmInstance.rigidBodyBundleApply*(this._inner.ptr, ...)` wasm 导出。**可从 JS 调**，前提是持有 bundle 的 `_inner.ptr`。 |
| 自建刚体**有**句柄（单数） | 虚拟裙骨/地面经 `impl.addRigidBody(...)` / `addRigidBodyToGlobal(...)` 进**单数** `_rigidBodyMap`（`rigidBodyReferenceCountMap`，[mmdWasmPhysicsRuntimeImpl.js:219/342](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl.js)）。单数 `RigidBody` 自带 `applyCentralForce(force)`（[rigidBody.js:513](../../frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody.js)，无 index）→ 可施力。 |
| 模型原生刚体**无**句柄 | `_rigidBodyBundleMap` 初始空（js:65），且 `_impl` 是 lazy（getImpl 才建）。模型 C++ 侧 bundle 从不进此 map，fork 也**未暴露** `getMmdModelRigidBodyBundlePtr(modelPtr)` 之类访问器（grep `.js/.d.ts` 无结果）。 |

---

## 四、决策（校正后）

**回退反射施力方案**（建立在不存在的 `_physicsModel._bundle` 上），保留 lazy impl 订阅修复（对自建刚体有效）。风力功能定位收敛为「仅作用于自建刚体」。

### 4.1 三条路（按投入排序）

| 路径 | 描述 | 投入 | 采纳 |
|------|------|------|------|
| **1. 自建刚体（已采纳）** | 虚拟裙骨（ADR-084）/地面刚体经**单数** `addRigidBody`/`addRigidBodyToGlobal` → 进 `_rigidBodyMap`（`rigidBodyReferenceCountMap`）→ 持单数 `RigidBody` → `applyCentralForce(force)` 真能施力。fork 现成支持，风力对自建 Dynamic 刚体完全有效。 | 零 | ✅ |
| **2. 给 fork 加导出（远期）** | babylon-mmd 是 fork，Rust 侧加 `getMmdModelRigidBodyBundlePtr(modelPtr)`，JS 侧包 `RigidBodyBundle`，原生刚体即可施力。改动在 WASM 重编译，不小但可控。 | 高 | 待定 |
| **3. 直调 wasm 导出（不建议）** | 即使拿到 `model.ptr`，原生 bundle 的 ptr 不暴露，`rigidBodyBundleApplyCentralForce` 第一参无法填。死路。 | — | ❌ |

### 4.2 已回退/保留的改动

- **回退**：`mmd-adapter.applyForceToModelRigidBodies`（反射 `_physicsModel._bundle`）、`wind-physics._onPhysicsSync` 中对 actor 模型的原生刚体施力遍历、`MODEL_WIND_FORCE_SCALE`、`CapabilityProbe.hasModelPhysicsBundle`。
- **保留**：`mmd-adapter.getPhysicsImpl` lazy impl 主动创建（解决 §4.3 的 `windPhysicsActive === false`，对自建刚体有效）、`wind-physics._onPhysicsSync` 对自建刚体（虚拟裙骨/地面）的施力。

### 4.3 lazy impl 订阅修复（保留，对自建刚体有效）

现场 `windPhysicsActive === false` 真因：WASM 内建物理下 `MmdWasmPhysicsRuntime._impl` 是 lazy 的（mmdWasmPhysicsRuntime.js:103-110），只有首次 `getImpl(ctor)` 才创建。wind-physics 经 `getPhysicsImpl` 走被动 `.impl` getter，无人主动取则恒 null → observer 订阅失败。已在 `getPhysicsImpl` 内改为被动 null 时主动 `getImpl`。

---

## 五、后续方向

1. **风力定位收敛（已定）**：风力仅对自建刚体（虚拟裙骨/地面）生效。UI/文案需诚实反映：未开虚拟裙骨时，对主流自带裙骨模型风力无可见效果（刚体在 wasm C++ 侧）。
2. **上游 Option（远期 P3）**：若需让主流模型原生刚体受风，唤 babylon-mmd fork 暴露 `getMmdModelRigidBodyBundlePtr(modelPtr)`（或 `MmdWasmModel.applyForceToRigidBody(index, force)`），给原生 C++ 刚体接上 JS 句柄。需 WASM 重编译，仅在需求明确时启动（§四 路径 2）。
3. **ADR-192 / ADR-194 交叉回标**：两者的「等价性」/「风力系数」均建在本 ADR 推翻的错误前提上，仅对自建刚体重新标定手感。

### 虚拟裙骨（ADR-084）定位澄清

虚拟裙骨要求「模型无裙骨」（i18n `cloth.hint`：仅对无裙骨模型生效；`build()` 对已有裙骨模型返回 false）。它的自建 Dynamic 刚体经**单数** `addRigidBody` 进 `_rigidBodyMap`，`applyCentralForce` 对其有效——这是当前风力唤动布料的唯一可行路径（对无骨模型）。主流正经模型（自带裙骨+原生刚体）则需路径 2。

---

## 六、验证方法

**自建刚体有效（已采纳路径）**：`wails3 dev` 加载无裙骨模型 + 开虚拟裙骨（ADR-084）+ 开风：
- `window.__scene.rigidBodyCount > 0`（自建刚体进**单数** map；地面碰撞默认开启亦保证其 > 0）、`windPhysicsActive === true`（lazy impl 主动创建、observer 订阅生效）
- 注意：`rigidBodyBundleCount` 恒为 `0`（联邦从不调 `addRigidBodyBundle`，见 §2.2），此值**不可**作为健康判据。
- 现象：虚拟裙骨随风摆动

**模型原生刚体无效（已定性，不再修）**：加载正经模型、不开虚拟裙骨、风功拉满：`rigidBodyBundleCount === 0`（恒为 0），头发/裙子纹丝不动（刚体在 wasm C++ 侧，JS 无句柄）——此为预期行为，需路径 2（fork 导出）才能解。

---

## 七、相关文件

| 文件 | 角色 |
|------|------|
| [wind-physics.ts](../../frontend/src/physics/wind-physics.ts) | `_onPhysicsSync` 对**单数**自建刚体（`getRigidBodyMap`，虚拟裙骨/地面）施力；模型原生刚体施力已回退；bundle 循环保留为空兼容 |
| [mmd-adapter.ts](../../frontend/src/core/mmd-adapter.ts) | 新增 `getRigidBodyMap`（单数容器）；保留 `getPhysicsImpl` lazy impl 主动创建；`applyForceToModelRigidBodies`/`hasModelPhysicsBundle` 已回退 |
| [dev-hooks.ts](../../frontend/src/core/dev-hooks.ts) | 新增 `rigidBodyCount` 探针（单数 `rigidBodyReferenceCountMap.size`）；`rigidBodyBundleCount` 注明恒为 0 |
| [physics-health.spec.ts](../../frontend/e2e/physics-health.spec.ts) | test #1 由 `rigidBodyBundleCount>0` 修正为 `rigidBodyCount>0`（bundle 容器恒空） |
| [virtual-skirt.ts](../../frontend/src/scene/physics/virtual-skirt.ts) | 自建 Dynamic 刚体（ADR-084，仅无裙骨模型） |
| [ground-collision.ts](../../frontend/src/scene/physics/ground-collision.ts) | 自建静态刚体，进 map |
| adr-192 / adr-194 | 隐含错误前提，已交叉引用本 ADR |
