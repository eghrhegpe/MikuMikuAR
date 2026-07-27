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

## 二、全部 23 处差异应对措施（含代码）

### 1. `RuntimeModel` —— `IMmdModel` 缺运行时动画方法

**文件**: `frontend/src/core/types.ts`，第 154–170 行

```typescript
/**
 * IMmdModel 接口不含 setRuntimeAnimation / createRuntimeAnimation
 * （这两个方法在 MmdModel 和 MmdWasmModel 具体类上）。
 * 此扩展类型补上运行时动画相关方法，供 ModelInstance.mmdModel 使用。
 * 类型签名与 MmdModel / MmdWasmModel 实际实现一致。
 * 永久本地维护：上游 IMmdModel 保持最小接口策略，本地交集类型（RuntimeModel）是上游推荐的消费方模式，不向上游推进。
 */
export type RuntimeModel = IMmdModel & {
    setRuntimeAnimation(
        handle: Nullable<MmdRuntimeAnimationHandle>,
        updateMorphTarget?: boolean
    ): void;
    createRuntimeAnimation(
        animation: IMmdBindableModelAnimation,
        retargetingMap?: { [key: string]: string }
    ): MmdRuntimeAnimationHandle;
    currentAnimation?: Nullable<IMmdRuntimeModelAnimation>;
};
```

- **变通模式**: 交集类型（`IMmdModel & { ... }`）
- **解决的 babylon-mmd 限制**: `IMmdModel` 接口未暴露 `setRuntimeAnimation`、`createRuntimeAnimation` 和 `currentAnimation`——这些方法仅在具体类 `MmdModel`/`MmdWasmModel` 上存在
- **类型/运行时**: 类型
- **使用此扩展的文件**: 所有引用 `ModelInstance.mmdModel` 的地方（约 15+ 文件）

---

### 2. `MmdRuntimeBoneExtended` —— `IMmdRuntimeBone` 缺运行时方法

**文件**: `frontend/src/core/types.ts`，第 547–554 行

```typescript
// babylon-mmd 的 IMmdRuntimeBone 接口未声明 worldMatrix 和 updateWorldMatrix，
// 但 WASM 与 JS 运行时在运行时均提供这些成员。
export interface MmdRuntimeBoneExtended extends IMmdRuntimeBone {
    worldMatrix: Float32Array;
    updateWorldMatrix(updateAbsoluteTransform: boolean, updateLocalTransform: boolean): void;
    /** babylon-mmd MmdRuntimeBone 实有：该骨骼挂载的 IK 求解器（无 IK 时为 null） */
    ikSolver: IkSolver | null;
}
```

- **变通模式**: 接口扩展
- **解决的 babylon-mmd 限制**: `IMmdRuntimeBone` 未声明 `worldMatrix`、`updateWorldMatrix` 和 `ikSolver` 这些运行时实际存在的成员
- **类型/运行时**: 类型
- **使用此扩展的文件**: `perception-shared.ts`、`perception-breathing.ts`、`perception-gaze.ts`、`perception-gaze-js.ts`、`perception-gaze-wasm.ts`、`bone-override.ts`、`wasm-layers-blender.ts`、`feet-adjustment.ts`、`hand-modules.ts`

---

### 3. `_rigidBodyBundleMap` 反射访问 —— 风物理需要读内部字段  **[适配层根治中 → ADR-192]**

**文件**: `frontend/src/physics/wind-physics.ts`，第 39–68 行

```typescript
function _getPhysicsImpl(runtime: IMmdRuntime): MmdWasmPhysicsRuntimeImpl | null {
    const physics = (runtime as unknown as Record<string, unknown>).physics as
        Record<string, unknown> | undefined;
    if (!physics) { return null; }
    const impl = physics.impl as MmdWasmPhysicsRuntimeImpl | undefined;
    return impl ?? null;
}

export function _getBundles(impl: MmdWasmPhysicsRuntimeImpl): Iterable<...> {
    const map = (impl as unknown as Record<string, unknown>)._rigidBodyBundleMap;
    if (map instanceof Map) { return map.keys(); }
    if (map === undefined) {
        throw new Error(
            'wind-physics: _rigidBodyBundleMap 不存在（可能已被 babylon-mmd 重命名）。' +
            '检查 babylon-mmd 版本兼容性'
        );
    }
    throw new Error('wind-physics: _rigidBodyBundleMap 类型异常。检查 babylon-mmd 版本兼容性');
}
```

