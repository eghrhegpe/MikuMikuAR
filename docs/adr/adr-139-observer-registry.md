# ADR-139: ObserverRegistry 生命周期收敛

- **状态**: 立项
- **日期**: 2026-07-19
- **相关**: ADR-105（AbortSignal 传递规范）、ADR-106（时序审核与异步生命周期）

## 背景与问题

Babylon.js Observer 注册/移除分散在 34 处 `add` 和 23 处 `remove`，存在以下结构性缺陷：

1. **句柄存储不统一**: `env-clouds.ts:731` 存 `_volCloudMesh.metadata.obs`；`env-sky.ts:322` 存 `_envSys.sky.skyMesh.metadata.skyFollowObs`；其余存模块级变量。`metadata` 类型为 `any`，丢失类型安全。
2. **泄漏风险**: 移除路径若漏调 `.remove()` 即泄漏渲染回调，尤其菜单/场景热重载时。
3. **审核困难**: grep 难以保证 add/remove 成对，无中央注册表可审计。

## 决策

新建 `core/observer-registry.ts`，提供 `DisposableGroup` 和 `useObserver` 封装，禁止把 observer 句柄塞进 `mesh.metadata`。

```typescript
// 核心 API
class DisposableGroup {
    add<T extends { dispose(): void }>(...disposables: T[]): void
    dispose(): void  // 统一移除所有注册的 observer
}

function useObserver<T extends Observable<any>>(
    observable: T,
    event: Parameters<T['add']>[0],
    callback: Parameters<T['add']>[1]
): Disposable

// 使用示例
const group = new DisposableGroup();
group.add(
    useObserver(scene.onBeforeRenderObservable, () => { ... }),
    useObserver(scene.onAfterRenderObservable, () => { ... }),
);
// 清理时
group.dispose();  // 一次性移除所有 observer
```

## 方案设计

### 1. observer-registry.ts（新建）

```typescript
export class DisposableGroup {
    private _disposables: { dispose(): void }[] = [];
    
    add<T extends { dispose(): void }>(...disposables: T[]): void {
        this._disposables.push(...disposables);
    }
    
    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}

export function useObserver<T extends Observable<any>>(
    observable: T,
    event: Parameters<T['add']>[0],
    callback: Parameters<T['add']>[1]
): Disposable {
    const observer = observable.add(event, callback);
    return { dispose: () => observable.remove(observer) };
}
```

### 2. 迁移策略

- 每个子系统维护模块级 `_group = new DisposableGroup()`
- 注册 observer 时 `group.add(useObserver(...))`
- dispose 时调用 `_group.dispose()` 一次性清理
- 禁止 `mesh.metadata.xxxObs` 模式，改为模块级变量

### 3. 涉及文件

| 文件 | add 数 | 迁移方式 |
|------|--------|---------|
| `scene/camera/camera.ts` | 5 | 模块级 group |
| `scene/env/env-sky.ts` | 2 | 模块级 group |
| `scene/env/env-clouds.ts` | 2 | 替换 metadata 存储 |
| `scene/env/env-particles.ts` | 2 | 模块级 group |
| `scene/render/lighting.ts` | 3 | 模块级 group |
| `scene/env/planar-reflection.ts` | 4 | 模块级 group |
| `core/render-loop.ts` | 4 | 模块级 group |
| `scene/motion/playback.ts` | 2 | 模块级 group |
| 其余 12 处 | 12 | 模块级 group |

## 影响面

- **代码**: 17 个文件，34 处 add 调用点
- **行为**: 无行为变化，仅内部封装
- **测试**: 各子系统 dispose 后 observer 100% 移除

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 迁移遗漏导致泄漏 | 🟡 中 | lint 规则禁止 metadata 存 observer |
| dispose 顺序变化 | 🟢 低 | 各子系统独立 group，顺序无关 |
| 性能开销 | 🟢 低 | 仅多一层封装，无额外分配 |

## 分阶段实施

- **阶段 0（本 ADR）**: 立项
- **阶段 1**: 新建 observer-registry.ts
- **阶段 2**: 迁移 env 子系统（env-sky/env-clouds/env-particles）
- **阶段 3**: 迁移 scene 子系统（camera/lighting/render-loop/motion）
- **阶段 4**: 迁移其余 + lint 规则

## 验收标准

- observer add/remove 100% 配对
- `mesh.metadata` 中 0 个 observer 句柄
- `npm run test` 全绿
