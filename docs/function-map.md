# 函数映射表

> AI 找代码用。改前端功能时先 grep 此表定位文件。
> **自动生成**（2026-08-03）— 由 `scripts/gen-funcmap.mjs` 生成。

## 总览

| 模块 | 文件数 | 导出符号数 |
|------|--------|-----------|
| 核心基础设施 | 124 | 725 |
| 3D 场景 | 113 | 1138 |
| 菜单 & UI | 75 | 386 |
| 换装 & 音频 | 3 | 33 |
| 动作算法 | 18 | 139 |
| 物理系统 | 2 | 14 |

## 核心基础设施

| 符号 | 文件 | 说明 |
|------|------|------|
| `registerDiagnosticActions()` | `core/action-defs/diagnostic-actions` | — |
| `registerEnvActions()` | `core/action-defs/env-actions` | — |
| `registerLibraryActions()` | `core/action-defs/library-actions-def` | — |
| `registerMotionActions()` | `core/action-defs/motion-actions` | — |
| `registerSceneActions()` | `core/action-defs/scene-actions` | — |
| `registerSettingsActions()` | `core/action-defs/settings-actions` | — |
| `ActionResult()` | `core/action-executor` | — |
| `executeActionById()` | `core/action-executor` | 按 ID 执行 AI 动作（含参数校验与结果结构化返回）。 |
| `ActionDef()` | `core/action-registry` | — |
| `ParamDef()` | `core/action-registry` | — |
| `ParamType()` | `core/action-registry` | — |
| `_resetActionRegistry()` | `core/action-registry` | 清空注册表（测试/重置用） |
| `_setStrictMode()` | `core/action-registry` | 设置严格模式 |
| `getAction()` | `core/action-registry` | 按 id 获取动作定义 |
| `listActions()` | `core/action-registry` | 列出全部或指定域的动作 |
| `registerAction()` | `core/action-registry` | 注册一条动作。遇重复 id 时 console.warn + 覆盖（默认）。 |
| `registerActions()` | `core/action-registry` | 批量注册 |
| `unregisterAction()` | `core/action-registry` | 按 id 撤销注册 |
| `ToolFunction()` | `core/ai/action-catalog` | — |
| `ToolSchema()` | `core/ai/action-catalog` | — |
| `buildToolCatalogText()` | `core/ai/action-catalog` | — |
| `buildToolSchemas()` | `core/ai/action-catalog` | — |
| `registerAllActions()` | `core/ai/action-registry-defs` | 注册全部 AI 动作定义（控制/诊断/设置/库/动作/环境/场景各域）。 |
| `registerControlActions()` | `core/ai/action-registry-defs` | — |
| `BrowserAiAdapter()` | `core/ai/browser-adapter` | — |
| `browserAiAdapter()` | `core/ai/browser-adapter` | — |
| `BUILTIN_BIBLES()` | `core/ai/character-bible` | 内置角色圣经（可扩展；后续支持用户自定义导入）。 |
| `CharacterBible()` | `core/ai/character-bible` | 单个角色的人设定义。 |
| `DIALOGUE_EMOTIONS()` | `core/ai/character-bible` | 台词生成的输出情绪标签闭集（用于后续 TTS/表情映射，Step 2）。 |
| `DialogueEmotion()` | `core/ai/character-bible` | — |
| `DialogueLine()` | `core/ai/character-bible` | 一条解析后的台词。 |
| `buildDialogueSystemPrompt()` | `core/ai/character-bible` | 组装台词模式的 system prompt：固定人设 + 结构化输出契约。 |
| `getBible()` | `core/ai/character-bible` | 按 id 查角色圣经；未命中返回第一个内置角色兜底。 |
| `parseDialogueLines()` | `core/ai/character-bible` | 从 LLM 文本响应解析台词数组；容错：非法情绪归一到 neutral， 解析失败时将整段文本作为单条 neutral 台词兜底（保证 UI 永远有内容渲染）。 |
| `ChatSession()` | `core/ai/chat-store` | 会话元信息（供列表展示，不含消息体）。 |
| `ChatSessionFull()` | `core/ai/chat-store` | 完整会话（元信息 + 消息数组）。 |
| `clearActiveId()` | `core/ai/chat-store` | 清除当前活动会话 id（清空会话 / 删除当前会话且无剩余时调用，避免陈旧指针）。 |
| `deleteSession()` | `core/ai/chat-store` | 删除会话（元信息 + 消息两键）。 |
| `deriveTitle()` | `core/ai/chat-store` | 从消息派生标题：取首条 user 消息前 20 字；无则返回空串（调用方回退 i18n 未命名）。 |
| `getActiveId()` | `core/ai/chat-store` | 读当前活动会话 id。 |
| `listSessions()` | `core/ai/chat-store` | 列出全部会话元信息，按 updatedAt 倒序（最近的在前）。降级返回空数组。 |
| `loadSession()` | `core/ai/chat-store` | 加载完整会话（元信息 + 消息）。缺失或损坏返回 undefined。 |
| `newSessionId()` | `core/ai/chat-store` | 生成新会话 id。crypto.randomUUID 在 WebView2 / 现代浏览器均可用。 |
| `saveSession()` | `core/ai/chat-store` | 保存完整会话（元信息 + 消息，单事务批量写）。降级不阻断 UI，但写失败需留日志便于排查丢失。 |
| `setActiveId()` | `core/ai/chat-store` | 写当前活动会话 id。 |
| `AiConfig()` | `core/ai/config-store` | — |
| `DEFAULT_AI_CONFIG()` | `core/ai/config-store` | 零 key 默认路径：本地 Ollama（大模型零 key，小模型零成本）。见 ADR-196 开放问题 Q2 裁定。 |
| `DEFAULT_RELAY_URL()` | `core/ai/config-store` | 网页端 CORS 同源代理 Worker 默认地址（部署时由 wrangler deploy 产出）。 |
| `DEFAULT_TIMEOUT_MS()` | `core/ai/config-store` | 缺省超时。 |
| `MAX_TIMEOUT_MS()` | `core/ai/config-store` | 超时上限（防误设导致挂死请求永不释放）。 |
| `MIN_TIMEOUT_MS()` | `core/ai/config-store` | [doc:adr-199 P2-3] 超时下限（防误设过小掐断正常请求）。 |
| `PROVIDER_PRESETS()` | `core/ai/config-store` | 服务商预设：端点、默认模型、是否需要 Key、文案 key、文档链接。 |
| `ProviderPreset()` | `core/ai/config-store` | — |
| `classifyAiError()` | `core/ai/config-store` | 根据 testConnection / streamChat 的错误消息分类错误类型。 |
| `ensureAiConfigLoaded()` | `core/ai/config-store` | 主动预加载（建议 init 后台调用，使首次读取即命中缓存，避免回退默认窗口）。 |
| `loadAiConfig()` | `core/ai/config-store` | 同步读取：优先内存缓存；未加载时回退默认并触发异步回源（不阻塞调用方）。 |
| `normalizeEndpoint()` | `core/ai/config-store` | 补全 chat completions 路径：输入 `/v1` 自动补全为 `/v1/chat/completions`，已有完整路径则原样返回。 |
| `normalizeTimeout()` | `core/ai/config-store` | [doc:adr-199 P2-3] 将超时值归一到 [MIN, MAX]；非法/缺失回落缺省。 |
| `saveAiConfig()` | `core/ai/config-store` | 保存配置：写内存缓存（同步即时生效）+ 异步落盘 IndexedDB。 |
| `validateAiConfig()` | `core/ai/config-store` | 校验配置是否足够发起一次对话。全量收集所有错误，一次性返回。 |
| `buildDialogueSystemPrompt()` | `core/ai/dialogue-session` | 转发：为当前角色构建台词 system prompt。 |
| `getActiveBible()` | `core/ai/dialogue-session` | 当前选中的角色圣经。 |
| `listBibles()` | `core/ai/dialogue-session` | 可选角色列表（供 UI 下拉/切换）。 |
| `setActiveBible()` | `core/ai/dialogue-session` | 切换当前角色（唯一写入点）。 |
| `SpeakLine()` | `core/ai/dialogue-speech` | 一条待朗读台词。 |
| `cancelSpeech()` | `core/ai/dialogue-speech` | 停止当前所有朗读（切换角色/取消/面板关闭时调用）。 |
| `isSpeechSupported()` | `core/ai/dialogue-speech` | 环境是否支持语音合成。 |
| `speakLines()` | `core/ai/dialogue-speech` | 依次朗读多条台词（按情绪调整语速/音高）。 |
| `ErrorEntry()` | `core/ai/error-buffer` | — |
| `ErrorRingBuffer()` | `core/ai/error-buffer` | — |
| `GlobalErrorTarget()` | `core/ai/error-buffer` | — |
| `captureError()` | `core/ai/error-buffer` | 捕获错误并写入环形缓冲（统一错误上报入口）。 |
| `clearErrors()` | `core/ai/error-buffer` | — |
| `errorBuffer()` | `core/ai/error-buffer` | — |
| `getErrors()` | `core/ai/error-buffer` | 取缓冲内的全部错误条目。 |
| `inferSeverity()` | `core/ai/error-buffer` | 根据 ErrorEntry 的 kind + tag 推导严重级别。 |
| `installErrorCaptureOn()` | `core/ai/error-buffer` | — |
| `installGlobalErrorCapture()` | `core/ai/error-buffer` | — |
| `installLoggingPatch()` | `core/ai/error-buffer` | 幂等地 patch console.error，使其所有输出自动入环（保留原始 console.error 行为）。 |
| `toDiagnosticContext()` | `core/ai/error-buffer` | — |
| `uninstallLoggingPatch()` | `core/ai/error-buffer` | 卸载 console.error 补丁，恢复原始实现。 |
| `GoAiAdapter()` | `core/ai/go-adapter` | — |
| `goAiAdapter()` | `core/ai/go-adapter` | — |
| `goKeyAllowsProceed()` | `core/ai/go-key-allows-proceed` | Go 桌面端 key 不可回读，当 isGo=true && keyConfigured=true 时， missingKey 不应阻止前端发起请求（key 由 Go 后端持有）。 |
| `resolveAi()` | `core/ai/index` | — |
| `executeAction()` | `core/ai/intent-dispatcher` | — |
| `parseActionFromLLM()` | `core/ai/intent-dispatcher` | — |
| `renderMarkdownInto()` | `core/ai/markdown` | 把 Markdown 文本渲染为 DOM 片段，追加进目标容器。 |
| `AdapterResult()` | `core/ai/param-adapters` | — |
| `adaptParam()` | `core/ai/param-adapters` | — |
| `colorAdapter()` | `core/ai/param-adapters` | — |
| `entityAdapter()` | `core/ai/param-adapters` | — |
| `enumAdapter()` | `core/ai/param-adapters` | — |
| `rangeAdapter()` | `core/ai/param-adapters` | — |
| `SceneSnapshotBridge()` | `core/ai/scene-snapshot` | AI 快照所需的引擎运行时读取桥接（由 scene.ts 注入）。 |
| `SceneSnapshotData()` | `core/ai/scene-snapshot` | 格式化后的快照数据（纯数据，便于测试）。 |
| `_resetAiSnapshotBridge()` | `core/ai/scene-snapshot` | 仅供测试使用：重置 bridge 缓存。 |
| `captureSceneSnapshot()` | `core/ai/scene-snapshot` | 采集当前场景快照文本；未初始化时返回占位符。 |
| `captureSceneSnapshotData()` | `core/ai/scene-snapshot` | 采集当前场景快照结构化数据；未初始化时返回 null。 |
| `formatSceneSnapshot()` | `core/ai/scene-snapshot` | 将快照数据格式化为紧凑文本（≤ NFR-3 的 2048 字符预算）。 |
| `registerAiSnapshotBridge()` | `core/ai/scene-snapshot` | 由 scene.ts 在 initScene() 时注入引擎引用（单向依赖，避免 ai → scene 静态耦合）。 |
| `AI_ERROR_KINDS()` | `core/ai/types` | [doc:adr-196] AiErrorKind 运行时值数组，供 Go kind 白名单校验等需要运行时遍历的场景使用。 |
| `AiCapabilities()` | `core/ai/types` | AI 后端能力描述 |
| `AiConfigProvider()` | `core/ai/types` | 用户选择的服务商配置项 |
| `AiConnectionResult()` | `core/ai/types` | AI 连接测试结果，镜像 Go LLMConnectionResult 结构 |
| `AiErrorKind()` | `core/ai/types` | 错误分类，用于面板给出可操作建议 |
| `AiPersistedConfig()` | `core/ai/types` | 持久化配置的回读结构，供诊断面板初始化时回填输入框。 |
| `AiService()` | `core/ai/types` | AI 服务统一抽象，镜像 BackendService 双适配器模式 |
| `AiValidationError()` | `core/ai/types` | 校验错误条目（全量收集用） |
| `AiValidationResult()` | `core/ai/types` | 配置校验结果 |
| `ChatChunk()` | `core/ai/types` | 流式聊天响应块 |
| `ChatMessage()` | `core/ai/types` | 聊天消息角色 |
| `ChatRequest()` | `core/ai/types` | 流式聊天请求参数 |
| `ToolCall()` | `core/ai/types` | 工具调用（assistant 消息中） |
| `ToolSchema()` | `core/ai/types` | JSON Schema 工具定义（OpenAI function_calling 格式） |
| `Abortable()` | `core/async` | 可复用的 AbortController 封装——abort 后自动重置，使对象可重复使用。 |
| `DebouncedTimer()` | `core/async` | 防抖定时器——封装 setTimeout 的 schedule/cancel 样板。 |
| `LoadingGuard()` | `core/async` | 并发加载守卫——防止同一 key 的异步操作重复触发。 |
| `delay()` | `core/async` | Promise 包装的延迟。 |
| `fireAndForget()` | `core/async` | 启动一个异步操作但不等待，异常由 swallowError 兜底。 |
| `makeLazyLoader()` | `core/async` | 创建惰性动态 import 加载器（带并发守卫 + 失败重试）。 |
| `swallowError()` | `core/async` | 吞掉 promise 的异常并记录日志（比空 `.catch(() =&gt; {})` 可调试）。 |
| `waitForFrame()` | `core/async` | Promise 包装的等待下一帧。 |
| `PlaySfxOptions()` | `core/audio-bus` | — |
| `disposeAudioBus()` | `core/audio-bus` | 释放总线资源（context 关闭、缓存清空）。 |
| `getAudioContext()` | `core/audio-bus` | 惰性创建共享 AudioContext（SFX 总线与未来音效共用）。 |
| `getFootstepVolume()` | `core/audio-bus` | — |
| `getSfxEnabled()` | `core/audio-bus` | — |
| `getSfxMasterGain()` | `core/audio-bus` | SFX 主增益（独立于音乐音量）。增益值实时反映 sfxEnabled / sfxVolume。 |
| `getSfxVolume()` | `core/audio-bus` | — |
| `playSfx()` | `core/audio-bus` | 播放一次短音效。每次 new BufferSource（一次性、可叠加），播完自动断开释放。 |
| `setFootstepEnabled()` | `core/audio-bus` | — |
| `setFootstepVolume()` | `core/audio-bus` | — |
| `setSfxEnabled()` | `core/audio-bus` | — |
| `setSfxVolume()` | `core/audio-bus` | — |
| `setTriggerAutoSave()` | `core/auto-save` | 注册自动保存的实现回调（由 scene-serialize.ts 在初始化时调用）。 |
| `triggerAutoSave()` | `core/auto-save` | 触发自动保存（由动作/菜单/UI 层调用）。 |
| `clearWebFlag()` | `core/backend/backend-mocks` | — |
| `goAdapterMock()` | `core/backend/backend-mocks` | — |
| `idbStore()` | `core/backend/backend-mocks` | — |
| `makeIdbMock()` | `core/backend/backend-mocks` | — |
| `resetIdb()` | `core/backend/backend-mocks` | — |
| `setWindow()` | `core/backend/backend-mocks` | — |
| `eqBytes()` | `core/backend/browser-adapter-mocks` | — |
| `mem()` | `core/backend/browser-adapter-mocks` | — |
| `resetMem()` | `core/backend/browser-adapter-mocks` | — |
| `setStore()` | `core/backend/browser-adapter-mocks` | — |
| `FsaAuthState()` | `core/backend/browser-adapter` | — |
| `browserAdapter()` | `core/backend/browser-adapter` | — |
| `dismissFsaAuthPrompt()` | `core/backend/browser-adapter` | — |
| `getFsaAuthState()` | `core/backend/browser-adapter` | [doc:adr-183] 查询 FSA 根目录授权状态，供 UI 启动引导（不触发任何权限弹窗）。 |
| `getFsaDownloadAuthState()` | `core/backend/browser-adapter` | 查询下载文件夹 FSA 授权状态（不触发权限弹窗），供 UI 引导。 |
| `getFsaDownloadHandle()` | `core/backend/browser-adapter` | 读取持久化的下载文件夹句柄（供扫描使用），不触发权限弹窗；无句柄返回 null。 |
| `ingestModelBytes()` | `core/backend/browser-adapter` | [doc:adr-195] 写入单文件（名+字节）到资源库，不加载到场景。供下载面板批量摄入复用。 |
| `ingestModelFile()` | `core/backend/browser-adapter` | 写入单个模型/动作文件（File）到 IndexedDB 资源库（file:+entry:），不加载到场景。 |
| `ingestModelFiles()` | `core/backend/browser-adapter` | [doc:adr-195] P3 批量摄入：单事务写入该批次所有 file:/entry: 键，避免逐条 idbSet 并发写竞态。 |
| `isFsaAuthPromptDismissed()` | `core/backend/browser-adapter` | [doc:adr-183] 用户跳过启动授权引导后写入「已跳过」标志，避免纯导入用户每次启动被弹窗骚扰。 |
| `reauthorizeFsaDownload()` | `core/backend/browser-adapter` | 对持久化的下载文件夹句柄重新请求授权（须用户手势上下文）。成功返回 true。 |
| `reauthorizeFsaRoot()` | `core/backend/browser-adapter` | [doc:adr-183] 对持久化的 FSA 句柄重新请求授权（不重选目录）。 |
| `selectFsaDownloadDir()` | `core/backend/browser-adapter` | 选择下载文件夹（独立 FSA 句柄），持久化到 _FSA_DOWNLOAD_KEY。 |
| `setScanProgressCallback()` | `core/backend/browser-adapter` | [doc:adr-183] 注册扫描进度回调，供 UI 层节流增量刷新。 |
| `goAdapter()` | `core/backend/go-adapter` | — |
| `STORES()` | `core/backend/idb` | — |
| `Store()` | `core/backend/idb` | — |
| `WebModelEntry()` | `core/backend/idb` | — |
| `closeIDB()` | `core/backend/idb` | 释放连接（页面卸载/切换时调用），与联邦资源配对纪律对齐。 |
| `idbBatchSet()` | `core/backend/idb` | 单事务批量写入（键/值对），避免逐条 idbSet 的并发写竞态。 |
| `idbDelete()` | `core/backend/idb` | — |
| `idbGet()` | `core/backend/idb` | — |
| `idbKeys()` | `core/backend/idb` | — |
| `idbSet()` | `core/backend/idb` | — |
| `openDB()` | `core/backend/idb` | — |
| `saveModel()` | `core/backend/idb` | 存入模型库（同名覆盖）。返回写入的元数据。 |
| `getCachedCapabilities()` | `core/backend/index` | — |
| `getCapabilities()` | `core/backend/index` | — |
| `resolveBackend()` | `core/backend/index` | — |
| `BackendCapabilities()` | `core/backend/types` | 三态能力矩阵键（对齐 ADR-176「能力矩阵（三态 × 能力键）」节）。 |
| `BackendService()` | `core/backend/types` | 统一后端抽象。go-adapter 透传 Go 全量（含契约测试 139 函数）， browser-adapter 实现 106（81 真实 + 8 FSA + 17 降级）。 |
| `GoApp()` | `core/backend/types` | Go 生成绑定的值类型（函数签名源）。 |
| `NotSupportedError()` | `core/backend/types` | 浏览器侧原生独占能力的统一错误。调用方据 capabilities() 预判或 catch 此错误。 |
| `clamp()` | `core/clamp` | — |
| `clamp01()` | `core/clamp` | — |
| `clampInt()` | `core/clamp` | — |
| `clampPct()` | `core/clamp` | 百分比钳制到 [0, 100]。 |
| `lerp()` | `core/clamp` | 线性插值。 |
| `lerpArray()` | `core/clamp` | 逐元素线性插值数组。 |
| `Cache()` | `core/collections` | 轻量泛型缓存——Map 封装，统一 get/set/has/delete/clear 接口。 |
| `allSettledFilter()` | `core/collections` | 等待全部 promise 结束，仅返回 fulfilled 结果（rejected 被静默丢弃）。 |
| `ensureArray()` | `core/collections` | 确保值为数组；非数组则包裹为单元素数组。 |
| `filterKeys()` | `core/collections` | 按谓词过滤对象键，返回仅含满足条件键值对的新对象。 |
| `col3FromTriple()` | `core/color-helpers` | 从 `[r, g, b]` 三元组构造 Color3。 |
| `hexToRgb()` | `core/color-helpers` | 将 #rrggbb 解析为 {r,g,b}（0–255）。非法输入回退主题默认 74,108,247。 |
| `rgbString()` | `core/color-helpers` | 将 Color3 转为 CSS `rgb(r, g, b)` 字符串（0–255 整数）。 |
| `rgbToString()` | `core/color-helpers` | 将 {r,g,b} 转为 CSS rgb 字符串 "r, g, b"（供 --accent-rgb 等 CSS 变量）。 |
| `debounce()` | `core/debounce` | 函数防抖：在等待指定时间后才执行函数，如果在等待期间再次调用则重置计时器。 |
| `deepClone()` | `core/deep-clone` | 深拷贝对象（基于 JSON 序列化）。 |
| `setupE2ECapture()` | `core/dev-hooks` | — |
| `DialogOptions()` | `core/dialog` | — |
| `Prompt2Options()` | `core/dialog` | — |
| `disposeOverlay2()` | `core/dialog` | 移除 showPrompt2 创建的 overlay2 DOM（供 HMR 清理入口调用）。 |
| `showConfirm()` | `core/dialog` | Show a confirmation dialog. |
| `showPrompt()` | `core/dialog` | Show a prompt dialog. |
| `showPrompt2()` | `core/dialog` | 双字段输入对话框。返回 [value1, value2] 或 null（取消）。 |
| `detachSharedTextures()` | `core/dispose-helpers` | 批量 dispose 一组材质**之前**调用：摘除这组材质对「仍被其他存活材质引用」的纹理的引用， 使随后的 `material.dispose(_, true)` 不会误杀共享 |
| `safeDispose()` | `core/dispose-helpers` | 安全释放对象并置空。 |
| `ARIA_ATTR()` | `core/dom-contract` | aria 属性名常量（ARIA_ATTR.valuemin 等） |
| `COLLAPSIBLE()` | `core/dom-contract` | collapsible（folder）组件契约（ui-collapsible.ts 与 e2e 展开逻辑共用） |
| `KIND_CONTROL_SELECTOR()` | `core/dom-contract` | MenuKind → 交互控件选择器（e2e 断言用；folder/custom/action 等无标准交互控件） |
| `ROLE()` | `core/dom-contract` | 渲染层 role 常量——产出 role 属性时引用，勿手写字符串（ADR-229 §9） |
| `SLIDER_BAR_CLASS()` | `core/dom-contract` | 滑动条本体 class（slider / colorSlider / modeSlider 共用 .cs-bar） |
| `TOGGLE_INPUT_SELECTOR()` | `core/dom-contract` | toggle 的原生输入元素选择器（e2e 需点击/读 checked，故单列一份） |
| `Disposable()` | `core/dom` | — |
| `DomRefs()` | `core/dom` | — |
| `addDisposableListener()` | `core/dom` | 添加事件监听器并返回 Disposable，便于在 dispose 链路中统一释放。 |
| `dom()` | `core/dom` | — |
| `handleDropFile()` | `core/drop-import` | 处理已落地的路径（桌面绝对路径或浏览器 IndexedDB 键）。 |
| `handleDroppedFile()` | `core/drop-import` | [doc:adr-177] 单个拖入文件落地：桌面走原生 path，浏览器读字节写 IndexedDB。 |
| `ENV_STATE_SCHEMA()` | `core/env-state-schema` | — |
| `EnvDispatchGroup()` | `core/env-state-schema` | 已定义的 dispatch 分组名称 |
| `EnvStateSchema()` | `core/env-state-schema` | — |
| `getEnvKeys()` | `core/env-state-schema` | 从 Schema 派生指定 dispatch 分组的 key 列表。 |
| `escapeHtml()` | `core/escape-html` | Escape HTML special characters to prevent injection. |
| `buildNavMaps()` | `core/events` | — |
| `disposeEventHandlers()` | `core/events` | — |
| `initDropHandler()` | `core/events` | — |
| `navActions()` | `core/events` | — |
| `navLabels()` | `core/events` | — |
| `registerEventHandlers()` | `core/events` | — |
| `showUpdateToast()` | `core/events` | — |
| `toggleOverlay()` | `core/events` | — |
| `feedbackError()` | `core/feedback` | 错误级 toast 反馈。标题 =「动作 + 目标」，detail 自动从 error 翻译。 |
| `feedbackInfo()` | `core/feedback` | Info 级 toast 反馈。标题 =「动作 + 目标」。 |
| `feedbackStatus()` | `core/feedback` | 通用状态栏反馈。auto-detect 成功与否：title 以 ✗ 开头则为失败。 |
| `encodeFileRef()` | `core/fileservice` | 编码文件名为查询参数值（base64url 无填充）。 |
| `normPath()` | `core/fileservice` | — |
| `resolveFileUrl()` | `core/fileservice` | 从文件路径解析出 HTTP URL 及对应服务器信息。 |
| `resolveModelDir()` | `core/fileservice` | 从文件路径解析出隔离后的目录路径（不启动 HTTP 服务器）。 |
| `formatTimestamp()` | `core/format-timestamp` | 格式化日期为 HH:MM:SS.mmm 字符串。 |
| `formatError()` | `core/format` | 将任意错误值转换为人类可读字符串，带截断保护。 |
| `formatTime()` | `core/format` | 格式化秒数为 `MM:SS.CC` 字符串（分:秒.百分秒）。 |
| `freeflyInput()` | `core/freefly-state` | — |
| `Ktx2Capability()` | `core/gpu-capabilities` | — |
| `Ktx2PreferredFormat()` | `core/gpu-capabilities` | — |
| `_resetKtx2CacheForTest()` | `core/gpu-capabilities` | 仅供测试使用：重置缓存。 |
| `detectKtx2Support()` | `core/gpu-capabilities` | 探测 GPU 对 KTX2 压缩纹理的支持。 |
| `translateGoError()` | `core/i18n/goerr` | [doc:adr-117] 将 Go 端返回的 error 翻译为当前语言。 |
| `LangCode()` | `core/i18n/locale` | — |
| `SUPPORTED_LANGS()` | `core/i18n/locale` | 规划支持的语言清单（与竞品 DanceXR 对齐：简/繁中、英、日、韩）。 |
| `detectSystemLang()` | `core/i18n/locale` | [doc:adr-059] 从浏览器/WebView 语言偏好推断首选语言。 |
| `getLang()` | `core/i18n/locale` | 当前语言代码（响应式，切换语言后自动更新）。 |
| `initI18n()` | `core/i18n/locale` | 启动期语言初始化：同步 &lt;html lang&gt; 并预加载当前语言包。 |
| `setLang()` | `core/i18n/locale` | — |
| `en()` | `core/i18n/locales/en` | — |
| `ja()` | `core/i18n/locales/ja` | — |
| `ko()` | `core/i18n/locales/ko` | — |
| `zhCN()` | `core/i18n/locales/zh-CN` | — |
| `zhTW()` | `core/i18n/locales/zh-TW` | — |
| `AVAILABLE_LANGS()` | `core/i18n/t` | [doc:adr-059] 当前已补全语言包的语言列表。 |
| `bundles()` | `core/i18n/t` | 运行时加载的语言包缓存。生产环境由 fetch 填充，测试环境可直接赋值。 |
| `loadLocale()` | `core/i18n/t` | 异步加载指定语言包，从 public/locales/{lang}.json fetch。 |
| `t()` | `core/i18n/t` | 翻译一个 key。 |
| `registerIconBundle()` | `core/icons-bundle` | — |
| `createIconButton()` | `core/icons` | 创建图标按钮（默认 slide-action 样式）。 |
| `createIconifyIcon()` | `core/icons` | Create an &lt;iconify-icon&gt; element for the given icon name. |
| `softwareKindIcon()` | `core/icons` | Map software kind to an iconify icon name. |
| `canvasToBase64()` | `core/image` | 将 Canvas 编码为 base64 字符串（剥离 data:image/...;base64, 前缀）。 |
| `thumbDataUrl()` | `core/image` | Build a data URL from a base64 thumbnail, sniffing PNG/JPEG/WebP from the header. |
| `toBase64()` | `core/image` | Encode a string as base64 (UTF-8 safe). |
| `bootstrap()` | `core/init` | 应用启动入口：接线 dev-hooks / render-loop / events 并启动渲染循环。 |
| `jsonParse()` | `core/json-stringify` | Safely parse JSON; returns null on failure instead of throwing. |
| `jsonStringify()` | `core/json-stringify` | Format a value as pretty-printed JSON (2-space indent). |
| `addRecentMotion()` | `core/library-state` | — |
| `allModels()` | `core/library-state` | — |
| `displayNamePriority()` | `core/library-state` | 缩略图更新回调（由 ui-resource-panel.ts 注册，避免模块间动态 import 耦合）。 |
| `expandedFolders()` | `core/library-state` | — |
| `getRecentMotions()` | `core/library-state` | — |
| `libraryRoot()` | `core/library-state` | — |
| `librarySortMode()` | `core/library-state` | — |
| `modelMetaCache()` | `core/library-state` | — |
| `overridePaths()` | `core/library-state` | — |
| `recentModels()` | `core/library-state` | — |
| `resourceRoot()` | `core/library-state` | — |
| `setAllModels()` | `core/library-state` | — |
| `setDisplayNamePriority()` | `core/library-state` | — |
| `setLibraryRoot()` | `core/library-state` | — |
| `setLibrarySortMode()` | `core/library-state` | — |
| `setModelMetaCache()` | `core/library-state` | — |
| `setOverridePaths()` | `core/library-state` | — |
| `setRecentModels()` | `core/library-state` | — |
| `setResourceRoot()` | `core/library-state` | [audit:P2] 同时同步 libraryRoot（历史兼容：二者语义相同，resourceRoot 为新名称）。 |
| `setThumbnailCache()` | `core/library-state` | — |
| `setThumbnailUpdateCallback()` | `core/library-state` | — |
| `thumbnailCache()` | `core/library-state` | — |
| `toggleExpandedFolder()` | `core/library-state` | — |
| `LibraryLoadError()` | `core/load-manager` | [doc:adr-135] P0.2 加载错误结构化对象。 |
| `LoadPhase()` | `core/load-manager` | [doc:adr-135] P0.2 加载阶段标签。dispatch 内部按 phase 更新， 错误时包装进 LibraryLoadError，便于 formatError 加 |
| `LoadRequest()` | `core/load-manager` | — |
| `ResourceHandle()` | `core/load-manager` | — |
| `ResourceKind()` | `core/load-manager` | — |
| `loadManager()` | `core/load-manager` | 单例。 |
| `registerLibraryScannedHook()` | `core/load-refresh-registry` | 注册一个「库扫描完成」钩子。 |
| `registerLoadRefreshHook()` | `core/load-refresh-registry` | 注册一个「模型加载后刷新」钩子。 |
| `runLoadRefreshHooks()` | `core/load-refresh-registry` | 执行所有已注册的加载后刷新钩子。 |
| `logError()` | `core/logger` | 统一标签格式的 error 日志（走 console.error）。 |
| `logInfo()` | `core/logger` | 统一标签格式的 info 日志（走 console.info）。 |
| `logWarn()` | `core/logger` | 统一标签格式的 warn 日志。message 为空时省略中间空格；err 为空时不传第二个参数。 |
| `degToRad()` | `core/math-geometry` | 角度 → 弧度。 |
| `dist2d()` | `core/math-geometry` | 2D 欧几里得距离。 |
| `dist3d()` | `core/math-geometry` | 3D 欧几里得距离。 |
| `radToDeg()` | `core/math-geometry` | 弧度 → 角度。 |
| `hash2()` | `core/math/hash-noise` | 确定性整数哈希 → [0,1]。seed 相同则结果可复现。 |
| `hash2v()` | `core/math/hash-noise` | 二元组哈希 → [[0,1],[0,1]]。供 Voronoi 需要两个独立随机偏移的场景（焦散网状亮纹）。 |
| `valueNoise()` | `core/math/hash-noise` | 平滑值噪声 → [0,1]。四角哈希 + smoothstep 双线性插值。 |
| `MmarGlobal()` | `core/mmar-globals` | — |
| `MmarPhase()` | `core/mmar-globals` | — |
| `MmarSceneSnapshot()` | `core/mmar-globals` | — |
| `MmarStatus()` | `core/mmar-globals` | — |
| `refreshSceneSnapshot()` | `core/mmar-globals` | 刷新 window.__mmar.scene 快照。 |
| `startSceneSnapshotPolling()` | `core/mmar-globals` | 启动周期快照刷新；重复调用安全（仅注册一个 timer）。 |
| `stopSceneSnapshotPolling()` | `core/mmar-globals` | 停止周期快照刷新；未启动或重复调用均安全。 |
| `updateMmarStatus()` | `core/mmar-globals` | — |
| `CapabilityProbe()` | `core/mmd-adapter` | CapabilityProbe — 升级回归探测（ADR-192 Phase 2 守卫式反射）。 |
| `applyForceToModelRigidBodies()` | `core/mmd-adapter` | — |
| `applyForceToModelRigidBodiesNative()` | `core/mmd-adapter` | — |
| `applyWindForceToModelRigidBodiesNative()` | `core/mmd-adapter` | — |
| `getBoneWorldMatrix()` | `core/mmd-adapter` | 返回骨骼在世界坐标系下的 worldMatrix（固化自 adr-071 坐标系契约）。 |
| `getPhysicsImpl()` | `core/mmd-adapter` | 从 IMmdRuntime 获取底层 MmdWasmPhysicsRuntimeImpl。 |
| `getRigidBodyBundleMap()` | `core/mmd-adapter` | 返回所有 RigidBodyBundle 迭代器（条目 3 内化，ADR-192 Phase 2）。 |
| `getRigidBodyMap()` | `core/mmd-adapter` | 返回所有**单数** RigidBody 迭代器（路径1 修正，ADR-200）。 |
| `getStreamAudio()` | `core/mmd-adapter` | — |
| `onBoneMatricesUpdated()` | `core/mmd-adapter` | 在骨骼 worldMatrix 已被 babylon-mmd 更新之后、渲染之前注册回调。 |
| `solveIkNative()` | `core/mmd-adapter` | — |
| `switchAnimation()` | `core/mmd-adapter` | 切换模型当前动画到新动画，并归零运行时全局时钟到第 0 帧。 |
| `transformWorldToRootLocal()` | `core/mmd-adapter` | 把世界坐标系下的点转换到 rootMesh 局部坐标系（固化自 perception-gaze.ts / adr-071）。 |
| `ObserverHandle()` | `core/observer-handle` | 可释放的 Observer 句柄。 |
| `ObserverRegistry()` | `core/observer-handle` | 管理器：收集多个 ObserverHandle，支持一次性 disposeAll()。 |
| `observe()` | `core/observer-handle` | 订阅 Observable 并返回自动管理的句柄。 |
| `observeOnce()` | `core/observer-handle` | 一次性订阅：回调执行后自动移除，等价于 observable.addOnce()。 |
| `orbitInput()` | `core/orbit-state` | — |
| `MIN_ORBIT_DISTANCE()` | `core/orbit` | 轨道距离下限：distance&lt;=0 或非有限时钳制到此值，避免塌缩到原点或 NaN。 |
| `OrbitCoords()` | `core/orbit` | — |
| `cartesianToOrbit()` | `core/orbit` | 笛卡尔坐标 → 球面坐标。 |
| `normalizeOrbit()` | `core/orbit` | 钳制一组原始轨道参数为合法值域。 |
| `orbitToCartesian()` | `core/orbit` | 球面坐标 → 笛卡尔坐标。 |
| `computeLibraryRef()` | `core/path` | 纯函数：计算文件路径相对于 libraryRoot 的引用标识（相对路径）。 |
| `getBaseName()` | `core/path` | 跨平台取路径末段文件名。 |
| `getDirPath()` | `core/path` | 跨平台取父目录路径。根目录（无 `/`）返回空字符串。 |
| `isStageLike()` | `core/path` | 判断给定 kind/type 是否为「舞台类」（缩略图使用横屏 16:9 宽高比）。 |
| `isUnderRoot()` | `core/path` | [doc:adr-090][doc:adr-095] 路径归属判定（唯一实现，基于 normPath）。 |
| `normPath()` | `core/path` | 标准化路径：反斜杠 → 正斜杠，去掉尾部斜杠。 |
| `awaitWailsBridge()` | `core/platform` | Waits for the Wails bridge (window.wails) to be injected by the WebView. |
| `guardExternalAction()` | `core/platform` | Guards an external application action (Blender, MMD, etc.) that is not available on Androi |
| `isAndroidPlatform()` | `core/platform` | Returns true when running inside the Android WebView (Wails v3). |
| `isWebEntryMode()` | `core/platform` | [doc:adr-196/176] 运行时判定是否为 web 入口（短路标记或构建模式）。 |
| `isWebPlatform()` | `core/platform` | Returns true when running in a pure browser (no Wails bridge). |
| `openExternalLink()` | `core/platform` | 打开外链的统一入口：先尝试 Android `&lt;a&gt;.click()` 方式，失败则回退 `window.open`。 |
| `openExternalURL()` | `core/platform` | Opens a URL in the system browser. |
| `readDeclaredAdapter()` | `core/platform` | [doc:adr-196/176] 读取 globalThis 上声明的适配器身份（'go' | 'browser'）。 |
| `autoLoop()` | `core/playback-state` | — |
| `isPlaying()` | `core/playback-state` | [doc:architecture] Playback control store — ADR-141 split from core/state.ts. |
| `seekDragging()` | `core/playback-state` | — |
| `setAutoLoop()` | `core/playback-state` | — |
| `setIsPlaying()` | `core/playback-state` | — |
| `setSeekDragging()` | `core/playback-state` | — |
| `parsePmxComment()` | `core/pmx-meta` | 从 PMX 文件的 Uint8Array 中提取 comment（日本语说明/使用规约）。 |
| `PresetCategory()` | `core/preset-meta` | — |
| `PresetMeta()` | `core/preset-meta` | — |
| `listPresets()` | `core/preset-meta` | 跨系统枚举预设，归一为 `PresetMeta[]`。 |
| `toPresetMeta()` | `core/preset-meta` | 由单条记录构造 `PresetMeta`。`extra` 仅承载 envelope 字段，不触碰各系统原生 payload。 |
| `reactive()` | `core/reactivity` | — |
| `readonly()` | `core/reactivity` | Passthrough readonly — store 层通过约定保证不可变，不做深冻结。 |
| `scheduleRefresh()` | `core/reactivity` | 安排一次刷新（RAF 去抖）。 |
| `subscribe()` | `core/reactivity` | 注册一个刷新订阅者。返回取消订阅函数。 |
| `unsubscribeAll()` | `core/reactivity` | 清空所有刷新订阅者。供 initScene 重入时调用（ADR-106 D3 HMR 清理入口）。 |
| `RenderContext()` | `core/render-context` | 渲染期可注册自更新控件的最小上下文（由 SlideMenu 实现）。 |
| `getCurrentRenderingContext()` | `core/render-context` | 获取当前正在渲染的上下文（供控件函数自动注册）。 |
| `popRenderingContext()` | `core/render-context` | 退出当前渲染上下文（renderCustom 后调用，须在 finally 中配对）。 |
| `pushRenderingContext()` | `core/render-context` | 进入一个渲染上下文（renderCustom 前调用）。 |
| `calcHardwareScaling()` | `core/render-loop` | 根据 DPR + renderScale 计算安全的 hardwareScalingLevel， 钳位帧缓冲不超过 GL_MAX_TEXTURE_SIZE（防 DPR×render |
| `startRenderLoop()` | `core/render-loop` | 启动渲染循环（幂等：先停旧实例，避免 setInterval / render-loop 泄漏）。 |
| `stopRenderLoop()` | `core/render-loop` | 停止渲染循环并清理 FPS 时钟。 |
| `reportResourceWarning()` | `core/resource-warning-sink` | 上报一条资源加载警告（自动去重）。 |
| `EventCallback()` | `core/runtime-bridge` | — |
| `RuntimeBridge()` | `core/runtime-bridge` | — |
| `RuntimeBrowser()` | `core/runtime-bridge` | — |
| `RuntimeEvents()` | `core/runtime-bridge` | — |
| `Unsubscribe()` | `core/runtime-bridge` | — |
| `browser()` | `core/runtime-bridge` | — |
| `events()` | `core/runtime-bridge` | — |
| `getRuntimeBridge()` | `core/runtime-bridge` | — |
| `initRuntimeBridge()` | `core/runtime-bridge` | bootstrap 早期调用：桌面/Android 侧强制加载 @wailsio/runtime 并绑定 events 实例。 |
| `RuntimeMode()` | `core/runtime-mode` | — |
| `detectRuntimeMode()` | `core/runtime-mode` | 探测运行时模式（COOP/COEP + SharedArrayBuffer + MPR 构建标志）。 |
| `initRuntimeBadge()` | `core/runtime-mode` | bootstrap 早期调用：立即渲染上次持久化的模式，刷新后不丢失 |
| `loadPersistedRuntimeMode()` | `core/runtime-mode` | — |
| `persistRuntimeMode()` | `core/runtime-mode` | — |
| `renderRuntimeBadge()` | `core/runtime-mode` | — |
| `setBackendBadge()` | `core/runtime-mode` | 渲染实际选中的后端（go / browser）到运行时徽标，与 MPR/SPR 状态合成显示 |
| `Browser()` | `core/runtime-stub` | — |
| `Call()` | `core/runtime-stub` | — |
| `CancellablePromise()` | `core/runtime-stub` | — |
| `Events()` | `core/runtime-stub` | — |
| `safeCall()` | `core/safe-call` | 安全执行同步函数；异常时记录 logWarn(tag, msg, err) 并返回 undefined。 |
| `safeCallAsync()` | `core/safe-call` | 安全执行异步函数；异常时记录 logWarn(tag, msg, err)，返回的 Promise 解析为 undefined（不 reject），等价于 `promise.cat |
| `safeCallVoid()` | `core/safe-call` | 同 safeCall，但 fn 无返回值。 |
| `createDefaultFeetState()` | `core/scene-state` | [doc:adr-085] 脚部地面跟随默认状态（Phase A 参数） |
| `focusedModelId()` | `core/scene-state` | — |
| `getMmdRuntimeType()` | `core/scene-state` | — |
| `mmdRuntime()` | `core/scene-state` | — |
| `modelRegistry()` | `core/scene-state` | — |
| `setFocusedModelId()` | `core/scene-state` | — |
| `setMmdRuntime()` | `core/scene-state` | — |
| `setMmdRuntimeType()` | `core/scene-state` | — |
| `setModelRegistry()` | `core/scene-state` | — |
| `setKey()` | `core/set-key` | 泛型键值写入工具，避免大量 `obj[key] = value` 重复。 |
| `registerAppShortcuts()` | `core/shortcut-app` | — |
| `KeyBindingOverride()` | `core/shortcut-registry` | — |
| `ShortcutDef()` | `core/shortcut-registry` | — |
| `ShortcutWithBinding()` | `core/shortcut-registry` | — |
| `_resetShortcutRegistry()` | `core/shortcut-registry` | Reset all internal state — only for use in tests. |
| `exportKeyBindings()` | `core/shortcut-registry` | Get current custom bindings (for saving to uiState). |
| `formatKeyBinding()` | `core/shortcut-registry` | 格式化按键绑定为可读字符串，如 "Ctrl+1"、"Shift+←" |
| `getAllShortcuts()` | `core/shortcut-registry` | Get all registered shortcuts with their CURRENT effective bindings. |
| `getAriaKeyshortcuts()` | `core/shortcut-registry` | 将 ShortcutDef 格式化为 aria-keyshortcuts 值，如 "Control+1" |
| `initShortcutDispatcher()` | `core/shortcut-registry` | Initialize the dispatcher — call once at app startup. |
| `loadKeyBindings()` | `core/shortcut-registry` | Load custom bindings from persisted state (call at app init). |
| `registerShortcut()` | `core/shortcut-registry` | Register ONE shortcut. |
| `registerShortcuts()` | `core/shortcut-registry` | Register MULTIPLE shortcuts at once. |
| `resetAllKeyBindings()` | `core/shortcut-registry` | Reset ALL shortcuts to their default bindings. |
| `resetKeyBinding()` | `core/shortcut-registry` | Reset one shortcut to its default binding. |
| `setKeyBinding()` | `core/shortcut-registry` | Set custom key binding for a shortcut ID. |
| `envState()` | `core/state` | — |
| `applyHudVisibility()` | `core/status-bar` | 按 uiState 开关应用顶部 HUD 显隐：帧率时钟（#fpsClock）与多线程徽标（#runtimeBadge）。 |
| `disposeStatusBar()` | `core/status-bar` | 清理 status 定时器（供 HMR 清理入口调用）。 |
| `hideHint()` | `core/status-bar` | — |
| `hideLoadingStatus()` | `core/status-bar` | 隐藏底部状态栏的旋转加载图标，不改变当前文本。 |
| `initHints()` | `core/status-bar` | — |
| `setLoadingStatus()` | `core/status-bar` | 在底部状态栏显示带旋转图标的加载文本，用于消解用户"卡住焦虑"。 |
| `setStatus()` | `core/status-bar` | — |
| `showHint()` | `core/status-bar` | — |
| `tryCatchStatus()` | `core/status-helpers` | Execute a function with automatic error handling that shows errors in the status bar. |
| `withLoadingStatus()` | `core/status-helpers` | 包装一个异步操作，自动管理 loading → success → error 三态状态栏。 |
| `withLoadingStatusTargeted()` | `core/status-helpers` | 包装异步操作并附带目标名（target-aware 版本）。 |
| `registerServiceWorker()` | `core/sw-register` | — |
| `ToastAction()` | `core/toast` | — |
| `ToastVariant()` | `core/toast` | — |
| `showErrorToast()` | `core/toast` | — |
| `showInfoToast()` | `core/toast` | — |
| `showToast()` | `core/toast` | — |
| `BoneOverrideEntry()` | `core/types` | [doc:adr-061] Motion Override — 持久化的单条骨骼覆盖配置 |
| `BrowseOutcome()` | `core/types` | — |
| `CameraBehavior()` | `core/types` | ADR-100 轴 B — 运动行为：相机如何自动运动，仅当控制轴为 `orbit`(ArcRotate) 时生效。 |
| `CameraControl()` | `core/types` | ADR-100 轴 A — 控制方案：决定相机类 + 输入方式。 |
| `CameraMode()` | `core/types` | 保留为兼容别名（存档 / 旧调用点），新代码请用 {@link CameraControl} × {@link CameraBehavior}。 |
| `DisplayNamePriority()` | `core/types` | — |
| `EnvState()` | `core/types` | 从 schema 派生 EnvState interface（-readonly 保证可写）。[doc:adr-137] |
| `FeetState()` | `core/types` | [doc:adr-085] 脚部地面跟随（按模型）状态 |
| `LibraryModel()` | `core/types` | — |
| `LibrarySortMode()` | `core/types` | — |
| `MmdRuntimeBoneExtended()` | `core/types` | — |
| `MmdStandardMaterial()` | `core/types` | MmdStandardMaterial 扩展 — 用于材质系统和换装系统共享的类型定义 |
| `ModelInstance()` | `core/types` | — |
| `ModelKind()` | `core/types` | — |
| `ModelMotionSlots()` | `core/types` | [doc:adr-167] 单槽位：overlay 槽位已移除（ADR-144 废弃） |
| `MotionModuleState()` | `core/types` | [doc:adr-116] 模块语义状态（per-motion，随动作走） |
| `MotionPreset()` | `core/types` | [doc:adr-145] 动作预设 DTO |
| `MotionSlotConfig()` | `core/types` | 单个槽位的配置 |
| `MotionSource()` | `core/types` | 用户选择的「原始动作来源类型」——仅描述意图来源性质，不描述广播后的运行时产物。 |
| `OutfitFile()` | `core/types` | — |
| `OutfitSlot()` | `core/types` | — |
| `OutfitVariant()` | `core/types` | — |
| `OverridePaths()` | `core/types` | — |
| `ParamValue()` | `core/types` | [doc:adr-116] 动作覆盖模块语义参数值 |
| `PendingVmd()` | `core/types` | — |
| `PhysicsCategory()` | `core/types` | — |
| `PopupLevel()` | `core/types` | — |
| `PopupRow()` | `core/types` | — |
| `PresetModuleState()` | `core/types` | [doc:adr-145] 单模块在预设中的状态快照 |
| `ProcMotionConfig()` | `core/types` | [doc:adr-XX] 程序化动作配置（per-motion，随动作走） 参数存 SceneMotionIntent.procMotion（多角色共享）， 启用/分配权在每角色 |
| `ProcPreset()` | `core/types` | [audit] 程序化动作自定义预设（per-model 参数快照，仿 MotionPreset 模式）。 |
| `RecentMotion()` | `core/types` | — |
| `RuntimeModel()` | `core/types` | IMmdModel 接口不含 setRuntimeAnimation / createRuntimeAnimation （这两个方法在 MmdModel 和 MmdWasmMode |
| `SceneMotionIntent()` | `core/types` | 场景级动作意图（「场上在跳什么」） |
| `ScriptedSubMode()` | `core/types` | ADR-100 §6.4 — `scripted` 行为的子模式。 |
| `SlotSource()` | `core/types` | 槽位来源 |
| `UIState()` | `core/types` | — |
| `VmdLayer()` | `core/types` | VMD 动画图层 — 支持多 VMD 叠加（Motion Layers） |
| `addColorSliderRow()` | `core/ui-advanced-rows` | — |
| `addModeSlider()` | `core/ui-advanced-rows` | — |
| `addVector3SliderRow()` | `core/ui-advanced-rows` | — |
| `cardContainer()` | `core/ui-card` | Card container helper: removes render-card bg, wraps content in an lcard. |
| `addCollapsible()` | `core/ui-collapsible` | 通用折叠面板组件 |
| `addPresetChip()` | `core/ui-collapsible` | 创建一个 preset-chip 按钮并追加到 container（通常是 .preset-group div）。 |
| `addSectionTitle()` | `core/ui-collapsible` | 区块标题（section-title），用于 cardContainer 内的视觉分组。 |
| `AUTO_LINK_THRESHOLD_DEG()` | `core/ui-constants` | time-of-day 与 lighting 联动判定阈值（度） |
| `DEFAULT_GRAVITY()` | `core/ui-constants` | 默认重力（m/s²） |
| `ENV_LIGHT_MAX()` | `core/ui-constants` | 环境光强度上限 |
| `SCENE_EVENTS()` | `core/ui-constants` | 场景级事件字面量。使用此枚举替代散落的 'scene:xxx' 字面量。 |
| `SLIDER_QUARTER_LARGE_STEP()` | `core/ui-constants` | 左区大幅减步进：全范围 15% |
| `SLIDER_QUARTER_SMALL_STEP()` | `core/ui-constants` | 中左/中右微调步进：全范围 5% |
| `createFocusTrap()` | `core/ui-focus-trap` | — |
| `FullscreenOverlayHandle()` | `core/ui-fullscreen-overlay` | — |
| `FullscreenOverlayOptions()` | `core/ui-fullscreen-overlay` | — |
| `OverlayState()` | `core/ui-fullscreen-overlay` | — |
| `closeFullscreen()` | `core/ui-fullscreen-overlay` | — |
| `getCurrentState()` | `core/ui-fullscreen-overlay` | — |
| `openFullscreen()` | `core/ui-fullscreen-overlay` | — |
| `setCurrentState()` | `core/ui-fullscreen-overlay` | — |
| `HeaderToggleConfig()` | `core/ui-header-toggle` | — |
| `createHeaderToggle()` | `core/ui-header-toggle` | 创建标题栏小型开关。返回 `&lt;label class="toggle header-toggle"&gt;`， 含双触发去重（跳过 target===input 的 synthetic |
| `addActionRow()` | `core/ui-helpers` | — |
| `addBoneSelectRow()` | `core/ui-helpers` | — |
| `addCardTitle()` | `core/ui-helpers` | — |
| `addClearRow()` | `core/ui-helpers` | — |
| `addCollapsible()` | `core/ui-helpers` | — |
| `addColorSliderRow()` | `core/ui-helpers` | — |
| `addDangerRow()` | `core/ui-helpers` | — |
| `addDisabledRow()` | `core/ui-helpers` | — |
| `addEmptyRow()` | `core/ui-helpers` | — |
| `addFieldRow()` | `core/ui-helpers` | — |
| `addInfoCard()` | `core/ui-helpers` | — |
| `addInfoGrid()` | `core/ui-helpers` | — |
| `addInlineToggleRow()` | `core/ui-helpers` | — |
| `addModeRow()` | `core/ui-helpers` | — |
| `addModeSlider()` | `core/ui-helpers` | — |
| `addPresetChip()` | `core/ui-helpers` | — |
| `addSectionTitle()` | `core/ui-helpers` | — |
| `addSliderRow()` | `core/ui-helpers` | — |
| `addToggleRow()` | `core/ui-helpers` | — |
| `addVector3SliderRow()` | `core/ui-helpers` | — |
| `addWatchDirRow()` | `core/ui-helpers` | — |
| `buildBoneGroups()` | `core/ui-helpers` | — |
| `buildPresetChipGroup()` | `core/ui-helpers` | — |
| `cardContainer()` | `core/ui-helpers` | — |
| `closeFullscreen()` | `core/ui-helpers` | — |
| `createHeaderToggle()` | `core/ui-helpers` | — |
| `createIconButton()` | `core/ui-helpers` | — |
| `createResourcePanel()` | `core/ui-helpers` | — |
| `createVirtualGrid()` | `core/ui-helpers` | — |
| `getCurrentState()` | `core/ui-helpers` | — |
| `initControl()` | `core/ui-helpers` | — |
| `isIkBone()` | `core/ui-helpers` | — |
| `openFullscreen()` | `core/ui-helpers` | — |
| `setCurrentState()` | `core/ui-helpers` | — |
| `slideRow()` | `core/ui-helpers` | — |
| `sliderRow()` | `core/ui-helpers` | — |
| `toggleRow()` | `core/ui-helpers` | — |
| `withLoadingIndicator()` | `core/ui-helpers` | — |
| `KeyboardNavOptions()` | `core/ui-keyboard-nav` | — |
| `NavKeyKind()` | `core/ui-keyboard-nav` | 导航按键分类：垂直移动 / 水平移动，供 perKeySkip 差异化判断 |
| `createKeyboardNav()` | `core/ui-keyboard-nav` | — |
| `withLoadingIndicator()` | `core/ui-loading` | 加载指示器包裹器：显示 loading 遮罩 → 执行 fn → `finally` 隐藏。 |
| `NAV_ADJUST_ATTR()` | `core/ui-nav-item` | — |
| `NAV_FOCUS_ATTR()` | `core/ui-nav-item` | — |
| `NAV_GROUP_ATTR()` | `core/ui-nav-item` | — |
| `NAV_ITEM_ATTR()` | `core/ui-nav-item` | 导航项标记属性名 |
| `NAV_ITEM_SELECTOR()` | `core/ui-nav-item` | 方向键导航项统一选择器（panelItems 用） |
| `NavItemOptions()` | `core/ui-nav-item` | — |
| `markNavItem()` | `core/ui-nav-item` | 给一个行元素打上方向键导航项标记。控件工厂在创建行后调用一次即可， 无需再改 menu.ts。 |
| `navFocusTarget()` | `core/ui-nav-item` | 读取行的内部聚焦目标（缺省返回行本身） |
| `navGroupMove()` | `core/ui-nav-item` | 组内 ←→ 移动焦点：在 row 的组内子项间循环移动，返回是否处理了该键。 |
| `navGroupSelector()` | `core/ui-nav-item` | 读取组行的组内子项 selector（非组行返回 null） |
| `navHasHorizontalAdjust()` | `core/ui-nav-item` | 该行是否声明了 ←→ 水平调值（菜单应让位） |
| `PresetChipItem()` | `core/ui-preset` | 单个预设芯片的描述。 |
| `addClearRow()` | `core/ui-preset` | 渲染一行右对齐的「清除」按钮（统一 cs-btn cs-btn-sm 样式）。 |
| `buildPresetChipGroup()` | `core/ui-preset` | 渲染一组 preset-chip（统一 .preset-group 容器 + addPresetChip 布局）。 |
| `ResourceItem()` | `core/ui-resource-panel` | — |
| `ResourcePanelHandle()` | `core/ui-resource-panel` | — |
| `ResourcePanelOptions()` | `core/ui-resource-panel` | — |
| `createResourcePanel()` | `core/ui-resource-panel` | — |
| `notifyThumbnailUpdate()` | `core/ui-resource-panel` | — |
| `BoneSelectOptions()` | `core/ui-rows` | — |
| `addActionRow()` | `core/ui-rows` | 创建一个可点击的操作按钮行（替代手写 cs-row + button）。 |
| `addBoneSelectRow()` | `core/ui-rows` | 创建骨骼选择行：label + 搜索框 + 分组下拉（含 IK 标记）。 |
| `addCardTitle()` | `core/ui-rows` | 创建 card-title 标题行并追加到容器 |
| `addDangerRow()` | `core/ui-rows` | 创建危险操作行（icon + red label），替代手动拼接 `div.slide-item &gt; icon + label.danger-text` |
| `addDisabledRow()` | `core/ui-rows` | 创建一个不可交互的提示行（替代手写 cs-row + opacity 0.4 + pointer-events none）。 |
| `addEmptyRow()` | `core/ui-rows` | 创建空状态占位行（灰色文字，不可点击），替代手动 `el.style.opacity = '0.5'` 模式 |
| `addFieldRow()` | `core/ui-rows` | 创建字段行（左 label + 右 value），替代手动拼接的 `div.slide-item &gt; span.slide-label.field-label + span.fie |
| `addInfoCard()` | `core/ui-rows` | — |
| `addInfoGrid()` | `core/ui-rows` | — |
| `addInlineToggleRow()` | `core/ui-rows` | 创建一个内联 toggle 行（替代手写 toggle-row + toggle-label + toggle-switch）。 |
| `addModeRow()` | `core/ui-rows` | — |
| `addSliderRow()` | `core/ui-rows` | 数字滑块行。ADR-140：内部统一由 {@link DragSliderController} 驱动 （拖拽 + 键盘 + 游标点击），行为与其他滑块 builder 保持一致。 |
| `addToggleRow()` | `core/ui-rows` | — |
| `addWatchDirRow()` | `core/ui-rows` | — |
| `buildBoneGroups()` | `core/ui-rows` | 按类别分组骨骼名，未匹配的归入「その他」。空组被剔除。 |
| `initControl()` | `core/ui-rows` | 封装 registerControl + immediate update 模式。 |
| `isIkBone()` | `core/ui-rows` | [doc:adr-122 P3] 判断骨骼是否为 IK 相关骨骼 |
| `sliderRow()` | `core/ui-rows` | — |
| `toggleRow()` | `core/ui-rows` | — |
| `SlideRowExtra()` | `core/ui-slide-row` | — |
| `TrailingAction()` | `core/ui-slide-row` | — |
| `createLeadingBtn()` | `core/ui-slide-row` | 统一左侧行为区按钮工厂——镜像 createTrailingBtn，但渲染为 21px 透明可点击 `.slide-lead-btn`（复用 .slide-icon 尺寸，非 22 |
| `createTrailingBtn()` | `core/ui-slide-row` | 统一尾部第二动作按钮工厂——供 slideRow 与 menu.ts createRow 共用， 确保两条渲染路径的第二按钮观感与行为一致（22px .slide-add-btn； |
| `slideRow()` | `core/ui-slide-row` | — |
| `DragSliderController()` | `core/ui-slider-controller` | — |
| `DragSliderOptions()` | `core/ui-slider-controller` | — |
| `activeTimeOfDayPreset()` | `core/ui-state` | 当前选中的 time-of-day 预设 key。预设芯片高亮唯一来源，env-menu 顶层与 sky 子菜单共享同一状态。 |
| `isAutoLoadCompanionAudioEnabled()` | `core/ui-state` | 加载 VMD 动作时自动发现并加载同目录同名音频（.mp3/.wav/.ogg/.flac）。默认开启。 |
| `popupOpen()` | `core/ui-state` | — |
| `setActiveTimeOfDayPreset()` | `core/ui-state` | — |
| `setPopupOpen()` | `core/ui-state` | — |
| `setUIPersistCallback()` | `core/ui-state` | — |
| `setUIState()` | `core/ui-state` | — |
| `uiState()` | `core/ui-state` | — |
| `ControlOptions()` | `core/ui-types` | 控件通用选项：支持 bind 自动更新或 onUpdate 手动更新 |
| `VirtualGridHandle()` | `core/ui-virtual-grid` | — |
| `VirtualGridOptions()` | `core/ui-virtual-grid` | — |
| `createVirtualGrid()` | `core/ui-virtual-grid` | — |
| `generateUuid()` | `core/uuid` | 生成 UUID v4 字符串（格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx）。 |
| `AddCustomSoftware()` | `core/wails-bindings` | — |
| `AddRecentModel()` | `core/wails-bindings` | — |
| `AddTag()` | `core/wails-bindings` | — |
| `BundleScene()` | `core/wails-bindings` | — |
| `CheckForUpdate()` | `core/wails-bindings` | — |
| `CleanOrphanCache()` | `core/wails-bindings` | — |
| `ClearAllCaches()` | `core/wails-bindings` | — |
| `ClearExtractCache()` | `core/wails-bindings` | — |
| `ClearThumbnailCache()` | `core/wails-bindings` | — |
| `ClosePlazaWindow()` | `core/wails-bindings` | — |
| `DeleteEnvPreset()` | `core/wails-bindings` | — |
| `DeleteModelPreset()` | `core/wails-bindings` | — |
| `DeletePresetScene()` | `core/wails-bindings` | — |
| `DownloadAndRunInstaller()` | `core/wails-bindings` | — |
| `DownloadApk()` | `core/wails-bindings` | — |
| `DownloadFromPlaza()` | `core/wails-bindings` | — |
| `Events()` | `core/wails-bindings` | — |
| `ExtractZip()` | `core/wails-bindings` | — |
| `FetchPlazaConfig()` | `core/wails-bindings` | — |
| `FileExists()` | `core/wails-bindings` | — |
| `GetAllTags()` | `core/wails-bindings` | — |
| `GetBuildInfo()` | `core/wails-bindings` | — |
| `GetCacheStats()` | `core/wails-bindings` | — |
| `GetCachedPlazaConfig()` | `core/wails-bindings` | — |
| `GetConfig()` | `core/wails-bindings` | — |
| `GetDownloadAutoImport()` | `core/wails-bindings` | — |
| `GetDownloadWatchEnabled()` | `core/wails-bindings` | — |
| `GetDownloadWatchStatus()` | `core/wails-bindings` | — |
| `GetLastBrowseDir()` | `core/wails-bindings` | — |
| `GetLibraryIndex()` | `core/wails-bindings` | — |
| `GetModelMetaBatch()` | `core/wails-bindings` | — |
| `GetModelPresets()` | `core/wails-bindings` | — |
| `GetModelsByTag()` | `core/wails-bindings` | — |
| `GetPresetScenes()` | `core/wails-bindings` | — |
| `GetPresetScenesDir()` | `core/wails-bindings` | — |
| `GetRecentModels()` | `core/wails-bindings` | — |
| `GetRenderPresets()` | `core/wails-bindings` | — |
| `GetStorageMode()` | `core/wails-bindings` | — |
| `GetSystemA11ySettings()` | `core/wails-bindings` | — |
| `GetTagsByModel()` | `core/wails-bindings` | — |
| `GetThumbnail()` | `core/wails-bindings` | — |
| `ImportLocalFile()` | `core/wails-bindings` | — |
| `ImportZip()` | `core/wails-bindings` | — |
| `IsolateModelDir()` | `core/wails-bindings` | — |
| `LaunchSoftware()` | `core/wails-bindings` | — |
| `ListDirRecursive()` | `core/wails-bindings` | — |
| `ListEnvPresets()` | `core/wails-bindings` | — |
| `ListSubDirs()` | `core/wails-bindings` | — |
| `LoadEnvPreset()` | `core/wails-bindings` | — |
| `LoadLastScene()` | `core/wails-bindings` | — |
| `LoadModelPreset()` | `core/wails-bindings` | — |
| `LoadModelPresetFromLib()` | `core/wails-bindings` | — |
| `LoadOutfitFile()` | `core/wails-bindings` | — |
| `LoadSceneFile()` | `core/wails-bindings` | — |
| `NavigatePlazaWindow()` | `core/wails-bindings` | — |
| `OpenCacheDir()` | `core/wails-bindings` | — |
| `OpenScreenshotDir()` | `core/wails-bindings` | — |
| `OpenWithSoftware()` | `core/wails-bindings` | — |
| `PlazaGoBack()` | `core/wails-bindings` | — |
| `PlazaGoForward()` | `core/wails-bindings` | — |
| `PlazaReload()` | `core/wails-bindings` | — |
| `PlazaZoomIn()` | `core/wails-bindings` | — |
| `PlazaZoomOut()` | `core/wails-bindings` | — |
| `PlazaZoomReset()` | `core/wails-bindings` | — |
| `ReadTextFile()` | `core/wails-bindings` | — |
| `RemoveCustomSoftware()` | `core/wails-bindings` | — |
| `RemoveTag()` | `core/wails-bindings` | — |
| `SaveEnvPresetAuto()` | `core/wails-bindings` | — |
| `SaveLastScene()` | `core/wails-bindings` | — |
| `SaveModelPreset()` | `core/wails-bindings` | — |
| `SaveModelPresetToLibAuto()` | `core/wails-bindings` | — |
| `SavePlazaConfig()` | `core/wails-bindings` | — |
| `SaveRenderPreset()` | `core/wails-bindings` | — |
| `SaveScenePreset()` | `core/wails-bindings` | — |
| `SaveScreenshot()` | `core/wails-bindings` | — |
| `SaveThumbnail()` | `core/wails-bindings` | — |
| `ScanModelDir()` | `core/wails-bindings` | — |
| `ScanSoftwareDir()` | `core/wails-bindings` | — |
| `SelectBundleSaveFile()` | `core/wails-bindings` | — |
| `SelectDir()` | `core/wails-bindings` | — |
| `SelectExeFile()` | `core/wails-bindings` | — |
| `SelectImportFile()` | `core/wails-bindings` | — |
| `SelectPresetOpenFile()` | `core/wails-bindings` | — |
| `SelectPresetSaveFile()` | `core/wails-bindings` | — |
| `SelectRetargetFile()` | `core/wails-bindings` | — |
| `SelectSceneOpenFile()` | `core/wails-bindings` | — |
| `SetBlenderPath()` | `core/wails-bindings` | — |
| `SetDisplayNamePriority()` | `core/wails-bindings` | — |
| `SetDownloadAutoImport()` | `core/wails-bindings` | — |
| `SetDownloadWatchDir()` | `core/wails-bindings` | — |
| `SetDownloadWatchEnabled()` | `core/wails-bindings` | — |
| `SetEnvState()` | `core/wails-bindings` | — |
| `SetLastBrowseDir()` | `core/wails-bindings` | — |
| `SetMMDPath()` | `core/wails-bindings` | — |
| `SetOverridePath()` | `core/wails-bindings` | — |
| `SetPerformanceMode()` | `core/wails-bindings` | — |
| `SetResourceRoot()` | `core/wails-bindings` | — |
| `SetStorageMode()` | `core/wails-bindings` | — |
| `SetUIAccent()` | `core/wails-bindings` | — |
| `SetUIAnimations()` | `core/wails-bindings` | — |
| `SetUIAutoUpdate()` | `core/wails-bindings` | — |
| `SetUIBlurBg()` | `core/wails-bindings` | — |
| `SetUIFontFamily()` | `core/wails-bindings` | — |
| `SetUIPopupWidth()` | `core/wails-bindings` | — |
| `SetUIScale()` | `core/wails-bindings` | — |
| `SetUIState()` | `core/wails-bindings` | — |
| `StartFileServer()` | `core/wails-bindings` | — |
| `StartProxy()` | `core/wails-bindings` | — |
| `StopProxy()` | `core/wails-bindings` | — |
| `UpdateCustomSoftware()` | `core/wails-bindings` | — |
| `WriteTextFile()` | `core/wails-bindings` | — |
| `readFileBytes()` | `core/wails-bindings` | 读取文件为 Uint8Array（go：自动解码 Wails v3 base64；browser：IndexedDB/FSA 直读）。 |
| `getWindVector()` | `core/wind-utils` | 返回当前风矢量（方向 × 速度），风未生效时返回零向量。 |
| `isWindActive()` | `core/wind-utils` | 风向是否生效（windEnabled 且 windSpeed &gt; 0.01，过滤浮点噪声 / 滑条零位残留）。 |