- **变通模式**: 通过 `as unknown as Record<string, unknown>` 进行反射访问
- **解决的 babylon-mmd 限制**: `IMmdRuntime` 接口未暴露 `physics` 属性，`MmdWasmPhysicsRuntimeImpl` 未暴露内部的 `_rigidBodyBundleMap` 字段
- **类型/运行时**: 运行时（功能）
- **稳定性**: ⚠️ 字段重命名会静默降级（有显式错误提示做保险）

---

### 4. `ImportMeshAsync` 类型断言 —— 支持 Uint8Array 输入 PMX

**文件**:
- `frontend/src/scene/manager/model-loader.ts`，第 49–54 行
- `frontend/src/scene/env/props.ts`，第 28–33 行

```typescript
/** babylon-mmd 扩展 ImportMeshAsync 接受 Uint8Array，原类型签名不支持，需手动断言 */
const importMeshFromBytes = ImportMeshAsync as unknown as (
    data: Uint8Array,
    scene: unknown,
    options: Record<string, unknown>
) => Promise<ISceneLoaderAsyncResult>;
```

- **变通模式**: `as unknown as` 函数签名类型断言
- **解决的 babylon-mmd 限制**: Babylon.js 的 `ImportMeshAsync` 类型签名不支持 `Uint8Array` 作为第一个参数，但 babylon-mmd 的加载器确实支持通过 Uint8Array 传入 PMX 数据
- **类型/运行时**: 类型

---

### 5. `currentAnimation` 类型断言 —— 释放 WASM 动画资源防泄漏

**文件**:
- `frontend/src/scene/motion/vmd-loader.ts`，第 148–152 行
- `frontend/src/scene/motion/vmd-layers.ts`，第 701–704 行

```typescript
// babylon-mmd 类型声明未暴露 currentAnimation 属性（内部实现），
// 需要取出旧动画句柄显式 dispose 以释放 WASM AnimCurve 资源
const prevAnim =
    (inst.mmdModel as { currentAnimation?: { dispose?: () => void } | null })
        .currentAnimation ?? null;
```

- **变通模式**: 内联类型断言 + `dispose()`
- **解决的 babylon-mmd 限制**: `IMmdModel` 接口未暴露 `currentAnimation` 属性，但 `MmdModel`/`MmdWasmModel` 在运行时确实拥有该属性。需要访问它以正确释放 WASM 动画资源，防止内存泄漏
- **类型/运行时**: 类型 + 运行时

---

### 6. `linkedBone` 类型断言 —— 访问原生 Babylon.js Bone API

**文件**:
- `frontend/src/scene/env/accessory.ts`，第 49–52 行
- `frontend/src/scene/motion/bone-override.ts`，第 844–850 行

```typescript
// accessory.ts
// linkedBone: babylon-mmd 的 runtimeBone 有 linkedBone 属性指向原生 Bone
const linkedBone = (rb as unknown as { linkedBone?: import('@babylonjs/core/Bones/bone').Bone })
    .linkedBone;

// bone-override.ts
// IMmdRuntimeBone.linkedBone 已声明为 IMmdRuntimeLinkedBone (duck-typed abstraction)，
// 但运行时 babylon-mmd MmdRuntimeBone 的 linkedBone 是完整的 Babylon.js Bone 实例。
// 此处保留一小步类型断言以获取 getSkeleton() 等原生 Bone API。
```

- **变通模式**: `as unknown as` 类型逃生
- **解决的 babylon-mmd 限制**: `IMmdRuntimeBone.linkedBone` 被类型化为 duck-typed `IMmdRuntimeLinkedBone`，但运行时实际持有完整的 `Bone` 实例。需要访问原生 `Bone` API（如 `getSkeleton()`）
- **类型/运行时**: 类型

---

### 7. `physics` 属性反射访问 —— runtime 物理引擎操作

**文件**:
- `frontend/src/scene/physics/ground-collision.ts`，第 38 行
- `frontend/src/scene/env/env-gravity.ts`，第 22–24 行
- `frontend/src/menus/motion-cloth-levels.ts`，第 56–58 行

