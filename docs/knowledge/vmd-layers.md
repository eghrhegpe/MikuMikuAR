---
kind: vmd_layers
name: 多 VMD 叠加系统
category: motion
scope:
  - frontend/src/scene/motion/vmd-layers.ts
source_files:
  - frontend/src/scene/motion/vmd-layers.ts
adr: []
symbols:
  - VmdLayer
  - addVmdLayer
  - removeVmdLayer
  - rebuildCompositeAnimation
  - _nextLayerId
invariants:
  - MmdCompositeAnimation 在每次层变更时重建
  - 层 ID 唯一（crypto.randomUUID 前缀）
  - VMD 字节需 Shift-JIS 解码（骨骼名）
tests: []
use_when:
  - 多层动作
  - 动作叠加
  - VMD 混合
  - composite animation
  - 动作图层
  - 动作优先级
---

## 系统概览
**多层 VMD 动画叠加系统**。通过 `MmdCompositeAnimation` 将多个 VMD 图层按优先级混合播放，
支持动态添加/移除图层、Shift-JIS 编码解析（VMD 骨骼名），并在层变更时自动重建复合动画。

## 核心职责
- `vmd-layers.ts` — 图层管理（增删改）、复合动画重建、VMD 字节解码、层状态序列化。

## 对外 API（节选）
- `interface VmdLayer` — 图层描述（id、filePath、priority、loop、speed 等）。
- `addVmdLayer(layer, modelId?)` — 添加 VMD 图层。
- `removeVmdLayer(layerId, modelId?)` — 移除图层。
- `rebuildCompositeAnimation(modelId?)` — 根据当前层重建复合动画。
- `getVmdLayers(modelId?)` — 取当前图层列表。
- `_decodeSjis(bytes)` — Shift-JIS 字节解码为 Unicode 字符串。

## 与其他子系统关系
- 使用 `babylon-mmd` 的 `MmdCompositeAnimation` / `MmdAnimationSpan`。
- 依赖 `@/core/types.VmdLayer` 类型定义。
- 文件读取：`@/core/wails-bindings.readFileBytes`。
- 场景序列化：层状态写入 `scene-serialize.ts`。
- 与 `motion-intent.ts` 协作：动作意图驱动默认图层。

## 不变量
- 每次层变更必须调用 `rebuildCompositeAnimation` 重建复合动画。
- 层 ID 全局唯一，使用 `crypto.randomUUID()` 生成。
- VMD 文件编码为 Shift-JIS，必须解码后才能正确匹配骨骼名。