## 3D 场景

| 符号 | 文件 | 说明 |
|------|------|------|
| `CameraFacing()` | `scene/ar/ar-camera` | — |
| `captureARScreenshot()` | `scene/ar/ar-camera` | 截取 AR 合成画面（视频底 + 3D 模型层）。 |
| `getARFacing()` | `scene/ar/ar-camera` | — |
| `isARActive()` | `scene/ar/ar-camera` | — |
| `isARMirrored()` | `scene/ar/ar-camera` | 当前是否镜像显示。 |
| `setARMirror()` | `scene/ar/ar-camera` | 设置是否镜像显示（前置默认镜像，后置默认不镜像）。用户手动调用后标记为 overridden，切换摄像头时保持用户设置。 |
| `startARCamera()` | `scene/ar/ar-camera` | 启动 AR 摄像头并显示视频背景。 |
| `stopARCamera()` | `scene/ar/ar-camera` | 停止 AR 摄像头，释放资源并隐藏视频背景。 |
| `switchARCameraFacing()` | `scene/ar/ar-camera` | 切换前后摄像头。 |
| `isARModeActive()` | `scene/ar/ar-scene` | — |
| `setARMode()` | `scene/ar/ar-scene` | 切换 AR 模式（摄像头视频背景 + 透明 canvas）。 |
| `takeARScreenshot()` | `scene/ar/ar-scene` | AR 合成截图（视频底 + 3D 层），供截图功能调用。异步版（ADR-017 A2-04）。 |
| `WebXRProbeResult()` | `scene/ar/ar-webxr-probe` | — |
| `formatProbeReport()` | `scene/ar/ar-webxr-probe` | 格式化探针结果为人类可读的多行文本（用于 UI 展示或复制到剪贴板）。 |
| `probeWebXR()` | `scene/ar/ar-webxr-probe` | 执行 WebXR 支持度探针（非侵入式，不请求 session）。 |
| `probeWebXRFeatures()` | `scene/ar/ar-webxr-probe` | 深度探针：实际创建 immersive-ar session 验证特性可用性。 |
| `getAutoCameraBeatsPerSwitch()` | `scene/camera/camera-auto` | — |
| `isAutoCameraEnabled()` | `scene/camera/camera-auto` | — |
| `restoreAutoCameraState()` | `scene/camera/camera-auto` | 从 UIState 恢复自动机位状态。ADR-100 P2：恢复时集中订阅并派生 beatcut 行为，修复饥饿。 |
| `setAutoCameraBeatsPerSwitch()` | `scene/camera/camera-auto` | 设置每多少拍切换一次镜头。 |
| `setAutoCameraEnabled()` | `scene/camera/camera-auto` | 设置 Auto Camera（beatcut）开关。ADR-100 P2：启用时集中订阅 beat、派生 beatcut 行为； 禁用时移除订阅并回落基底行为。beatDetect |
| `setSyncAxesCallback()` | `scene/camera/camera-auto` | camera.ts 启动时注入 _syncAxesFromMode 回调。 |
| `initFreeflyTouch()` | `scene/camera/camera-behaviors` | — |
| `initFreeflyUpdate()` | `scene/camera/camera-behaviors` | — |
| `initOrbitUpdate()` | `scene/camera/camera-behaviors` | — |
| `startConcert()` | `scene/camera/camera-behaviors` | — |
| `startSurround()` | `scene/camera/camera-behaviors` | — |
| `stopConcert()` | `scene/camera/camera-behaviors` | — |
| `stopFreefly()` | `scene/camera/camera-behaviors` | — |
| `stopOrbit()` | `scene/camera/camera-behaviors` | — |
| `stopSurround()` | `scene/camera/camera-behaviors` | — |
| `getBoneLockDamping()` | `scene/camera/camera-bone-lock` | 获取骨骼锁定跟随阻尼（0 = 刚性，越大越平滑）。 |
| `getFocusedModelBoneNames()` | `scene/camera/camera-bone-lock` | 获取当前焦点模型的所有骨骼名称列表。 |
| `getOrbitBoneLock()` | `scene/camera/camera-bone-lock` | 获取当前骨骼锁定状态。 |
| `restoreBoneLockIfEnabled()` | `scene/camera/camera-bone-lock` | 切回 orbit 时由 camera.ts switchCameraMode 调用：若骨骼锁仍处于启用状态， 重启每帧跟随 observer。修复"切出 orbit → stopB |
| `setBoneLockDamping()` | `scene/camera/camera-bone-lock` | 设置骨骼锁定跟随阻尼，范围 [0, 0.95]。 |
| `setOrbitBoneLock()` | `scene/camera/camera-bone-lock` | 启用/禁用轨道相机骨骼锁定。启用后相机 target 每帧锁定到指定骨骼的世界位置。 |
| `stopBoneLock()` | `scene/camera/camera-bone-lock` | 供 camera.ts switchCameraMode 切出 orbit 时调用，强制停止骨骼锁定（保留启用状态供切回恢复）。 |
| `applyCameraUserSettings()` | `scene/camera/camera-factory` | 将用户灵敏度设置应用到相机实例（orbit/oneshot: ArcRotate；freefly: Universal） |
| `createConcertCamera()` | `scene/camera/camera-factory` | Concert (fan-cam): limited horizontal sweep + sinusoidal vertical bob around the target. |
| `createFreeflyCamera()` | `scene/camera/camera-factory` | — |
| `createOneshotCamera()` | `scene/camera/camera-factory` | — |
| `createOrbitCamera()` | `scene/camera/camera-factory` | — |
| `createSurroundCamera()` | `scene/camera/camera-factory` | — |
| `disposeViewMatrixHandle()` | `scene/camera/camera-factory` | 显式 dispose 当前 viewMatrix observer（switchCameraMode 切换相机时调用）。 |
| `refreshCameraUserSettings()` | `scene/camera/camera-factory` | 设置变更后重新应用到当前活动相机 |
| `setSchedulePersistCallback()` | `scene/camera/camera-factory` | camera.ts 启动时注入 scheduleCameraPersist 回调。 |
| `CameraBehavior()` | `scene/camera/camera-state` | ADR-100 轴 B — 运动行为（仅对 orbit/ArcRotate 生效，初版互斥）。双写于 `core/types.ts`。 |
| `CameraControl()` | `scene/camera/camera-state` | ADR-100 轴 A — 控制方案（相机类 + 输入）。双写于 `core/types.ts`。 |
| `CameraMode()` | `scene/camera/camera-state` | 新代码请用 {@link CameraControl} × {@link CameraBehavior}。双写于 `core/types.ts`。 |
| `CameraPreset()` | `scene/camera/camera-state` | Per-mode parameter bundle, persisted with scene files. |
| `ConcertParams()` | `scene/camera/camera-state` | Concert (fan-cam) camera parameters — limited horizontal sweep + sinusoidal vertical bob. |
| `FreeflyParams()` | `scene/camera/camera-state` | Freefly camera parameters. |
| `OrbitParams()` | `scene/camera/camera-state` | Orbit camera parameters. |
| `ScriptedSubMode()` | `scene/camera/camera-state` | ADR-100 §6.4 — scripted 行为子态。 |
| `SurroundParams()` | `scene/camera/camera-state` | Surround (turntable) camera parameters — automatic full-circle orbit around target. |
| `clearCameraVmdState()` | `scene/camera/camera-state` | — |
| `defaultCameraPreset()` | `scene/camera/camera-state` | — |
| `getAutoCameraBeatCount()` | `scene/camera/camera-state` | — |
| `getAutoCameraPresetIdx()` | `scene/camera/camera-state` | — |
| `getCameraBehavior()` | `scene/camera/camera-state` | — |
| `getCameraCanvas()` | `scene/camera/camera-state` | — |
| `getCameraControl()` | `scene/camera/camera-state` | — |
| `getCameraMode()` | `scene/camera/camera-state` | — |
| `getCameraPreset()` | `scene/camera/camera-state` | — |
| `getCameraScene()` | `scene/camera/camera-state` | — |
| `getCameraVmdName()` | `scene/camera/camera-state` | — |
| `getCameraVmdPath()` | `scene/camera/camera-state` | — |
| `getConcertParams()` | `scene/camera/camera-state` | — |
| `getConcertPaused()` | `scene/camera/camera-state` | — |
| `getCurrentCamera()` | `scene/camera/camera-state` | — |
| `getFocusCenterY()` | `scene/camera/camera-state` | — |
| `getFov()` | `scene/camera/camera-state` | — |
| `getFreeflyParams()` | `scene/camera/camera-state` | — |
| `getOrbitParams()` | `scene/camera/camera-state` | — |
| `getPreviousMode()` | `scene/camera/camera-state` | — |
| `getScriptedSubMode()` | `scene/camera/camera-state` | — |
| `getSurroundParams()` | `scene/camera/camera-state` | — |
| `getSurroundPaused()` | `scene/camera/camera-state` | — |
| `getViewMatrixHandle()` | `scene/camera/camera-state` | — |
| `hasCameraVmd()` | `scene/camera/camera-state` | — |
| `isAutoCameraEnabled()` | `scene/camera/camera-state` | — |
| `isTouchDevice()` | `scene/camera/camera-state` | — |
| `setAutoCameraBeatCount()` | `scene/camera/camera-state` | — |
| `setAutoCameraEnabledFlag()` | `scene/camera/camera-state` | — |
| `setAutoCameraPresetIdx()` | `scene/camera/camera-state` | — |
| `setCameraBehavior()` | `scene/camera/camera-state` | — |
| `setCameraCanvas()` | `scene/camera/camera-state` | — |
| `setCameraControl()` | `scene/camera/camera-state` | — |
| `setCameraMode()` | `scene/camera/camera-state` | — |
| `setCameraPreset()` | `scene/camera/camera-state` | — |
| `setCameraScene()` | `scene/camera/camera-state` | — |
| `setCameraVmdState()` | `scene/camera/camera-state` | — |
| `setConcertPaused()` | `scene/camera/camera-state` | — |
| `setCurrentCamera()` | `scene/camera/camera-state` | — |
| `setFocusCenterY()` | `scene/camera/camera-state` | — |
| `setFov()` | `scene/camera/camera-state` | — |
| `setPreviousMode()` | `scene/camera/camera-state` | — |
| `setScriptedSubMode()` | `scene/camera/camera-state` | — |
| `setSurroundPaused()` | `scene/camera/camera-state` | — |
| `setViewMatrixHandle()` | `scene/camera/camera-state` | — |
| `animateCameraVmd()` | `scene/camera/camera-vmd` | Animate the VMD camera to a given 30fps frame time. |
| `clearCameraVmd()` | `scene/camera/camera-vmd` | — |
| `createVmdCamera()` | `scene/camera/camera-vmd` | 创建 VMD 相机（若已存在则复用）。供 camera.ts switchCameraMode 在 vmd 分支使用。 |
| `hasCameraAnimationHandle()` | `scene/camera/camera-vmd` | VMD 相机动画句柄是否就绪（switchCameraMode 在 vmd 分支前置检查）。 |
| `loadCameraVmd()` | `scene/camera/camera-vmd` | Load camera animation from a VMD (MmdAnimation) and create an MmdCamera. |
| `setSwitchCameraModeCallback()` | `scene/camera/camera-vmd` | camera.ts 启动时注入 switchCameraMode 回调。 |
| `CameraState()` | `scene/camera/camera` | — |
| `LEGACY_MODE_MAP()` | `scene/camera/camera` | ADR-100 §6.1 — 旧模式 → 双轴映射（迁移 / shim 共用）。 |
| `_syncAxesFromMode()` | `scene/camera/camera` | ADR-100：由旧 mode 派生双轴状态。switchCameraMode 提交 _cameraMode 时同步调用，作为唯一写入点。 |
| `animateCameraVmd()` | `scene/camera/camera` | — |
| `autoFrame()` | `scene/camera/camera` | Auto-frame the camera to centre on a bounding box. |
| `clearCameraVmd()` | `scene/camera/camera` | — |
| `defaultCameraPreset()` | `scene/camera/camera` | — |
| `deriveLegacyMode()` | `scene/camera/camera` | ADR-100 §6.2 — 双轴 → 旧模式反查（getCameraState 降级双写 / shim 内部路由）。 |
| `getAutoCameraBeatsPerSwitch()` | `scene/camera/camera` | — |
| `getBoneLockDamping()` | `scene/camera/camera` | — |
| `getCameraBehavior()` | `scene/camera/camera` | — |
| `getCameraControl()` | `scene/camera/camera` | — |
| `getCameraMode()` | `scene/camera/camera` | — |
| `getCameraState()` | `scene/camera/camera` | — |
| `getCameraVmdName()` | `scene/camera/camera` | — |
| `getCameraVmdPath()` | `scene/camera/camera` | — |
| `getConcertParams()` | `scene/camera/camera` | — |
| `getConcertPaused()` | `scene/camera/camera` | — |
| `getCurrentCamera()` | `scene/camera/camera` | — |
| `getFocusedModelBoneNames()` | `scene/camera/camera` | — |
| `getFov()` | `scene/camera/camera` | — |
| `getFreeflyParams()` | `scene/camera/camera` | — |
| `getOrbitBoneLock()` | `scene/camera/camera` | — |
| `getOrbitParams()` | `scene/camera/camera` | — |
| `getScriptedSubMode()` | `scene/camera/camera` | — |
| `getSurroundParams()` | `scene/camera/camera` | — |
| `getSurroundPaused()` | `scene/camera/camera` | — |
| `hasCameraVmd()` | `scene/camera/camera` | — |
| `initCameraSystem()` | `scene/camera/camera` | Initialise the camera system and create the default Orbit camera. |
| `isAutoCameraEnabled()` | `scene/camera/camera` | — |
| `loadCameraVmd()` | `scene/camera/camera` | — |
| `logCameraAlpha()` | `scene/camera/camera` | Log current camera alpha for diagnostics. |
| `refreshCameraUserSettings()` | `scene/camera/camera` | — |
| `restoreAutoCameraState()` | `scene/camera/camera` | — |
| `setAutoCameraBeatsPerSwitch()` | `scene/camera/camera` | — |
| `setAutoCameraEnabled()` | `scene/camera/camera` | — |
| `setBoneLockDamping()` | `scene/camera/camera` | — |
| `setCameraBehavior()` | `scene/camera/camera` | ADR-100 P4 — 直接设置运动行为轴（轴 B，仅 orbit 有效）。 |
| `setCameraControl()` | `scene/camera/camera` | ADR-100 P4 — 直接设置控制方案轴（轴 A）。 |
| `setCameraPreset()` | `scene/camera/camera` | — |
| `setCameraState()` | `scene/camera/camera` | — |
| `setConcertParams()` | `scene/camera/camera` | — |
| `setConcertPaused()` | `scene/camera/camera` | — |
| `setFov()` | `scene/camera/camera` | — |
| `setFreeflyParams()` | `scene/camera/camera` | — |
| `setOrbitBoneLock()` | `scene/camera/camera` | — |
| `setOrbitParams()` | `scene/camera/camera` | — |
| `setSurroundParams()` | `scene/camera/camera` | — |
| `setSurroundPaused()` | `scene/camera/camera` | — |
| `setSyncAxesCallback()` | `scene/camera/camera` | — |
| `switchCameraMode()` | `scene/camera/camera` | Switch to a different camera mode, preserving position as much as possible. |
| `InvertableArcRotateCameraPointersInput()` | `scene/camera/invertablePointersInput` | 可反转 Y 轴的 ArcRotate 相机指针输入。 |
| `applyEnvStateFacade()` | `scene/env/_bridge/env-bridge` | 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。 |
| `registerEnvStateMiddleware()` | `scene/env/_bridge/env-bridge` | 注册 setEnvState 中间件（供 env-time-of-day/env-gravity 等子模块调用） |
| `setEnvState()` | `scene/env/_bridge/env-bridge` | 环境状态唯一写入入口（ADR-173 中间件链），可选跳过自动保存。 |
| `setPresetAnimActive()` | `scene/env/_bridge/env-bridge` | 标记预设动画是否运行中（供 _applyEnvStateFacade 跳过方向光同步） |
| `clearAllEnvCallbacks()` | `scene/env/_bridge/env-dispatcher` | 清空所有已注册的 env 回调（场景销毁 / HMR 重入时兜底清理）。 |
| `clearEnvDtTickCallbacks()` | `scene/env/_bridge/env-dispatcher` | 清空所有 dt 回调（场景销毁 / HMR 重入时清理）。 |
| `clearSceneTickCallbacks()` | `scene/env/_bridge/env-dispatcher` | 清空所有场景 tick 回调（场景销毁 / HMR 重入时清理）。 |
| `dispatchEnvChange()` | `scene/env/_bridge/env-dispatcher` | setEnvState 调用此函数分发变化。 |
| `registerEnvCallback()` | `scene/env/_bridge/env-dispatcher` | 子系统注册响应回调（延迟绑定，避免循环导入）。 |
| `registerEnvDtTickCallback()` | `scene/env/_bridge/env-dispatcher` | 注册每帧 dt 回调（env-impl 每帧推 dt）。 |
| `registerSceneTickCallback()` | `scene/env/_bridge/env-dispatcher` | 注册场景每帧 tick 回调。返回的清理函数在 dispose 时调用。 |
| `runEnvDtTickCallbacks()` | `scene/env/_bridge/env-dispatcher` | 执行所有 dt tick 回调（由 ensureEnvUpdateObserver 推 dt）。 |
| `runSceneTickCallbacks()` | `scene/env/_bridge/env-dispatcher` | 执行所有已注册的场景 tick 回调（由 ensureEnvUpdateObserver 的 scene observer 每帧调用）。 |
| `cancelEnvPersistTimer()` | `scene/env/_bridge/env-persist` | 取消挂起的 env state 防抖持久化定时器（HMR 重入清理用，见 ADR-106 D3）。 |
| `flushEnvState()` | `scene/env/_bridge/env-persist` | 立即刷写 env state 到后端（无防抖）。关闭/隐藏页面时调用。 |
| `flushUIState()` | `scene/env/_bridge/env-persist` | 立即刷写 UI state 到后端（无防抖）。关闭/隐藏页面时调用。 |
| `persistEnvState()` | `scene/env/_bridge/env-persist` | 持久化 envState 到后端（ADR-176 第 2 步：经 resolveBackend 路由）。 |
| `persistUIState()` | `scene/env/_bridge/env-persist` | 与 persistEnvState 对称：持久化 UI state（ADR-176 第 2 步：经 resolveBackend 路由）。 |
| `schedulePersistEnvState()` | `scene/env/_bridge/env-persist` | 调度 env state 防抖持久化（500ms）。setEnvState 内部调用。 |
| `schedulePersistUI()` | `scene/env/_bridge/env-persist` | 防抖调度 UIState 持久化。修改 uiState 后调用此函数。 |
| `INFINITE_GROUND_SIZE()` | `scene/env/_shared/env-context` | — |
| `_envSys()` | `scene/env/_shared/env-context` | — |
| `effectiveGroundSize()` | `scene/env/_shared/env-context` | 当前生效的地面尺寸：开启无限地面时为固定大尺寸，否则为 groundSize。 |
| `getPipeline()` | `scene/env/_shared/env-context` | — |
| `getScene()` | `scene/env/_shared/env-context` | 取当前 Babylon 场景；未初始化时抛错（env 子系统内部使用）。 |
| `initEnvImpl()` | `scene/env/_shared/env-context` | — |
| `isInitialized()` | `scene/env/_shared/env-context` | — |
| `resolveStaticAsset()` | `scene/env/_shared/env-context` | — |
| `CanvasTextureOptions()` | `scene/env/_shared/env-texture` | — |
| `createCanvasDataURL()` | `scene/env/_shared/env-texture` | 统一创建 canvas 并导出 data URL（供 CreateGroundFromHeightMap 等以 URL 为输入的场景， 与 createCanvasTexture |
| `createCanvasTexture()` | `scene/env/_shared/env-texture` | 统一创建 canvas 贴图。优先 DynamicTexture（无 toDataURL PNG 编码开销，ADR-091 §6 方向）； 任意环节失败（含 NullEngine |
| `disposeTextureCache()` | `scene/env/_shared/env-texture` | 释放全部缓存贴图（供 disposeEnv 统一清理）。 |
| `getOrCreateCanvasTexture()` | `scene/env/_shared/env-texture` | 按 key 获取或创建 canvas 贴图。key 不变则复用；调用方不应手动 dispose 缓存贴图 （统一由 disposeTextureCache 在 disposeEnv |
| `isCacheOwnedTexture()` | `scene/env/_shared/env-texture` | 判断贴图是否归缓存所有——是则调用方不得手动 dispose（由 disposeTextureCache 统一释放）。 |
| `FrozenCamera()` | `scene/env/_shared/env-type-helpers` | — |
| `REFRESHRATE_RENDER_ONCE()` | `scene/env/_shared/env-type-helpers` | — |
| `getCanvasCtx()` | `scene/env/_shared/env-type-helpers` | — |
| `CAUSTIC_WORLD_SCALE()` | `scene/env/env-caustics` | — |
| `CausticsHostMat()` | `scene/env/env-caustics` | 类型守卫：材质是否支持 emissiveTexture（用于焦散投影） |
| `CausticsScrollConfig()` | `scene/env/env-caustics` | 焦散滚动配置（用户可通过 state.causticScrollX/Y 覆盖） |
| `causticsController()` | `scene/env/env-caustics` | — |
| `isCausticsHost()` | `scene/env/env-caustics` | — |
| `FRAG_SRC()` | `scene/env/env-clouds` | — |
| `buildJitterSource()` | `scene/env/env-clouds` | 根据 useBlueNoise 选择 jitter 代码路径（模板注入） |
| `createClouds()` | `scene/env/env-clouds` | — |
| `disposeClouds()` | `scene/env/env-clouds` | — |
| `resolveCloudShaderParams()` | `scene/env/env-clouds` | 按质量档派生 shader 注入参数： - high: 200 步主 march + 2 步光照 march + blue-noise jitter - standard: 96 |
| `getBodyCollisionEnabled()` | `scene/env/env-collision` | — |
| `getCollisionEnabled()` | `scene/env/env-collision` | — |
| `getGroundCollisionEnabled()` | `scene/env/env-collision` | — |
| `setBodyCollisionEnabled()` | `scene/env/env-collision` | — |
| `setCollisionEnabled()` | `scene/env/env-collision` | — |
| `setGroundCollisionEnabled()` | `scene/env/env-collision` | — |
| `getGravityStrength()` | `scene/env/env-gravity` | — |
| `setGravityStrength()` | `scene/env/env-gravity` | — |
| `GROUND_PRESETS()` | `scene/env/env-ground-presets` | — |
| `GROUND_PRESET_KEYS()` | `scene/env/env-ground-presets` | 预设「关心」的 EnvState 字段集合（单一真相源）。 |
| `GroundPreset()` | `scene/env/env-ground-presets` | — |
| `GroundProceduralKind()` | `scene/env/env-ground-presets` | 程序化地面纹理类型 |
| `buildGroundPresetEnvState()` | `scene/env/env-ground-presets` | 预设 → EnvState 字段映射，供 UI chip handler 调用并持久化。 |
| `GroundAppearanceSpec()` | `scene/env/env-ground-spec` | 外观性字段：可增量 mutate，不触发重建。 |
| `GroundGeometryKind()` | `scene/env/env-ground-spec` | — |
| `GroundMaterialSpec()` | `scene/env/env-ground-spec` | — |
| `GroundSourceKind()` | `scene/env/env-ground-spec` | — |
| `GroundStructuralSpec()` | `scene/env/env-ground-spec` | 结构性字段：任一变化都要求重建几何/材质（取代手拼 typeKey 的判别符集合）。 |
| `applyGroundMaterialSpec()` | `scene/env/env-ground-spec` | 统一「填材质」逻辑。 |
| `buildGroundMaterialSpec()` | `scene/env/env-ground-spec` | 由 EnvState 派生完整 Spec。新增材质相关字段只需在此赋值，specKey 自动纳入。 |
| `createGroundMeshFromSpec()` | `scene/env/env-ground-spec` | 创建地面 mesh 并落好材质。Phase 1 已接入：applyGround 非 terrain 重建路径调用本函数。 |
| `groundSpecNeedsRebuild()` | `scene/env/env-ground-spec` | diffSpec 的结构性结论：是否需要重建。 |
| `specKey()` | `scene/env/env-ground-spec` | 稳定 key：仅序列化结构性字段。新增结构性字段自动纳入，无遗漏风险。 |
| `GROUND_PRESETS()` | `scene/env/env-ground` | — |
| `GroundMat()` | `scene/env/env-ground` | — |
| `INFINITE_GROUND_SIZE()` | `scene/env/env-ground` | — |
| `_disableGroundRippleTexture()` | `scene/env/env-ground` | — |
| `_effectiveBumpLevel()` | `scene/env/env-ground` | ADR-114 Phase 2: 法线扭曲映射到 bumpTexture.level 增强（distort=1 时额外 +2.0）；低质量模式自动关闭 |
| `_effectiveRoughness()` | `scene/env/env-ground` | ADR-114 Phase 2: 反射模糊映射到 roughness 偏移（blur=1 最多增加 0.4）；低质量模式自动关闭 |
| `_generateGroundTexture()` | `scene/env/env-ground` | — |
| `_getAlbedoColor()` | `scene/env/env-ground` | — |
| `_getAlbedoTex()` | `scene/env/env-ground` | — |
| `_needAlphaBlend()` | `scene/env/env-ground` | 判断地面是否需要 alpha blend 渲染（alpha &lt; 1 或边缘淡出）。 |
| `_setAlbedoColor()` | `scene/env/env-ground` | — |
| `_setAlbedoTex()` | `scene/env/env-ground` | — |
| `_syncAllTextureOffsets()` | `scene/env/env-ground` | — |
| `_syncGroundEmissive()` | `scene/env/env-ground` | [doc:adr-230] 自发光地屏增量同步：复用 Babylon 内置 emissiveColor/emissiveTexture 通道， 不引入新材质体系。es=0 / 黑 |
| `_syncGroundNormalTexture()` | `scene/env/env-ground` | — |
| `_syncGroundRippleTexture()` | `scene/env/env-ground` | — |
| `_syncPbrProperties()` | `scene/env/env-ground` | PBR 增量更新：roughness / metallic / 程序化纹理无需重建材质的属性 |
| `_syncTextureGroundTexture()` | `scene/env/env-ground` | — |
| `_updateGroundTexture()` | `scene/env/env-ground` | — |
| `applyGround()` | `scene/env/env-ground` | — |
| `applyGroundEdgeFade()` | `scene/env/env-ground` | — |
| `buildGroundPresetEnvState()` | `scene/env/env-ground` | — |
| `buildGroundReflection()` | `scene/env/env-ground` | — |
| `clearGroundTexCache()` | `scene/env/env-ground` | — |
| `createGroundMaterial()` | `scene/env/env-ground` | — |
| `disposeGround()` | `scene/env/env-ground` | 释放地面网格、材质与反射资源（幂等）。 |
| `generateProceduralGroundTextures()` | `scene/env/env-ground` | — |
| `getGroundHeightAt()` | `scene/env/env-ground` | — |
| `setGroundActualSize()` | `scene/env/env-ground` | — |
| `setGroundMesh()` | `scene/env/env-ground` | ADR-226: 供 env-ground-spec.ts 在建地面后同步模块局部状态（_envSys.ground.mesh / _groundActualSize）。 |
| `setOnGroundChanged()` | `scene/env/env-ground` | — |
| `setOnTerrainReady()` | `scene/env/env-ground` | — |
| `tickGround()` | `scene/env/env-ground` | — |
| `triggerTerrainReady()` | `scene/env/env-ground` | ADR-226: 供 env-ground-spec.ts 的地形 onReady 回调触发已注册监听（避免直接访问模块局部 _onTerrainReady）。 |
| `_envSys()` | `scene/env/env-impl` | — |
| `addGroundRipple()` | `scene/env/env-impl` | — |
| `addRipple()` | `scene/env/env-impl` | — |
| `applyFog()` | `scene/env/env-impl` | — |
| `applyGround()` | `scene/env/env-impl` | — |
| `applySky()` | `scene/env/env-impl` | — |
| `clearGroundRipples()` | `scene/env/env-impl` | — |
| `clearRipples()` | `scene/env/env-impl` | — |
| `createClouds()` | `scene/env/env-impl` | — |
| `createParticleEmitter()` | `scene/env/env-impl` | — |
| `createWater()` | `scene/env/env-impl` | — |
| `disposeClouds()` | `scene/env/env-impl` | — |
| `disposeEnvUpdateObserver()` | `scene/env/env-impl` | — |
| `disposeParticles()` | `scene/env/env-impl` | — |
| `disposeWater()` | `scene/env/env-impl` | — |
| `ensureEnvUpdateObserver()` | `scene/env/env-impl` | — |
| `getGroundHeightAt()` | `scene/env/env-impl` | — |
| `getScene()` | `scene/env/env-impl` | — |
| `initEnvImpl()` | `scene/env/env-impl` | — |
| `refreshWaterRenderList()` | `scene/env/env-impl` | — |
| `registerSceneTickCallback()` | `scene/env/env-impl` | — |
| `setOnGroundChanged()` | `scene/env/env-impl` | — |
| `setOnTerrainReady()` | `scene/env/env-impl` | — |
| `updateParticleTexture()` | `scene/env/env-impl` | — |
| `updateParticleWind()` | `scene/env/env-impl` | — |
| `updateWaterAnimSpeed()` | `scene/env/env-impl` | — |
| `CategorizedEnvPreset()` | `scene/env/env-lighting` | 分类预设（version 3 格式）。 |
| `DerivedLighting()` | `scene/env/env-lighting` | — |
| `ENV_PRESET_FIELDS()` | `scene/env/env-lighting` | 各类别包含的 EnvState 字段白名单。未列入的字段（如 collision*）不参与任何预设。 |
| `EnvPreset()` | `scene/env/env-lighting` | — |
| `EnvPresetCategory()` | `scene/env/env-lighting` | 环境预设分类：天空/地面/水面/大气。 |
| `LEGACY_CATEGORY_MAP()` | `scene/env/env-lighting` | 旧版 category 值 → 新版 domain 前缀映射（ADR-214 零级 ID 治理）。 |
| `TIME_OF_DAY_PRESETS()` | `scene/env/env-lighting` | 预设数据表。按时间线排列：黎明 → 正午 → 夕阳 → 夜景 → 阴天 → 霓虹夜 |
| `calcLuminance()` | `scene/env/env-lighting` | — |
| `deriveLighting()` | `scene/env/env-lighting` | 从天空色和太阳角度推算光照参数。 |
| `exportCategorizedEnvPreset()` | `scene/env/env-lighting` | 序列化分类预设为 JSON 字符串。 |
| `importCategorizedEnvPreset()` | `scene/env/env-lighting` | 从 JSON 字符串反序列化分类预设，失败返回 null。 |
| `snapshotEnvPresetByCategory()` | `scene/env/env-lighting` | 从当前 envState 快照指定类别的字段。数组字段做浅拷贝避免别名。 |
| `applyWetnessToInst()` | `scene/env/env-particles` | — |
| `applyWindToParticles()` | `scene/env/env-particles` | — |
| `createParticleEmitter()` | `scene/env/env-particles` | — |
| `disposeParticles()` | `scene/env/env-particles` | — |
| `disposeSplash()` | `scene/env/env-particles` | 销毁 splash burst 池 |
| `getCurrentParticleType()` | `scene/env/env-particles` | 获取当前粒子类型（用于 particleEnabled 自动启停） |
| `isWetnessActive()` | `scene/env/env-particles` | — |
| `syncSplashState()` | `scene/env/env-particles` | 溅射开关切换（由 env-impl 检测 particleSplashEnabled 变化时调用） |
| `updateParticleParams()` | `scene/env/env-particles` | 运行时更新粒子参数（密度/大小/速度），响应滑条变化 |
| `updateParticleTexture()` | `scene/env/env-particles` | — |
| `updateParticleWind()` | `scene/env/env-particles` | — |
| `ReflectionMode()` | `scene/env/env-reflection` | — |
| `ResolvedReflectionMode()` | `scene/env/env-reflection` | — |
| `applyReflection()` | `scene/env/env-reflection` | 反射子系统统一入口。参考 applySky 模式： 1. |
| `bindProbeToMeshes()` | `scene/env/env-reflection` | 将 Probe cubemap 绑定到指定网格的材质（含 save 原始纹理）。 |
| `disposeReflection()` | `scene/env/env-reflection` | 释放反射子系统全部资源（场景销毁时调用）。 |
| `getPlanarQualityOverride()` | `scene/env/env-reflection` | ADR-151: 平面反射质量全局覆盖（供 env-ground / env-water 的 getQuality 检查）。 |
| `getQualityPreset()` | `scene/env/env-reflection` | 获取当前质量等级对应的参数预设。 |
| `onModelMeshesReady()` | `scene/env/env-reflection` | 模型加载后调用：将 Probe 绑定到新模型的网格。 |
| `resolveReflectionMode()` | `scene/env/env-reflection` | — |
| `setReflectionARSuspended()` | `scene/env/env-reflection` | AR 模式联动：挂起/恢复反射子系统。 |
| `applySky()` | `scene/env/env-sky` | — |
| `clearStarsTexCache()` | `scene/env/env-sky` | — |
| `disposeSky()` | `scene/env/env-sky` | 释放天空盒并移除相机跟随观察者（幂等）。 |
| `applyTerrainMaterial()` | `scene/env/env-terrain` | 地形材质（与其他地面模式一致：纯色或半透明/纹理）。 |
| `clearTerrainGeneration()` | `scene/env/env-terrain` | 测试/场景重置用：清零地形代际计数器。 |
| `createHeightmapGround()` | `scene/env/env-terrain` | 用程序化 FBM 高度图创建可拾取地形网格（CreateGroundFromHeightMap）。 |
| `fbm()` | `scene/env/env-terrain` | — |
| `generateTerrainHeightmapURL()` | `scene/env/env-terrain` | 程序化生成灰度高度图（data URL），亮=高峰、暗=低谷。经统一工厂创建（受约束环境返回 ''）。 |
| `hash2()` | `scene/env/env-terrain` | — |
| `valueNoise()` | `scene/env/env-terrain` | — |
| `applyEnvPreset()` | `scene/env/env-time-of-day` | — |
| `applyEnvPresetByCategory()` | `scene/env/env-time-of-day` | [adr-120] 按类别应用用户自定义预设。 |
| `applyEnvPresetObject()` | `scene/env/env-time-of-day` | 应用任意 EnvPreset 对象（支持用户自定义预设）。 |
| `getEnvSunAngle()` | `scene/env/env-time-of-day` | — |
| `getTimeOfDaySpeed()` | `scene/env/env-time-of-day` | — |
| `isTimeOfDayActive()` | `scene/env/env-time-of-day` | — |
| `setEnvSunAngle()` | `scene/env/env-time-of-day` | — |
| `setTimeOfDaySpeed()` | `scene/env/env-time-of-day` | — |
| `startTimeOfDay()` | `scene/env/env-time-of-day` | — |
| `stopTimeOfDay()` | `scene/env/env-time-of-day` | — |
| `syncTimeOfDayFromEnv()` | `scene/env/env-time-of-day` | 从持久化的 envState 恢复 time-of-day 模块变量（启动时调用） |
| `underwaterFogController()` | `scene/env/env-underwater-fog` | — |
| `WATER_PRESETS()` | `scene/env/env-water` | — |
| `WaterPreset()` | `scene/env/env-water` | — |
| `_applyWaterLOD()` | `scene/env/env-water` | 按相机到水面的距离手动切换 LOD 可见性（仅 0/1/2 三层中恰好一层 enabled）， 规避 Babylon addLODLevel 的父子/兄弟重复渲染问题。仅当层级变化 |
| `addGroundRipple()` | `scene/env/env-water` | 添加地面涟漪（粒子落地时调用） |
| `addRipple()` | `scene/env/env-water` | — |
| `applyWaterPresetToCurrent()` | `scene/env/env-water` | — |
| `buildWaterPresetEnvState()` | `scene/env/env-water` | 预设 → EnvState 完整字段映射（含扩展参数），供 UI chip handler 调用并持久化。 |
| `clearGroundRipples()` | `scene/env/env-water` | — |
| `clearRipples()` | `scene/env/env-water` | — |
| `computeWaveDirs()` | `scene/env/env-water` | 根据风向计算 4 层 Gerstner 波的 vec2 方向数组。 |
| `createWater()` | `scene/env/env-water` | — |
| `disposeGroundRipples()` | `scene/env/env-water` | 释放地面涟漪纹理与状态（由 disposeWater / disposeGround 调用，防止 GPU 纹理泄漏） |
| `disposeWater()` | `scene/env/env-water` | — |
| `getGroundRippleTexture()` | `scene/env/env-water` | 获取地面涟漪纹理（供 env-ground 设置到 bumpTexture） |
| `getWaterPhase()` | `scene/env/env-water` | 测试/调试用：读取当前累计波相位。 |
| `hasActiveGroundRipples()` | `scene/env/env-water` | 是否有活跃的地面涟漪（供 env-ground 判断是否需要叠加 ripple 法线纹理） |
| `isUnderwaterActive()` | `scene/env/env-water` | 相机是否处于水下（雾效接管中）。 |
| `refreshWaterRenderList()` | `scene/env/env-water` | 刷新水面渲染列表（钩子函数） 当前为空实现，保留作为API接口，未来可能用于： - 更新水的渲染顺序 - 响应场景图形变更（如新增/移除需要水面反射的对象） - 同步水的渲染状态 |
| `resetUnderwaterState()` | `scene/env/env-water` | — |
| `selectWaterLOD()` | `scene/env/env-water` | 按相机到水面的距离选择 LOD 层级（纯函数，便于单测）。 |
| `setGroundGeometryProvider()` | `scene/env/env-water` | 注入地面几何提供者（env-ground 在模块初始化时调用一次） |
| `setUnderwaterFog()` | `scene/env/env-water` | 由水下雾控制器同步水下雾参数到水面材质（含材质重建后的恢复由 _syncWaterUniforms 负责）。 |
| `updateGroundRipples()` | `scene/env/env-water` | 每帧更新地面涟漪纹理（由 env-ground 的 update observer 驱动） |
| `updateUnderwaterTransition()` | `scene/env/env-water` | — |
| `updateWaterAnimSpeed()` | `scene/env/env-water` | — |
| `applyWetnessToAllModels()` | `scene/env/env-wetness` | 对所有已加载模型应用湿身材质效果（幂等）。 |
| `applyWetnessToInst()` | `scene/env/env-wetness` | — |
| `isWetnessActive()` | `scene/env/env-wetness` | — |
| `removeWetnessFromAllModels()` | `scene/env/env-wetness` | 移除所有模型的湿身材质效果（幂等）。 |
| `_envSys()` | `scene/env/env` | — |
| `addGroundRipple()` | `scene/env/env` | — |
| `addRipple()` | `scene/env/env` | — |
| `applyEnvState()` | `scene/env/env` | — |
| `applyGround()` | `scene/env/env` | — |
| `applySky()` | `scene/env/env` | — |
| `applyWindToParticles()` | `scene/env/env` | — |
| `clearGroundRipples()` | `scene/env/env` | — |
| `clearRipples()` | `scene/env/env` | — |
| `createClouds()` | `scene/env/env` | — |
| `createParticleEmitter()` | `scene/env/env` | — |
| `createWater()` | `scene/env/env` | — |
| `disposeClouds()` | `scene/env/env` | — |
| `disposeEnvUpdateObserver()` | `scene/env/env` | — |
| `disposeParticles()` | `scene/env/env` | — |
| `disposeWater()` | `scene/env/env` | — |
| `ensureEnvUpdateObserver()` | `scene/env/env` | — |
| `getGroundHeightAt()` | `scene/env/env` | — |
| `getMirrorInfo()` | `scene/env/env` | — |
| `getTimeOfDaySpeed()` | `scene/env/env` | — |
| `initEnvFacade()` | `scene/env/env` | — |
| `isMirrorActive()` | `scene/env/env` | — |
| `isTimeOfDayActive()` | `scene/env/env` | — |
| `refreshMirrorRenderList()` | `scene/env/env` | — |
| `refreshWaterRenderList()` | `scene/env/env` | — |
| `registerSceneTickCallback()` | `scene/env/env` | — |
| `setMirrorPosition()` | `scene/env/env` | — |
| `setMirrorResolution()` | `scene/env/env` | — |
| `setMirrorRotationY()` | `scene/env/env` | — |
| `setMirrorSize()` | `scene/env/env` | — |
| `setTimeOfDaySpeed()` | `scene/env/env` | — |
| `startTimeOfDay()` | `scene/env/env` | — |
| `stopTimeOfDay()` | `scene/env/env` | — |
| `toggleMirror()` | `scene/env/env` | — |
| `updateWaterAnimSpeed()` | `scene/env/env` | — |
| `createMirror()` | `scene/env/mirror-debug` | 创建镜面道具：竖直平面 + MirrorTexture 反射。 |
| `disposeMirror()` | `scene/env/mirror-debug` | 销毁镜面 |
| `getMirrorInfo()` | `scene/env/mirror-debug` | — |
| `isMirrorActive()` | `scene/env/mirror-debug` | — |
| `refreshMirrorRenderList()` | `scene/env/mirror-debug` | 刷新渲染列表（模型加载/卸载后调用） |
| `setMirrorPosition()` | `scene/env/mirror-debug` | — |
| `setMirrorResolution()` | `scene/env/mirror-debug` | — |
| `setMirrorRotationY()` | `scene/env/mirror-debug` | — |
| `setMirrorSize()` | `scene/env/mirror-debug` | — |
| `toggleMirror()` | `scene/env/mirror-debug` | — |
| `updateMirrorClearColor()` | `scene/env/mirror-debug` | 同步 RT clearColor 与当前天空模式一致： - color 模式：用 scene.clearColor（天空色），使纯净的天空色在镜子中可见 - 其他模式：透明黑，由反 |
| `PlanarReflection()` | `scene/env/planar-reflection` | — |
| `PlanarReflectionConfig()` | `scene/env/planar-reflection` | — |
| `ReflectionMode()` | `scene/env/planar-reflection` | — |
| `registerReflectionSurface()` | `scene/env/planar-reflection` | — |
| `resetReflectionSurfaces()` | `scene/env/planar-reflection` | ADR-114 Phase 2: 是否生成 mipmap（地面 PBR 反射模糊用，水面保持 false） generateMipMaps?: boolean; } // ==== |
| `MaterialMode()` | `scene/manager/material-proxy-resolver` | — |
| `getMaterialMode()` | `scene/manager/material-proxy-resolver` | 从 VITE_MMD_MATERIAL 环境变量读取材质模式（构建期常量，未定义时走默认值） |
| `getPBRMaterialBuilder()` | `scene/manager/material-proxy-resolver` | 动态导入 PBRMaterialBuilder（PBR 材质构建器） 注意: PBRMaterialBuilder 在 PMX 加载阶段构建 PBRMaterial， 与 MmdS |
| `getStandardMaterialProxy()` | `scene/manager/material-proxy-resolver` | 返回标准材质代理（MmdStandardMaterialProxy）— 用于 Lambert + Blinn-Phong 渲染 |
| `resolveMaterialProxy()` | `scene/manager/material-proxy-resolver` | 返回当前材质的代理构造函数（同步） （PBR 模式下的材质代理仍使用标准代理，因 PMX 加载阶段已由 PBRMaterialBuilder 构建材质， MmdStandardMa |
| `DEFAULT_SSS_PARAMS()` | `scene/manager/material-sss` | SSS 默认参数 |
| `SssColorInput()` | `scene/manager/material-sss` | — |
| `SssParams()` | `scene/manager/material-sss` | SSS 参数 |
| `applyMatSssState()` | `scene/manager/material-sss` | 反序列化 SSS 状态并应用到模型 |
| `applySss()` | `scene/manager/material-sss` | 应用 SSS 参数到指定分类的所有 PBRMaterial 材质 内部实现： 1. |
| `disposeModelSssState()` | `scene/manager/material-sss` | 重置指定模型的所有 SSS 状态 |
| `getMatSssParams()` | `scene/manager/material-sss` | 获取指定分类的 SSS 参数 |
| `getMatSssState()` | `scene/manager/material-sss` | 序列化指定模型的 SSS 状态为 JSON 兼容结构 用于场景/预设保存。仅返回非默认值，避免默认值噪声。 |
| `setMatSssParams()` | `scene/manager/material-sss` | 设置指定分类的 SSS 参数并立即应用到所有该分类材质 sssColor 可传入 Color3 或 { r, g, b } 形式 |
| `AlphaCtx()` | `scene/manager/material` | — |
| `DEFAULT_MAT_PARAMS()` | `scene/manager/material` | 材质参数默认值 — 所有新增字段在此维护，消除散落硬编码。 |
| `MaterialCategory()` | `scene/manager/material` | — |
| `MaterialCategoryParams()` | `scene/manager/material` | — |
| `MaterialStateManager()` | `scene/manager/material` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `SssMaterial()` | `scene/manager/material` | — |
| `_applyAll()` | `scene/manager/material` | 将 MaterialCategoryParams 映射为 PBRMaterial 属性 映射关系（与 StandardMaterial 语义对齐）： - diffuseMul |
| `_capture()` | `scene/manager/material` | Per-material category cache. |
| `_capturePbr()` | `scene/manager/material` | PBRMaterial 参数捕获（对应 _capture 的 PBR 版） |
| `_catOf()` | `scene/manager/material` | 材质分类关键词表（按优先级排序）。 |
| `_catState()` | `scene/manager/material` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `_isPbrMaterial()` | `scene/manager/material` | — |
| `_matEnabled()` | `scene/manager/material` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `_matState()` | `scene/manager/material` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `applyMatState()` | `scene/manager/material` | — |
| `applyUnlitFallback()` | `scene/manager/material` | 光照兜底预设：让模型呈现"伪 unlit"状态，不依赖方向光即可正常显示。 |
| `disposeModelMaterialState()` | `scene/manager/material` | 清理指定模型的全部材质状态（分类 + 逐材质 + 启用标记）。 |
| `getMatCatGroups()` | `scene/manager/material` | — |
| `getMatCatParams()` | `scene/manager/material` | — |
| `getMatDetailList()` | `scene/manager/material` | — |
| `getMatParams()` | `scene/manager/material` | — |
| `getMatState()` | `scene/manager/material` | — |
| `isMatCategoryAllEnabled()` | `scene/manager/material` | 检查指定分类的全部材质是否都已启用。 |
| `isMatEnabled()` | `scene/manager/material` | — |
| `isPbrMaterial()` | `scene/manager/material` | — |
| `resetMatCatParams()` | `scene/manager/material` | — |
| `resetPerMaterialParams()` | `scene/manager/material` | 重置所有逐材质覆盖（per-material），保留分类调整（皮肤/头发等）。 |
| `resetSingleMatParams()` | `scene/manager/material` | — |
| `setMatCatParams()` | `scene/manager/material` | — |
| `setMatCategoryEnabled()` | `scene/manager/material` | 按分类批量切换材质可见性。 |
| `setMatEnabled()` | `scene/manager/material` | — |
| `setMatParams()` | `scene/manager/material` | — |
| `resolveModelId()` | `scene/manager/model-id` | 解析模型运行时 id：优先复用存档 uuid（preferredId，由恢复路径传入）， 否则生成稳定 uuid。替代旧实现 `model_${Date.now()}_${Math |
| `captureThumbnail()` | `scene/manager/model-loader` | Captures a screenshot after model load for thumbnail cache. |
| `initLoader()` | `scene/manager/model-loader` | — |
| `loadPMXFile()` | `scene/manager/model-loader` | — |
| `setOnMeshesReady()` | `scene/manager/model-loader` | — |
| `setOnModelLoaded()` | `scene/manager/model-loader` | — |
| `FormationType()` | `scene/manager/model-manager` | — |
| `ModelManager()` | `scene/manager/model-manager` | — |
| `getFormationLabels()` | `scene/manager/model-manager` | — |
| `ReplaceSnapshot()` | `scene/manager/model-ops` | [doc:adr-150] 替换模型时从旧模型捕获、应用到新模型的可继承状态快照。 |
| `applyInheritedState()` | `scene/manager/model-ops` | [doc:adr-150] 将状态快照应用到新模型（通过 modelManager setter + setBoneOverride）。 |
| `applyVPDPose()` | `scene/manager/model-ops` | 应用 VPD 姿势到模型（静态姿势，停掉 VMD 播放）。 |
| `arrangeModels()` | `scene/manager/model-ops` | — |
| `captureInheritedState()` | `scene/manager/model-ops` | [doc:adr-150] 从旧 ModelInstance 提取可继承状态（深拷贝，不引用原 inst 字段）。 |
| `focusModel()` | `scene/manager/model-ops` | — |
| `focusedMmdModel()` | `scene/manager/model-ops` | — |
| `focusedModel()` | `scene/manager/model-ops` | — |
| `getActiveFormation()` | `scene/manager/model-ops` | — |
| `getActiveFormationSpacing()` | `scene/manager/model-ops` | — |
| `getFormationLabels()` | `scene/manager/model-ops` | — |
| `getModelMorphWeight()` | `scene/manager/model-ops` | — |
| `getModelMorphs()` | `scene/manager/model-ops` | — |
| `getModelOrbit()` | `scene/manager/model-ops` | — |
| `getModelPosition()` | `scene/manager/model-ops` | — |
| `getModelPositionMode()` | `scene/manager/model-ops` | — |
| `getPhysicsCatState()` | `scene/manager/model-ops` | — |
| `getPhysicsCategories()` | `scene/manager/model-ops` | — |
| `isPhysicsCategoryEnabled()` | `scene/manager/model-ops` | — |
| `removeFocusedModel()` | `scene/manager/model-ops` | — |
| `removeModel()` | `scene/manager/model-ops` | — |
| `resetModelMorphs()` | `scene/manager/model-ops` | — |
| `resetModelTransform()` | `scene/manager/model-ops` | — |
| `setModelBoneJointsVis()` | `scene/manager/model-ops` | — |
| `setModelBoneLinesVis()` | `scene/manager/model-ops` | — |
| `setModelFormation()` | `scene/manager/model-ops` | — |
| `setModelMorphWeight()` | `scene/manager/model-ops` | — |
| `setModelOpacity()` | `scene/manager/model-ops` | — |
| `setModelOrbit()` | `scene/manager/model-ops` | — |
| `setModelPhysics()` | `scene/manager/model-ops` | — |
| `setModelPosition()` | `scene/manager/model-ops` | — |
| `setModelPositionMode()` | `scene/manager/model-ops` | — |
| `setModelRotation()` | `scene/manager/model-ops` | — |
| `setModelRotationY()` | `scene/manager/model-ops` | — |
| `setModelScaling()` | `scene/manager/model-ops` | — |
| `setModelVisibility()` | `scene/manager/model-ops` | — |
| `setModelWireframe()` | `scene/manager/model-ops` | — |
| `setPhysicsCategory()` | `scene/manager/model-ops` | — |
| `stopVMD()` | `scene/manager/model-ops` | — |
| `tryApplyPbrMaterialBuilder()` | `scene/manager/pbr-builder-init` | 动态导入 PBRMaterialBuilder 并覆盖 MmdModelLoader.SharedMaterialBuilder。 |
| `auditMissingTextures()` | `scene/manager/pmx-texture-audit` | 识别 PMX 声明但目录中缺失的纹理。 |
| `parsePmxTexturePaths()` | `scene/manager/pmx-texture-audit` | 解析 PMX 声明的纹理路径清单（相对路径，原样保留目录前缀与分隔符）。 |
| `expandFallbackCandidates()` | `scene/manager/texture-fallback` | 批量展开 fallback 候选条目（共享 data 引用），并对「候选 vs 真实路径」冲突去重。 |
| `registerDeclaredAliases()` | `scene/manager/texture-fallback` | 按 PMX 声明路径反向注册别名（[fix:decl-alias]）。 |
| `textureFallbackCandidates()` | `scene/manager/texture-fallback` | 生成给定相对路径的 fallback 候选列表（不含原始路径本身）。 |
| `ThumbnailSource()` | `scene/manager/thumbnail-capture` | — |
| `renderInstanceThumbnail()` | `scene/manager/thumbnail-capture` | 用离屏 RenderTargetTexture 渲染指定模型实例的「当前骨骼姿态」并保存为缩略图。 |
| `ThumbnailBaseKeyInput()` | `scene/manager/thumbnail-key` | — |
| `ThumbnailKeyInput()` | `scene/manager/thumbnail-key` | — |
| `buildThumbnailKey()` | `scene/manager/thumbnail-key` | 唯一缓存 key 构造：`&lt;baseKey&gt;::&lt;resolution&gt;::&lt;aspect&gt;`。 |
| `libraryModelBaseKey()` | `scene/manager/thumbnail-key` | 由 LibraryModel 推导 baseKey（读侧专用适配器）。 |
| `thumbnailBaseKey()` | `scene/manager/thumbnail-key` | 由库引用路径 + 内部路径推导 baseKey。 |
| `BoneMapPreset()` | `scene/motion/animation-retargeter` | — |
| `RetargetPlayState()` | `scene/motion/animation-retargeter` | 当前活跃的 retarget 动画状态（用于场景序列化）。 |
| `RetargetResult()` | `scene/motion/animation-retargeter` | — |
| `getRetargetPlayState()` | `scene/motion/animation-retargeter` | 获取当前活跃的 retarget 动画播放状态，用于场景序列化。 |
| `loadAndRetargetAnimation()` | `scene/motion/animation-retargeter` | 从外部动画文件加载并重定向到 MMD 骨骼。 |
| `playRetargetedAnimation()` | `scene/motion/animation-retargeter` | 播放重定向后的动画（additive 模式，叠加在 VMD 之上）。 |
| `restoreRetargetAnimation()` | `scene/motion/animation-retargeter` | 从已加载的模型恢复 retarget 动画（场景反序列化用）。 |
| `stopCurrentRetarget()` | `scene/motion/animation-retargeter` | 停止当前 retarget 动画并清理。 |
| `BoneConflict()` | `scene/motion/bone-override-store` | 骨骼冲突记录（原 registry._boneConflicts 的统一版） |
| `BoneOverrideStore()` | `scene/motion/bone-override-store` | — |
| `BoneOverrideStoreOptions()` | `scene/motion/bone-override-store` | 构造选项（ADR-147 M8：注入模块→stage 解析器，填充 BoneConflict.stage） |
| `BoneOwnership()` | `scene/motion/bone-override-store` | 单骨所有权记录 |
| `InMemoryBoneOverrideStore()` | `scene/motion/bone-override-store` | — |
| `ModuleRuntimeState()` | `scene/motion/bone-override-store` | 模块运行时状态（合并原 intent.motionModules + _ownedBones 的职责） |
| `OverrideSlot()` | `scene/motion/bone-override-store` | 单骨覆盖槽位（原 _OverrideSlot 的共享命名版） |
| `ReleaseListener()` | `scene/motion/bone-override-store` | 骨骼释放事件监听器 |
| `getBoneOverrideStore()` | `scene/motion/bone-override-store` | 获取全局 BoneOverrideStore 单例（registry / module-base 等委托此存储骨骼所有权与冲突状态） |
| `BoneHierarchyDump()` | `scene/motion/bone-override` | 骨骼层级导出结果 |
| `BoneHierarchyNode()` | `scene/motion/bone-override` | 单根骨骼的层级与覆盖状态（dumpBoneHierarchy 输出元素） |
| `BoneOverrideEntry()` | `scene/motion/bone-override` | 持久化的单条骨骼覆盖配置 |
| `FRAME_HOOK_ORDER()` | `scene/motion/bone-override` | [doc:adr-116 P3] 注册每帧渲染钩子。 |
| `FrameHookSnapshot()` | `scene/motion/bone-override` | 帧钩子快照（供 UI 查询管线时序一览） |
| `OverrideSlotLike()` | `scene/motion/bone-override` | 覆盖槽的最小形态，供 _computeOverride 接收（与内部 _OverrideSlot 结构兼容） |
| `OverrideType()` | `scene/motion/bone-override` | 骨骼覆盖类型（零分配，适合每帧查询） |
| `applyBoneOverrideIK()` | `scene/motion/bone-override` | [doc:adr-122 P1] IK 感知的骨骼覆盖。 |
| `clearAllOverrides()` | `scene/motion/bone-override` | 清除所有骨骼覆盖。 |
| `clearBoneOverride()` | `scene/motion/bone-override` | 清除指定骨骼的覆盖。 |
| `computeOverride()` | `scene/motion/bone-override` | [doc:adr-116 P1] 计算单槽覆盖后的平移与旋转。 |
| `dumpBoneHierarchy()` | `scene/motion/bone-override` | 导出当前聚焦模型的骨骼层级与覆盖状态。 |
| `getAllOverrides()` | `scene/motion/bone-override` | 获取当前所有覆盖的条目列表（用于持久化/UI 展示）。 |
| `getFrameHooksSnapshot()` | `scene/motion/bone-override` | 按 order 升序返回当前注册的所有帧钩子快照（不含 hook 函数本身）。 |
| `getOverride()` | `scene/motion/bone-override` | [doc:adr-116] 读取单条骨骼的覆盖条目（用于 UI 回填）。不存在返回 undefined。 |
| `getOverrideType()` | `scene/motion/bone-override` | 查询骨骼覆盖类型（零分配）。 |
| `getWasmIkResolver()` | `scene/motion/bone-override` | [ADR-202 §六] 获取 WASM IK 重解回调（供 feet-adjustment 等外部模块调用）。 |
| `protectIkPosition()` | `scene/motion/bone-override` | 注册骨骼位置保护（帧钩子内调用）。 |
| `registerBoneOverrideFrameHook()` | `scene/motion/bone-override` | — |
| `restoreOverrides()` | `scene/motion/bone-override` | 从持久化的条目列表批量恢复覆盖。 |
| `setBoneOverride()` | `scene/motion/bone-override` | 设置单条骨骼覆盖。 |
| `setBoneOverridePosition()` | `scene/motion/bone-override` | [doc:adr-116] 设置单条骨骼的位置覆盖（P2 引擎扩展）。 |
| `setBoneOverrideQuat()` | `scene/motion/bone-override` | 设置单条骨骼覆盖（直接传四元数）。 |
| `setWasmIkResolver()` | `scene/motion/bone-override` | [ADR-202 A-class] 注入 WASM IK 重解回调。 |
| `startBoneOverride()` | `scene/motion/bone-override` | — |
| `stopBoneOverride()` | `scene/motion/bone-override` | 停止覆盖系统。 |
| `FeetModelProvider()` | `scene/motion/feet-adjustment` | 注入：返回需要处理脚部调整的模型及其 runtime bones |
| `FootLandEvent()` | `scene/motion/feet-adjustment` | 落地事件：脚从空中接触地面的瞬间（ADR-088 供脚步声消费）。 |
| `isFeetAdjustmentRunning()` | `scene/motion/feet-adjustment` | 查询脚部跟随系统是否正在运行（observer 已注册）。 |
| `setOnFootLand()` | `scene/motion/feet-adjustment` | 注入落地事件回调（null 取消）。脚步声控制器调用。 |
| `solveFootTarget()` | `scene/motion/feet-adjustment` | — |
| `startFeetAdjustment()` | `scene/motion/feet-adjustment` | 启动脚部调整系统：注册为 MotionPipeline bone-override 层（order=5）。 |
| `stopFeetAdjustment()` | `scene/motion/feet-adjustment` | 停止脚部调整系统并清空缓存。 |
| `resolveGroundSfxKind()` | `scene/motion/footstep` | 依据当前地面类型推断脚步音色。 |
| `startFootstep()` | `scene/motion/footstep` | 启动脚步声系统：注入落地事件回调。 |
| `stopFootstep()` | `scene/motion/footstep` | 停止脚步声系统并清空合成缓存。 |
| `getLipSyncState()` | `scene/motion/lipsync-bridge` | — |
| `initLipSync()` | `scene/motion/lipsync-bridge` | — |
| `resetLipSyncOnFocusChange()` | `scene/motion/lipsync-bridge` | — |
| `setLipSyncEnabled()` | `scene/motion/lipsync-bridge` | — |
| `setLipSyncIntensity()` | `scene/motion/lipsync-bridge` | — |
| `setLipSyncMultiMorphEnabled()` | `scene/motion/lipsync-bridge` | — |
| `setLipSyncSensitivity()` | `scene/motion/lipsync-bridge` | — |
| `setLipSyncState()` | `scene/motion/lipsync-bridge` | — |
| `updateLipSync()` | `scene/motion/lipsync-bridge` | 保留空壳避免外部引用断裂，实际逻辑已由 perception observer 调度。 |
| `LoadableProcId()` | `scene/motion/motion-intent` | — |
| `addSceneMotion()` | `scene/motion/motion-intent` | 新增主动作到场景库。 |
| `clearAllSceneMotions()` | `scene/motion/motion-intent` | 清空整个场景动作库 + 默认动作。 |
| `findOrCreateModuleState()` | `scene/motion/motion-intent` | [doc:adr-121 P4-1] 在 intent.motionModules 中查找或创建模块状态。 |
| `getActiveMotion()` | `scene/motion/motion-intent` | 获取当前默认动作（派生自 _activeMotionId）。 |
| `getActiveMotionId()` | `scene/motion/motion-intent` | 获取当前默认动作 id。null = 无默认。 |
| `getAllLoadableProcMotions()` | `scene/motion/motion-intent` | 获取全部可加载的程序化动作 ID 列表（含未加载的）。 |
| `getLoadedProceduralMotions()` | `scene/motion/motion-intent` | 获取当前已加载的程序化动作集合。 |
| `getMotionGen()` | `scene/motion/motion-intent` | 获取当前 generation 值。用于异步操作中判断是否为最新广播。 |
| `getSceneMotions()` | `scene/motion/motion-intent` | 获取场景级动作库（所有主动作列表）。 |
| `initMotionIntent()` | `scene/motion/motion-intent` | 初始化广播回调。由 bootstrap 点（如 scene.ts initScene）调用一次。 |
| `loadProceduralMotion()` | `scene/motion/motion-intent` | 加载一个程序化动作到集合。 |
| `removeSceneMotion()` | `scene/motion/motion-intent` | 移除场景库中的某个主动作。 |
| `replaceDefaultMotion()` | `scene/motion/motion-intent` | [adr-169] 原位替换默认动作。 |
| `resolveCompatibility()` | `scene/motion/motion-intent` | 兼容性解析：判断指定模型的骨骼列表是否兼容某 VMD 动作。 |
| `setBroadcastCallback()` | `scene/motion/motion-intent` | 测试用例间需 setBroadcastCallback(null) 隔离回调，而 initMotionIntent 的幂等守卫不允许置空。 |
| `setDefaultMotion()` | `scene/motion/motion-intent` | 设置默认动作 id。 |
| `setLoadedProceduralMotions()` | `scene/motion/motion-intent` | 设置已加载集合（用于场景反序列化）。始终保证 'none' 存在。 |
| `unloadProceduralMotion()` | `scene/motion/motion-intent` | 卸载一个程序化动作。'none' 不可卸载。 |
| `BODY_POSTURE_DEF()` | `scene/motion/motion-modules/body-posture` | 身体姿态模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） |
| `createBodyPostureModule()` | `scene/motion/motion-modules/body-posture` | 创建身体姿态模块实例 |
| `LEFT_FOOT_DEF()` | `scene/motion/motion-modules/foot-modules` | — |
| `RIGHT_FOOT_DEF()` | `scene/motion/motion-modules/foot-modules` | — |
| `LEFT_HAND_DEF()` | `scene/motion/motion-modules/hand-modules` | — |
| `RIGHT_HAND_DEF()` | `scene/motion/motion-modules/hand-modules` | — |
| `FrameHookManager()` | `scene/motion/motion-modules/module-base` | 帧钩子管理器的返回类型（供 createEnsureActive 复用） |
| `ModuleBaseMethods()` | `scene/motion/motion-modules/module-base` | createModuleBase 返回的方法子集（与 MotionOverrideModule 对应方法签名一致） |
| `ModuleBaseOverrides()` | `scene/motion/motion-modules/module-base` | 模块基础行为覆盖 |
| `ModuleShellConfig()` | `scene/motion/motion-modules/module-base` | [doc:adr-146 P3 主题12] 模块实例外壳 — 消除 6 个工厂末尾重复的 `id/meta/priority/managedBones/buildSchema + |
| `applyModuleSnapshot()` | `scene/motion/motion-modules/module-base` | [doc:adr-125] 将快照应用到指定模型的所有模块。 |
| `createEnsureActive()` | `scene/motion/motion-modules/module-base` | [doc:adr-146 P3] ensureActive 公共工厂 — 消除 body-posture/foot/hand 复制粘贴的 「先 bake 重烤、再幂等注册帧钩子」模 |
| `createFrameHookManager()` | `scene/motion/motion-modules/module-base` | [doc:adr-116 P3] 帧钩子管理器 — 消除 sway/riding 的 _xxxFrameHooks Map 重复模式。 |
| `createModuleBase()` | `scene/motion/motion-modules/module-base` | 创建模块通用方法，减少 7 个模块间 ~105 行重复 boilerplate。 |
| `createModuleShell()` | `scene/motion/motion-modules/module-base` | — |
| `prepareBake()` | `scene/motion/motion-modules/module-base` | [doc:adr-146 P3 主题13] bake 头部守卫 — 消除 6 个 bake 重复的 `getModuleState + enabled 守卫 + claimBone |
| `MotionHistoryEntry()` | `scene/motion/motion-modules/motion-history` | — |
| `SnapshotApplier()` | `scene/motion/motion-modules/motion-history` | 应用快照到引擎的回调（调用方负责从 registry 读模块实例并 setState/enable/disable） |
| `SnapshotBuilder()` | `scene/motion/motion-modules/motion-history` | 构建当前全量快照的回调（调用方负责从 registry 读状态） |
| `canRedo()` | `scene/motion/motion-modules/motion-history` | 是否有可重做的记录 |
| `canUndo()` | `scene/motion/motion-modules/motion-history` | 是否有可撤销的记录 |
| `clearHistory()` | `scene/motion/motion-modules/motion-history` | 清除指定模型的历史（删除模型时调用） |
| `getHistoryCursor()` | `scene/motion/motion-modules/motion-history` | 获取当前游标位置（UI 高亮用） |
| `getHistoryEntries()` | `scene/motion/motion-modules/motion-history` | 获取历史条目列表（UI 显示用） |
| `jumpToHistory()` | `scene/motion/motion-modules/motion-history` | [doc:adr-125 P3] 跳转到指定历史位置。 |
| `pushHistory()` | `scene/motion/motion-modules/motion-history` | 记录一次参数变更到历史栈。 |
| `redo()` | `scene/motion/motion-modules/motion-history` | 重做一步（恢复到下一条快照），返回是否成功 |
| `undo()` | `scene/motion/motion-modules/motion-history` | 撤销一步（恢复到上一条快照），返回是否成功 |
| `computeFootPitch()` | `scene/motion/motion-modules/motion-math` | 单足俯仰角（度）。 |
| `computePedalPhase()` | `scene/motion/motion-modules/motion-math` | 踏板相位（度，0-360 自然循环）。 |
| `computeSwayYaw()` | `scene/motion/motion-modules/motion-math` | 摇摆正弦 yaw（度）。 |
| `applyMotionPreset()` | `scene/motion/motion-modules/preset-types` | 应用预设到指定模型。 |
| `generatePresetId()` | `scene/motion/motion-modules/preset-types` | — |
| `modulesToPresetMap()` | `scene/motion/motion-modules/preset-types` | MotionModuleState[] → MotionPreset['modules'] |
| `BoneConflict()` | `scene/motion/motion-modules/registry` | — |
| `applyMotionModulesToModel()` | `scene/motion/motion-modules/registry` | [doc:adr-129] 将场景级模块配置应用到指定模型 用于动作广播时应用配置到所有 inherit 模型 |
| `claimBones()` | `scene/motion/motion-modules/registry` | 为模块声明对一组骨骼的所有权（bake 前调用）。 |
| `clearAllModulesForModel()` | `scene/motion/motion-modules/registry` | 清除指定模型的所有模块覆盖（删除模型时调用） |
| `createModule()` | `scene/motion/motion-modules/registry` | 为指定模型创建模块实例 |
| `getAllConflicts()` | `scene/motion/motion-modules/registry` | 获取某模型全部模块的冲突明细（按 loser 模块分组） |
| `getBuiltinModuleDefs()` | `scene/motion/motion-modules/registry` | 内置模块定义聚合（供 initMotionModules 批量注册，消除 6 个 registerXxx 分散调用）。 |
| `getConflictCount()` | `scene/motion/motion-modules/registry` | 获取某模型冲突总数（骨骼数） |
| `getModuleConflicts()` | `scene/motion/motion-modules/registry` | 获取某模块被其他模块抢占的骨骼明细（loser 视角：本模块想要但被谁抢） |
| `getModuleDefaultParam()` | `scene/motion/motion-modules/registry` | [doc:adr-116] 读取模块注册的默认参数值。 |
| `getModuleState()` | `scene/motion/motion-modules/registry` | 获取动作的模块配置（不存在则创建默认状态，种入 defaults）。 |
| `getOwnedBones()` | `scene/motion/motion-modules/registry` | 获取模块当前 owned 的骨骼（disable 时用于精确清除） |
| `getRegisteredModules()` | `scene/motion/motion-modules/registry` | 获取所有已注册模块的元信息（按优先级排序） |
| `initMotionModules()` | `scene/motion/motion-modules/registry` | 注册所有内置模块（幂等，重复调用安全） |
| `registerModule()` | `scene/motion/motion-modules/registry` | 注册一个动作覆盖模块 |
| `releaseOwnedBones()` | `scene/motion/motion-modules/registry` | 释放模块的 ownedBones 记录并级联清引擎槽（由 store.releaseBones 负责清除） |
| `setModuleEnabled()` | `scene/motion/motion-modules/registry` | 设置模块启用/禁用状态到场景动作意图 |
| `setModuleParam()` | `scene/motion/motion-modules/registry` | 写入模块参数到场景动作意图 |
| `setTargetModel()` | `scene/motion/motion-modules/registry` | 切换目标模型：禁用当前模型的所有模块覆盖，启用新模型已保存的模块状态。 |
| `unregisterModule()` | `scene/motion/motion-modules/registry` | 注销模块 |
| `RIDING_MODEL_DEF()` | `scene/motion/motion-modules/riding-model` | 骑行模型模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） |
| `createRidingModelModule()` | `scene/motion/motion-modules/riding-model` | 创建骑行模型模块实例 |
| `ModuleDef()` | `scene/motion/motion-modules/types` | 模块注册定义（工厂 + 元信息 + 优先级），用于 BUILTIN_MODULE_DEFS 批量注册 |
| `ModuleFactory()` | `scene/motion/motion-modules/types` | 模块工厂函数：接受 modelId，返回绑定到该模型的模块实例。 |
| `ModuleMeta()` | `scene/motion/motion-modules/types` | 模块元信息 |
| `MotionOverrideModule()` | `scene/motion/motion-modules/types` | [doc:adr-116] 动作覆盖模块接口 模块是无状态转换器的壳：状态存储在 ModelInstance.motionOverrideModules 中， 模块实例负责「语义参 |
| `FrameContext()` | `scene/motion/motion-pipeline` | 帧上下文，由各层按需取用。调度器内核不依赖其中任何字段。 |
| `MotionPipeline()` | `scene/motion/motion-pipeline` | — |
| `PipelineLayer()` | `scene/motion/motion-pipeline` | 单个管线层。 |
| `PipelineStage()` | `scene/motion/motion-pipeline` | 管线阶段。顺序来自 ADR-116 §一 的 6 层动作管线； Ragdoll(④) 已于 ADR-061 永久移除，此处省略。 |
| `getMotionPipeline()` | `scene/motion/motion-pipeline` | — |
| `_applyBalanceSway()` | `scene/motion/perception-balance` | — |
| `_resetBalanceSwayState()` | `scene/motion/perception-balance` | 重置增量状态到默认值（每个模型 context 独立持有 balanceState，避免跨模型污染） |
| `_applyBlinking()` | `scene/motion/perception-blinking` | — |
| `_applyBreathing()` | `scene/motion/perception-breathing` | — |
| `_updateBoneChain()` | `scene/motion/perception-breathing` | — |
| `_applyMicroExpression()` | `scene/motion/perception-expression` | — |
| `_applyEyeGazeJS()` | `scene/motion/perception-gaze-js` | JS 模式：眼部跟随（薄包装：调用 core + 注入 JS 写入策略） |
| `_applyHeadGazeJS()` | `scene/motion/perception-gaze-js` | JS 模式：头部跟随（薄包装：调用 core + 注入 JS 写入策略） |
| `_applyEyeGazeWasm()` | `scene/motion/perception-gaze-wasm` | WASM 模式：眼部跟随（薄包装：调用 core + 注入 WASM 写入策略） |
| `_applyHeadGazeWasm()` | `scene/motion/perception-gaze-wasm` | WASM 模式：头部跟随（薄包装：调用 core + 注入 WASM 写入策略） |
| `EYE_BONE_CANDIDATES()` | `scene/motion/perception-gaze` | 眼球骨骼候选名（JS/WASM 路径共用） |
| `EyeGazeWriteStrategy()` | `scene/motion/perception-gaze` | 眼部跟随写入策略（JS/WASM 各自实现） |
| `HEAD_BONE_CANDIDATES()` | `scene/motion/perception-gaze` | 头部骨骼候选名（JS/WASM 路径共用） |
| `HeadGazeWriteStrategy()` | `scene/motion/perception-gaze` | 头部跟随写入策略（JS/WASM 各自实现） |
| `_applyEyeGazeCore()` | `scene/motion/perception-gaze` | 眼部跟随共用骨架（eyeCenter → lookDir → targetWorldQ → 每眼 clamp/Slerp/cache → strategy.writeEye） |
| `_applyGaze()` | `scene/motion/perception-gaze` | 统一调度入口（perception.ts observer 调用） |
| `_applyHeadGazeCore()` | `scene/motion/perception-gaze` | 头部跟随共用骨架（lookDir → targetWorldQ → clamp → Slerp → cache → strategy.writeHead） |
| `_clampEyeGazeTarget()` | `scene/motion/perception-gaze` | 眼球专用包装（相对头部坐标系，用更紧的生理锥形） |
| `_clampGazeTargetInParentFrame()` | `scene/motion/perception-gaze` | 将"转向相机的目标世界旋转"钳制在相对父骨骼坐标系的 yaw/pitch 锥形内。 |
| `_clampHeadGazeTarget()` | `scene/motion/perception-gaze` | 头部专用包装（维持已有回归测试签名不变） |
| `_getGazeTarget()` | `scene/motion/perception-gaze` | 获取视线目标点（AR 模式沿相机朝向投射，普通模式用相机位置） |
| `applyGazeWasm()` | `scene/motion/perception-gaze` | WASM 模式下的 gaze 应用（供 wasm-layers-blender.ts 调用） |
| `getEyeGazeMaxPitch()` | `scene/motion/perception-gaze` | — |
| `getEyeGazeMaxYaw()` | `scene/motion/perception-gaze` | — |
| `getEyeGazeSmooth()` | `scene/motion/perception-gaze` | — |
| `_applyLipSync()` | `scene/motion/perception-lipsync` | — |
| `_applyPerceptionForContext()` | `scene/motion/perception-observer` | 对单个 context 应用完整感知管线 |
| `_getActiveContextsByTier()` | `scene/motion/perception-observer` | [doc:adr-164] 根据 tier 返回应激活的 context 列表 |
| `getMediumMaxOthers()` | `scene/motion/perception-observer` | 获取 medium 档非焦点模型上限 |
| `BalanceSwayState()` | `scene/motion/perception-shared` | 重心微动增量状态（供 PerceptionContext.lastOffsets.balance 使用） |
| `DEFAULT_PERCEPTION_STATE()` | `scene/motion/perception-shared` | — |
| `Emotion()` | `scene/motion/perception-shared` | 情绪类型（微表情驱动） |
| `GazeCache()` | `scene/motion/perception-shared` | Gaze 跨帧缓存：头部存世界 Q，眼部存本地 Q（相对父骨骼，避免头部旋转后缓存过期） |
| `GazeConfig()` | `scene/motion/perception-shared` | Gaze 配置类型 |
| `MeshMetadata()` | `scene/motion/perception-shared` | — |
| `MmdModelLike()` | `scene/motion/perception-shared` | MMD 模型最小接口（供 perception 子系统使用，避免 any） |
| `PerceptionContext()` | `scene/motion/perception-shared` | 每模型感知上下文（替代原单例，支持焦点 + pinned 多模型） |
| `PerceptionPerfMonitor()` | `scene/motion/perception-shared` | 感知层性能监控器：三档自动降级 + 手动覆盖 |
| `PerceptionPool()` | `scene/motion/perception-shared` | 单 context 对象池（per-model 隔离，解决全局池覆写污染） |
| `PerceptionState()` | `scene/motion/perception-shared` | — |
| `PerceptionTier()` | `scene/motion/perception-shared` | — |
| `_createPerceptionPool()` | `scene/motion/perception-shared` | 创建单 context 对象池 |
| `_gazeAlpha()` | `scene/motion/perception-shared` | 计算 gaze Slerp alpha（基于 deltaTime 的指数衰减，帧率无关） |
| `_gazeLog()` | `scene/motion/perception-shared` | — |
| `_incGazeLogFrame()` | `scene/motion/perception-shared` | — |
| `_isWasmRuntime()` | `scene/motion/perception-shared` | — |
| `_m()` | `scene/motion/perception-shared` | — |
| `_propagateChildrenWasm()` | `scene/motion/perception-shared` | 递归传播子骨骼 worldMatrix |
| `_q()` | `scene/motion/perception-shared` | — |
| `_qAngleDeg()` | `scene/motion/perception-shared` | 两四元数夹角（度） |
| `_resetContextPool()` | `scene/motion/perception-shared` | 重置当前池的 index（context 切换时重置，避免跨帧累积） |
| `_setContextPool()` | `scene/motion/perception-shared` | 切换到指定 context 的池（进入该 context 感知管线前调用） |
| `_v3()` | `scene/motion/perception-shared` | — |
| `_writeMatToBuffer()` | `scene/motion/perception-shared` | 把 Matrix 写回 Float32Array(16) |
| `feetDebug()` | `scene/motion/perception-shared` | — |
| `getEyeGazeMaxPitch()` | `scene/motion/perception-shared` | 获取眼部跟随最大俯仰角（弧度） |
| `getEyeGazeMaxYaw()` | `scene/motion/perception-shared` | 获取眼部跟随最大偏航角（弧度） |
| `getEyeGazeSmooth()` | `scene/motion/perception-shared` | 获取眼部跟随平滑度 |
| `getHeadGazeMaxPitch()` | `scene/motion/perception-shared` | 获取头部跟随最大俯仰角（弧度） |
| `getHeadGazeMaxYaw()` | `scene/motion/perception-shared` | 获取头部跟随最大偏航角（弧度） |
| `isWasmRuntime()` | `scene/motion/perception-shared` | 判断骨骼是否运行在 WASM runtime（无 updateWorldMatrix 方法）。 |
| `setGazeAngles()` | `scene/motion/perception-shared` | 更新头部跟随角度限位（度→弧度，由 perception.ts setter 调用） |
| `__testOnlyGetContext()` | `scene/motion/perception` | 测试用：获取指定模型的 context（含 lastOffsets） |
| `_clampEyeGazeTarget()` | `scene/motion/perception` | — |
| `_clampHeadGazeTarget()` | `scene/motion/perception` | — |
| `_getGazeResetTick()` | `scene/motion/perception` | 获取 gaze 重置计数（供测试验证调用时机） |
| `_isWasmRuntime()` | `scene/motion/perception` | — |
| `_propagateChildrenWasm()` | `scene/motion/perception` | — |
| `_resetGazeState()` | `scene/motion/perception` | 重置 gaze 增量状态（清理跨帧缓存，避免切换/开关后出现跳跃） |
| `_writeMatToBuffer()` | `scene/motion/perception` | — |
| `activatePerception()` | `scene/motion/perception` | 激活感知层（呼吸/眨眼/gaze） |
| `applyGazeWasm()` | `scene/motion/perception` | — |
| `deactivatePerception()` | `scene/motion/perception` | 注销感知层 |
| `disableAllPerception()` | `scene/motion/perception` | 全员关闭感知层（仅焦点 + pinned 保留） |
| `enableAllPerception()` | `scene/motion/perception` | 全员激活感知层（受 tier 限制） |
| `getPerceptionPerfManualTier()` | `scene/motion/perception` | [doc:adr-164] 获取手动档位设置（'auto' 表示自动降级模式） |
| `getPerceptionPerfTier()` | `scene/motion/perception` | 获取当前性能档位 |
| `getPerceptionState()` | `scene/motion/perception` | 获取感知状态（焦点 context 状态，兼容旧 API） |
| `getPerceptionStateFor()` | `scene/motion/perception` | 获取指定模型的感知状态（不存在时回退 fallback） |
| `getPinnedModelIds()` | `scene/motion/perception` | 获取当前 pinned 模型 ID 列表 |
| `isAllPerceptionEnabled()` | `scene/motion/perception` | [doc:adr-164] 获取全员感知开关状态 |
| `onPerceptionModelRemoved()` | `scene/motion/perception` | 兼容接口：模型移除时清理（供 proc-motion-bridge.ts 调用） |
| `pinPerception()` | `scene/motion/perception` | [doc:adr-164] pin 模型感知（原 ≤5 上限已移除，全员感知由 tier 控制） |
| `setAllPerceptionEnabled()` | `scene/motion/perception` | [doc:adr-164] 设置全员感知开关状态 |
| `setBalanceSwayAmplitude()` | `scene/motion/perception` | 设置重心微动振幅（全局乘数，钳制 0–2.0） |
| `setBalanceSwayEnabled()` | `scene/motion/perception` | 设置重心微动开关（[doc:adr-079] Phase 2） |
| `setBalanceSwayPeriod()` | `scene/motion/perception` | 设置重心微动周期（秒，钳制 0.5–5.0） |
| `setBlinkAmplitude()` | `scene/motion/perception` | 设置眨眼幅度（0–1，钳制） |
| `setBlinkEnabled()` | `scene/motion/perception` | 设置眨眼开关 |
| `setBlinkFrequency()` | `scene/motion/perception` | 设置眨眼频率（Hz，钳制 0.05–0.5） |
| `setBreathAmplitude()` | `scene/motion/perception` | 设置呼吸幅度（弧度，钳制 0–0.05） |
| `setBreathEnabled()` | `scene/motion/perception` | 设置呼吸开关 |
| `setBreathFrequency()` | `scene/motion/perception` | 设置呼吸频率（Hz，钳制 0.1–1.0） |
| `setEmotion()` | `scene/motion/perception` | 设置情绪类型 |
| `setEyeGazeMaxPitch()` | `scene/motion/perception` | 设置眼部跟随最大俯仰角（度，钳制 0–15） |
| `setEyeGazeMaxYaw()` | `scene/motion/perception` | 设置眼部跟随最大偏航角（度，钳制 0–15） |
| `setEyeGazeSmooth()` | `scene/motion/perception` | 设置眼部跟随平滑度（0–1） |
| `setEyeTrackingEnabled()` | `scene/motion/perception` | 设置眼部跟随开关 |
| `setGazeConfig()` | `scene/motion/perception` | 兼容接口：设置 gaze 配置（供 proc-motion-bridge.ts 调用） |
| `setHeadGazeMaxPitch()` | `scene/motion/perception` | 设置头部跟随最大俯仰角（度，钳制 0–90） |
| `setHeadGazeMaxYaw()` | `scene/motion/perception` | 设置头部跟随最大偏航角（度，钳制 0–90） |
| `setHeadTrackingEnabled()` | `scene/motion/perception` | 设置头部跟随开关 |
| `setLipSyncEnabled()` | `scene/motion/perception` | 设置 lip-sync 开关 |
| `setLipSyncIntensity()` | `scene/motion/perception` | 设置 lip-sync 强度（钳制 0..1） |
| `setLipSyncMultiMorphEnabled()` | `scene/motion/perception` | 设置多口型 morph 开关 |
| `setLipSyncSensitivity()` | `scene/motion/perception` | 设置 lip-sync 灵敏度（钳制 0..1） |
| `setMicroExpressionEnabled()` | `scene/motion/perception` | 设置微表情开关 |
| `setPerceptionPerfTier()` | `scene/motion/perception` | 手动设置性能档位（auto/high/medium/low） |
| `setPerceptionState()` | `scene/motion/perception` | 设置感知状态（从存储恢复时使用） |
| `setPerceptionStateFor()` | `scene/motion/perception` | 设置指定模型的感知状态 |
| `unpinPerception()` | `scene/motion/perception` | unpin 模型感知（非焦点模型同步 deactivate） |
| `PlaybackObservablesDispose()` | `scene/motion/playback` | — |
| `initPlaybackObservables()` | `scene/motion/playback` | — |
| `seekFromEvent()` | `scene/motion/playback` | — |
| `updatePlaybackUI()` | `scene/motion/playback` | — |
| `activateGazeTracking()` | `scene/motion/proc-motion-bridge` | — |
| `createProcBeatDetector()` | `scene/motion/proc-motion-bridge` | — |
| `disposeProcMotion()` | `scene/motion/proc-motion-bridge` | 释放程序化动作模块全部资源并销毁单例。应用关闭 / 模块卸载时调用。 |
| `getBpmQuantizeEnabled()` | `scene/motion/proc-motion-bridge` | — |
| `getProcBeatDetector()` | `scene/motion/proc-motion-bridge` | — |
| `getProcMotionState()` | `scene/motion/proc-motion-bridge` | — |
| `isProcVmdActive()` | `scene/motion/proc-motion-bridge` | — |
| `onModelRemoved()` | `scene/motion/proc-motion-bridge` | — |
| `regenerateProcMotion()` | `scene/motion/proc-motion-bridge` | — |
| `setBpmQuantizeEnabled()` | `scene/motion/proc-motion-bridge` | — |
| `setGazeLayerActive()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionBoneToggle()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionBoneToggles()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionEyeTrackingEnabled()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionHeadTrackingEnabled()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionIntensity()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionInterpOverride()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionMode()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionSpeed()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionState()` | `scene/motion/proc-motion-bridge` | — |
| `setProcMotionVpdApplyEnabled()` | `scene/motion/proc-motion-bridge` | — |
| `stopProcMotion()` | `scene/motion/proc-motion-bridge` | — |
| `updateProcMotion()` | `scene/motion/proc-motion-bridge` | — |
| `_filterVmdBones()` | `scene/motion/vmd-layers` | 过滤 VMD 二进制数据，只保留指定骨骼的关键帧。 |
| `addGazeLayer()` | `scene/motion/vmd-layers` | 添加一个视线追踪（gaze）图层。 |
| `addVmdLayer()` | `scene/motion/vmd-layers` | 添加一个 VMD 图层到模型。 |
| `addVmdLayersFromPaths()` | `scene/motion/vmd-layers` | 批量添加 VMD 图层（场景恢复用）。 |
| `getVmdLayers()` | `scene/motion/vmd-layers` | 获取模型的图层列表 |
| `rebuildCompositeAnimation()` | `scene/motion/vmd-layers` | 触发复合动画重建（程序化/外部修改 vmdData/vmdLayers 后调用）。 |
| `removeVmdLayer()` | `scene/motion/vmd-layers` | 移除一个 VMD 图层 |
| `setVmdLayerWeight()` | `scene/motion/vmd-layers` | 设置图层权重 |
| `toggleVmdLayer()` | `scene/motion/vmd-layers` | 切换图层启用/禁用 |
| `loadCameraVmdFromPath()` | `scene/motion/vmd-loader` | — |
| `loadVMDFromPath()` | `scene/motion/vmd-loader` | — |
| `loadVMDMotion()` | `scene/motion/vmd-loader` | — |
| `loadVPDPose()` | `scene/motion/vmd-loader` | — |
| `DEFAULT_LAYER_BONE_FILTER()` | `scene/motion/wasm-layers-blender` | — |
| `WasmLayerConfig()` | `scene/motion/wasm-layers-blender` | — |
| `addWasmLayer()` | `scene/motion/wasm-layers-blender` | — |
| `initWasmLayersBlender()` | `scene/motion/wasm-layers-blender` | 初始化 blender 的场景级依赖（必须在 setupWasmLayersBlender 之前调用）。 |
| `isWasmLayersBlenderActive()` | `scene/motion/wasm-layers-blender` | — |
| `removeWasmLayer()` | `scene/motion/wasm-layers-blender` | — |
| `setupWasmLayersBlender()` | `scene/motion/wasm-layers-blender` | — |
| `teardownWasmLayersBlender()` | `scene/motion/wasm-layers-blender` | — |
| `updateWasmLayerWeight()` | `scene/motion/wasm-layers-blender` | — |
| `DEFAULT_LAYER_BONE_FILTER()` | `scene/motion/wasm-layers-config` | — |
| `applyGroundCollision()` | `scene/physics/ground-collision` | 根据当前 envState 还原地面碰撞状态（运行时就绪 / 场景加载后调用） |
| `disableGroundCollision()` | `scene/physics/ground-collision` | 禁用地面碰撞：从所有世界移除并释放资源。 |
| `enableGroundCollision()` | `scene/physics/ground-collision` | 启用地面碰撞：注入静态地板刚体到所有物理世界。幂等。 |
| `isGroundCollisionEnabled()` | `scene/physics/ground-collision` | 地面碰撞是否处于启用状态 |
| `SkirtAnalysisResult()` | `scene/physics/skirt-analyzer` | — |
| `SkirtAnalyzerOptions()` | `scene/physics/skirt-analyzer` | — |
| `SkirtChain()` | `scene/physics/skirt-analyzer` | — |
| `SkirtSegment()` | `scene/physics/skirt-analyzer` | — |
| `analyzeSkirt()` | `scene/physics/skirt-analyzer` | 分析 mesh 拓扑，识别裙摆区域并生成虚拟骨骼链。 |
| `QUALITY_PRESETS()` | `scene/physics/virtual-skirt` | — |
| `VirtualSkirtConfig()` | `scene/physics/virtual-skirt` | — |
| `VirtualSkirtController()` | `scene/physics/virtual-skirt` | 虚拟裙骨物理控制器。 |
| `VirtualSkirtQuality()` | `scene/physics/virtual-skirt` | 质量档位：auto 按平台自动解析，其余为固定档 |
| `defaultVirtualSkirtConfig()` | `scene/physics/virtual-skirt` | — |
| `localToWorld()` | `scene/physics/virtual-skirt` | 局部坐标 → 世界坐标（点变换，含平移）。 |
| `resolveVirtualSkirtQuality()` | `scene/physics/virtual-skirt` | Phase 5: 解析有效质量档位。 |
| `worldDeltaToLocal()` | `scene/physics/virtual-skirt` | 世界位移向量 → 局部位移向量（仅取旋转/缩放分量，忽略平移）。 |
| `CAMERA_PRESETS()` | `scene/pose/camera-angle` | 预设相机角度列表 |
| `CameraAnglePreset()` | `scene/pose/camera-angle` | 预设角度定义 |
| `applyCameraPreset()` | `scene/pose/camera-angle` | 切换到指定预设角度。 |
| `getAllPresets()` | `scene/pose/camera-angle` | 获取所有预设的列表（用于 UI 展示）。 |
| `presetCameraAlpha()` | `scene/pose/camera-angle` | 计算某预设对应的相机 alpha（弧度），以聚焦模型朝向为参考。 |
| `getGuideMode()` | `scene/pose/composition-guide` | 获取当前的辅助线模式。 |
| `setGuideMode()` | `scene/pose/composition-guide` | 设置构图辅助线模式。 |
| `DEFAULT_WATERMARK()` | `scene/pose/watermark` | — |
| `WatermarkConfig()` | `scene/pose/watermark` | — |
| `applyWatermark()` | `scene/pose/watermark` | 在 base64 图片数据上叠加水印。 |
| `getWatermarkConfig()` | `scene/pose/watermark` | 获取当前水印配置。 |
| `setWatermarkConfig()` | `scene/pose/watermark` | 设置水印配置（部分更新）。 |
| `LightConeEntry()` | `scene/render/light-cone` | — |
| `createLightCone()` | `scene/render/light-cone` | 为聚光灯创建光锥。 |
| `disposeLightCone()` | `scene/render/light-cone` | 释放光锥资源（先 mesh 后 material，避免 mesh.dispose 内部引用已释放材质） |
| `rebuildLightConeGeometry()` | `scene/render/light-cone` | 锥长/锥角变化时重建几何 |
| `setLightConeEnabled()` | `scene/render/light-cone` | 设置光锥可见性 |
| `updateLightConeTransform()` | `scene/render/light-cone` | 更新光锥的 transform（位置/朝向），每帧或灯光移动时调用 |
| `updateLightConeUniforms()` | `scene/render/light-cone` | 更新光锥的 shader uniforms（颜色/亮度/柔和度） |
| `DEFAULT_PERSONAL_LIGHT()` | `scene/render/lighting-follow` | — |
| `PersonalLightSettings()` | `scene/render/lighting-follow` | — |
| `attachPersonalLight()` | `scene/render/lighting-follow` | — |
| `detachPersonalLight()` | `scene/render/lighting-follow` | — |
| `disposeAllPersonalLights()` | `scene/render/lighting-follow` | — |
| `getAllPersonalLights()` | `scene/render/lighting-follow` | 导出所有个人灯状态（仅非默认值差异落盘由调用方决定） |
| `getPersonalLightDefault()` | `scene/render/lighting-follow` | 获取用户保存的个人灯默认值，无则返回 null。 |
| `getPersonalLightState()` | `scene/render/lighting-follow` | — |
| `resetPersonalLightDefault()` | `scene/render/lighting-follow` | 重置用户默认值回出厂硬编码值。 |
| `restorePersonalLights()` | `scene/render/lighting-follow` | 场景反序列化后，按 modelId 恢复个人灯设置（attach 已由 onModelLoaded 触发，此处仅覆盖参数） |
| `setPersonalLightDefault()` | `scene/render/lighting-follow` | 将当前个人灯参数保存为用户默认值。 |
| `setPersonalLightState()` | `scene/render/lighting-follow` | — |
| `tickPersonalLights()` | `scene/render/lighting-follow` | — |
| `tickStageLightFollow()` | `scene/render/lighting-follow` | 舞台灯追光 tick：更新所有绑定了 followTarget 的舞台灯 |
| `LIGHTING_PRESETS()` | `scene/render/lighting-presets` | — |
| `LightingPreset()` | `scene/render/lighting-presets` | — |
| `LightingPresetLight()` | `scene/render/lighting-presets` | — |
| `PRESET_NAMES()` | `scene/render/lighting-presets` | 预设名称列表（有序） |
| `_addAllMeshesToShadow()` | `scene/render/lighting-shadow` | 遍历所有模型的 Mesh，加入阴影生成器。 |
| `_disposeStageShadow()` | `scene/render/lighting-shadow` | — |
| `_ensureShadow()` | `scene/render/lighting-shadow` | — |
| `_ensureStageShadow()` | `scene/render/lighting-shadow` | — |
| `rebuildShadowCasters()` | `scene/render/lighting-shadow` | 当模型/道具注册表更新时，重新生成阴影投射者列表。 |
| `_createStageLight()` | `scene/render/lighting-stage` | — |
| `_disposeStageLightEntry()` | `scene/render/lighting-stage` | 释放单个舞台灯 entry 的全部资源（指示器 + 灯 + 阴影 + 光锥）。 |
| `_updateIndicator()` | `scene/render/lighting-stage` | — |
| `addStageLight()` | `scene/render/lighting-stage` | — |
| `getActiveStageLightId()` | `scene/render/lighting-stage` | — |
| `getStageLightState()` | `scene/render/lighting-stage` | — |
| `getStageLights()` | `scene/render/lighting-stage` | — |
| `loadStageLights()` | `scene/render/lighting-stage` | 批量加载舞台灯（反序列化用），会清空现有灯 |
| `rebuildStageLightShadows()` | `scene/render/lighting-stage` | 重建所有舞台灯的阴影投射者列表（模型/道具变化时调用） |
| `removeStageLight()` | `scene/render/lighting-stage` | — |
| `setActiveStageLightId()` | `scene/render/lighting-stage` | — |
| `setStageLightState()` | `scene/render/lighting-stage` | — |
| `CONE_UPDATE_KEYS()` | `scene/render/lighting-state` | — |
| `LightingStateValues()` | `scene/render/lighting-state` | — |
| `LightingTween()` | `scene/render/lighting-state` | — |
| `SHADOW_REBUILD_KEYS()` | `scene/render/lighting-state` | — |
| `SUN_DISC_DISTANCE()` | `scene/render/lighting-state` | — |
| `SUN_DISC_MIN_INTENSITY()` | `scene/render/lighting-state` | 太阳圆盘可见的最小方向光强度。低于此值时隐藏。 |
| `StageLightEntry()` | `scene/render/lighting-state` | — |
| `lightingState()` | `scene/render/lighting-state` | — |
| `_disposeSunDisc()` | `scene/render/lighting-sun` | — |
| `_updateSunDisc()` | `scene/render/lighting-sun` | 更新方向光参考圆盘位置和颜色。圆盘始终在光线来源方向（视线反方向）。 |
| `_cancelAllLightingTweens()` | `scene/render/lighting-tween` | — |
| `_tweenColor3()` | `scene/render/lighting-tween` | — |
| `_tweenValue()` | `scene/render/lighting-tween` | — |
| `applyLightingPresetFromEnv()` | `scene/render/lighting-tween` | 应用灯光预设——复用现有灯光，平滑过渡参数。 |
| `LightState()` | `scene/render/lighting` | — |
| `StageLightState()` | `scene/render/lighting` | — |
| `StageLightType()` | `scene/render/lighting` | — |
| `_defaultStageLightState()` | `scene/render/lighting` | — |
| `disposeLighting()` | `scene/render/lighting` | 整体清理光照模块（场景销毁时调用） |
| `getDirLight()` | `scene/render/lighting` | 主方向光（未初始化时为 null）。 |
| `getHemiLight()` | `scene/render/lighting` | 主半球光（未初始化时为 null）。导出 getter 替代原 `export let`，消除导出可变绑定。 |
| `getLightState()` | `scene/render/lighting` | — |
| `initLighting()` | `scene/render/lighting` | — |
| `isLightingReady()` | `scene/render/lighting` | [fix:P1] 灯光运行时是否就绪（@dom/e2e 环境无灯光/管线时返回 false，供 UI/测试预检跳过守卫域）。 |
| `rebakeEnvBrightness()` | `scene/render/lighting` | [doc:adr-132] 当 envBrightness 变化时 rebake 存储的光照强度 |
| `setLightState()` | `scene/render/lighting` | 写入灯光状态。守卫未就绪时 logWarn + 返回 false（不再静默吞写）， 使「UI 可操作但 state 未生效」可被观测（@dom 测试环境无灯光对象时会命中）。 |
| `setSkipLightAutoSave()` | `scene/render/lighting` | 预设动画期间临时抑制 setLightState 内的自动保存，由 applyEnvPreset 控制 |
| `transitionLighting()` | `scene/render/lighting` | 平滑过渡当前灯光到目标灯光参数，默认 2 秒。 |
| `isAutoDegradingReflection()` | `scene/render/performance-env-bridge` | env-bridge.ts 调用此函数检查当前是否处于自动降级反射质量变更中 |
| `registerSetEnvState()` | `scene/render/performance-env-bridge` | env-bridge.ts 初始化时注册 setEnvState 函数 |
| `setAutoDegradingReflection()` | `scene/render/performance-env-bridge` | performance.ts 调用此函数通知 env-bridge 当前反射质量变更来自自动降级 |
| `setEnvStateForPerformance()` | `scene/render/performance-env-bridge` | performance.ts 调用此函数设置 envState（延迟绑定，避免循环导入） |
| `PerformanceMode()` | `scene/render/performance` | — |
| `RenderBridge()` | `scene/render/performance` | — |
| `getCurrentDegradeLevel()` | `scene/render/performance` | — |
| `getPerfRenderScaleMul()` | `scene/render/performance` | 降级系统对 renderScale 的乘数（1.0=无影响，0.7=降级时降至 70%）。 |
| `getPerformanceMode()` | `scene/render/performance` | — |
| `isSnapshotResetSuppressed()` | `scene/render/performance` | 供 setLightState/setRenderState 检查是否应跳过 resetPerformanceSnapshot。 |
| `recalcPerformanceReference()` | `scene/render/performance` | 重新计算刷新率基准（外接显示器变化时由 render-loop resize 触发）。 |
| `registerRenderBridge()` | `scene/render/performance` | ADR-159 P3-A：延迟绑定渲染桥接，由 scene.ts 在 initScene() 时注入。 |
| `resetPerformanceSnapshot()` | `scene/render/performance` | 重置性能快照（用户手动修改渲染/光照设置后调用）。 |
| `setPerformanceMode()` | `scene/render/performance` | 设置性能模式。 |
| `updatePerformance()` | `scene/render/performance` | 每帧调用（渲染循环内）。 |
| `QualityDimension()` | `scene/render/quality-profile` | 质量维度定义。 |
| `QualityProfile()` | `scene/render/quality-profile` | — |
| `QualityProfileSettings()` | `scene/render/quality-profile` | 从注册表派生 QualityProfileSettings 类型。 |
| `inferQualityProfile()` | `scene/render/quality-profile` | 从 EnvState 的独立质量字段反推当前 qualityProfile。 |
| `resolveQualityProfile()` | `scene/render/quality-profile` | 将 qualityProfile 解析为各域质量设置。 |
| `RenderState()` | `scene/render/renderer` | — |
| `ToneMappingMode()` | `scene/render/renderer` | — |
| `defaultRenderState()` | `scene/render/renderer` | — |
| `disposeRenderer()` | `scene/render/renderer` | 释放渲染管线及相关资源。在场景销毁时调用。 |
| `getRenderState()` | `scene/render/renderer` | — |
| `initRenderer()` | `scene/render/renderer` | — |
| `isRenderReady()` | `scene/render/renderer` | [fix:P1] 渲染管线是否就绪（@dom/e2e 环境无 pipeline/scene 时返回 false，供 UI/测试预检跳过守卫域）。 |
| `isRendererReady()` | `scene/render/renderer` | 检查渲染器是否已初始化。外部代码在调用 setRenderState 前可先检查。 |
| `isSSRActive()` | `scene/render/renderer` | SSR 管线当前是否激活（供 env-reflection 检查，尊重用户手动关闭）。 |
| `pipeline()` | `scene/render/renderer` | — |
| `reattachPipeline()` | `scene/render/renderer` | Re-attach the rendering pipeline to the current active camera (call after camera switch). |
| `rebuildOutlineState()` | `scene/render/renderer` | 当模型注册表更新时，重新应用边缘高亮状态。 |
| `registerCelGroundCoupling()` | `scene/render/renderer` | — |
| `setRenderState()` | `scene/render/renderer` | — |
| `setSSRFromReflection()` | `scene/render/renderer` | 反射系统专用 SSR 控制接口（不触发 auto-save）。 |
| `transitionRenderState()` | `scene/render/renderer` | 平滑过渡渲染状态到目标值，默认 2 秒。 |
| `GizmoAttachOptions()` | `scene/render/transform-gizmo` | — |
| `GizmoType()` | `scene/render/transform-gizmo` | — |
| `attachGizmo()` | `scene/render/transform-gizmo` | 为指定 Node 激活变换 Gizmo。 |
| `computeSnapDistance()` | `scene/render/transform-gizmo` | 纯函数：给定轴类型与吸附配置，计算吸附步长（场景单位）。 |
| `detachGizmo()` | `scene/render/transform-gizmo` | 移除当前 Gizmo。 |
| `getActiveGizmoTypes()` | `scene/render/transform-gizmo` | 获取当前激活的 Gizmo 轴类型组合（用于判断拖拽中是否在改缩放）。 |
| `getGizmoNode()` | `scene/render/transform-gizmo` | 获取当前 Gizmo 绑定的实时 Node（拖拽中其 transform 已被 Babylon 实时改写，供数值滑杆读取）。 |
| `getGizmoSnapConfig()` | `scene/render/transform-gizmo` | 读取当前网格吸附配置（enabled 默认 false，step 默认 1.0）。 |
| `getGizmoTargetId()` | `scene/render/transform-gizmo` | 获取当前 Gizmo 绑定的实体 ID。 |
| `initTransformGizmo()` | `scene/render/transform-gizmo` | — |
| `isGizmoActive()` | `scene/render/transform-gizmo` | 当前是否有 Gizmo 激活。 |
| `isGizmoDragging()` | `scene/render/transform-gizmo` | 当前是否正在拖拽 Gizmo（drag start → drag end 之间为 true）。 |
| `onGizmoDragObservable()` | `scene/render/transform-gizmo` | 拖拽进行中（连续）可观察量：任一 Gizmo 轴被拖动时每帧触发， 供数值滑杆实时同步显示（ADR-126 Phase 2 双模态）。 |
| `setGizmoSnapDistance()` | `scene/render/transform-gizmo` | 设置网格吸附配置。 |
| `exportSceneBundle()` | `scene/scene-bundle` | 导出场景为 bundle zip 文件。 |
| `importSceneBundle()` | `scene/scene-bundle` | 导入场景 bundle zip 文件。 |
| `migrateLipSyncFromOldState()` | `scene/scene-migrate` | 旧存档 lipSync → 新版 PerceptionState lipSync 字段。 |
| `migratePerceptionData()` | `scene/scene-migrate` | 旧存档 perception 格式迁移：PerceptionState → { focused, pinned }。 |
| `migratePerceptionFromProcMotion()` | `scene/scene-migrate` | 旧存档 ProcMotionState → 新版 PerceptionState 迁移。 |
| `SceneFile()` | `scene/scene-serialize` | — |
| `canUndo()` | `scene/scene-serialize` | — |
| `deserializeScene()` | `scene/scene-serialize` | Restore scene state from a SceneFile. |
| `offerSceneUndo()` | `scene/scene-serialize` | 破坏性操作后调用：弹出中性撤销 toast（复用 action-button toast，info 变体）。 |
| `offerSceneUndoAndRefresh()` | `scene/scene-serialize` | offerSceneUndo 的常见变体：撤销恢复后执行 reRender 回调并统一提示 `undoApplied`。 |
| `popUndoSnapshot()` | `scene/scene-serialize` | 弹出最近一次撤销快照（LIFO），供全局撤销按钮 / Ctrl+Z 使用。返回快照字符串，无快照时返回 null。 |
| `pushUndoSnapshot()` | `scene/scene-serialize` | 破坏性操作前调用：抓当前整场景快照压栈（环形，上限 UNDO_LIMIT），返回快照字符串供撤销绑定。 |
| `resolvePathFromRef()` | `scene/scene-serialize` | Resolve a file path from either a libraryRef or a raw absolute path. |
| `restoreUndoSnapshot()` | `scene/scene-serialize` | 恢复特定快照到整场景。返回是否成功恢复。 |
| `saveSceneImmediate()` | `scene/scene-serialize` | — |
| `serializeScene()` | `scene/scene-serialize` | 序列化当前场景为 SceneFile（分段容错，单模型失败跳过并记录）。 |
| `setSuppressAutoSave()` | `scene/scene-serialize` | — |
| `triggerAutoSaveImpl()` | `scene/scene-serialize` | — |
| `tryRestoreLastScene()` | `scene/scene-serialize` | — |
| `DEFAULT_MAT_PARAMS()` | `scene/scene` | — |
| `LoadLastScene()` | `scene/scene` | — |
| `SaveLastScene()` | `scene/scene` | — |
| `SaveThumbnail()` | `scene/scene` | — |
| `SetEnvState()` | `scene/scene` | — |
| `__envDebug()` | `scene/scene` | — |
| `_applyAll()` | `scene/scene` | — |
| `_catOf()` | `scene/scene` | — |
| `_catState()` | `scene/scene` | — |
| `_matEnabled()` | `scene/scene` | — |
| `_matState()` | `scene/scene` | — |
| `animateCameraVmd()` | `scene/scene` | — |
| `applyEnvState()` | `scene/scene` | — |
| `applyFrameControl()` | `scene/scene` | 统一应用帧率控制：帧率限制器开关 + 帧率上限。 |
| `applyMatSssState()` | `scene/scene` | — |
| `applyMatState()` | `scene/scene` | — |
| `applySss()` | `scene/scene` | — |
| `applyUnlitFallback()` | `scene/scene` | — |
| `attachBeatDetector()` | `scene/scene` | — |
| `autoFrame()` | `scene/scene` | — |
| `autoLoop()` | `scene/scene` | — |
| `canUndo()` | `scene/scene` | — |
| `captureThumbnail()` | `scene/scene` | — |
| `clearCameraVmd()` | `scene/scene` | — |
| `disposeAudio()` | `scene/scene` | — |
| `disposeModelSssState()` | `scene/scene` | — |
| `disposeScene()` | `scene/scene` | 级联释放 Scene → Engine 及其所有子资源。 |
| `dom()` | `scene/scene` | — |
| `engine()` | `scene/scene` | — |
| `envState()` | `scene/scene` | — |
| `focusedMmdModel()` | `scene/scene` | — |
| `focusedModel()` | `scene/scene` | — |
| `focusedModelId()` | `scene/scene` | — |
| `formatTime()` | `scene/scene` | — |
| `getCameraMode()` | `scene/scene` | — |
| `getCameraState()` | `scene/scene` | — |
| `getCameraVmdName()` | `scene/scene` | — |
| `getCameraVmdPath()` | `scene/scene` | — |
| `getMatCatGroups()` | `scene/scene` | — |
| `getMatCatParams()` | `scene/scene` | — |
| `getMatDetailList()` | `scene/scene` | — |
| `getMatParams()` | `scene/scene` | — |
| `getMatSssParams()` | `scene/scene` | — |
| `getMatSssState()` | `scene/scene` | — |
| `getMatState()` | `scene/scene` | — |
| `getScene()` | `scene/scene` | — |
| `hasCameraVmd()` | `scene/scene` | — |
| `initCameraSystem()` | `scene/scene` | — |
| `initLoader()` | `scene/scene` | — |
| `initPlaybackObservables()` | `scene/scene` | — |
| `initScene()` | `scene/scene` | 场景初始化入口。首次调用时创建 Scene/Engine/运行时； HMR 重入时先调用 _reinitSceneForHMR() 清理旧资源再重建。 |
| `isARModeActive()` | `scene/scene` | — |
| `isAudioPlaying()` | `scene/scene` | — |
| `isHeadless()` | `scene/scene` | — |
| `isMatCategoryAllEnabled()` | `scene/scene` | — |
| `isMatEnabled()` | `scene/scene` | — |
| `isPbrMaterial()` | `scene/scene` | — |
| `isPlaying()` | `scene/scene` | — |
| `loadAudioFile()` | `scene/scene` | — |
| `loadCameraVmd()` | `scene/scene` | — |
| `loadCameraVmdFromPath()` | `scene/scene` | — |
| `loadPMXFile()` | `scene/scene` | — |
| `loadVMDFromPath()` | `scene/scene` | — |
| `loadVMDMotion()` | `scene/scene` | — |
| `loadVPDPose()` | `scene/scene` | — |
| `mmdRuntime()` | `scene/scene` | — |
| `modelManager()` | `scene/scene` | — |
| `modelRegistry()` | `scene/scene` | — |
| `normPath()` | `scene/scene` | — |
| `offerSceneUndo()` | `scene/scene` | — |
| `offerSceneUndoAndRefresh()` | `scene/scene` | — |
| `popUndoSnapshot()` | `scene/scene` | — |
| `pushUndoSnapshot()` | `scene/scene` | — |
| `resetMatCatParams()` | `scene/scene` | — |
| `resetPerMaterialParams()` | `scene/scene` | — |
| `resetSingleMatParams()` | `scene/scene` | — |
| `resolveFileUrl()` | `scene/scene` | — |
| `restoreUndoSnapshot()` | `scene/scene` | — |
| `scene()` | `scene/scene` | — |
| `seekDragging()` | `scene/scene` | — |
| `seekFromEvent()` | `scene/scene` | — |
| `setARMode()` | `scene/scene` | — |
| `setAutoLoop()` | `scene/scene` | — |
| `setCameraState()` | `scene/scene` | — |
| `setFocusedModelId()` | `scene/scene` | — |
| `setIsPlaying()` | `scene/scene` | — |
| `setMatCatParams()` | `scene/scene` | — |
| `setMatCategoryEnabled()` | `scene/scene` | — |
| `setMatEnabled()` | `scene/scene` | — |
| `setMatParams()` | `scene/scene` | — |
| `setMatSssParams()` | `scene/scene` | — |
| `setMmdRuntime()` | `scene/scene` | — |
| `setModelRegistry()` | `scene/scene` | — |
| `setSeekDragging()` | `scene/scene` | — |
| `setStatus()` | `scene/scene` | — |
| `setTriggerAutoSave()` | `scene/scene` | — |
| `switchCameraMode()` | `scene/scene` | — |
| `syncAudioPlayback()` | `scene/scene` | — |
| `takeARScreenshot()` | `scene/scene` | — |
| `triggerAutoSave()` | `scene/scene` | — |
| `updatePlaybackUI()` | `scene/scene` | — |
| `_resetTextureLRUForTest()` | `scene/shared/texture-lru` | 仅供测试：重置缓存状态。 |
| `clearTextureLRU()` | `scene/shared/texture-lru` | 清空 LRU 缓存。在 disposeRenderer 中调用，释放所有缓存的纹理 ArrayBuffer。 |
| `readTextureWithLRU()` | `scene/shared/texture-lru` | 带 LRU 缓存的纹理读取。命中直接返回 ArrayBuffer，未命中则 readFileBytes 后缓存。 |
| `textureLRUSize()` | `scene/shared/texture-lru` | 返回当前缓存条目数（供测试使用）。 |
| `TransformAdapter()` | `scene/transform/transform-adapter` | — |
| `TransformCapability()` | `scene/transform/transform-adapter` | — |
| `attachGizmoForKind()` | `scene/transform/transform-adapter` | 统一 Gizmo 入口：替代三个 attachXxxGizmo。 |
| `detachGizmo()` | `scene/transform/transform-adapter` | — |
| `getActiveGizmoTypes()` | `scene/transform/transform-adapter` | — |
| `getGizmoNode()` | `scene/transform/transform-adapter` | — |
| `getGizmoSnapConfig()` | `scene/transform/transform-adapter` | — |
| `getGizmoTargetId()` | `scene/transform/transform-adapter` | — |
| `getTransformAdapter()` | `scene/transform/transform-adapter` | — |
| `isGizmoActive()` | `scene/transform/transform-adapter` | — |
| `isGizmoDragging()` | `scene/transform/transform-adapter` | — |
| `onGizmoDragObservable()` | `scene/transform/transform-adapter` | — |
| `registerTransformAdapter()` | `scene/transform/transform-adapter` | 注册变换适配器；同一适配器可声明多个 kind（如 actor + stage） |
| `setGizmoSnapDistance()` | `scene/transform/transform-adapter` | — |
| `isDragModeEnabled()` | `scene/transform/transform-mode` | — |
| `setDragModeEnabled()` | `scene/transform/transform-mode` | — |
| `TransformPickResult()` | `scene/transform/transform-pick` | — |
| `getTransformMetadata()` | `scene/transform/transform-pick` | — |
| `pickTransformTarget()` | `scene/transform/transform-pick` | — |
| `setTransformMetadata()` | `scene/transform/transform-pick` | — |
| `tryAttachGizmoFromPick()` | `scene/transform/transform-pick` | — |
| `TransformTarget()` | `scene/transform/transform-selection` | — |
| `clearSelectedTransformTarget()` | `scene/transform/transform-selection` | 清除选中并卸载 Gizmo（面板关闭/切换时调用）。 |
| `getSelectedTransformTarget()` | `scene/transform/transform-selection` | — |
| `retryPendingAttachment()` | `scene/transform/transform-selection` | 节点就绪后重试：面板渲染时若适配器节点尚未就绪（attachGizmoForKind 返回 false）， 已记录的选中物在节点就绪后调用本函数补挂一次（交叉审核 P3 节点就绪时 |
| `setSelectedTransformTarget()` | `scene/transform/transform-selection` | 声明当前选中物（面板详情渲染时调用）。若拖拽开关开则立即挂 Gizmo。 |
| `syncDragMode()` | `scene/transform/transform-selection` | 拖拽开关状态变化后同步：开→挂当前选中物；关→卸载。 |

## 菜单 & UI

| 符号 | 文件 | 说明 |
|------|------|------|
| `showAssistant()` | `menus/assistant-panel` | — |
| `addAssistantMessage()` | `menus/diagnostic-chat` | 添加助手消息 |
| `buildChatSchema()` | `menus/diagnostic-chat` | 构建 chat schema（纯 DOM 构建） |
| `buildSystemMessage()` | `menus/diagnostic-chat` | 构造 system message |
| `finalizeStream()` | `menus/diagnostic-chat` | 流式完成收尾（非 dialogue 模式） |
| `finalizeStreamRow()` | `menus/diagnostic-chat` | 定格 streaming row（移除 streaming class + Markdown 渲染） |
| `pruneHistory()` | `menus/diagnostic-chat` | 历史截断 |
| `renderChat()` | `menus/diagnostic-chat` | 全量重绘对话区 |
| `renderDialogueCards()` | `menus/diagnostic-chat` | 渲染情绪卡片（台词模式） |
| `renderStreamingChunk()` | `menus/diagnostic-chat` | 流式追加 chunk 到当前 streaming row |
| `showPendingBubble()` | `menus/diagnostic-chat` | 显示"思考中"占位气泡 |
| `updateSendButton()` | `menus/diagnostic-chat` | 更新发送/停止按钮 |
| `updateSpeakToggle()` | `menus/diagnostic-chat` | 更新朗读开关 UI（不支持时隐藏） |
| `applyProvider()` | `menus/diagnostic-config` | — |
| `buildConfigSchema()` | `menus/diagnostic-config` | — |
| `goKeyAllowsProceed()` | `menus/diagnostic-config` | — |
| `loadInitialConfig()` | `menus/diagnostic-config` | — |
| `persistConfig()` | `menus/diagnostic-config` | — |
| `refreshCaps()` | `menus/diagnostic-config` | — |
| `refreshModelList()` | `menus/diagnostic-config` | — |
| `updateStatusBadge()` | `menus/diagnostic-config` | — |
| `advancePendingQueue()` | `menus/diagnostic-control` | 推进队列 |
| `applyPendingAction()` | `menus/diagnostic-control` | 应用 pending action |
| `cancelPendingAction()` | `menus/diagnostic-control` | 取消 pending action |
| `finalizePendingBatch()` | `menus/diagnostic-control` | 本批处理完成：回填 tool 消息，触发后续 stream |
| `handleControlFallback()` | `menus/diagnostic-control` | 处理 LLM 文本回退（无 tool_call 时） |
| `renderControlHint()` | `menus/diagnostic-control` | 渲染 pending 区域（仅有可撤销操作时显示） |
| `renderPendingAction()` | `menus/diagnostic-control` | 渲染待确认操作卡 |
| `tryQueuePendingAction()` | `menus/diagnostic-control` | 将 LLM 文本回退解析的 action 入待确认队列 |
| `undoLastAction()` | `menus/diagnostic-control` | 撤销上一个破坏性动作 |
| `buildSessionsSchema()` | `menus/diagnostic-session` | — |
| `createSession()` | `menus/diagnostic-session` | 由 entry point 调用——通过 callbacks 通知 UI 更新 |
| `deleteSessionAndAdjust()` | `menus/diagnostic-session` | — |
| `doPersistSession()` | `menus/diagnostic-session` | — |
| `flushSession()` | `menus/diagnostic-session` | — |
| `fmtTime()` | `menus/diagnostic-session` | — |
| `loadActiveSession()` | `menus/diagnostic-session` | — |
| `renderSessionList()` | `menus/diagnostic-session` | — |
| `schedulePersistSession()` | `menus/diagnostic-session` | — |
| `switchSession()` | `menus/diagnostic-session` | — |
| `DiagnosticState()` | `menus/diagnostic-state` | — |
| `PendingAction()` | `menus/diagnostic-state` | — |
| `PendingToolResult()` | `menus/diagnostic-state` | — |
| `diagState()` | `menus/diagnostic-state` | — |
| `buildCloudLevel()` | `menus/env-cloud-levels` | — |
| `getCloudSchema()` | `menus/env-cloud-levels` | 导出 cloud schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildExperimentalLevel()` | `menus/env-experimental-levels` | — |
| `getExperimentalSchema()` | `menus/env-experimental-levels` | 导出 experimental schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildFogLevel()` | `menus/env-fog-levels` | — |
| `getFogSchema()` | `menus/env-fog-levels` | 导出 fog schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildGroundLevel()` | `menus/env-ground-levels` | — |
| `getGroundSchema()` | `menus/env-ground-levels` | 导出 ground schema 供 menu-registry 静态分析（ADR-093 元测试） 合并 6 个子 schema 数组，返回完整 ground 面板的 schem |
| `buildLevel()` | `menus/env-level-helpers` | 通用的环境功能层级构建器：包裹 cardContainer + renderMenu 模板 |
| `openTexturePicker()` | `menus/env-level-helpers` | 打开环境贴图选择器 |
| `EnvTextureBindingTarget()` | `menus/env-menu-state` | — |
| `clearEnvTextureBindingTarget()` | `menus/env-menu-state` | — |
| `getEnvMenu()` | `menus/env-menu-state` | — |
| `getEnvTextureBindingTarget()` | `menus/env-menu-state` | — |
| `setEnvMenu()` | `menus/env-menu-state` | — |
| `setEnvTextureBindingTarget()` | `menus/env-menu-state` | — |
| `buildEnvLevel()` | `menus/env-menu` | — |
| `buildParticleLevel()` | `menus/env-menu` | — |
| `buildParticleSchema()` | `menus/env-menu` | — |
| `clearEnvTextureBindingTarget()` | `menus/env-menu` | — |
| `disposeEnvMenu()` | `menus/env-menu` | 释放 env-menu 模块资源（取消注册 hooks + HMR/清理时调用） |
| `getEnvMenu()` | `menus/env-menu` | — |
| `getEnvTextureBindingTarget()` | `menus/env-menu` | — |
| `refreshEnvRoot()` | `menus/env-menu` | — |
| `showEnvMenu()` | `menus/env-menu` | — |
| `SCENE_PRESETS()` | `menus/env-preset-levels` | — |
| `buildPresetLevel()` | `menus/env-preset-levels` | — |
| `buildShadowLevel()` | `menus/env-shadow-levels` | — |
| `getShadowSchema()` | `menus/env-shadow-levels` | 导出 shadow schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildSkyLevel()` | `menus/env-sky-levels` | — |
| `getSkySchema()` | `menus/env-sky-levels` | 导出 sky schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildWaterLevel()` | `menus/env-water-levels` | — |
| `getWaterSchema()` | `menus/env-water-levels` | 导出 water schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildWindLevel()` | `menus/env-wind-levels` | — |
| `getWindSchema()` | `menus/env-wind-levels` | 导出 wind schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildTagDetailLevel()` | `menus/library-actions` | — |
| `buildTagsOverviewLevel()` | `menus/library-actions` | — |
| `findLibraryModelByName()` | `menus/library-actions` | 按名称模糊搜索模型（纯查询，不触发加载）。供 ADR-155/197 NL 控制 resolve 使用，避免 resolve 阶段误触发真实加载。 |
| `findLibraryMotionByName()` | `menus/library-actions` | 按名称模糊搜索 VMD 动作（纯查询，不触发替换）。 |
| `highlightRow()` | `menus/library-actions` | — |
| `importFile()` | `menus/library-actions` | — |
| `importFileByPath()` | `menus/library-actions` | — |
| `onModelRowClick()` | `menus/library-actions` | — |
| `prepareModelRestore()` | `menus/library-actions` | — |
| `replaceModel()` | `menus/library-actions` | — |
| `replaceMotion()` | `menus/library-actions` | — |
| `makeModelMenu()` | `menus/library-browse` | — |
| `showModelPopup()` | `menus/library-browse` | — |
| `ResourceViewMode()` | `menus/library-core` | — |
| `abortThumbnailStreaming()` | `menus/library-core` | [adr-136] 取消当前正在进行的缩略图流式加载批次（如弹窗关闭/重开时调用）。 |
| `buildLevel()` | `menus/library-core` | — |
| `buildModelFormationLevel()` | `menus/library-core` | — |
| `buildModelRootItems()` | `menus/library-core` | — |
| `buildResourceItemsForDir()` | `menus/library-core` | — |
| `computeRestoreSegments()` | `menus/library-core` | — |
| `getPendingMetaGuard()` | `menus/library-core` | — |
| `getRelativePathUnderDir()` | `menus/library-core` | — |
| `getResourceViewMode()` | `menus/library-core` | — |
| `importFile()` | `menus/library-core` | — |
| `initLibrary()` | `menus/library-core` | — |
| `isLeafFlattenDir()` | `menus/library-core` | — |
| `isModelDirTarget()` | `menus/library-core` | — |
| `loadThumbnailsStreaming()` | `menus/library-core` | 流式加载缩略图：并发控制，每加载一张立即更新缓存并通知面板刷新， 替代一次性 GetThumbnailBatch 的"全等"模式，实现缩略图逐张出现。 |
| `modelToResourceItem()` | `menus/library-core` | — |
| `modelToRow()` | `menus/library-core` | — |
| `prepareModelRestore()` | `menus/library-core` | — |
| `refreshLibrary()` | `menus/library-core` | — |
| `refreshModelRoot()` | `menus/library-core` | — |
| `reloadConfig()` | `menus/library-core` | — |
| `rescanAndSync()` | `menus/library-core` | — |
| `resolveDisplayBrowseDir()` | `menus/library-core` | [修复] 解析模型在资源库中的"显示目录"——即用户点击该模型时实际看到的层级。 |
| `selectOverridePath()` | `menus/library-core` | — |
| `selectResourceRoot()` | `menus/library-core` | — |
| `setResourceViewMode()` | `menus/library-core` | — |
| `showModelPopup()` | `menus/library-core` | — |
| `splitSubdirSegments()` | `menus/library-core` | — |
| `switchStorageMode()` | `menus/library-core` | — |
| `thumbnailKeyForModel()` | `menus/library-core` | — |
| `LibraryLoadingState()` | `menus/library-session-store` | 资源库会话状态：加载守卫。 |
| `LibraryRestoreState()` | `menus/library-session-store` | 资源库会话状态：恢复链路（上次浏览位置 + 高亮模型）。 |
| `LibraryRestoreStatus()` | `menus/library-session-store` | [doc:adr-135] P0.3 deferRestore 状态机。 |
| `librarySessionStore()` | `menus/library-session-store` | 单例。 |
| `initLibrary()` | `menus/library-setup` | — |
| `refreshLibrary()` | `menus/library-setup` | — |
| `reloadConfig()` | `menus/library-setup` | — |
| `rescanAndSync()` | `menus/library-setup` | — |
| `selectOverridePath()` | `menus/library-setup` | — |
| `selectResourceRoot()` | `menus/library-setup` | — |
| `switchStorageMode()` | `menus/library-setup` | — |
| `applyModelPreset()` | `menus/library` | — |
| `initLibrary()` | `menus/library` | — |
| `refreshLibrary()` | `menus/library` | — |
| `serializeModelPreset()` | `menus/library` | — |
| `showModelPopup()` | `menus/library` | — |
| `showMotionPopup()` | `menus/library` | — |
| `PopupMenuConfig()` | `menus/menu-factory` | 轻量级弹窗入口：适用于不需要注册 handle 的一次性场景。 |
| `PopupMenuHandle()` | `menus/menu-factory` | 注册后的菜单句柄——提供 get/refresh 能力 |
| `PopupMenuHandlers()` | `menus/menu-factory` | 不含 container/onClose 的菜单回调（由工厂统一注入） |
| `RegisteredPopupMenuConfig()` | `menus/menu-factory` | 注册式菜单配置——工厂内部维护引用，返回 handle |
| `registerPopupMenu()` | `menus/menu-factory` | 注册弹窗菜单——工厂内部维护引用，返回统一的 handle。 |
| `showPopupMenu()` | `menus/menu-factory` | — |
| `addOnCloseAllOverlays()` | `menus/menu-overlay` | 追加注册关闭回调（不覆盖主回调，供面板化拖拽卸载等场景用） |
| `clearAllMenuWrappers()` | `menus/menu-overlay` | — |
| `closeAllOverlays()` | `menus/menu-overlay` | Close all visible overlays, reset popup state, and invoke the registered callbacks. |
| `disposeMenuWrapper()` | `menus/menu-overlay` | — |
| `getMenuWrapper()` | `menus/menu-overlay` | — |
| `setOnCloseAllOverlays()` | `menus/menu-overlay` | — |
| `PanelNav()` | `menus/menu-registry` | 面板导航元数据（ADR-229 §2.1）。 |
| `RegisteredSchema()` | `menus/menu-registry` | — |
| `SchemaCollectFailure()` | `menus/menu-registry` | builder 执行失败记录（ADR-229 审核修正：失败不得静默） |
| `SchemaCollectResult()` | `menus/menu-registry` | — |
| `_clearRegistry()` | `menus/menu-registry` | 清空注册表（仅测试用） |
| `collectAllSchemas()` | `menus/menu-registry` | 收集所有已注册 schema，执行 builder 返回快照（失败面板跳过，失败列表见 collectAllSchemasWithFailures） |
| `collectAllSchemasWithFailures()` | `menus/menu-registry` | 收集所有已注册 schema，同时返回 builder 失败列表。 |
| `flattenNodes()` | `menus/menu-registry` | 递归展开 schema 树（含 children），返回扁平节点列表。 |
| `registerSchema()` | `menus/menu-registry` | 注册一个面板的 schema 构建函数（nav 可选，特例面板覆写导航元数据） |
| `ActionMenuCtx()` | `menus/menu-schema` | — |
| `ControlSpec()` | `menus/menu-schema` | — |
| `MenuKind()` | `menus/menu-schema` | — |
| `MenuNode()` | `menus/menu-schema` | — |
| `StatePath()` | `menus/menu-schema` | — |
| `getBindFn()` | `menus/menu-schema` | 按 StatePath 获取 bind 函数（用于 registerControl 自更新） |
| `getStateValue()` | `menus/menu-schema` | 按 StatePath 获取当前值 |
| `setStateValue()` | `menus/menu-schema` | 按 StatePath 设置值 |
| `stackRegistry()` | `menus/menu-stack-registry` | — |
| `SlideMenu()` | `menus/menu` | — |
| `getCurrentRenderingMenu()` | `menus/menu` | 获取当前正在渲染的 SlideMenu 实例（供 menus 层控件的自更新注册）。 |
| `getOpenMenus()` | `menus/menu` | 获取所有当前存活的 SlideMenu 实例（已 dispose 的会自动移除，调用方仍需自行判断可见性） |
| `buildBoneHierarchyLevel()` | `menus/model-detail` | — |
| `buildModelInfoLevel()` | `menus/model-detail` | — |
| `buildModelLevel()` | `menus/model-detail` | — |
| `buildModelTagsLevel()` | `menus/model-detail` | — |
| `buildModelToolsLevel()` | `menus/model-detail` | [doc:adr-167] 叠加动作次级菜单已移除（ADR-144 per-model overlay 废弃）。 |
| `buildMorphPreviewLevel()` | `menus/model-detail` | — |
| `buildMotionSlotLevel()` | `menus/model-detail` | 构建动作1（基础）次级菜单：场景库选择 + 已加载动作 + 程序化动作 |
| `buildOpenWithLevel()` | `menus/model-detail` | — |
| `buildPersonalLightLevel()` | `menus/model-detail` | — |
| `buildMatRootLevel()` | `menus/model-material` | — |
| `ModelPresetEntry()` | `menus/model-preset` | — |
| `ModelPresetFile()` | `menus/model-preset` | — |
| `applyModelPreset()` | `menus/model-preset` | — |
| `applyPresetFromLib()` | `menus/model-preset` | — |
| `buildPresetListLevel()` | `menus/model-preset` | — |
| `savePresetToLibDialog()` | `menus/model-preset` | — |
| `serializeModelPreset()` | `menus/model-preset` | — |
| `tryAutoApplyPreset()` | `menus/model-preset` | — |
| `DEFAULT_MOTION_SLOTS()` | `menus/motion-binding-ui` | — |
| `applyIntentToModel()` | `menus/motion-binding-ui` | — |
| `buildActionBindingLevel()` | `menus/motion-binding-ui` | — |
| `ensureMotionSlots()` | `menus/motion-binding-ui` | [doc:adr-167] 确保 inst.motionSlots 存在并返回（懒初始化；overlay 槽位已移除） |
| `handleModelAction()` | `menus/motion-binding-ui` | 处理 per-model 动作控制指令（pause / reset / pose / loop）。 |
| `initMotionBroadcast()` | `menus/motion-binding-ui` | — |
| `renderModuleToggleList()` | `menus/motion-binding-ui` | 渲染动作模块开关列表到指定容器。 |
| `resetFocusedLayerId()` | `menus/motion-binding-ui` | 重置焦点图层 ID（进入动作绑定面板 / 场景级浏览时调用）。 |
| `buildCameraLevel()` | `menus/motion-camera-levels` | — |
| `buildVirtualSkirtLevel()` | `menus/motion-cloth-levels` | — |
| `disposeAllVirtualSkirts()` | `menus/motion-cloth-levels` | 释放全部虚拟裙骨控制器 |
| `disposeVirtualSkirtForModel()` | `menus/motion-cloth-levels` | 释放指定模型的虚拟裙骨控制器（供模型卸载流程调用） |
| `buildLayerLevel()` | `menus/motion-detail-ui` | 单图层次级菜单：启用开关 / 权重滑块 / 删除。 |
| `buildMotionDetailLevel()` | `menus/motion-detail-ui` | [doc:adr-167] 构建动作详情页 level。 |
| `buildMotionToolsLevel()` | `menus/motion-detail-ui` | [doc:adr-170] 动作工具页 level——对齐 buildModelToolsLevel 的「详情 vs 工具」分层： 行点击进详情（图层/覆盖），行尾 setting |
| `buildPlaybackSpeedLevel()` | `menus/motion-detail-ui` | — |
| `syncPlaybackSpeedToRuntime()` | `menus/motion-detail-ui` | 将记忆中的播放速度同步到新的 mmdRuntime 实例（防状态漂移）。 |
| `buildGazeTrackingLevel()` | `menus/motion-gaze-levels` | — |
| `getGazeSchema()` | `menus/motion-gaze-levels` | 导出 gaze schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `renderPerceptionConflictBanners()` | `menus/motion-gaze-levels` | [doc:adr-166 P2-3] 渲染「焦点 + 全部 pinned」模型的感知层冲突 banner。 |
| `updatePerceptionConflictBanner()` | `menus/motion-gaze-levels` | [doc:adr-163/adr-164/adr-166] 渲染指定模型的感知层骨骼冲突 banner |
| `buildAdvancedBoneOverrideLevel()` | `menus/motion-override-levels` | — |
| `buildModuleParamLevel()` | `menus/motion-override-levels` | 模块参数子页：渲染模块的 buildSchema() |
| `renderOverrideCard()` | `menus/motion-override-levels` | [doc:adr-116/125] 动作覆盖卡片：标题栏（撤销/重做/历史）+ 骨骼冲突 banner + 模块开关列表 + 高级骨骼覆盖入口。提取自已移除的独立覆盖页（原死路由 |
| `renderPresetCard()` | `menus/motion-override-levels` | [doc:adr-145] 动作预设卡片：标题栏（保存按钮）+ 预设列表 / 空状态。 |
| `syncOverrideToInstance()` | `menus/motion-override-levels` | 将 bone-override.ts 的运行时状态同步回 ModelInstance.boneOverrides 用于持久化 |
| `applyIntentToModel()` | `menus/motion-popup` | — |
| `buildMotionRootItems()` | `menus/motion-popup` | — |
| `disposeMotionPopup()` | `menus/motion-popup` | 释放 motion-popup 模块资源（取消注册 hooks + HMR/清理时调用） |
| `getMotionMenu()` | `menus/motion-popup` | — |
| `hideMotionPopup()` | `menus/motion-popup` | — |
| `initMotionBroadcast()` | `menus/motion-popup` | — |
| `refreshMotionRoot()` | `menus/motion-popup` | — |
| `renderModuleToggleList()` | `menus/motion-popup` | — |
| `showMotionPopup()` | `menus/motion-popup` | — |
| `syncPlaybackSpeedToRuntime()` | `menus/motion-popup` | — |
| `buildPoseStudioLevel()` | `menus/motion-pose-levels` | — |
| `buildProcLibraryLevel()` | `menus/motion-procmotion-levels` | — |
| `buildProcMotionSchema()` | `menus/motion-procmotion-levels` | — |
| `procLabel()` | `menus/motion-procmotion-levels` | [doc:adr-207] 程序化动作 ID → 显示名（跨模块复用，避免标签逻辑重复）。 |
| `buildMotionRootItems()` | `menus/motion-root-ui` | — |
| `buildMotionRootLevel()` | `menus/motion-root-ui` | — |
| `buildRetargetLevel()` | `menus/motion-root-ui` | — |
| `hideMotionPopup()` | `menus/motion-root-ui` | — |
| `importExternalAnimation()` | `menus/motion-root-ui` | 外部动作导入：选文件 → 重定向骨骼 → 播放。 |
| `openProcDetail()` | `menus/motion-root-ui` | [doc:adr-207] 行体点击进入程序化统一详情页。 |
| `buildOutfitLevel()` | `menus/outfit-ui` | — |
| `buildSiteTabs()` | `menus/plaza-browser` | — |
| `buildToolbar()` | `menus/plaza-browser` | — |
| `ensureSitesLoaded()` | `menus/plaza-browser` | — |
| `getCustomPresets()` | `menus/plaza-browser` | — |
| `loadPlazaCache()` | `menus/plaza-browser` | 从 Go 用户目录缓存（plaza-cache/creators.json + workshop_sites.json）读取站点 + 创作者。缓存不存在时返回 null。 |
| `mergeSites()` | `menus/plaza-browser` | — |
| `normalizeCreator()` | `menus/plaza-browser` | — |
| `normalizeSite()` | `menus/plaza-browser` | — |
| `openExternal()` | `menus/plaza-browser` | — |
| `openInWindow()` | `menus/plaza-browser` | — |
| `openSiteByMode()` | `menus/plaza-browser` | — |
| `preserveBuiltinRouting()` | `menus/plaza-browser` | — |
| `renderEmbed()` | `menus/plaza-browser` | — |
| `renderHome()` | `menus/plaza-browser` | — |
| `renderSiteContent()` | `menus/plaza-browser` | — |
| `saveCustomPresets()` | `menus/plaza-browser` | — |
| `savePlazaCache()` | `menus/plaza-browser` | 将当前站点 + 创作者持久化到 Go 用户目录缓存（plaza-cache/）。 |
| `showActionsMenu()` | `menus/plaza-browser` | — |
| `showPlaza()` | `menus/plaza-browser` | — |
| `PLAZA_CREATORS()` | `menus/plaza-creators` | — |
| `PlazaCreator()` | `menus/plaza-creators` | — |
| `ensureObserver()` | `menus/plaza-download` | — |
| `handlePlazaDownload()` | `menus/plaza-download` | — |
| `installDownloadListener()` | `menus/plaza-download` | — |
| `installEventListeners()` | `menus/plaza-download` | — |
| `installShortcuts()` | `menus/plaza-download` | — |
| `PLAZA_SITES()` | `menus/plaza-sites` | — |
| `PlazaSite()` | `menus/plaza-sites` | — |
| `GLOBAL_MODE_KEY()` | `menus/plaza-state` | — |
| `OpenMode()` | `menus/plaza-state` | — |
| `SITE_GROUPS()` | `menus/plaza-state` | — |
| `allCreators()` | `menus/plaza-state` | — |
| `allSites()` | `menus/plaza-state` | — |
| `closePlaza()` | `menus/plaza-state` | — |
| `currentSiteId()` | `menus/plaza-state` | — |
| `downloadListenerInstalled()` | `menus/plaza-state` | — |
| `effectiveMode()` | `menus/plaza-state` | — |
| `eventListenersInstalled()` | `menus/plaza-state` | — |
| `getCurrentSite()` | `menus/plaza-state` | — |
| `getLayer()` | `menus/plaza-state` | — |
| `layer()` | `menus/plaza-state` | — |
| `loadGlobalMode()` | `menus/plaza-state` | — |
| `observer()` | `menus/plaza-state` | — |
| `plazaIframe()` | `menus/plaza-state` | — |
| `plazaProxyActive()` | `menus/plaza-state` | — |
| `saveGlobalMode()` | `menus/plaza-state` | — |
| `setAllCreators()` | `menus/plaza-state` | — |
| `setAllSites()` | `menus/plaza-state` | — |
| `setCurrentSiteId()` | `menus/plaza-state` | — |
| `setDownloadListenerInstalled()` | `menus/plaza-state` | — |
| `setEventListenersInstalled()` | `menus/plaza-state` | — |
| `setObserver()` | `menus/plaza-state` | — |
| `setPlazaIframe()` | `menus/plaza-state` | — |
| `setPlazaProxyActive()` | `menus/plaza-state` | — |
| `setShortcutsRegistered()` | `menus/plaza-state` | — |
| `shortcutsRegistered()` | `menus/plaza-state` | — |
| `stopProxy()` | `menus/plaza-state` | — |
| `_plazaBtn()` | `menus/plaza-thumbnail` | — |
| `_plazaSectionHeader()` | `menus/plaza-thumbnail` | — |
| `PresetListViewerConfig()` | `menus/preset-list-viewer` | — |
| `buildPresetListLevel()` | `menus/preset-list-viewer` | 构建完整 PopupLevel（适用于纯预设列表场景，如模型预设） |
| `presetListContent()` | `menus/preset-list-viewer` | 渲染预设列表内容到现有 container 中。用于混合内容的 PopupLevel（场景预设） |
| `buildSchemaLevel()` | `menus/render-menu` | [doc:P6] 构建一个含增量 i18n 刷新的 schema 层级。 |
| `renderMenu()` | `menus/render-menu` | 渲染一个 MenuNode 树到 container 中。返回 dispose 函数，调用时级联释放所有 renderCustom 资源 |
| `ResourceHandle()` | `menus/resource-detail-helpers` | — |
| `buildAttachmentCard()` | `menus/resource-detail-helpers` | [doc:adr-215] 模型附属关系卡片。 |
| `buildDangerCard()` | `menus/resource-detail-helpers` | 危险区块：卸载资源（带确认对话框） onRemoved 可选回调，用于卸载后弹窗导航（如 pop 到上一级） |
| `buildMaterialCard()` | `menus/resource-detail-helpers` | 材质区块：进入材质调节子层级 |
| `buildSnapSettings()` | `menus/resource-detail-helpers` | — |
| `buildTransformCard()` | `menus/resource-detail-helpers` | 拖拽操控卡片：Gizmo 拖拽 + 缩放倍率 + 透明度 [doc:adr-049] 位置/旋转由 3D Gizmo 实时拖拽取代，不再显示滑块。 |
| `reconcileTransformSelection()` | `menus/resource-detail-helpers` | 面板关闭/切换即卸载（ADR-171 面板化）：菜单 onAfterRender 时调用。 |
| `buildDragModeLevel()` | `menus/scene-drag-levels` | — |
| `getSceneMenu()` | `menus/scene-menu-state` | — |
| `reRenderSceneMenu()` | `menus/scene-menu-state` | — |
| `refreshSceneRoot()` | `menus/scene-menu-state` | — |
| `setRefreshSceneRoot()` | `menus/scene-menu-state` | — |
| `setSceneMenu()` | `menus/scene-menu-state` | — |
| `buildStageTransformLevel()` | `menus/scene-menu` | — |
| `disposeSceneMenu()` | `menus/scene-menu` | 释放 scene-menu 模块资源（取消注册 hooks + HMR/清理时调用） |
| `getSceneMenu()` | `menus/scene-menu` | — |
| `refreshSceneRoot()` | `menus/scene-menu` | — |
| `saveScene()` | `menus/scene-menu` | 保存场景（自动编号到预设目录） |
| `screenshotBatch()` | `menus/scene-menu` | 批量截图所有已加载模型 |
| `screenshotCurrent()` | `menus/scene-menu` | 截图当前焦点模型 |
| `showSceneMenu()` | `menus/scene-menu` | — |
| `buildPhysicsDebugLevel()` | `menus/scene-physics-levels` | 构建物理调试子页（材质线框/骨骼 — WASM 相关，由模型详情页调用） |
| `buildPhysicsLevel()` | `menus/scene-physics-levels` | 构建 WASM 物理子页（Bullet 骨髁物理 — per-model） |
| `buildWasmPhysicsLevel()` | `menus/scene-physics-levels` | 构建 WASM 物理子页（Bullet 骨髁物理信息 + 全局开关） |
| `buildPostProcessColorSchema()` | `menus/scene-render-levels` | 后处理 schema — 色彩层（色调映射） |
| `buildPostProcessCoreSchema()` | `menus/scene-render-levels` | 后处理 schema — 核心层（高频效果）+ 高级层（光学/环境效果） |
| `buildPostProcessLevel()` | `menus/scene-render-levels` | — |
| `buildPresetScenesLevel()` | `menus/scene-render-levels` | — |
| `FILTER_PRESET_LABELS()` | `menus/scene-render-presets` | — |
| `USER_FILTER_PRESETS()` | `menus/scene-render-presets` | — |
| `buildPresetsLevel()` | `menus/scene-render-presets` | — |
| `getFilterPreset()` | `menus/scene-render-presets` | — |
| `showPresetSaveDialog()` | `menus/scene-render-presets` | — |
| `buildStageLevel()` | `menus/scene-stage-levels` | — |
| `buildStageTransformLevel()` | `menus/scene-stage-levels` | — |
| `buildStageLightLevel()` | `menus/scene-stage-lights` | — |
| `buildSettingsAboutLevel()` | `menus/settings-about` | — |
| `handleSettingsAction()` | `menus/settings-actions` | 全局设置项点击分发：语言切换 + 动作表。settings.ts 的 onItemClick 使用。 |
| `buildSettingsAppearanceLevel()` | `menus/settings-appearance` | — |
| `buildCameraSchema()` | `menus/settings-controls` | — |
| `buildSettingsControlsLevel()` | `menus/settings-controls` | — |
| `buildDiagnosticSchema()` | `menus/settings-diagnostic` | — |
| `buildSettingsDiagnosticLevel()` | `menus/settings-diagnostic` | — |
| `renderDiagnosticPanel()` | `menus/settings-diagnostic` | — |
| `buildSettingsDownloadsLevel()` | `menus/settings-downloads` | — |
| `buildEffectsSchema()` | `menus/settings-graphics` | — |
| `buildFrameQualitySchema()` | `menus/settings-graphics` | — |
| `buildPhysicsHudSchema()` | `menus/settings-graphics` | — |
| `buildSettingsGraphicsLevel()` | `menus/settings-graphics` | — |
| `buildSettingsLanguageLevel()` | `menus/settings-language` | — |
| `buildSettingsMediaLevel()` | `menus/settings-media` | — |
| `buildSettingsResourcesLevel()` | `menus/settings-resources` | — |
| `FONT_MAP()` | `menus/settings-shared` | — |
| `SETTINGS_FONT_RESTORE()` | `menus/settings-shared` | — |
| `SettingsMenuHandle()` | `menus/settings-shared` | — |
| `THEME_PRESETS()` | `menus/settings-shared` | — |
| `applyUIAppearanceDom()` | `menus/settings-shared` | — |
| `formatBytes()` | `menus/settings-shared` | — |
| `generateTextColors()` | `menus/settings-shared` | — |
| `getAutoImportCached()` | `menus/settings-shared` | — |
| `getDownloadWatchEnabledCached()` | `menus/settings-shared` | — |
| `preloadAutoImportState()` | `menus/settings-shared` | 启动时预加载自动导入开关状态。在 main.ts init 中调用。 |
| `preloadDownloadWatchState()` | `menus/settings-shared` | 启动时预加载下载监听开关状态。在 main.ts init 中调用。 |
| `setAutoImportCached()` | `menus/settings-shared` | — |
| `setAutoLoadCompanionAudio()` | `menus/settings-shared` | — |
| `setDownloadWatchEnabledCached()` | `menus/settings-shared` | — |
| `setTheme()` | `menus/settings-shared` | — |
| `truncatePath()` | `menus/settings-shared` | 路径截断显示：超长时保留尾部（用户更关心文件名/末级目录） |
| `addCustomSoftware()` | `menus/settings-system` | — |
| `buildSettingsSystemLevel()` | `menus/settings-system` | — |
| `buildSoftwareDetailLevel()` | `menus/settings-system` | — |
| `scanSoftwareDir()` | `menus/settings-system` | — |
| `setBlenderPath()` | `menus/settings-system` | — |
| `setMMDPath()` | `menus/settings-system` | — |
| `SETTINGS()` | `menus/settings-targets` | 设置菜单文件夹导航 target（ADR-157：7 分类信息架构） |
| `SETTINGS_ACTION()` | `menus/settings-targets` | 设置菜单动作 target（点击后执行操作，不导航） |
| `SOFTWARE_DETAIL_PREFIX()` | `menus/settings-targets` | 动态 target 前缀 —— 用于 `settings:software-detail:&lt;path&gt;` 模式 |
| `SettingsActionTarget()` | `menus/settings-targets` | 所有动作 target 的联合类型 |
| `SettingsFolderTarget()` | `menus/settings-targets` | 所有文件夹 target 的联合类型 |
| `generateTextColors()` | `menus/settings` | — |
| `getSettingsMenu()` | `menus/settings` | — |
| `preloadAutoImportState()` | `menus/settings` | — |
| `preloadDownloadWatchState()` | `menus/settings` | — |
| `refreshSettingsRoot()` | `menus/settings` | — |
| `showSettings()` | `menus/settings` | — |

