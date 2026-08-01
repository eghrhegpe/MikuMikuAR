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
## 卡片索引（233 张：architecture 平铺 + leaf 折叠计数）

> 🌀 机器生成地图：[menu-map.md](./menu-map.md) —— 菜单层级全景（Schema 树 + 导航 items + target 路由），由 `scripts/gen-menu-map.mjs` 自动生成，**勿手改**；重跑 `npm run gen:menumap`。


### 环境系统（env）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [环境调度器](./env-dispatcher.md) | `scene/env/env-dispatcher.ts` | ADR-138 |
| [地面系统](./env-ground.md) | `scene/env/env-ground.ts` | — |
| [地面材质单一事实源](./env-ground-spec.md) | `scene/env/env-ground-spec.ts` | ADR-226 |
| [环境系统门面](./env.md) | `scene/env/env.ts` | — |
| [环境系统实现核心](./env-impl.md) | `scene/env/env-impl.ts` | — |
| [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) | `scene/env/env-bridge.ts` | ADR-138/148 |
| [环境重力控制](./env-gravity.md) | `scene/env/env-gravity.ts` | ADR-148/212 |
| [环境碰撞控制](./env-collision.md) | `scene/env/env-collision.ts` | ADR-212 |
| [环境状态防抖持久化](./env-persist.md) | `scene/env/env-persist.ts` | ADR-148/176 |
| [时间流转与太阳角系统](./env-time-of-day.md) | `scene/env/env-time-of-day.ts` | ADR-148 |
| [水面系统](./env-water.md) | `scene/env/env-water.ts` | — |
| [环境灯光包装](./env-lighting.md) | `scene/env/env-lighting.ts` | — |

> 🍃 叶子模块 / 工具函数（12 张）：[env-caustics](./env-caustics.md) [env-clouds](./env-clouds.md) [env-context](./env-context.md) [env-particles](./env-particles.md) [env-reflection](./env-reflection.md) [env-sky](./env-sky.md) [env-terrain](./env-terrain.md) [env-texture](./env-texture.md) [env-type-helpers](./env-type-helpers.md) [env-underwater-fog](./env-underwater-fog.md) [env-wetness](./env-wetness.md) [planar-reflection](./planar-reflection.md)

### 场景编排（scene）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [场景核心编排器](./scene.md) | `scene/scene.ts` | — |
| [场景序列化与自动保存](./scene-serialize.md) | `scene/scene-serialize.ts` | — |
| [相机模式管理系统](./camera.md) | `scene/camera/camera.ts` | ADR-035 |

> 🍃 叶子模块 / 工具函数（2 张）：[scene-bundle](./scene-bundle.md) [scene-migrate](./scene-migrate.md)

### 场景子系统（scene）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [PMX 模型加载与缩略图捕获](./model-loader.md) | `scene/manager/model-loader.ts` | — |
| [模型注册表与生命周期管理](./model-manager.md) | `scene/manager/model-manager.ts` | — |
| [模型生命周期操作](./model-ops.md) | `scene/manager/model-ops.ts` | ADR-116 |
| [分类材质系统](./material.md) | `scene/manager/material.ts` | — |
| [AR 摄像头视频透传](./ar-camera.md) | `scene/ar/ar-camera.ts` | ADR-055 |
| [AR 模式场景级协调](./ar-scene.md) | `scene/ar/ar-scene.ts` | ADR-055 |
| [拖拽变换模式开关](./transform-mode.md) | `scene/transform/transform-mode.ts` | — |
| [相机状态管理](./camera-state.md) | `scene/camera/camera-state.ts` | — |
| [变换选中物状态源](./transform-selection.md) | `- src/scene/transform/transform-selection.ts` | — |

> 🍃 叶子模块 / 工具函数（12 张）：[camera-angle](./camera-angle.md) [camera-auto](./camera-auto.md) [camera-behaviors](./camera-behaviors.md) [camera-bone-lock](./camera-bone-lock.md) [camera-factory](./camera-factory.md) [camera-vmd](./camera-vmd.md) [composition-guide](./composition-guide.md) [texture-lru](./texture-lru.md) [thumbnail-capture](./thumbnail-capture.md) [thumbnail-key](./thumbnail-key.md) [watermark](./watermark.md) [model-id](./model-id.md)

