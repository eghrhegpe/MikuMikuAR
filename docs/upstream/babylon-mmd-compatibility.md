# Babylon-mmd 兼容性分析报告

> **日期**: 2026-07-27
> **状态**: 终稿
> **范围**: MikuMikuAR 联邦项目中所有因 babylon-mmd 接口限制而产生的代码应对措施

---

## 一、背景：上游设计立场

2026-07-27 向 `noname0310/babylon-mmd` 提交了 3 个 PR（#94 IMmdModel 补全、#95 Shift-JIS 解码、#96 Physics 钩子），均被上游拒绝。上游维护者 `noname0310` 的反馈揭示了其明确的设计哲学：

### 上游设计原则

| 原则 | 含义 | 对联邦项目的影响 |
|------|------|-----------------|
| **接口最小化** | `IMmdModel` / `IMmdRuntime` 只暴露最通用的契约，不包含两个 runtime（JS/WASM）各自的专有方法 | 联邦项目必须通过本地类型扩展访问 runtime 特有成员 |
| **不可互换性** | WASM runtime 需处理数据竞争和缓冲求值同步，复杂操作下两 runtime 不可互换 | 联邦项目需区分 JS/WASM 路径，不能靠统一接口抹平差异 |
| **消费方责任** | 消费方应用泛型 `fn<T extends IMmdModel>` 保留具体类型，而非摊大接口 | 联邦的 `RuntimeModel = IMmdModel & {...}` 本地交集类型是正确的模式 |
| **不接受 AI PR** | 不接受 AI 代理编写的 PR | 放弃上游 PR 路径，所有差异就地解决 |

### 结论

**放弃向 `noname0310/babylon-mmd` 提 PR 的计划。** 联邦项目所有与 babylon-mmd 的接口差异均通过本地应对措施解决，文档在此记录这些措施、其合理性以及稳定性风险。

---

## 二、全部 23 处差异应对措施

### 2.1 类型缺口 — 本地 augmentation（14 处）

| # | 文件 | 缺的 babylon-mmd API | 本地方案 | 
|---|------|---------------------|---------|
| 1 | `core/types.ts:154-170` | `IMmdModel` 缺 `setRuntimeAnimation` / `createRuntimeAnimation` / `currentAnimation` | `RuntimeModel = IMmdModel & { ... }` 交集类型 |
| 2 | `core/types.ts:547-554` | `IMmdRuntimeBone` 缺 `worldMatrix` / `updateWorldMatrix` / `ikSolver` | `MmdRuntimeBoneExtended extends IMmdRuntimeBone` 接口扩展 |
| 3 | `vmd-loader.ts:148` | `IMmdModel` 缺 `currentAnimation` | 内联类型断言 `(inst.mmdModel as { currentAnimation?: ... })` |
| 4 | `vmd-layers.ts:701` | 同上 | 同模式 |
| 5 | `bone-override.ts:844` | `IMmdRuntimeBone.linkedBone` 过于抽象，需原生 Bone API | `as unknown as { linkedBone?: Bone }` |
| 6 | `accessory.ts:49` | 同上 | 同模式 |
| 7 | `ground-collision.ts:38` | `IMmdRuntime` 缺 `physics` 属性 | `as unknown as { physics?: ... }` |
| 8 | `env-gravity.ts:22` | 同上 | `mmdRuntime instanceof MmdWasmRuntime` 守卫 |
| 9 | `motion-cloth-levels.ts:56` | `IMmdRuntime` 需下转型为 `MmdWasmRuntime` | `as unknown as MmdWasmRuntime` |
| 10 | `model-loader.ts:49` / `props.ts:28` | `ImportMeshAsync` 类型不支持 `Uint8Array` | 函数签名 cast |
| 11 | `model-detail.ts:792` | `IMmdModel.mesh` 未暴露 `materials` | `as unknown as { materials?: ... }` |
| 12 | `model-loader.ts:480` | `referenceFiles` 类型为 `File[]` 但使用自定义接口 | `as unknown as File[]` |
| 13 | `dev-hooks.ts:63` | `mmdRuntime.runtimeAnimation` 不存在 | 改用 `focusedModel().vmdName` |
| 14 | `vmd-layers.ts:693` | `MmdCompositeAnimation` 需实现 `IMmdBindableModelAnimation` | 依赖 babylon-mmd 内部模块增强 |

**统一模式**: 所有类型缺口遵循`babylon-mmd 声明了运行时行为更丰富的具体类，但接口未暴露`的模式。本地用 intersection type / `as unknown as` 补充。

---

### 2.2 运行时替代方案（7 处）

