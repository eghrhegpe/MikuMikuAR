# ADR-046: 统一加载 Phase 2 — 底层锁移除与菜单层迁移

**日期**：2026-07-06
> **状态**：提案阶段

---

## 背景

ADR-045 建立了 `LoadManager` 骨架，实现跨资源类型串行排队。当前状态：

```
菜单/序列化层 ——直接调→ loadPMXFile / loadVMDFromPath / loadProp / loadAudioFile
                                  ↕
                          各自的内部锁（双层队列）
                                  ↕
                           LoadManager (已存在但未被菜单层使用)
```

实际调用链路与预期架构有落差：

| 调用者 | 当前调用 | 应改为 |
|--------|----------|--------|
| `library-core.ts` (onItemClick) | `loadVMDFromPath()` | `loadManager.load({kind:'vmd',...})` |
| `scene-stage-levels.ts` (加载道具按钮) | `loadProp()` | `loadManager.load({kind:'prop',...})` |
| `scene-prop-levels.ts` (浏览道具库) | `loadProp()` | `loadManager.load({kind:'prop',...})` |
| `motion-popup.ts` (onItemClick) | `loadVMDFromPath/loadCameraVmdFromPath/loadAudioFile()` | `loadManager.load(...)` |
| `model-preset.ts` | `loadVMDFromPath/loadAudioFile()` | `loadManager.load(...)` |
| `main.ts` (handleDropFile) | `loadVMDFromPath()` | `loadManager.load(...)` |
| `scene-serialize.ts` (deserializeScene) | `loadPMXFile/loadVMDFromPath/loadProp/loadAudioFile/loadCameraVmdFromPath()` | 序列化恢复：保留直接调用以跳过队列 |

### 四套底层锁概览

| 锁机制 | 文件 | 表现 |
|--------|------|------|
| `isLoadingModel` 布尔锁 | `model-loader.ts:117` | 加载中时静默 return null，用户无反馈 |
| `isLoadingVmd` 布尔锁 | `vmd-loader.ts:125/196/227` | 共享同一布尔锁，VMD/相机VMD/VPD 互斥 |
| `_propLoadQueue` Promise 链 | `props.ts:26-39` | 串行队列 + `isLoadingProp` 布尔守卫 |
| `_loadId` 事务 ID | `audio.ts:15` | 最新胜出的竞态模式，旧加载不会报错但被静默放弃 |

## 决策

### 1. Phase 2A：菜单层迁移到 `loadManager.load()`

将所有菜单层的直接加载调用替换为 `loadManager.load()`。**这是移除底层锁的前提条件**——只有所有调用都走 LoadManager，底层锁才是冗余的。

**迁移规则**：

```ts
// 旧
loadVMDFromPath(path, modelId);
// 新
loadManager.load({ kind: 'vmd', path, modelId });

// 旧
loadProp(path);
// 新
loadManager.load({ kind: 'prop', path });

// 旧
loadAudioFile(path);
// 新
loadManager.load({ kind: 'audio', path });

// 旧
loadCameraVmdFromPath(path);
// 新
loadManager.load({ kind: 'camera-vmd', path });
```

**例外**：`scene-serialize.ts` 的 `deserializeScene()` **保留直接调用**。原因：
- 反序列化是批量操作，模型 → VMD → 道具是确定的拓扑顺序，不应被其他用户操作插入打断
- 反序列化加载过程中如果插入一个独立的菜单点击，会导致复杂的状态竞态
- 序列化恢复本身就是"原子事务"，不需要再套 LoadManager

### 2. Phase 2B：移除底层锁

菜单层迁移完成后，各加载器内部的锁机制变为冗余，按以下顺序移除：

#### 步骤 1：`loadPMXFile` — 移除 `isLoadingModel`

```
- if (isLoadingModel) { setStatus(...); return null; }  ← 删
- setIsLoadingModel(true/false)                          ← 删（包括 try/finally 中）
```
串行化由 LoadManager 队列保障。`loadPMXFile` 的 `captureThumbnail`、`_tryAutoApplyPreset`、`_loadOutfits` 等副操作（fire-and-forget）不影响加载顺序。

#### 步骤 2：`loadVMDFromPath/loadCameraVmdFromPath/loadVPDPose` — 移除 `isLoadingVmd`

```
- if (isLoadingVmd) { return; }             ← 删
- setIsLoadingVmd(true/false)               ← 删
```

注意这三个函数共享 `isLoadingVmd` 锁。移除后，VMD / 相机 VMD / VPD 姿势在 LoadManager 层面自然排队，不再互斥。

#### 步骤 3：`loadProp` — 移除 `_propLoadQueue` 和 `isLoadingProp`

`props.ts` 的 `enqueueLoad()` 自己实现了一套 Promise 链：
```ts
let _propLoadQueue = Promise.resolve();
function enqueueLoad<T>(loader: () => Promise<T>): Promise<T> {
    const result = _propLoadQueue.then(loader, loader);
    _propLoadQueue = result.then(() => {}, () => {});
    return result;
}
```

移除后 `loadProp` 变为普通 async 函数，串行化由 LoadManager 保障。

同时移除 `isLoadingProp`/`setIsLoadingProp` 的 import 和调用。

#### 步骤 4：`loadAudioFile` — 移除 `_loadId` 竞态防护

`audio.ts` 的 `_loadId` 设计用于"新加载覆盖旧加载"场景：
```ts
const myLoadId = ++_loadId;
// ... await resolveFileUrl ...
if (myLoadId !== _loadId) return; // 被新加载覆盖，放弃
```

