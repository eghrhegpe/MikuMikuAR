# AI 知识库路由表

本表把用户的自然语言意图映射到首张知识卡。AI 应先命中首选卡，再沿卡片的 `source_files`、API 和子系统关系继续追踪；不要直接扫描整个 `frontend/src/`。

## 路由规则

| 用户意图或关键词 | 首选知识卡 | 其次阅读 |
|---|---|---|
| 环境初始化、环境切换、雾、observer、scene tick、环境销毁 | [env.md](./env.md)、[env-impl.md](./env-impl.md) | [env-context.md](./env-context.md)、[env-dispatcher.md](./env-dispatcher.md)、[observer-handle.md](./observer-handle.md) |
| 天空、地面、地形、湿身、反射、水面、云 | [env-sky.md](./env-sky.md)、[env-ground.md](./env-ground.md)、[env-wetness.md](./env-wetness.md)、[planar-reflection.md](./planar-reflection.md) | [env-texture.md](./env-texture.md)、[env-state-schema.md](./env-state-schema.md) |
| 灯光、太阳、阴影、跟随灯、灯光渐变 | [lighting.md](./lighting.md)、[lighting-state.md](./lighting-state.md) | [lighting-sun.md](./lighting-sun.md)、[lighting-shadow.md](./lighting-shadow.md)、[lighting-tween.md](./lighting-tween.md) |
| 模型加载、模型管理、模型替换、模型操作 | [model-loader.md](./model-loader.md)、[model-manager.md](./model-manager.md)、[model-ops.md](./model-ops.md) | [model-detail.md](./model-detail.md)、[scene.md](./scene.md) |
| 拖拽、Gizmo、变换 | [transform-mode.md](./transform-mode.md)、[transform-adapter.md](./transform-adapter.md) | [transform-gizmo.md](./transform-gizmo.md)、[transform-pick.md](./transform-pick.md) |
| 动作、骨骼、绑定、逐帧合成、物理裙摆 | [motion-pipeline.md](./motion-pipeline.md)、[bone-override-store.md](./bone-override-store.md) | [motion-binding-ui.md](./motion-binding-ui.md)、[virtual-skirt.md](./virtual-skirt.md)、[wind-physics.md](./wind-physics.md) |
| 个人灯光、跟随灯 | [lighting-follow.md](./lighting-follow.md) | [lighting-state.md](./lighting-state.md)、[light-cone.md](./light-cone.md) |
| 水印、截图、缩略图 | [watermark.md](./watermark.md)、[thumbnail-capture.md](./thumbnail-capture.md) | [thumbnail-key.md](./thumbnail-key.md) |
| 换装、outfit、配饰 | [outfit-ui.md](./outfit-ui.md) | [props.md](./props.md)、[accessory.md](./accessory.md) |
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
| 资源库、浏览、会话、预设、缩略图 | [library.md](./library.md)、[library-browse.md](./library-browse.md) | [library-session-store.md](./library-session-store.md)、[preset-manager.md](./preset-manager.md)、[thumbnail-key.md](./thumbnail-key.md) |
| 自然语言控场、NL 动作、动作注册、快捷键动作 | [action-registry.md](./action-registry.md)、[ai-intent-dispatcher.md](./ai-intent-dispatcher.md) | [ai-service.md](./ai-service.md)、[settings-diagnostic.md](./settings-diagnostic.md) |
| 角色台词、大模型交流、人设、情绪、台词朗读 TTS | [character-bible.md](./character-bible.md) | [ai-service.md](./ai-service.md)、[lipsync-bridge.md](./lipsync-bridge.md) |

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
