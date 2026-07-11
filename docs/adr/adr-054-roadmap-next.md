# ADR-054: 后续开发方向路线图

> **状态**: 规划（2026-07-06 创建；2026-07-07 代码复核修订；2026-07-11 全量核实更新 + 正式废弃 JS 调试运行时，所有剩余功能仅面向 WASM）
> **背景**: ADR-039 废除 `docs/roadmap.md` 后，后续方向仅以各 ADR「## 后续方向」小节碎片化存在，无优先级汇总。本 ADR 集中承载**经代码事实核实**的后续开发计划，作为"下一步做什么"的统一入口。

---

## 一、核实基线（2026-07-11 代码事实）

经 `frontend/src` 全量 grep 核验，以下功能**已实现**（非缺口）。竞品矩阵已在 `competitive-analysis.md` 校正：

| 功能 | 落地证据 | 备注 |
|------|----------|------|
| Motion Layers（双 VMD / boneFilter） | `scene/motion/vmd-layers.ts` + `MmdCompositeAnimation` | ADR-051 |
| Eye Contact / 视线追踪 | gaze 图层（`proc-motion-bridge.ts` `setGazeLayerActive`） | ADR-016 / ADR-053 |
| 队形预设 Formation | `scene/manager/model-manager.ts` 6 种预设 | — |
| Auto Camera 程序化运镜 | `motion-algos/beat-detector.ts` + `scene/camera/camera.ts` 8 预设 | 节拍驱动闭环已实现 |
| Scene Bundle 场景打包 | `scene/scene-bundle.ts` + Go `BundleScene` | ✅ zip 内 VMD 已打包/回写 |
| Lifelike 生命力 | `motion-algos/procedural-motion.ts` 伪随机眨眼(2~8s) + 自动呼吸 | 区别于竞品「高斯」 |
| 渲染三件套 | `scene/render/renderer.ts` SSAO / Outline + MMD 材质 Toon（`outfit.ts`） | Toon 为材质属性，非后处理 |
| LipSync 振幅同步 | `motion-algos/lipsync.ts` | 共振峰口型仍待增强 |
| i18n 语言切换 | `i18n/` 全 Phase 落地 + CI 奇偶校验 | ADR-059 (2026-07-10) |
| T-pose / A-pose 转换 | `motion-algos/pose-preset.ts` VMD 生成器 | ADR-061 (2026-07-10) |
| Pose Studio / 拍照模式 | `scene/pose/composition-guide.ts` + `camera-angle.ts` + `watermark.ts` | ADR-061 (2026-07-10) |
| 道具挂载 Accessory | `scene/env/accessory.ts` `attachToBone` 骨骼挂载 | ADR-061 (2026-07-10) |
| Motion Override | `scene/motion/bone-override.ts` overrideMap + onBeforeRender | ADR-061 (2026-07-10) |
| Soft Body / Ragdoll | `ragdoll-manager.ts` + 14 TDD Task 全绿 | ADR-061-r (2026-07-10) |
| WASM 运行时图层 | `wasm-layers-blender.ts` + `vmd-layers.ts:534` 集成 | ADR-056 (2026-07-08) |
| XPBD 布料模拟 | `xpbd-solver/collider/cloth/renderer` + 20 tests | ADR-019（已实施；ADR-081 移除 TS XPBD，转 WASM Bullet） |
| Cel-Shading 后处理 | `cel-shading.ts` PostProcess | ADR-076 (2026-07-10) |
| 水面反射 RT | `water-reflection.ts` MirrorCamera + RT | ADR-062 (2026-07-10) |
| 球面反射 RT | `cubemap-rt-spherical-reflection.ts` | ADR-074 (2026-07-09) |
| 全屏资源库 | Phase 1-4 全落地 | ADR-066 (2026-07-09) |

---

## 二、真实缺口（未做）

### ✅ 架构裂缝（已关闭）

**WASM / JS 运行时分裂** — 已关闭（ADR-056 解决 + 2026-07-11 正式废弃 JS 调试运行时）
- ADR-056 的 C+B 混合方案让 WASM 拿到了多图层能力，JS 运行时唯一优势消除。
- JS 运行时从未拥有物理引擎（`new MmdRuntime(scene, null)` 传 null），仅作 gaze 行为对比调试保留。
- **2026-07-11 决策：正式废弃 JS 调试运行时。** 所有剩余功能仅面向 WASM 运行时，不再要求 JS 兼容。
- 后续：UI 运行时 toggle 可移除或降级为隐藏开关；`getMmdRuntimeType()` / `setMmdRuntimeType()` 可简化为常量。不急，待自然清理。

### 🟡 功能缺口（2026-07-11 核实）

