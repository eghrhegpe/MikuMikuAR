# ADR-201: 路径2 — 给 babylon-mmd fork 增加原生刚体施力导出（wasm 侧解析）

> **状态**: ✅ 已实施（2026-07-28，2B 变体，见 §九 实施记录；e2e test #4 待本地回归）
> **关联**: ADR-200（路径1 已采纳，风力收敛为仅作用于自建刚体）、ADR-084（虚拟裙骨）、ADR-192（反射范式）
> **背景**: ADR-200 §四 路径2 / §五 远期 Option 的正式评估。初版草案曾误判「fork 不可见、原生刚体形态未知、模式筛选数据源未知」为阻塞项 —— **经核查 fork 源码，三项全部解除**（见 §二）。

---

## 一、动机与问题陈述

- **路径1 已落地**（ADR-200 + commit `3d643639`）：风力作用于**联邦自建 Dynamic 刚体**（虚拟裙骨 ADR-084 / 地面碰撞），经单数 `getRigidBodyMap` 遍历 `RigidBody.applyCentralForce`。
- **缺口**：**模型原生发丝 / 裙摆**在 WASM 内建物理下，JS 侧无句柄（`_physicsModel === null`，ADR-200 §3.2），风力对其无效。
- **触发器**：产品若要求「吹动角色**原生**发丝 / 裙摆」（主流正经模型），当前无解 → 需本 ADR 的路径2。

---

## 二、承重前提（初版草案的阻塞项 — 全部已解除并核实）

| # | 初版担忧 | 核查结果（fork 源码） | 状态 |
|---|---------|----------------------|------|
| P1 | fork 仓库不可见 | fork 源码在 `C:\Users\zhujieling11\babylon-mmd`（顶层 git 仓库）。`origin = git@github.com:eghrhegpe/babylon-mmd.git`（可写），`upstream = noname0310/babylon-mmd`。**可见、可改、可推。** | ✅ 解除 |
| P2 | 原生刚体形态未知（裸数组？） | 原生刚体**内部就是 `RigidBodyBundle`**：`PhysicsModelContext.bundle_proxy: Box<RigidBodyBundleProxy>`（`physics_model_context.rs:20`）→ `RigidBodyBundleProxy.inner: RigidBodyBundle`（`rigidbody_bundle_proxy.rs:13`）。`RigidBodyBundle.apply_central_force(index, force)` 已实现（`rigidbody_bundle.rs:252`）。 | ✅ 解除（2A 直接成立） |
| P3 | 按 model.ptr 取原生刚体的导出不存在 | 现成导出 `rigidbody_bundle_apply_central_force(ptr, index, fx, fy, fz)`（`rigidbody_bundle.rs:586`，即 JS 侧 `rigidBodyBundleApplyCentralForce`）——**只需照此模式新增一个「由 model.ptr 取 bundle ptr」的导出**。 | ✅ 解除（additive 导出） |
| P4 | 物理模式筛选数据源未知 | `RigidBodyBundleProxy.get_physics_mode(index)`（`rigidbody_bundle_proxy.rs:44`）现成可读 `RigidBodyPhysicsMode`；且 `commit_body_states`（`physics_model_context.rs:169-172`）已按 `FollowBone` 跳过。**更关键：Bullet 对 Kinematic/FollowBone 施力为 no-op**，初版不过滤也能跑（仅多几次无副作用调用）。 | ✅ 解除（过滤为可选项） |

> **结论**：路径2 不是「调个 API」，但也不是「跨仓库大改」。它是 **fork 内新增 1 个 wasm 导出 + 重编译 wasm + 薄 JS 桥**，且全部构件已在位。

---

## 三、推荐方案（单一，收敛自初版 2A/2B）

### 3.1 wasm 侧：新增导出 `getMmdModelRigidBodyBundle`

在 `src/Runtime/Optimized/wasm_src/src/` 的模型/物理导出模块（建议 `mmd_model/mod.rs` 或新增 `physics/mmd` 导出）加一个 `#[wasm_bindgen]` 函数，照搬 `rigidbody_bundle_apply_central_force`（`rigidbody_bundle.rs:586-590`）的 ptr 转换范式：

```rust
use crate::physics::bullet::runtime::rigidbody_bundle::RigidBodyBundle;
// MmdModel 已在当前模块可见（mmd_model/mod.rs）

#[wasm_bindgen(js_name = "getMmdModelRigidBodyBundle")]
pub fn get_mmd_model_rigid_body_bundle(model_ptr: *mut usize) -> *mut usize {
    let model = unsafe { &*(model_ptr as *mut MmdModel) };
    // 仅对启用了物理的模型调用；无物理上下文返回 null（JS 判 0 跳过）
    let context = match model.physics_model_context.as_ref() {
        Some(c) => c,
        None => return 0 as *mut usize,
    };
    let bundle: &mut RigidBodyBundle = context.bundle_proxy().inner_mut(); // &mut RigidBodyBundle
    bundle as *mut RigidBodyBundle as *mut usize
}
```

