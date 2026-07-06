# ADR-045: 统一加载与资源管理

**日期**：2026-07-06
> **状态**: P0+P1+P2 已完成，P3 待实施

---

## 背景

加载角色/动作/场景/道具/音乐五类资源时，架构骨架已统一（`FileAccessor` 抽象 + `resolveFileUrl` 路径解析 + `scene-serialize` 反序列化入口），但「肌肉层」各自生长，引发两类问题：

### 问题 1：舞台加载 Bug

`buildStageLevel` 调用 `buildLevel(libraryRoot, '舞台', filter)` 时漏传 `targetStack` 参数。`renderItemsWithRAF` 内部点击 folder 走 `targetStack || stackRegistry.modelStack` 兜底，而场景菜单下用户从未打开模型弹窗时 `modelStack` 为 undefined，导致 `stack.push(next)` 抛 TypeError。

同时舞台库路径硬编码为 `libraryRoot`，忽略了用户在设置→路径中配置的 `overridePaths.stage` 覆盖路径。

### 问题 2：舞台/道具缺少材质调节入口

- 模型（actor）：`buildModelLevel` → 材质调节（完整 UI）
- 舞台（stage）：虽在 `modelRegistry` 且 `_capture` 已对 stage meshes 调用，但 `buildStageTransformLevel` 无材质入口
- 道具（prop）：在独立的 `propRegistry`，材质 API 写死 `modelRegistry.get(id)`，后端不支持

### 问题 3：加载链路四套签名

| 资源 | 入口 | 返回 | 并发控制 |
|------|------|------|---------|
| 模型 | `loadPMXFile` | `string\|null` | `isLoadingModel` 布尔锁，并发拒绝 |
| VMD | `loadVMDMotion` / `loadVMDFromPath` | `void` | `isLoadingVmd` 布尔锁，并发静默 return |
| 道具 | `loadProp` | `string\|null` | `_propLoadQueue` Promise 链串行 |
| 音频 | `loadAudioFile` | `void` | `_loadId` 事务 ID，最新胜出 |

跨资源类型无法排队（如道具加载中点击模型行为未定义），舞蹈套装的 VMD+Audio+Offset 三步非原子。

## 决策

### 1. 统一 Registry 接口 — `ResourceHandle`

```ts
interface ResourceHandle {
    id: string;
    kind: 'actor' | 'stage' | 'prop' | 'vmd' | 'audio' | 'camera-vmd';
    name: string;
    filePath: string;
    meshes?: Mesh[];
    transform?: TransformNode;
    dispose(): void;
}
```

`modelRegistry`（actor+stage）和 `propRegistry` 都满足 `ResourceHandle` 子集。材质 API 改为接受 `MaterialTarget`（`{ meshes, state }`），不再绑 id 查 `modelRegistry`。

### 2. 统一加载入口 — `LoadManager`

```ts
class LoadManager {
    private queue = Promise.resolve();
    load(req: LoadRequest): Promise<ResourceHandle> {
        return this.queue = this.queue.then(() => this.dispatch(req));
    }
}
```

- 把四种锁机制收敛成单一队列，跨资源类型自然排队
- 留事务接口：`loadTransaction(reqs[])` 串行执行多步，任一失败回滚已加载资源

### 3. 统一详情面板骨架 — `buildResourceDetailLevel`

公共结构按 kind 条件渲染：

```
[变换] 位置/旋转/缩放/可见性      ← actor/stage/prop 共有
[外观] 材质调节/服装变体          ← actor/stage/prop 都有材质，服装仅 actor
[信息] 基本信息/骨骼层级/标签     ← actor/stage 有，prop 仅基本信息
[工具] 预设/用…打开              ← actor 有
[危险] 卸载
```

`buildModelLevel`/`buildStageTransformLevel`/`buildPropDetailLevel` 改为薄壳，调用 `buildResourceDetailLevel(handle)` 并按 kind 补充专属区块。

### 4. 平台读取收尾

`FileAccessor` 抽象已就位。Android 文件选择已通过 Wails Dialog (SAF) 完成（ADR-023），Wails 将选中文件复制到 cache 后返回真实路径，LoadManager 只处理 `file://` 路径。`content://` URI 桥接（copy to private dir → serve）因 Wails 原生支持 SAF 文件选择，实际不再需要。iOS 沙盒适配同路径。

## 实施优先级

| 优先级 | 任务 | 影响面 | 状态 |
|-------|------|-------|------|
| P0 | 修舞台 bug（targetStack + overridePaths.stage）| `scene-stage-levels.ts` | ✅ |
| P0 | 舞台详情面板加材质入口 | `scene-stage-levels.ts` | ✅ |
| P1 | 道具材质支持（MaterialTarget 抽象）| `material.ts` + `props.ts` + `model-material.ts` + `scene-prop-levels.ts` | ✅ |
| P1 | LoadManager 骨架 + 队列统一 | 新建 `core/load-manager.ts`（骨架，菜单层尚未迁移）| ✅ |
| P2 | 统一详情面板骨架 | 新建 `resource-detail-helpers.ts`，stage/prop 改为薄壳；model-detail 因结构差异保持现状 | ✅ |
| P3 | Android SAF 桥接 IsolateModelDir | Go 后端 | ✅ 已由 ADR-023 Wails Dialog 文件选择器解决，无需自建桥接 |

## 不在范围

- zip 内 VMD 加载链路（VMD 常绑定特定模型，需"先解压→找模型→配 VMD"两步流程，留待舞蹈套装事务接口落地时一并设计）
- 模型预设/舞蹈套装的 UI 层重构（仅后端加载链路统一，UI 暂保持）

## 后果

**正向**：
- 舞台加载 bug 修复，用户可正常浏览/加载舞台
- 舞台/道具获得与模型一致的材质调节能力，UI 一致性提升
- 加载链路单一入口，新增资源类型只需实现 `dispatch` 分支
- 跨资源排队自然支持，舞蹈套装原子性可后续叠加

**负向**：
- LoadManager 引入一层间接，调试时栈深增加
- 道具材质支持需要解耦 material.ts 的 id-bound API，触及测试mock

## 相关

- [ADR-018](adr-018-path-manager-abstraction.md) — PathManager 抽象
- [ADR-023](adr-023-android-file-access-strategy.md) — Android 文件访问策略
- [ADR-034](adr-034-menu-unification.md) — 菜单统一
- `docs/architecture.md` §渲染环节 / §场景序列化
