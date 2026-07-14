# ADR-109: SdefInjector + SdefMesh 接入 — SDEF 球面变形

**状态**: 已完成（2026-07-14 落地 — side-effect import 已加入 `scene.ts`）

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

**来源**: `docs/research/babylon-mmd-api-analysis.md` §2.2 SdefInjector / SdefMesh / §五 P2

**关联**: ADR-098（babylon-mmd 批次一，描边渲染）、`frontend/src/scene/manager/material.ts`（材质系统）

**影响面**: `frontend/src/scene/scene.ts`（side-effect import 注册）

---

## 问题

MMD 原生渲染使用 SDEF（Spherical Deformation）球面变形算法，使关节弯曲处的网格变形更自然——尤其是肘部、膝盖等部位，SDEF 能产生平滑的体积保持效果，避免线性蒙皮（Linear Blend Skinning）的"糖果包装纸"塌陷现象。

当前项目使用 babylon-mmd 的 `MmdStandardMaterial` 渲染 MMD 模型，但**未注册 SDEF 支持**。项目代码中没有任何 `Sdef` 相关导入或引用。

### 影响

| 模型类型 | 现状 | 启用 SDEF 后 |
|----------|------|-------------|
| 标准 PMX 模型（含 SDEF 顶点） | 回退到线性蒙皮，关节弯曲处可能有轻微塌陷 | 关节弯曲更自然，体积保持更好 |
| 无 SDEF 顶点模型 | 无影响 | 无影响（SDEF 通道为空时零开销） |

### 收益评估

SDEF 是**零风险视觉提升**——仅需一行 side-effect import 注册 `SdefInjector`，`MmdStandardMaterial` 在检测到网格包含 SDEF 顶点数据时自动启用球面变形着色器变体。无 SDEF 顶点的模型零开销。

---

## 决策

**以 side-effect import 注册 `SdefInjector`，让 `MmdStandardMaterial` 自动为含 SDEF 顶点的网格启用球面变形。**

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. side-effect 注册 SdefInjector** | **✅ 采用** | 一行 import，零侵入，零运行时改动，有 SDEF 即可受益 |
| B. 自建 SDEF 着色器 | ❌ 否决 | 重复 babylon-mmd 已解决的 WebGPU/WebGL 双后端适配 |
| C. 不动 | ❌ 否决 | 放弃 1 行代码即可获得的视觉提升 |

---

## 约束

1. **注册方式**：`SdefInjector` 采用 side-effect 挂载模式，导入模块时自动将 SDEF 着色器变体注册到 `MmdStandardMaterial` 的着色器库中。`SdefMesh` 是 SDEF 顶点数据的容器，在 PMX 加载时自动解析。
2. **与 MmdOutlineRenderer 的关系**：SDEF + 描边同时启用时，描边基于 SDEF 变形后的网格计算，效果一致。本 ADR 与 ADR-098 的描边渲染正交。
3. **WebGPU 兼容性**：babylon-mmd v1.2.0 的 SDEF 着色器已适配 WebGPU WGSL，无需额外处理。
4. **与 MmdStandardMaterialProxy 的配合**：当前项目通过 `MmdStandardMaterialProxy` 创建材质，SDEF 的启用是在材质构建时自动检测的，无需修改代理逻辑。

---

## 实现计划

### 具体改动

在 `frontend/src/scene/scene.ts` 顶部 import 区增加一行：

```typescript
// SDEF 球面变形：side-effect import，注册 SDEF 着色器变体到 MmdStandardMaterial。
// 网格含 SDEF 顶点数据时自动启用球面变形，关节弯曲更自然；无 SDEF 顶点时零开销。
import 'babylon-mmd/esm/Loader/sdefInjector';
```

### 工作量

| 步骤 | 预估 |
|------|------|
| 修改 `scene.ts` 增加 import | 1 分钟 |
| `npm run check` 验证类型 | 1 分钟 |
| `npm run build` 验证构建 | 2 分钟 |
| 真机验证 SDEF 效果 | 10 分钟 |

总计约 15 分钟，是当前所有待搬运 API 中**工作量最小、收益最明确**的一项。

---

## 后果

### 正面

- ✅ 含 SDEF 顶点的 PMX 模型关节弯曲更自然，视觉提升立竿见影
- ✅ 无 SDEF 顶点模型零开销（着色器变体惰性编译）
- ✅ 一行 side-effect import，零配置，零运行时改动
- ✅ 与 MmdOutlineRenderer 兼容，描边基于 SDEF 变形网格

### 负面

- ⚠️ 极小 bundle 体积增加（SDEF 着色器代码约 1-2 KB gzip）
- ⚠️ 首次遇到 SDEF 网格时有着色器编译小卡顿（与 `MmdStandardMaterial` 首次渲染的卡顿合并，不额外增加）
- ⚠️ `SdefInjector` 的 side-effect 导入路径可能随 babylon-mmd 主版本升级而变化，需在升级时确认

---

## 验证方法

1. 找一个含 SDEF 顶点的 PMX 模型（大多数现代 PMX 2.0 模型都包含 SDEF 数据）
2. 加载后观察肘部/膝盖弯曲时的网格变形
3. 对比启用前后的关节平滑度（可通过注释掉 import 行快速切换）
4. 验证 WebGPU 和 WebGL 双后端下表现一致

---

## 后续（可选增强）

若 SDEF 效果满意，未来可考虑：

| 增强 | 说明 |
|------|------|
| SDEF 强度控制 | 暴露 `SdefMesh` 的变形强度参数，允许用户调节 |
| 调试可视化 | 在骨骼可视化模式下高亮显示 SDEF 顶点区域 |
| 性能统计 | 统计当前场景中 SDEF 网格数量，帮助用户理解性能开销 |