```typescript
// ground-collision.ts
const physics = (mmdRuntime as unknown as { physics?: { impl?: MmdWasmPhysicsRuntimeImpl } })
    .physics;

// env-gravity.ts
// physics 是 WASM 版专属 API，JS 版无物理，instanceof 守卫后访问
if (mmdRuntime instanceof MmdWasmRuntime && mmdRuntime.physics) {
    mmdRuntime.physics.setGravity(_gravityVec);
}

// motion-cloth-levels.ts
return (mmdRuntime as unknown as MmdWasmRuntime) ?? null;
```

- **变通模式**: `as unknown as` 类型逃生 / `instanceof` 守卫
- **解决的 babylon-mmd 限制**: `IMmdRuntime` 未暴露 `physics` 属性；需要向下转型为 `MmdWasmRuntime` 才能访问 WASM 特有 API
- **类型/运行时**: 类型

---

### 8. `MmdCompositeAnimation` 模块增强 —— 合成动画的类型兼容

**文件**: `frontend/src/scene/motion/vmd-layers.ts`，第 693–694 行

```typescript
// MmdCompositeAnimation 经类型增强已实现 IMmdBindableModelAnimation（babylon-mmd 在
// mmdCompositeRuntimeModelAnimation 中声明的 module augmentation），可直接传入，无需双重 cast
```

- **变通模式**: 依赖 babylon-mmd 内部的模块增强（`declare module`）
- **解决的 babylon-mmd 限制**: 默认情况下 `MmdCompositeAnimation` 未声明实现 `IMmdBindableModelAnimation`，需要 babylon-mmd 内部的类型增强才能作为 `createRuntimeAnimation` 的参数传入
- **类型/运行时**: 类型

---

### 9. `StreamAudioPlayer._audio` 反射 —— 直接控制音频播放  **[适配层根治中 → ADR-192]**

**文件**: `frontend/src/outfit/audio.ts`，第 55、134、351 行

```typescript
const audio = (streamPlayer as unknown as { _audio?: HTMLAudioElement })._audio;
```

- **变通模式**: 通过 `as unknown as` 反射访问私有字段
- **解决的 babylon-mmd 限制**: `StreamAudioPlayer` 的公共类型未暴露内部的 `_audio: HTMLAudioElement` 字段，但需要访问它以直接控制音频播放（音量、偏移、循环模式等）
- **类型/运行时**: 运行时（功能）
- **稳定性**: ⚠️ 字段重命名会静默失效

---

### 10. `MmdMesh.materials` 类型断言 —— 获取原始材质列表

**文件**: `frontend/src/menus/model-detail.ts`，第 792–797 行

```typescript
// [audit-fix] 材质数必须以 PMX 材质列表为准：MMD 模型通常仅 1 个 Babylon 网格，
// 而 MmdMesh.materials 才是真实材质数组（IMmdModel 不暴露 materials 字段）。
const matCount = (inst.meshes ?? []).reduce((n, m) => {
    const mm = m as unknown as { materials?: readonly unknown[] };
    return n + (mm.materials?.length ?? (m.material ? 1 : 0));
}, 0);
```

- **变通模式**: `as unknown as` 类型逃生
- **解决的 babylon-mmd 限制**: `IMmdModel` 的 `mesh` 是标准 Babylon.js mesh，未暴露 `materials` 数组属性；但 babylon-mmd 加载的 PMX 模型在 `MmdMesh` 上存在 `materials` 属性，用于收集原始材质列表
- **类型/运行时**: 类型

---

### 11. `referenceFiles` 类型断言 —— 自定义纹理文件接口

**文件**: `frontend/src/scene/manager/model-loader.ts`，第 480 行

```typescript
referenceFiles: textureFiles as unknown as File[],
```

- **变通模式**: `as unknown as File[]` 类型断言
- **解决的 babylon-mmd 限制**: babylon-mmd 的 `referenceFiles` 参数类型声明为 `File[]`，但项目使用自定义的 `TextureFile` 接口（包含 `relativePath`、`mimeType`、`data` 字段），与 `File` 类型不兼容
- **类型/运行时**: 类型

---

### 12. `worldMatrix` 时序与坐标系文档 —— 逆工程的运行时行为  **[适配层根治中 → ADR-192]**

