# 知识卡层（Knowledge Cards）

> 本目录是 MikuMikuAR 的**原子化架构知识层**，借鉴 repowiki 的「知识卡 + `source_files` 机器可校验」范式，
> 但**主权归城邦**：由我们拥有、可重生成、受 `scripts/check-doc-drift.mjs` 守护。
>
> 生成日期基线：2026-07-23（覆盖 ADR-166~175 引入的子系统）；同日扩展「物理系统（physics）」分组，补录 ADR-081/084/104 的 WASM Bullet 物理子系统（physics-bridge / wind-physics / skirt-analyzer / virtual-skirt / ground-collision）。
> 2026-07-25 扩展：新建 41 张卡片覆盖 motion/env/menus/core 四大集群，修正 16 张符号警告，补录 22 张 ADR 关联。
> 2026-07-25 二次扩展：新建 38 张高价值源文件卡片（含感知层子模块/动作模块基类/广场/设置/工具等），修正 13 张符号警告，补录 22 张 ADR 关联。

## 它解决什么

| 层 | 回答的问题 | 性质 |
|----|-----------|------|
| `docs/adr/` | **为什么**当初这么决定？ | 不可变决策日志 |
| `docs/architecture.md` + `docs/function-map.md` | 系统**整体地图 / 函数大全** | 概要式地图（已自承部分过时） |
| **`docs/knowledge/`（本层）** | 某个子系统**现在长啥样、去哪找**？ | 原子、DRY、带源码直链 |

三者关系：**ADR 是决策真相源；knowledge 是 ADR 结论在代码侧的「现状快照」；architecture/function-map 是更高层的索引。**
知识卡**引用不复制** ADR 的结论，仅记录 `adr:` 关联编号。

## 卡片格式规范

每张卡为独立 `.md` 文件，文件名与对应模块文件名一致（如 `quality-profile.md` ↔ `frontend/src/scene/render/quality-profile.ts`）。

```markdown
---
kind: <snake_case 标识符>
name: <中文短名>
tier: <architecture|leaf>   # 默认 architecture；leaf 表示机器索引对象（见「立卡判据」）
category: <rendering|env|motion|ui|core|backend|physics|scene>
scope:
  - <模块目录 glob>
source_files:        # 仓库相对路径，必须真实存在于磁盘
  - frontend/src/scene/render/quality-profile.ts
adr:                 # 关联决策（可选）
  - ADR-174
# 以下字段用于帮助 AI 通过用户意图、符号和约束快速检索（可选）
symbols:
  - publicFunction
invariants:
  - <必须保持的状态、并发或资源约束>
tests:
  - frontend/src/__tests__/path/to/module.test.ts
use_when:
  - <用户可能描述的功能词>
---

## 系统概览
<2-4 句讲清它是什么、解决什么问题>

## 核心职责
- `file.ts` — <职责>

## 对外 API（节选）
- `symbol()` — <作用>

## 与其他子系统关系
- <被谁引用 / 引用谁>

## UI 入口（architecture 卡必填，leaf 卡可选）
- 菜单路径 / 面板：如「场景菜单 → 水面设置」（schema id `env:water:*`）
- 入口函数：`buildWaterLevel(): PopupLevel`（文件 `menus/env-water-levels.ts`）
- 示例见 [env-water.md](./env-water.md)

## 不变量
- <不能被修改破坏的状态、资源或并发约束>

## 验证入口
- 测试：`frontend/src/__tests__/path/to/module.test.ts`
- 命令：`cd frontend && npm run test -- path/to/module.test.ts`
```

### 立卡判据（ADR-218）

| 情形 | 处置 |
|------|------|
| *v 可独立理解、被 ≥2 子系统引用、修改有风险（状态/资源/并发不变量） | 立 **architecture** 卡（人读主对象） |
| *x 纯工具函数、测试桩、barrel 聚合、单一调用方叶子 | **不立卡**；或立 **leaf** 卡（机器索引对象，README 索引折叠为计数行） |

