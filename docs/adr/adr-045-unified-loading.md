# ADR-045: 统一加载与资源管理（精简版）

> **状态**: ✅ 已完成（Phase 1 + Phase 2 全部落地）
> **关联**: ADR-023（Android 文件访问）、ADR-034（菜单统一）
> **来源**: ADR-045 + ADR-046 合并（2026-07-08）

---

## 问题

加载五类资源（actor/stage/prop/vmd/audio）架构骨架已统一，但肌肉层各自生长：

1. **舞台加载 Bug**：`buildStageLevel` 漏传 `targetStack` 参数；舞台路径硬编码忽略 `overridePaths.stage`
2. **舞台/道具缺材质入口**：model 有材质调节，stage/prop 无
3. **四套加载签名**：模型/VMD/道具/音频各有独立锁机制，互不兼容

---

## 核心架构

### ResourceHandle 接口

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

### LoadManager 统一队列

```ts
class LoadManager {
    private queue = Promise.resolve();
    load(req: LoadRequest): Promise<ResourceHandle> {
        return this.queue = this.queue.then(() => this.dispatch(req));
    }
}
```

四套锁机制统一为单一队列，跨资源类型自然排队。

### 统一详情面板骨架

公共结构按 `kind` 条件渲染：

```
[变换] 位置/旋转/缩放/可见性      ← actor/stage/prop 共有
[外观] 材质调节/服装变体          ← actor/stage/prop 都有材质，服装仅 actor
[信息] 基本信息/骨骼层级/标签     ← actor/stage 有，prop 仅基本信息
[工具] 预设/用…打开              ← actor 有
[危险] 卸载
```

---

## Phase 1 实施（ADR-045）

| 优先级 | 任务 | 状态 |
|-------|------|------|
| P0 | 修舞台 bug（targetStack + overridePaths.stage）| ✅ |
| P0 | 舞台详情面板加材质入口 | ✅ |
| P1 | 道具材质支持（MaterialTarget 抽象）| ✅ |
| P1 | LoadManager 骨架 + 队列统一 | ✅ |
| P2 | 统一详情面板骨架（resource-detail-helpers.ts）| ✅ |
| P3 | Android SAF 桥接 | ✅ ADR-023 Wails Dialog 已解决，无需自建 |

---

## Phase 2 实施（ADR-046）

### 2A：菜单层迁移到 `loadManager.load()`

| 文件 | 旧调用 | 新调用 |
|------|--------|--------|
| `library-core.ts` | `loadVMDFromPath()` | `loadManager.load({kind:'vmd',...})` |
| `scene-prop-levels.ts` | `loadProp()` | `loadManager.load({kind:'prop',...})` |
| `motion-popup.ts` | `loadVMDFromPath/loadCameraVmdFromPath/loadAudioFile()` | `loadManager.load(...)` |
| `model-preset.ts` | `loadVMDFromPath/loadAudioFile()` | `loadManager.load(...)` |
| `main.ts` (handleDropFile) | `loadVMDFromPath()` | `loadManager.load(...)` |
| `scene-serialize.ts` | 直接调用 | **保留直接调用**（反序列化批量原子操作，不应被用户操作打断） |

### 2B：移除底层锁

| 锁 | 文件 | 移除 |
|----|------|------|
| `isLoadingModel` | `model-loader.ts` | ✅ |
| `isLoadingVmd` | `vmd-loader.ts` | ✅ |
| `_propLoadQueue` + `isLoadingProp` | `props.ts` | ✅ |
| `_loadId` 竞态 | `audio.ts` | ✅ |

### 2C：ResourceHandle 返回值统一

vmd/audio/camera-vmd 现也返回 `ResourceHandle`（`id` 暂为空串，待进度追踪/撤销时填充）。

### 2D：VMD 伴音自动加载

VMD 加载成功后自动发现同目录同名音频（.mp3/.wav/.ogg/.flac），设置开关默认开启。

> **伴音不走 `loadManager.load({kind:'audio'})` 的原因**：`_tryLoadCompanionAudio` 在 dispatch 内部执行，再入 `loadManager.load()` 会导致队列死锁。伴音是 VMD 的同步副操作，保持直接调 `loadAudioFile`。

### 死代码清理

- `state.ts`：删除 `isLoadingModel / isLoadingVmd / isLoadingProp`（孤儿状态）
- `scene.ts`：删除上述字段的 import
- `motion-camera-levels.ts`：删除未使用的 `loadCameraVmdFromPath` import

---

## 已知缺口

1. **测试覆盖**：仅手动验证，建议补 `LoadManager` 串行排队与反序列化恢复的单元测试
2. **`ResourceHandle.id` 占位**：vmd/audio/camera-vmd 的 id 暂为空串，非阻塞
3. **舞蹈套装原子加载**：VMD+Audio+Offset 三步非原子，待 `loadTransaction(reqs[])` 接口落地

---

## 不在范围

- zip 内 VMD 加载链路（需"先解压→找模型→配 VMD"两步流程）
- 模型预设/舞蹈套装的 UI 层重构（仅后端加载链路统一）