<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，请勿手改。重跑：npm run gen:docsindex -->

# 知识卡索引

> 原子化架构知识层，共 **234** 张卡：记录「某个子系统**现在**长啥样、去哪找」。与 ADR（为什么这么决定）互补——知识卡引用而不复制 ADR 结论。

> 卡片格式规范、立卡判据、`source_files` 铁律见 [知识卡层导读](./README.md)；AI 检索入口见 [路由表](./routes.md)；菜单全景见 [menu-map](./menu-map.md)（机器生成）。

## 分类总览

| 分类 | 卡片数 | 说明 |
|------|--------|------|
| [env](#env) | 24 | 环境系统 |
| [scene](#scene) | 28 | 场景编排 |
| [physics](#physics) | 5 | 物理系统 |
| [rendering](#rendering) | 18 | 渲染系统 |
| [motion](#motion) | 34 | 动作系统 |
| [ui](#ui) | 55 | UI / 菜单 |
| [core](#core) | 69 | 核心基础设施 |
| [未分类](#未分类) | 1 | 未标注 category（待补） |

## env

**环境系统**

| 卡片 | 关联 ADR |
|------|----------|
| [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) | - ADR-138 |
| [环境碰撞控制](./env-collision.md) | - ADR-212 |
| [环境变更分发回调（破循环依赖）](./env-dispatcher.md) | - ADR-138 |
| [环境重力控制](./env-gravity.md) | - ADR-148 |
| [地面材质单一事实源（GroundMaterialSpec）](./env-ground-spec.md) | - ADR-226 |
| [地面系统](./env-ground.md) | - ADR-114 |
| [环境系统实现核心（barrel + observer + fog）](./env-impl.md) | — |
| [环境灯光包装](./env-lighting.md) | [] |
| [环境状态防抖持久化](./env-persist.md) | - ADR-148 |
| [时间流转与太阳角系统](./env-time-of-day.md) | - ADR-148 |
| [水面系统](./env-water.md) | - ADR-062 |
| [环境系统门面（Facade）](./env.md) | — |

> 叶子模块 / 工具函数（12 张）：[env-caustics](./env-caustics.md) · [env-clouds](./env-clouds.md) · [env-context](./env-context.md) · [env-particles](./env-particles.md) · [env-reflection](./env-reflection.md) · [env-sky](./env-sky.md) · [env-terrain](./env-terrain.md) · [env-texture](./env-texture.md) · [env-type-helpers](./env-type-helpers.md) · [env-underwater-fog](./env-underwater-fog.md) · [env-wetness](./env-wetness.md) · [planar-reflection](./planar-reflection.md)

## scene

**场景编排**

| 卡片 | 关联 ADR |
|------|----------|
| [AR 摄像头视频透传](./ar-camera.md) | - ADR-055 |
| [AR 模式场景级协调](./ar-scene.md) | - ADR-055 |
| [相机状态管理 + 运行时上下文](./camera-state.md) | - ADR-100 |
| [相机模式管理系统（MmdCamera）](./camera.md) | - ADR-035 |
| [分类材质系统](./material.md) | — |
| [PMX 模型加载与缩略图捕获](./model-loader.md) | — |
| [模型注册表与生命周期管理](./model-manager.md) | — |
| [模型生命周期操作](./model-ops.md) | — |
| [场景序列化与自动保存](./scene-serialize.md) | [] |
| [场景核心编排器（纯组装器）](./scene.md) | [] |
| [变换适配器注册表（双模态去重）](./transform-adapter.md) | - ADR-126 |
| [拖拽变换模式开关](./transform-mode.md) | — |
| [变换选中物状态源](./transform-selection.md) | — |

> 叶子模块 / 工具函数（15 张）：[camera-angle](./camera-angle.md) · [camera-auto](./camera-auto.md) · [camera-behaviors](./camera-behaviors.md) · [camera-bone-lock](./camera-bone-lock.md) · [camera-factory](./camera-factory.md) · [camera-vmd](./camera-vmd.md) · [composition-guide](./composition-guide.md) · [model-id](./model-id.md) · [scene-bundle](./scene-bundle.md) · [scene-migrate](./scene-migrate.md) · [texture-lru](./texture-lru.md) · [thumbnail-capture](./thumbnail-capture.md) · [thumbnail-key](./thumbnail-key.md) · [transform-pick](./transform-pick.md) · [watermark](./watermark.md)

## physics

**物理系统**

| 卡片 | 关联 ADR |
|------|----------|
| [物理骨骼桥与每帧注册表](./physics-bridge.md) | - ADR-081 |
| [虚拟裙骨物理控制器（ADR-084 Phase 2-3）](./virtual-skirt.md) | - ADR-084 |
| [风力物理注入（WASM Bullet）](./wind-physics.md) | - ADR-104 |

> 叶子模块 / 工具函数（2 张）：[ground-collision](./ground-collision.md) · [skirt-analyzer](./skirt-analyzer.md)

## rendering

**渲染系统**

| 卡片 | 关联 ADR |
|------|----------|
| [GPU 压缩纹理能力探测](./gpu-capabilities.md) | - ADR-189 |
| [个人灯光跟随](./lighting-follow.md) | - ADR-168 |
| [灯光预设系统](./lighting-presets.md) | [] |
| [场景光照与阴影（barrel）](./lighting.md) | — |
| [性能监控与自动降级](./performance.md) | - ADR-159 |
| [场景渲染管线与后处理](./renderer.md) | — |

> 叶子模块 / 工具函数（12 张）：[ar-webxr-probe](./ar-webxr-probe.md) · [invertablePointersInput](./invertablePointersInput.md) · [light-cone](./light-cone.md) · [lighting-shadow](./lighting-shadow.md) · [lighting-stage](./lighting-stage.md) · [lighting-state](./lighting-state.md) · [lighting-sun](./lighting-sun.md) · [lighting-tween](./lighting-tween.md) · [mirror-debug](./mirror-debug.md) · [performance-env-bridge](./performance-env-bridge.md) · [quality-profile](./quality-profile.md) · [transform-gizmo](./transform-gizmo.md)

## motion

**动作系统**

| 卡片 | 关联 ADR |
|------|----------|
| [外部动作重定向桥](./animation-retargeter.md) | - ADR-108 |
| [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md) | - ADR-084 |
| [骨骼覆盖核心 API](./bone-override.md) | - ADR-061 |
| [口型同步桥](./lipsync-bridge.md) | - ADR-021 |
| [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) | - ADR-085 |
| [动作历史管理](./motion-history.md) | [] |
| [场景级动作意图库](./motion-intent.md) | - ADR-121 |
| [动作模块基类](./motion-module-base.md) | - ADR-116 |
| [动作模块注册表](./motion-modules-registry.md) | [] |
| [动作管线（逐帧合成）](./motion-pipeline.md) | - ADR-147 |
| [动作播放控制](./motion-playback.md) | [] |
| [感知层主控](./perception.md) | - ADR-071 |
| [程序化动作系统](./proc-motion-bridge.md) | - ADR-021 |
| [多 VMD 叠加系统](./vmd-layers.md) | - ADR-051 |
| [VMD 动作加载器](./vmd-loader.md) | - ADR-051 |

> 叶子模块 / 工具函数（19 张）：[hand-symmetry](./hand-symmetry.md) · [motion-footstep](./motion-footstep.md) · [motion-math](./motion-math.md) · [motion-module-types](./motion-module-types.md) · [motion-modules-body-posture](./motion-modules-body-posture.md) · [motion-modules-feet](./motion-modules-feet.md) · [motion-modules-riding](./motion-modules-riding.md) · [motion-preset-types](./motion-preset-types.md) · [perception-balance](./perception-balance.md) · [perception-blinking](./perception-blinking.md) · [perception-breathing](./perception-breathing.md) · [perception-expression](./perception-expression.md) · [perception-gaze-js](./perception-gaze-js.md) · [perception-gaze-wasm](./perception-gaze-wasm.md) · [perception-gaze](./perception-gaze.md) · [perception-lipsync](./perception-lipsync.md) · [perception-observer](./perception-observer.md) · [perception-shared](./perception-shared.md) · [wasm-layers-blender](./wasm-layers-blender.md)

## ui

**UI / 菜单**

| 卡片 | 关联 ADR |
|------|----------|
| [环境弹窗（编排 + barrel）](./env-menu.md) | — |
| [资源库操作](./library-actions.md) | - ADR-131 |
| [资源库核心](./library-core.md) | [] |
| [资源库初始化](./library-setup.md) | [] |
| [资源库入口与编排](./library.md) | — |
| [菜单 Overlay 与 Wrapper 管理](./menu-overlay.md) | - ADR-191 |
| [声明式菜单 Schema](./menu-schema.md) | - ADR-093 |
| [菜单栈共享指针（stackRegistry）](./menu-stack-registry.md) | - ADR-191 |
| [滑出式菜单引擎（SlideMenu）](./menu.md) | — |
| [模型预设管理 UI](./model-preset-ui.md) | - ADR-145 |
| [动作绑定 UI](./motion-binding-ui.md) | [] |
| [动作详情 UI](./motion-detail-ui.md) | [] |
| [动作菜单层级系统](./motion-menu-levels.md) | - ADR-071 |
| [广场状态管理](./plaza-state.md) | - ADR-087 |
| [菜单渲染引擎](./render-menu.md) | - ADR-093 |
| [场景弹窗（编排 + 路由）](./scene-menu.md) | — |
| [设置共享工具](./settings-shared.md) | - ADR-157 |
| [设置页路由与编排](./settings.md) | - ADR-157 |

> 叶子模块 / 工具函数（37 张）：[assistant-panel](./assistant-panel.md) · [diagnostic-chat](./diagnostic-chat.md) · [diagnostic-config](./diagnostic-config.md) · [diagnostic-control](./diagnostic-control.md) · [diagnostic-session](./diagnostic-session.md) · [diagnostic-state](./diagnostic-state.md) · [env-menu-levels](./env-menu-levels.md) · [library-browse](./library-browse.md) · [library-session-store](./library-session-store.md) · [menu-factory](./menu-factory.md) · [menu-registry](./menu-registry.md) · [menu-schema-register](./menu-schema-register.md) · [model-detail](./model-detail.md) · [model-material-ui](./model-material-ui.md) · [motion-override-levels](./motion-override-levels.md) · [outfit-ui](./outfit-ui.md) · [plaza-browser](./plaza-browser.md) · [plaza-creators](./plaza-creators.md) · [plaza-download](./plaza-download.md) · [plaza-sites](./plaza-sites.md) · [plaza-thumbnail](./plaza-thumbnail.md) · [preset-list-viewer](./preset-list-viewer.md) · [scene-drag-levels](./scene-drag-levels.md) · [scene-menu-levels](./scene-menu-levels.md) · [scene-menu-state](./scene-menu-state.md) · [settings-about](./settings-about.md) · [settings-actions](./settings-actions.md) · [settings-appearance](./settings-appearance.md) · [settings-controls](./settings-controls.md) · [settings-diagnostic](./settings-diagnostic.md) · [settings-graphics](./settings-graphics.md) · [settings-language](./settings-language.md) · [settings-media](./settings-media.md) · [settings-resources](./settings-resources.md) · [settings-system](./settings-system.md) · [settings-targets](./settings-targets.md) · [ui-helpers](./ui-helpers.md)

## core

**核心基础设施**

| 卡片 | 关联 ADR |
|------|----------|
| [统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md) | - ADR-197 |
| [AI 配置持久化（IndexedDB）](./ai-config-store.md) | - ADR-196 |
| [错误环形缓冲与全局捕获](./ai-error-buffer.md) | - ADR-196 |
| [NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) | - ADR-155 |
| [场景运行时快照（AI 上下文）](./ai-scene-snapshot.md) | - ADR-196 |
| [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) | - ADR-196 |
| [安卓文件访问（shared 模式）](./android-file-access.md) | - ADR-017 |
| [音频总线](./audio-bus.md) | [] |
| [后端适配层](./core-backend.md) | - ADR-176 |
| [EnvState 单一源 Schema](./env-state-schema.md) | - ADR-137 |
| [事件处理与导航系统](./events.md) | [] |
| [结构化反馈 API](./feedback.md) | — |
| [统一文件服务层](./fileservice.md) | - ADR-057 |
| [应用启动引导](./init.md) | [] |
| [统一资源加载队列](./load-manager.md) | - ADR-045 |
| [模型加载/库扫描完成后菜单刷新注册表](./load-refresh-registry.md) | — |
| [国际化语言状态](./locale.md) | - ADR-059 |
| [babylon-mmd 适配边界](./mmd-adapter.md) | - ADR-192 |
| [轨道相机键盘输入状态叶子](./orbit-state.md) | [] |
| [渲染循环与 FPS 时钟](./render-loop.md) | - ADR-102 |
| [Runtime 隔离桥（Wails Events/Browser）](./runtime-bridge.md) | - ADR-177 |
| [运行模式检测](./runtime-mode.md) | [] |
| [快捷键注册表](./shortcut-registry.md) | - ADR-036 |
| [全局状态与场景运行时 Store](./state.md) | - ADR-141 |
| [键盘导航工具](./ui-keyboard-nav.md) | - ADR-153 |
| [后端绑定聚合层（backend 代理化）](./wails-bindings.md) | - ADR-176 |

> 叶子模块 / 工具函数（43 张）：[ai-sse](./ai-sse.md) · [character-bible](./character-bible.md) · [chat-store](./chat-store.md) · [color-helpers](./color-helpers.md) · [config-barrel](./config-barrel.md) · [core-dom](./core-dom.md) · [core-leaf-modules](./core-leaf-modules.md) · [core-orbit](./core-orbit.md) · [core-types](./core-types.md) · [core-utils](./core-utils.md) · [dev-hooks](./dev-hooks.md) · [diagnostic-actions](./diagnostic-actions.md) · [dialog](./dialog.md) · [dispose-helpers](./dispose-helpers.md) · [drop-import](./drop-import.md) · [goerr](./goerr.md) · [hash-noise](./hash-noise.md) · [i18n-t](./i18n-t.md) · [icons-bundle](./icons-bundle.md) · [logger](./logger.md) · [markdown](./markdown.md) · [mmar-globals](./mmar-globals.md) · [observer-handle](./observer-handle.md) · [platform](./platform.md) · [pmx-meta](./pmx-meta.md) · [preset-meta](./preset-meta.md) · [reactivity](./reactivity.md) · [render-context](./render-context.md) · [runtime-stub](./runtime-stub.md) · [safe-call](./safe-call.md) · [shortcut-app](./shortcut-app.md) · [status-bar](./status-bar.md) · [toast](./toast.md) · [ui-constants](./ui-constants.md) · [ui-focus-trap](./ui-focus-trap.md) · [ui-header-toggle](./ui-header-toggle.md) · [ui-nav-item](./ui-nav-item.md) · [ui-preset](./ui-preset.md) · [ui-slider-controller](./ui-slider-controller.md) · [ui-state](./ui-state.md) · [wind-utils](./wind-utils.md) · [zh-CN](./zh-CN.md) · [zh-TW](./zh-TW.md)

## 未分类

**未标注 `category` 字段**——补齐 frontmatter 后会自动归入对应分类。

| 卡片 | 关联 ADR |
|------|----------|
| [tier-review](./tier-review.md) | — |

## 索引与路由（非卡片）

- [菜单层级地图（自动生成）](./menu-map.md)
- [知识卡层（Knowledge Cards）](./README.md)
- [AI 知识库路由表](./routes.md)