- `tier` 默认 `architecture`；标 `leaf` 时 README 索引不逐张平铺。
- architecture 卡必须含 `invariants` / `use_when` / `## UI 入口` 小节（由 `check-doc-drift.mjs` 检查 10 兜底，WARN）。


### AI 使用字段

- `symbols`：列出本卡负责的公共函数、类、状态或常量，便于按符号反查。
- `invariants`：记录必须保持的约束；代码修改前后都应核对。
- `tests`：列出最小验证入口，避免每次修改都盲跑全量测试。
- `use_when`：使用者可能说出的自然语言关键词，用于从 `docs/knowledge/routes.md` 继续路由。
- 旧卡片不要求一次性补齐；只要卡片被修改或对应模块发生结构性变化，就按模板逐步补充。

### 何时更新知识卡

必须更新：模块拆分/合并、公共 API 变化、状态写入路径变化、资源释放责任变化、并发策略变化、关键依赖变化、`source_files` 路径变化或已知风险变化。

通常不必更新：内部重构但职责和不变量不变、样式微调、变量重命名、仅补充测试。

### `source_files` 铁律
- 路径**相对仓库根**，且**必须能在磁盘找到**（由 `scripts/check-doc-drift.mjs` 反向校验）。
- 禁止写不存在的路径、禁止写 `node_modules/` 或生成文件（`*.gen.ts`、`wailsjs/`）。
- 若文件被重命名/删除，卡片须同步更新或归档。

## 与 drift 脚本的衔接
`scripts/check-doc-drift.mjs` 已将本层纳入机器守护（2026-07-23）：
- **[ERROR] 知识卡 `source_files` 完整性** —— 扫描 `docs/knowledge/*.md`（排除 `README.md`）的 frontmatter，
  任一 `source_files` 路径在磁盘不存在即报错并退出码 1，防止卡片声称的源码被改名/删除后无人察觉。
- 报告额外输出「知识卡数 / source 覆盖数」，`--json` 模式含 `knowledge: { cards, missingSources, coveredCount }`。

跑法：`node scripts/check-doc-drift.mjs`（或 `--json`）。可接 CI 卡点。

## 卡片索引（226 张：architecture 平铺 + leaf 折叠计数）

> 🌀 机器生成地图：[menu-map.md](./menu-map.md) —— 菜单层级全景（Schema 树 + 导航 items + target 路由），由 `scripts/gen-menu-map.mjs` 自动生成，**勿手改**；重跑 `npm run gen:menumap`。

### 环境系统（env）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [环境系统上下文](./env-context.md) | `scene/env/env-context.ts` | — |
| [环境调度器](./env-dispatcher.md) | `scene/env/env-dispatcher.ts` | ADR-138 |
| [地面系统](./env-ground.md) | `scene/env/env-ground.ts` | — |
| [反射系统](./env-reflection.md) | `scene/env/env-reflection.ts` | ADR-151/152 |
| [天空系统](./env-sky.md) | `scene/env/env-sky.ts` | — |
| [地形生成器](./env-terrain.md) | `scene/env/env-terrain.ts` | — |
| [统一贴图工厂](./env-texture.md) | `scene/env/env-texture.ts` | ADR-092 |
| [湿身效果系统](./env-wetness.md) | `scene/env/env-wetness.ts` | ADR-172 |
| [环境系统门面](./env.md) | `scene/env/env.ts` | — |
| [环境系统实现核心](./env-impl.md) | `scene/env/env-impl.ts` | — |
| [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) | `scene/env/env-bridge.ts` | ADR-138/148 |
| [环境重力控制](./env-gravity.md) | `scene/env/env-gravity.ts` | ADR-148/212 |
| [环境碰撞控制](./env-collision.md) | `scene/env/env-collision.ts` | ADR-212 |
| [环境状态防抖持久化](./env-persist.md) | `scene/env/env-persist.ts` | ADR-148/176 |
| [时间流转与太阳角系统](./env-time-of-day.md) | `scene/env/env-time-of-day.ts` | ADR-148 |
| [统一预设系统接口](./preset-manager.md) | `scene/env/preset-manager.ts` | ADR-130 |
| [统一平面反射引擎](./planar-reflection.md) | `scene/env/planar-reflection.ts` | ADR-092 |
| [云层系统](./env-clouds.md) | `scene/env/env-clouds.ts` | — |
| [水面系统](./env-water.md) | `scene/env/env-water.ts` | — |
| [共享焦散纹理系统](./env-caustics.md) | `scene/env/env-caustics.ts` | ADR-115 |
| [水下视觉系统](./env-underwater-fog.md) | `scene/env/env-underwater-fog.ts` | — |
| [粒子系统](./env-particles.md) | `scene/env/env-particles.ts` | — |
| [环境灯光包装](./env-lighting.md) | `scene/env/env-lighting.ts` | — |