**文件**:
- `frontend/src/scene/render/lighting.ts`，第 196–202 行
- `frontend/src/scene/motion/perception-gaze.ts`，第 150–154 行

```typescript
// lighting.ts
// 因为 babylon-mmd 的骨骼 worldMatrix 是在 onBeforeRenderObservable 中更新的，
// 而 onAfterAnimationsObservable 在此之『前』触发，读到的 worldMatrix 是上一帧旧值。

// perception-gaze.ts
// babylon-mmd 的骨骼 worldMatrix 是 rootMesh 局部坐标系（不含 rootMesh 的 scaling/rotation/translation），
```

- **变通模式**: 注释记录了 babylon-mmd 内部时序和坐标系行为——选择正确的 observable 挂钩点，进行坐标系变换
- **解决的 babylon-mmd 限制**: babylon-mmd 未文档化 `worldMatrix` 的更新时机和坐标系语义，需要逆向工程以选择正确的时序
- **类型/运行时**: 运行时（功能/知识）

---

### 13. 自定义 2-bone IK —— WASM 模式下 `ikSolver = null`

**文件**:
- `frontend/src/motion-algos/two-bone-ik.ts`（完整算法实现）
- `frontend/src/scene/motion/bone-override.ts`，第 566 行
- `frontend/src/scene/motion/feet-adjustment.ts`

```typescript
// bone-override.ts
// WASM 模式下 babylon-mmd 的 IkSolver 不可用（ikSolver 字段为 null），
// 改用本地的 TwoBoneIKSolver 替代

// two-bone-ik.ts 开头
// 职责: WASM 模式下 babylon-mmd 的 IkSolver 不可用（ikSolver 字段为 null），
// 由 feet-adjustment.ts 和 bone-override.ts 使用
```

- **变通模式**: 完整实现了一个自定义的两骨骼 IK 求解器（`TwoBoneIKSolver`）
- **解决的 babylon-mmd 限制**: babylon-mmd 的 WASM 运行时在骨骼上设置 `ikSolver = null`，不提供 JS IK 求解器——所有 IK 在 WASM 端处理，但自定义脚部调整需要 JS 端的 IK 能力
- **类型/运行时**: 运行时（功能）
- **稳定性**: ✅ 完全独立于上游

---

### 14. `seekAnimation(0)` —— `setRuntimeAnimation` 不重置时钟  **[适配层根治中 → ADR-192]**

**文件**: `frontend/src/scene/motion/vmd-loader.ts`，第 164–174 行（缩略图渲染场景）；同模式散落 `playback.ts:101`、`vmd-layers.ts:721`（切换重置），以及 `shortcut-app.ts:153/175`（快进快退，合法 seek 非补丁）

```typescript
// [fix] 切换动作时将 runtime 全局时钟归零到第 0 帧：setRuntimeAnimation 只换动画句柄，
// 不会重置 _currentFrameTime。若上一动作播到 50s、新动作仅 10s，currentTime 仍滞留 50s，
// 缩略图 renderInstanceThumbnail 内部 rt.render() 触发的 beforePhysics 会判定
// elapsedFrameTime(50s) > 新动作时长(10s) → 立即置 _animationPaused 并 onPause →
// setIsPlaying(false)，表现为「点击动作 0.01s 后被重置为无动作」。
// seekAnimation(0, true) 同步归零时钟+摆到第 0 帧...
```

- **变通模式**: 在设置新动画后强制调用 `seekAnimation(0, true)`
- **解决的 babylon-mmd 限制**: `setRuntimeAnimation` 不会重置内部时钟 `_currentFrameTime`，导致新旧动画时长差异大时立即暂停
- **类型/运行时**: 运行时（功能 / 上游 bug workaround）
- **稳定性**: ✅ 稳定，不依赖私有字段

---

### 15. `VmdLoader` 无 `dispose()` API

**文件**: `frontend/src/scene/motion/vmd-loader.ts`，第 105–106 行

```typescript
// babylon-mmd fork 的 VmdLoader 无实例状态需释放（解析结果已转移到 mmdAnimation），
// 不存在 dispose() API；loader 为局部引用，GC 自动回收，无需手动释放。
```

