# ADR-032: 体积云渲染方案调查

> **日期**: 2026-07-05
> **状态**: 已完成 — 调查完毕，结论：Babylon.js 无内置体积云，现有自定义 shader 保留

---

## 背景

当前体积云实现（`env-clouds.ts`）使用自定义 ShaderMaterial-on-Sphere 方案，视觉效果不理想。用户希望切换到 Babylon.js 内置方案。

## 调查结论

**Babylon.js 9.x 没有内置 VolumetricClouds（撰写时 9.14.0，结论在多版本间成立）。**

验证方式：
- GitHub 源码 `packages/dev/core/src/PostProcesses/` 目录无 cloud 相关文件
- `packages/dev/materials/src/` 无 cloud material（只有 cell/fire/fur/grid/lava/sky/terrain/water）
- Babylon.js 官方文档无 volumetric clouds 页面
- `volumetricLightScatteringPostProcess` 是 god rays，不是体积云

## 现有实现问题

| 问题 | 现状 | 影响 |
|------|------|------|
| 噪声太简单 | 3 octaves FBM + 256³ value noise | 云形状像棉絮，无细节层次 |
| 无 weather map | 云密度全局均匀 | 无法控制哪里密哪里疏 |
| 无 erosion/sharpen | 原始 FBM 直出 | 云边缘模糊，缺乏卷曲细节 |
| 步进固定 | 200 步 × 8.0 单位 | 近处太粗，远处浪费 |
| 无 temporal reprojection | 每帧独立计算 | 闪烁、不稳定 |
| 光照简陋 | 单次散射 + 固定 ambient | 无银边、无体积感 |
| 性能 | 200 步 raymarch/fragment | 移动端卡顿 |

## 决策

保留现有自定义 shader，不做切换（无内置方案可切）。

### 可选改进方向（未来）

| 改进 | 工作量 | 价值 |
|------|--------|------|
| Weather map 控制云分布 | ~1 天 | 高 — 云不再均匀铺满 |
| 多层噪声 + erosion | ~1.5 天 | 高 — 云边缘细节 |
| Adaptive step size | ~0.5 天 | 中 — 近处精细远处粗糙 |
| Temporal reprojection | ~1 天 | 中 — 消除闪烁 |
| 双散射 + ambient occlusion | ~1 天 | 低 — 视觉提升有限 |

### 不适配方案

| 方案 | 原因 |
|------|------|
| Babylon.js 内置 VolumetricClouds | 不存在 |
| 第三方云库（如 three-clouds） | 依赖 Three.js，不兼容 Babylon.js |
| GPU 粒子模拟云 | 性能更差，不适合大面积覆盖 |