### 物理系统（physics）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [物理骨骼桥与每帧注册表](./physics-bridge.md) | `physics/physics-bridge.ts` | ADR-081 |
| [风力物理注入](./wind-physics.md) | `physics/wind-physics.ts` | ADR-104 |
| [虚拟裙骨物理控制器](./virtual-skirt.md) | `scene/physics/virtual-skirt.ts` | ADR-081/084 |

> 🍃 叶子模块 / 工具函数（2 张）：[ground-collision](./ground-collision.md) [skirt-analyzer](./skirt-analyzer.md)

### 渲染系统（rendering）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [个人灯光跟随](./lighting-follow.md) | `scene/render/lighting-follow.ts` | ADR-168 |
| [变换适配器注册表](./transform-adapter.md) | `scene/transform/transform-adapter.ts` | ADR-121/126 |
| [场景渲染管线与后处理](./renderer.md) | `scene/render/renderer.ts` | — |
| [场景光照与阴影](./lighting.md) | `scene/render/lighting.ts` | — |
| [性能监控与自动降级](./performance.md) | `scene/render/performance.ts` | ADR-159 |
| [灯光预设系统](./lighting-presets.md) | `scene/render/lighting-presets.ts` | — |
| [GPU 压缩纹理能力探测](./gpu-capabilities.md) | `core/gpu-capabilities.ts` | ADR-189 |

> 🍃 叶子模块 / 工具函数（13 张）：[ar-webxr-probe](./ar-webxr-probe.md) [invertablePointersInput](./invertablePointersInput.md) [light-cone](./light-cone.md) [lighting-shadow](./lighting-shadow.md) [lighting-stage](./lighting-stage.md) [lighting-state](./lighting-state.md) [lighting-sun](./lighting-sun.md) [lighting-tween](./lighting-tween.md) [mirror-debug](./mirror-debug.md) [performance-env-bridge](./performance-env-bridge.md) [quality-profile](./quality-profile.md) [transform-gizmo](./transform-gizmo.md) [transform-pick](./transform-pick.md)

### 动作系统（motion）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md) | `scene/motion/bone-override-store.ts` | ADR-084 |
| [动作管线（逐帧合成）](./motion-pipeline.md) | `scene/motion/motion-pipeline.ts` | ADR-129 |
| [感知层主控](./perception.md) | `scene/motion/perception.ts` | ADR-071/162/166 |
| [骨骼覆盖核心 API](./bone-override.md) | `scene/motion/bone-override.ts` | ADR-061/116/123/126/186 |
| [动作播放控制](./motion-playback.md) | `scene/motion/playback.ts` | — |
| [外部动作重定向桥](./animation-retargeter.md) | `scene/motion/animation-retargeter.ts` | — |
| [多 VMD 叠加系统](./vmd-layers.md) | `scene/motion/vmd-layers.ts` | — |
| [VMD 动作加载器](./vmd-loader.md) | `scene/motion/vmd-loader.ts` | — |
| [场景级动作意图库](./motion-intent.md) | `scene/motion/motion-intent.ts` | ADR-121/167 |
| [程序化动作系统](./proc-motion-bridge.md) | `scene/motion/proc-motion-bridge.ts` | — |
| [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) | `scene/motion/feet-adjustment.ts` | ADR-085 |
| [口型同步桥](./lipsync-bridge.md) | `scene/motion/lipsync-bridge.ts` | — |
| [动作模块注册表](./motion-modules-registry.md) | `scene/motion/motion-modules/registry.ts` | — |
| [动作历史管理](./motion-history.md) | `- src/scene/motion/motion-modules/motion-history.ts` | — |
| [动作模块基类](./motion-module-base.md) | `- src/scene/motion/motion-modules/module-base.ts` | ADR-116/ADR-126 |

> 🍃 叶子模块 / 工具函数（20 张）：[hand-symmetry](./hand-symmetry.md) [motion-footstep](./motion-footstep.md) [motion-modules-body-posture](./motion-modules-body-posture.md) [motion-modules-feet](./motion-modules-feet.md) [motion-modules-riding](./motion-modules-riding.md) [motion-override-levels](./motion-override-levels.md) [perception-gaze](./perception-gaze.md) [perception-shared](./perception-shared.md) [motion-math](./motion-math.md) [motion-module-types](./motion-module-types.md) [motion-preset-types](./motion-preset-types.md) [perception-balance](./perception-balance.md) [perception-blinking](./perception-blinking.md) [perception-breathing](./perception-breathing.md) [perception-expression](./perception-expression.md) [perception-gaze-js](./perception-gaze-js.md) [perception-gaze-wasm](./perception-gaze-wasm.md) [perception-lipsync](./perception-lipsync.md) [perception-observer](./perception-observer.md) [wasm-layers-blender](./wasm-layers-blender.md)