| # | 文件 | 上游限制 | 本地方案 | 稳定性 |
|---|------|---------|---------|--------|
| 15 | `wind-physics.ts:40` | `MmdWasmPhysicsRuntimeImpl._rigidBodyBundleMap` 未暴露 | 反射 `as unknown as Record<>` | ⚠️ 字段重命名会静默降级 |
| 16 | `audio.ts:55` | `StreamAudioPlayer._audio` 未暴露 | 反射 `as unknown as { _audio?: ... }` | ⚠️ 同上 |
| 17 | `two-bone-ik.ts` | WASM 下 `ikSolver = null` | 自定义 2-bone IK 求解器 | ✅ 独立 |
| 18 | `vmd-loader.ts:164` | `setRuntimeAnimation` 不重置 `_currentFrameTime` | `seekAnimation(0, true)` | ✅ |
| 19 | `playback.ts:77` | 无 `onFinish` 事件 | `onPause` 代替 | ✅ |
| 20 | `lighting.ts:196` | babylon-mmd 未记录 worldMatrix 更新时序 | 文档 + 选择正确 observable | ✅ |
| 21 | `vmd-loader.ts:105` | `VmdLoader` 无 `dispose()` API | GC | ✅ |

---

### 2.3 测试基础设施（2 处）

| # | 文件 | 原因 | 方案 |
|---|------|------|------|
| 22 | `babylon-mmd-mocks.ts` | babylon-mmd 模块有顶层副作用（装饰器、Matrix.Identity） | 完整 `vi.mock` 模块模拟 |
| 23 | 各 `.test.ts` | 静态导入会触发真实模块求值 | mock 装饰器 / 着色器副作用 |

---

## 三、风险评估

### 🔴 高脆弱性（上游升级时可能静默失效）

| ID | 位置 | 风险 | 缓解 |
|----|------|------|------|
| 15 | `wind-physics.ts` 反射 `_rigidBodyBundleMap` | 字段重命名 → 返回 undefined → 风物理静默降级 | 代码中有显式的类型检查 + 抛错提示，升级时若触发错误会引导检查 |
| 16 | `audio.ts` 反射 `_audio` | 字段重命名 → audio 功能异常 | 无显式守卫，依赖开发者自查 |

### 🟡 中等脆弱性

| ID | 位置 | 风险 | 缓解 |
|----|------|------|------|
| 1 | `RuntimeModel` intersection type | 上游新增同名成员可能冲突 | 类型错误会在编译期暴露 |
| 2 | `MmdRuntimeBoneExtended` | 同上 | 同上 |
| 3–14 | 各类 `as unknown as` cast | 上游 API 变更时类型可能不兼容 | 类型错误会在编译期暴露 |

### 🟢 低风险

| ID | 位置 | 理由 |
|----|------|------|
| 17–21 | 运行时替代方案 | 不依赖上游内部实现，独立逻辑 |
| 22–23 | 测试 mock | 仅测试环境有效，不影响运行时 |

---

## 四、决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-07-27 | ❌ **放弃向上游提 PR** | 上游不接受 AI 编写的 PR，且有明确的设计分歧 |
| 2026-07-27 | ✅ **保留所有本地应对措施** | 它们是上游最小接口策略下的正确本地方案 |
| 2026-07-27 | ✅ **`RuntimeModel` augmentation 保持** | 上游明确 `IMmdModel` 应最小化，本地交集类型是推荐模式 |
| 2026-07-27 | ✅ **Go 侧损坏映射保持**（ADR-058） | PMX Shift-JIS 编码证据不足，上游不认可 PR；Go 侧兜底是正确路径 |
| 2026-07-27 | ✅ **ADR-110 登记册冻结** | 所有上游 PR 候选不再推进。登记册保留为历史记录，条目 1 标记为「❌ 已关闭」 |
| 2026-07-27 | ✅ **Gaze 逻辑内联** | 上游不赞成 Observable 钩子模式，gaze 逻辑直接在 `beforePhysics()` 中内联 |

---

## 五、附录：上游 PR 尝试记录

| PR | 内容 | 提交日期 | 合并状态 | 关闭原因 |
|----|------|---------|---------|---------|
| [#94](https://github.com/noname0310/babylon-mmd/pull/94) | `IMmdModel` 接口补全 | 2026-07-27 | ❌ 已关闭 | AI 代理 + 设计分歧 |
| [#95](https://github.com/noname0310/babylon-mmd/pull/95) | PMX Shift-JIS 解码 | 2026-07-27 | ❌ 已关闭 | 证据不足 + AI 代理 |
| [#96](https://github.com/noname0310/babylon-mmd/pull/96) | Physics 钩子 | 2026-07-27 | ❌ 已关闭 | AI 代理 + 设计分歧 |

---

*本报告由 Riku（联邦首席架构师 AI）于 2026-07-27 编写，作为 upstream PR 路径关闭后的兼容性基线文档。*
