# ADR-051: VMD 图层系统与骨骼级过滤

> **日期**: 2026-07-06
> **状态**: 已完成
> **关联**：ADR-016(视线追踪骨骼覆写)

---

## 背景

VMD 动作文件通常包含全身骨骼 + 表情变换。用户需要在基础 VMD 之上叠加局部动作（如手势、头部转向），而不覆盖基础动作的其他部分。单纯加载多个 VMD 无法解决此问题 —— 后加载的 VMD 会完全替换前一个。

### 需求

1. 支持在基础 VMD 上叠加多个图层（不同权重混合）
2. 每个图层可指定 `boneFilter` —— 只覆盖特定骨骼，其余骨骼穿透到基础层
3. 图层顺序和权重可调
4. 场景序列化必须保留图层配置

---

## 方案：MmdCompositeAnimation

利用 babylon-mmd 内置的 `MmdCompositeAnimation`，它支持将多个 `MmdAnimationSpan` 按权重混合：

```
composite.addSpan(span1)  // 基础 VMD, weight=1.0
composite.addSpan(span2)  // 图层 A: 上半身, weight=0.8
composite.addSpan(span3)  // 图层 B: 手部, weight=0.5
```

每个 span 包含一个 `MmdAnimation`、起止帧和混合权重。`MmdCompositeAnimation` 在运行时按权重混合每帧骨骼变换。

### 权重归一化

当多个 span 共存时，总权重 > 1 可能导致骨骼旋转溢出。实现中做了归一化：

```
normalizedWeight = layerWeight / totalWeight
```

各 span 权重归一化到和 = 1.0，保持旋转插值稳定。

### 单层零拷贝优化

当只加载一个图层且无基础 VMD 时，直接走 `loadVMDMotion` 单 VMD 路径，不创建 composite 对象，减少开销。

---

## boneFilter 方案

### 可选方案对比

| 方案 | 描述 | 问题 |
|------|------|------|
| A. 修改 `MmdBoneAnimationTrack` | `mmdAnimation.boneTracks` 是 typed array 数组，删掉目标轨道 | `MmdBoneAnimationTrack` 内部是二进制布局，无公开 API 安全修改 |
| B. **VMD 二进制过滤（选中）** | 解析 VMD 二进制骨骼帧，只保留匹配 `boneFilter` 的帧，重建 VMD | 零耦合，完整保留插值曲线/morph/尾部数据 |
| C. 视线追踪式骨骼覆写 | `onBeforeRenderObservable` 每帧 override 目标骨骼旋转 | 一直跑循环，不适用于图层（需框架的混合支持） |

### 选 B：VMD 二进制级过滤

#### 原理

VMD 格式中，骨骼帧区位于文件 offset 54（签名 30B + 模型名 20B + 骨骼帧数 uint32），每帧固定 111 字节：

```
offset 0:  骨骼名 15B (Shift-JIS, null padded)
offset 15: 位置 12B (float32 × 3)
offset 27: 旋转 16B (float32 × 4)
offset 43: 插值曲线 68B (byte × 68)
```

过滤流程：

1. 验证 VMD 签名（"Vocaloid Motion Data"）
2. 读取骨骼帧数（offset 50，uint32 LE）
3. 遍历每帧 111 字节，读 15 字节骨骼名 → Shift-JIS 解码 → 匹配 `boneFilter`
4. **全匹配**：返回原 `ArrayBuffer` 引用（零拷贝）
5. **部分匹配**：重建新 VMD 二进制 —— 复制头部(54B) → 写入新帧数 → 串联保留的 111B 帧块 → 追加 morph 及尾部数据

#### 插值曲线完整性

Mmd 的 68 字节插值曲线（每个变换轴 17 段 x 4 byte 二阶贝塞尔参数）紧跟在每帧旋转后。过滤时整 111 字节块复制，曲线完全保留——MmdRuntime 读取时骨骼帧数减少，但每帧格式不变。

#### 解码依赖

骨骼名使用 `encoding-japanese` 库解码 Shift-JIS 到 UTF-8。VMD 标准规定骨骼名固定 15 字节，Shift-JIS 编码（部分 MMD 工具写 UTF-8，但规范要求 SJIS）。

---

## WASM 运行时多图层

`MmdWasmRuntime` 不支持 `MmdCompositeAnimation` —— 其 `createRuntimeAnimation` 期望 `MmdWasmAnimation`，而 composite 对象不兼容。

### 主路径：JS 帧流合并（ADR-056，已实施）

[ADR-056](adr-056-wasm-runtime-motion-layers.md) 已通过 C 方案解决：WASM 下多图层混合走 **JS 帧流合并**——每帧在 JS 侧求值各 overlay 图层骨骼变换，与 base VMD 经 WASM 管线计算的结果在 frontBuffer 层面混合（位置 Lerp + 旋转 Slerp + 权重归一化），覆写 `MmdWasmRuntimeBone.worldMatrix` frontBuffer + 递归传播子骨骼。复用 ADR-016 gaze 双路径的基础设施。性能数据见 ADR-056 §九。

### 降级路径（B1 兜底）

C 方案失败或 `VITE_WASM_LAYERS_BLEND=0` 时启用：
1. `console.error` + 状态栏提示回退
2. 只加载第一个图层（或基础 VMD）到单 VMD 管线
3. 不影响应用运行，图层 UI 和配置保持不变

JS 运行时（`VITE_MMD_RUNTIME=js`）完整支持图层混合，走原生 `MmdCompositeAnimation`，不受影响。

---

## 反序列化优化

### 问题

场景恢复时逐个 `addVmdLayerFromPath` 会导致 N 次 `_rebuildCompositeAnimation`，每次重建都要加载和解析全部 VMD 数据。

### 解决

新增 `addVmdLayersFromPaths(paths: ...)` 批量 API：先加载所有 VMD 数据，再单次调用 `_rebuildCompositeAnimation`。`scene-serialize.ts` 的 `deserializeScene` 改用此 API，将 N+1 次重建降为 1 次。

---

## 图层 ID

原使用单调计数器 `_layerIdCounter`，场景多次保存/恢复后可能冲突。改用 `crypto.randomUUID()` 保证跨会话唯一。

---

## 涉及文件

| 文件 | 角色 |
|------|------|
| `scene/motion/vmd-layers.ts` | 图层管理核心（CRUD + rebuild + boneFilter） |
| `scene/scene-serialize.ts` | 场景序列化集成 |
| `menus/motion-popup.ts` | 图层 UI（绑定/权重/删除） |
| `menus/library-core.ts` | 模型库上下文（绑定路径管理） |
| `core/types.ts` | VmdLayer / VmdLayerSerialized 类型定义 |
| `core/utils.ts` | closeAllOverlays 清理绑定路径 |