### UI/菜单（ui）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [滑出式菜单引擎](./menu.md) | `menus/menu.ts` | — |
| [声明式菜单 Schema](./menu-schema.md) | `menus/menu-schema.ts` | ADR-093 |
| [菜单 Overlay 与 Wrapper 管理](./menu-overlay.md) | `menus/menu-overlay.ts` | ADR-191 |
| [菜单栈共享指针](./menu-stack-registry.md) | `menus/menu-stack-registry.ts` | ADR-191 |
| [设置页路由与编排](./settings.md) | `menus/settings.ts` | ADR-157 |
| [资源库入口与编排](./library.md) | `menus/library.ts` | — |
| [环境弹窗（编排 + barrel）](./env-menu.md) | `menus/env-menu.ts` | — |
| [场景弹窗（编排 + 路由）](./scene-menu.md) | `menus/scene-menu.ts` | — |
| [动作绑定 UI](./motion-binding-ui.md) | `menus/motion-binding-ui.ts` | — |
| [动作详情 UI](./motion-detail-ui.md) | `menus/motion-detail-ui.ts` | — |
| [动作菜单层级系统](./motion-menu-levels.md) | `menus/motion-popup.ts` | — |
| [菜单渲染引擎](./render-menu.md) | `menus/render-menu.ts` | ADR-093 |
| [资源库操作](./library-actions.md) | `menus/library-actions.ts` | — |
| [资源库核心](./library-core.md) | `menus/library-core.ts` | — |
| [资源库初始化](./library-setup.md) | `menus/library-setup.ts` | — |
| [模型预设管理 UI](./model-preset-ui.md) | `- src/menus/model-preset.ts` | ADR-145 |
| [广场状态管理](./plaza-state.md) | `- src/menus/plaza-state.ts` | ADR-087 |
| [设置共享工具](./settings-shared.md) | `- src/menus/settings-shared.ts` | ADR-157 |

> 🍃 叶子模块 / 工具函数（35 张）：[assistant-panel](./assistant-panel.md) [diagnostic-chat](./diagnostic-chat.md) [diagnostic-config](./diagnostic-config.md) [diagnostic-control](./diagnostic-control.md) [diagnostic-session](./diagnostic-session.md) [diagnostic-state](./diagnostic-state.md) [env-menu-levels](./env-menu-levels.md) [library-browse](./library-browse.md) [library-session-store](./library-session-store.md) [menu-factory](./menu-factory.md) [menu-registry](./menu-registry.md) [menu-schema-register](./menu-schema-register.md) [model-detail](./model-detail.md) [plaza-creators](./plaza-creators.md) [plaza-thumbnail](./plaza-thumbnail.md) [scene-drag-levels](./scene-drag-levels.md) [scene-menu-levels](./scene-menu-levels.md) [scene-menu-state](./scene-menu-state.md) [settings-about](./settings-about.md) [settings-actions](./settings-actions.md) [settings-controls](./settings-controls.md) [settings-diagnostic](./settings-diagnostic.md) [settings-graphics](./settings-graphics.md) [settings-media](./settings-media.md) [settings-resources](./settings-resources.md) [settings-system](./settings-system.md) [model-material-ui](./model-material-ui.md) [outfit-ui](./outfit-ui.md) [plaza-browser](./plaza-browser.md) [plaza-download](./plaza-download.md) [plaza-sites](./plaza-sites.md) [preset-list-viewer](./preset-list-viewer.md) [settings-appearance](./settings-appearance.md) [settings-language](./settings-language.md) [settings-targets](./settings-targets.md)