- **变通模式**: 文档注释说明为什么没有调用 dispose
- **解决的 babylon-mmd 限制**: `VmdLoader` 没有 `dispose()` 方法
- **类型/运行时**: 运行时（API 设计）

---

### 16. Babylon-mmd mock —— 单元测试基础设施

**文件**: `frontend/src/__tests__/mocks/babylon-mmd-mocks.ts`

```typescript
// babylon-mmd 的 appendTransformSolver.js 在模块求值期调用 Matrix.Identity()
// --- babylon-mmd 子模块桩（复用 material-editor 已验证集合）---
// 防止 scene.ts 引入真实 babylon-mmd 触发 mmdStandardMaterial 装饰器 / 静态初始化
```

各测试文件通过 `vi.mock('babylon-mmd/esm/...')` 模拟 babylon-mmd 模块：

```typescript
vi.mock('babylon-mmd/esm/Runtime/mmdRuntime');
vi.mock('babylon-mmd/esm/Loader/mmdStandardMaterial');
// ...
```

- **变通模式**: 使用 vitest 的 `vi.mock` 模拟整个 babylon-mmd 模块树
- **解决的 babylon-mmd 限制**: babylon-mmd 模块在顶层有副作用（装饰器、`Matrix.Identity()` 调用、着色器注册），无法在没有完整 Babylon.js 环境的单元测试中导入
- **类型/运行时**: 运行时（测试）

---

### 17. `onPause` 代替 `onFinish` —— 无动画结束事件

**文件**: `frontend/src/scene/motion/playback.ts`，第 77–79 行

```typescript
// NOTE: babylon-mmd fires onPause when animation reaches the end (no
// separate onFinish event), so the auto-loop logic lives here.
```

- **变通模式**: 使用 `onPauseAnimationObservable` 同时处理暂停和动画结束
- **解决的 babylon-mmd 限制**: babylon-mmd 没有 `onFinish`/`onComplete` 事件，动画结束时触发 `onPause`
- **类型/运行时**: 运行时（功能）

---

### 18. 移除 `monkey-patch createMmdModel` —— 替代方案

**文件**:
- `frontend/src/physics/wind-physics.ts`，第 100–101 行
- `frontend/src/scene/manager/model-loader.ts`，第 597 行

```typescript
// wind-physics.ts
// [adr-104] 已移除原 monkey-patch createMmdModel 的做法（脆弱，
// babylon-mmd 内部实现变更即静默失效），改为显式调用点承载。

// model-loader.ts
// 替代原 monkey-patch createMmdModel 的脆弱做法（不再拦截创建路径）
```

- **变通模式**: 文档注释记录历史上的 monkey-patch 及其被替代的原因
- **解决的 babylon-mmd 限制**: babylon-mmd 的私有方法（如 `createMmdModel`）实现不稳定，monkey-patch 会在 babylon-mmd 升级时静默失效
- **类型/运行时**: 运行时（架构决策/ADR-104）

---

### 19. 无 `mmdRuntime.runtimeAnimation` 属性

**文件**: `frontend/src/core/dev-hooks.ts`，第 63–67 行

```typescript
// Use focusedModel().vmdName instead of mmdRuntime.runtimeAnimation
// which doesn't exist in babylon-mmd's public API.
```

- **变通模式**: 改用其他公共 API（`focusedModel().vmdName`）
- **解决的 babylon-mmd 限制**: `mmdRuntime` 没有 `runtimeAnimation` 公共属性
- **类型/运行时**: 类型

---

### 20. physics 属性 instanceof 守卫 —— JS vs WASM 区分

**文件**: `frontend/src/scene/env/env-gravity.ts`，第 22–24 行

```typescript
// physics 是 WASM 版专属 API，JS 版无物理，instanceof 守卫后访问
if (mmdRuntime instanceof MmdWasmRuntime && mmdRuntime.physics) {
    mmdRuntime.physics.setGravity(_gravityVec);
}
```

- **变通模式**: `instanceof` 守卫 + 条件访问
- **解决的 babylon-mmd 限制**: `IMmdRuntime` 接口未声明 `physics` 属性（WASM 独有）
- **类型/运行时**: 类型

---

### 21. 着色器 side-effect 导入 —— 注册渲染器/纹理/着色器

**文件**: `frontend/src/scene/scene.ts`，第 19–61 行