| 功能 | 价值 | 难度 | 依赖 / 说明 |
|------|------|------|-------------|
| 智能材质分类 | 中 | 中 | 自动检测皮肤/头发/眼睛/服装 |
| Mesh-to-Cloth 自动布料 | 高 | 高 | 客观裙摆识别转约束，替代程序化圆锥裙（注：TS XPBD 已由 ADR-081 移除，转 WASM Bullet） |
| Playback Modes | 中 | 低 | 单次 / 随机 / 循环列表 |
| Remix 跨套装音频交换 | 中 | 低 | VMD 资产复用 |
| LipSync 共振峰口型 | 中 | 中 | 振幅 → 共振峰，HBR MMD Tools 路线 |
| Formation 队形序列化 | 中 | 低 | 已有 6 预设，待序列化保存到 `.mmascene` |
| AR 相机模式 | 高 | 中 | ADR-055 已批准待实施，Phase 1 桌面 MVP |
| ✅ ~~道具挂载 Accessory~~ | — | — | ✅ ADR-061 (2026-07-10) |
| ✅ ~~T-pose / A-pose 转换~~ | — | — | ✅ ADR-061 (2026-07-10) |
| ✅ ~~Pose Studio / 拍照模式~~ | — | — | ✅ ADR-061 (2026-07-10) |
| ✅ ~~i18n 语言切换~~ | — | — | ✅ ADR-059 (2026-07-10) |
| ✅ ~~垂直同步开关~~ | — | — | ✅ `settings.ts` vsync 开关 |
| ✅ ~~设置导入 / 导出~~ | — | — | ✅ `settings.ts` exportSettings / importSettings |
| ✅ ~~全量重置补全~~ | — | — | ✅ `resetAllSettings` 全量重置 |
| ✅ ~~Shift-JIS URL 编码~~ | — | — | ✅ ADR-057 / ADR-058 |

### 🟡 上游阻塞（卡 `babylon-mmd`，不独立启动）

- **PBR 材质**：全量迁移会破坏 morph 管线。
- **SSS 次表面散射**：依赖 PBR proxy。
- **光线追踪 / 全局光照 GI**。
- 策略：只能等 / 推动上游贡献。

---

## 三、优先级分期（2026-07-11 修订）

### P0（立即，低成本高感知）
1. ~~i18n 语言切换框架~~ ✅ ADR-059 (2026-07-10)
2. ~~垂直同步开关 + 设置导入 / 导出 + 全量重置补全~~ ✅ 已实施（2026-07-07 复核）
3. ~~Shift-JIS URL 编码修复~~ ✅ ADR-057 / ADR-058

> P0 已全部清空。

### P1（本季度，护城河 B：多模型导演台核心）
1. Formation 队形预设序列化（已有 6 预设，待序列化保存）
2. Playback Modes + Remix（单次 / 随机 / 循环列表 / VMD 资产复用）
3. AR 相机模式 Phase 1（[ADR-055](adr/adr-055-ar-camera-mode.md) 桌面 MVP，已批准待实施）

> 注：Auto Camera 程序化运镜（8 预设 + 节拍驱动闭环）已实现，不列入。

### P2（中期，深化护城河）
4. Mesh-to-Cloth 自动布料（客观裙摆识别转 WASM Bullet 约束）
5. 智能材质分类（自动检测皮肤/头发/眼睛/服装）
6. LipSync 共振峰口型（振幅 → 共振峰）
7. Scene Bundle 分发（zip 内 VMD 加载债已清，可直接进入分发）
8. AR 相机模式 Phase 2（移动端 + Gaze 协同，依赖 Phase 1）

### P3（远期探索）
9. ~~Soft Body / Ragdoll~~ ✅ ADR-061-r (2026-07-10)
10. AR 相机模式 Phase 3 / WebXR（[ADR-072](adr/adr-072-webxr-plane-detection.md)，待探针）
11. 原生 ARCore/ARKit（[ADR-073](adr/adr-073-native-arcore-arkit.md)，远期兜底）
12. iOS 端
13. SSS（待上游 PBR proxy）
14. Lua / JS 脚本层（自动化工作流）
15. Alembic / glTF 导出

---

## 四、风险提醒

- **`babylon-mmd` 单点故障**：SSS / PBR 全部卡在上游，需评估是否参与上游贡献。
- ~~WASM / JS 分裂~~ ✅ 已关闭（ADR-056 解决 + JS 调试运行时废弃，所有功能仅面向 WASM）。

---

## 五、相关 ADR 索引（分散的「后续方向」小节）

后续方向的详细讨论散落于以下 ADR，本文件为汇总入口：

- ADR-017 Android 适配 → 后续方向
- ADR-018 路径管理器抽象 → 后续方向
- ADR-024 渲染增强 Phase2 SSR / ReflectionProbe → 后续方向
- ADR-029 物理 UI 重构 → 后续方向

> 注：原 `docs/roadmap.md` 已由 ADR-039 废除，其差距清单 / 目标内容已并入 `docs/competitive-analysis.md` 与各 ADR。本 ADR 为后续方向的集中入口。
