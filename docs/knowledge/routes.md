# AI 知识库路由表

本表把用户的自然语言意图映射到首张知识卡。AI 应先命中首选卡，再沿卡片的 `source_files`、API 和子系统关系继续追踪；不要直接扫描整个 `frontend/src/`。

## 路由规则

| 用户意图或关键词 | 首选知识卡 | 其次阅读 |
|---|---|---|
| 环境初始化、环境切换、雾、observer、scene tick、环境销毁 | [env.md](./env.md)、[env-impl.md](./env-impl.md) | [env-context.md](./env-context.md)、[env-dispatcher.md](./env-dispatcher.md)、[observer-handle.md](./observer-handle.md) |
| 天空、地面、地形、湿身、反射、水面、云、水面设置 | [env-sky.md](./env-sky.md)、[env-ground.md](./env-ground.md)、[env-wetness.md](./env-wetness.md)、[planar-reflection.md](./planar-reflection.md)、[env-water.md](./env-water.md) | [env-texture.md](./env-texture.md)、[env-state-schema.md](./env-state-schema.md) |
| 灯光、太阳、阴影、跟随灯、灯光渐变 | [lighting.md](./lighting.md)、[lighting-state.md](./lighting-state.md) | [lighting-sun.md](./lighting-sun.md)、[lighting-shadow.md](./lighting-shadow.md)、[lighting-tween.md](./lighting-tween.md) |
| 模型加载、模型管理、模型替换、模型操作 | [model-loader.md](./model-loader.md)、[model-manager.md](./model-manager.md)、[model-ops.md](./model-ops.md) | [model-detail.md](./model-detail.md)、[scene.md](./scene.md) |
| 拖拽、Gizmo、变换 | [transform-mode.md](./transform-mode.md)、[transform-adapter.md](./transform-adapter.md) | [transform-gizmo.md](./transform-gizmo.md)、[transform-pick.md](./transform-pick.md) |
| 动作、骨骼、绑定、逐帧合成、物理裙摆、动作菜单层级 | [motion-pipeline.md](./motion-pipeline.md)、[bone-override-store.md](./bone-override-store.md)、[motion-menu-levels.md](./motion-menu-levels.md) | [motion-binding-ui.md](./motion-binding-ui.md)、[virtual-skirt.md](./virtual-skirt.md)、[wind-physics.md](./wind-physics.md) |
| 个人灯光、跟随灯 | [lighting-follow.md](./lighting-follow.md) | [lighting-state.md](./lighting-state.md)、[light-cone.md](./light-cone.md) |
| 水印、截图、缩略图 | [watermark.md](./watermark.md)、[thumbnail-capture.md](./thumbnail-capture.md) | [thumbnail-key.md](./thumbnail-key.md) |
| 换装、outfit、配饰 | [outfit-ui.md](./outfit-ui.md) | [model-detail.md](./model-detail.md) |
| 世界矩阵、骨骼矩阵、坐标系转换 | [mmd-adapter.md](./mmd-adapter.md)、[physics-bridge.md](./physics-bridge.md) | [core-orbit.md](./core-orbit.md)、[env-type-helpers.md](./env-type-helpers.md) |
| 撤销、undo、redo、回退 | [scene-serialize.md](./scene-serialize.md)、[motion-history.md](./motion-history.md) | [action-registry.md](./action-registry.md)（scene:undo 动作） |
| 场景保存、加载、迁移、序列化、场景菜单 | [scene.md](./scene.md)、[scene-serialize.md](./scene-serialize.md) | [scene-bundle.md](./scene-bundle.md)、[scene-migrate.md](./scene-migrate.md)、[scene-menu.md](./scene-menu.md) |
| 快捷键、按键绑定、快捷键编辑 | [settings-controls.md](./settings-controls.md) | [shortcut-app.md](./shortcut-app.md)、[shortcut-registry.md](./shortcut-registry.md) |
| 表演、auto dance、程序化动作、节拍联动 | [proc-motion-bridge.md](./proc-motion-bridge.md) | [motion-pipeline.md](./motion-pipeline.md)、[motion-modules-registry.md](./motion-modules-registry.md) |
| 菜单、设置、按钮、滑块、键盘导航、焦点 | [menu.md](./menu.md)、[menu-schema.md](./menu-schema.md) | [settings.md](./settings.md)、[ui-slider-controller.md](./ui-slider-controller.md)、[ui-keyboard-nav.md](./ui-keyboard-nav.md)、[ui-focus-trap.md](./ui-focus-trap.md) |
| 全局状态、响应式、UI 持久化、环境状态 | [state.md](./state.md)、[env-state-schema.md](./env-state-schema.md) | [reactivity.md](./reactivity.md)、[ui-state.md](./ui-state.md) |
| Wails、运行时桥、绑定、Go 错误、后端调用 | [runtime-bridge.md](./runtime-bridge.md)、[wails-bindings.md](./wails-bindings.md) | [goerr.md](./goerr.md)、[safe-call.md](./safe-call.md) |
| Android、Web、平台判断、外部链接、桌面应用能力 | [platform.md](./platform.md) | [runtime-bridge.md](./runtime-bridge.md)、[wails-bindings.md](./wails-bindings.md) |
| 模型/动作/道具/音频加载、队列、取消、loadId | [load-manager.md](./load-manager.md) | [library.md](./library.md)、[model-loader.md](./model-loader.md) |
| 确认框、输入框、错误详情、Android prompt | [dialog.md](./dialog.md) | [ui-focus-trap.md](./ui-focus-trap.md)、[goerr.md](./goerr.md) |
| Toast、错误提示、复制详情、撤销按钮 | [toast.md](./toast.md) | [status-bar.md](./status-bar.md)、[goerr.md](./goerr.md) |
| 状态栏、HUD、FPS、鼠标提示、加载反馈 | [status-bar.md](./status-bar.md) | [ui-state.md](./ui-state.md)、[ui-keyboard-nav.md](./ui-keyboard-nav.md) |
| 性能、渲染循环、FPS、质量档位、资源释放 | [performance.md](./performance.md)、[render-loop.md](./render-loop.md)、[dispose-helpers.md](./dispose-helpers.md) | [quality-profile.md](./quality-profile.md)、[renderer.md](./renderer.md) |
| 资源库、浏览、会话、预设、缩略图 | [library.md](./library.md)、[library-browse.md](./library-browse.md) | [library-session-store.md](./library-session-store.md)、[preset-meta.md](./preset-meta.md)、[thumbnail-key.md](./thumbnail-key.md) |
| 自然语言控场、NL 动作、动作注册、快捷键动作 | [action-registry.md](./action-registry.md)、[ai-intent-dispatcher.md](./ai-intent-dispatcher.md) | [ai-service.md](./ai-service.md)、[settings-diagnostic.md](./settings-diagnostic.md) |
| 角色台词、大模型交流、人设、情绪、台词朗读 TTS | [character-bible.md](./character-bible.md) | [ai-service.md](./ai-service.md)、[lipsync-bridge.md](./lipsync-bridge.md) |
| 相机、相机模式、轨道、自由飞行、镜头、视角 | [camera.md](./camera.md)、[camera-state.md](./camera-state.md) | [orbit-state.md](./orbit-state.md)、[camera-factory.md](./camera-factory.md)、[camera-behaviors.md](./camera-behaviors.md) |
| 相机行为、自动运镜、VMD 相机、环绕、演唱会运镜 | [camera-behaviors.md](./camera-behaviors.md)、[camera-auto.md](./camera-auto.md) | [camera-vmd.md](./camera-vmd.md)、[camera-bone-lock.md](./camera-bone-lock.md) |
| 感知、视线、眨眼、呼吸、表情、口型、活人感 | [perception.md](./perception.md) | [perception-gaze.md](./perception-gaze.md)、[perception-blinking.md](./perception-blinking.md)、[perception-lipsync.md](./perception-lipsync.md) |
| VMD 动作加载、图层、动作播放、动作详情 | [vmd-loader.md](./vmd-loader.md)、[vmd-layers.md](./vmd-layers.md) | [motion-playback.md](./motion-playback.md)、[motion-detail-ui.md](./motion-detail-ui.md) |
| 动作意图、动作绑定、脚部跟随、动作重定向 | [motion-intent.md](./motion-intent.md)、[animation-retargeter.md](./animation-retargeter.md) | [motion-feet-adjustment.md](./motion-feet-adjustment.md)、[motion-module-base.md](./motion-module-base.md)、[bone-override.md](./bone-override.md) |
| 材质、贴图、材质调整、材质编辑器 | [material.md](./material.md) | [model-preset-ui.md](./model-preset-ui.md)、[model-material-ui.md](./model-material-ui.md) |
| 音频、音乐、声音、音频总线 | [audio-bus.md](./audio-bus.md) | [motion-playback.md](./motion-playback.md)、[lipsync-bridge.md](./lipsync-bridge.md) |
| AI 配置、端点、错误缓冲、场景快照 | [ai-config-store.md](./ai-config-store.md)、[ai-error-buffer.md](./ai-error-buffer.md) | [ai-scene-snapshot.md](./ai-scene-snapshot.md)、[ai-service.md](./ai-service.md) |
| AR、摄像头、WebXR、增强现实 | [ar-camera.md](./ar-camera.md)、[ar-scene.md](./ar-scene.md) | [ar-webxr-probe.md](./ar-webxr-probe.md)、[camera.md](./camera.md) |
| 文件服务、文件读写、路径、文件系统 | [fileservice.md](./fileservice.md) | [core-backend.md](./core-backend.md)、[android-file-access.md](./android-file-access.md) |
| 事件、导航、全局反馈、启动初始化 | [events.md](./events.md)、[init.md](./init.md) | [feedback.md](./feedback.md)、[runtime-mode.md](./runtime-mode.md)、[core-backend.md](./core-backend.md) |
| 环境持久化、时间流转、太阳角、环境重力 | [env-persist.md](./env-persist.md)、[env-time-of-day.md](./env-time-of-day.md) | [env-gravity.md](./env-gravity.md)、[env-collision.md](./env-collision.md)、[env-lighting.md](./env-lighting.md) |
| 环境菜单、环境弹窗、灯光预设 | [env-menu.md](./env-menu.md)、[env-lighting.md](./env-lighting.md) | [lighting-presets.md](./lighting-presets.md)、[env-bridge.md](./env-bridge.md) |
| 资源库操作、库扫描、加载刷新 | [library-actions.md](./library-actions.md)、[library-core.md](./library-core.md) | [library-setup.md](./library-setup.md)、[load-refresh-registry.md](./load-refresh-registry.md) |
| 菜单 overlay、菜单栈、菜单渲染、菜单地图 | [menu-overlay.md](./menu-overlay.md)、[menu-stack-registry.md](./menu-stack-registry.md) | [render-menu.md](./render-menu.md)、[menu-map.md](./menu-map.md) |
| 模型预设、模型工具、模型保存 | [model-preset-ui.md](./model-preset-ui.md) | [model-detail.md](./model-detail.md)、[library-session-store.md](./library-session-store.md) |
| 模型广场、plaza、广场下载 | [plaza-state.md](./plaza-state.md) | [plaza-browser.md](./plaza-browser.md)、[plaza-sites.md](./plaza-sites.md)、[plaza-download.md](./plaza-download.md) |
| 语言、locale、i18n、翻译 | [locale.md](./locale.md) | [zh-CN.md](./zh-CN.md)、[zh-TW.md](./zh-TW.md)、[ui-preset.md](./ui-preset.md) |
| GPU 能力、压缩纹理、能力探测 | [gpu-capabilities.md](./gpu-capabilities.md) | [core-backend.md](./core-backend.md)、[renderer.md](./renderer.md) |
| 设置共享、设置动作、设置持久化 | [settings-shared.md](./settings-shared.md)、[settings-actions.md](./settings-actions.md) | [settings.md](./settings.md)、[ui-state.md](./ui-state.md) |
| 变换选择、选中状态、拾取元数据 | [transform-selection.md](./transform-selection.md) | [transform-pick.md](./transform-pick.md)、[transform-mode.md](./transform-mode.md) |
| 拖拽导入、drop、文件拖入 | [drop-import.md](./drop-import.md) | [library-actions.md](./library-actions.md)、[fileservice.md](./fileservice.md) |
| 配置 barrel、工具函数、core 叶子模块 | [core-leaf-modules.md](./core-leaf-modules.md)、[config-barrel.md](./config-barrel.md) | [core-utils.md](./core-utils.md)、[core-dom.md](./core-dom.md)、[core-types.md](./core-types.md) |
| 图标、图标 bundle、icon 加载 | [icons-bundle.md](./icons-bundle.md) | [core-utils.md](./core-utils.md)、[ui-constants.md](./ui-constants.md) |

## 标准执行模板

```text
先按 docs/knowledge/routes.md 判断首选知识卡。
读取 docs/knowledge/README.md 和首选卡片，再按 source_files 阅读源码。
grep docs/adr/ 查找相关决策和状态，检查 symbols、invariants、tests、use_when。
以源码为最终事实来源；如果卡片过时，先报告漂移，再决定是否同步更新。
修改后运行最小相关测试和 npm run check:docs。
```

## 维护规则

- 路由表只负责“第一跳”，不复制知识卡正文；模块细节放在对应卡片。
- 首选卡片被删除或重命名时，必须同步修正本表并运行 `npm run check:docs`。
- 新增高频模块或用户反复搜不到的模块，优先增加一条路由，而不是继续堆长篇说明。