### 核心基础设施（core）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [全局状态与场景运行时 Store](./state.md) | `core/state.ts` + `scene-state`/`playback-state`/`library-state` | ADR-141/137 |
| [EnvState 单一源 Schema](./env-state-schema.md) | `core/env-state-schema.ts` | ADR-137/132 |
| [Runtime 隔离桥](./runtime-bridge.md) | `core/runtime-bridge.ts` | ADR-177 |
| [后端绑定聚合层](./wails-bindings.md) | `core/wails-bindings.ts` | ADR-176 |
| [统一资源加载队列](./load-manager.md) | `core/load-manager.ts` | ADR-045/135 |
| [渲染循环与 FPS 时钟](./render-loop.md) | `core/render-loop.ts` | ADR-102 |
| [事件处理与导航系统](./events.md) | `core/events.ts` | — |
| [应用启动引导](./init.md) | `core/init.ts` | — |
| [国际化语言状态](./locale.md) | `core/i18n/locale.ts` | ADR-059 |
| [键盘导航工具](./ui-keyboard-nav.md) | `core/ui-keyboard-nav.ts` | ADR-153 |
| [统一文件服务层](./fileservice.md) | `core/fileservice.ts` | ADR-057 |
| [后端适配层](./core-backend.md) | `core/backend/index.ts` | — |
| [音频总线](./audio-bus.md) | `core/audio-bus.ts` | — |
| [快捷键注册表](./shortcut-registry.md) | `core/shortcut-registry.ts` | — |
| [运行模式检测](./runtime-mode.md) | `core/runtime-mode.ts` | — |
| [结构化反馈 API](./feedback.md) | `core/feedback.ts` | — |
| [模型加载/库扫描完成后菜单刷新注册表](./load-refresh-registry.md) | `core/load-refresh-registry.ts` | — |
| [babylon-mmd 适配边界](./mmd-adapter.md) | `core/mmd-adapter.ts` | ADR-192 |
| [安卓文件访问（shared 模式）](./android-file-access.md) | `internal/app/fileaccess_android.go` 等 | ADR-017/180/183/194 |
| [统一动作注册表](./action-registry.md) | `core/action-registry.ts` + `action-executor`/`action-defs/*`/`ai/{param-adapters,action-catalog,action-registry-defs}` | ADR-197/155 |
| [轨道相机键盘输入状态](./orbit-state.md) | `core/orbit-state.ts` | — |

> 🍃 叶子模块 / 工具函数（40 张）：[color-helpers](./color-helpers.md) [config-barrel](./config-barrel.md) [core-leaf-modules](./core-leaf-modules.md) [dev-hooks](./dev-hooks.md) [diagnostic-actions](./diagnostic-actions.md) [dialog](./dialog.md) [dispose-helpers](./dispose-helpers.md) [drop-import](./drop-import.md) [goerr](./goerr.md) [hash-noise](./hash-noise.md) [icons-bundle](./icons-bundle.md) [logger](./logger.md) [mmar-globals](./mmar-globals.md) [observer-handle](./observer-handle.md) [platform](./platform.md) [pmx-meta](./pmx-meta.md) [preset-meta](./preset-meta.md) [reactivity](./reactivity.md) [render-context](./render-context.md) [runtime-stub](./runtime-stub.md) [safe-call](./safe-call.md) [shortcut-app](./shortcut-app.md) [status-bar](./status-bar.md) [toast](./toast.md) [ui-constants](./ui-constants.md) [ui-focus-trap](./ui-focus-trap.md) [ui-header-toggle](./ui-header-toggle.md) [ui-helpers](./ui-helpers.md) [ui-nav-item](./ui-nav-item.md) [ui-preset](./ui-preset.md) [ui-slider-controller](./ui-slider-controller.md) [ui-state](./ui-state.md) [wind-utils](./wind-utils.md) [core-dom](./core-dom.md) [core-orbit](./core-orbit.md) [core-types](./core-types.md) [core-utils](./core-utils.md) [i18n-t](./i18n-t.md) [zh-CN](./zh-CN.md) [zh-TW](./zh-TW.md)

### 内置 AI 诊断助手（ai，ADR-196）

| 卡片 | 模块 | 关联 ADR |
|------|------|----------|
| [AI 双适配器服务层](./ai-service.md) | `core/ai/{types,index,browser-adapter,go-adapter}.ts` | ADR-196/176 |
| [AI 配置持久化](./ai-config-store.md) | `core/ai/config-store.ts` | ADR-196 |
| [错误环形缓冲与全局捕获](./ai-error-buffer.md) | `core/ai/error-buffer.ts` | ADR-196 |
| [场景运行时快照](./ai-scene-snapshot.md) | `core/ai/scene-snapshot.ts` | ADR-196 |
| [NL 意图解析（LLM→动作）](./ai-intent-dispatcher.md) | `core/ai/intent-dispatcher.ts` | ADR-155/197 |

> 🍃 叶子模块 / 工具函数（4 张）：[ai-sse](./ai-sse.md) [character-bible](./character-bible.md) [chat-store](./chat-store.md) [markdown](./markdown.md)