LoadManager 串行化后，不会出现并发加载，`_loadId` 的保护逻辑成为死代码。移除 `_loadId` 和相关检查。

### 3. Phase 2C：`ResourceHandle` 返回值统一

当前 actor/stage/prop 返回 `ResourceHandle`，vmd/audio/camera-vmd 返回 `null`。统一为：

```ts
// dispatch 签名
async dispatch(req: LoadRequest): Promise<ResourceHandle | null> {
    // VMD/Audio 也返回 handle
    case 'vmd':
        const { loadVMDFromPath } = await import('../scene/motion/vmd-loader');
        await loadVMDFromPath(req.path, req.modelId);
        return { id: `vmd_${Date.now()}`, kind: 'vmd', name: '', filePath: req.path };
    // 同理 audio/camera-vmd
}
```

这样调用方始终得到一个有意义的 handle，可为后续进度追踪/撤销功能铺垫。

### 4. Phase 2D：`loadTransaction` 接口

为舞蹈套装（VMD+Audio+Offset）原子加载提供事务接口：

```ts
class LoadManager {
    async loadTransaction(reqs: LoadRequest[]): Promise<(ResourceHandle | null)[]> {
        const results: (ResourceHandle | null)[] = [];
        const loaded: { kind: string; cleanup: () => Promise<void> }[] = [];
        try {
            for (const req of reqs) {
                const result = await this.dispatch(req);
                results.push(result);
            }
            return results;
        } catch (err) {
            // 回滚：按加载逆序清理
            for (const item of loaded.reverse()) {
                await item.cleanup();
            }
            throw err;
        }
    }
}
```

当前阶段只定义签名和基本回滚模型。P4 阶段具体落地到"舞蹈套装 UI 触发原子加载"的场景。

## 实施计划

| 优先级 | 任务 | 文件 | 影响面 |
|--------|------|------|--------|
| P3a | 菜单层迁移到 `loadManager.load()` | `library-core.ts`, `scene-stage-levels.ts`, `scene-prop-levels.ts`, `motion-popup.ts`, `model-preset.ts`, `main.ts` | 中等——每处改为调用 `loadManager.load()` |
| P3b-1 | `loadPMXFile` 移除 `isLoadingModel` | `model-loader.ts` + `state.ts` | 低——LoadManager 已保证串行 |
| P3b-2 | `loadVMDFromPath/loadCameraVmdFromPath/loadVPDPose` 移除 `isLoadingVmd` | `vmd-loader.ts` + `state.ts` | 低——LoadManager 已保证串行 |
| P3b-3 | `loadProp` 移除 `_propLoadQueue` + `isLoadingProp` | `props.ts` + `state.ts` | 低——LoadManager 已保证串行 |
| P3b-4 | `loadAudioFile` 移除 `_loadId` | `audio.ts` | 低——不再有并发 |
| P3c | `ResourceHandle` 返回值统一 | `load-manager.ts` | 低——不影响调用方契约 |
| P4 | `loadTransaction` 舞蹈套装原子加载 | `load-manager.ts` + UI 层 | 较大——需设计套装 UI |

### 注意事项

1. **迁移与移除不能同步进行**。必须先完成菜单层迁移，让所有用户操作都走 LoadManager，然后才能移除底层锁。否则会出现"移除了锁但没有排队"的窗口期。

2. **`loadProp` 的 `enqueueLoad` 特殊处理**。`props.ts` 的 `_propLoadQueue` 本身就是 Promise 链 + 布尔锁的混合体。移除 `enqueueLoad` 包装后 `loadProp` 直接是 async 函数体。

3. **`deserializeScene` 的例外必须文档化**。在 scene-serialize.ts 和 load-manager.ts 中都加注释说明"批量反序列化跳过 LoadManager"。

4. **测试策略**。未有覆盖测试，每步需手动验证：
   - 模型加载中点击另一个模型 → 排队而非被拒绝
   - VMD 加载中加载道具 → 道具等待 VMD 完成
   - 连续加载不丢失状态
   - 序列化恢复正常

## 迁移期间兼容性

P3a 阶段（菜单迁移）完成后但 P3b（移除锁）尚未完成时：

```
菜单层 → LoadManager → 底层加载器（锁还在，但不会触发因为 LoadManager 已串行）
```

此时底层锁永远不会被触发（因为 LoadManager 已经串行化请求），锁相当于"安全网"——不产生功能影响，只是冗余代码。这允许分步提交。

## 结果

**正向**：
- 消除双层队列的认知负担，加载链路 `LoadManager → 加载器` 直线化
- 移除 4 套不同风格的并发控制，统一由 LoadManager 管理
- VMD/相机VMD/VPD 自然排队不互斥
- 为舞蹈套装原子加载奠定架构基础

**负向**：
- 迁移期间需要改动 6 个文件，需逐一验证
- `deserializeScene` 的例外增加了架构理解成本
- 无涵盖测试，依靠手动验证

## 相关

- [ADR-045](adr-045-unified-loading-and-resource.md) — 统一加载与资源管理（Phase 1）
- `frontend/src/core/load-manager.ts` — LoadManager 实现
- `frontend/src/core/state.ts` — isLoadingModel / isLoadingVmd / isLoadingProp 定义
- `frontend/src/scene/manager/model-loader.ts` — loadPMXFile
- `frontend/src/scene/motion/vmd-loader.ts` — loadVMDFromPath / loadCameraVmdFromPath / loadVPDPose
- `frontend/src/scene/env/props.ts` — loadProp
- `frontend/src/outfit/audio.ts` — loadAudioFile