## 换装 & 音频

| 符号 | 文件 | 说明 |
|------|------|------|
| `applyGain()` | `outfit/audio` | — |
| `attachBeatDetector()` | `outfit/audio` | — |
| `clearAudio()` | `outfit/audio` | — |
| `disposeAudio()` | `outfit/audio` | — |
| `getAudioName()` | `outfit/audio` | — |
| `getAudioOffset()` | `outfit/audio` | — |
| `getAudioPath()` | `outfit/audio` | — |
| `getCurrentTime()` | `outfit/audio` | — |
| `getDuration()` | `outfit/audio` | — |
| `getRepeatModeStr()` | `outfit/audio` | 获取当前重复模式。 |
| `getStreamPlayer()` | `outfit/audio` | 暴露内部 StreamAudioPlayer 供 scene.ts 调用 MmdRuntime.setAudioPlayer()。 |
| `getVolume()` | `outfit/audio` | — |
| `isAudioPlaying()` | `outfit/audio` | — |
| `loadAudioFile()` | `outfit/audio` | — |
| `nextTrack()` | `outfit/audio` | 切换到下一曲。 |
| `notifyBeatDetectorReset()` | `outfit/audio` | — |
| `pauseAudio()` | `outfit/audio` | — |
| `playAudio()` | `outfit/audio` | — |
| `resumeAudio()` | `outfit/audio` | — |
| `seekAudio()` | `outfit/audio` | — |
| `setAudioOffset()` | `outfit/audio` | — |
| `setRepeatMode()` | `outfit/audio` | 设置重复模式（持久化）。 |
| `setVolume()` | `outfit/audio` | — |
| `stopAudio()` | `outfit/audio` | — |
| `syncAudioPlayback()` | `outfit/audio` | — |
| `disposeOverlay()` | `outfit/outfit-overlay` | 释放 overlay mesh 并清理引用。 |
| `hideMaterials()` | `outfit/outfit-overlay` | 隐藏指定材质名的 PMX mesh（保存原始可见性用于恢复）。 |
| `loadOverlay()` | `outfit/outfit-overlay` | 加载 FBX overlay 并尝试绑定到模型 skeleton。 |
| `restoreMaterials()` | `outfit/outfit-overlay` | 恢复被 hideMaterials 隐藏的 PMX mesh 可见性。 |
| `applyOutfitVariant()` | `outfit/outfit` | — |
| `loadOutfits()` | `outfit/outfit` | — |
| `resetOutfit()` | `outfit/outfit` | — |
| `setSceneRef()` | `outfit/outfit` | 由 scene.ts 在场景初始化完成后注入当前 scene 实例 |