- `MmdModel.physics_model_context` 为 `Option<PhysicsModelContext>`（`mmd_model/mod.rs:42`）。
- `PhysicsModelContext.bundle_proxy()` → `&RigidBodyBundleProxy`（`physics_model_context.rs:88`）；`RigidBodyBundleProxy.inner_mut()` → `&mut RigidBodyBundle`（`rigidbody_bundle_proxy.rs:27`）。
- ptr 转换与现有 `rigidbody_bundle_apply_central_force` 完全一致（`rigidbody_bundle.rs:587` `unsafe { &mut *(ptr as *mut RigidBodyBundle) }`）。

### 3.2 JS 侧：薄桥接（复用现有施力机械）

在 `frontend/src/core/mmd-adapter.ts` 增加：

```ts
// 取模型原生刚体 bundle 的 wasm ptr，包装为已有 RigidBodyBundle 类后复用现有施力循环。
// 无物理模型返回 0（wasm 侧对 physics_model_context == None 返回 null）。
export function getModelNativeRigidBodyBundle(model: MmdWasmModel): RigidBodyBundle | null {
    const ptr = (getWasmInstance() as any).getMmdModelRigidBodyBundle(model.ptr);
    if (!ptr) return null;
    return new RigidBodyBundle({ ptr }); // 复用 babylon-mmd 现有 JS 类
}
```

`RigidBodyBundle` JS 类已存在（`applyCentralForce(index, force)` → `rigidBodyBundleApplyCentralForce(this._inner.ptr, index, ...)`），与**自建 bundle 路径完全同构**。→ `wind-physics.ts` 的 `(1a) 自建 bundle 循环` 直接复用，仅追加对 actor 模型原生 bundle 的遍历。`MODEL_WIND_FORCE_SCALE`（ADR-200 中 5.0 起点）沿用。

---

## 四、立项前剩余细节（均非阻塞）

| # | 细节 | 处理 |
|---|------|------|
| D1 | JS `RigidBodyBundle` 构造器入参形状 | 需核对 babylon-mmd 内部 `new RigidBodyBundle(inner)` 的 `inner` 形状（应为 `{ ptr }`）。实现时对照 `rigidBodyBundle.js` 构造逻辑，1 行调整。 |
| D2 | FollowBone 过滤 | **初版可不过滤**：Bullet 对 Kinematic/FollowBone 施力为 no-op，无副作用。若要剔除冗余调用 / 做 UI 区分，再暴露 `get_physics_mode` 导出（已有 `pub(super)`，加 `#[wasm_bindgen]` 即可）。 |
| D3 | 重编译命令 | fork `wasm_src/` 下 `.cargo/config.toml` + `Cargo.toml` + `build.rs` 齐备；`wasm/`（未跟踪）已含用户**正在重建**的 `md/ mpdr/ mpr/ mr/ sd/` 编译产物 → **构建链已验证可跑**。实现时复用同一命令（wasm-pack / wasm-bindgen-rayon + cmake for Bullet）。 |

---

## 五、成本与风险（重评）

| 维度 | 评估 |
|------|------|
| 工程成本 | **低-中**：1 个 `#[wasm_bindgen]` fn（~8 行）+ wasm 重编译 + `mmd-adapter.ts` ~10 行桥 + `wind-physics.ts` 复用现有循环。**远低于**初版草案的「中高」。 |
| ABI | additive 导出，向后兼容；不影响现有 `rigidBodyBundleApplyCentralForce` 等。 |
| 同步漂移 | fork `origin` 为用户自有仓库，改动随 fork 走；未来 rebase upstream 仅冲突本导出（局部、易解）。 |
| 回归面 | 新增 e2e（原生刚体受风位移）—— 即 `physics-health.spec.ts` **test #4「骨骼位移」** 的载体（当前因路径2 缺位不可通过）。 |

---

## 六、决策建议

- **初版「当前不启动」改为「建议立项，投入可控」**。路径1（自建布料受风）仍是 shipped 解；路径2 在 fork 本地、构件齐备、模式可照搬的前提下，性价比高。
- **启动门槛（Gate）降为**：产品明确需要「吹动角色原生发丝 / 裙摆」。纯技术可行性已无阻塞。
- **实现顺序**：(1) fork 开特性分支 → (2) 加 `getMmdModelRigidBodyBundle` 导出 → (3) 重编译 wasm 并本地验证导出存在 → (4) `mmd-adapter` 桥 + `wind-physics` 复用循环 → (5) e2e test #4 绿化 + 系数实测标定。

---

## 七、验收

1. 加载正经模型、不开虚拟裙骨、风功拉满 → 发丝 / 裙摆可见摆动（位移 > 阈值）。
2. `physics-health.spec.ts` test #4 由「记录 / 跳过」转为「断言原生刚体受风位移」。
3. 路径1 自建刚体施力不受影响（回归绿）。
4. fork 新增导出经 `wasm/mpd/index.d.ts` 可见，且 `frontend` 的 babylon-mmd 版本 pin 指向含该导出的构建。

---

## 八、相关文件