```typescript
import 'babylon-mmd/esm/Loader/mmdOutlineRenderer';
import 'babylon-mmd/esm/Loader/sharedToonTextures';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment';
// ...
```

- **变通模式**: 通过仅 side-effect 的导入来注册渲染器、共享纹理和着色器
- **解决的 babylon-mmd 限制**: babylon-mmd 的许多模块需要作为 side-effect 导入（它们修改 Babylon.js 的 `Scene.prototype` 或注册全局资源），但在官方文档中未明确说明
- **类型/运行时**: 运行时（设置）

---

### 22. `MmdWasmInstanceTypeMPR` 条件动态导入 —— 多线程 worker 与单线程构建冲突

**文件**: `frontend/src/scene/scene.ts`，第 30–34、587 行

```typescript
// 静态导入第 30 行：静态导入 MmdWasmInstanceTypeSPR（单线程版本）
import { MmdWasmInstanceTypeSPR } from 'babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease';

// 第 587 行条件动态导入 MPR（多线程版本）：
await import('babylon-mmd/esm/Runtime/Optimized/InstanceType/multiPhysicsRelease');

// 注释第 33-34 行：
// 注意：MmdWasmInstanceTypeMPR 必须动态 import，静态 import 会把 worker 拉进图导致构建失败。
```

- **变通模式**: 条件动态 `import()`（非静态 `import`）
- **解决的 babylon-mmd 限制**: babylon-mmd 的 MPR 实例类型需要 `SharedArrayBuffer`，并且其 web worker 不能与单线程构建打包在一起
- **类型/运行时**: 运行时（构建/功能）

---

### 23. 测试中 `IMmdModel` mock 的类型断言

**文件**:
- `frontend/src/__tests__/physics-bridge.test.ts`，第 13 行
- `frontend/src/__tests__/virtual-skirt.test.ts`，第 203 行

```typescript
// physics-bridge.test.ts
{ runtimeBones: bones } as unknown as IMmdModel

// virtual-skirt.test.ts
model as unknown as IMmdModel
```

- **变通模式**: `as unknown as IMmdModel` mock 断言
- **解决的 babylon-mmd 限制**: 创建最小 `IMmdModel` 模拟对象时，无需实现完整接口
- **类型/运行时**: 类型（测试）

---

## 三、风险评估

### 🔴 高脆弱性（上游升级时可能静默失效）

| ID | 位置 | 风险 | 缓解 |
|----|------|------|------|
| 3 | `wind-physics.ts` 反射 `_rigidBodyBundleMap` | 字段重命名 → 返回 undefined → 风物理静默降级 | 代码中有显式的类型检查 + 抛错提示，升级时若触发错误会引导检查 |
| 9 | `audio.ts` 反射 `_audio` | 字段重命名 → audio 功能异常 | 无显式守卫，依赖开发者自查 |

### 🟡 中等脆弱性

| ID | 位置 | 风险 | 缓解 |
|----|------|------|------|
| 1 | `RuntimeModel` intersection type | 上游新增同名成员可能冲突 | 类型错误会在编译期暴露 |
| 2 | `MmdRuntimeBoneExtended` | 同上 | 同上 |
| 4–11, 19–20, 23 | 各类 `as unknown as` cast | 上游 API 变更时类型可能不兼容 | 类型错误会在编译期暴露 |

### 🟢 低风险

| ID | 位置 | 理由 |
|----|------|------|
| 12–18 | 运行时替代方案 | 不依赖上游内部实现，独立逻辑 |
| 21–22 | side-effect / 条件导入 | 构建配置问题，不依赖上游 API 变化 |
| 16, 23 | 测试 mock | 仅测试环境有效，不影响运行时 |

---

## 四、决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-07-27 | ❌ **放弃向上游提 PR** | 上游不接受 AI 编写的 PR，且有明确的设计分歧 |
| 2026-07-27 | ✅ **保留所有本地应对措施** | 它们是上游最小接口策略下的正确本地方案 |
| 2026-07-27 | ✅ **`RuntimeModel` augmentation 保持** | 上游明确 `IMmdModel` 应最小化，本地交集类型是推荐模式 |
| 2026-07-27 | ✅ **Go 侧损坏映射保持**（ADR-058） | PMX Shift-JIS 编码证据不足，上游不认可 PR；Go 侧兜底是正确路径 |
| 2026-07-27 | ✅ **ADR-110 登记册冻结** | 所有上游 PR 候选不再推进。登记册保留为历史记录 |
| 2026-07-27 | ✅ **Gaze 逻辑内联** | 上游不赞成 Observable 钩子模式，gaze 逻辑直接在 `beforePhysics()` 中内联 |