> 🍃 叶子模块 / 工具函数（1 张）：[env-type-helpers](./env-type-helpers.md)

### 场景编排（scene）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [场景核心编排器](./scene.md) | `scene/scene.ts` | — |
| [场景打包/解包](./scene-bundle.md) | `scene/scene-bundle.ts` | — |
| [场景存档迁移](./scene-migrate.md) | `scene/scene-migrate.ts` | ADR-166 |
| [场景序列化与自动保存](./scene-serialize.md) | `scene/scene-serialize.ts` | — |
| [相机模式管理系统](./camera.md) | `scene/camera/camera.ts` | ADR-035 |

### 场景子系统（scene）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [PMX 模型加载与缩略图捕获](./model-loader.md) | `scene/manager/model-loader.ts` | — |
| [模型注册表与生命周期管理](./model-manager.md) | `scene/manager/model-manager.ts` | — |
| [模型生命周期操作](./model-ops.md) | `scene/manager/model-ops.ts` | ADR-116 |
| [分类材质系统](./material.md) | `scene/manager/material.ts` | — |
| [纹理 LRU 缓存](./texture-lru.md) | `scene/manager/texture-lru.ts` | ADR-189 |
| [缩略图渲染](./thumbnail-capture.md) | `scene/manager/thumbnail-capture.ts` | — |
| [姿势多角度预设系统](./camera-angle.md) | `scene/pose/camera-angle.ts` | — |
| [AR 摄像头视频透传](./ar-camera.md) | `scene/ar/ar-camera.ts` | ADR-055 |
| [AR 模式场景级协调](./ar-scene.md) | `scene/ar/ar-scene.ts` | ADR-055 |
| [拖拽变换模式开关](./transform-mode.md) | `scene/transform/transform-mode.ts` | — |
| [相机状态管理](./camera-state.md) | `scene/camera/camera-state.ts` | — |
| [相机创建工厂](./camera-factory.md) | `scene/camera/camera-factory.ts` | ADR-148 |
| [VMD 相机动画](./camera-vmd.md) | `scene/camera/camera-vmd.ts` | ADR-148 |
| [节拍驱动自动运镜](./camera-auto.md) | `scene/camera/camera-auto.ts` | ADR-148 |
| [相机行为（Freefly/Surround/Concert）](./camera-behaviors.md) | `scene/camera/camera-behaviors.ts` | ADR-148 |
| [轨道相机骨骼锁定](./camera-bone-lock.md) | `scene/camera/camera-bone-lock.ts` | ADR-148 |
| [构图指南](./composition-guide.md) | `scene/pose/composition-guide.ts` | — |
| [水印系统](./watermark.md) | `scene/pose/watermark.ts` | — |

> 🍃 叶子模块 / 工具函数（1 张）：[thumbnail-key](./thumbnail-key.md)