| 文件 | 角色 |
|------|------|
| `C:\Users\zhujieling11\babylon-mmd\src\Runtime\Optimized\wasm_src\src\physics\mmd\physics_model_context.rs` | `bundle_proxy: Box<RigidBodyBundleProxy>`（原生刚体 bundle 载体） |
| `C:\Users\zhujieling11\babylon-mmd\src\Runtime\Optimized\wasm_src\src\physics\bullet\runtime\rigidbody_bundle.rs` | `rigidbody_bundle_apply_central_force` 导出范式（L586）；`apply_central_force(index, force)` 实现（L252） |
| `C:\Users\zhujieling11\babylon-mmd\src\Runtime\Optimized\wasm_src\src\physics\mmd\rigidbody_bundle_proxy.rs` | `inner_mut()`（L27）、`get_physics_mode(index)`（L44，FollowBone 过滤数据源） |
| `C:\Users\zhujieling11\babylon-mmd\src\Runtime\Optimized\wasm_src\src\mmd_model\mod.rs` | `MmdModel.physics_model_context: Option<PhysicsModelContext>`（L42）；建议在此加导出 |
| `C:\Users\zhujieling11\babylon-mmd\wasm\mpd\index.d.ts` | 重编译后的导出清单（含既有 `rigidBodyBundleApplyCentralForce`） |
| `frontend/src/core/mmd-adapter.ts` | 路径2 的 JS 桥接层（新增 `getModelNativeRigidBodyBundle`） |
| `frontend/src/physics/wind-physics.ts` | 复用现有 bundle 施力循环，追加原生 bundle 遍历 |
| `frontend/e2e/physics-health.spec.ts` | test #4 为路径2 验收载体 |

---

## 九、实施记录（2026-07-28）

### 9.1 与 §三 草案的关键偏差：采用 2B 变体（wasm 侧解析，不暴露 bundle ptr）

草案 3.1「返回 bundle ptr 给 JS 包装」存在**析构陷阱**：JS `RigidBodyBundle` 类的 finalizer 会调用 `destroyRigidBodyBundle`，包装模型内部 bundle 会导致模型物理被二次销毁。故改为**两个导出全部在 wasm 侧解析，JS 永不接触裸 ptr**：

```rust
// physics_model_context.rs 末尾（fork 分支 feat/p2-native-rigidbody-bundle）
#[wasm_bindgen(js_name = "getMmdModelRigidBodyBundleLen")]
pub fn get_mmd_model_rigid_body_bundle_len(model_ptr: *mut usize) -> usize { ... }

#[wasm_bindgen(js_name = "mmdModelRigidBodyApplyCentralForce")]
pub fn mmd_model_rigid_body_apply_central_force(
    model_ptr: *mut usize, index: usize, fx: f32, fy: f32, fz: f32) { ... }
```

- 内部经 `model.physics_model_context()/…_mut()`（pub 方法，字段私有）→ `bundle_proxy` → `RigidBodyBundle.apply_central_force`。
- 施力导出内做了 `FollowBone` 过滤（§四 D2 的可选项直接落地）。

### 9.2 JS 桥（同样偏离草案 3.2 的 bundle 包装方案）

`mmd-adapter.ts` 新增 `applyForceToModelRigidBodiesNative(wasmInstance, model, force): number`：
- 守卫：两导出非函数（升级回退）→ warn once + 返回 0；`model.ptr` 缺失 → 返回 0。
- 循环 `mmdModelRigidBodyApplyCentralForce(ptr, i, fx, fy, fz)`，返回施力刚体数。
- `wind-physics.ts` 第 (2) 段改调此函数，`MODEL_WIND_FORCE_SCALE = 5.0` 沿用。

### 9.3 构建与分发

- fork：`npm run build-wasm-mpd`（wasm-pack --target web --features "console_error_panic_hook parallel physics"）29s 通过；`wasm/mpd/index.{js,d.ts}` 含两个新导出。
- 前端消费 npm 实装的 babylon-mmd 1.2.0 → 重建的 4 个 mpd 产物**手工复制**至 `frontend/node_modules/babylon-mmd/esm/Runtime/Optimized/wasm/mpd/`（临时分发；正式方案待 fork 打包 pin 版本）。

### 9.4 验证（5 级）

| 级 | 项 | 结果 |
|----|-----|------|
| 1 | cargo check + wasm-pack 重编译 | ✅ |
| 2 | 重建 glue 含两个新导出 | ✅ |
| 3 | 产物复制至前端 node_modules | ✅ |
| 4 | TS 类型检查 + 37 单测（含新 `mmd-adapter.native.test.ts`） | ✅ |
| 5 | 前端 `npm run build`（475 modules） | ✅ |
| — | e2e test #4（原生刚体位移） | ⏸ 沙箱内 WebView2 CDP 端口未绑定（残留进程复用，见 `start-e2e.ps1` 注意事项），**待本地回归** |

### 9.5 遗留项

1. e2e #4 本地回归：先杀残留 msedgewebview2.exe → `start-e2e.ps1` → `npm run test:e2e:webgl`。
2. wasm 产物分发正式化：node_modules 手工复制会被 `npm install` 冲掉；应从 fork 发布 pin 版本或加 postinstall 复制脚本。
3. `MODEL_WIND_FORCE_SCALE` 系数实测标定（§六 实现顺序第 5 步后半）。
