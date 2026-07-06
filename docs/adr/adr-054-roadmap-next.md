# ADR-054: 后续开发方向路线图

> **状态**: 规划（2026-07-06 创建）
> **背景**: ADR-039 废除 `docs/roadmap.md` 后，后续方向仅以各 ADR「## 后续方向」小节碎片化存在，无优先级汇总。本 ADR 集中承载**经代码事实核实**的后续开发计划，作为"下一步做什么"的统一入口。

---

## 一、核实基线（2026-07-06 代码事实）

经 `frontend/src` 全量 grep 核验，以下功能**已实现**（非缺口）。竞品矩阵已在 `competitive-analysis.md` 校正：

| 功能 | 落地证据 | 备注 |
|------|----------|------|
| Motion Layers（双 VMD / boneFilter） | `vmd-layers.ts` + `MmdCompositeAnimation` | ADR-051 |
| Eye Contact / 视线追踪 | gaze 图层 | ADR-016 / ADR-053 |
| 队形预设 Formation | `model-manager.ts` 6 种预设 | — |
| Auto Camera 程序化运镜 | `beat-detector.ts` + `camera.ts` 8 预设 | — |
| Scene Bundle 场景打包 | `scene-bundle.ts` + Go `BundleScene` | ⚠️ zip 内 VMD 加载待支持 |
| Lifelike 生命力 | `procedural-motion.ts` 伪随机眨眼(2~8s) + 自动呼吸 | 区别于竞品「高斯」 |
| 渲染三件套 | `renderer.ts` SSAO / Outline / Toon | — |
| LipSync 振幅同步 | `lipsync.ts` | 共振峰口型仍待增强 |

---

## 二、真实缺口（未做）

### 🔴 架构裂缝（需中期决策）

**WASM / JS 运行时分裂**
- 现象：`MmdCompositeAnimation` + gaze 仅 **JS 运行时**生效（`vmd-layers.ts:522` 确认 WASM 回退单图层）；服装/头发 Bullet 物理仅 **WASM** 有。
- 决策选项：① 推动上游 `babylon-mmd` 支持 WASM composite；② 确定默认运行时策略（性能物理 vs 高级动作二选一）。
- 影响：高级动作功能无法在默认（高性能物理）运行时生效——当前最该拍板的架构决策。

### 🟡 功能缺口

| 功能 | 价值 | 难度 | 依赖 / 说明 |
|------|------|------|-------------|
| 智能材质分类 | 中 | 中 | 自动检测皮肤/头发/眼睛/服装 |
| 道具挂载 Accessory | 中 | 中 | 骨骼锚点 + UI |
| Mesh-to-Cloth 自动布料 | 高 | 高 | 客观裙摆识别转 XPBD 约束，替代程序化圆锥裙 |
| T-pose / A-pose 转换 | 高 | 中高 | 骨骼名标准化 + 姿态重定向 |
| Pose Studio / 拍照模式 | 高 | 中 | 构图辅助线 + 景深 + 批量出图 + 水印 |
| Playback Modes | 中 | 低 | 单次 / 随机 / 循环列表 |
| Remix 跨套装音频交换 | 中 | 低 | VMD 资产复用 |
| LipSync 共振峰口型 | 中 | 中 | 振幅 → 共振峰，HBR MMD Tools 路线 |
| i18n 语言切换 | P0 | 中 | 打开非中文市场 |
| 垂直同步开关 | P1 | 低 | RAF 无简单开关 |
| 设置导入 / 导出 | P2 | 低 | — |
| 全量重置补全 | P2 | 低 | 当前仅外观 / 快捷键 |
| Shift-JIS URL 编码 (`%EF%BF%BD`) | P0 | 中 | Base64 + 查询参数方案，稳定性硬伤 |

### 🟡 上游阻塞（卡 `babylon-mmd`，不独立启动）

- **PBR 材质**：全量迁移会破坏 morph 管线。
- **SSS 次表面散射**：依赖 PBR proxy。
- **光线追踪 / 全局光照 GI**。
- 策略：只能等 / 推动上游贡献。

---

## 三、优先级分期

### P0（立即，低成本高感知）
1. i18n 语言切换框架
2. 垂直同步开关 + 设置导入 / 导出 + 全量重置补全
3. Shift-JIS URL 编码修复

> 注：高斯眨眼 / 自动呼吸 / LipSync 振幅 / Toon 均已实现，不列入。

### P1（本季度，护城河 B：多模型导演台核心）
4. Formation 队形预设（已有 6 预设，待序列化保存）
5. Auto Camera 程序化运镜（已有 8 预设，待节拍驱动闭环）
6. Playback Modes + Remix
7. Pose Studio / 拍照模式
8. T-pose / A-pose 转换

### P2（中期，深化护城河）
9. Scene Bundle 分发（先解 zip 内 VMD 加载债）
10. Mesh-to-Cloth 自动布料
11. 道具挂载 / 智能材质分类
12. WASM 运行时图层支持（推动上游）或运行时策略决策

### P3（远期探索）
13. Soft Body / Ragdoll（XPBD 体积约束已预置）
14. iOS 端
15. SSS（待上游 PBR proxy）
16. Lua / JS 脚本层（自动化工作流）
17. Alembic / glTF 导出

---

## 四、风险提醒

- **`babylon-mmd` 单点故障**：SSS / PBR / WASM composite 全部卡在上游，需评估是否参与上游贡献。
- **WASM / JS 分裂不解决** → 高级动作功能无法在默认运行时生效，是最高优先级架构决策。

---

## 五、相关 ADR 索引（分散的「后续方向」小节）

后续方向的详细讨论散落于以下 ADR，本文件为汇总入口：

- ADR-017 Android 适配 → 后续方向
- ADR-018 路径管理器抽象 → 后续方向
- ADR-023 Android 文件访问 → 后续方向
- ADR-024 渲染增强 Phase2 SSR / ReflectionProbe → 后续方向
- ADR-029 物理 UI 重构 → 后续方向

> 注：原 `docs/roadmap.md` 已由 ADR-039 废除，其差距清单 / 目标内容已并入 `docs/competitive-analysis.md` 与各 ADR。本 ADR 为后续方向的集中入口。
