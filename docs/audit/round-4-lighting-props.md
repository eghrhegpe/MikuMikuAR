# 第④轮审核 — 光照 + 道具

## lighting.ts (1229行)

**总体结论：❌ 不通过**

**文件：** `frontend/src/scene/env/lighting.ts`
**测试：** 🔴 P1 — 0 实质测试（仅 2 行烟雾测试）

---

### 导入图谱

`lighting.ts` 导入：`env-impl`(getScene, _envSys)、`env-lighting`(lighting models)、`lighting-presets`(preset configs)、`props`(道具)

### 类型安全 — 🟠 P2

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1-6 | 多处 | `this._scene!` 非空断言（共 6 处） | 🟠 P2 |
| 7-8 | 多处 | `as any` 访问私有属性（2 处） | 🟠 P2 |

6 处 `_scene!` 非空断言无任何注释说明为何此时 `_scene` 一定非空。

### 🔴 P1 — Bug-001: transitionLighting 未调度

```typescript
// lighting.ts 中定义
private transitionLighting(target: LightingPreset, duration: number) { ... this._tweenValue(...) ... }

// 调用方
buildPresetLevel(level: number) { this.transitionLighting(preset, 1.0); }
```

问题：`transitionLighting` 在 `buildPresetLevel` 中被调用，但 **animLoop 从未被注册到 scene 的渲染循环**。调用后灯光不做任何过渡，直接跳变到目标值。

看实现模式，`transitionLighting` 内部使用 `_tweenValue` 但该函数并未将动画循环注册到 `scene.onBeforeRenderObservable` 或其他每帧回调。结果：灯光预设切换时的过渡效果静默不执行。

### 🔴 P1 — Bug-002: _tweenValue 使用 addOnce

```typescript
private _tweenValue(...) {
  scene.onBeforeRenderObservable.addOnce(() => { ... tick ... });
}
```

`addOnce` 只注册 **一帧**。tick 执行后自动移除，不再重新注册。缓动在注册后的第一帧执行一次即中断，无连续过渡。

**正确做法：** 使用 `add` 而非 `addOnce`，在 tick 中检查是否达到目标值后 `removeCallback(this)`。

### 功能正确性 — 🔴 P1

| # | 问题 | 严重度 |
|---|------|--------|
| 1 | `transitionLighting` animLoop 未注册到渲染循环 | 🔴 P1 — 功能静默不执行 |
| 2 | `_tweenValue` 用 `addOnce` 只执行一帧 | 🔴 P1 — 过渡立刻中断 |
| 3 | 1229 行零实质测试 | 🔴 P1 — 无法保证任何修复不退化 |

### 资源管理 — 🟠 P2

`lighting.ts` **缺少 `disposeLighting()` 函数**。无统一清理入口。当前 dispose 逻辑散布在模块级变量和 scene observer 中，未集中管理。

### 设计质量 — 🟡 P3

| 问题 | 说明 |
|------|------|
| 1229 行远超 250LOC 天花板 | 建议拆分为 6 子模块：lighting-controller, lighting-transition, lighting-shadow, lighting-stage, lighting-atmosphere, lighting-props |
| `loadStageLights` ID 格式硬编码 | L~400 `light-(\d+)` 正则硬编码 ID 格式，与 ADR 中定义的命名规范耦合 |
| 过渡与状态耦合 | `_currentPreset` 和 `_targetPreset` 状态分散在多个方法中，无状态机 |

---

## lighting-presets.ts (170行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/lighting-presets.ts`

### 类型安全 — 🟡 P3

| # | 问题 | 位置 |
|---|------|------|
| 1 | `state: Record<string, unknown>` 无类型安全 | L~30 |

`state` 字段接受任意字符串 key，无编译期检查。消费者需自行 `as` 断言。

### 功能正确性 — 🟡 P3

注释称 6 个预设（natural-daylight, night-scene, stage-warm, stage-cool, dance-club, mood-cinematic），但代码只定义 **4 个**（缺 `natural-daylight` 和 `night-scene`）。注释过时。

---

## env-lighting.ts (159行)

**总体结论：✅ 通过**

**文件：** `frontend/src/scene/env/env-lighting.ts`
**角色：** 纯函数模块 — 光照计算模型

### 各维度

| 维度 | 结论 |
|------|------|
| 类型安全 | ✅ 0 处类型逃生 |
| 测试覆盖 | ✅ `calcLuminance`、`deriveLighting`、`TIME_OF_DAY_PRESETS` 有测试 |
| 功能正确性 | ✅ 纯函数，无副作用 |
| 设计质量 | ✅ 函数式风格，输入输出明确 |

### 🟢 P4

`exportEnvPreset` / `importEnvPreset` 无测试，但为简单序列化函数，风险低。

---

## props.ts (347行)

**总体结论：⚠️ 有条件通过**

**文件：** `frontend/src/scene/env/props.ts`
**测试：** 🔴 P1 — 0 测试

---

### 各维度

| 维度 | 结论 |
|------|------|
| 类型安全 | 🟢 P4 — 1 处双重 cast `(n as unknown as {position: Vector3})` |
| 资源管理 | ✅ — Mesh/Material 创建与 dispose 配对 |
| 测试覆盖 | 🔴 P1 — 0 测试 |
| 功能正确性 | 🟡 P3 — 整体路径已覆盖，但无回归保护 |
| 设计质量 | ✅ — 功能模块化，状态管理清晰 |

---

## 风险清单

| 文件 | 观察 | 建议 |
|------|------|------|
| 🔴 P1 | lighting.ts | `transitionLighting` animLoop 未调度 | 将缓动循环注册到 `scene.onBeforeRenderObservable`（`add` 而非 `addOnce`） |
| 🔴 P1 | lighting.ts | `_tweenValue` 用 `addOnce` 只一帧 | 改用 `add` + 完成条件检查后 `remove` |
| 🔴 P1 | lighting.ts | 0 实质测试 | 最小添加：preset 切换、transition 动画、shadow 启用/禁用 |
| 🟠 P2 | lighting.ts | 6 处 `_scene!` 非空断言 | 加注释说明初始化时序保证 |
| 🟠 P2 | lighting.ts | 缺少 `disposeLighting()` | 添加统一清理函数，整合所有 observer/mesh/material 释放 |
| 🟡 P3 | lighting.ts | 1229 行超限 | 拆 6 子模块 |
| 🟡 P3 | lighting-presets.ts | 注释 6 预设但只 4 个 | 更新注释或补充缺失预设 |
| 🔴 P1 | props.ts | 0 测试 | 添加路径：道具创建、可见性切换、dispose |