### 物理系统（physics）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [物理骨骼桥与每帧注册表](./physics-bridge.md) | `physics/physics-bridge.ts` | ADR-081 |
| [风力物理注入](./wind-physics.md) | `physics/wind-physics.ts` | ADR-104 |
| [裙摆拓扑分析](./skirt-analyzer.md) | `scene/physics/skirt-analyzer.ts` | ADR-084 |
| [虚拟裙骨物理控制器](./virtual-skirt.md) | `scene/physics/virtual-skirt.ts` | ADR-081/084 |
| [地面碰撞体](./ground-collision.md) | `scene/physics/ground-collision.ts` | — |

### 渲染系统（rendering）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [WebXR 能力探测](./ar-webxr-probe.md) | `scene/ar/ar-webxr-probe.ts` | — |
| [光锥网格](./light-cone.md) | `scene/render/light-cone.ts` | ADR-152 |
| [个人灯光跟随](./lighting-follow.md) | `scene/render/lighting-follow.ts` | ADR-168 |
| [阴影生成器](./lighting-shadow.md) | `scene/render/lighting-shadow.ts` | — |
| [舞台灯光系统](./lighting-stage.md) | `scene/render/lighting-stage.ts` | — |
| [灯光模块状态对象](./lighting-state.md) | `scene/render/lighting-state.ts` | ADR-159 |
| [太阳圆盘可视化](./lighting-sun.md) | `scene/render/lighting-sun.ts` | — |
| [灯光预设过渡动画](./lighting-tween.md) | `scene/render/lighting-tween.ts` | — |
| [性能降级 — 环境桥接](./performance-env-bridge.md) | `scene/render/performance-env-bridge.ts` | ADR-130 |
| [质量维度与配置系统](./quality-profile.md) | `scene/render/quality-profile.ts` | ADR-130/174 |
| [镜面道具](./mirror-debug.md) | `scene/env/mirror-debug.ts` | ADR-128 |
| [变换适配器注册表](./transform-adapter.md) | `scene/transform/transform-adapter.ts` | ADR-121/126 |
| [变换拾取系统](./transform-pick.md) | `scene/transform/transform-pick.ts` | — |
| [场景渲染管线与后处理](./renderer.md) | `scene/render/renderer.ts` | — |
| [场景光照与阴影](./lighting.md) | `scene/render/lighting.ts` | — |
| [性能监控与自动降级](./performance.md) | `scene/render/performance.ts` | ADR-159 |
| [3D 拖拽 Gizmo 统一抽象](./transform-gizmo.md) | `scene/render/transform-gizmo.ts` | ADR-048/126 |
| [灯光预设系统](./lighting-presets.md) | `scene/render/lighting-presets.ts` | — |
| [GPU 压缩纹理能力探测](./gpu-capabilities.md) | `core/gpu-capabilities.ts` | ADR-189 |

> 🍃 叶子模块 / 工具函数（1 张）：[invertablePointersInput](./invertablePointersInput.md)

