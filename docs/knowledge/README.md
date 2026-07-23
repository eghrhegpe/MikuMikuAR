# 知识卡层（Knowledge Cards）

> 本目录是 MikuMikuAR 的**原子化架构知识层**，借鉴 repowiki 的「知识卡 + `source_files` 机器可校验」范式，
> 但**主权归城邦**：由我们拥有、可重生成、受 `scripts/check-doc-drift.mjs` 守护。
>
> 生成日期基线：2026-07-23（覆盖 ADR-166~175 引入的子系统）；同日扩展「物理系统（physics）」分组，补录 ADR-081/084/104 的 WASM Bullet 物理子系统（physics-bridge / wind-physics / skirt-analyzer / virtual-skirt / ground-collision）。

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

## 不变量
- <不能被修改破坏的状态、资源或并发约束>

## 验证入口
- 测试：`frontend/src/__tests__/path/to/module.test.ts`
- 命令：`cd frontend && npm run test -- path/to/module.test.ts`
```


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

## 卡片索引（106 张，按 category 分组）

### 环境系统（env）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [道具骨骼锚定系统](./accessory.md) | `scene/env/accessory.ts` | — |
| [环境系统上下文](./env-context.md) | `scene/env/env-context.ts` | — |
| [环境调度器](./env-dispatcher.md) | `scene/env/env-dispatcher.ts` | ADR-138 |
| [地面系统](./env-ground.md) | `scene/env/env-ground.ts` | — |
| [反射系统](./env-reflection.md) | `scene/env/env-reflection.ts` | ADR-151/152 |
| [天空系统](./env-sky.md) | `scene/env/env-sky.ts` | — |
| [地形生成器](./env-terrain.md) | `scene/env/env-terrain.ts` | — |
| [统一贴图工厂](./env-texture.md) | `scene/env/env-texture.ts` | ADR-092 |
| [Babylon.js 类型逃逸封装](./env-type-helpers.md) | `scene/env/env-type-helpers.ts` | — |
| [湿身效果系统](./env-wetness.md) | `scene/env/env-wetness.ts` | ADR-172 |
| [镜面道具](./mirror-debug.md) | `scene/env/mirror-debug.ts` | ADR-128 |
| [道具系统](./props.md) | `scene/env/props.ts` | — |
| [环境系统门面](./env.md) | `scene/env/env.ts` | — |
| [环境系统实现核心](./env-impl.md) | `scene/env/env-impl.ts` | — |
| [环境系统桥接层](./env-bridge.md) | `scene/env/env-bridge.ts` | — |
| [统一预设系统接口](./preset-manager.md) | `scene/env/preset-manager.ts` | ADR-130 |
| [统一平面反射引擎](./planar-reflection.md) | `scene/env/planar-reflection.ts` | ADR-092 |

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
| [姿势多角度预设系统](./camera-angle.md) | `scene/pose/camera-angle.ts` | — |
| [AR 摄像头视频透传](./ar-camera.md) | `scene/ar/ar-camera.ts` | ADR-055 |
| [AR 模式场景级协调](./ar-scene.md) | `scene/ar/ar-scene.ts` | ADR-055 |
| [拖拽变换模式开关](./transform-mode.md) | `scene/transform/transform-mode.ts` | — |

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
| [反 Y 轴指针输入](./invertablePointersInput.md) | `scene/camera/invertablePointersInput.ts` | ADR-035 |
| [光锥网格](./light-cone.md) | `scene/render/light-cone.ts` | ADR-152 |
| [个人灯光跟随](./lighting-follow.md) | `scene/render/lighting-follow.ts` | ADR-168 |
| [阴影生成器](./lighting-shadow.md) | `scene/render/lighting-shadow.ts` | — |
| [舞台灯光系统](./lighting-stage.md) | `scene/render/lighting-stage.ts` | — |
| [灯光模块状态对象](./lighting-state.md) | `scene/render/lighting-state.ts` | ADR-159 |
| [太阳圆盘可视化](./lighting-sun.md) | `scene/render/lighting-sun.ts` | — |
| [灯光预设过渡动画](./lighting-tween.md) | `scene/render/lighting-tween.ts` | — |
| [性能降级 — 环境桥接](./performance-env-bridge.md) | `scene/render/performance-env-bridge.ts` | ADR-130 |
| [质量维度与配置系统](./quality-profile.md) | `scene/render/quality-profile.ts` | ADR-174 |
| [缩略图渲染](./thumbnail-capture.md) | `scene/manager/thumbnail-capture.ts` | — |
| [变换适配器注册表](./transform-adapter.md) | `scene/transform/transform-adapter.ts` | ADR-126 |
| [变换拾取系统](./transform-pick.md) | `scene/transform/transform-pick.ts` | — |
| [场景渲染管线与后处理](./renderer.md) | `scene/render/renderer.ts` | — |
| [场景光照与阴影](./lighting.md) | `scene/render/lighting.ts` | — |
| [性能监控与自动降级](./performance.md) | `scene/render/performance.ts` | ADR-159 |
| [3D 拖拽 Gizmo 统一抽象](./transform-gizmo.md) | `scene/render/transform-gizmo.ts` | ADR-048/126 |

### 动作系统（motion）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md) | `scene/motion/bone-override-store.ts` | ADR-084 |
| [动作管线（逐帧合成）](./motion-pipeline.md) | `scene/motion/motion-pipeline.ts` | ADR-129 |
| [感知观察者（感知层）](./perception-observer.md) | `scene/motion/perception-observer.ts` | ADR-162/166 |

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

### 核心基础设施（core）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [全局状态与场景运行时 Store](./state.md) | `core/state.ts` + `scene-state`/`playback-state`/`library-state` | ADR-141/137 |
| [EnvState 单一源 Schema](./env-state-schema.md) | `core/env-state-schema.ts` | ADR-137/132 |
| [Runtime 隔离桥](./runtime-bridge.md) | `core/runtime-bridge.ts` | ADR-177 |
| [后端绑定聚合层](./wails-bindings.md) | `core/wails-bindings.ts` | ADR-176 |
| [Observer 生命周期管理](./observer-handle.md) | `core/observer-handle.ts` | — |
| [轻量响应式刷新系统](./reactivity.md) | `core/reactivity.ts` | — |
| [渲染循环与 FPS 时钟](./render-loop.md) | `core/render-loop.ts` | ADR-102 |
| [颜色工具函数](./color-helpers.md) | `core/color-helpers.ts` | — |
| [开发环境 E2E 钩子](./dev-hooks.md) | `core/dev-hooks.ts` | ADR-102 |
| [安全释放工具](./dispose-helpers.md) | `core/dispose-helpers.ts` | ADR-146 |
| [事件处理与导航系统](./events.md) | `core/events.ts` | — |
| [Go 错误翻译](./goerr.md) | `core/i18n/goerr.ts` | ADR-117 |
| [应用启动引导](./init.md) | `core/init.ts` | — |
| [国际化语言状态](./locale.md) | `core/i18n/locale.ts` | ADR-059 |
| [轻量日志工具](./logger.md) | `core/logger.ts` | ADR-141 |
| [安全调用工具](./safe-call.md) | `core/safe-call.ts` | ADR-146 |
| [应用快捷键定义](./shortcut-app.md) | `core/shortcut-app.ts` | ADR-102 |
| [缩略图缓存 key 推导](./thumbnail-key.md) | `scene/manager/thumbnail-key.ts` | — |
| [UI 与场景常量](./ui-constants.md) | `core/ui-constants.ts` | ADR-143 |
| [焦点陷阱工具](./ui-focus-trap.md) | `core/ui-focus-trap.ts` | ADR-153 |
| [键盘导航工具](./ui-keyboard-nav.md) | `core/ui-keyboard-nav.ts` | ADR-153 |
| [预设面板复合组件](./ui-preset.md) | `core/ui-preset.ts` | — |
| [滑块输入控制器](./ui-slider-controller.md) | `core/ui-slider-controller.ts` | — |
| [UI 持久化状态](./ui-state.md) | `core/ui-state.ts` | ADR-141 |
| [文件监控导入](./watch-import.md) | `core/watch-import.ts` | ADR-102 |
| [统一风场辅助函数](./wind-utils.md) | `core/wind-utils.ts` | — |
| [简体中文语言包](./zh-CN.md) | `core/i18n/locales/zh-CN.ts` | ADR-059 |
| [繁体中文语言包](./zh-TW.md) | `core/i18n/locales/zh-TW.ts` | ADR-059 |
| [轻量日志工具（无依赖）](./logger.md) | `core/logger.ts` | ADR-141 |
