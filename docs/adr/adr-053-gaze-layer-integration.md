# ADR-053: Gaze 图层集成 —— 视线追踪作为图层类型

> **日期**: 2026-07-06
> **状态**: 已完成
> **关联**：ADR-016(视线追踪骨骼覆写)、ADR-051(VMD 图层系统)

---

## 背景

视线追踪（gaze）在现有架构中是一个独立子系统（ADR-016），通过 `proc-motion-bridge.ts` 的 `setGazeLayerActive` 控制实时骨骼覆写。VMD 图层系统（ADR-051）支持多 VMD 按权重混合，但不理解"gaze"这种非 VMD 的图层类型。

用户新增 gaze layer 后，触发的行为是完整 VMD 重载（`_rebuildCompositeAnimation`），而非轻量 gaze 激活，导致不必要的性能开销。

### 需求

1. Gaze 作为图层出现在 UI 中，而非后台独立开关
2. Gaze 的 toggle/weight/remove 操作不走全量 VMD 重建
3. 序列化/反序列化必须保留 gaze weight 和 enabled 状态
4. 每个模型最多一个 gaze 层

---

## 方案

### 类型层面：`VmdLayer.kind` 增加 `'gaze'`

```typescript
kind: 'vmd' | 'gaze';
```

`'gaze'` 层不参与 `MmdCompositeAnimation` 混合，其 `data` 为空的 `ArrayBuffer(0)`。

### 快速路径：`_applyGazeLayers`

新增函数，过滤出模型的所有 enabled gaze 层，调用 `setGazeLayerActive(active, intensity)`：

- **触发点**：`addGazeLayer` / `removeVmdLayer`(gaze) / `toggleVmdLayer`(gaze) / `setVmdLayerWeight`(gaze)
- **不触发**：`_rebuildCompositeAnimation`，跳过 VMD 数据解析和 composite 重建
- **惰性 import**：`_applyGazeLayers` 内 `await import('./proc-motion-bridge')`，避免与 `proc-motion-bridge.ts` 的循环依赖

### 权重传递

`addGazeLayer(modelId, name, weight, enabled)` 在创建时直接应用权重/开关，反序列化时一次到位，无需后赋值。

### 去重

模型已有 `kind === 'gaze'` 的图层时 `addGazeLayer` 返回 `null`，避免多 gaze 层冲突。

---

## 决策对比

| 方案 | 描述 | 结果 |
|------|------|------|
| gaze 在 VMD composite 中实现 | 将 gaze 骨骼覆写编码为 VMD 帧数据 | ❌ 每帧生成 VMD 数据，违背轻量原则 |
| gaze 不进入图层系统 | 保持独立开关，不与图层 UI 整合 | ❌ 用户缺少统一管理入口 |
| **gaze 作为特殊图层类型（选中）** | `VmdLayer.kind = 'gaze'`，不走 composite | ✅ 统一管理 + 快速路径 |

---

## 涉及文件

| 文件 | 变更 |
|------|------|
| `core/types.ts` | `VmdLayer.kind` 扩展为 `'vmd' \| 'gaze'` |
| `scene/motion/vmd-layers.ts` | 新增 `addGazeLayer`、`_applyGazeLayers`；gaze 分支在 toggle/weight/remove 中走快速路径 |
| `scene/motion/proc-motion-bridge.ts` | 已有 `setGazeLayerActive(active, intensity)`，被惰性 import |
| `scene/scene-serialize.ts` | 反序列化调用 `addGazeLayer(id, name, weight, enabled)` 传递 weight |
| `menus/motion-popup.ts` | UI 调用 `await addGazeLayer()` 适配 async 签名 |

---

## 未来优化

- **重量优化**：`_applyGazeLayers` 当前从 `proc-motion-bridge` import `setGazeLayerActive`，若多模型共用一个桥接实例可简化
- **Gaze 与其他图层的交互**：当前 gaze 独立于 VMD composite，如需视线参与骨骼混合（如头部 40% VMD + 60% gaze），需扩展 `_applyGazeLayers` 的权重语义