## 动作算法

| 符号 | 文件 | 说明 |
|------|------|------|
| `BeatDetector()` | `motion-algos/beat-detector` | — |
| `SolveFootInput()` | `motion-algos/feet-adjustment-math` | — |
| `SolveFootOutput()` | `motion-algos/feet-adjustment-math` | — |
| `solveFootTarget()` | `motion-algos/feet-adjustment-math` | 解算单脚应处的世界 Y 坐标。 |
| `startFallbackDetection()` | `motion-algos/footstep-detect-fallback` | 启动独立落地检测（fallback 模式）。 |
| `stopFallbackDetection()` | `motion-algos/footstep-detect-fallback` | 停止独立落地检测。 |
| `StepDetectInput()` | `motion-algos/footstep-detect` | — |
| `StepDetectOutput()` | `motion-algos/footstep-detect` | — |
| `detectFootLanding()` | `motion-algos/footstep-detect` | 落地判定核心。仅当出现「离地→贴地」上升沿、且去抖间隔满足时返回 landed=true。 |
| `DEFAULT_LIPSYNC_STATE()` | `motion-algos/lipsync` | — |
| `LipSyncMorphSet()` | `motion-algos/lipsync` | — |
| `LipSyncState()` | `motion-algos/lipsync` | — |
| `amplitudeToWeight()` | `motion-algos/lipsync` | 振幅 → morph 权重映射。 |
| `findAllLipMorphs()` | `motion-algos/lipsync` | 查找模型中所有可用的口型相关 morph。 |
| `findLipMorph()` | `motion-algos/lipsync` | 在模型 morph 列表中查找口型 morph，返回首个匹配名。 |
| `PoseType()` | `motion-algos/pose-preset` | — |
| `generatePoseVmd()` | `motion-algos/pose-preset` | 生成 T-pose / A-pose / rest 的 VMD 二进制数据，可经 VmdLoader 解析后应用。 |
| `genArmBones()` | `motion-algos/proc-motion-autodance-bones-limbs` | 生成手臂骨骼帧（左右） 关键修复：改回平滑连续摆动（2 拍周期正弦），而非逐拍脉冲包络（beatBounce）。 |
| `genElbowBones()` | `motion-algos/proc-motion-autodance-bones-limbs` | 生成肘部骨骼帧（新增） 肘部随同侧手臂上抬而屈曲（X 轴），并滞后于肩形成 follow-through。 |
| `genFootIkBones()` | `motion-algos/proc-motion-autodance-bones-limbs` | 生成足部 IK 骨骼帧 随重心摆动：重心偏右时左足抬起（step touch），配合 Center 的 X 重心转移制造换脚感。 |
| `genShoulderBones()` | `motion-algos/proc-motion-autodance-bones-limbs` | 生成肩部骨骼帧 随同侧手臂平滑摆动做耸肩（Y 位移）+ 微旋（Z），形成肩→臂动力链。 |
| `genWristBones()` | `motion-algos/proc-motion-autodance-bones-limbs` | 生成腕部骨骼帧 随同侧手臂平滑摆动（共用连续波），保持末端联动，不再逐拍脉冲。 |
| `genAllParentBone()` | `motion-algos/proc-motion-autodance-bones-trunk` | 生成 AllParent 骨骼帧（步长6，低频微调） 修复：频率锁定到 4 拍整数周期，不再用 t*0.7/t*0.5 漂移（旧实现与节拍错位产生低频蠕变）。 |
| `genCenterBone()` | `motion-algos/proc-motion-autodance-bones-trunk` | 生成中心/下半身骨骼帧（Root / Center） groove 原则：单一相干源（swayAt）驱动重心转移。 |
| `genGrooveBone()` | `motion-algos/proc-motion-autodance-bones-trunk` | 生成 Groove 骨骼帧 骨盆微动，强化重心转移的"踩实"感。 |
| `genUpper2Bone()` | `motion-algos/proc-motion-autodance-bones-trunk` | 生成上半身2骨骼帧 跟随上半身做更小幅度同向联动（单一 swayAt 源，无脉冲）。 |
| `genUpperBone()` | `motion-algos/proc-motion-autodance-bones-trunk` | 生成上半身骨骼帧 随同一重心摆动做俯仰 + 侧倾（单一 swayAt 源，动力链：中心→上半身）。 |
| `genWaistBone()` | `motion-algos/proc-motion-autodance-bones-trunk` | 生成腰部骨骼帧 随重心反向扭转（follow-through），制造躯干螺旋联动而非各自为政。 |
| `BeatInfo()` | `motion-algos/proc-motion-autodance-bones` | 节拍信息：给定帧号，返回它在拍/循环中的相位。 |
| `BoneResolution()` | `motion-algos/proc-motion-autodance-bones` | — |
| `TrigCache()` | `motion-algos/proc-motion-autodance-bones` | — |
| `applyInterp()` | `motion-algos/proc-motion-autodance-bones` | 根据骨骼名应用插值类型 |
| `applyInterpOverride()` | `motion-algos/proc-motion-autodance-bones` | 根据用户覆写设置应用插值类型 |
| `beatBounce()` | `motion-algos/proc-motion-autodance-bones` | 每拍弹跳包络：拍头 0 → 拍中峰值 1 → 拍尾 0。 |
| `beatInfo()` | `motion-algos/proc-motion-autodance-bones` | — |
| `buildTrigCache()` | `motion-algos/proc-motion-autodance-bones` | — |
| `downbeatWeight()` | `motion-algos/proc-motion-autodance-bones` | 强拍权重：0/4 为强拍、2/6 为次强、其余为弱拍。 |
| `genAllParentBone()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genArmBones()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genCenterBone()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genElbowBones()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genFootIkBones()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genGrooveBone()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genShoulderBones()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genUpper2Bone()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genUpperBone()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genWaistBone()` | `motion-algos/proc-motion-autodance-bones` | — |
| `genWristBones()` | `motion-algos/proc-motion-autodance-bones` | — |
| `resolveBones()` | `motion-algos/proc-motion-autodance-bones` | 解析骨骼候选名 → 实际骨骼名 |
| `swayAt()` | `motion-algos/proc-motion-autodance-bones` | 重心左右摆动（2 拍周期，period = 2 * beatFrames）： +1 偏左、-1 偏右。用于重心转移与上下半身联动。 |
| `EMOTION_CANDIDATES()` | `motion-algos/proc-motion-autodance-emotion` | — |
| `EmotionCategory()` | `motion-algos/proc-motion-autodance-emotion` | — |
| `findBestEmotionMorphs()` | `motion-algos/proc-motion-autodance-emotion` | 从 morph 列表中找出最佳情绪映射 |
| `genAccentMorph()` | `motion-algos/proc-motion-autodance-emotion` | 生成情绪强调帧（surprise/wink 随机点缀） |
| `genEmotionCycles()` | `motion-algos/proc-motion-autodance-emotion` | 生成情绪轮播帧（多个情绪依次出现） |
| `genShyMorph()` | `motion-algos/proc-motion-autodance-emotion` | 生成害羞 morph（仅当存在时） |
| `generateEmotionMorphs()` | `motion-algos/proc-motion-autodance-emotion` | 生成全部情绪 morph 帧 |
| `scoreMorph()` | `motion-algos/proc-motion-autodance-emotion` | 计算 morph 名称对一组关键词的匹配得分 - 含关键词 +10 分（大小写不敏感） - 含黑名单模式 -10 分 ⚠️ P3: 使用字符串包含匹配精度较低，建议后续用正则或语义 |
| `generateAutoDanceVmd()` | `motion-algos/proc-motion-autodance` | 生成 AutoDance VMD |
| `generateIdleVmd()` | `motion-algos/proc-motion-idle` | [audit] 待机呼吸生成：params 为 idle 模式专属参数；尊重 boneToggles，关闭的骨类别不生成。 |
| `PROC_AUTODANCE_PRESETS()` | `motion-algos/proc-motion-presets` | autodance（自动舞蹈）预设集 |
| `PROC_IDLE_PRESETS()` | `motion-algos/proc-motion-presets` | idle（待机呼吸）预设集 |
| `ProcParamsPreset()` | `motion-algos/proc-motion-presets` | — |
| `generateProcPresetId()` | `motion-algos/proc-motion-presets` | 生成唯一预设 ID（仿 preset-types.generatePresetId，避免跨模块 import 耦合） |
| `getProcParamsPreset()` | `motion-algos/proc-motion-presets` | 取单个预设（缺失返回 undefined，UI 层需兜底） |
| `getProcPresetSet()` | `motion-algos/proc-motion-presets` | 指定模式的预设集（无则空表） |
| `makeProcPreset()` | `motion-algos/proc-motion-presets` | 由当前参数构造自定义预设快照（深拷贝，防与运行时状态共引用） |
| `removeProcPreset()` | `motion-algos/proc-motion-presets` | 按 id 删除自定义预设（返回新数组） |
| `upsertProcPreset()` | `motion-algos/proc-motion-presets` | 增改自定义预设（同 id 覆盖，否则追加；返回新数组） |
| `BONE_ALLPARENT_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_ARM_IK_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_ARM_IK_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_CENTER_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_ELBOW_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_ELBOW_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_GROOVE_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_HEAD_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_KNEE_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_KNEE_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_LARM_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_LEG_IK_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_LEG_IK_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_NECK_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_RARM_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_SHOULDER_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_SHOULDER_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_THIGH_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_THIGH_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_UPPER2_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_UPPER_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_WAIST_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_WRIST_L_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `BONE_WRIST_R_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `DEFAULT_PROC_STATE()` | `motion-algos/proc-motion-shared` | — |
| `FPS()` | `motion-algos/proc-motion-shared` | — |
| `MAX_FRAMES()` | `motion-algos/proc-motion-shared` | — |
| `MORPH_BLINK_CANDIDATES()` | `motion-algos/proc-motion-shared` | — |
| `PROC_MOTION_BONE_CATEGORIES()` | `motion-algos/proc-motion-shared` | — |
| `PROC_VMD_NAME_AUTODANCE()` | `motion-algos/proc-motion-shared` | — |
| `PROC_VMD_NAME_IDLE()` | `motion-algos/proc-motion-shared` | — |
| `ProcModeKey()` | `motion-algos/proc-motion-shared` | 可编辑参数的程序化模式（'off' 无参数）。每个模式独立一套 ProcMotionParams。 |
| `ProcMotionBoneCategory()` | `motion-algos/proc-motion-shared` | — |
| `ProcMotionMode()` | `motion-algos/proc-motion-shared` | — |
| `ProcMotionParams()` | `motion-algos/proc-motion-shared` | [audit] per-mode 可调参数：待机呼吸 / 自动舞蹈 各自独立一套 |
| `ProcMotionState()` | `motion-algos/proc-motion-shared` | — |
| `clamp1()` | `motion-algos/proc-motion-shared` | — |
| `closingFrame()` | `motion-algos/proc-motion-shared` | 循环末尾的 identity 闭合帧（确保动画无缝循环） |
| `getProcMotionBoneCategories()` | `motion-algos/proc-motion-shared` | — |
| `matchBone()` | `motion-algos/proc-motion-shared` | — |
| `migrateProcState()` | `motion-algos/proc-motion-shared` | — |
| `quatW()` | `motion-algos/proc-motion-shared` | 四元数 w 分量：sqrt(max(0, 1 - x² - y² - z²)) |
| `generateAutoDanceVmd()` | `motion-algos/procedural-motion` | — |
| `generateIdleVmd()` | `motion-algos/procedural-motion` | — |
| `shouldAutoDance()` | `motion-algos/procedural-motion` | — |
| `shouldIdle()` | `motion-algos/procedural-motion` | — |
| `VmdBoneFrame()` | `motion-algos/vmd-evaluator` | — |
| `VmdEvaluator()` | `motion-algos/vmd-evaluator` | — |
| `createVmdEvaluator()` | `motion-algos/vmd-evaluator` | — |
| `shutdownVmdEvaluator()` | `motion-algos/vmd-evaluator` | 释放共享 Scene 资源。 |
| `BONE_FRAME_SIZE()` | `motion-algos/vmd-writer` | — |
| `BoneKeyFrame()` | `motion-algos/vmd-writer` | — |
| `INTERP_EASE_IN_OUT()` | `motion-algos/vmd-writer` | — |
| `INTERP_EASE_OUT()` | `motion-algos/vmd-writer` | — |
| `INTERP_LINEAR()` | `motion-algos/vmd-writer` | — |
| `INTERP_SHARP()` | `motion-algos/vmd-writer` | — |
| `InterpCurve()` | `motion-algos/vmd-writer` | — |
| `MORPH_FRAME_SIZE()` | `motion-algos/vmd-writer` | — |
| `MorphKeyFrame()` | `motion-algos/vmd-writer` | — |
| `buildBoneFrame()` | `motion-algos/vmd-writer` | 构建单个骨骼关键帧 (111 bytes)。插值用线性默认值。 |
| `buildMorphFrame()` | `motion-algos/vmd-writer` | 构建单个 morph 关键帧 (23 bytes)。 |
| `buildVmd()` | `motion-algos/vmd-writer` | 构建完整 VMD ArrayBuffer。 |
| `canEncodeName()` | `motion-algos/vmd-writer` | 检查名称能否被完整编码为 Shift-JIS（round-trip 无误）。 |
| `VPDBoneData()` | `motion-algos/vpd-parser` | — |
| `VPDMorphData()` | `motion-algos/vpd-parser` | — |
| `VPDPoseData()` | `motion-algos/vpd-parser` | — |
| `decodeVPDData()` | `motion-algos/vpd-parser` | 解码 VPD 文本（支持 UTF-8 / UTF-16 / Shift-JIS）。 |
| `loadVPDFromBuffer()` | `motion-algos/vpd-parser` | 从 ArrayBuffer（VPD 文件内容）解析并生成 VMD。 |
| `parseVPDText()` | `motion-algos/vpd-parser` | 解析 VPD 文本为结构化数据。 |
| `poseDataToVmdBuffer()` | `motion-algos/vpd-parser` | 将 VPD 姿势数据转换为标准 VMD 二进制数据。 |