### 动作系统（motion）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md) | `scene/motion/bone-override-store.ts` | ADR-084 |
| [动作管线（逐帧合成）](./motion-pipeline.md) | `scene/motion/motion-pipeline.ts` | ADR-129 |
| [感知层主控](./perception.md) | `scene/motion/perception.ts` | ADR-071/162/166 |
| [感知层共享类型](./perception-shared.md) | `scene/motion/perception-shared.ts` | ADR-071/162 |
| [视线追踪主模块](./perception-gaze.md) | `scene/motion/perception-gaze.ts` | ADR-071/162/166 |
| [骨骼覆盖核心 API](./bone-override.md) | `scene/motion/bone-override.ts` | ADR-061/116/123/126/186 |
| [动作覆盖 UI 层级](./motion-override-levels.md) | `menus/motion-override-levels.ts` | ADR-061/116/145/186 |
| [动作播放控制](./motion-playback.md) | `scene/motion/playback.ts` | — |
| [外部动作重定向桥](./animation-retargeter.md) | `scene/motion/animation-retargeter.ts` | — |
| [多 VMD 叠加系统](./vmd-layers.md) | `scene/motion/vmd-layers.ts` | — |
| [VMD 动作加载器](./vmd-loader.md) | `scene/motion/vmd-loader.ts` | — |
| [场景级动作意图库](./motion-intent.md) | `scene/motion/motion-intent.ts` | ADR-121/167 |
| [程序化动作系统](./proc-motion-bridge.md) | `scene/motion/proc-motion-bridge.ts` | — |
| [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) | `scene/motion/feet-adjustment.ts` | ADR-085 |
| [脚步声控制器](./motion-footstep.md) | `scene/motion/footstep.ts` | ADR-088 |
| [口型同步桥](./lipsync-bridge.md) | `scene/motion/lipsync-bridge.ts` | — |
| [动作模块注册表](./motion-modules-registry.md) | `scene/motion/motion-modules/registry.ts` | — |
| [脚部独立控制模块（左脚/右脚）](./motion-modules-feet.md) | `scene/motion/motion-modules/foot-modules.ts` | ADR-116 |
| [手部独立控制模块（左手/右手）](./hand-symmetry.md) | `scene/motion/motion-modules/hand-modules.ts` | ADR-116 |
| [动作模块 — 身体姿势](./motion-modules-body-posture.md) | `scene/motion/motion-modules/body-posture.ts` | — |
| [动作模块 — 骑乘模型](./motion-modules-riding.md) | `scene/motion/motion-modules/riding-model.ts` | — |

### UI/菜单（ui）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [滑出式菜单引擎](./menu.md) | `menus/menu.ts` | — |
| [声明式菜单 Schema](./menu-schema.md) | `menus/menu-schema.ts` | ADR-093 |
| [设置页路由与编排](./settings.md) | `menus/settings.ts` | ADR-157 |
| [资源库入口与编排](./library.md) | `menus/library.ts` | — |
| [环境弹窗（编排 + barrel）](./env-menu.md) | `menus/env-menu.ts` | — |
| [场景弹窗（编排 + 路由）](./scene-menu.md) | `menus/scene-menu.ts` | — |
| [模型子菜单构建](./model-detail.md) | `menus/model-detail.ts` | — |
| [资源库浏览弹窗](./library-browse.md) | `menus/library-browse.ts` | — |
| [资源库会话状态单例](./library-session-store.md) | `menus/library-session-store.ts` | ADR-135 |
| [动作绑定 UI](./motion-binding-ui.md) | `menus/motion-binding-ui.ts` | — |
| [动作详情 UI](./motion-detail-ui.md) | `menus/motion-detail-ui.ts` | — |
| [模型广场创作者列表](./plaza-creators.md) | `menus/plaza-creators.ts` | — |
| [模型广场 UI 辅助函数](./plaza-thumbnail.md) | `menus/plaza-thumbnail.ts` | — |
| [场景拖拽层级菜单](./scene-drag-levels.md) | `menus/scene-drag-levels.ts` | ADR-171 |
| [场景菜单共享状态](./scene-menu-state.md) | `menus/scene-menu-state.ts` | — |
| [设置 — 关于页面](./settings-about.md) | `menus/settings-about.ts` | ADR-157 |
| [设置动作映射表](./settings-actions.md) | `menus/settings-actions.ts` | ADR-157 |
| [设置 — 操控页面](./settings-controls.md) | `menus/settings-controls.ts` | ADR-157 |
| [设置 — 画面页面](./settings-graphics.md) | `menus/settings-graphics.ts` | ADR-157 |
| [设置 — 媒体页面](./settings-media.md) | `menus/settings-media.ts` | ADR-157 |
| [设置 — 资源页面](./settings-resources.md) | `menus/settings-resources.ts` | ADR-157 |
| [设置 — 系统页面](./settings-system.md) | `menus/settings-system.ts` | ADR-157 |
| [环境菜单层级系统](./env-menu-levels.md) | `menus/env-level-helpers.ts` | — |
| [动作菜单层级系统](./motion-menu-levels.md) | `menus/motion-popup.ts` | — |
| [场景菜单层级系统](./scene-menu-levels.md) | `menus/scene-menu-state.ts` | ADR-171 |
| [菜单渲染引擎](./render-menu.md) | `menus/render-menu.ts` | ADR-093 |
| [菜单工厂](./menu-factory.md) | `menus/menu-factory.ts` | — |
| [资源库操作](./library-actions.md) | `menus/library-actions.ts` | — |
| [资源库核心](./library-core.md) | `menus/library-core.ts` | — |
| [资源库初始化](./library-setup.md) | `menus/library-setup.ts` | — |
| [AI 诊断助手面板](./settings-diagnostic.md) | `menus/settings-diagnostic.ts` | ADR-196/093 |
| [AI 助手独立面板入口](./assistant-panel.md) | `menus/assistant-panel.ts` | ADR-203/093 |
| [诊断助手 → 聊天 UI（子模块）](./diagnostic-chat.md) | `menus/diagnostic-chat.ts` | ADR-196/203 |
| [诊断助手 → 配置 UI（子模块）](./diagnostic-config.md) | `menus/diagnostic-config.ts` | ADR-196/203 |
| [诊断助手 → tool call 控制（子模块）](./diagnostic-control.md) | `menus/diagnostic-control.ts` | ADR-197/155/203 |
| [诊断助手 → 会话管理（子模块）](./diagnostic-session.md) | `menus/diagnostic-session.ts` | ADR-203 |
| [诊断助手 → 单例状态（子模块）](./diagnostic-state.md) | `menus/diagnostic-state.ts` | ADR-196/203 |