---

## 五、逆向审计（官方文档交叉验证）

> 审计日期：2026-07-27。基于 `babylon-mmd-docs/reference/overview`、`reference/runtime/mmd-webassembly-runtime` 等官方文档，对 23 处应对做必要性反向验证。

### 审计证据（官方文档锚点）

| 官方文档锚点 | 内容 | 印证条目 |
|------|------|---------|
| overview §286 | "MmdRuntimeAnimation ... generally not recommended for direct access, so createRuntimeAnimation returns a handle" | 1, 5 |
| overview §142–146 | 从根导入是 side-effect 入口；tree-shakable 应 import `.pure` 模块 | 21 |
| overview §207 | SPR/SR/SPD 等 WASM 实例类型命名 | 22 |
| mmd-wasm-runtime §74 | MmdWasmRuntime "provides almost the same API" as MmdRuntime（非完全一致） | 1, 2 |
| mmd-wasm-runtime §82 | 用 MmdWasmRuntime 后类型自动传播为 MmdWasmModel | 1, 2 |
| mmd-wasm-runtime §117–118 | MmdWasmModel.createRuntimeAnimation / setRuntimeAnimation | 1 |
| mmd-wasm-runtime §153–155 | WASM Limitations：不能改 prototype/继承；高度定制建议用 JS runtime | 13 |

### 审计结论

23 处应对全部与上游设计立场一致，**无冗余、无误判**：

- **A 类 — 类型层必要补充（上游推荐模式）**：条目 1/2/4/5/6/7/9/10/11/19/20/23。因 IMmdModel 最小化 + 两 runtime 不可互换，本地交集类型（`RuntimeModel`）/接口扩展（`MmdRuntimeBoneExtended`）/`as unknown as` cast 是上游设计下的正确消费方模式（官方 §286/§74/§82/§117 印证）。
- **B 类 — 上游行为/约束的 workaround**：条目 12/13/14/17。worldMatrix 时序未文档化（逆工程）、WASM ikSolver=null（§153–155 解释）、setRuntimeAnimation 不重置时钟、onPause 代替 onFinish。
- **C 类 — 构建/测试/架构决策**：条目 3/8/15/16/18/21/22。side-effect 导入（§142 印证）、MPR 动态导入（§207 印证）、测试 mock、移除 monkey-patch、模块增强、无 dispose API、反射内部字段。

### 升级回归重点（高脆弱点）

| ID | 字段 | 失效模式 | 回归动作 |
|----|------|---------|---------|
| 3 | `_rigidBodyBundleMap` | 重命名 → 风物理静默降级 | 代码有显式检查 + 抛错；bump 时若报错即查 |
| 9 | `_audio` | 重命名 → 音频异常 | 无守卫，依赖开发者 bump 时自查 |

**建议**：将本表纳入 `babylon-mmd` 版本升级前的必查清单（对应 README 定位「永久自治维护台账」）。

---

## 六、附录：上游 PR 尝试记录

| PR | 内容 | 提交日期 | 合并状态 | 关闭原因 |
|----|------|---------|---------|---------|
| [#94](https://github.com/noname0310/babylon-mmd/pull/94) | `IMmdModel` 接口补全 | 2026-07-27 | ❌ 已关闭 | AI 代理 + 设计分歧 |
| [#95](https://github.com/noname0310/babylon-mmd/pull/95) | PMX Shift-JIS 解码 | 2026-07-27 | ❌ 已关闭 | 证据不足 + AI 代理 |
| [#96](https://github.com/noname0310/babylon-mmd/pull/96) | Physics 钩子 | 2026-07-27 | ❌ 已关闭 | AI 代理 + 设计分歧 |

---

*本报告由 Riku（联邦首席架构师 AI）于 2026-07-27 编写，作为 upstream PR 路径关闭后的兼容性基线文档。*