## 物理系统

| 符号 | 文件 | 说明 |
|------|------|------|
| `AttachmentAnchors()` | `physics/physics-bridge` | — |
| `AttachmentFit()` | `physics/physics-bridge` | — |
| `AttachmentTopology()` | `physics/physics-bridge` | — |
| `FrameUpdateFn()` | `physics/physics-bridge` | — |
| `PerFrameUpdateRegistry()` | `physics/physics-bridge` | 单一 onBeforeRenderObservable 调度多个按 key 注册的每帧回调。 |
| `autoFitAttachment()` | `physics/physics-bridge` | 从模型尺寸启发式推算挂件几何参数。 |
| `findRuntimeBone()` | `physics/physics-bridge` | 在模型 runtimeBones 中按名查找。WASM / JS runtime 都暴露 runtimeBones，故后端无关。 |
| `getBoneLocalMatrix()` | `physics/physics-bridge` | 取骨骼在 rootMesh **局部坐标系**下的矩阵（列主序 Float32Array[16]），用于挂件锚点跟随。 |
| `getBoneWorldPosition()` | `physics/physics-bridge` | 从骨骼局部矩阵提取世界位置（米，场景单位）。 |
| `_getBundles()` | `physics/wind-physics` | — |
| `disposeWindPhysics()` | `physics/wind-physics` | 销毁风力物理注入。 |
| `initWindPhysics()` | `physics/wind-physics` | 初始化风力物理注入。 |
| `isWindPhysicsActive()` | `physics/wind-physics` | 当前运行时是否实际启用了风力物理（WASM Bullet）。 |
| `retryWindPhysicsSubscription()` | `physics/wind-physics` | [adr-104] 模型加载成功后由 model-loader 显式调用，重试订阅 physics impl （此时 physics impl 已就绪）。替代原 monkey-pa |

---

> 说明列由 gen-funcmap 自动提取导出符号紧邻 JSDoc 的首句摘要（无 JSDoc 则留 —）。