### 核心基础设施（core）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [全局状态与场景运行时 Store](./state.md) | `core/state.ts` + `scene-state`/`playback-state`/`library-state` | ADR-141/137 |
| [EnvState 单一源 Schema](./env-state-schema.md) | `core/env-state-schema.ts` | ADR-137/132 |
| [Runtime 隔离桥](./runtime-bridge.md) | `core/runtime-bridge.ts` | ADR-177 |
| [后端绑定聚合层](./wails-bindings.md) | `core/wails-bindings.ts` | ADR-176 |
| [平台能力探测](./platform.md) | `core/platform.ts` | ADR-176 |
| [统一资源加载队列](./load-manager.md) | `core/load-manager.ts` | ADR-045/135 |
| [Observer 生命周期管理](./observer-handle.md) | `core/observer-handle.ts` | — |
| [轻量响应式刷新系统](./reactivity.md) | `core/reactivity.ts` | — |
| [渲染循环与 FPS 时钟](./render-loop.md) | `core/render-loop.ts` | ADR-102 |
| [开发环境 E2E 钩子](./dev-hooks.md) | `core/dev-hooks.ts` | ADR-102 |
| [事件处理与导航系统](./events.md) | `core/events.ts` | — |
| [Go 错误翻译](./goerr.md) | `core/i18n/goerr.ts` | ADR-117 |
| [应用启动引导](./init.md) | `core/init.ts` | — |
| [国际化语言状态](./locale.md) | `core/i18n/locale.ts` | ADR-059 |
| [安全调用工具](./safe-call.md) | `core/safe-call.ts` | ADR-146 |
| [应用快捷键定义](./shortcut-app.md) | `core/shortcut-app.ts` | ADR-102 |
| [焦点陷阱工具](./ui-focus-trap.md) | `core/ui-focus-trap.ts` | ADR-153 |
| [键盘导航工具](./ui-keyboard-nav.md) | `core/ui-keyboard-nav.ts` | ADR-153 |
| [预设面板复合组件](./ui-preset.md) | `core/ui-preset.ts` | — |
| [滑块输入控制器](./ui-slider-controller.md) | `core/ui-slider-controller.ts` | — |
| [UI 持久化状态](./ui-state.md) | `core/ui-state.ts` | ADR-141 |
| [文件监控导入](./watch-import.md) | `core/watch-import.ts` | ADR-102 |
| [拖拽导入逻辑层](./drop-import.md) | `core/drop-import.ts` | ADR-177 |
| [统一文件服务层](./fileservice.md) | `core/fileservice.ts` | ADR-057 |
| [后端适配层](./core-backend.md) | `core/backend/index.ts` | — |
| [音频总线](./audio-bus.md) | `core/audio-bus.ts` | — |
| [快捷键注册表](./shortcut-registry.md) | `core/shortcut-registry.ts` | — |
| [PMX 元数据提取](./pmx-meta.md) | `core/pmx-meta.ts` | — |
| [运行模式检测](./runtime-mode.md) | `core/runtime-mode.ts` | — |
| [结构化反馈 API](./feedback.md) | `core/feedback.ts` | — |
| [模型加载/库扫描完成后菜单刷新注册表](./load-refresh-registry.md) | `core/load-refresh-registry.ts` | — |
| [babylon-mmd 适配边界](./mmd-adapter.md) | `core/mmd-adapter.ts` | ADR-192 |
| [预设元数据归一化](./preset-meta.md) | `core/preset-meta.ts` | ADR-130 |
| [安卓文件访问（shared 模式）](./android-file-access.md) | `internal/app/fileaccess_android.go` 等 | ADR-017/180/183/194 |
| [window.__mmar 状态暴露](./mmar-globals.md) | `core/mmar-globals.ts` | — |
| [统一动作注册表](./action-registry.md) | `core/action-registry.ts` + `action-executor`/`action-defs/*`/`ai/{param-adapters,action-catalog,action-registry-defs}` | ADR-197/155 |
| [轨道相机键盘输入状态](./orbit-state.md) | `core/orbit-state.ts` | — |
| [诊断用动作注册](./diagnostic-actions.md) | `core/action-defs/diagnostic-actions.ts` | ADR-197/196 |
| [菜单导航项契约](./ui-nav-item.md) | `core/ui-nav-item.ts` | ADR-153 |

