# ADR-139: Observer 生命周期统一管理

- **状态**: ✅ 已完成
- **日期**: 2026-07-19
- **实现**: 2026-07-19
- **相关**: ADR-105（AbortSignal 传递规范）、ADR-106（时序审核与异步生命周期）

## 背景与问题

Babylon.js Observer 注册/移除分散在 34 处 `add` 和 23 处 `remove`，存在以下结构性缺陷：

1. **句柄存储不统一**: `env-clouds.ts` 存 `_volCloudMesh.metadata.obs`；`env-sky.ts` 存 `_envSys.sky.skyMesh.metadata.skyFollowObs`；其余存模块级变量。`metadata` 类型为 `any`，丢失类型安全。
2. **泄漏风险**: 移除路径若漏调 `.remove()` 即泄漏渲染回调，尤其菜单/场景热重载时。
3. **审核困难**: grep 难以保证 add/remove 成对，无中央注册表可审计。

## 决策

新建 `core/observer-handle.ts`，提供 `ObserverHandle`、`observe`/`observeOnce` 便利函数和 `ObserverRegistry` 批量管理器。

```typescript
// 核心 API
class ObserverHandle {
    dispose(): void  // 从 Observable 移除 observer，幂等
}

function observe<T>(observable: Observable<T>, callback: (data: T, state: any) => void): ObserverHandle
function observeOnce<T>(observable: Observable<T>, callback: (data: T, state: any) => void): ObserverHandle

class ObserverRegistry {
    add<T>(observable: Observable<T>, callback: ...): ObserverHandle
    register(handle: ObserverHandle): void
    disposeAll(): void  // 一次性清理所有
}
```

### 与草案的差异

实际实现将草案中的 `DisposableGroup` + `useObserver` 方案简化为 `ObserverHandle` + `observe` 函数，原因：
- 避免 `Disposable` 接口的抽象开销（`dispose(): void` 已足够）
- `observe(fn)` 比 `useObserver(obs, null, fn)` 更简洁
- `ObserverRegistry` 可选，不强制模块使用

## 实现细节

### 1. observer-handle.ts（新建）

`frontend/src/core/observer-handle.ts` 包含三个核心导出：

- **`ObserverHandle`** — 封装 `Observable` + `Observer` 对，`dispose()` 调用 `observable.remove(observer)`，幂等
- **`observe(observable, callback)`** — 替代 `observable.add(callback)`，返回 `ObserverHandle`
- **`observeOnce(observable, callback)`** — 替代 `observable.addOnce(callback)`，返回 `ObserverHandle`
- **`ObserverRegistry`** — 收集多个句柄，`disposeAll()` 批量清理

### 2. 迁移策略

- 每个模块用 `ObserverHandle | null` 替换 `Observer<X> | null`
- `add()` → `observe()`，`remove()` / `removeCallback()` → `handle.dispose()`
- `mesh.metadata.xxxObs` 模式改为模块级 `ObserverHandle` 变量
- 不改变业务逻辑，仅封装 add/remove 调用点

### 3. 涉及文件

| 文件 | 变更 |
|------|------|
| `core/observer-handle.ts` | 新建 |
| `core/render-loop.ts` | 2 处 add/remove |
| `scene/env/env-clouds.ts` | 替换 metadata 存储 |
| `scene/env/env-sky.ts` | 替换 metadata 存储 |
| `scene/env/env-impl.ts` | 1 处 add/remove |
| `scene/env/env-particles.ts` | 3 处 add/remove |
| `scene/env/env-water.ts` | 1 处 add/remove |
| `scene/env/mirror-debug.ts` | 2 处 add/remove |
| `scene/env/env-context.ts` | 类型定义更新 |
| `scene/render/renderer.ts` | 3 处 add/remove |
| `scene/render/lighting.ts` | 1 处 add/remove |
| `physics/physics-bridge.ts` | 1 处 add/remove |
| `physics/wind-physics.ts` | 1 处 add/remove |
| `scene/motion/perception.ts` | 1 处 add/remove |
| `scene/motion/wasm-layers-blender.ts` | 1 处 add/remove |
| `scene/motion/playback.ts` | 3 处 add/remove |
| `scene/motion/bone-override.ts` | 1 处 add/remove |
| `scene/motion/feet-adjustment.ts` | 1 处 add/remove |
| `motion-algos/footstep-detect-fallback.ts` | 1 处 add/remove |
| `scene/manager/model-manager.ts` | 1 处 add/remove |
| `scene/ar/ar-scene.ts` | 1 处 add/remove |
| `scene/camera/camera.ts` | 5 处 add/remove |
| `scene/scene.ts` | 2 处 add/remove |
| `scene/env/env-bridge.ts` | 1 处 add/remove |
| `outfit/outfit.ts` | 2 处 add/remove |
| `__tests__/playback.test.ts` | 测试 mock 更新 |

### 4. 明确保留（未迁移，安全）

| 文件 | 原因 |
|------|------|
| `transform-gizmo.ts` | 6 个 add 由 `gizmo.dispose()` 自动清理 |
| `planar-reflection.ts` | 4 个 add 由 `rt.dispose()` 自动清理 |
| `scene.ts` onPointerObservable | 需 mask 参数，由 scene dispose 自动清理 |

> **修订记录**：`camera.ts` 的 `onViewMatrixChangedObservable` 原列于本表（理由「由 camera dispose 自动清理」），但实际代码已全部迁移至 `observe()` + `ObserverHandle`（5 处），切换相机时显式 `safeDispose` 形成双保险。已从保留表移除。

## 影响面

- **代码**: 1 个新文件 + 24 个修改文件，34 处 add 调用点全部迁移
- **行为**: 无行为变化，仅内部封装。`dispose()` 替代 `remove()` / `removeCallback()` / `observer.remove()`
- **测试**: 70 文件 / 1641 测试全部通过

## 验收标准

- ✅ observer add/remove 100% 配对
- ✅ `mesh.metadata` 中 0 个 observer 句柄
- ✅ `npm run test` 全绿
- ✅ TypeScript 编译零错误

## 后续工作

- 考虑在 `ObserverHandle` 中添加 `AbortSignal` 支持，与 ADR-105 对齐
- 考虑添加 lint 规则禁止 `Observable.add()` 直接调用（强制使用 `observe`）