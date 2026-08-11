<!-- 本文件由 scripts/gen-docs-index.mjs 自动生成，请勿手改。重跑：npm run gen:docsindex -->

# 知识卡索引

> 原子化架构知识层，共 **270** 张卡：记录「某个子系统**现在**长啥样、去哪找」。与 ADR（为什么这么决定）互补——知识卡引用而不复制 ADR 结论。

> 卡片格式规范、立卡判据、`source_files` 铁律见 [知识卡层导读](./README.md)；AI 检索入口见 [路由表](./routes.md)；菜单全景见 [menu-map](./menu-map.md)（机器生成）。

## 分类总览

| 分类 | 卡片数 | 说明 |
|------|--------|------|
| [env](#env) | 24 | 环境系统 |
| [scene](#scene) | 34 | 场景编排 |
| [physics](#physics) | 5 | 物理系统 |
| [rendering](#rendering) | 18 | 渲染系统 |
| [motion](#motion) | 34 | 动作系统 |
| [ui](#ui) | 58 | UI / 菜单 |
| [core](#core) | 77 | 核心基础设施 |
| [backend](#backend) | 18 | 后端 |
| [未分类](#未分类) | 2 | 未标注 category（待补） |

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
| [环境系统实现核心（barrel + observer + fog）](./env-impl.md) | - ADR-138 |
| [环境灯光包装](./env-lighting.md) | - ADR-132 |
| [环境状态防抖持久化](./env-persist.md) | - ADR-148 |
| [时间流转与太阳角系统](./env-time-of-day.md) | - ADR-148 |
| [水面系统](./env-water.md) | - ADR-062 |
| [环境系统门面（Facade）](./env.md) | - ADR-128 |

> 叶子模块 / 工具函数（12 张）：[env-caustics](./env-caustics.md) · [env-clouds](./env-clouds.md) · [env-context](./env-context.md) · [env-particles](./env-particles.md) · [env-reflection](./env-reflection.md) · [env-sky](./env-sky.md) · [env-terrain](./env-terrain.md) · [env-texture](./env-texture.md) · [env-type-helpers](./env-type-helpers.md) · [env-underwater-fog](./env-underwater-fog.md) · [env-wetness](./env-wetness.md) · [planar-reflection](./planar-reflection.md)

## scene

**场景编排**

| 卡片 | 关联 ADR |
|------|----------|
| [AR 摄像头视频透传](./ar-camera.md) | - ADR-055 |
| [AR 模式场景级协调](./ar-scene.md) | - ADR-055 |
| [相机状态管理 + 运行时上下文](./camera-state.md) | - ADR-100 |
| [相机模式管理系统（MmdCamera）](./camera.md) | - ADR-035 |
| [脚部落地检测降级](./footstep-detect-fallback.md) | - ADR-088 |
| [分类材质系统](./material.md) | - ADR-188 |
| [PMX 模型加载与缩略图捕获](./model-loader.md) | - ADR-124 |
| [模型注册表与生命周期管理](./model-manager.md) | - ADR-049 |
| [模型生命周期操作](./model-ops.md) | - ADR-049 |
| [换装叠加层](./outfit-overlay.md) | - ADR-242 |
| [换装系统](./outfit.md) | - ADR-242 |
| [场景序列化与自动保存](./scene-serialize.md) | - ADR-049 |
| [场景核心编排器（纯组装器）](./scene.md) | - ADR-099 |
| [SSS PBR 材质](./sss-pbr-material.md) | [] |
| [变换适配器注册表（双模态去重）](./transform-adapter.md) | - ADR-126 |
| [拖拽变换模式开关](./transform-mode.md) | — |
| [变换选中物状态源](./transform-selection.md) | - ADR-171 |

> 叶子模块 / 工具函数（17 张）：[camera-angle](./camera-angle.md) · [camera-auto](./camera-auto.md) · [camera-behaviors](./camera-behaviors.md) · [camera-bone-lock](./camera-bone-lock.md) · [camera-factory](./camera-factory.md) · [camera-vmd](./camera-vmd.md) · [composition-guide](./composition-guide.md) · [model-id](./model-id.md) · [pmx-texture-audit](./pmx-texture-audit.md) · [scene-bundle](./scene-bundle.md) · [scene-migrate](./scene-migrate.md) · [texture-fallback](./texture-fallback.md) · [texture-lru](./texture-lru.md) · [thumbnail-capture](./thumbnail-capture.md) · [thumbnail-key](./thumbnail-key.md) · [transform-pick](./transform-pick.md) · [watermark](./watermark.md)

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
| [灯光预设系统](./lighting-presets.md) | - ADR-168 |
| [场景光照与阴影（barrel）](./lighting.md) | - ADR-132 |
| [性能监控与自动降级](./performance.md) | - ADR-159 |
| [场景渲染管线与后处理](./renderer.md) | - ADR-076 |

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
| [动作历史管理](./motion-history.md) | - ADR-125 |
| [场景级动作意图库](./motion-intent.md) | - ADR-121 |
| [动作模块基类](./motion-module-base.md) | - ADR-116 |
| [动作模块注册表](./motion-modules-registry.md) | - ADR-116 |
| [动作管线（逐帧合成）](./motion-pipeline.md) | - ADR-147 |
| [动作播放控制](./motion-playback.md) | - ADR-204 |
| [感知层主控](./perception.md) | - ADR-071 |
| [程序化动作系统](./proc-motion-bridge.md) | - ADR-021 |
| [多 VMD 叠加系统](./vmd-layers.md) | - ADR-051 |
| [VMD 动作加载器](./vmd-loader.md) | - ADR-051 |

> 叶子模块 / 工具函数（19 张）：[hand-symmetry](./hand-symmetry.md) · [motion-footstep](./motion-footstep.md) · [motion-math](./motion-math.md) · [motion-module-types](./motion-module-types.md) · [motion-modules-body-posture](./motion-modules-body-posture.md) · [motion-modules-feet](./motion-modules-feet.md) · [motion-modules-riding](./motion-modules-riding.md) · [motion-preset-types](./motion-preset-types.md) · [perception-balance](./perception-balance.md) · [perception-blinking](./perception-blinking.md) · [perception-breathing](./perception-breathing.md) · [perception-expression](./perception-expression.md) · [perception-gaze-js](./perception-gaze-js.md) · [perception-gaze-wasm](./perception-gaze-wasm.md) · [perception-gaze](./perception-gaze.md) · [perception-lipsync](./perception-lipsync.md) · [perception-observer](./perception-observer.md) · [perception-shared](./perception-shared.md) · [wasm-layers-blender](./wasm-layers-blender.md)

## ui

**UI / 菜单**

| 卡片 | 关联 ADR |
|------|----------|
| [渲染层 DOM 契约单源](./dom-contract.md) | - ADR-229 |
| [环境弹窗（编排 + barrel）](./env-menu.md) | - ADR-065 |
| [资源库操作](./library-actions.md) | - ADR-131 |
| [资源库核心](./library-core.md) | - ADR-131 |
| [资源库初始化](./library-setup.md) | - ADR-017 |
| [资源库入口与编排](./library.md) | - ADR-045 |
| [菜单 Overlay 与 Wrapper 管理](./menu-overlay.md) | - ADR-191 |
| [声明式菜单 Schema](./menu-schema.md) | - ADR-093 |
| [菜单栈共享指针（stackRegistry）](./menu-stack-registry.md) | - ADR-191 |
| [滑出式菜单引擎（SlideMenu）](./menu.md) | - ADR-065 |
| [模型预设管理 UI](./model-preset-ui.md) | - ADR-145 |
| [动作绑定 UI](./motion-binding-ui.md) | - ADR-129 |
| [动作详情 UI](./motion-detail-ui.md) | - ADR-167 |
| [动作菜单层级系统](./motion-menu-levels.md) | - ADR-071 |
| [广场状态管理](./plaza-state.md) | - ADR-087 |
| [菜单渲染引擎](./render-menu.md) | - ADR-093 |
| [场景弹窗（编排 + 路由）](./scene-menu.md) | - ADR-065 |
| [设置共享工具](./settings-shared.md) | - ADR-157 |
| [设置页路由与编排](./settings.md) | - ADR-157 |
| [基础行控件构建器](./ui-rows.md) | - ADR-140 |

> 叶子模块 / 工具函数（38 张）：[assistant-panel](./assistant-panel.md) · [diagnostic-chat](./diagnostic-chat.md) · [diagnostic-config](./diagnostic-config.md) · [diagnostic-control](./diagnostic-control.md) · [diagnostic-session](./diagnostic-session.md) · [diagnostic-state](./diagnostic-state.md) · [env-menu-levels](./env-menu-levels.md) · [library-browse](./library-browse.md) · [library-session-store](./library-session-store.md) · [menu-factory](./menu-factory.md) · [menu-registry](./menu-registry.md) · [menu-schema-register](./menu-schema-register.md) · [model-detail](./model-detail.md) · [model-material-ui](./model-material-ui.md) · [motion-override-levels](./motion-override-levels.md) · [outfit-ui](./outfit-ui.md) · [plaza-browser](./plaza-browser.md) · [plaza-creators](./plaza-creators.md) · [plaza-download](./plaza-download.md) · [plaza-sites](./plaza-sites.md) · [plaza-thumbnail](./plaza-thumbnail.md) · [preset-list-viewer](./preset-list-viewer.md) · [scene-drag-levels](./scene-drag-levels.md) · [scene-menu-levels](./scene-menu-levels.md) · [scene-menu-state](./scene-menu-state.md) · [scene-stage-lights](./scene-stage-lights.md) · [settings-about](./settings-about.md) · [settings-actions](./settings-actions.md) · [settings-appearance](./settings-appearance.md) · [settings-controls](./settings-controls.md) · [settings-diagnostic](./settings-diagnostic.md) · [settings-graphics](./settings-graphics.md) · [settings-language](./settings-language.md) · [settings-media](./settings-media.md) · [settings-resources](./settings-resources.md) · [settings-system](./settings-system.md) · [settings-targets](./settings-targets.md) · [ui-helpers](./ui-helpers.md)

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
| [安卓网页版文件管理诊断](./android-web-file-management.md) | - ADR-017 |
| [音频总线](./audio-bus.md) | - ADR-088 |
| [后端适配层](./core-backend.md) | - ADR-176 |
| [EnvState 默认值派生](./env-state-defaults.md) | - ADR-243 |
| [EnvState 单一源 Schema](./env-state-schema.md) | - ADR-137 |
| [事件处理与导航系统](./events.md) | - ADR-102 |
| [结构化反馈 API](./feedback.md) | — |
| [统一文件服务层](./fileservice.md) | - ADR-057 |
| [应用启动引导](./init.md) | - ADR-003 |
| [统一资源加载队列](./load-manager.md) | - ADR-045 |
| [模型加载/库扫描完成后菜单刷新注册表](./load-refresh-registry.md) | — |
| [国际化语言状态](./locale.md) | - ADR-059 |
| [babylon-mmd 适配边界](./mmd-adapter.md) | - ADR-192 |
| [轨道相机键盘输入状态叶子](./orbit-state.md) | - ADR-049 |
| [渲染循环与 FPS 时钟](./render-loop.md) | - ADR-102 |
| [资源加载失败统一汇总](./resource-warning-sink.md) | — |
| [Runtime 隔离桥（Wails Events/Browser）](./runtime-bridge.md) | - ADR-177 |
| [运行模式检测](./runtime-mode.md) | - ADR-099 |
| [快捷键注册表](./shortcut-registry.md) | - ADR-036 |
| [全局状态与场景运行时 Store](./state.md) | - ADR-141 |
| [键盘导航工具](./ui-keyboard-nav.md) | - ADR-153 |
| [后端绑定聚合层（backend 代理化）](./wails-bindings.md) | - ADR-176 |

> 叶子模块 / 工具函数（48 张）：[ai-sse](./ai-sse.md) · [character-bible](./character-bible.md) · [chat-store](./chat-store.md) · [color-helpers](./color-helpers.md) · [config-barrel](./config-barrel.md) · [core-dom](./core-dom.md) · [core-leaf-modules](./core-leaf-modules.md) · [core-orbit](./core-orbit.md) · [core-types](./core-types.md) · [core-utils](./core-utils.md) · [dev-hooks](./dev-hooks.md) · [diagnostic-actions](./diagnostic-actions.md) · [dialog](./dialog.md) · [dispose-helpers](./dispose-helpers.md) · [drop-import](./drop-import.md) · [e2e-state-bridge](./e2e-state-bridge.md) · [goerr](./goerr.md) · [hash-noise](./hash-noise.md) · [i18n-t](./i18n-t.md) · [icons-bundle](./icons-bundle.md) · [logger](./logger.md) · [markdown](./markdown.md) · [mmar-globals](./mmar-globals.md) · [observer-handle](./observer-handle.md) · [outfits-spec](./outfits-spec.md) · [platform](./platform.md) · [pmx-meta](./pmx-meta.md) · [preset-meta](./preset-meta.md) · [reactivity](./reactivity.md) · [render-context](./render-context.md) · [runtime-stub](./runtime-stub.md) · [safe-call](./safe-call.md) · [scene-action-bridge](./scene-action-bridge.md) · [shortcut-app](./shortcut-app.md) · [status-bar](./status-bar.md) · [theme](./theme.md) · [toast](./toast.md) · [ui-action-bridge](./ui-action-bridge.md) · [ui-constants](./ui-constants.md) · [ui-focus-trap](./ui-focus-trap.md) · [ui-header-toggle](./ui-header-toggle.md) · [ui-nav-item](./ui-nav-item.md) · [ui-preset](./ui-preset.md) · [ui-slider-controller](./ui-slider-controller.md) · [ui-state](./ui-state.md) · [wind-utils](./wind-utils.md) · [zh-CN](./zh-CN.md) · [zh-TW](./zh-TW.md)

## backend

**后端**

| 卡片 | 关联 ADR |
|------|----------|
| [Go 后端核心（App 生命周期 + 配置系统）](./go-app.md) | - ADR-066 |
| [Go 文件与路径平台抽象](./go-fileaccess.md) | - ADR-195 |
| [Go 模型隔离与安全 HTTP](./go-httpserver.md) | — |
| [Go 软件集成（Blender/MMD/自定义）](./go-integration.md) | — |
| [Go KTX2 纹理编码](./go-ktx2.md) | — |
| [Go 模型库扫描](./go-library.md) | - ADR-189 |
| [Go LLM 客户端与 AI 绑定](./go-llm.md) | — |
| [Go 广场窗口与配置](./go-plaza.md) | — |
| [Go 预设持久化与标签](./go-presets.md) | - ADR-145 |
| [Go 模型广场代理（SSRF 防护）](./go-proxy.md) | — |
| [Go 场景序列化与打包](./go-scene.md) | — |
| [Go 更新检查与安装](./go-update.md) | - ADR-179 |
| [Go 下载目录监听与导入](./go-watch.md) | — |
| [Go ZIP 解压与缓存管理](./go-zipextract.md) | - ADR-057 |

> 叶子模块 / 工具函数（4 张）：[go-dialogs](./go-dialogs.md) · [go-i18nerr](./go-i18nerr.md) · [go-thumbnail](./go-thumbnail.md) · [go-util](./go-util.md)

## 未分类

**未标注 `category` 字段**——补齐 frontmatter 后会自动归入对应分类。

| 卡片 | 关联 ADR |
|------|----------|
| [relay](./relay.md) | — |
| [test-mesh](./test-mesh.md) | — |

## ADR 反查

> 从卡片 `adr:` 字段**反向聚合**：某条决策影响了哪些子系统。正向导航见 [决策记录索引](../adr/index.md)。

| ADR | 主题 | 关联卡片 |
|-----|------|----------|
| [ADR-003](../adr/adr-003-download-strategy.md) | 下载监听策略（精简版） | [应用启动引导](./init.md) |
| [ADR-017](../adr/adr-017-android-adaptation.md) | Android 平台适配（精简版） | [安卓文件访问（shared 模式）](./android-file-access.md) · [安卓网页版文件管理诊断](./android-web-file-management.md) · [资源库初始化](./library-setup.md) |
| [ADR-021](../adr/adr-021-procedural-motion.md) | 程序化动作系统（Idle/Auto Dance + LipSync + 视线追踪） | [口型同步桥](./lipsync-bridge.md) · [程序化动作系统](./proc-motion-bridge.md) |
| [ADR-026](../adr/adr-026-environment-system-enhancement.md) | 环境系统增强 — 纹理地面、粒子系统、粒子溅射、水下后处理联动 | [粒子系统](./env-particles.md) |
| [ADR-028](../adr/adr-028-wind-system-unification.md) | 风场系统统一 — 从碎片化到集中治理 | [统一风场辅助函数](./wind-utils.md) |
| [ADR-035](../adr/adr-035-settings-gap-analysis.md) | 设置面板功能缺口评估 | [相机 VMD 动画](./camera-vmd.md) · [相机模式管理系统（MmdCamera）](./camera.md) · [反 Y 轴指针输入](./invertablePointersInput.md) |
| [ADR-036](../adr/adr-036-shortcut-registry.md) | ShortcutRegistry — 可配置快捷键系统 | [快捷键注册表](./shortcut-registry.md) |
| [ADR-037](../adr/adr-037-session-ui-improvements.md) | P2 功能批量交付 — Lifelike / Formation / Auto Camera / Scene Bundle | [场景打包/解包](./scene-bundle.md) |
| [ADR-045](../adr/adr-045-unified-loading.md) | 统一加载与资源管理（精简版） | [资源库入口与编排](./library.md) · [统一资源加载队列](./load-manager.md) |
| [ADR-048](../adr/adr-048-transform-unification.md) | 变换系统统一 — 模型/灯光/道具移动一致性 | [3D 拖拽 Gizmo 统一抽象](./transform-gizmo.md) |
| [ADR-049](../adr/adr-049-orbit-control-extension.md) | 轨道控制统一 — 球面坐标扩展到模型/道具 | [模型注册表与生命周期管理](./model-manager.md) · [模型生命周期操作](./model-ops.md) · [轨道相机键盘输入状态叶子](./orbit-state.md) · [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-051](../adr/adr-051-vmd-layers-bonefilter.md) | VMD 图层系统与骨骼级过滤 | [多 VMD 叠加系统](./vmd-layers.md) · [VMD 动作加载器](./vmd-loader.md) |
| [ADR-054](../adr/adr-054-roadmap-next.md) | 后续开发方向路线图 | [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-055](../adr/adr-055-ar-camera-mode.md) | AR 相机模式 —— 摄像头视频透传与模型叠加 | [AR 摄像头视频透传](./ar-camera.md) · [AR 模式场景级协调](./ar-scene.md) |
| [ADR-056](../adr/adr-056-wasm-runtime-motion-layers.md) | WASM 运行时 Motion Layers 解锁 — JS 帧流合并 + 单图层兜底 | [WASM 图层混合器](./wasm-layers-blender.md) |
| [ADR-057](../adr/adr-057-shift-jis-url-base64.md) | Shift-JIS URL 乱码修复 —— Base64 查询参数方案（链路 A） | [统一文件服务层](./fileservice.md) · [Go ZIP 解压与缓存管理](./go-zipextract.md) · [VMD 动作加载器](./vmd-loader.md) |
| [ADR-058](../adr/adr-058-basenameFallbackFS.md) | 纹理路径字节级匹配 —— basenameFallbackFS 多编码兜底 | [Go ZIP 解压与缓存管理](./go-zipextract.md) |
| [ADR-059](../adr/adr-059-i18n-framework.md) | i18n 多语言切换框架 | [国际化翻译函数](./i18n-t.md) · [应用启动引导](./init.md) · [国际化语言状态](./locale.md) · [简体中文语言包](./zh-CN.md) · [繁体中文语言包](./zh-TW.md) |
| [ADR-061](../adr/adr-061-advanced-bone-systems.md) | 高级骨骼操控与姿态工作室实现计划 | [骨骼覆盖核心 API](./bone-override.md) · [共享类型定义](./core-types.md) · [动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）](./motion-override-levels.md) · [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-062](../adr/adr-062-water-reflection-render-target.md) | 水面反射渲染目标与通用反射系统 | [水面系统](./env-water.md) |
| [ADR-065](../adr/adr-065-pure-items-hot-render.md) | 纯 items 层级语言热切换刷新（精简版） | [环境弹窗（编排 + barrel）](./env-menu.md) · [滑出式菜单引擎（SlideMenu）](./menu.md) · [场景弹窗（编排 + 路由）](./scene-menu.md) |
| [ADR-066](../adr/adr-066-fullscreen-resource-library.md) | 全屏资源库界面（精简版） | [Go 后端核心（App 生命周期 + 配置系统）](./go-app.md) |
| [ADR-071](../adr/adr-071-proc-vs-perception-boundary.md) | 程序化动作与角色感知边界重构 | [babylon-mmd 适配边界](./mmd-adapter.md) · [动作菜单层级系统](./motion-menu-levels.md) · [眨眼模拟](./perception-blinking.md) · [呼吸模拟](./perception-breathing.md) · [微表情](./perception-expression.md) · [JS 端视线追踪](./perception-gaze-js.md) · [WASM 端视线追踪](./perception-gaze-wasm.md) · [视线追踪主模块](./perception-gaze.md) · [感知口型同步](./perception-lipsync.md) · [感知层共享类型](./perception-shared.md) · [感知层主控](./perception.md) · [场景序列化与自动保存](./scene-serialize.md) · [WASM 图层混合器](./wasm-layers-blender.md) |
| [ADR-072](../adr/adr-072-webxr-plane-detection.md) | AR 平面检测 —— WebXR hit-test + plane detection | [WebXR 能力探测](./ar-webxr-probe.md) |
| [ADR-076](../adr/adr-076-cel-shading-postprocess-mode.md) | 卡通化渲染后处理模式 | [场景渲染管线与后处理](./renderer.md) |
| [ADR-079](../adr/adr-079-perception-layer-expansion.md) | 感知层扩展——always-on 实时叠加的适用边界 | [角色台词生成 — 人设约束 + 情绪解析 + TTS 朗读](./character-bible.md) · [重心微动](./perception-balance.md) |
| [ADR-081](../adr/adr-081-xpbd-removal.md) | XPBD(TS) 测试物理全栈移除与受影响 ADR 审计 | [物理骨骼桥与每帧注册表](./physics-bridge.md) · [虚拟裙骨物理控制器（ADR-084 Phase 2-3）](./virtual-skirt.md) |
| [ADR-084](../adr/adr-084-mesh-to-cloth-virtual-skirt-bones.md) | Mesh-to-Cloth 虚拟裙骨生成 —— WASM Bullet 运行时刚体注入 | [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md) · [裙摆拓扑分析（ADR-084 Phase 1）](./skirt-analyzer.md) · [虚拟裙骨物理控制器（ADR-084 Phase 2-3）](./virtual-skirt.md) |
| [ADR-085](../adr/adr-085-feet-adjustment.md) | 脚部地面跟随（Feet Adjustment） | [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) |
| [ADR-087](../adr/adr-087-plaza-browser-experience.md) | 模型广场 · 浏览器体验增强路线图 | [模型广场浏览器](./plaza-browser.md) · [模型广场创作者列表](./plaza-creators.md) · [广场下载拦截器](./plaza-download.md) · [广场站点配置](./plaza-sites.md) · [广场状态管理](./plaza-state.md) · [模型广场 UI 辅助函数](./plaza-thumbnail.md) |
| [ADR-088](../adr/adr-088-audio-sfx-footstep.md) | 音效系统 — 脚步声与 SFX 总线 | [音频总线](./audio-bus.md) · [脚部落地检测降级](./footstep-detect-fallback.md) · [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) · [脚步声控制器](./motion-footstep.md) |
| [ADR-092](../adr/adr-092-unified-texture-reflection.md) | 贴图与反射统一 —— 单一纹理工厂 + 单一平面反射引擎 | [统一贴图工厂](./env-texture.md) · [统一平面反射引擎](./planar-reflection.md) |
| [ADR-093](../adr/adr-093-menu-declarative-schema.md) | 菜单声明式 Schema —— 单一数据源 + 单渲染器，根治「大」与「AI 难改」 | [AI 助手独立面板入口](./assistant-panel.md) · [声明式菜单 Schema 注册表](./menu-registry.md) · [声明式菜单 Schema 集中注册聚合器](./menu-schema-register.md) · [声明式菜单 Schema](./menu-schema.md) · [菜单渲染引擎](./render-menu.md) · [外观设置](./settings-appearance.md) · [AI 诊断助手面板（协调入口）](./settings-diagnostic.md) |
| [ADR-096](../adr/adr-096-general-helper-consolidation.md) | 通用 Helper 单点收敛 | [VMD 动作加载器](./vmd-loader.md) |
| [ADR-099](../adr/adr-099-mpr-coop-coep-poc.md) | babylon-mmd 未利用 API 接入 · Item 4 MPR 多线程 WASM 物理（Go 端 COOP/COEP 注入 POC） | [安卓网页版文件管理诊断](./android-web-file-management.md) · [Go ZIP 解压与缓存管理](./go-zipextract.md) · [应用启动引导](./init.md) · [运行模式检测](./runtime-mode.md) · [场景核心编排器（纯组装器）](./scene.md) |
| [ADR-100](../adr/adr-100-camera-control-behavior-dual-axis.md) | 相机系统「控制方案 × 运动行为」双轴拆分 | [节拍驱动自动运镜（beatcut）](./camera-auto.md) · [相机状态管理 + 运行时上下文](./camera-state.md) · [相机模式管理系统（MmdCamera）](./camera.md) |
| [ADR-102](../adr/adr-102-main-ts-split.md) | main.ts 拆分（init / events / render-loop / dev-hooks） | [开发环境 E2E 钩子](./dev-hooks.md) · [事件处理与导航系统](./events.md) · [应用启动引导](./init.md) · [渲染循环与 FPS 时钟](./render-loop.md) · [应用快捷键定义](./shortcut-app.md) |
| [ADR-104](../adr/adr-104-physics-outfit-design-debt-deferral.md) | 物理/换装/音频子系统设计债暂缓登记 | [风力物理注入（WASM Bullet）](./wind-physics.md) |
| [ADR-106](../adr/adr-106-timing-audit-and-async-lifecycle.md) | 时序审核与异步生命周期规范 | [环境系统实现核心（barrel + observer + fog）](./env-impl.md) · [环境状态防抖持久化](./env-persist.md) · [轻量响应式刷新系统](./reactivity.md) |
| [ADR-108](../adr/adr-108-animation-retargeter.md) | AnimationRetargeter + HumanoidMmd 接入 — 扩展动作来源 | [外部动作重定向桥](./animation-retargeter.md) · [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-111](../adr/adr-111-scene-env-menu-restructuring.md) | 场景/环境菜单按用户直觉重新划分 | [环境菜单层级系统](./env-menu-levels.md) |
| [ADR-113](../adr/adr-113-horizon-volumetric-clouds.md) | 体积云延展地平线与画质/性能升级 | [云层系统](./env-clouds.md) |
| [ADR-114](../adr/adr-114-ground-reflection-enhancement.md) | 地面反射增强 — 从平面近似到 PBR 材质 | [地面系统](./env-ground.md) · [地形生成器](./env-terrain.md) |
| [ADR-115](../adr/adr-115-stylized-water-glint-research.md) | 风格化水体竞品调研与波光粼粼增强方向 | [共享焦散纹理系统](./env-caustics.md) |
| [ADR-116](../adr/adr-116-bone-override-ui-redesign.md) | 动作覆盖系统 — 模块化架构 + 骨骼覆盖下沉 | [骨骼覆盖核心 API](./bone-override.md) · [共享类型定义](./core-types.md) · [手部独立控制模块（左手/右手）](./hand-symmetry.md) · [模型运行时 ID 解析](./model-id.md) · [模型生命周期操作](./model-ops.md) · [动作模块基类](./motion-module-base.md) · [动作模块类型定义](./motion-module-types.md) · [脚部独立控制模块（左脚/右脚）](./motion-modules-feet.md) · [动作模块注册表](./motion-modules-registry.md) · [动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）](./motion-override-levels.md) · [动作管线（逐帧合成）](./motion-pipeline.md) · [场景序列化与自动保存](./scene-serialize.md) · [场景核心编排器（纯组装器）](./scene.md) |
| [ADR-117](../adr/adr-117-go-error-i18n.md) | Go 端用户可见错误的 i18n 化 | [Go 错误 i18n 信封](./go-i18nerr.md) · [Go 错误翻译](./goerr.md) |
| [ADR-119](../adr/adr-119-thumbnail-key-single-source.md) | 缩略图缓存键单一源治理 | [缩略图缓存 key 推导](./thumbnail-key.md) |
| [ADR-120](../adr/adr-120-env-preset-categorized.md) | 环境预设分类化 — 天空/地面/水面/大气 | [时间流转与太阳角系统](./env-time-of-day.md) |
| [ADR-121](../adr/adr-121-global-motion-intent.md) | 全局动作意图（Scene-level Motion Intent）— 场景级意图 + 每实例继承/覆盖 | [场景级动作意图库](./motion-intent.md) · [场景序列化与自动保存](./scene-serialize.md) · [场景核心编排器（纯组装器）](./scene.md) · [变换适配器注册表（双模态去重）](./transform-adapter.md) |
| [ADR-123](../adr/adr-123-compute-override-semantics.md) | `_computeOverride` 语义正式化 — weight≥1 复合、overrideRotation 标志、absolute 模式 | [骨骼覆盖核心 API](./bone-override.md) · [共享类型定义](./core-types.md) · [动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）](./motion-override-levels.md) |
| [ADR-124](../adr/adr-124-filesystem-architecture.md) | 文件服务架构审计 —— 从 HTTP 中转到 ArrayBuffer 直传 | [PMX 模型加载与缩略图捕获](./model-loader.md) |
| [ADR-125](../adr/adr-125-motion-undo-redo.md) | 动作覆盖撤销/重做 — 模块层 `setParam` 历史栈 | [动作历史管理](./motion-history.md) |
| [ADR-126](../adr/adr-126-transform-adapter.md) | 变换适配器统一（TransformAdapter Registry）— 跨 kind 拖拽/数值双模态去重 | [骨骼覆盖核心 API](./bone-override.md) · [手部独立控制模块（左手/右手）](./hand-symmetry.md) · [舞台灯光系统](./lighting-stage.md) · [镜面道具](./mirror-debug.md) · [模型注册表与生命周期管理](./model-manager.md) · [动作模块基类](./motion-module-base.md) · [动作模块类型定义](./motion-module-types.md) · [动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）](./motion-override-levels.md) · [场景序列化与自动保存](./scene-serialize.md) · [变换适配器注册表（双模态去重）](./transform-adapter.md) · [3D 拖拽 Gizmo 统一抽象](./transform-gizmo.md) |
| [ADR-128](../adr/adr-128-mirror-prop-rename.md) | 镜面道具化重命名（debugMirror → mirror） | [环境系统门面（Facade）](./env.md) · [镜面道具](./mirror-debug.md) |
| [ADR-129](../adr/adr-129-scene-level-motion-ui.md) | 动作菜单场景级重设计（Scene-level Motion UI） | [手部独立控制模块（左手/右手）](./hand-symmetry.md) · [滑出式菜单引擎（SlideMenu）](./menu.md) · [动作绑定 UI](./motion-binding-ui.md) · [脚部独立控制模块（左脚/右脚）](./motion-modules-feet.md) · [动作模块注册表](./motion-modules-registry.md) |
| [ADR-130](../adr/adr-130-scene-ui-roadmap.md) | 场景 UI 整体设计与前后端发展方向路线图 | [性能降级 — 环境桥接](./performance-env-bridge.md) · [预设元数据归一化](./preset-meta.md) · [统一质量档位解析器](./quality-profile.md) · [舞台灯光菜单层级](./scene-stage-lights.md) |
| [ADR-131](../adr/adr-131-resource-browse-selection-outcome.md) | 资源浏览选中结果统一契约（BrowseOutcome） | [资源库操作](./library-actions.md) · [资源库核心](./library-core.md) |
| [ADR-132](../adr/adr-132-env-brightness-unification.md) | 环境亮度统一标量（EnvBrightness Unification） | [环境灯光包装](./env-lighting.md) · [EnvState 单一源 Schema](./env-state-schema.md) · [场景光照与阴影（barrel）](./lighting.md) |
| [ADR-135](../adr/adr-135-library-session-store.md) | LibrarySessionStore — 资源库状态收敛基座 | [资源库操作](./library-actions.md) · [资源库核心](./library-core.md) · [资源库会话状态单例](./library-session-store.md) · [统一资源加载队列](./load-manager.md) |
| [ADR-136](../adr/adr-136-thumbnail-abortsignal.md) | 缩略图流式加载 AbortSignal 协作式取消 | [资源库核心](./library-core.md) |
| [ADR-137](../adr/adr-137-envstate-single-source-schema.md) | EnvState 单一源 Schema | [EnvState 单一源 Schema](./env-state-schema.md) · [全局状态与场景运行时 Store](./state.md) |
| [ADR-138](../adr/adr-138-env-dispatcher-decouple.md) | env-dispatcher 破循环依赖 | [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) · [环境变更分发回调（破循环依赖）](./env-dispatcher.md) · [环境系统实现核心（barrel + observer + fog）](./env-impl.md) · [粒子系统](./env-particles.md) |
| [ADR-140](../adr/adr-140-drag-slider-controller.md) | DragSliderController 统一滑块输入 | [基础行控件构建器](./ui-rows.md) |
| [ADR-141](../adr/adr-141-state-split.md) | state.ts 拆分 — 状态基座重构 | [配置聚合层](./config-barrel.md) · [轻量日志工具（无依赖）](./logger.md) · [全局状态与场景运行时 Store](./state.md) · [UI 持久化状态](./ui-state.md) |
| [ADR-143](../adr/adr-143-unification-remaining.md) | 可统一代码收敛（P1 之外剩余项） | [资源库操作](./library-actions.md) · [UI 与场景常量](./ui-constants.md) |
| [ADR-145](../adr/adr-145-motion-presets.md) | 多模块协同预设 — 一键启用组合姿态 | [共享类型定义](./core-types.md) · [Go 预设持久化与标签](./go-presets.md) · [模型预设管理 UI](./model-preset-ui.md) · [动作模块类型定义](./motion-module-types.md) · [动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）](./motion-override-levels.md) · [动作预设类型](./motion-preset-types.md) · [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-146](../adr/adr-146-function-duplication-triage.md) | 函数级重复摸排与收敛（第二波） | [安全释放工具](./dispose-helpers.md) · [安全调用工具](./safe-call.md) |
| [ADR-147](../adr/adr-147-explicit-motion-pipeline-scheduler.md) | 动作管线显式调度器 + 集中骨骼覆盖状态 | [动作模块 — 身体姿势](./motion-modules-body-posture.md) · [动作管线（逐帧合成）](./motion-pipeline.md) · [WASM 图层混合器](./wasm-layers-blender.md) |
| [ADR-148](../adr/adr-148-overload-file-split.md) | 过载文件拆分工程 | [节拍驱动自动运镜（beatcut）](./camera-auto.md) · [相机行为循环（freefly/surround/concert）](./camera-behaviors.md) · [相机骨骼锁定](./camera-bone-lock.md) · [相机工厂 + 用户输入](./camera-factory.md) · [相机状态管理 + 运行时上下文](./camera-state.md) · [相机 VMD 动画](./camera-vmd.md) · [相机模式管理系统（MmdCamera）](./camera.md) · [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) · [环境重力控制](./env-gravity.md) · [环境状态防抖持久化](./env-persist.md) · [时间流转与太阳角系统](./env-time-of-day.md) |
| [ADR-150](../adr/adr-150-model-replace-contract.md) | 模型替换原子操作契约（Model Replace Contract） | [资源库操作](./library-actions.md) · [模型运行时 ID 解析](./model-id.md) · [模型生命周期操作](./model-ops.md) |
| [ADR-151](../adr/adr-151-reflection-unified-architecture.md) | 反射系统统一架构（SSR/Probe 统一入口 + Planar 协调） | [反射系统](./env-reflection.md) |
| [ADR-152](../adr/adr-152-stage-light-cone.md) | 舞台灯光光锥（Light Cone） | [反射系统](./env-reflection.md) · [光锥网格](./light-cone.md) · [舞台灯光系统](./lighting-stage.md) · [舞台灯光菜单层级](./scene-stage-lights.md) |
| [ADR-153](../adr/adr-153-accessibility-roadmap.md) | 无障碍（a11y）支持总体方案 | [跨平台对话框](./dialog.md) · [Go 后端核心（App 生命周期 + 配置系统）](./go-app.md) · [应用启动引导](./init.md) · [状态栏与提示系统](./status-bar.md) · [焦点陷阱工具](./ui-focus-trap.md) · [键盘导航工具](./ui-keyboard-nav.md) · [菜单导航项契约](./ui-nav-item.md) |
| [ADR-155](../adr/adr-155-llm-nl-scene-control-route.md) | 自然语言控场景 — 叠加于 AiService 管线之上 | [统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md) · [NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) · [诊断助手 → tool call 控制（子模块）](./diagnostic-control.md) · [环境弹窗（编排 + barrel）](./env-menu.md) · [资源库操作](./library-actions.md) · [场景弹窗（编排 + 路由）](./scene-menu.md) |
| [ADR-156](../adr/adr-156-llm-character-dialogue-route.md) | 大模型交流 — 创意路线（角色台词生成） | [角色台词生成 — 人设约束 + 情绪解析 + TTS 朗读](./character-bible.md) |
| [ADR-157](../adr/adr-157-settings-ia-restructure.md) | 设置界面信息架构重组 — 10 分类 → 7 分类 | [设置 — 关于页面](./settings-about.md) · [设置动作映射表](./settings-actions.md) · [外观设置](./settings-appearance.md) · [设置 — 操控页面](./settings-controls.md) · [设置 — 画面页面](./settings-graphics.md) · [语言设置](./settings-language.md) · [设置 — 媒体页面](./settings-media.md) · [设置 — 资源页面](./settings-resources.md) · [设置共享工具](./settings-shared.md) · [设置 — 系统页面](./settings-system.md) · [设置目标常量](./settings-targets.md) · [设置页路由与编排](./settings.md) |
| [ADR-159](../adr/adr-159-render-dedup-and-refactor.md) | 渲染模块重复收口 + 关键补测 + 两项结构性重构决策 | [灯光模块状态对象](./lighting-state.md) · [性能监控与自动降级](./performance.md) |
| [ADR-160](../adr/adr-160-gaze-delta-exponential-decay.md) | Gaze Delta 指数衰减 — 闭环「左右脑互博」物理根因最后一环 | [粒子系统](./env-particles.md) |
| [ADR-161](../adr/adr-161-balancesway-params-exposure.md) | balanceSway 独立参数暴露 — 补齐感知层 UI 可调性 | [重心微动](./perception-balance.md) |
| [ADR-162](../adr/adr-162-perception-permodel-phase1.md) | 感知层 per-model 实例化 — Phase 1（pinned 模型支持） | [眨眼模拟](./perception-blinking.md) · [呼吸模拟](./perception-breathing.md) · [微表情](./perception-expression.md) · [JS 端视线追踪](./perception-gaze-js.md) · [WASM 端视线追踪](./perception-gaze-wasm.md) · [视线追踪主模块](./perception-gaze.md) · [感知口型同步](./perception-lipsync.md) · [感知观察者（感知层）](./perception-observer.md) · [感知层共享类型](./perception-shared.md) · [感知层主控](./perception.md) · [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-164](../adr/adr-164-perception-permodel-phase2.md) | 感知层 per-model 实例化 — Phase 2（全员感知 + 性能降级） | [重心微动](./perception-balance.md) · [场景序列化与自动保存](./scene-serialize.md) · [场景核心编排器（纯组装器）](./scene.md) |
| [ADR-166](../adr/adr-166-perception-permodel-rework.md) | 感知层 per-model 上下文真实隔离（ADR-162/163 返工） | [动作模块注册表](./motion-modules-registry.md) · [视线追踪主模块](./perception-gaze.md) · [感知口型同步](./perception-lipsync.md) · [感知观察者（感知层）](./perception-observer.md) · [感知层主控](./perception.md) · [场景存档迁移（纯函数）](./scene-migrate.md) |
| [ADR-167](../adr/adr-167-scene-motion-library.md) | 场景级动作库（Scene Motion Library）— 多主动作平等共存 | [共享类型定义](./core-types.md) · [PMX 模型加载与缩略图捕获](./model-loader.md) · [模型生命周期操作](./model-ops.md) · [动作绑定 UI](./motion-binding-ui.md) · [动作详情 UI](./motion-detail-ui.md) · [场景级动作意图库](./motion-intent.md) · [场景序列化与自动保存](./scene-serialize.md) · [VMD 动作加载器](./vmd-loader.md) |
| [ADR-168](../adr/adr-168-dynamic-light-tracking.md) | 动态追光：舞台灯跟随角色/骨骼 | [个人灯光跟随](./lighting-follow.md) · [灯光预设系统](./lighting-presets.md) · [场景光照与阴影（barrel）](./lighting.md) · [模型生命周期操作](./model-ops.md) · [场景序列化与自动保存](./scene-serialize.md) · [场景核心编排器（纯组装器）](./scene.md) |
| [ADR-169](../adr/adr-169-motion-load-replace-default.md) | 动作装载语义统一 —— 原位替换默认动作（replaceDefaultMotion） | [资源库操作](./library-actions.md) · [VMD 动作加载器](./vmd-loader.md) |
| [ADR-170](../adr/adr-170-motion-selection-paradigm.md) | 动作库选中范式 —— 将「默认」暴露为逐行「选中」（对齐模型焦点范式） | [动作详情 UI](./motion-detail-ui.md) |
| [ADR-171](../adr/adr-171-scene-drag-mode.md) | 场景级拖拽模式：快捷开关 + 收纳文件夹 | [场景拖拽层级菜单](./scene-drag-levels.md) · [场景菜单层级系统](./scene-menu-levels.md) · [场景核心编排器（纯组装器）](./scene.md) · [变换选中物状态源](./transform-selection.md) |
| [ADR-172](../adr/adr-172-wet-body-effect.md) | 湿身效果：雨天角色材质湿润感 | [湿身效果系统](./env-wetness.md) |
| [ADR-173](../adr/adr-173-env-bridge-middleware.md) | env-bridge setEnvState 中间件化重构 | [时间流转与太阳角系统](./env-time-of-day.md) · [基础行控件构建器](./ui-rows.md) |
| [ADR-174](../adr/adr-174-quality-dimension-registry.md) | 质量维度注册表 — 统一 qualityProfile 扩展点 | [统一质量档位解析器](./quality-profile.md) |
| [ADR-176](../adr/adr-176-frontend-backend-adapter.md) | 前端 Backend 适配器双实现（Web/Desktop 通杀） | [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) · [安卓网页版文件管理诊断](./android-web-file-management.md) · [后端适配层](./core-backend.md) · [环境状态防抖持久化](./env-persist.md) · [时间流转与太阳角系统](./env-time-of-day.md) · [应用启动引导](./init.md) · [平台能力探测](./platform.md) · [运行模式检测](./runtime-mode.md) · [后端绑定聚合层（backend 代理化）](./wails-bindings.md) |
| [ADR-177](../adr/adr-177-web-loader-main-app-unification.md) | Web Loader 与主应用统一路径 | [安卓网页版文件管理诊断](./android-web-file-management.md) · [拖拽导入逻辑层](./drop-import.md) · [应用启动引导](./init.md) · [Runtime 隔离桥（Wails Events/Browser）](./runtime-bridge.md) |
| [ADR-178](../adr/adr-178-capability-matrix-host-keys.md) | 能力矩阵补全宿主级键（四端统一收口） | [安卓网页版文件管理诊断](./android-web-file-management.md) |
| [ADR-179](../adr/adr-179-update-install-launch-platform-tiered.md) | 更新安装拉起（按平台分级） | [事件处理与导航系统](./events.md) · [Go 更新检查与安装](./go-update.md) · [应用启动引导](./init.md) |
| [ADR-180](../adr/adr-180-fsa-handle-persistence.md) | Web 资源库 FSA 句柄持久化与启动自动重扫 | [安卓文件访问（shared 模式）](./android-file-access.md) · [安卓网页版文件管理诊断](./android-web-file-management.md) · [资源库初始化](./library-setup.md) |
| [ADR-182](../adr/adr-182-web-zip-keyspace-namespacing.md) | 网页端 ZIP 导入键规约命名空间化（消除同名 PMX 纹理碰撞） | [资源库操作](./library-actions.md) · [PMX 模型加载与缩略图捕获](./model-loader.md) |
| [ADR-183](../adr/adr-183-fsa-auth-guidance.md) | 网页端 FSA 根目录授权引导（四态探针 + 重授权兜底） | [安卓文件访问（shared 模式）](./android-file-access.md) · [安卓网页版文件管理诊断](./android-web-file-management.md) · [资源库初始化](./library-setup.md) |
| [ADR-186](../adr/adr-186-bone-override-frame-timing.md) | bone-override 帧内时序图 | [骨骼覆盖核心 API](./bone-override.md) · [动作覆盖 UI 层级（模块化覆盖 + 高级骨骼覆盖）](./motion-override-levels.md) |
| [ADR-188](../adr/adr-188-pbr-material-builder.md) | PBRMaterialBuilder 材质系统迁移 — PBR 渲染升级 | [分类材质系统](./material.md) |
| [ADR-189](../adr/adr-189-ktx2-texture-compression.md) | 纹理加载路径优化（并行读取 + basename 共享 + LRU + KTX2 基础设施） | [Go 模型库扫描](./go-library.md) · [GPU 压缩纹理能力探测](./gpu-capabilities.md) · [PMX 模型加载与缩略图捕获](./model-loader.md) · [PMX 声明纹理缺失审计](./pmx-texture-audit.md) · [场景渲染管线与后处理](./renderer.md) · [场景核心编排器（纯组装器）](./scene.md) · [纹理路径 fallback 候选生成](./texture-fallback.md) · [纹理 LRU 缓存](./texture-lru.md) |
| [ADR-190](../adr/adr-190-capability-declarative-consolidation.md) | 端能力声明式收口（淘汰散落 isAndroidPlatform 分支） | [核心零依赖叶模块](./core-leaf-modules.md) |
| [ADR-191](../adr/adr-191-god-barrel-debarreling.md) | 神桶 `@/core/utils` 去桶化（零依赖叶下沉） | [核心零依赖叶模块](./core-leaf-modules.md) · [工具函数叶模块群](./core-utils.md) · [菜单 Overlay 与 Wrapper 管理](./menu-overlay.md) · [菜单栈共享指针（stackRegistry）](./menu-stack-registry.md) · [菜单渲染上下文栈（RenderContext）](./render-context.md) · [标题栏小型开关（createHeaderToggle）](./ui-header-toggle.md) · [基础行控件构建器](./ui-rows.md) |
| [ADR-192](../adr/adr-192-upstream-adapter-layer.md) | 上游适配层重构（MmdAdapter） | [地面碰撞体（WASM Bullet 静态刚体）](./ground-collision.md) · [场景光照与阴影（barrel）](./lighting.md) · [babylon-mmd 适配边界](./mmd-adapter.md) · [VMD 动作加载器](./vmd-loader.md) · [风力物理注入（WASM Bullet）](./wind-physics.md) |
| [ADR-194](../adr/adr-194-wind-physics-fix.md) | 风物理系统修复 — 从「假风」到真实风场 | [安卓文件访问（shared 模式）](./android-file-access.md) · [安卓网页版文件管理诊断](./android-web-file-management.md) · [风力物理注入（WASM Bullet）](./wind-physics.md) |
| [ADR-195](../adr/adr-195-download-folder-unification.md) | 下载文件夹统一修订（三平台系统下载目录 + 消除"二扫"） | [Go 文件与路径平台抽象](./go-fileaccess.md) · [资源库操作](./library-actions.md) · [资源库核心](./library-core.md) |
| [ADR-196](../adr/adr-196-llm-diagnostic-assistant.md) | 内置 AI 诊断助手（LLM Diagnostic Assistant） | [AI 配置持久化（IndexedDB）](./ai-config-store.md) · [错误环形缓冲与全局捕获](./ai-error-buffer.md) · [场景运行时快照（AI 上下文）](./ai-scene-snapshot.md) · [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) · [SSE 流式解析器](./ai-sse.md) · [角色台词生成 — 人设约束 + 情绪解析 + TTS 朗读](./character-bible.md) · [诊断用动作注册](./diagnostic-actions.md) · [诊断助手 → 聊天 UI（子模块）](./diagnostic-chat.md) · [诊断助手 → 配置 UI（子模块）](./diagnostic-config.md) · [诊断助手 → 单例状态（子模块）](./diagnostic-state.md) · [应用启动引导](./init.md) · [轻量 Markdown→DOM 渲染器](./markdown.md) · [场景核心编排器（纯组装器）](./scene.md) · [AI 诊断助手面板（协调入口）](./settings-diagnostic.md) |
| [ADR-197](../adr/adr-197-unified-action-registry.md) | 统一动作注册表 — 菜单可维护性归一化 | [统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md) · [NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) · [诊断用动作注册](./diagnostic-actions.md) · [诊断助手 → tool call 控制（子模块）](./diagnostic-control.md) |
| [ADR-198](../adr/adr-198-场景序列化异常的保存韧性.md) | 场景序列化异常的保存韧性 | [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-202](../adr/adr-202-fork-autonomy-batch.md) | fork 自治改动批次 — 一次回灌批量根治可改 fork 的上游缺口 | [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) · [场景核心编排器（纯组装器）](./scene.md) |
| [ADR-203](../adr/adr-203-ai-assistant-sessions-and-panel.md) | AI 助手会话持久化与独立面板 | [AI 助手独立面板入口](./assistant-panel.md) · [AI 会话 IndexedDB 存储](./chat-store.md) · [诊断助手 → 聊天 UI（子模块）](./diagnostic-chat.md) · [诊断助手 → 配置 UI（子模块）](./diagnostic-config.md) · [诊断助手 → tool call 控制（子模块）](./diagnostic-control.md) · [诊断助手 → 会话管理（子模块）](./diagnostic-session.md) · [诊断助手 → 单例状态（子模块）](./diagnostic-state.md) · [AI 诊断助手面板（协调入口）](./settings-diagnostic.md) |
| [ADR-204](../adr/adr-204-unit-test-layering-and-hygiene.md) | 单测分层与治理规范（拆上帝文件 · 降 mock 密度 · fixtures 复用 · unit/integration 分层） | [时间流转与太阳角系统](./env-time-of-day.md) · [动作播放控制](./motion-playback.md) · [设置共享工具](./settings-shared.md) |
| [ADR-206](../adr/adr-206-test-infra-consolidation-and-assertion-quality.md) | 测试基础设施收敛与断言质量治理 | [后端适配层](./core-backend.md) |
| [ADR-207](../adr/adr-207-motion-menu-restructure.md) | 动作菜单重构 —— 程序化动作可加载化 + 双面板对称 | [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-212](../adr/adr-212-naming-vs-functionality-audit.md) | 命名 vs 翻译 vs 实际功能错位系统审计与治理 | [环境碰撞控制](./env-collision.md) · [环境重力控制](./env-gravity.md) · [确定性哈希与值噪声](./hash-noise.md) |
| [ADR-215](../adr/adr-215-eliminate-prop-kind.md) | 取消「道具」资源类型 — 模型附属关系替代 prop + accessory 体系 | [模型注册表与生命周期管理](./model-manager.md) · [场景序列化与自动保存](./scene-serialize.md) |
| [ADR-226](../adr/adr-226-ground-material-spec-single-source.md) | 地面材质单一事实源重构（GroundMaterialSpec） | [地面材质单一事实源（GroundMaterialSpec）](./env-ground-spec.md) · [地面系统](./env-ground.md) · [地形生成器](./env-terrain.md) |
| [ADR-229](../adr/adr-229-e2e-automation-advancement.md) | E2E 自动化推进 —— 从 schema 到测试零映射 | [渲染层 DOM 契约单源](./dom-contract.md) |
| [ADR-230](../adr/adr-230-docs-automation-toolchain.md) | 文档自动化工具链决策 —— 从手写索引到机器守护的完整闭环 | [Go 后端核心（App 生命周期 + 配置系统）](./go-app.md) |
| [ADR-231](../adr/adr-231-ground-visual-roadmap.md) | 地面视觉后续方向（自发光地屏 + 程序化地面图案） | [地形生成器](./env-terrain.md) |
| [ADR-237](../adr/adr-237-split-overlong-modules.md) | 超限模块拆分计划 —— 250LOC 天花板的优先级拆解路线图 | [程序化动作系统](./proc-motion-bridge.md) · [多 VMD 叠加系统](./vmd-layers.md) |
| [ADR-238](../adr/adr-238-循环依赖消解二期-core-scene-根环.md) | 循环依赖消解第二期 —— core→scene 根环与 motion/outfit 互依赖拆解 | [E2E 状态读取器注入桥](./e2e-state-bridge.md) · [环境状态防抖持久化](./env-persist.md) · [时间流转与太阳角系统](./env-time-of-day.md) · [资源库核心](./library-core.md) · [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) · [场景动作注入桥](./scene-action-bridge.md) · [设置共享工具](./settings-shared.md) · [主题纯函数叶](./theme.md) · [UI 行为注入桥](./ui-action-bridge.md) · [VMD 动作加载器](./vmd-loader.md) |
| [ADR-242](../adr/adr-242-toplevel-layering-axiom.md) | 顶层目录分层公理 —— 「纯算法层」假说的证伪与重定性 | [换装叠加层](./outfit-overlay.md) · [换装系统](./outfit.md) |
| [ADR-243](../adr/adr-243-env-state-defaults-from-schema.md) | EnvState 默认值从 Schema 自动推导 —— 消除 100+ 字段双源手工映射 | [EnvState 默认值派生](./env-state-defaults.md) |

## 索引与路由（非卡片）

- [知识卡关联图](./graph.md)
- [菜单层级地图（自动生成）](./menu-map.md)
- [知识卡层（Knowledge Cards）](./README.md)
- [AI 知识库路由表](./routes.md)
- [知识卡 tier 标注复核队列（ADR-218 P3）](./tier-review.md)