> 🍃 叶子模块 / 工具函数（16 张）：[dialog](./dialog.md) [toast](./toast.md) [status-bar](./status-bar.md) [color-helpers](./color-helpers.md) [hash-noise](./hash-noise.md) [dispose-helpers](./dispose-helpers.md) [logger](./logger.md) [ui-constants](./ui-constants.md) [wind-utils](./wind-utils.md) [zh-CN](./zh-CN.md) [zh-TW](./zh-TW.md) [ui-helpers](./ui-helpers.md) [config-barrel](./config-barrel.md) [icons-bundle](./icons-bundle.md) [runtime-stub](./runtime-stub.md) [core-leaf-modules](./core-leaf-modules.md)

### 内置 AI 诊断助手（ai，ADR-196）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [AI 双适配器服务层](./ai-service.md) | `core/ai/{types,index,browser-adapter,go-adapter}.ts` | ADR-196/176 |
| [AI 配置持久化](./ai-config-store.md) | `core/ai/config-store.ts` | ADR-196 |
| [错误环形缓冲与全局捕获](./ai-error-buffer.md) | `core/ai/error-buffer.ts` | ADR-196 |
| [场景运行时快照](./ai-scene-snapshot.md) | `core/ai/scene-snapshot.ts` | ADR-196 |
| [SSE 流式解析器](./ai-sse.md) | `core/ai/sse.ts` | ADR-196 |
| [角色台词生成（人设/情绪/TTS）](./character-bible.md) | `core/ai/{character-bible,dialogue-session,dialogue-speech}.ts` | ADR-156 |
| [NL 意图解析（LLM→动作）](./ai-intent-dispatcher.md) | `core/ai/intent-dispatcher.ts` | ADR-155/197 |
| [AI 会话 IndexedDB 存储](./chat-store.md) | `core/ai/chat-store.ts` | ADR-203 |
| [轻量 Markdown→DOM 渲染器](./markdown.md) | `core/ai/markdown.ts` | ADR-196 |
