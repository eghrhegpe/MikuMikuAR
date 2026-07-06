# ADR-043: DanceXR 功能差距挖掘

**日期**：2026-07-05
> **状态**: 已完成 — 调研归档

---

## 背景

从 `docs/research/dancexr-zh/` 37 份文档中挖掘增量功能目标，按项目现有功能分区组织。

## 差距清单

| 分区 | 新增目标数 | 代表功能 |
|------|-----------|---------|
| A. 动作与媒体 | 6 | Motion Layers、Lifelike Motions、Playback Modes、Remix、Motion Override、Catwalk |
| B. 角色呈现 | 3 | Eye Contact、Feet Adjustment、Auto Reset |
| C. 场景与编排 | 5 | Formation、Auto Camera、Concert Camera 增强、Mirror Prop、Scene Bundle |
| D. 渲染与外观 | 2 | Toon Shading、Mesh-to-Cloth |
| E. 物理扩展 | 2 | Soft Body、Ragdoll |
| F. 系统与工具 | 4 | Recording、Video Player、Accessory Attachment、Scene Relative Paths |

明确标注 4 个不适配项（AI Chat、Discovery App、Bone Mapper、Body Paint）。

## 关联

完整差距清单已写入 `docs/roadmap.md`。ADR-037 已实现其中 5 项（Motion Layers、Lifelike、Formation、Auto Camera、Scene Bundle）。
