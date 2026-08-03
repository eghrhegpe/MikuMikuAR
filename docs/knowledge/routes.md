<!-- 本文件由 scripts/gen-routes.mjs 自动生成，请勿手改。重跑：npm run gen:routes -->

# AI 知识库路由表

本表把用户的自然语言意图映射到首张知识卡。AI 应先命中首选卡，再沿卡片的 `source_files`、API 和子系统关系继续追踪；不要直接扫描整个 `frontend/src/`。

> 由 `scripts/gen-routes.mjs` 自动生成：首选卡按卡片 `use_when` 关键词命中，其次阅读为共享 ADR 的关联卡。

## 路由规则

| 用户意图或关键词 | 首选知识卡 | 其次阅读 |
|---|---|---|
| 动作注册、NL 控场、自然语言控制、动作执行器、工具 catalog、参数适配器、action registry | [统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md) | [NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md)、[环境弹窗（编排 + barrel）](./env-menu.md)、[资源库操作](./library-actions.md) |
| AI 配置、loadAiConfig / saveAiConfig、Ollama 端点 | [AI 配置持久化（IndexedDB）](./ai-config-store.md) | [错误环形缓冲与全局捕获](./ai-error-buffer.md)、[场景运行时快照（AI 上下文）](./ai-scene-snapshot.md)、[内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) |
| 错误缓冲、console.error 捕获、全局错误 | [错误环形缓冲与全局捕获](./ai-error-buffer.md) | [AI 配置持久化（IndexedDB）](./ai-config-store.md)、[场景运行时快照（AI 上下文）](./ai-scene-snapshot.md)、[内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) |
| 自然语言控场、NL 意图解析、LLM 动作解析、意图分发、intent dispatcher | [NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) | [统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md)、[环境弹窗（编排 + barrel）](./env-menu.md)、[资源库操作](./library-actions.md) |
| 场景快照、诊断上下文、FPS / 模型数 | [场景运行时快照（AI 上下文）](./ai-scene-snapshot.md) | [AI 配置持久化（IndexedDB）](./ai-config-store.md)、[错误环形缓冲与全局捕获](./ai-error-buffer.md)、[内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) |
| AI 诊断助手、resolveAi、浏览器/Go 适配器、streamChat / testConnection | [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md) | [应用启动引导](./init.md)、[AI 配置持久化（IndexedDB）](./ai-config-store.md)、[错误环形缓冲与全局捕获](./ai-error-buffer.md) |
| 安卓 文件访问 SAF Storage Access Framework shared 模式 /sdcard 目录选择、网页 FSA 重选目录 授权引导 getFsaAuthState、SelectDir 在安卓弹 SAF 建树 ACTION_OPEN_DOCUMENT_TREE | [安卓文件访问（shared 模式）](./android-file-access.md) | [资源库初始化](./library-setup.md)、[风力物理注入（WASM Bullet）](./wind-physics.md) |
| 外部动画、Mixamo、VRM、GLB、FBX、动作重定向、骨骼映射、人形动画导入 | [外部动作重定向桥](./animation-retargeter.md) | [场景序列化与自动保存](./scene-serialize.md) |
| AR 摄像头、视频透传、前后摄切换 | [AR 摄像头视频透传](./ar-camera.md) | [AR 模式场景级协调](./ar-scene.md) |
| AR 模式协调、接触阴影、AR 截图 | [AR 模式场景级协调](./ar-scene.md) | [AR 摄像头视频透传](./ar-camera.md) |
| 音频总线、音效、SFX、脚步声音量、音频上下文 | [音频总线](./audio-bus.md) | — |
| 骨骼覆盖存储、骨骼仲裁、感知层冲突 | [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md) | [虚拟裙骨物理控制器（ADR-084 Phase 2-3）](./virtual-skirt.md) |
| 骨骼覆盖、bone override、骨骼编辑、动作覆盖、欧拉角覆盖、混合权重、IK 保护、帧钩子注册、帧内时序（ADR-186） | [骨骼覆盖核心 API](./bone-override.md) | [场景序列化与自动保存](./scene-serialize.md)、[动作模块基类](./motion-module-base.md)、[模型注册表与生命周期管理](./model-manager.md) |
| 相机状态、相机位置保存、scene/canvas 引用共享、freefly 输入状态 | [相机状态管理 + 运行时上下文](./camera-state.md) | [相机模式管理系统（MmdCamera）](./camera.md)、[环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md)、[环境重力控制](./env-gravity.md) |
| 相机模式、轨道相机、自由飞行、相机控制、视角切换、ArcRotate、Freefly | [相机模式管理系统（MmdCamera）](./camera.md) | [相机状态管理 + 运行时上下文](./camera-state.md)、[环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md)、[环境重力控制](./env-gravity.md) |
| 后端适配、浏览器后端、Go 后端、IndexedDB、存储适配、后端测试、测试桩、mock | [后端适配层](./core-backend.md) | [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md)、[环境状态防抖持久化](./env-persist.md)、[应用启动引导](./init.md) |
| DOM 契约、role 属性、aria 属性、选择器、e2e 断言、collapsible class | [渲染层 DOM 契约单源](./dom-contract.md) | — |
| setEnvState、环境状态写入、中间件注册、预设动画状态 | [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) | [相机状态管理 + 运行时上下文](./camera-state.md)、[相机模式管理系统（MmdCamera）](./camera.md)、[环境变更分发回调（破循环依赖）](./env-dispatcher.md) |
| 碰撞开关、身体碰撞、地面碰撞、WASM 物理碰撞 | [环境碰撞控制](./env-collision.md) | [环境重力控制](./env-gravity.md) |
| 环境调度、破循环依赖、dispatch | [环境变更分发回调（破循环依赖）](./env-dispatcher.md) | [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md)、[环境系统实现核心（barrel + observer + fog）](./env-impl.md) |
| 重力控制、WASM 物理重力 | [环境重力控制](./env-gravity.md) | [相机状态管理 + 运行时上下文](./camera-state.md)、[相机模式管理系统（MmdCamera）](./camera.md)、[环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) |
| 地面材质、GroundMaterialSpec、地面重建、地面材质单一来源、地面 typeKey、ADR-226 | [地面材质单一事实源（GroundMaterialSpec）](./env-ground-spec.md) | — |
| 地面系统、程序化纹理、涟漪、地面高度查询 | [地面系统](./env-ground.md) | — |
| 环境实现、observer、fog、barrel 重导出 | [环境系统实现核心（barrel + observer + fog）](./env-impl.md) | [环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md)、[环境变更分发回调（破循环依赖）](./env-dispatcher.md) |
| 环境灯光、灯光包装、灯光与场景集成、时间预设、灯光派生 | [环境灯光包装](./env-lighting.md) | [EnvState 单一源 Schema](./env-state-schema.md)、[场景光照与阴影（barrel）](./lighting.md) |
| 环境弹窗、环境菜单、环境设置入口、env 菜单 | [环境弹窗（编排 + barrel）](./env-menu.md) | [场景弹窗（编排 + 路由）](./scene-menu.md)、[统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md)、[NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) |
| 环境持久化、防抖保存、envState 持久化 | [环境状态防抖持久化](./env-persist.md) | [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md)、[相机状态管理 + 运行时上下文](./camera-state.md)、[相机模式管理系统（MmdCamera）](./camera.md) |
| EnvState、环境状态 schema、getEnvKeys、dispatch group | [EnvState 单一源 Schema](./env-state-schema.md) | [环境灯光包装](./env-lighting.md)、[场景光照与阴影（barrel）](./lighting.md)、[全局状态与场景运行时 Store](./state.md) |
| 时间流转、太阳角、预设动画、环境预设 | [时间流转与太阳角系统](./env-time-of-day.md) | [相机状态管理 + 运行时上下文](./camera-state.md)、[相机模式管理系统（MmdCamera）](./camera.md)、[环境状态写入入口（setEnvState + 中间件链）](./env-bridge.md) |
| 水面、水池、水面反射 | [水面系统](./env-water.md) | — |
| 环境系统、环境门面、env facade | [环境系统门面（Facade）](./env.md) | — |
| 全局事件、拖放导入、更新通知 | [事件处理与导航系统](./events.md) | [应用启动引导](./init.md)、[渲染循环与 FPS 时钟](./render-loop.md) |
| 错误提示、信息提示、状态反馈、toast、status | [结构化反馈 API](./feedback.md) | — |
| 文件服务、文件 URL、文件编码、HTTP URL、文件服务器 | [统一文件服务层](./fileservice.md) | — |
| GPU 能力、压缩纹理、KTX2、ASTC、BC7、ADR-189 | [GPU 压缩纹理能力探测](./gpu-capabilities.md) | [PMX 模型加载与缩略图捕获](./model-loader.md)、[场景渲染管线与后处理](./renderer.md)、[场景核心编排器（纯组装器）](./scene.md) |
| 启动引导、初始化、bootstrap | [应用启动引导](./init.md) | [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md)、[事件处理与导航系统](./events.md)、[运行模式检测](./runtime-mode.md) |
| 资源库操作、导入模型、替换模型、替换动作、标签浏览、模型行点击 | [资源库操作](./library-actions.md) | [资源库核心](./library-core.md)、[统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md)、[NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) |
| 资源库核心、资源扫描、资源索引、资源管理核心 | [资源库核心](./library-core.md) | [资源库操作](./library-actions.md)、[统一资源加载队列](./load-manager.md) |
| 资源库初始化、资源库设置、资源库启动 | [资源库初始化](./library-setup.md) | [安卓文件访问（shared 模式）](./android-file-access.md) |
| 模型库、资源库、模型浏览、加载模型、library | [资源库入口与编排](./library.md) | [统一资源加载队列](./load-manager.md) |
| 个人灯光、灯光跟随、跟随聚光灯 | [个人灯光跟随](./lighting-follow.md) | [灯光预设系统](./lighting-presets.md)、[场景光照与阴影（barrel）](./lighting.md)、[模型生命周期操作](./model-ops.md) |
| 灯光预设、预设灯光、灯光配置 | [灯光预设系统](./lighting-presets.md) | [个人灯光跟随](./lighting-follow.md)、[场景光照与阴影（barrel）](./lighting.md)、[模型生命周期操作](./model-ops.md) |
| 场景光照、方向光/半球光、灯光状态、灯光补间 | [场景光照与阴影（barrel）](./lighting.md) | [环境灯光包装](./env-lighting.md)、[EnvState 单一源 Schema](./env-state-schema.md)、[个人灯光跟随](./lighting-follow.md) |
| 口型同步、lipsync、音频驱动口型 | [口型同步桥](./lipsync-bridge.md) | [程序化动作系统](./proc-motion-bridge.md) |
| 模型加载、动作加载、道具加载、音频加载、加载排队、加载进度、loadId | [统一资源加载队列](./load-manager.md) | [资源库操作](./library-actions.md)、[资源库核心](./library-core.md)、[资源库入口与编排](./library.md) |
| 加载后刷新、库扫描完成、菜单刷新、注册表 | [模型加载/库扫描完成后菜单刷新注册表](./load-refresh-registry.md) | — |
| 语言切换、国际化、locale | [国际化语言状态](./locale.md) | [应用启动引导](./init.md) |
| 材质系统、分类材质、材质参数调节、材质状态管理 | [分类材质系统](./material.md) | — |
| 菜单 overlay、弹窗 wrapper、关闭所有浮层 | [菜单 Overlay 与 Wrapper 管理](./menu-overlay.md) | [菜单栈共享指针（stackRegistry）](./menu-stack-registry.md) |
| 菜单声明、控件配置、状态绑定、菜单节点 | [声明式菜单 Schema](./menu-schema.md) | [菜单渲染引擎](./render-menu.md) |
| 菜单栈、modelStack、buildLevel、跨菜单导航 | [菜单栈共享指针（stackRegistry）](./menu-stack-registry.md) | [菜单 Overlay 与 Wrapper 管理](./menu-overlay.md) |
| 菜单引擎、SlideMenu、弹窗菜单 | [滑出式菜单引擎（SlideMenu）](./menu.md) | [环境弹窗（编排 + barrel）](./env-menu.md)、[动作绑定 UI](./motion-binding-ui.md)、[动作模块注册表](./motion-modules-registry.md) |
| babylon-mmd、MmdRuntime、骨骼矩阵、动作切换、音频、ADR-192 | [babylon-mmd 适配边界](./mmd-adapter.md) | [场景光照与阴影（barrel）](./lighting.md)、[动作菜单层级系统](./motion-menu-levels.md)、[感知层主控](./perception.md) |
| 模型加载、PMX 解析、缩略图捕获 | [PMX 模型加载与缩略图捕获](./model-loader.md) | [GPU 压缩纹理能力探测](./gpu-capabilities.md)、[资源库操作](./library-actions.md)、[模型生命周期操作](./model-ops.md) |
| 模型注册表、模型生命周期、模型属性、物理分类 | [模型注册表与生命周期管理](./model-manager.md) | [场景序列化与自动保存](./scene-serialize.md)、[骨骼覆盖核心 API](./bone-override.md)、[模型生命周期操作](./model-ops.md) |
| 删除模型、聚焦模型、模型变换（位置/旋转/缩放）、VPD 姿态应用 | [模型生命周期操作](./model-ops.md) | [场景序列化与自动保存](./scene-serialize.md)、[场景核心编排器（纯组装器）](./scene.md)、[骨骼覆盖核心 API](./bone-override.md) |
| 模型预设、动作预设、预设管理、预设面板 | [模型预设管理 UI](./model-preset-ui.md) | [场景序列化与自动保存](./scene-serialize.md) |
| 动作绑定 UI、动作槽位管理、模块切换列表 | [动作绑定 UI](./motion-binding-ui.md) | [滑出式菜单引擎（SlideMenu）](./menu.md)、[PMX 模型加载与缩略图捕获](./model-loader.md)、[模型生命周期操作](./model-ops.md) |
| 动作详情、图层管理、播放速度 | [动作详情 UI](./motion-detail-ui.md) | [PMX 模型加载与缩略图捕获](./model-loader.md)、[模型生命周期操作](./model-ops.md)、[动作绑定 UI](./motion-binding-ui.md) |
| 脚部跟随、脚 IK、地面高度、脚部调整引擎 | [脚部地面跟随（MMD-native IK）](./motion-feet-adjustment.md) | — |
| 动作历史、撤销、重做、动作记录 | [动作历史管理](./motion-history.md) | — |
| 动作意图、多主动作、动作库、动作广播、默认动作、场景动作 | [场景级动作意图库](./motion-intent.md) | [场景序列化与自动保存](./scene-serialize.md)、[PMX 模型加载与缩略图捕获](./model-loader.md)、[模型生命周期操作](./model-ops.md) |
| 动作菜单、动作层级、感知面板、程序化动作面板 | [动作菜单层级系统](./motion-menu-levels.md) | [babylon-mmd 适配边界](./mmd-adapter.md)、[感知层主控](./perception.md)、[场景序列化与自动保存](./scene-serialize.md) |
| 动作模块基类、module base、模块骨架、模块创建、帧钩子管理 | [动作模块基类](./motion-module-base.md) | [骨骼覆盖核心 API](./bone-override.md)、[场景序列化与自动保存](./scene-serialize.md)、[模型注册表与生命周期管理](./model-manager.md) |
| 动作模块、模块注册、动作扩展、动作管线扩展 | [动作模块注册表](./motion-modules-registry.md) | [骨骼覆盖核心 API](./bone-override.md)、[滑出式菜单引擎（SlideMenu）](./menu.md)、[模型生命周期操作](./model-ops.md) |
| 动作管线、逐帧合成、骨骼写入顺序、PipelineStage / PipelineLayer | [动作管线（逐帧合成）](./motion-pipeline.md) | [骨骼覆盖核心 API](./bone-override.md)、[模型生命周期操作](./model-ops.md)、[动作模块基类](./motion-module-base.md) |
| 播放进度 UI、seek 拖动、自动循环播放、MMD runtime 回调、时间格式、播放控制栏 | [动作播放控制](./motion-playback.md) | — |
| 轨道相机键盘、WSAD 环绕控制、相机键位、orbit input | [轨道相机键盘输入状态叶子](./orbit-state.md) | [模型注册表与生命周期管理](./model-manager.md)、[模型生命周期操作](./model-ops.md)、[场景序列化与自动保存](./scene-serialize.md) |
| 感知层、视线追踪、眨眼、呼吸、重心微动、感知上下文 | [感知层主控](./perception.md) | [场景序列化与自动保存](./scene-serialize.md)、[babylon-mmd 适配边界](./mmd-adapter.md)、[动作菜单层级系统](./motion-menu-levels.md) |
| FPS 监控、自动降级、性能模式、RenderBridge | [性能监控与自动降级](./performance.md) | — |
| 物理桥、骨骼读取、每帧更新注册表 | [物理骨骼桥与每帧注册表](./physics-bridge.md) | [虚拟裙骨物理控制器（ADR-084 Phase 2-3）](./virtual-skirt.md) |
| 广场状态、Plaza 状态、广场关闭、广场站点、广场层级 | [广场状态管理](./plaza-state.md) | — |
| 程序化动作、idle 动作、auto dance、节拍联动、动作生成、程序化 VMD | [程序化动作系统](./proc-motion-bridge.md) | [口型同步桥](./lipsync-bridge.md)、[多 VMD 叠加系统](./vmd-layers.md) |
| 渲染循环、FPS 时钟、硬件缩放、渲染启停 | [渲染循环与 FPS 时钟](./render-loop.md) | [事件处理与导航系统](./events.md)、[应用启动引导](./init.md) |
| 菜单渲染、schema 渲染、控件渲染、数据绑定 | [菜单渲染引擎](./render-menu.md) | [声明式菜单 Schema](./menu-schema.md) |
| 渲染管线、后处理、tone mapping、SSR / SSAO | [场景渲染管线与后处理](./renderer.md) | [GPU 压缩纹理能力探测](./gpu-capabilities.md)、[PMX 模型加载与缩略图捕获](./model-loader.md)、[场景核心编排器（纯组装器）](./scene.md) |
| 资源加载失败、纹理缺失、警告汇总、toast 提示 | [资源加载失败统一汇总](./resource-warning-sink.md) | — |
| runtime bridge、Wails events、跨平台事件、runtime-bridge | [Runtime 隔离桥（Wails Events/Browser）](./runtime-bridge.md) | [应用启动引导](./init.md) |
| 运行模式、桌面模式、浏览器模式、环境检测 | [运行模式检测](./runtime-mode.md) | [应用启动引导](./init.md)、[内置 AI 诊断助手 — 双适配器服务层](./ai-service.md)、[后端适配层](./core-backend.md) |
| 场景弹窗、场景菜单、场景设置入口、场景路由 | [场景弹窗（编排 + 路由）](./scene-menu.md) | [环境弹窗（编排 + barrel）](./env-menu.md)、[统一动作注册表 — 菜单/NL/快捷键共享真相源](./action-registry.md)、[NL 意图解析 — LLM 文本 → 动作执行](./ai-intent-dispatcher.md) |
| 场景序列化、场景保存、场景恢复、撤销/重做 | [场景序列化与自动保存](./scene-serialize.md) | [模型生命周期操作](./model-ops.md)、[场景核心编排器（纯组装器）](./scene.md)、[骨骼覆盖核心 API](./bone-override.md) |
| 场景初始化、场景编排、场景生命周期 | [场景核心编排器（纯组装器）](./scene.md) | [场景序列化与自动保存](./scene-serialize.md)、[应用启动引导](./init.md)、[模型生命周期操作](./model-ops.md) |
| 设置共享、设置工具、UI 主题应用、字节格式化、设置默认值 | [设置共享工具](./settings-shared.md) | [设置页路由与编排](./settings.md) |
| 设置页、设置路由、设置编排 | [设置页路由与编排](./settings.md) | [设置共享工具](./settings-shared.md) |
| 快捷键、快捷键注册、键盘绑定 | [快捷键注册表](./shortcut-registry.md) | — |
| 全局状态、场景状态、播放控制状态、资源库状态、scene-state / playback-state / library-state | [全局状态与场景运行时 Store](./state.md) | [EnvState 单一源 Schema](./env-state-schema.md) |
| 变换适配、transform adapter、双模态、拖拽适配 | [变换适配器注册表（双模态去重）](./transform-adapter.md) | [场景序列化与自动保存](./scene-serialize.md)、[骨骼覆盖核心 API](./bone-override.md)、[模型注册表与生命周期管理](./model-manager.md) |
| 变换模式、拖拽模式、位移旋转、transform mode | [拖拽变换模式开关](./transform-mode.md) | — |
| 选中状态、选中物、变换选择、selection 状态 | [变换选中物状态源](./transform-selection.md) | [场景核心编排器（纯组装器）](./scene.md) |
| 键盘导航、列表导航、箭头键导航 | [键盘导航工具](./ui-keyboard-nav.md) | [应用启动引导](./init.md) |
| 虚拟裙骨、物理裙摆、Bullet 弹簧链、skirt analyzer | [虚拟裙骨物理控制器（ADR-084 Phase 2-3）](./virtual-skirt.md) | [骨骼覆盖存储（多模块仲裁）](./bone-override-store.md)、[物理骨骼桥与每帧注册表](./physics-bridge.md) |
| 多层动作、动作叠加、VMD 混合、composite animation、动作图层、动作优先级 | [多 VMD 叠加系统](./vmd-layers.md) | [程序化动作系统](./proc-motion-bridge.md)、[VMD 动作加载器](./vmd-loader.md) |
| VMD 加载、动作文件导入、伴音自动加载、动作时长、文件格式校验、动作播放开始 | [VMD 动作加载器](./vmd-loader.md) | [多 VMD 叠加系统](./vmd-layers.md) |
| 后端绑定、后端代理、resolveBackend、Wails bindings | [后端绑定聚合层（backend 代理化）](./wails-bindings.md) | [内置 AI 诊断助手 — 双适配器服务层](./ai-service.md)、[后端适配层](./core-backend.md)、[环境状态防抖持久化](./env-persist.md) |
| 风力物理、风力注入、头发/裙子物理 | [风力物理注入（WASM Bullet）](./wind-physics.md) | [安卓文件访问（shared 模式）](./android-file-access.md)、[场景光照与阴影（barrel）](./lighting.md)、[babylon-mmd 适配边界](./mmd-adapter.md) |

## 标准执行模板

```text
先按 docs/knowledge/routes.md 判断首选知识卡。
读取 docs/knowledge/README.md 和首选卡片，再按 source_files 阅读源码。
grep docs/adr/ 查找相关决策和状态，检查 symbols、invariants、tests、use_when。
以源码为最终事实来源；如果卡片过时，先报告漂移，再决定是否同步更新。
修改后运行最小相关测试和 npm run check:docs。
```

## 维护规则

- 本文件自动生成，**请勿手改**；重跑 `npm run gen:routes` 重新生成。
- 新增/修改知识卡：更新 frontmatter 的 `use_when`（意图关键词）与 `adr`（关联决策）后重跑即可自动入列。
- `use_when` 为空或不含关键词的卡不会出现在路由表（但仍可经索引/关联图抵达）。
