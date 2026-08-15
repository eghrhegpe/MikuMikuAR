# 函数映射表

> AI 找代码用。改前端功能时先 grep 此表定位文件。
> **自动生成**（2026-08-15）— 由 `scripts/gen-funcmap.mjs` 生成。

## 总览

| 模块 | 文件数 | 导出符号数 |
|------|--------|-----------|
| 核心基础设施 | 136 | 818 |
| 3D 场景 | 125 | 1233 |
| 菜单 & UI | 76 | 397 |
| 动作算法 | 18 | 138 |
| 顶层配置 | 1 | 1 |

## 核心基础设施

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `registerDiagnosticActions()` | `core/action-defs/diagnostic-actions:10` | — |
| `registerEnvActions()` | `core/action-defs/env-actions:27` | — |
| `registerLibraryActions()` | `core/action-defs/library-actions-def:7` | — |
| `registerMotionActions()` | `core/action-defs/motion-actions:89` | — |
| `registerSceneActions()` | `core/action-defs/scene-actions:7` | — |
| `registerSettingsActions()` | `core/action-defs/settings-actions:34` | — |
| `ActionResult()` | `core/action-executor:9` | — |
| `executeActionById()` | `core/action-executor:17` | 按 ID 执行 AI 动作（含参数校验与结果结构化返回）。 |
| `ActionDef()` | `core/action-registry:24` | — |
| `ParamDef()` | `core/action-registry:7` | — |
| `ParamType()` | `core/action-registry:5` | — |
| `_resetActionRegistry()` | `core/action-registry:106` | 清空注册表（测试/重置用） |
| `_setStrictMode()` | `core/action-registry:111` | 设置严格模式 |
| `getAction()` | `core/action-registry:88` | 按 id 获取动作定义 |
| `listActions()` | `core/action-registry:93` | 列出全部或指定域的动作 |
| `registerAction()` | `core/action-registry:63` | 注册一条动作。遇重复 id 时 console.warn + 覆盖（默认）。 |
| `registerActions()` | `core/action-registry:83` | 批量注册 |
| `unregisterAction()` | `core/action-registry:101` | 按 id 撤销注册 |
| `ToolFunction()` | `core/ai/action-catalog:5` | — |
| `ToolSchema()` | `core/ai/action-catalog:15` | — |
| `buildToolCatalogText()` | `core/ai/action-catalog:79` | — |
| `buildToolSchemas()` | `core/ai/action-catalog:52` | — |
| `registerAllActions()` | `core/ai/action-registry-defs:14` | 注册全部 AI 动作定义（控制/诊断/设置/库/动作/环境/场景各域）。 |
| `registerControlActions()` | `core/ai/action-registry-defs:32` | — |
| `BrowserAiAdapter()` | `core/ai/browser-adapter:23` | — |
| `browserAiAdapter()` | `core/ai/browser-adapter:309` | — |
| `BUILTIN_BIBLES()` | `core/ai/character-bible:38` | 内置角色圣经（可扩展；后续支持用户自定义导入）。 |
| `CharacterBible()` | `core/ai/character-bible:11` | 单个角色的人设定义。 |
| `DIALOGUE_EMOTIONS()` | `core/ai/character-bible:25` | 台词生成的输出情绪标签闭集（用于后续 TTS/表情映射，Step 2）。 |
| `DialogueEmotion()` | `core/ai/character-bible:35` | — |
| `DialogueLine()` | `core/ai/character-bible:79` | 一条解析后的台词。 |
| `buildDialogueSystemPrompt()` | `core/ai/character-bible:64` | 组装台词模式的 system prompt：固定人设 + 结构化输出契约。 |
| `getBible()` | `core/ai/character-bible:56` | 按 id 查角色圣经；未命中返回第一个内置角色兜底。 |
| `parseDialogueLines()` | `core/ai/character-bible:88` | 从 LLM 文本响应解析台词数组；容错：非法情绪归一到 neutral， 解析失败时将整段文本作为单条 neutral 台词兜底（保证 UI 永远有内容渲染）。 |
| `ChatSession()` | `core/ai/chat-store:17` | 会话元信息（供列表展示，不含消息体）。 |
| `ChatSessionFull()` | `core/ai/chat-store:26` | 完整会话（元信息 + 消息数组）。 |
| `clearActiveId()` | `core/ai/chat-store:134` | 清除当前活动会话 id（清空会话 / 删除当前会话且无剩余时调用，避免陈旧指针）。 |
| `deleteSession()` | `core/ai/chat-store:106` | 删除会话（元信息 + 消息两键）。 |
| `deriveTitle()` | `core/ai/chat-store:44` | 从消息派生标题：取首条 user 消息前 20 字；无则返回空串（调用方回退 i18n 未命名）。 |
| `getActiveId()` | `core/ai/chat-store:116` | 读当前活动会话 id。 |
| `listSessions()` | `core/ai/chat-store:54` | 列出全部会话元信息，按 updatedAt 倒序（最近的在前）。降级返回空数组。 |
| `loadSession()` | `core/ai/chat-store:73` | 加载完整会话（元信息 + 消息）。缺失或损坏返回 undefined。 |
| `newSessionId()` | `core/ai/chat-store:36` | 生成新会话 id。crypto.randomUUID 在 WebView2 / 现代浏览器均可用。 |
| `saveSession()` | `core/ai/chat-store:87` | 保存完整会话（元信息 + 消息，单事务批量写）。降级不阻断 UI，但写失败需留日志便于排查丢失。 |
| `setActiveId()` | `core/ai/chat-store:125` | 写当前活动会话 id。 |
| `AiConfig()` | `core/ai/config-store:10` | — |
| `AiConfigProvider()` | `core/ai/config-store:8` | — |
| `DEFAULT_AI_CONFIG()` | `core/ai/config-store:80` | 零 key 默认路径：本地 Ollama（大模型零 key，小模型零成本）。见 ADR-196 开放问题 Q2 裁定。 |
| `DEFAULT_RELAY_URL()` | `core/ai/config-store:77` | 网页端 CORS 同源代理 Worker 默认地址（部署时由 wrangler deploy 产出）。 |
| `DEFAULT_TIMEOUT_MS()` | `core/ai/config-store:27` | 缺省超时。 |
| `MAX_TIMEOUT_MS()` | `core/ai/config-store:25` | 超时上限（防误设导致挂死请求永不释放）。 |
| `MIN_TIMEOUT_MS()` | `core/ai/config-store:23` | [doc:adr-199 P2-3] 超时下限（防误设过小掐断正常请求）。 |
| `PROVIDER_PRESETS()` | `core/ai/config-store:38` | 服务商预设：端点、默认模型、是否需要 Key、文案 key、文档链接。 |
| `ProviderPreset()` | `core/ai/config-store:29` | — |
| `classifyAiError()` | `core/ai/config-store:219` | 根据 testConnection / streamChat 的错误消息分类错误类型。 |
| `ensureAiConfigLoaded()` | `core/ai/config-store:139` | 主动预加载（建议 init 后台调用，使首次读取即命中缓存，避免回退默认窗口）。 |
| `loadAiConfig()` | `core/ai/config-store:95` | 同步读取：优先内存缓存；未加载时回退默认并触发异步回源（不阻塞调用方）。 |
| `normalizeEndpoint()` | `core/ai/config-store:105` | 补全 chat completions 路径：输入 &#96;/v1&#96; 自动补全为 &#96;/v1/chat/completions&#96;，已有完整路径则原样返回。 |
| `normalizeTimeout()` | `core/ai/config-store:147` | [doc:adr-199 P2-3] 将超时值归一到 [MIN, MAX]；非法/缺失回落缺省。 |
| `saveAiConfig()` | `core/ai/config-store:120` | 保存配置：写内存缓存（同步即时生效）+ 异步落盘 IndexedDB。 |
| `validateAiConfig()` | `core/ai/config-store:198` | 校验配置是否足够发起一次对话。全量收集所有错误，一次性返回。 |
| `buildDialogueSystemPrompt()` | `core/ai/dialogue-session:32` | 转发：为当前角色构建台词 system prompt。 |
| `getActiveBible()` | `core/ai/dialogue-session:17` | 当前选中的角色圣经。 |
| `listBibles()` | `core/ai/dialogue-session:27` | 可选角色列表（供 UI 下拉/切换）。 |
| `setActiveBible()` | `core/ai/dialogue-session:22` | 切换当前角色（唯一写入点）。 |
| `SpeakLine()` | `core/ai/dialogue-speech:31` | 一条待朗读台词。 |
| `cancelSpeech()` | `core/ai/dialogue-speech:37` | 停止当前所有朗读（切换角色/取消/面板关闭时调用）。 |
| `isSpeechSupported()` | `core/ai/dialogue-speech:12` | 环境是否支持语音合成。 |
| `speakLines()` | `core/ai/dialogue-speech:49` | 依次朗读多条台词（按情绪调整语速/音高）。 |
| `ErrorEntry()` | `core/ai/error-buffer:6` | — |
| `ErrorRingBuffer()` | `core/ai/error-buffer:40` | — |
| `GlobalErrorTarget()` | `core/ai/error-buffer:16` | — |
| `captureError()` | `core/ai/error-buffer:105` | 捕获错误并写入环形缓冲（统一错误上报入口）。 |
| `clearErrors()` | `core/ai/error-buffer:237` | — |
| `errorBuffer()` | `core/ai/error-buffer:100` | — |
| `getErrors()` | `core/ai/error-buffer:233` | 取缓冲内的全部错误条目。 |
| `inferSeverity()` | `core/ai/error-buffer:22` | 根据 ErrorEntry 的 kind + tag 推导严重级别。 |
| `installErrorCaptureOn()` | `core/ai/error-buffer:245` | — |
| `installGlobalErrorCapture()` | `core/ai/error-buffer:280` | — |
| `installLoggingPatch()` | `core/ai/error-buffer:196` | 幂等地 patch console.error，使其所有输出自动入环（保留原始 console.error 行为）。 |
| `toDiagnosticContext()` | `core/ai/error-buffer:305` | — |
| `uninstallLoggingPatch()` | `core/ai/error-buffer:219` | 卸载 console.error 补丁，恢复原始实现。 |
| `GoAiAdapter()` | `core/ai/go-adapter:30` | — |
| `goAiAdapter()` | `core/ai/go-adapter:367` | — |
| `goKeyAllowsProceed()` | `core/ai/go-key-allows-proceed:11` | Go 桌面端 key 不可回读，当 isGo=true &amp;&amp; keyConfigured=true 时， missingKey 不应阻止前端发起请求（key 由 Go 后端持有）。 |
| `resolveAi()` | `core/ai/index:29` | — |
| `ActionResult()` | `core/ai/intent-dispatcher:4` | — |
| `executeAction()` | `core/ai/intent-dispatcher:56` | — |
| `parseActionFromLLM()` | `core/ai/intent-dispatcher:23` | — |
| `renderMarkdownInto()` | `core/ai/markdown:55` | 把 Markdown 文本渲染为 DOM 片段，追加进目标容器。 |
| `AdapterResult()` | `core/ai/param-adapters:4` | — |
| `adaptParam()` | `core/ai/param-adapters:117` | — |
| `colorAdapter()` | `core/ai/param-adapters:46` | — |
| `entityAdapter()` | `core/ai/param-adapters:70` | — |
| `enumAdapter()` | `core/ai/param-adapters:6` | — |
| `rangeAdapter()` | `core/ai/param-adapters:23` | — |
| `isRemoteEndpoint()` | `core/ai/relay:10` | 端点是否为远程 API（非 localhost/127.0.0.1），远程端点才需要 relay 代理。 |
| `relayTarget()` | `core/ai/relay:15` | 获取 relay 目标 URL：网页端 + 远程端点 + relayUrl 已配置时返回 relayUrl，否则 null（直连）。 |
| `SceneSnapshotBridge()` | `core/ai/scene-snapshot:11` | AI 快照所需的引擎运行时读取桥接（由 scene.ts 注入）。 |
| `SceneSnapshotData()` | `core/ai/scene-snapshot:23` | 格式化后的快照数据（纯数据，便于测试）。 |
| `_resetAiSnapshotBridge()` | `core/ai/scene-snapshot:44` | 仅供测试使用：重置 bridge 缓存。 |
| `captureSceneSnapshot()` | `core/ai/scene-snapshot:83` | 采集当前场景快照文本；未初始化时返回占位符。 |
| `captureSceneSnapshotData()` | `core/ai/scene-snapshot:64` | 采集当前场景快照结构化数据；未初始化时返回 null。 |
| `formatSceneSnapshot()` | `core/ai/scene-snapshot:49` | 将快照数据格式化为紧凑文本（≤ NFR-3 的 2048 字符预算）。 |
| `registerAiSnapshotBridge()` | `core/ai/scene-snapshot:39` | 由 scene.ts 在 initScene() 时注入引擎引用（单向依赖，避免 ai → scene 静态耦合）。 |
| `parseSseStream()` | `core/ai/sse:20` | — |
| `AI_ERROR_KINDS()` | `core/ai/types:124` | [doc:adr-196] AiErrorKind 运行时值数组，供 Go kind 白名单校验等需要运行时遍历的场景使用。 |
| `AiCapabilities()` | `core/ai/types:5` | AI 后端能力描述 |
| `AiConfigProvider()` | `core/ai/types:107` | 用户选择的服务商配置项 |
| `AiConnectionResult()` | `core/ai/types:72` | AI 连接测试结果，镜像 Go LLMConnectionResult 结构 |
| `AiErrorKind()` | `core/ai/types:110` | 错误分类，用于面板给出可操作建议 |
| `AiPersistedConfig()` | `core/ai/types:81` | 持久化配置的回读结构，供诊断面板初始化时回填输入框。 |
| `AiService()` | `core/ai/types:93` | AI 服务统一抽象，镜像 BackendService 双适配器模式 |
| `AiValidationError()` | `core/ai/types:138` | 校验错误条目（全量收集用） |
| `AiValidationResult()` | `core/ai/types:144` | 配置校验结果 |
| `ChatChunk()` | `core/ai/types:57` | 流式聊天响应块 |
| `ChatMessage()` | `core/ai/types:29` | 聊天消息角色 |
| `ChatRequest()` | `core/ai/types:46` | 流式聊天请求参数 |
| `ToolCall()` | `core/ai/types:19` | 工具调用（assistant 消息中） |
| `ToolSchema()` | `core/ai/types:36` | JSON Schema 工具定义（OpenAI function_calling 格式） |
| `Abortable()` | `core/async:144` | 可复用的 AbortController 封装——abort 后自动重置，使对象可重复使用。 |
| `DebouncedTimer()` | `core/async:109` | 防抖定时器——封装 setTimeout 的 schedule/cancel 样板。 |
| `LoadingGuard()` | `core/async:77` | 并发加载守卫——防止同一 key 的异步操作重复触发。 |
| `delay()` | `core/async:22` | Promise 包装的延迟。 |
| `fireAndForget()` | `core/async:17` | 启动一个异步操作但不等待，异常由 swallowError 兜底。 |
| `makeLazyLoader()` | `core/async:43` | 创建惰性动态 import 加载器（带并发守卫 + 失败重试）。 |
| `swallowError()` | `core/async:12` | 吞掉 promise 的异常并记录日志（比空 &#96;.catch(() =&gt; {})&#96; 可调试）。 |
| `waitForFrame()` | `core/async:27` | Promise 包装的等待下一帧。 |
| `PlaySfxOptions()` | `core/audio-bus:107` | — |
| `disposeAudioBus()` | `core/audio-bus:190` | 释放总线资源（context 关闭、缓存清空）。 |
| `getAudioContext()` | `core/audio-bus:21` | 惰性创建共享 AudioContext（SFX 总线与未来音效共用）。无支持环境返回 null。 |
| `getFootstepVolume()` | `core/audio-bus:103` | — |
| `getSfxEnabled()` | `core/audio-bus:90` | — |
| `getSfxMasterGain()` | `core/audio-bus:62` | SFX 主增益（独立于音乐音量）。增益值实时反映 sfxEnabled / sfxVolume。无 AudioContext 支持返回 null。 |
| `getSfxVolume()` | `core/audio-bus:81` | — |
| `playSfx()` | `core/audio-bus:123` | 播放一次短音效。每次 new BufferSource（一次性、可叠加），播完自动断开释放。 |
| `setFootstepEnabled()` | `core/audio-bus:94` | — |
| `setFootstepVolume()` | `core/audio-bus:98` | — |
| `setSfxEnabled()` | `core/audio-bus:85` | — |
| `setSfxVolume()` | `core/audio-bus:75` | — |
| `BeatSink()` | `core/audio:28` | [doc:adr-242] 节拍检测器的结构契约。core 层不得依赖 &#96;motion-algos/beat-detector&#96; 的具体实现类——那会构成 &#96;core → moti |
| `applyGain()` | `core/audio:568` | — |
| `attachBeatDetector()` | `core/audio:561` | — |
| `clearAudio()` | `core/audio:404` | — |
| `disposeAudio()` | `core/audio:415` | — |
| `getAudioName()` | `core/audio:510` | — |
| `getAudioOffset()` | `core/audio:481` | — |
| `getAudioPath()` | `core/audio:381` | — |
| `getCurrentTime()` | `core/audio:487` | — |
| `getDuration()` | `core/audio:491` | — |
| `getRepeatModeStr()` | `core/audio:358` | 获取当前重复模式。 |
| `getStreamPlayer()` | `core/audio:585` | 暴露内部 StreamAudioPlayer 供 scene.ts 调用 MmdRuntime.setAudioPlayer()。 |
| `getVolume()` | `core/audio:470` | — |
| `isAudioPlaying()` | `core/audio:506` | — |
| `loadAudioFile()` | `core/audio:283` | — |
| `nextTrack()` | `core/audio:344` | 切换到下一曲。 |
| `notifyBeatDetectorReset()` | `core/audio:578` | — |
| `pauseAudio()` | `core/audio:385` | — |
| `playAudio()` | `core/audio:261` | — |
| `resumeAudio()` | `core/audio:389` | — |
| `seekAudio()` | `core/audio:496` | — |
| `setAudioOffset()` | `core/audio:474` | — |
| `setRepeatMode()` | `core/audio:353` | 设置重复模式（持久化）。 |
| `setVolume()` | `core/audio:461` | — |
| `stopAudio()` | `core/audio:396` | — |
| `syncAudioPlayback()` | `core/audio:518` | — |
| `setTriggerAutoSave()` | `core/auto-save:10` | 注册自动保存的实现回调（由 scene-serialize.ts 在初始化时调用）。 |
| `triggerAutoSave()` | `core/auto-save:15` | 触发自动保存（由动作/菜单/UI 层调用）。 |
| `clearWebFlag()` | `core/backend/backend-mocks:13` | — |
| `goAdapterMock()` | `core/backend/backend-mocks:48` | — |
| `idbStore()` | `core/backend/backend-mocks:7` | — |
| `makeIdbMock()` | `core/backend/backend-mocks:28` | — |
| `resetIdb()` | `core/backend/backend-mocks:18` | — |
| `setWindow()` | `core/backend/backend-mocks:9` | — |
| `eqBytes()` | `core/backend/browser-adapter-mocks:12` | — |
| `mem()` | `core/backend/browser-adapter-mocks:6` | — |
| `resetMem()` | `core/backend/browser-adapter-mocks:15` | — |
| `setStore()` | `core/backend/browser-adapter-mocks:8` | — |
| `FsaAuthState()` | `core/backend/browser-adapter:897` | — |
| `browserAdapter()` | `core/backend/browser-adapter:1373` | — |
| `dismissFsaAuthPrompt()` | `core/backend/browser-adapter:933` | — |
| `getFsaAuthState()` | `core/backend/browser-adapter:904` | [doc:adr-183] 查询 FSA 根目录授权状态，供 UI 启动引导（不触发任何权限弹窗）。 |
| `getFsaDownloadAuthState()` | `core/backend/browser-adapter:971` | 查询下载文件夹 FSA 授权状态（不触发权限弹窗），供 UI 引导。 |
| `getFsaDownloadHandle()` | `core/backend/browser-adapter:1036` | 读取持久化的下载文件夹句柄（供扫描使用），不触发权限弹窗；无句柄返回 null。 |
| `ingestModelBytes()` | `core/backend/browser-adapter:649` | [doc:adr-195] 写入单文件（名+字节）到资源库，不加载到场景。供下载面板批量摄入复用。 |
| `ingestModelFile()` | `core/backend/browser-adapter:639` | 写入单个模型/动作文件（File）到 IndexedDB 资源库（file:+entry:），不加载到场景。 |
| `ingestModelFiles()` | `core/backend/browser-adapter:658` | [doc:adr-195] P3 批量摄入：单事务写入该批次所有 file:/entry: 键，避免逐条 idbSet 并发写竞态。 |
| `isFsaAuthPromptDismissed()` | `core/backend/browser-adapter:929` | [doc:adr-183] 用户跳过启动授权引导后写入「已跳过」标志，避免纯导入用户每次启动被弹窗骚扰。 |
| `reauthorizeFsaDownload()` | `core/backend/browser-adapter:995` | 对持久化的下载文件夹句柄重新请求授权（须用户手势上下文）。成功返回 true。 |
| `reauthorizeFsaRoot()` | `core/backend/browser-adapter:941` | [doc:adr-183] 对持久化的 FSA 句柄重新请求授权（不重选目录）。 |
| `selectFsaDownloadDir()` | `core/backend/browser-adapter:1019` | 选择下载文件夹（独立 FSA 句柄），持久化到 _FSA_DOWNLOAD_KEY。 |
| `setScanProgressCallback()` | `core/backend/browser-adapter:744` | [doc:adr-183] 注册扫描进度回调，供 UI 层节流增量刷新。 |
| `goAdapter()` | `core/backend/go-adapter:21` | — |
| `STORES()` | `core/backend/idb:10` | — |
| `Store()` | `core/backend/idb:24` | — |
| `WebModelEntry()` | `core/backend/idb:132` | — |
| `closeIDB()` | `core/backend/idb:123` | 释放连接（页面卸载/切换时调用），与联邦资源配对纪律对齐。 |
| `idbBatchSet()` | `core/backend/idb:98` | 单事务批量写入（键/值对），避免逐条 idbSet 的并发写竞态。 |
| `idbDelete()` | `core/backend/idb:84` | — |
| `idbGet()` | `core/backend/idb:62` | — |
| `idbKeys()` | `core/backend/idb:112` | — |
| `idbSet()` | `core/backend/idb:72` | — |
| `openDB()` | `core/backend/idb:28` | — |
| `saveModel()` | `core/backend/idb:148` | 存入模型库（同名覆盖）。返回写入的元数据。 |
| `getCachedCapabilities()` | `core/backend/index:139` | — |
| `getCapabilities()` | `core/backend/index:130` | — |
| `resolveBackend()` | `core/backend/index:34` | — |
| `BackendCapabilities()` | `core/backend/types:19` | 三态能力矩阵键（对齐 ADR-176「能力矩阵（三态 × 能力键）」节）。 |
| `BackendService()` | `core/backend/types:93` | 统一后端抽象。go-adapter 透传 Go 全量（含契约测试 139 函数）， browser-adapter 实现 106（81 真实 + 8 FSA + 17 降级）。 |
| `GoApp()` | `core/backend/types:13` | Go 生成绑定的值类型（函数签名源）。 |
| `NotSupportedError()` | `core/backend/types:101` | 浏览器侧原生独占能力的统一错误。调用方据 capabilities() 预判或 catch 此错误。 |
| `clamp()` | `core/clamp:6` | — |
| `clamp01()` | `core/clamp:14` | — |
| `clampInt()` | `core/clamp:10` | — |
| `clampPct()` | `core/clamp:29` | 百分比钳制到 [0, 100]。 |
| `lerp()` | `core/clamp:19` | 线性插值。 |
| `lerpArray()` | `core/clamp:24` | 逐元素线性插值数组。 |
| `Cache()` | `core/collections:22` | 轻量泛型缓存——Map 封装，统一 get/set/has/delete/clear 接口。 |
| `allSettledFilter()` | `core/collections:49` | 等待全部 promise 结束，仅返回 fulfilled 结果（rejected 被静默丢弃）。 |
| `ensureArray()` | `core/collections:6` | 确保值为数组；非数组则包裹为单元素数组。 |
| `filterKeys()` | `core/collections:11` | 按谓词过滤对象键，返回仅含满足条件键值对的新对象。 |
| `col3FromTriple()` | `core/color-helpers:15` | 从 &#96;[r, g, b]&#96; 三元组构造 Color3。 |
| `hexToRgb()` | `core/color-helpers:22` | 将 #rrggbb 解析为 {r,g,b}（0–255）。非法输入回退主题默认 74,108,247。 |
| `rgbString()` | `core/color-helpers:40` | 将 Color3 转为 CSS &#96;rgb(r, g, b)&#96; 字符串（0–255 整数，clamp 到 [0,255]）。 |
| `rgbToString()` | `core/color-helpers:35` | 将 {r,g,b} 转为 CSS rgb 字符串 "r, g, b"（供 --accent-rgb 等 CSS 变量）。 |
| `debounce()` | `core/debounce:8` | 函数防抖：在等待指定时间后才执行函数，如果在等待期间再次调用则重置计时器。 |
| `disposeLogPanel()` | `core/debug-log-panel:167` | — |
| `hideLogPanel()` | `core/debug-log-panel:153` | — |
| `showLogPanel()` | `core/debug-log-panel:75` | — |
| `toggleLogPanel()` | `core/debug-log-panel:159` | — |
| `deepClone()` | `core/deep-clone:9` | 深拷贝对象（基于 JSON 序列化）。 |
| `setupE2ECapture()` | `core/dev-hooks:24` | — |
| `DialogOptions()` | `core/dialog:49` | — |
| `Prompt2Options()` | `core/dialog:294` | — |
| `disposeOverlay2()` | `core/dialog:370` | 移除 showPrompt2 创建的 overlay2 DOM（供 HMR 清理入口调用）。 |
| `showConfirm()` | `core/dialog:255` | Show a confirmation dialog. |
| `showPrompt()` | `core/dialog:271` | Show a prompt dialog. |
| `showPrompt2()` | `core/dialog:394` | 双字段输入对话框。返回 [value1, value2] 或 null（取消）。 |
| `detachSharedTextures()` | `core/dispose-helpers:64` | 批量 dispose 一组材质**之前**调用：摘除这组材质对「仍被其他存活材质引用」的纹理的引用， 使随后的 &#96;material.dispose(_, true)&#96; 不会误杀共享 |
| `safeDispose()` | `core/dispose-helpers:29` | 安全释放对象并置空。 |
| `ARIA_ATTR()` | `core/dom-contract:32` | aria 属性名常量（ARIA_ATTR.valuemin 等） |
| `COLLAPSIBLE()` | `core/dom-contract:44` | collapsible（folder）组件契约（ui-collapsible.ts 与 e2e 展开逻辑共用） |
| `KIND_CONTROL_SELECTOR()` | `core/dom-contract:13` | MenuKind → 交互控件选择器（e2e 断言用；folder/custom/action 等无标准交互控件） |
| `ROLE()` | `core/dom-contract:21` | 渲染层 role 常量——产出 role 属性时引用，勿手写字符串（ADR-229 §9） |
| `SLIDER_BAR_CLASS()` | `core/dom-contract:52` | 滑动条本体 class（slider / colorSlider / modeSlider 共用 .cs-bar） |
| `TOGGLE_INPUT_SELECTOR()` | `core/dom-contract:10` | toggle 的原生输入元素选择器（e2e 需点击/读 checked，故单列一份） |
| `Disposable()` | `core/dom:67` | — |
| `DomRefs()` | `core/dom:64` | — |
| `addDisposableListener()` | `core/dom:75` | 添加事件监听器并返回 Disposable，便于在 dispose 链路中统一释放。 |
| `dom()` | `core/dom:13` | — |
| `handleDropFile()` | `core/drop-import:31` | 处理已落地的路径（桌面绝对路径或浏览器 IndexedDB 键）。 |
| `handleDroppedFile()` | `core/drop-import:85` | [doc:adr-177] 单个拖入文件落地：桌面走原生 path，浏览器读字节写 IndexedDB。 |
| `StateReader()` | `core/e2e-state-bridge:7` | — |
| `getE2EStateReader()` | `core/e2e-state-bridge:17` | 读取 E2E 状态读取器（core/dev-hooks 侧调用；未注册返回 null） |
| `setE2EStateReader()` | `core/e2e-state-bridge:12` | 注册 E2E 状态读取器（menus/menu-schema 侧调用，模块加载即注册） |
| `deriveDefaultEnvState()` | `core/env-state-defaults:18` | 从 ENV_STATE_SCHEMA 派生默认 EnvState。 |
| `ENV_STATE_SCHEMA()` | `core/env-state-schema:34` | — |
| `EnvDispatchGroup()` | `core/env-state-schema:384` | 已定义的 dispatch 分组名称 |
| `EnvStateSchema()` | `core/env-state-schema:379` | — |
| `getEnvKeys()` | `core/env-state-schema:405` | 从 Schema 派生指定 dispatch 分组的 key 列表。 |
| `escapeHtml()` | `core/escape-html:5` | Escape HTML special characters to prevent injection. |
| `disposeEventHandlers()` | `core/events:44` | — |
| `initDropHandler()` | `core/events:373` | — |
| `registerEventHandlers()` | `core/events:66` | — |
| `showUpdateToast()` | `core/events:288` | — |
| `feedbackError()` | `core/feedback:40` | 错误级 toast 反馈。标题 =「动作 + 目标」，detail 自动从 error 翻译。 |
| `feedbackInfo()` | `core/feedback:53` | Info 级 toast 反馈。标题 =「动作 + 目标」。 |
| `feedbackStatus()` | `core/feedback:70` | 通用状态栏反馈。auto-detect 成功与否：title 以 ✗ 开头则为失败。 |
| `encodeFileRef()` | `core/fileservice:45` | 编码文件名为查询参数值（base64url 无填充）。 |
| `normPath()` | `core/fileservice:115` | — |
| `resolveFileUrl()` | `core/fileservice:60` | 从文件路径解析出 HTTP URL 及对应服务器信息。 |
| `resolveModelDir()` | `core/fileservice:108` | 从文件路径解析出隔离后的目录路径（不启动 HTTP 服务器）。 |
| `revokeFileUrl()` | `core/fileservice:94` | 释放 resolveFileUrl 浏览器分支产生的 blob: URL（调用方用完必须调用，配对释放）。 |
| `formatTimestamp()` | `core/format-timestamp:6` | 格式化日期为 HH:MM:SS.mmm 字符串。 |
| `formatError()` | `core/format:22` | 将任意错误值转换为人类可读字符串，带截断保护。 |
| `formatTime()` | `core/format:8` | 格式化秒数为 &#96;MM:SS.CC&#96; 字符串（分:秒.百分秒）。 |
| `freeflyInput()` | `core/freefly-state:8` | — |
| `Ktx2Capability()` | `core/gpu-capabilities:8` | — |
| `Ktx2PreferredFormat()` | `core/gpu-capabilities:6` | — |
| `_resetKtx2CacheForTest()` | `core/gpu-capabilities:58` | 仅供测试使用：重置缓存。 |
| `detectKtx2Support()` | `core/gpu-capabilities:20` | 探测 GPU 对 KTX2 压缩纹理的支持。 |
| `guardNum()` | `core/guards:5` | 将 undefined/NaN/非数字归一为 fallback，防止 NaN 污染 Babylon.js 数学类型与 CSS 串。 |
| `translateGoError()` | `core/i18n/goerr:25` | [doc:adr-117] 将 Go 端返回的 error 翻译为当前语言。 |
| `LangCode()` | `core/i18n/locale:6` | — |
| `SUPPORTED_LANGS()` | `core/i18n/locale:15` | 规划支持的语言清单（与竞品 DanceXR 对齐：简/繁中、英、日、韩）。 |
| `detectSystemLang()` | `core/i18n/locale:36` | [doc:adr-059] 从浏览器/WebView 语言偏好推断首选语言。 |
| `getLang()` | `core/i18n/locale:82` | 当前语言代码（响应式，切换语言后自动更新）。 |
| `initI18n()` | `core/i18n/locale:116` | 启动期语言初始化：同步 &lt;html lang&gt; 并预加载当前语言包。 |
| `setLang()` | `core/i18n/locale:88` | — |
| `en()` | `core/i18n/locales/en:2` | — |
| `ja()` | `core/i18n/locales/ja:2` | — |
| `ko()` | `core/i18n/locales/ko:2` | — |
| `zhCN()` | `core/i18n/locales/zh-CN:2` | — |
| `zhTW()` | `core/i18n/locales/zh-TW:2` | — |
| `AVAILABLE_LANGS()` | `core/i18n/t:17` | [doc:adr-059] 当前已补全语言包的语言列表。 |
| `bundles()` | `core/i18n/t:9` | 运行时加载的语言包缓存。生产环境由 fetch 填充，测试环境可直接赋值。 |
| `loadLocale()` | `core/i18n/t:23` | 异步加载指定语言包，从 public/locales/{lang}.json fetch。 |
| `t()` | `core/i18n/t:54` | 翻译一个 key。 |
| `registerIconBundle()` | `core/icons-bundle:678` | — |
| `createIconButton()` | `core/icons:27` | 创建图标按钮（默认 slide-action 样式）。 |
| `createIconifyIcon()` | `core/icons:12` | Create an &lt;iconify-icon&gt; element for the given icon name. |
| `softwareKindIcon()` | `core/icons:43` | Map software kind to an iconify icon name. |
| `canvasToBase64()` | `core/image:13` | 将 Canvas 编码为 base64 字符串（剥离 data:image/...;base64, 前缀）。 |
| `thumbDataUrl()` | `core/image:64` | Build a data URL from a base64 thumbnail, sniffing PNG/JPEG/WebP from the header. |
| `toBase64()` | `core/image:54` | Encode a string as base64 (UTF-8 safe). |
| `bootstrap()` | `core/init:638` | 应用启动入口：接线 dev-hooks / render-loop / events 并启动渲染循环。 |
| `jsonParse()` | `core/json-stringify:12` | Safely parse JSON; returns null on failure instead of throwing. |
| `jsonStringify()` | `core/json-stringify:5` | Format a value as pretty-printed JSON (2-space indent). |
| `CATEGORY_DIR()` | `core/library-path:57` | — |
| `computeLibraryRef()` | `core/library-path:10` | Backwards-compatible wrapper: reads libraryRoot and delegates to the pure path leaf. |
| `getBrowseDir()` | `core/library-path:76` | 统一的资源浏览目录解析。 |
| `resolveLibraryRef()` | `core/library-path:14` | — |
| `addRecentMotion()` | `core/library-state:91` | — |
| `allModels()` | `core/library-state:29` | — |
| `clearExpandedFolders()` | `core/library-state:136` | [fix:round14 P3] 清空已展开文件夹集合。 |
| `clearRecentMotions()` | `core/library-state:109` | [fix:round14 P3] 清空最近动作列表。 |
| `clearThumbnailCache()` | `core/library-state:59` | [fix:round14 P3] 清空缩略图缓存。 |
| `displayNamePriority()` | `core/library-state:74` | [fix:round14 P3] 清空缩略图缓存。 |
| `expandedFolders()` | `core/library-state:122` | — |
| `getRecentMotions()` | `core/library-state:99` | — |
| `libraryRoot()` | `core/library-state:10` | — |
| `librarySortMode()` | `core/library-state:81` | — |
| `modelMetaCache()` | `core/library-state:115` | — |
| `overridePaths()` | `core/library-state:22` | — |
| `recentModels()` | `core/library-state:66` | — |
| `resourceRoot()` | `core/library-state:15` | — |
| `setAllModels()` | `core/library-state:30` | — |
| `setDisplayNamePriority()` | `core/library-state:75` | — |
| `setLibraryRoot()` | `core/library-state:11` | — |
| `setLibrarySortMode()` | `core/library-state:82` | — |
| `setModelMetaCache()` | `core/library-state:116` | — |
| `setOverridePaths()` | `core/library-state:23` | — |
| `setRecentModels()` | `core/library-state:67` | — |
| `setResourceRoot()` | `core/library-state:17` | [audit:P2] 同时同步 libraryRoot（历史兼容：二者语义相同，resourceRoot 为新名称）。 |
| `setThumbnailCache()` | `core/library-state:44` | — |
| `setThumbnailUpdateCallback()` | `core/library-state:40` | — |
| `thumbnailCache()` | `core/library-state:36` | — |
| `toggleExpandedFolder()` | `core/library-state:124` | — |
| `LibraryLoadError()` | `core/load-manager:36` | [doc:adr-135] P0.2 加载错误结构化对象。 |
| `LoadPhase()` | `core/load-manager:26` | [doc:adr-135] P0.2 加载阶段标签。dispatch 内部按 phase 更新， 错误时包装进 LibraryLoadError，便于 formatError 加 |
| `LoadRequest()` | `core/load-manager:45` | — |
| `ResourceHandle()` | `core/load-manager:73` | — |
| `ResourceKind()` | `core/load-manager:11` | — |
| `loadManager()` | `core/load-manager:278` | 单例。 |
| `registerLibraryScannedHook()` | `core/load-refresh-registry:57` | 注册一个「库扫描完成」钩子。 |
| `registerLoadRefreshHook()` | `core/load-refresh-registry:21` | 注册一个「模型加载后刷新」钩子。 |
| `runLoadRefreshHooks()` | `core/load-refresh-registry:33` | 执行所有已注册的加载后刷新钩子。 |
| `LogEntry()` | `core/logger:9` | — |
| `clearLogs()` | `core/logger:81` | 清空日志 |
| `getConsoleOutput()` | `core/logger:71` | [audit:round18 P2] 读取 console 输出开关（调试面板初始文案须与实际状态一致） |
| `getLogBuffer()` | `core/logger:76` | 获取日志缓冲区（供调试面板使用） |
| `logError()` | `core/logger:112` | 统一标签格式的 error 日志。 |
| `logInfo()` | `core/logger:86` | 统一标签格式的 info 日志。 |
| `logWarn()` | `core/logger:99` | 统一标签格式的 warn 日志。 |
| `setConsoleOutput()` | `core/logger:66` | 设置是否同时输出到 console |
| `degToRad()` | `core/math-geometry:24` | 角度 → 弧度。 |
| `dist2d()` | `core/math-geometry:6` | 2D 欧几里得距离。 |
| `dist3d()` | `core/math-geometry:13` | 3D 欧几里得距离。 |
| `radToDeg()` | `core/math-geometry:29` | 弧度 → 角度。 |
| `hash2()` | `core/math/hash-noise:11` | 确定性整数哈希 → [0,1]。seed 相同则结果可复现。 |
| `hash2v()` | `core/math/hash-noise:23` | 二元组哈希 → [[0,1],[0,1]]。供 Voronoi 需要两个独立随机偏移的场景（焦散网状亮纹）。 |
| `valueNoise()` | `core/math/hash-noise:31` | 平滑值噪声 → [0,1]。四角哈希 + smoothstep 双线性插值。 |
| `MmarGlobal()` | `core/mmar-globals:27` | — |
| `MmarPhase()` | `core/mmar-globals:7` | — |
| `MmarSceneSnapshot()` | `core/mmar-globals:16` | — |
| `MmarStatus()` | `core/mmar-globals:9` | — |
| `refreshSceneSnapshot()` | `core/mmar-globals:103` | 刷新 window.__mmar.scene 快照。 |
| `startSceneSnapshotPolling()` | `core/mmar-globals:197` | 启动周期快照刷新；重复调用安全（仅注册一个 timer）。 |
| `stopSceneSnapshotPolling()` | `core/mmar-globals:207` | 停止周期快照刷新；未启动或重复调用均安全。 |
| `updateMmarStatus()` | `core/mmar-globals:80` | — |
| `CapabilityProbe()` | `core/mmd-adapter:377` | CapabilityProbe — 升级回归探测（ADR-192 Phase 2 守卫式反射）。 |
| `applyForceToModelRigidBodies()` | `core/mmd-adapter:163` | — |
| `applyForceToModelRigidBodiesNative()` | `core/mmd-adapter:210` | — |
| `applyWindForceToModelRigidBodiesNative()` | `core/mmd-adapter:332` | — |
| `getBoneWorldMatrix()` | `core/mmd-adapter:438` | 返回骨骼在世界坐标系下的 worldMatrix（固化自 adr-071 坐标系契约）。 |
| `getPhysicsImpl()` | `core/mmd-adapter:39` | 从 IMmdRuntime 获取底层 MmdWasmPhysicsRuntimeImpl。 |
| `getRigidBodyBundleMap()` | `core/mmd-adapter:75` | 返回所有 RigidBodyBundle 迭代器（条目 3 内化，ADR-192 Phase 2）。 |
| `getRigidBodyMap()` | `core/mmd-adapter:96` | 返回所有**单数** RigidBody 迭代器（路径1 修正，ADR-200）。 |
| `getStreamAudio()` | `core/mmd-adapter:111` | — |
| `onBoneMatricesUpdated()` | `core/mmd-adapter:399` | 在骨骼 worldMatrix 已被 babylon-mmd 更新之后、渲染之前注册回调。 |
| `solveIkNative()` | `core/mmd-adapter:270` | — |
| `switchAnimation()` | `core/mmd-adapter:465` | 切换模型当前动画到新动画，并归零运行时全局时钟到第 0 帧。 |
| `transformWorldToRootLocal()` | `core/mmd-adapter:412` | 把世界坐标系下的点转换到 rootMesh 局部坐标系（固化自 perception-gaze.ts / adr-071）。 |
| `ObserverHandle()` | `core/observer-handle:31` | 可释放的 Observer 句柄。 |
| `ObserverRegistry()` | `core/observer-handle:93` | 管理器：收集多个 ObserverHandle，支持一次性 disposeAll()。 |
| `observe()` | `core/observer-handle:62` | 订阅 Observable 并返回自动管理的句柄。 |
| `observeOnce()` | `core/observer-handle:76` | 一次性订阅：回调执行后自动移除，等价于 observable.addOnce()。 |
| `orbitInput()` | `core/orbit-state:10` | — |
| `MIN_ORBIT_DISTANCE()` | `core/orbit:15` | 轨道距离下限：distance&lt;=0 或非有限时钳制到此值，避免塌缩到原点或 NaN。 |
| `OrbitCoords()` | `core/orbit:5` | — |
| `cartesianToOrbit()` | `core/orbit:61` | 笛卡尔坐标 → 球面坐标。 |
| `normalizeOrbit()` | `core/orbit:25` | 钳制一组原始轨道参数为合法值域。 |
| `orbitToCartesian()` | `core/orbit:38` | 球面坐标 → 笛卡尔坐标。 |
| `computeLibraryRef()` | `core/path:85` | 纯函数：计算文件路径相对于 libraryRoot 的引用标识（相对路径）。 |
| `getBaseName()` | `core/path:45` | 跨平台取路径末段文件名。 |
| `getDirPath()` | `core/path:55` | 跨平台取父目录路径。根目录（无 &#96;/&#96;）返回空字符串。 |
| `isStageLike()` | `core/path:106` | 判断给定 kind/type 是否为「舞台类」（缩略图使用横屏 16:9 宽高比）。 |
| `isUnderRoot()` | `core/path:68` | [doc:adr-090][doc:adr-095] 路径归属判定（唯一实现，基于 normPath）。 |
| `normPath()` | `core/path:15` | 标准化路径：反斜杠 → 正斜杠，去掉尾部斜杠。 |
| `awaitWailsBridge()` | `core/platform:44` | Waits for the Wails bridge (window.wails) to be injected by the WebView. |
| `guardExternalAction()` | `core/platform:118` | Guards an external application action (Blender, MMD, etc.) that is not available on Androi |
| `isAndroidPlatform()` | `core/platform:13` | Returns true when running inside the Android WebView (Wails v3). |
| `isWebEntryMode()` | `core/platform:129` | [doc:adr-196/176] 运行时判定是否为 web 入口（短路标记或构建模式）。 |
| `isWebPlatform()` | `core/platform:28` | Returns true when running in a pure browser (no Wails bridge). |
| `openExternalLink()` | `core/platform:100` | 打开外链的统一入口：先尝试 Android &#96;&lt;a&gt;.click()&#96; 方式，失败则回退 &#96;window.open&#96;。 |
| `openExternalURL()` | `core/platform:82` | Opens a URL in the system browser. |
| `readDeclaredAdapter()` | `core/platform:139` | [doc:adr-196/176] 读取 globalThis 上声明的适配器身份（'go' \| 'browser'）。 |
| `autoLoop()` | `core/playback-state:13` | — |
| `isPlaying()` | `core/playback-state:8` | [doc:architecture] Playback control store — ADR-141 split from core/state.ts. |
| `seekDragging()` | `core/playback-state:20` | — |
| `setAutoLoop()` | `core/playback-state:14` | — |
| `setIsPlaying()` | `core/playback-state:9` | — |
| `setSeekDragging()` | `core/playback-state:21` | — |
| `parsePmxComment()` | `core/pmx-meta:11` | 从 PMX 文件的 Uint8Array 中提取 comment（日本语说明/使用规约）。 |
| `PresetCategory()` | `core/preset-meta:19` | — |
| `PresetMeta()` | `core/preset-meta:21` | — |
| `listPresets()` | `core/preset-meta:57` | 跨系统枚举预设，归一为 &#96;PresetMeta[]&#96;。 |
| `toPresetMeta()` | `core/preset-meta:35` | 由单条记录构造 &#96;PresetMeta&#96;。&#96;extra&#96; 仅承载 envelope 字段，不触碰各系统原生 payload。 |
| `reactive()` | `core/reactivity:77` | — |
| `readonly()` | `core/reactivity:118` | Passthrough readonly — store 层通过约定保证不可变，不做深冻结。 |
| `scheduleRefresh()` | `core/reactivity:25` | 安排一次刷新（RAF 去抖）。 |
| `subscribe()` | `core/reactivity:50` | 注册一个刷新订阅者。返回取消订阅函数。 |
| `unsubscribeAll()` | `core/reactivity:60` | 清空所有刷新订阅者。供 initScene 重入时调用（ADR-106 D3 HMR 清理入口）。 |
| `RenderContext()` | `core/render-context:11` | 渲染期可注册自更新控件的最小上下文（由 SlideMenu 实现）。 |
| `getCurrentRenderingContext()` | `core/render-context:24` | 获取当前正在渲染的上下文（供控件函数自动注册）。 |
| `popRenderingContext()` | `core/render-context:34` | 退出当前渲染上下文（renderCustom 后调用，须在 finally 中配对）。 |
| `pushRenderingContext()` | `core/render-context:29` | 进入一个渲染上下文（renderCustom 前调用）。 |
| `calcHardwareScaling()` | `core/render-loop:28` | 根据 DPR + renderScale 计算安全的 hardwareScalingLevel， 钳位帧缓冲不超过 GL_MAX_TEXTURE_SIZE（防 DPR×render |
| `startRenderLoop()` | `core/render-loop:55` | 启动渲染循环（幂等：先停旧实例，避免 setInterval / render-loop 泄漏）。 |
| `stopRenderLoop()` | `core/render-loop:157` | 停止渲染循环并清理 FPS 时钟。 |
| `reportResourceWarning()` | `core/resource-warning-sink:38` | 上报一条资源加载警告（自动去重）。 |
| `EventCallback()` | `core/runtime-bridge:18` | — |
| `RuntimeBridge()` | `core/runtime-bridge:32` | — |
| `RuntimeBrowser()` | `core/runtime-bridge:28` | — |
| `RuntimeEvents()` | `core/runtime-bridge:20` | — |
| `Unsubscribe()` | `core/runtime-bridge:17` | — |
| `browser()` | `core/runtime-bridge:217` | — |
| `events()` | `core/runtime-bridge:211` | — |
| `getRuntimeBridge()` | `core/runtime-bridge:171` | — |
| `initRuntimeBridge()` | `core/runtime-bridge:192` | bootstrap 早期调用：桌面/Android 侧强制加载 @wailsio/runtime 并绑定 events 实例。 |
| `RuntimeMode()` | `core/runtime-mode:6` | — |
| `detectRuntimeMode()` | `core/runtime-mode:22` | 探测运行时模式（COOP/COEP + SharedArrayBuffer + MPR 构建标志）。 |
| `initRuntimeBadge()` | `core/runtime-mode:104` | bootstrap 早期调用：立即渲染上次持久化的模式，刷新后不丢失 |
| `loadPersistedRuntimeMode()` | `core/runtime-mode:39` | — |
| `persistRuntimeMode()` | `core/runtime-mode:31` | — |
| `renderRuntimeBadge()` | `core/runtime-mode:84` | — |
| `setBackendBadge()` | `core/runtime-mode:95` | 渲染实际选中的后端（go / browser）到运行时徽标，与 MPR/SPR 状态合成显示 |
| `Browser()` | `core/runtime-stub:53` | — |
| `Call()` | `core/runtime-stub:15` | — |
| `CancellablePromise()` | `core/runtime-stub:16` | — |
| `Events()` | `core/runtime-stub:27` | — |
| `safeCall()` | `core/safe-call:22` | 安全执行同步函数；异常时记录 logWarn(tag, msg, err) 并返回 undefined。 |
| `safeCallAsync()` | `core/safe-call:46` | 安全执行异步函数；异常时记录 logWarn(tag, msg, err)，返回的 Promise 解析为 undefined（不 reject），等价于 &#96;promise.cat |
| `safeCallVoid()` | `core/safe-call:32` | 同 safeCall，但 fn 无返回值。 |
| `SceneActions()` | `core/scene-action-bridge:10` | — |
| `getSceneAction()` | `core/scene-action-bridge:188` | — |
| `registerSceneAction()` | `core/scene-action-bridge:173` | 注册单个场景操作（scene 侧启动时调用）。 |
| `createDefaultFeetState()` | `core/scene-state:51` | [doc:adr-085] 脚部地面跟随默认状态（Phase A 参数） |
| `focusedModelId()` | `core/scene-state:66` | — |
| `getMmdRuntimeType()` | `core/scene-state:25` | — |
| `mmdRuntime()` | `core/scene-state:15` | — |
| `modelRegistry()` | `core/scene-state:43` | — |
| `setFocusedModelId()` | `core/scene-state:67` | — |
| `setMmdRuntime()` | `core/scene-state:16` | — |
| `setMmdRuntimeType()` | `core/scene-state:33` | — |
| `setModelRegistry()` | `core/scene-state:44` | — |
| `setKey()` | `core/set-key:8` | 泛型键值写入工具，避免大量 &#96;obj[key] = value&#96; 重复。 |
| `registerAppShortcuts()` | `core/shortcut-app:18` | — |
| `KeyBindingOverride()` | `core/shortcut-registry:23` | — |
| `ShortcutDef()` | `core/shortcut-registry:9` | — |
| `ShortcutWithBinding()` | `core/shortcut-registry:47` | — |
| `_resetShortcutRegistry()` | `core/shortcut-registry:444` | Reset all internal state — only for use in tests. |
| `exportKeyBindings()` | `core/shortcut-registry:371` | Get current custom bindings (for saving to uiState). |
| `formatKeyBinding()` | `core/shortcut-registry:244` | 格式化按键绑定为可读字符串，如 "Ctrl+1"、"Shift+←" |
| `getAllShortcuts()` | `core/shortcut-registry:228` | Get all registered shortcuts with their CURRENT effective bindings. |
| `getAriaKeyshortcuts()` | `core/shortcut-registry:280` | 将 ShortcutDef 格式化为 aria-keyshortcuts 值，如 "Control+1" |
| `initShortcutDispatcher()` | `core/shortcut-registry:386` | Initialize the dispatcher — call once at app startup. |
| `loadKeyBindings()` | `core/shortcut-registry:363` | Load custom bindings from persisted state (call at app init). |
| `registerShortcut()` | `core/shortcut-registry:174` | Register ONE shortcut. |
| `registerShortcuts()` | `core/shortcut-registry:221` | Register MULTIPLE shortcuts at once. |
| `resetAllKeyBindings()` | `core/shortcut-registry:355` | Reset ALL shortcuts to their default bindings. |
| `resetKeyBinding()` | `core/shortcut-registry:348` | Reset one shortcut to its default binding. |
| `setKeyBinding()` | `core/shortcut-registry:307` | Set custom key binding for a shortcut ID. |
| `envState()` | `core/state:27` | — |
| `applyHudVisibility()` | `core/status-bar:31` | 按 uiState 开关应用顶部 HUD 显隐：帧率时钟（#fpsClock）与多线程徽标（#runtimeBadge）。 |
| `disposeStatusBar()` | `core/status-bar:117` | 清理 status 定时器（供 HMR 清理入口调用）。 |
| `hideHint()` | `core/status-bar:105` | — |
| `hideLoadingStatus()` | `core/status-bar:200` | 隐藏底部状态栏的旋转加载图标，不改变当前文本。 |
| `initHints()` | `core/status-bar:132` | — |
| `setLoadingStatus()` | `core/status-bar:189` | 在底部状态栏显示带旋转图标的加载文本，用于消解用户"卡住焦虑"。 |
| `setStatus()` | `core/status-bar:40` | — |
| `showHint()` | `core/status-bar:90` | — |
| `tryCatchStatus()` | `core/status-helpers:19` | Execute a function with automatic error handling that shows errors in the status bar. |
| `withLoadingStatus()` | `core/status-helpers:49` | 包装一个异步操作，自动管理 loading → success → error 三态状态栏。 |
| `withLoadingStatusTargeted()` | `core/status-helpers:80` | 包装异步操作并附带目标名（target-aware 版本）。 |
| `registerServiceWorker()` | `core/sw-register:11` | — |
| `TEST_MESH_PREFIX()` | `core/test-mesh:10` | — |
| `clearTestMeshes()` | `core/test-mesh:30` | 清除所有程序化测试 mesh。 |
| `createTestMesh()` | `core/test-mesh:13` | 创建程序化测试 mesh（先清理旧 e2e-test- 网格；与 dev-hooks driver 行为对齐）。 |
| `FONT_MAP()` | `core/theme:33` | — |
| `SETTINGS_FONT_RESTORE()` | `core/theme:48` | — |
| `generateTextColors()` | `core/theme:7` | — |
| `ToastAction()` | `core/toast:3` | — |
| `ToastVariant()` | `core/toast:8` | — |
| `_resetToastForTest()` | `core/toast:257` | — |
| `showErrorToast()` | `core/toast:237` | — |
| `showInfoToast()` | `core/toast:246` | — |
| `showToast()` | `core/toast:196` | — |
| `BoneOverrideEntry()` | `core/types:22` | [doc:adr-061] Motion Override — 持久化的单条骨骼覆盖配置 |
| `BrowseOutcome()` | `core/types:392` | — |
| `CameraBehavior()` | `core/types:602` | ADR-100 轴 B — 运动行为：相机如何自动运动，仅当控制轴为 &#96;orbit&#96;(ArcRotate) 时生效。 |
| `CameraControl()` | `core/types:590` | ADR-100 轴 A — 控制方案：决定相机类 + 输入方式。 |
| `CameraMode()` | `core/types:581` | 保留为兼容别名（存档 / 旧调用点），新代码请用 {@link CameraControl} × {@link CameraBehavior}。 |
| `DisplayNamePriority()` | `core/types:572` | — |
| `EnvState()` | `core/types:544` | 从 schema 派生 EnvState interface（-readonly 保证可写）。[doc:adr-137] |
| `FeetState()` | `core/types:91` | [doc:adr-085] 脚部地面跟随（按模型）状态 |
| `GoUIState()` | `core/types:17` | — |
| `LibraryModel()` | `core/types:319` | — |
| `LibrarySortMode()` | `core/types:611` | — |
| `MmdRuntimeBoneExtended()` | `core/types:552` | — |
| `MmdStandardMaterial()` | `core/types:620` | MmdStandardMaterial 扩展 — 用于材质系统和换装系统共享的类型定义 |
| `ModelInstance()` | `core/types:188` | — |
| `ModelKind()` | `core/types:113` | — |
| `ModelMotionSlots()` | `core/types:165` | [doc:adr-167] 单槽位：overlay 槽位已移除（ADR-144 废弃） |
| `MotionModuleState()` | `core/types:46` | [doc:adr-116] 模块语义状态（per-motion，随动作走） |
| `MotionPreset()` | `core/types:59` | [doc:adr-145] 动作预设 DTO |
| `MotionSlotConfig()` | `core/types:152` | 单个槽位的配置 |
| `MotionSource()` | `core/types:131` | 用户选择的「原始动作来源类型」——仅描述意图来源性质，不描述广播后的运行时产物。 |
| `OutfitFile()` | `core/types:312` | — |
| `OutfitSlot()` | `core/types:291` | — |
| `OutfitVariant()` | `core/types:301` | — |
| `OverridePaths()` | `core/types:561` | — |
| `OverrideType()` | `core/types:38` | 骨骼覆盖类型（着色/诊断共用枚举） |
| `ParamValue()` | `core/types:43` | [doc:adr-116] 动作覆盖模块语义参数值 |
| `PendingVmd()` | `core/types:559` | — |
| `PhysicsCategory()` | `core/types:574` | — |
| `PopupLevel()` | `core/types:404` | — |
| `PopupRow()` | `core/types:334` | — |
| `PresetModuleState()` | `core/types:53` | [doc:adr-145] 单模块在预设中的状态快照 |
| `ProcMotionConfig()` | `core/types:76` | [doc:adr-XX] 程序化动作配置（per-motion，随动作走） 参数存 SceneMotionIntent.procMotion（多角色共享）， 启用/分配权在每角色 |
| `ProcPreset()` | `core/types:80` | [audit] 程序化动作自定义预设（per-model 参数快照，仿 MotionPreset 模式）。 |
| `RecentMotion()` | `core/types:613` | — |
| `RuntimeModel()` | `core/types:176` | IMmdModel 接口不含 setRuntimeAnimation / createRuntimeAnimation （这两个方法在 MmdModel 和 MmdWasmMode |
| `SceneMotionIntent()` | `core/types:134` | 场景级动作意图（「场上在跳什么」） |
| `ScriptedSubMode()` | `core/types:609` | ADR-100 §6.4 — &#96;scripted&#96; 行为的子模式。 |
| `SlotSource()` | `core/types:149` | 槽位来源 |
| `UIState()` | `core/types:448` | — |
| `VmdLayer()` | `core/types:116` | VMD 动画图层 — 支持多 VMD 叠加（Motion Layers） |
| `UiActions()` | `core/ui-action-bridge:8` | — |
| `getUiAction()` | `core/ui-action-bridge:85` | 读取单个 UI 行为（core 侧调用；未注册返回 undefined） |
| `getUiActions()` | `core/ui-action-bridge:97` | 读取 UI 行为集（未完整注册时返回 null） |
| `registerUiAction()` | `core/ui-action-bridge:68` | 注册单个 UI 行为（menus 侧各模块启动时调用，可重复注册覆盖）。 |
| `unregisterUiAction()` | `core/ui-action-bridge:78` | 兼容旧调用点：按 key 注销（不区分注册实例，慎用；优先用 registerUiAction 返回的 token）。 |
| `addColorSliderRow()` | `core/ui-advanced-rows:17` | — |
| `addModeSlider()` | `core/ui-advanced-rows:318` | — |
| `addVector3SliderRow()` | `core/ui-advanced-rows:156` | — |
| `cardContainer()` | `core/ui-card:9` | Card container helper: removes render-card bg, wraps content in an lcard. |
| `addCollapsible()` | `core/ui-collapsible:23` | 通用折叠面板组件 |
| `addPresetChip()` | `core/ui-collapsible:163` | 创建一个 preset-chip 按钮并追加到 container（通常是 .preset-group div）。 |
| `addSectionTitle()` | `core/ui-collapsible:138` | 区块标题（section-title），用于 cardContainer 内的视觉分组。 |
| `AUTO_LINK_THRESHOLD_DEG()` | `core/ui-constants:18` | time-of-day 与 lighting 联动判定阈值（度） |
| `DEFAULT_GRAVITY()` | `core/ui-constants:14` | 默认重力（m/s²） |
| `ENV_LIGHT_MAX()` | `core/ui-constants:16` | 环境光强度上限 |
| `SCENE_EVENTS()` | `core/ui-constants:23` | 场景级事件字面量。使用此枚举替代散落的 'scene:xxx' 字面量。 |
| `SLIDER_QUARTER_LARGE_STEP()` | `core/ui-constants:7` | 左区大幅减步进：全范围 15% |
| `SLIDER_QUARTER_SMALL_STEP()` | `core/ui-constants:9` | 中左/中右微调步进：全范围 5% |
| `createFocusTrap()` | `core/ui-focus-trap:25` | — |
| `FullscreenOverlayHandle()` | `core/ui-fullscreen-overlay:28` | — |
| `FullscreenOverlayOptions()` | `core/ui-fullscreen-overlay:16` | — |
| `OverlayState()` | `core/ui-fullscreen-overlay:37` | — |
| `closeFullscreen()` | `core/ui-fullscreen-overlay:70` | — |
| `getCurrentState()` | `core/ui-fullscreen-overlay:95` | — |
| `openFullscreen()` | `core/ui-fullscreen-overlay:47` | — |
| `setCurrentState()` | `core/ui-fullscreen-overlay:99` | — |
| `HeaderToggleConfig()` | `core/ui-header-toggle:8` | — |
| `createHeaderToggle()` | `core/ui-header-toggle:26` | 创建标题栏小型开关。返回 &#96;&lt;label class="toggle header-toggle"&gt;&#96;， 含双触发去重（跳过 target===input 的 synthetic |
| `BoneSelectOptions()` | `core/ui-helpers:28` | — |
| `ControlOptions()` | `core/ui-helpers:4` | — |
| `FullscreenOverlayHandle()` | `core/ui-helpers:48` | — |
| `FullscreenOverlayOptions()` | `core/ui-helpers:48` | — |
| `HeaderToggleConfig()` | `core/ui-helpers:30` | — |
| `OverlayState()` | `core/ui-helpers:48` | — |
| `PresetChipItem()` | `core/ui-helpers:34` | — |
| `ResourceItem()` | `core/ui-helpers:36` | — |
| `ResourcePanelHandle()` | `core/ui-helpers:36` | — |
| `ResourcePanelOptions()` | `core/ui-helpers:36` | — |
| `SlideRowExtra()` | `core/ui-helpers:6` | — |
| `VirtualGridHandle()` | `core/ui-helpers:38` | — |
| `VirtualGridOptions()` | `core/ui-helpers:38` | — |
| `addActionRow()` | `core/ui-helpers:7` | — |
| `addBoneSelectRow()` | `core/ui-helpers:7` | — |
| `addCardTitle()` | `core/ui-helpers:7` | — |
| `addClearRow()` | `core/ui-helpers:33` | — |
| `addCollapsible()` | `core/ui-helpers:32` | — |
| `addColorSliderRow()` | `core/ui-helpers:31` | — |
| `addDangerRow()` | `core/ui-helpers:7` | — |
| `addDisabledRow()` | `core/ui-helpers:7` | — |
| `addEmptyRow()` | `core/ui-helpers:7` | — |
| `addFieldRow()` | `core/ui-helpers:7` | — |
| `addInfoCard()` | `core/ui-helpers:7` | — |
| `addInfoGrid()` | `core/ui-helpers:7` | — |
| `addInlineToggleRow()` | `core/ui-helpers:7` | — |
| `addModeRow()` | `core/ui-helpers:7` | — |
| `addModeSlider()` | `core/ui-helpers:31` | — |
| `addPresetChip()` | `core/ui-helpers:32` | — |
| `addSectionTitle()` | `core/ui-helpers:32` | — |
| `addSliderRow()` | `core/ui-helpers:7` | — |
| `addToggleRow()` | `core/ui-helpers:7` | — |
| `addVector3SliderRow()` | `core/ui-helpers:31` | — |
| `addWatchDirRow()` | `core/ui-helpers:7` | — |
| `buildBoneGroups()` | `core/ui-helpers:7` | — |
| `buildPresetChipGroup()` | `core/ui-helpers:33` | — |
| `cardContainer()` | `core/ui-helpers:40` | — |
| `closeFullscreen()` | `core/ui-helpers:42` | — |
| `createHeaderToggle()` | `core/ui-helpers:29` | — |
| `createIconButton()` | `core/ui-helpers:39` | — |
| `createResourcePanel()` | `core/ui-helpers:35` | — |
| `createVirtualGrid()` | `core/ui-helpers:37` | — |
| `getCurrentState()` | `core/ui-helpers:42` | — |
| `initControl()` | `core/ui-helpers:7` | — |
| `isIkBone()` | `core/ui-helpers:7` | — |
| `openFullscreen()` | `core/ui-helpers:42` | — |
| `setCurrentState()` | `core/ui-helpers:42` | — |
| `slideRow()` | `core/ui-helpers:5` | — |
| `sliderRow()` | `core/ui-helpers:7` | — |
| `toggleRow()` | `core/ui-helpers:7` | — |
| `withLoadingIndicator()` | `core/ui-helpers:41` | — |
| `KeyboardNavOptions()` | `core/ui-keyboard-nav:19` | — |
| `NavKeyKind()` | `core/ui-keyboard-nav:17` | 导航按键分类：垂直移动 / 水平移动，供 perKeySkip 差异化判断 |
| `createKeyboardNav()` | `core/ui-keyboard-nav:67` | — |
| `withLoadingIndicator()` | `core/ui-loading:20` | 加载指示器包裹器：显示 loading 遮罩 → 执行 fn → &#96;finally&#96; 隐藏。 |
| `NAV_ADJUST_ATTR()` | `core/ui-nav-item:17` | — |
| `NAV_FOCUS_ATTR()` | `core/ui-nav-item:16` | — |
| `NAV_GROUP_ATTR()` | `core/ui-nav-item:18` | — |
| `NAV_ITEM_ATTR()` | `core/ui-nav-item:15` | 导航项标记属性名 |
| `NAV_ITEM_SELECTOR()` | `core/ui-nav-item:21` | 方向键导航项统一选择器（panelItems 用） |
| `NavItemOptions()` | `core/ui-nav-item:23` | — |
| `markNavItem()` | `core/ui-nav-item:40` | 给一个行元素打上方向键导航项标记。控件工厂在创建行后调用一次即可， 无需再改 menu.ts。 |
| `navFocusTarget()` | `core/ui-nav-item:55` | 读取行的内部聚焦目标（缺省返回行本身） |
| `navGroupMove()` | `core/ui-nav-item:89` | 组内 ←→ 移动焦点：在 row 的组内子项间循环移动，返回是否处理了该键。 |
| `navGroupSelector()` | `core/ui-nav-item:81` | 读取组行的组内子项 selector（非组行返回 null） |
| `navHasHorizontalAdjust()` | `core/ui-nav-item:76` | 该行是否声明了 ←→ 水平调值（菜单应让位） |
| `PresetChipItem()` | `core/ui-preset:15` | 单个预设芯片的描述。 |
| `addClearRow()` | `core/ui-preset:72` | 渲染一行右对齐的「清除」按钮（统一 cs-btn cs-btn-sm 样式）。 |
| `buildPresetChipGroup()` | `core/ui-preset:34` | 渲染一组 preset-chip（统一 .preset-group 容器 + addPresetChip 布局）。 |
| `ResourceItem()` | `core/ui-resource-panel:34` | — |
| `ResourcePanelHandle()` | `core/ui-resource-panel:55` | — |
| `ResourcePanelOptions()` | `core/ui-resource-panel:17` | — |
| `createResourcePanel()` | `core/ui-resource-panel:71` | — |
| `notifyThumbnailUpdate()` | `core/ui-resource-panel:516` | — |
| `BoneSelectOptions()` | `core/ui-rows:744` | — |
| `addActionRow()` | `core/ui-rows:572` | 创建一个可点击的操作按钮行（替代手写 cs-row + button）。 |
| `addBoneSelectRow()` | `core/ui-rows:755` | 创建骨骼选择行：label + 搜索框 + 分组下拉（含 IK 标记）。 |
| `addCardTitle()` | `core/ui-rows:346` | 创建 card-title 标题行并追加到容器 |
| `addDangerRow()` | `core/ui-rows:361` | 创建危险操作行（icon + red label），替代手动拼接 &#96;div.slide-item &gt; icon + label.danger-text&#96; |
| `addDisabledRow()` | `core/ui-rows:609` | 创建一个不可交互的提示行（替代手写 cs-row + opacity 0.4 + pointer-events none）。 |
| `addEmptyRow()` | `core/ui-rows:323` | 创建空状态占位行（灰色文字，不可点击），替代手动 &#96;el.style.opacity = '0.5'&#96; 模式 |
| `addFieldRow()` | `core/ui-rows:393` | 创建字段行（左 label + 右 value），替代手动拼接的 &#96;div.slide-item &gt; span.slide-label.field-label + span.fie |
| `addInfoCard()` | `core/ui-rows:433` | — |
| `addInfoGrid()` | `core/ui-rows:426` | — |
| `addInlineToggleRow()` | `core/ui-rows:640` | 创建一个内联 toggle 行（替代手写 toggle-row + toggle-label + toggle-switch）。 |
| `addModeRow()` | `core/ui-rows:288` | — |
| `addSliderRow()` | `core/ui-rows:149` | 数字滑块行。ADR-140：内部统一由 {@link DragSliderController} 驱动 （拖拽 + 键盘 + 游标点击），行为与其他滑块 builder 保持一致。 |
| `addToggleRow()` | `core/ui-rows:23` | — |
| `addWatchDirRow()` | `core/ui-rows:508` | — |
| `buildBoneGroups()` | `core/ui-rows:715` | 按类别分组骨骼名，未匹配的归入「その他」。空组被剔除。 |
| `initControl()` | `core/ui-rows:114` | 封装 registerControl + immediate update 模式。 |
| `isIkBone()` | `core/ui-rows:689` | [doc:adr-122 P3] 判断骨骼是否为 IK 相关骨骼 |
| `sliderRow()` | `core/ui-rows:466` | — |
| `toggleRow()` | `core/ui-rows:483` | — |
| `HeaderToggleConfig()` | `core/ui-slide-row:9` | — |
| `SlideRowExtra()` | `core/ui-slide-row:67` | — |
| `TrailingAction()` | `core/ui-slide-row:11` | — |
| `createLeadingBtn()` | `core/ui-slide-row:63` | 统一左侧行为区按钮工厂——镜像 createTrailingBtn，但渲染为 21px 透明可点击 &#96;.slide-lead-btn&#96;（复用 .slide-icon 尺寸，非 22 |
| `createTrailingBtn()` | `core/ui-slide-row:54` | 统一尾部第二动作按钮工厂——供 slideRow 与 menu.ts createRow 共用， 确保两条渲染路径的第二按钮观感与行为一致（22px .slide-add-btn； |
| `slideRow()` | `core/ui-slide-row:96` | — |
| `DragSliderController()` | `core/ui-slider-controller:23` | — |
| `DragSliderOptions()` | `core/ui-slider-controller:8` | — |
| `activeTimeOfDayPreset()` | `core/ui-state:38` | 当前选中的 time-of-day 预设 key。预设芯片高亮唯一来源，env-menu 顶层与 sky 子菜单共享同一状态。 |
| `isAutoLoadCompanionAudioEnabled()` | `core/ui-state:45` | 加载 VMD 动作时自动发现并加载同目录同名音频（.mp3/.wav/.ogg/.flac）。默认开启。 |
| `popupOpen()` | `core/ui-state:10` | — |
| `setActiveTimeOfDayPreset()` | `core/ui-state:39` | — |
| `setPopupOpen()` | `core/ui-state:11` | — |
| `setUIPersistCallback()` | `core/ui-state:21` | — |
| `setUIState()` | `core/ui-state:25` | — |
| `uiState()` | `core/ui-state:17` | — |
| `ControlOptions()` | `core/ui-types:2` | 控件通用选项：支持 bind 自动更新或 onUpdate 手动更新 |
| `VirtualGridHandle()` | `core/ui-virtual-grid:21` | — |
| `VirtualGridOptions()` | `core/ui-virtual-grid:6` | — |
| `createVirtualGrid()` | `core/ui-virtual-grid:34` | — |
| `generateUuid()` | `core/uuid:8` | 生成 UUID v4 字符串（格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx）。 |
| `AddCustomSoftware()` | `core/wails-bindings:50` | — |
| `AddRecentModel()` | `core/wails-bindings:51` | — |
| `AddTag()` | `core/wails-bindings:52` | — |
| `BundleScene()` | `core/wails-bindings:53` | — |
| `CheckForUpdate()` | `core/wails-bindings:54` | — |
| `CleanOrphanCache()` | `core/wails-bindings:55` | — |
| `ClearAllCaches()` | `core/wails-bindings:56` | — |
| `ClearExtractCache()` | `core/wails-bindings:57` | — |
| `ClearThumbnailCache()` | `core/wails-bindings:58` | — |
| `ClosePlazaWindow()` | `core/wails-bindings:59` | — |
| `Config()` | `core/wails-bindings:14` | — |
| `DeleteEnvPreset()` | `core/wails-bindings:60` | — |
| `DeleteModelPreset()` | `core/wails-bindings:61` | — |
| `DeletePresetScene()` | `core/wails-bindings:62` | — |
| `DownloadAndRunInstaller()` | `core/wails-bindings:64` | — |
| `DownloadApk()` | `core/wails-bindings:63` | — |
| `DownloadFromPlaza()` | `core/wails-bindings:65` | — |
| `EnvPresetEntry()` | `core/wails-bindings:14` | — |
| `EnvState()` | `core/wails-bindings:14` | — |
| `Events()` | `core/wails-bindings:13` | — |
| `ExtractResult()` | `core/wails-bindings:14` | — |
| `ExtractZip()` | `core/wails-bindings:66` | — |
| `FetchPlazaConfig()` | `core/wails-bindings:67` | — |
| `FileExists()` | `core/wails-bindings:68` | — |
| `FileInfo()` | `core/wails-bindings:14` | — |
| `GetAllTags()` | `core/wails-bindings:69` | — |
| `GetBuildInfo()` | `core/wails-bindings:70` | — |
| `GetCacheStats()` | `core/wails-bindings:71` | — |
| `GetCachedPlazaConfig()` | `core/wails-bindings:72` | — |
| `GetConfig()` | `core/wails-bindings:73` | — |
| `GetDownloadAutoImport()` | `core/wails-bindings:74` | — |
| `GetDownloadWatchEnabled()` | `core/wails-bindings:75` | — |
| `GetDownloadWatchStatus()` | `core/wails-bindings:76` | — |
| `GetLastBrowseDir()` | `core/wails-bindings:77` | — |
| `GetLibraryIndex()` | `core/wails-bindings:78` | — |
| `GetModelMetaBatch()` | `core/wails-bindings:79` | — |
| `GetModelPresets()` | `core/wails-bindings:80` | — |
| `GetModelsByTag()` | `core/wails-bindings:81` | — |
| `GetPresetScenes()` | `core/wails-bindings:82` | — |
| `GetPresetScenesDir()` | `core/wails-bindings:83` | — |
| `GetRecentModels()` | `core/wails-bindings:84` | — |
| `GetRenderPresets()` | `core/wails-bindings:85` | — |
| `GetStorageMode()` | `core/wails-bindings:86` | — |
| `GetSystemA11ySettings()` | `core/wails-bindings:87` | — |
| `GetTagsByModel()` | `core/wails-bindings:88` | — |
| `GetThumbnail()` | `core/wails-bindings:89` | — |
| `ImportLocalFile()` | `core/wails-bindings:90` | — |
| `ImportZip()` | `core/wails-bindings:91` | — |
| `InstallResult()` | `core/wails-bindings:14` | — |
| `IsolateModelDir()` | `core/wails-bindings:92` | — |
| `LaunchSoftware()` | `core/wails-bindings:93` | — |
| `ListDirRecursive()` | `core/wails-bindings:94` | — |
| `ListEnvPresets()` | `core/wails-bindings:95` | — |
| `ListSubDirs()` | `core/wails-bindings:96` | — |
| `LoadEnvPreset()` | `core/wails-bindings:97` | — |
| `LoadLastScene()` | `core/wails-bindings:98` | — |
| `LoadModelPreset()` | `core/wails-bindings:99` | — |
| `LoadModelPresetFromLib()` | `core/wails-bindings:100` | — |
| `LoadOutfitFile()` | `core/wails-bindings:101` | — |
| `LoadSceneFile()` | `core/wails-bindings:102` | — |
| `ModelEntry()` | `core/wails-bindings:14` | — |
| `ModelMeta()` | `core/wails-bindings:14` | — |
| `ModelPresetEntry()` | `core/wails-bindings:14` | — |
| `NavigatePlazaWindow()` | `core/wails-bindings:103` | — |
| `OpenCacheDir()` | `core/wails-bindings:104` | — |
| `OpenScreenshotDir()` | `core/wails-bindings:105` | — |
| `OpenWithSoftware()` | `core/wails-bindings:106` | — |
| `PlazaGoBack()` | `core/wails-bindings:107` | — |
| `PlazaGoForward()` | `core/wails-bindings:108` | — |
| `PlazaReload()` | `core/wails-bindings:109` | — |
| `PlazaZoomIn()` | `core/wails-bindings:110` | — |
| `PlazaZoomOut()` | `core/wails-bindings:111` | — |
| `PlazaZoomReset()` | `core/wails-bindings:112` | — |
| `ReadTextFile()` | `core/wails-bindings:113` | — |
| `RemoveCustomSoftware()` | `core/wails-bindings:115` | — |
| `RemoveTag()` | `core/wails-bindings:116` | — |
| `RenderPreset()` | `core/wails-bindings:14` | — |
| `SaveEnvPresetAuto()` | `core/wails-bindings:117` | — |
| `SaveLastScene()` | `core/wails-bindings:118` | — |
| `SaveModelPreset()` | `core/wails-bindings:119` | — |
| `SaveModelPresetToLibAuto()` | `core/wails-bindings:120` | — |
| `SavePlazaConfig()` | `core/wails-bindings:121` | — |
| `SaveRenderPreset()` | `core/wails-bindings:122` | — |
| `SaveScenePreset()` | `core/wails-bindings:123` | — |
| `SaveScreenshot()` | `core/wails-bindings:124` | — |
| `SaveThumbnail()` | `core/wails-bindings:125` | — |
| `ScanModelDir()` | `core/wails-bindings:126` | — |
| `ScanSoftwareDir()` | `core/wails-bindings:127` | — |
| `SelectBundleSaveFile()` | `core/wails-bindings:128` | — |
| `SelectDir()` | `core/wails-bindings:129` | — |
| `SelectExeFile()` | `core/wails-bindings:130` | — |
| `SelectImportFile()` | `core/wails-bindings:131` | — |
| `SelectPresetOpenFile()` | `core/wails-bindings:132` | — |
| `SelectPresetSaveFile()` | `core/wails-bindings:133` | — |
| `SelectRetargetFile()` | `core/wails-bindings:134` | — |
| `SelectSceneOpenFile()` | `core/wails-bindings:135` | — |
| `SetBlenderPath()` | `core/wails-bindings:136` | — |
| `SetDisplayNamePriority()` | `core/wails-bindings:137` | — |
| `SetDownloadAutoImport()` | `core/wails-bindings:138` | — |
| `SetDownloadWatchDir()` | `core/wails-bindings:139` | — |
| `SetDownloadWatchEnabled()` | `core/wails-bindings:140` | — |
| `SetEnvState()` | `core/wails-bindings:141` | — |
| `SetLastBrowseDir()` | `core/wails-bindings:142` | — |
| `SetMMDPath()` | `core/wails-bindings:143` | — |
| `SetOverridePath()` | `core/wails-bindings:144` | — |
| `SetPerformanceMode()` | `core/wails-bindings:145` | — |
| `SetResourceRoot()` | `core/wails-bindings:146` | — |
| `SetStorageMode()` | `core/wails-bindings:147` | — |
| `SetUIAccent()` | `core/wails-bindings:148` | — |
| `SetUIAnimations()` | `core/wails-bindings:149` | — |
| `SetUIAutoUpdate()` | `core/wails-bindings:150` | — |
| `SetUIBlurBg()` | `core/wails-bindings:151` | — |
| `SetUIFontFamily()` | `core/wails-bindings:152` | — |
| `SetUIPopupWidth()` | `core/wails-bindings:153` | — |
| `SetUIScale()` | `core/wails-bindings:154` | — |
| `SetUIState()` | `core/wails-bindings:155` | — |
| `SoftwareEntry()` | `core/wails-bindings:14` | — |
| `StartFileServer()` | `core/wails-bindings:156` | — |
| `StartProxy()` | `core/wails-bindings:157` | — |
| `StopProxy()` | `core/wails-bindings:158` | — |
| `UIState()` | `core/wails-bindings:14` | — |
| `UpdateCheckResult()` | `core/wails-bindings:14` | — |
| `UpdateCustomSoftware()` | `core/wails-bindings:159` | — |
| `WriteTextFile()` | `core/wails-bindings:114` | — |
| `readFileBytes()` | `core/wails-bindings:44` | 读取文件为 Uint8Array（go：自动解码 Wails v3 base64；browser：IndexedDB/FSA 直读）。 |
| `getWindVector()` | `core/wind-utils:35` | 返回当前风矢量（方向 × 速度），风未生效时返回零向量。 |
| `isWindActive()` | `core/wind-utils:24` | 风向是否生效（windEnabled 且 windSpeed &gt; 0.01，过滤浮点噪声 / 滑条零位残留）。 |

## 3D 场景

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `CameraFacing()` | `scene/ar/ar-camera:13` | — |
| `captureARScreenshot()` | `scene/ar/ar-camera:248` | 截取 AR 合成画面（视频底 + 3D 模型层）。 |
| `getARFacing()` | `scene/ar/ar-camera:83` | — |
| `isARActive()` | `scene/ar/ar-camera:79` | — |
| `isARMirrored()` | `scene/ar/ar-camera:235` | 当前是否镜像显示。 |
| `setARMirror()` | `scene/ar/ar-camera:228` | 设置是否镜像显示（前置默认镜像，后置默认不镜像）。用户手动调用后标记为 overridden，切换摄像头时保持用户设置。 |
| `startARCamera()` | `scene/ar/ar-camera:92` | 启动 AR 摄像头并显示视频背景。 |
| `stopARCamera()` | `scene/ar/ar-camera:193` | 停止 AR 摄像头，释放资源并隐藏视频背景。 |
| `switchARCameraFacing()` | `scene/ar/ar-camera:215` | 切换前后摄像头。 |
| `isARModeActive()` | `scene/ar/ar-scene:244` | — |
| `setARMode()` | `scene/ar/ar-scene:162` | 切换 AR 模式（摄像头视频背景 + 透明 canvas）。 |
| `takeARScreenshot()` | `scene/ar/ar-scene:240` | AR 合成截图（视频底 + 3D 层），供截图功能调用。异步版（ADR-017 A2-04）。 |
| `VerdictInput()` | `scene/ar/ar-webxr-probe:185` | 综合结论判定输入。 |
| `WebXRProbeResult()` | `scene/ar/ar-webxr-probe:10` | — |
| `buildVerdict()` | `scene/ar/ar-webxr-probe:199` | 计算综合结论（纯函数，可独立测试）。 |
| `detectPlatform()` | `scene/ar/ar-webxr-probe:152` | 平台判定输入：UA 字符串 + 是否运行在 Wails 桌面壳（注入标识）。 |
| `formatProbeReport()` | `scene/ar/ar-webxr-probe:397` | 格式化探针结果为人类可读的多行文本（用于 UI 展示或复制到剪贴板）。 |
| `probeWebXR()` | `scene/ar/ar-webxr-probe:255` | 执行 WebXR 支持度探针（非侵入式，不请求 session）。 |
| `probeWebXRFeatures()` | `scene/ar/ar-webxr-probe:333` | 深度探针：实际创建 immersive-ar session 验证特性可用性。 |
| `getAutoCameraBeatsPerSwitch()` | `scene/camera/camera-auto:141` | — |
| `isAutoCameraEnabled()` | `scene/camera/camera-auto:130` | — |
| `restoreAutoCameraState()` | `scene/camera/camera-auto:92` | 从 UIState 恢复自动机位状态。ADR-100 P2：恢复时集中订阅并派生 beatcut 行为，修复饥饿。 |
| `setAutoCameraBeatsPerSwitch()` | `scene/camera/camera-auto:135` | 设置每多少拍切换一次镜头。 |
| `setAutoCameraEnabled()` | `scene/camera/camera-auto:106` | 设置 Auto Camera（beatcut）开关。ADR-100 P2：启用时集中订阅 beat、派生 beatcut 行为； 禁用时移除订阅并回落基底行为。beatDetect |
| `setSyncAxesCallback()` | `scene/camera/camera-auto:59` | camera.ts 启动时注入 _syncAxesFromMode 回调。 |
| `initFreeflyTouch()` | `scene/camera/camera-behaviors:96` | — |
| `initFreeflyUpdate()` | `scene/camera/camera-behaviors:42` | — |
| `initOrbitUpdate()` | `scene/camera/camera-behaviors:194` | — |
| `startConcert()` | `scene/camera/camera-behaviors:308` | — |
| `startSurround()` | `scene/camera/camera-behaviors:266` | — |
| `stopConcert()` | `scene/camera/camera-behaviors:345` | — |
| `stopFreefly()` | `scene/camera/camera-behaviors:168` | — |
| `stopOrbit()` | `scene/camera/camera-behaviors:252` | — |
| `stopSurround()` | `scene/camera/camera-behaviors:300` | — |
| `getBoneLockDamping()` | `scene/camera/camera-bone-lock:52` | 获取骨骼锁定跟随阻尼（0 = 刚性，越大越平滑）。 |
| `getFocusedModelBoneNames()` | `scene/camera/camera-bone-lock:62` | 获取当前焦点模型的所有骨骼名称列表。 |
| `getOrbitBoneLock()` | `scene/camera/camera-bone-lock:47` | 获取当前骨骼锁定状态。 |
| `restoreBoneLockIfEnabled()` | `scene/camera/camera-bone-lock:84` | 切回 orbit 时由 camera.ts switchCameraMode 调用：若骨骼锁仍处于启用状态， 重启每帧跟随 observer。修复"切出 orbit → stopB |
| `setBoneLockDamping()` | `scene/camera/camera-bone-lock:57` | 设置骨骼锁定跟随阻尼，范围 [0, 0.95]。 |
| `setOrbitBoneLock()` | `scene/camera/camera-bone-lock:32` | 启用/禁用轨道相机骨骼锁定。启用后相机 target 每帧锁定到指定骨骼的世界位置。 |
| `stopBoneLock()` | `scene/camera/camera-bone-lock:72` | 供 camera.ts switchCameraMode 切出 orbit 时调用，强制停止骨骼锁定（保留启用状态供切回恢复）。 |
| `applyCameraUserSettings()` | `scene/camera/camera-factory:54` | 将用户灵敏度设置应用到相机实例（orbit/oneshot: ArcRotate；freefly: Universal） |
| `createConcertCamera()` | `scene/camera/camera-factory:167` | Concert (fan-cam): limited horizontal sweep + sinusoidal vertical bob around the target. |
| `createFreeflyCamera()` | `scene/camera/camera-factory:129` | — |
| `createOneshotCamera()` | `scene/camera/camera-factory:187` | — |
| `createOrbitCamera()` | `scene/camera/camera-factory:95` | — |
| `createSurroundCamera()` | `scene/camera/camera-factory:146` | — |
| `disposeViewMatrixHandle()` | `scene/camera/camera-factory:216` | 显式 dispose 当前 viewMatrix observer（switchCameraMode 切换相机时调用）。 |
| `refreshCameraUserSettings()` | `scene/camera/camera-factory:67` | 设置变更后重新应用到当前活动相机 |
| `setSchedulePersistCallback()` | `scene/camera/camera-factory:40` | camera.ts 启动时注入 scheduleCameraPersist 回调。 |
| `CAMERA_MODES()` | `scene/camera/camera-state:22` | [audit:P3] CameraMode 合法值全集（运行时校验用，与类型定义同源维护）。 |
| `CameraBehavior()` | `scene/camera/camera-state:42` | ADR-100 轴 B — 运动行为（仅对 orbit/ArcRotate 生效，初版互斥）。双写于 &#96;core/types.ts&#96;。 |
| `CameraControl()` | `scene/camera/camera-state:39` | ADR-100 轴 A — 控制方案（相机类 + 输入）。双写于 &#96;core/types.ts&#96;。 |
| `CameraMode()` | `scene/camera/camera-state:18` | 新代码请用 {@link CameraControl} × {@link CameraBehavior}。双写于 &#96;core/types.ts&#96;。 |
| `CameraPreset()` | `scene/camera/camera-state:83` | Per-mode parameter bundle, persisted with scene files. |
| `ConcertParams()` | `scene/camera/camera-state:72` | Concert (fan-cam) camera parameters — limited horizontal sweep + sinusoidal vertical bob. |
| `FreeflyParams()` | `scene/camera/camera-state:59` | Freefly camera parameters. |
| `OrbitParams()` | `scene/camera/camera-state:52` | Orbit camera parameters. |
| `ScriptedSubMode()` | `scene/camera/camera-state:45` | ADR-100 §6.4 — scripted 行为子态。 |
| `SurroundParams()` | `scene/camera/camera-state:65` | Surround (turntable) camera parameters — automatic full-circle orbit around target. |
| `clearCameraVmdState()` | `scene/camera/camera-state:280` | — |
| `defaultCameraPreset()` | `scene/camera/camera-state:130` | — |
| `getAutoCameraBeatCount()` | `scene/camera/camera-state:295` | — |
| `getAutoCameraPresetIdx()` | `scene/camera/camera-state:303` | — |
| `getCameraBehavior()` | `scene/camera/camera-state:189` | — |
| `getCameraCanvas()` | `scene/camera/camera-state:338` | — |
| `getCameraControl()` | `scene/camera/camera-state:185` | — |
| `getCameraMode()` | `scene/camera/camera-state:181` | — |
| `getCameraPreset()` | `scene/camera/camera-state:150` | — |
| `getCameraScene()` | `scene/camera/camera-state:330` | — |
| `getCameraVmdName()` | `scene/camera/camera-state:263` | — |
| `getCameraVmdPath()` | `scene/camera/camera-state:267` | — |
| `getConcertParams()` | `scene/camera/camera-state:168` | — |
| `getConcertPaused()` | `scene/camera/camera-state:245` | — |
| `getCurrentCamera()` | `scene/camera/camera-state:225` | — |
| `getFocusCenterY()` | `scene/camera/camera-state:235` | — |
| `getFov()` | `scene/camera/camera-state:215` | — |
| `getFreeflyParams()` | `scene/camera/camera-state:164` | — |
| `getOrbitParams()` | `scene/camera/camera-state:160` | — |
| `getPreviousMode()` | `scene/camera/camera-state:346` | — |
| `getScriptedSubMode()` | `scene/camera/camera-state:193` | — |
| `getSurroundParams()` | `scene/camera/camera-state:172` | — |
| `getSurroundPaused()` | `scene/camera/camera-state:253` | — |
| `getViewMatrixHandle()` | `scene/camera/camera-state:354` | — |
| `hasCameraVmd()` | `scene/camera/camera-state:271` | — |
| `isAutoCameraEnabled()` | `scene/camera/camera-state:287` | — |
| `isCameraMode()` | `scene/camera/camera-state:34` | [audit:P3] 类型守卫：任意 string 是否为合法 CameraMode（桥接入口 / 反序列化用）。 |
| `isTouchDevice()` | `scene/camera/camera-state:313` | — |
| `resetCameraState()` | `scene/camera/camera-state:370` | [fix P2] 重置相机单例状态（HMR / disposeCameraSystem 时调用）。 |
| `setAutoCameraBeatCount()` | `scene/camera/camera-state:299` | — |
| `setAutoCameraEnabledFlag()` | `scene/camera/camera-state:291` | — |
| `setAutoCameraPresetIdx()` | `scene/camera/camera-state:307` | — |
| `setCameraBehavior()` | `scene/camera/camera-state:205` | — |
| `setCameraCanvas()` | `scene/camera/camera-state:342` | — |
| `setCameraControl()` | `scene/camera/camera-state:201` | — |
| `setCameraMode()` | `scene/camera/camera-state:197` | — |
| `setCameraPreset()` | `scene/camera/camera-state:154` | — |
| `setCameraScene()` | `scene/camera/camera-state:334` | — |
| `setCameraVmdState()` | `scene/camera/camera-state:275` | — |
| `setConcertPaused()` | `scene/camera/camera-state:249` | — |
| `setCurrentCamera()` | `scene/camera/camera-state:229` | — |
| `setFocusCenterY()` | `scene/camera/camera-state:239` | — |
| `setFov()` | `scene/camera/camera-state:219` | — |
| `setPreviousMode()` | `scene/camera/camera-state:350` | — |
| `setScriptedSubMode()` | `scene/camera/camera-state:209` | — |
| `setSurroundPaused()` | `scene/camera/camera-state:257` | — |
| `setViewMatrixHandle()` | `scene/camera/camera-state:358` | — |
| `animateCameraVmd()` | `scene/camera/camera-vmd:93` | Animate the VMD camera to a given 30fps frame time. |
| `clearCameraVmd()` | `scene/camera/camera-vmd:73` | — |
| `createVmdCamera()` | `scene/camera/camera-vmd:100` | 创建 VMD 相机（若已存在且未销毁则复用）。供 camera.ts switchCameraMode 在 vmd 分支使用。 |
| `hasCameraAnimationHandle()` | `scene/camera/camera-vmd:119` | VMD 相机动画句柄是否就绪（switchCameraMode 在 vmd 分支前置检查）。 |
| `loadCameraVmd()` | `scene/camera/camera-vmd:37` | Load camera animation from a VMD (MmdAnimation) and create an MmdCamera. |
| `setSwitchCameraModeCallback()` | `scene/camera/camera-vmd:32` | camera.ts 启动时注入 switchCameraMode 回调。 |
| `CameraBehavior()` | `scene/camera/camera:319` | — |
| `CameraControl()` | `scene/camera/camera:297` | — |
| `CameraMode()` | `scene/camera/camera:270` | — |
| `CameraPreset()` | `scene/camera/camera:813` | — |
| `CameraState()` | `scene/camera/camera:602` | — |
| `ConcertParams()` | `scene/camera/camera:210` | — |
| `FreeflyParams()` | `scene/camera/camera:197` | — |
| `LEGACY_MODE_MAP()` | `scene/camera/camera:110` | ADR-100 §6.1 — 旧模式 → 双轴映射（迁移 / shim 共用）。 |
| `OrbitParams()` | `scene/camera/camera:170` | — |
| `ScriptedSubMode()` | `scene/camera/camera:813` | — |
| `SurroundParams()` | `scene/camera/camera:214` | — |
| `_syncAxesFromMode()` | `scene/camera/camera:270` | ADR-100：由旧 mode 派生双轴状态。switchCameraMode 提交 _cameraMode 时同步调用，作为唯一写入点。 |
| `animateCameraVmd()` | `scene/camera/camera:845` | — |
| `autoFrame()` | `scene/camera/camera:578` | Auto-frame the camera to centre on a bounding box. |
| `clearCameraVmd()` | `scene/camera/camera:845` | — |
| `defaultCameraPreset()` | `scene/camera/camera:844` | — |
| `deriveLegacyMode()` | `scene/camera/camera:128` | ADR-100 §6.2 — 双轴 → 旧模式反查（getCameraState 降级双写 / shim 内部路由）。 |
| `disposeCameraSystem()` | `scene/camera/camera:782` | 顶层销毁相机系统（HMR / 页面卸载 / scene 销毁时调用）。幂等。 |
| `getAutoCameraBeatsPerSwitch()` | `scene/camera/camera:854` | — |
| `getBoneLockDamping()` | `scene/camera/camera:847` | — |
| `getCameraBehavior()` | `scene/camera/camera:824` | — |
| `getCameraControl()` | `scene/camera/camera:824` | — |
| `getCameraMode()` | `scene/camera/camera:824` | — |
| `getCameraState()` | `scene/camera/camera:623` | — |
| `getCameraVmdName()` | `scene/camera/camera:824` | — |
| `getCameraVmdPath()` | `scene/camera/camera:824` | — |
| `getConcertParams()` | `scene/camera/camera:824` | — |
| `getConcertPaused()` | `scene/camera/camera:824` | — |
| `getCurrentCamera()` | `scene/camera/camera:824` | — |
| `getFocusedModelBoneNames()` | `scene/camera/camera:847` | — |
| `getFov()` | `scene/camera/camera:824` | — |
| `getFreeflyParams()` | `scene/camera/camera:824` | — |
| `getOrbitBoneLock()` | `scene/camera/camera:847` | — |
| `getOrbitParams()` | `scene/camera/camera:824` | — |
| `getScriptedSubMode()` | `scene/camera/camera:824` | — |
| `getSurroundParams()` | `scene/camera/camera:824` | — |
| `getSurroundPaused()` | `scene/camera/camera:824` | — |
| `hasCameraVmd()` | `scene/camera/camera:824` | — |
| `initCameraSystem()` | `scene/camera/camera:352` | Initialise the camera system and create the default Orbit camera. |
| `isAutoCameraEnabled()` | `scene/camera/camera:861` | — |
| `loadCameraVmd()` | `scene/camera/camera:845` | — |
| `logCameraAlpha()` | `scene/camera/camera:188` | Log current camera alpha for diagnostics. |
| `refreshCameraUserSettings()` | `scene/camera/camera:846` | — |
| `restoreAutoCameraState()` | `scene/camera/camera:854` | — |
| `setAutoCameraBeatsPerSwitch()` | `scene/camera/camera:854` | — |
| `setAutoCameraEnabled()` | `scene/camera/camera:861` | — |
| `setBoneLockDamping()` | `scene/camera/camera:847` | — |
| `setCameraBehavior()` | `scene/camera/camera:319` | ADR-100 P4 — 直接设置运动行为轴（轴 B，仅 orbit 有效）。 |
| `setCameraControl()` | `scene/camera/camera:297` | ADR-100 P4 — 直接设置控制方案轴（轴 A）。 |
| `setCameraPreset()` | `scene/camera/camera:844` | — |
| `setCameraState()` | `scene/camera/camera:653` | — |
| `setConcertParams()` | `scene/camera/camera:210` | — |
| `setConcertPaused()` | `scene/camera/camera:824` | — |
| `setFov()` | `scene/camera/camera:342` | — |
| `setFreeflyParams()` | `scene/camera/camera:197` | — |
| `setOrbitBoneLock()` | `scene/camera/camera:847` | — |
| `setOrbitParams()` | `scene/camera/camera:170` | — |
| `setSurroundParams()` | `scene/camera/camera:214` | — |
| `setSurroundPaused()` | `scene/camera/camera:824` | — |
| `setSyncAxesCallback()` | `scene/camera/camera:861` | — |
| `switchCameraMode()` | `scene/camera/camera:373` | Switch to a different camera mode, preserving position as much as possible. |
| `InvertableArcRotateCameraPointersInput()` | `scene/camera/invertablePointersInput:13` | 可反转 Y 轴的 ArcRotate 相机指针输入。 |
| `applyEnvStateFacade()` | `scene/env/_bridge/env-bridge:50` | 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。 |
| `registerEnvStateMiddleware()` | `scene/env/_bridge/env-bridge:387` | 注册 setEnvState 中间件（供 env-time-of-day/env-gravity 等子模块调用）。 |
| `setEnvState()` | `scene/env/_bridge/env-bridge:327` | 环境状态唯一写入入口（ADR-173 中间件链），可选跳过自动保存。 |
| `setPresetAnimActive()` | `scene/env/_bridge/env-bridge:44` | 标记预设动画是否运行中（供 _applyEnvStateFacade 跳过方向光同步） |
| `clearAllEnvCallbacks()` | `scene/env/_bridge/env-dispatcher:33` | 清空所有已注册的 env 回调（场景销毁 / HMR 重入时兜底清理）。 |
| `clearEnvDtTickCallbacks()` | `scene/env/_bridge/env-dispatcher:93` | 清空所有 dt 回调（场景销毁 / HMR 重入时清理）。 |
| `clearSceneTickCallbacks()` | `scene/env/_bridge/env-dispatcher:62` | 清空所有场景 tick 回调（场景销毁 / HMR 重入时清理）。 |
| `dispatchEnvChange()` | `scene/env/_bridge/env-dispatcher:40` | setEnvState 调用此函数分发变化。 |
| `registerEnvCallback()` | `scene/env/_bridge/env-dispatcher:25` | 子系统注册响应回调（延迟绑定，避免循环导入）。 |
| `registerEnvDtTickCallback()` | `scene/env/_bridge/env-dispatcher:85` | 注册每帧 dt 回调（env-impl 每帧推 dt）。 |
| `registerSceneTickCallback()` | `scene/env/_bridge/env-dispatcher:56` | 注册场景每帧 tick 回调。返回的清理函数在 dispose 时调用。 |
| `runEnvDtTickCallbacks()` | `scene/env/_bridge/env-dispatcher:98` | 执行所有 dt tick 回调（由 ensureEnvUpdateObserver 推 dt）。 |
| `runSceneTickCallbacks()` | `scene/env/_bridge/env-dispatcher:68` | 执行所有已注册的场景 tick 回调（由 ensureEnvUpdateObserver 的 scene observer 每帧调用）。 |
| `cancelEnvPersistTimer()` | `scene/env/_bridge/env-persist:42` | 取消挂起的 env state 防抖持久化定时器（HMR 重入清理用，见 ADR-106 D3）。 |
| `flushEnvState()` | `scene/env/_bridge/env-persist:27` | 立即刷写 env state 到后端（无防抖）。关闭/隐藏页面时调用。 |
| `flushUIState()` | `scene/env/_bridge/env-persist:96` | 立即刷写 UI state 到后端（无防抖）。关闭/隐藏页面时调用。 |
| `persistEnvState()` | `scene/env/_bridge/env-persist:20` | 持久化 envState 到后端（ADR-176 第 2 步：经 resolveBackend 路由）。 |
| `persistUIState()` | `scene/env/_bridge/env-persist:89` | 与 persistEnvState 对称：持久化 UI state（ADR-176 第 2 步：经 resolveBackend 路由）。 |
| `schedulePersistEnvState()` | `scene/env/_bridge/env-persist:47` | 调度 env state 防抖持久化（500ms）。setEnvState 内部调用。 |
| `schedulePersistUI()` | `scene/env/_bridge/env-persist:78` | 防抖调度 UIState 持久化。修改 uiState 后调用此函数。 |
| `INFINITE_GROUND_SIZE()` | `scene/env/_shared/env-context:55` | — |
| `_envSys()` | `scene/env/_shared/env-context:82` | — |
| `effectiveGroundSize()` | `scene/env/_shared/env-context:61` | 当前生效的地面尺寸：开启无限地面时为固定大尺寸，否则为 groundSize。 |
| `getPipeline()` | `scene/env/_shared/env-context:44` | — |
| `getScene()` | `scene/env/_shared/env-context:33` | 取当前 Babylon 场景；未初始化时抛错（env 子系统内部使用）。 |
| `initEnvImpl()` | `scene/env/_shared/env-context:19` | — |
| `isInitialized()` | `scene/env/_shared/env-context:40` | — |
| `resetEnvContext()` | `scene/env/_shared/env-context:27` | [fix P2] 复位共享上下文引用：disposeEnvUpdateObserver 末尾调用，使 isInitialized() 在 dispose 后返回 false——否则 |
| `resolveStaticAsset()` | `scene/env/_shared/env-context:66` | — |
| `CanvasTextureOptions()` | `scene/env/_shared/env-texture:9` | — |
| `createCanvasDataURL()` | `scene/env/_shared/env-texture:170` | 统一创建 canvas 并导出 data URL（供 CreateGroundFromHeightMap 等以 URL 为输入的场景， 与 createCanvasTexture |
| `createCanvasTexture()` | `scene/env/_shared/env-texture:42` | 统一创建 canvas 贴图。优先 DynamicTexture（无 toDataURL PNG 编码开销，ADR-091 §6 方向）； 任意环节失败（含 NullEngine |
| `disposeTextureCache()` | `scene/env/_shared/env-texture:152` | 释放全部缓存贴图（供 disposeEnv 统一清理）。 |
| `getOrCreateCanvasTexture()` | `scene/env/_shared/env-texture:123` | 按 key 获取或创建 canvas 贴图。key 不变则复用；调用方不应手动 dispose 缓存贴图 （统一由 disposeTextureCache 在 disposeEnv |
| `isCacheOwnedTexture()` | `scene/env/_shared/env-texture:147` | 判断贴图是否归缓存所有——是则调用方不得手动 dispose（由 disposeTextureCache 统一释放）。 |
| `FrozenCamera()` | `scene/env/_shared/env-type-helpers:18` | — |
| `REFRESHRATE_RENDER_ONCE()` | `scene/env/_shared/env-type-helpers:14` | — |
| `getCanvasCtx()` | `scene/env/_shared/env-type-helpers:8` | — |
| `CAUSTIC_WORLD_SCALE()` | `scene/env/env-caustics:26` | — |
| `CausticsHostMat()` | `scene/env/env-caustics:178` | 类型守卫：材质是否支持 emissiveTexture（用于焦散投影） |
| `CausticsScrollConfig()` | `scene/env/env-caustics:90` | 焦散滚动配置（用户可通过 state.causticScrollX/Y 覆盖） |
| `causticsController()` | `scene/env/env-caustics:175` | — |
| `isCausticsHost()` | `scene/env/env-caustics:180` | — |
| `FRAG_SRC()` | `scene/env/env-clouds:344` | — |
| `buildJitterSource()` | `scene/env/env-clouds:237` | 根据 useBlueNoise 选择 jitter 代码路径（模板注入） |
| `createClouds()` | `scene/env/env-clouds:587` | — |
| `disposeClouds()` | `scene/env/env-clouds:806` | — |
| `resolveCloudShaderParams()` | `scene/env/env-clouds:225` | 按质量档派生 shader 注入参数： - high: 200 步主 march + 2 步光照 march + blue-noise jitter - standard: 96 |
| `getBodyCollisionEnabled()` | `scene/env/env-collision:33` | — |
| `getCollisionEnabled()` | `scene/env/env-collision:24` | — |
| `getGroundCollisionEnabled()` | `scene/env/env-collision:46` | — |
| `setBodyCollisionEnabled()` | `scene/env/env-collision:28` | — |
| `setCollisionEnabled()` | `scene/env/env-collision:19` | — |
| `setGroundCollisionEnabled()` | `scene/env/env-collision:37` | — |
| `getGravityStrength()` | `scene/env/env-gravity:30` | — |
| `setGravityStrength()` | `scene/env/env-gravity:18` | — |
| `GROUND_PRESETS()` | `scene/env/env-ground-presets:55` | — |
| `GROUND_PRESET_KEYS()` | `scene/env/env-ground-presets:310` | 预设「关心」的 EnvState 字段集合（单一真相源）。 |
| `GroundPreset()` | `scene/env/env-ground-presets:9` | — |
| `GroundProceduralKind()` | `scene/env/env-ground-presets:7` | 程序化地面纹理类型 |
| `buildGroundPresetEnvState()` | `scene/env/env-ground-presets:344` | 预设 → EnvState 字段映射，供 UI chip handler 调用并持久化。 |
| `GroundAppearanceSpec()` | `scene/env/env-ground-spec:91` | 外观性字段：可增量 mutate，不触发重建。 |
| `GroundGeometryKind()` | `scene/env/env-ground-spec:59` | — |
| `GroundMaterialSpec()` | `scene/env/env-ground-spec:114` | — |
| `GroundSourceKind()` | `scene/env/env-ground-spec:60` | — |
| `GroundStructuralSpec()` | `scene/env/env-ground-spec:63` | 结构性字段：任一变化都要求重建几何/材质（取代手拼 typeKey 的判别符集合）。 |
| `applyGroundMaterialSpec()` | `scene/env/env-ground-spec:278` | 统一「填材质」逻辑。 |
| `buildGroundMaterialSpec()` | `scene/env/env-ground-spec:124` | 由 EnvState 派生完整 Spec。新增材质相关字段只需在此赋值，specKey 自动纳入。 |
| `createGroundMeshFromSpec()` | `scene/env/env-ground-spec:390` | 创建地面 mesh 并落好材质。Phase 1 已接入：applyGround 非 terrain 重建路径调用本函数。 |
| `groundSpecNeedsRebuild()` | `scene/env/env-ground-spec:262` | diffSpec 的结构性结论：是否需要重建。 |
| `specKey()` | `scene/env/env-ground-spec:215` | 稳定 key：仅序列化结构性字段。新增结构性字段自动纳入，无遗漏风险。 |
| `GROUND_PRESETS()` | `scene/env/env-ground:1386` | — |
| `GroundMat()` | `scene/env/env-ground:52` | — |
| `GroundPreset()` | `scene/env/env-ground:1385` | — |
| `GroundProceduralKind()` | `scene/env/env-ground:169` | — |
| `INFINITE_GROUND_SIZE()` | `scene/env/env-ground:571` | — |
| `_disableGroundRippleTexture()` | `scene/env/env-ground:611` | — |
| `_effectiveBumpLevel()` | `scene/env/env-ground:129` | ADR-114 Phase 2: 法线扭曲映射到 bumpTexture.level 增强（distort=1 时额外 +2.0）；低质量模式自动关闭 |
| `_effectiveRoughness()` | `scene/env/env-ground:120` | ADR-114 Phase 2: 反射模糊映射到 roughness 偏移（blur=1 最多增加 0.4）；低质量模式自动关闭 |
| `_generateGroundTexture()` | `scene/env/env-ground:974` | — |
| `_getAlbedoColor()` | `scene/env/env-ground:103` | — |
| `_getAlbedoTex()` | `scene/env/env-ground:90` | — |
| `_needAlphaBlend()` | `scene/env/env-ground:160` | 判断地面是否需要 alpha blend 渲染（alpha &lt; 1 或边缘淡出）。 |
| `_setAlbedoColor()` | `scene/env/env-ground:109` | — |
| `_setAlbedoTex()` | `scene/env/env-ground:96` | — |
| `_syncAllTextureOffsets()` | `scene/env/env-ground:1190` | — |
| `_syncGroundEmissive()` | `scene/env/env-ground:1136` | [doc:adr-230] 自发光地屏增量同步：复用 Babylon 内置 emissiveColor/emissiveTexture 通道， 不引入新材质体系。es=0 / 黑 |
| `_syncGroundNormalTexture()` | `scene/env/env-ground:1218` | — |
| `_syncGroundRippleTexture()` | `scene/env/env-ground:595` | — |
| `_syncPbrProperties()` | `scene/env/env-ground:1240` | PBR 增量更新：roughness / metallic / 程序化纹理无需重建材质的属性 |
| `_syncTextureGroundTexture()` | `scene/env/env-ground:1058` | — |
| `_updateGroundTexture()` | `scene/env/env-ground:1205` | — |
| `applyGround()` | `scene/env/env-ground:1257` | — |
| `applyGroundEdgeFade()` | `scene/env/env-ground:1125` | — |
| `buildGroundPresetEnvState()` | `scene/env/env-ground:1386` | — |
| `buildGroundReflection()` | `scene/env/env-ground:727` | — |
| `clearGroundTexCache()` | `scene/env/env-ground:628` | — |
| `createGroundMaterial()` | `scene/env/env-ground:137` | — |
| `disposeGround()` | `scene/env/env-ground:1389` | 释放地面网格、材质与反射资源（幂等）。 |
| `generateProceduralGroundTextures()` | `scene/env/env-ground:462` | — |
| `getGroundHeightAt()` | `scene/env/env-ground:760` | — |
| `setGroundActualSize()` | `scene/env/env-ground:822` | — |
| `setGroundMesh()` | `scene/env/env-ground:818` | ADR-226: 供 env-ground-spec.ts 在建地面后同步模块局部状态（_envSys.ground.mesh / _groundActualSize）。 |
| `setOnGroundChanged()` | `scene/env/env-ground:826` | — |
| `setOnTerrainReady()` | `scene/env/env-ground:808` | — |
| `tickGround()` | `scene/env/env-ground:1321` | — |
| `triggerTerrainReady()` | `scene/env/env-ground:813` | ADR-226: 供 env-ground-spec.ts 的地形 onReady 回调触发已注册监听（避免直接访问模块局部 _onTerrainReady）。 |
| `_envSys()` | `scene/env/env-impl:20` | — |
| `addGroundRipple()` | `scene/env/env-impl:23` | — |
| `addRipple()` | `scene/env/env-impl:23` | — |
| `applyFog()` | `scene/env/env-impl:240` | — |
| `applyGround()` | `scene/env/env-impl:47` | — |
| `applySky()` | `scene/env/env-impl:43` | — |
| `clearGroundRipples()` | `scene/env/env-impl:23` | — |
| `clearRipples()` | `scene/env/env-impl:23` | — |
| `createClouds()` | `scene/env/env-impl:34` | — |
| `createParticleEmitter()` | `scene/env/env-impl:69` | — |
| `createWater()` | `scene/env/env-impl:23` | — |
| `disposeClouds()` | `scene/env/env-impl:34` | — |
| `disposeEnvUpdateObserver()` | `scene/env/env-impl:197` | — |
| `disposeParticles()` | `scene/env/env-impl:69` | — |
| `disposeWater()` | `scene/env/env-impl:23` | — |
| `ensureEnvUpdateObserver()` | `scene/env/env-impl:125` | — |
| `getGroundHeightAt()` | `scene/env/env-impl:47` | — |
| `getScene()` | `scene/env/env-impl:20` | — |
| `initEnvImpl()` | `scene/env/env-impl:75` | — |
| `refreshWaterRenderList()` | `scene/env/env-impl:23` | — |
| `registerSceneTickCallback()` | `scene/env/env-impl:72` | — |
| `setOnGroundChanged()` | `scene/env/env-impl:47` | — |
| `setOnTerrainReady()` | `scene/env/env-impl:47` | — |
| `updateParticleTexture()` | `scene/env/env-impl:69` | — |
| `updateParticleWind()` | `scene/env/env-impl:69` | — |
| `updateWaterAnimSpeed()` | `scene/env/env-impl:23` | — |
| `CategorizedEnvPreset()` | `scene/env/env-lighting:287` | 分类预设（version 3 格式）。 |
| `DerivedLighting()` | `scene/env/env-lighting:37` | — |
| `ENV_PRESET_FIELDS()` | `scene/env/env-lighting:166` | 各类别包含的 EnvState 字段白名单。未列入的字段（如 collision*）不参与任何预设。 |
| `EnvPreset()` | `scene/env/env-lighting:29` | — |
| `EnvPresetCategory()` | `scene/env/env-lighting:155` | 环境预设分类：天空/地面/水面/大气。 |
| `LEGACY_CATEGORY_MAP()` | `scene/env/env-lighting:158` | 旧版 category 值 → 新版 domain 前缀映射（ADR-214 零级 ID 治理）。 |
| `TIME_OF_DAY_PRESETS()` | `scene/env/env-lighting:101` | 预设数据表。按时间线排列：黎明 → 正午 → 夕阳 → 夜景 → 阴天 → 霓虹夜 |
| `calcLuminance()` | `scene/env/env-lighting:48` | — |
| `deriveLighting()` | `scene/env/env-lighting:56` | 从天空色和太阳角度推算光照参数。 |
| `exportCategorizedEnvPreset()` | `scene/env/env-lighting:312` | 序列化分类预设为 JSON 字符串。 |
| `importCategorizedEnvPreset()` | `scene/env/env-lighting:329` | 从 JSON 字符串反序列化分类预设，失败返回 null。 |
| `snapshotEnvPresetByCategory()` | `scene/env/env-lighting:295` | 从当前 envState 快照指定类别的字段。数组字段做浅拷贝避免别名。 |
| `applyWetnessToInst()` | `scene/env/env-particles:36` | — |
| `applyWindToParticles()` | `scene/env/env-particles:837` | — |
| `createParticleEmitter()` | `scene/env/env-particles:408` | — |
| `disposeParticles()` | `scene/env/env-particles:507` | — |
| `disposeSplash()` | `scene/env/env-particles:689` | 销毁 splash burst 池 |
| `getCurrentParticleType()` | `scene/env/env-particles:536` | 获取当前粒子类型（用于 particleEnabled 自动启停） |
| `isWetnessActive()` | `scene/env/env-particles:36` | — |
| `syncSplashState()` | `scene/env/env-particles:711` | 溅射开关切换（由 env-impl 检测 particleSplashEnabled 变化时调用） |
| `updateParticleParams()` | `scene/env/env-particles:862` | 运行时更新粒子参数（密度/大小/速度），响应滑条变化 |
| `updateParticleTexture()` | `scene/env/env-particles:879` | — |
| `updateParticleWind()` | `scene/env/env-particles:855` | — |
| `ReflectionMode()` | `scene/env/env-reflection:31` | — |
| `ResolvedReflectionMode()` | `scene/env/env-reflection:33` | — |
| `applyReflection()` | `scene/env/env-reflection:413` | 反射子系统统一入口。参考 applySky 模式： 1. |
| `bindProbeToMeshes()` | `scene/env/env-reflection:329` | 将 Probe cubemap 绑定到指定网格的材质（含 save 原始纹理）。 |
| `disposeReflection()` | `scene/env/env-reflection:574` | 释放反射子系统全部资源（场景销毁时调用）。 |
| `getPlanarQualityOverride()` | `scene/env/env-reflection:184` | ADR-151: 平面反射质量全局覆盖（供 env-ground / env-water 的 getQuality 检查）。 |
| `getQualityPreset()` | `scene/env/env-reflection:171` | 获取当前质量等级对应的参数预设。 |
| `onModelMeshesReady()` | `scene/env/env-reflection:565` | 模型加载后调用：将 Probe 绑定到新模型的网格。 |
| `resolveReflectionMode()` | `scene/env/env-reflection:130` | — |
| `setReflectionARSuspended()` | `scene/env/env-reflection:149` | AR 模式联动：挂起/恢复反射子系统。 |
| `applySky()` | `scene/env/env-sky:426` | — |
| `clearStarsTexCache()` | `scene/env/env-sky:40` | — |
| `disposeSky()` | `scene/env/env-sky:395` | 释放天空盒并移除相机跟随观察者（幂等）。 |
| `applyTerrainMaterial()` | `scene/env/env-terrain:139` | 地形材质（与其他地面模式一致：纯色或半透明/纹理）。 |
| `clearTerrainGeneration()` | `scene/env/env-terrain:79` | 测试/场景重置用：清零地形代际计数器。 |
| `createHeightmapGround()` | `scene/env/env-terrain:88` | 用程序化 FBM 高度图创建可拾取地形网格（CreateGroundFromHeightMap）。 |
| `fbm()` | `scene/env/env-terrain:24` | — |
| `generateTerrainHeightmapURL()` | `scene/env/env-terrain:43` | 程序化生成灰度高度图（data URL），亮=高峰、暗=低谷。经统一工厂创建（受约束环境返回 ''）。 |
| `hash2()` | `scene/env/env-terrain:22` | — |
| `valueNoise()` | `scene/env/env-terrain:22` | — |
| `applyEnvPreset()` | `scene/env/env-time-of-day:169` | — |
| `applyEnvPresetByCategory()` | `scene/env/env-time-of-day:371` | [adr-120] 按类别应用用户自定义预设。 |
| `applyEnvPresetObject()` | `scene/env/env-time-of-day:270` | 应用任意 EnvPreset 对象（支持用户自定义预设）。 |
| `getEnvSunAngle()` | `scene/env/env-time-of-day:49` | — |
| `getTimeOfDaySpeed()` | `scene/env/env-time-of-day:140` | — |
| `isTimeOfDayActive()` | `scene/env/env-time-of-day:136` | — |
| `setEnvSunAngle()` | `scene/env/env-time-of-day:44` | — |
| `setTimeOfDaySpeed()` | `scene/env/env-time-of-day:144` | — |
| `startTimeOfDay()` | `scene/env/env-time-of-day:103` | — |
| `stopTimeOfDay()` | `scene/env/env-time-of-day:122` | — |
| `syncTimeOfDayFromEnv()` | `scene/env/env-time-of-day:150` | 从持久化的 envState 恢复 time-of-day 模块变量（启动时调用） |
| `underwaterFogController()` | `scene/env/env-underwater-fog:195` | — |
| `MAX_RIPPLES()` | `scene/env/env-water-fx:31` | — |
| `_applyWaterLOD()` | `scene/env/env-water-fx:440` | 按相机到水面的距离手动切换 LOD 可见性（仅 0/1/2 三层中恰好一层 enabled）， 规避 Babylon addLODLevel 的父子/兄弟重复渲染问题。仅当层级变化 |
| `addGroundRipple()` | `scene/env/env-water-fx:241` | 添加地面涟漪（粒子落地时调用） |
| `addRipple()` | `scene/env/env-water-fx:117` | — |
| `buildRippleBuffers()` | `scene/env/env-water-fx:188` | 收集涟漪数据供 shader 上传（材质回调调用；按 MAX_RIPPLES 分配，未用 slot 为 0） |
| `clearGroundRipples()` | `scene/env/env-water-fx:297` | — |
| `clearRipples()` | `scene/env/env-water-fx:167` | — |
| `computeWaveDirs()` | `scene/env/env-water-fx:64` | 根据风向计算 4 层 Gerstner 波的 vec2 方向数组。 |
| `disposeGroundRipples()` | `scene/env/env-water-fx:303` | 释放地面涟漪纹理与状态（由 disposeWater / disposeGround 调用，防止 GPU 纹理泄漏） |
| `getGroundRippleTexture()` | `scene/env/env-water-fx:311` | 获取地面涟漪纹理（供 env-ground 设置到 bumpTexture） |
| `getWaterLODMeshes()` | `scene/env/env-water-fx:101` | 供宿主/material 读取 LOD 网格（同步缩放/位置或逐层 dispose） |
| `hasActiveGroundRipples()` | `scene/env/env-water-fx:332` | 是否有活跃的地面涟漪（供 env-ground 判断是否需要叠加 ripple 法线纹理） |
| `isUnderwaterActive()` | `scene/env/env-water-fx:54` | 相机是否处于水下（雾效接管中）。 |
| `resetUnderwaterFlags()` | `scene/env/env-water-fx:106` | 供宿主 disposeWater 重置水下状态 flag（灯光强度恢复由 resetUnderwaterState 负责） |
| `resetUnderwaterState()` | `scene/env/env-water-fx:556` | — |
| `resetWaterLODState()` | `scene/env/env-water-fx:95` | 供宿主 disposeWater 重置 LOD 状态 |
| `selectWaterLOD()` | `scene/env/env-water-fx:426` | — |
| `setGroundGeometryProvider()` | `scene/env/env-water-fx:234` | 注入地面几何提供者（env-ground 在模块初始化时调用一次） |
| `setWaterLODMeshes()` | `scene/env/env-water-fx:89` | 供宿主 createWater 写入 LOD 网格（拆分后状态归本模块，宿主经函数访问） |
| `updateGroundRipples()` | `scene/env/env-water-fx:337` | 每帧更新地面涟漪纹理（由 env-ground 的 update observer 驱动） |
| `updateRipples()` | `scene/env/env-water-fx:172` | 每帧涟漪衰减 + 死亡清理（由材质更新回调驱动；dt&lt;=0 时跳过避免零时距死循环） |
| `updateUnderwaterTransition()` | `scene/env/env-water-fx:461` | — |
| `WATER_PRESETS()` | `scene/env/env-water-material:543` | — |
| `WaterPreset()` | `scene/env/env-water-material:507` | — |
| `_WATER_KEYS()` | `scene/env/env-water-material:786` | — |
| `_createWaterMaterial()` | `scene/env/env-water-material:418` | — |
| `_rebuildWaterMaterial()` | `scene/env/env-water-material:444` | 重建水面材质（切换 PLANAR_REFLECTION define 时必须），保持网格与 LOD 引用一致。 |
| `_syncWaterUniforms()` | `scene/env/env-water-material:183` | 同步水面材质的全部 uniform 参数（非破坏性，不销毁/重建材质）。 |
| `_waterUpdateCallback()` | `scene/env/env-water-material:457` | — |
| `applyWaterPresetToCurrent()` | `scene/env/env-water-material:715` | — |
| `buildWaterPresetEnvState()` | `scene/env/env-water-material:665` | 预设 → EnvState 完整字段映射（含扩展参数），供 UI chip handler 调用并持久化。 |
| `disposeDetailNormalTexture()` | `scene/env/env-water-material:74` | 宿主 disposeWater 委托：释放法线细节纹理（ADR-115 P1） |
| `getWaterPhase()` | `scene/env/env-water-material:656` | 测试/调试用：读取当前累计波相位。 |
| `resetWaterPhaseState()` | `scene/env/env-water-material:42` | 宿主 disposeWater 委托：重置相位/波速状态 |
| `setUnderwaterFog()` | `scene/env/env-water-material:163` | 由水下雾控制器同步水下雾参数到水面材质（含材质重建后的恢复由 _syncWaterUniforms 负责）。 |
| `setWaterWaveSpeed()` | `scene/env/env-water-material:37` | 宿主 updateWaterAnimSpeed 委托：只更新累加速率，相位由每帧 observer 累加（改波速不跳变） |
| `_setupMirrorRT()` | `scene/env/env-water-reflect:89` | 初始化/更新水面平面反射：委托给统一引擎（创建 RT、镜像相机、挂载、互斥）。 |
| `waterReflection()` | `scene/env/env-water-reflect:20` | — |
| `createWater()` | `scene/env/env-water:76` | 按相机到水面的距离选择 LOD 层级（纯函数，便于单测）。 |
| `disposeWater()` | `scene/env/env-water:150` | — |
| `refreshWaterRenderList()` | `scene/env/env-water:195` | 刷新水面渲染列表（钩子函数） 当前为空实现，保留作为API接口，未来可能用于： - 更新水的渲染顺序 - 响应场景图形变更（如新增/移除需要水面反射的对象） - 同步水的渲染状态 |
| `resetCausticsSyncGuard()` | `scene/env/env-water:228` | [fix code_review P2] 复位焦散 config diff guard 内存：dispose 后 causticsController config 回 DEFAU |
| `updateWaterAnimSpeed()` | `scene/env/env-water:198` | — |
| `applyWetnessToAllModels()` | `scene/env/env-wetness:86` | 对所有已加载模型应用湿身材质效果（幂等）。 |
| `applyWetnessToInst()` | `scene/env/env-wetness:134` | — |
| `isWetnessActive()` | `scene/env/env-wetness:130` | — |
| `removeWetnessFromAllModels()` | `scene/env/env-wetness:107` | 移除所有模型的湿身材质效果（幂等）。 |
| `_envSys()` | `scene/env/env:9` | — |
| `addGroundRipple()` | `scene/env/env:85` | — |
| `addRipple()` | `scene/env/env:69` | — |
| `applyEnvState()` | `scene/env/env:144` | — |
| `applyGround()` | `scene/env/env:45` | — |
| `applySky()` | `scene/env/env:39` | — |
| `clearGroundRipples()` | `scene/env/env:95` | — |
| `clearRipples()` | `scene/env/env:79` | — |
| `createClouds()` | `scene/env/env:112` | — |
| `createParticleEmitter()` | `scene/env/env:101` | — |
| `createWater()` | `scene/env/env:51` | — |
| `disposeClouds()` | `scene/env/env:116` | — |
| `disposeEnvUpdateObserver()` | `scene/env/env:15` | — |
| `disposeParticles()` | `scene/env/env:106` | — |
| `disposeWater()` | `scene/env/env:55` | — |
| `ensureEnvUpdateObserver()` | `scene/env/env:13` | — |
| `getGroundHeightAt()` | `scene/env/env:211` | — |
| `getMirrorInfo()` | `scene/env/env:198` | — |
| `getScene()` | `scene/env/env:17` | — |
| `getTimeOfDaySpeed()` | `scene/env/env:134` | — |
| `initEnvFacade()` | `scene/env/env:33` | — |
| `isMirrorActive()` | `scene/env/env:198` | — |
| `isTimeOfDayActive()` | `scene/env/env:130` | — |
| `refreshMirrorRenderList()` | `scene/env/env:198` | — |
| `refreshWaterRenderList()` | `scene/env/env:59` | — |
| `registerSceneTickCallback()` | `scene/env/env:11` | — |
| `setMirrorPosition()` | `scene/env/env:198` | — |
| `setMirrorResolution()` | `scene/env/env:198` | — |
| `setMirrorRotationY()` | `scene/env/env:198` | — |
| `setMirrorSize()` | `scene/env/env:198` | — |
| `setTimeOfDaySpeed()` | `scene/env/env:138` | — |
| `startTimeOfDay()` | `scene/env/env:122` | — |
| `stopTimeOfDay()` | `scene/env/env:126` | — |
| `toggleMirror()` | `scene/env/env:198` | — |
| `updateWaterAnimSpeed()` | `scene/env/env:63` | — |
| `createMirror()` | `scene/env/mirror-debug:78` | 创建镜面道具：竖直平面 + MirrorTexture 反射。 |
| `disposeMirror()` | `scene/env/mirror-debug:142` | 销毁镜面 |
| `getMirrorInfo()` | `scene/env/mirror-debug:252` | — |
| `isMirrorActive()` | `scene/env/mirror-debug:171` | — |
| `refreshMirrorRenderList()` | `scene/env/mirror-debug:189` | 刷新渲染列表（模型加载/卸载后调用） |
| `setMirrorPosition()` | `scene/env/mirror-debug:211` | — |
| `setMirrorResolution()` | `scene/env/mirror-debug:229` | — |
| `setMirrorRotationY()` | `scene/env/mirror-debug:220` | — |
| `setMirrorSize()` | `scene/env/mirror-debug:198` | — |
| `toggleMirror()` | `scene/env/mirror-debug:175` | — |
| `updateMirrorClearColor()` | `scene/env/mirror-debug:62` | 同步 RT clearColor 与当前天空模式一致： - color 模式：用 scene.clearColor（天空色），使纯净的天空色在镜子中可见 - 其他模式：透明黑，由反 |
| `PlanarReflection()` | `scene/env/planar-reflection:112` | — |
| `PlanarReflectionConfig()` | `scene/env/planar-reflection:37` | — |
| `ReflectionMode()` | `scene/env/planar-reflection:35` | — |
| `registerReflectionSurface()` | `scene/env/planar-reflection:73` | — |
| `resetReflectionSurfaces()` | `scene/env/planar-reflection:82` | ADR-114 Phase 2: 是否生成 mipmap（地面 PBR 反射模糊用，水面保持 false） generateMipMaps?: boolean; } // ==== |
| `MaterialMode()` | `scene/manager/material-proxy-resolver:10` | — |
| `getMaterialMode()` | `scene/manager/material-proxy-resolver:13` | 从 VITE_MMD_MATERIAL 环境变量读取材质模式（构建期常量，未定义时走默认值） |
| `getPBRMaterialBuilder()` | `scene/manager/material-proxy-resolver:33` | 动态导入 PBRMaterialBuilder（PBR 材质构建器） 注意: PBRMaterialBuilder 在 PMX 加载阶段构建 PBRMaterial， 与 MmdS |
| `getStandardMaterialProxy()` | `scene/manager/material-proxy-resolver:22` | 返回标准材质代理（MmdStandardMaterialProxy）— 用于 Lambert + Blinn-Phong 渲染 |
| `resolveMaterialProxy()` | `scene/manager/material-proxy-resolver:44` | 返回当前材质的代理构造函数（同步） （PBR 模式下的材质代理仍使用标准代理，因 PMX 加载阶段已由 PBRMaterialBuilder 构建材质， MmdStandardMa |
| `DEFAULT_SSS_PARAMS()` | `scene/manager/material-sss:31` | SSS 默认参数 |
| `SssColorInput()` | `scene/manager/material-sss:60` | — |
| `SssParams()` | `scene/manager/material-sss:17` | SSS 参数 |
| `applyMatSssState()` | `scene/manager/material-sss:218` | 反序列化 SSS 状态并应用到模型 |
| `applySss()` | `scene/manager/material-sss:114` | 应用 SSS 参数到指定分类的所有 PBRMaterial 材质 内部实现： 1. |
| `disposeModelSssState()` | `scene/manager/material-sss:186` | 重置指定模型的所有 SSS 状态 |
| `getMatSssParams()` | `scene/manager/material-sss:51` | 获取指定分类的 SSS 参数 |
| `getMatSssState()` | `scene/manager/material-sss:194` | 序列化指定模型的 SSS 状态为 JSON 兼容结构 用于场景/预设保存。仅返回非默认值，避免默认值噪声。 |
| `setMatSssParams()` | `scene/manager/material-sss:69` | 设置指定分类的 SSS 参数并立即应用到所有该分类材质 sssColor 可传入 Color3 或 { r, g, b } 形式 |
| `AlphaCtx()` | `scene/manager/material:20` | — |
| `DEFAULT_MAT_PARAMS()` | `scene/manager/material:65` | 材质参数默认值 — 所有新增字段在此维护，消除散落硬编码。 |
| `MaterialCategory()` | `scene/manager/material:47` | — |
| `MaterialCategoryParams()` | `scene/manager/material:32` | — |
| `MaterialStateManager()` | `scene/manager/material:184` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `SssMaterial()` | `scene/manager/material:18` | — |
| `_applyAll()` | `scene/manager/material:623` | [audit:round24 P2] 单个材质应用（PBR/Standard 双分支 + category/per-mat 合并 + DEFAULT 兜底）。 |
| `_capture()` | `scene/manager/material:407` | Per-material category cache. |
| `_capturePbr()` | `scene/manager/material:455` | PBRMaterial 参数捕获（对应 _capture 的 PBR 版） |
| `_catState()` | `scene/manager/material:208` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `_isPbrMaterial()` | `scene/manager/material:447` | — |
| `_matEnabled()` | `scene/manager/material:212` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `_matState()` | `scene/manager/material:210` | 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 |
| `applyMatState()` | `scene/manager/material:1021` | — |
| `applyUnlitFallback()` | `scene/manager/material:756` | 光照兜底预设：让模型呈现"伪 unlit"状态，不依赖方向光即可正常显示。 |
| `disposeModelMaterialState()` | `scene/manager/material:870` | 清理指定模型的全部材质状态（分类 + 逐材质 + 启用标记）。 |
| `getMatCatGroups()` | `scene/manager/material:685` | — |
| `getMatCatParams()` | `scene/manager/material:705` | — |
| `getMatDetailList()` | `scene/manager/material:786` | — |
| `getMatParams()` | `scene/manager/material:815` | — |
| `getMatState()` | `scene/manager/material:951` | — |
| `getMaterialCategory()` | `scene/manager/material:376` | Resolve the display category (皮肤 / 头发 / 眼睛 / 服装 …) for a material or its material name. |
| `isMatCategoryAllEnabled()` | `scene/manager/material:879` | 检查指定分类的全部材质是否都已启用。 |
| `isMatEnabled()` | `scene/manager/material:658` | — |
| `isPbrMaterial()` | `scene/manager/material:452` | — |
| `resetMatCatParams()` | `scene/manager/material:732` | — |
| `resetPerMaterialParams()` | `scene/manager/material:945` | 重置所有逐材质覆盖（per-material），保留分类调整（皮肤/头发等）。 |
| `resetSingleMatParams()` | `scene/manager/material:851` | — |
| `setMatCatParams()` | `scene/manager/material:717` | — |
| `setMatCategoryEnabled()` | `scene/manager/material:907` | 按分类批量切换材质可见性。 |
| `setMatEnabled()` | `scene/manager/material:662` | — |
| `setMatParams()` | `scene/manager/material:825` | — |
| `resolveModelId()` | `scene/manager/model-id:9` | 解析模型运行时 id：优先复用存档 uuid（preferredId，由恢复路径传入）， 否则生成稳定 uuid。替代旧实现 &#96;model_${Date.now()}_${Math |
| `captureThumbnail()` | `scene/manager/model-loader:153` | Captures a screenshot after model load for thumbnail cache. |
| `initLoader()` | `scene/manager/model-loader:91` | — |
| `loadPMXFile()` | `scene/manager/model-loader:420` | — |
| `setOnMeshesReady()` | `scene/manager/model-loader:83` | — |
| `setOnModelLoaded()` | `scene/manager/model-loader:87` | — |
| `FormationType()` | `scene/manager/model-manager:125` | — |
| `ModelManager()` | `scene/manager/model-manager:193` | — |
| `getFormationLabels()` | `scene/manager/model-manager:136` | — |
| `FormationType()` | `scene/manager/model-ops:97` | — |
| `ReplaceSnapshot()` | `scene/manager/model-ops:331` | [doc:adr-150] 替换模型时从旧模型捕获、应用到新模型的可继承状态快照。 |
| `applyInheritedState()` | `scene/manager/model-ops:390` | [doc:adr-150] 将状态快照应用到新模型（通过 modelManager setter + setBoneOverride）。 |
| `applyVPDPose()` | `scene/manager/model-ops:284` | 应用 VPD 姿势到模型（静态姿势，停掉 VMD 播放）。 |
| `arrangeModels()` | `scene/manager/model-ops:93` | — |
| `captureInheritedState()` | `scene/manager/model-ops:358` | [doc:adr-150] 从旧 ModelInstance 提取可继承状态（深拷贝，不引用原 inst 字段）。 |
| `focusModel()` | `scene/manager/model-ops:75` | — |
| `focusedMmdModel()` | `scene/manager/model-ops:86` | — |
| `focusedModel()` | `scene/manager/model-ops:89` | — |
| `getActiveFormation()` | `scene/manager/model-ops:101` | — |
| `getActiveFormationSpacing()` | `scene/manager/model-ops:105` | — |
| `getFormationLabels()` | `scene/manager/model-ops:109` | — |
| `getModelMorphWeight()` | `scene/manager/model-ops:265` | — |
| `getModelMorphs()` | `scene/manager/model-ops:257` | — |
| `getModelOrbit()` | `scene/manager/model-ops:189` | — |
| `getModelPosition()` | `scene/manager/model-ops:174` | — |
| `getModelPositionMode()` | `scene/manager/model-ops:199` | — |
| `getPhysicsCatState()` | `scene/manager/model-ops:144` | — |
| `getPhysicsCategories()` | `scene/manager/model-ops:140` | — |
| `isPhysicsCategoryEnabled()` | `scene/manager/model-ops:148` | — |
| `removeFocusedModel()` | `scene/manager/model-ops:68` | — |
| `removeModel()` | `scene/manager/model-ops:47` | — |
| `resetModelMorphs()` | `scene/manager/model-ops:269` | — |
| `resetModelTransform()` | `scene/manager/model-ops:203` | — |
| `setModelBoneJointsVis()` | `scene/manager/model-ops:130` | — |
| `setModelBoneLinesVis()` | `scene/manager/model-ops:126` | — |
| `setModelFormation()` | `scene/manager/model-ops:97` | — |
| `setModelMorphWeight()` | `scene/manager/model-ops:261` | — |
| `setModelOpacity()` | `scene/manager/model-ops:118` | — |
| `setModelOrbit()` | `scene/manager/model-ops:180` | — |
| `setModelPhysics()` | `scene/manager/model-ops:136` | — |
| `setModelPosition()` | `scene/manager/model-ops:170` | — |
| `setModelPositionMode()` | `scene/manager/model-ops:195` | — |
| `setModelRotation()` | `scene/manager/model-ops:166` | — |
| `setModelRotationY()` | `scene/manager/model-ops:162` | — |
| `setModelScaling()` | `scene/manager/model-ops:158` | — |
| `setModelVisibility()` | `scene/manager/model-ops:114` | — |
| `setModelWireframe()` | `scene/manager/model-ops:122` | — |
| `setPhysicsCategory()` | `scene/manager/model-ops:152` | — |
| `stopVMD()` | `scene/manager/model-ops:239` | — |
| `disposeOverlay()` | `scene/manager/outfit-overlay:353` | 释放 overlay mesh 并清理引用。 |
| `hideMaterials()` | `scene/manager/outfit-overlay:301` | 隐藏指定材质名的 PMX mesh（保存原始可见性用于恢复）。 |
| `loadOverlay()` | `scene/manager/outfit-overlay:202` | 加载 FBX overlay 并尝试绑定到模型 skeleton。 |
| `restoreMaterials()` | `scene/manager/outfit-overlay:333` | 恢复被 hideMaterials 隐藏的 PMX mesh 可见性。 |
| `applyOutfitVariant()` | `scene/manager/outfit:574` | — |
| `loadOutfits()` | `scene/manager/outfit:118` | — |
| `resetOutfit()` | `scene/manager/outfit:770` | — |
| `setSceneRef()` | `scene/manager/outfit:38` | 由 scene.ts 在场景初始化完成后注入当前 scene 实例 |
| `tryApplyPbrMaterialBuilder()` | `scene/manager/pbr-builder-init:12` | 动态导入 PBRMaterialBuilder 并覆盖 MmdModelLoader.SharedMaterialBuilder。 |
| `auditMissingTextures()` | `scene/manager/pmx-texture-audit:46` | 识别 PMX 声明但目录中缺失的纹理。 |
| `parsePmxTexturePaths()` | `scene/manager/pmx-texture-audit:31` | 解析 PMX 声明的纹理路径清单（相对路径，原样保留目录前缀与分隔符）。 |
| `SssPBRMaterial()` | `scene/manager/sss-pbr-material:26` | — |
| `expandFallbackCandidates()` | `scene/manager/texture-fallback:93` | 批量展开 fallback 候选条目（共享 data 引用），并对「候选 vs 真实路径」冲突去重。 |
| `registerDeclaredAliases()` | `scene/manager/texture-fallback:52` | 按 PMX 声明路径反向注册别名（[fix:decl-alias]）。 |
| `textureFallbackCandidates()` | `scene/manager/texture-fallback:17` | 生成给定相对路径的 fallback 候选列表（不含原始路径本身）。 |
| `ThumbnailSource()` | `scene/manager/thumbnail-capture:31` | — |
| `renderInstanceThumbnail()` | `scene/manager/thumbnail-capture:49` | 用离屏 RenderTargetTexture 渲染指定模型实例的「当前骨骼姿态」并保存为缩略图。 |
| `ThumbnailBaseKeyInput()` | `scene/manager/thumbnail-key:14` | — |
| `ThumbnailKeyInput()` | `scene/manager/thumbnail-key:45` | — |
| `buildThumbnailKey()` | `scene/manager/thumbnail-key:54` | 唯一缓存 key 构造：&#96;&lt;baseKey&gt;::&lt;resolution&gt;::&lt;aspect&gt;&#96;。 |
| `libraryModelBaseKey()` | `scene/manager/thumbnail-key:37` | 由 LibraryModel 推导 baseKey（读侧专用适配器）。 |
| `thumbnailBaseKey()` | `scene/manager/thumbnail-key:27` | 由库引用路径 + 内部路径推导 baseKey。 |
| `BoneMapPreset()` | `scene/motion/animation-retargeter:26` | — |
| `RetargetPlayState()` | `scene/motion/animation-retargeter:34` | 当前活跃的 retarget 动画状态（用于场景序列化）。 |
| `RetargetResult()` | `scene/motion/animation-retargeter:28` | — |
| `getRetargetPlayState()` | `scene/motion/animation-retargeter:47` | 获取当前活跃的 retarget 动画播放状态，用于场景序列化。 |
| `loadAndRetargetAnimation()` | `scene/motion/animation-retargeter:77` | 从外部动画文件加载并重定向到 MMD 骨骼。 |
| `playRetargetedAnimation()` | `scene/motion/animation-retargeter:176` | 播放重定向后的动画（additive 模式，叠加在 VMD 之上）。 |
| `restoreRetargetAnimation()` | `scene/motion/animation-retargeter:248` | 从已加载的模型恢复 retarget 动画（场景反序列化用）。 |
| `stopCurrentRetarget()` | `scene/motion/animation-retargeter:52` | 停止当前 retarget 动画并清理。 |
| `BoneConflict()` | `scene/motion/bone-override-store:44` | 骨骼冲突记录（原 registry._boneConflicts 的统一版） |
| `BoneOverrideStore()` | `scene/motion/bone-override-store:75` | — |
| `BoneOverrideStoreOptions()` | `scene/motion/bone-override-store:58` | 构造选项（ADR-147 M8：注入模块→stage 解析器，填充 BoneConflict.stage） |
| `BoneOwnership()` | `scene/motion/bone-override-store:31` | 单骨所有权记录 |
| `InMemoryBoneOverrideStore()` | `scene/motion/bone-override-store:121` | — |
| `ModuleRuntimeState()` | `scene/motion/bone-override-store:37` | 模块运行时状态（合并原 intent.motionModules + _ownedBones 的职责） |
| `OverrideSlot()` | `scene/motion/bone-override-store:18` | 单骨覆盖槽位（原 _OverrideSlot 的共享命名版） |
| `ReleaseListener()` | `scene/motion/bone-override-store:73` | 骨骼释放事件监听器 |
| `getBoneOverrideStore()` | `scene/motion/bone-override-store:425` | 获取全局 BoneOverrideStore 单例（registry / module-base 等委托此存储骨骼所有权与冲突状态） |
| `BoneHierarchyDump()` | `scene/motion/bone-override:1106` | 骨骼层级导出结果 |
| `BoneHierarchyNode()` | `scene/motion/bone-override:1084` | 单根骨骼的层级与覆盖状态（dumpBoneHierarchy 输出元素） |
| `BoneOverrideEntry()` | `scene/motion/bone-override:24` | 持久化的单条骨骼覆盖配置 |
| `FRAME_HOOK_ORDER()` | `scene/motion/bone-override:735` | [doc:adr-116 P3] 注册每帧渲染钩子。 |
| `FrameHookSnapshot()` | `scene/motion/bone-override:765` | 帧钩子快照（供 UI 查询管线时序一览） |
| `OverrideSlotLike()` | `scene/motion/bone-override:252` | 覆盖槽的最小形态，供 _computeOverride 接收（与内部 _OverrideSlot 结构兼容） |
| `OverrideType()` | `scene/motion/bone-override:478` | — |
| `applyBoneOverrideIK()` | `scene/motion/bone-override:338` | [doc:adr-122 P1] IK 感知的骨骼覆盖。 |
| `clearAllOverrides()` | `scene/motion/bone-override:547` | 清除所有骨骼覆盖。 |
| `clearBoneOverride()` | `scene/motion/bone-override:440` | 清除指定骨骼的覆盖。 |
| `computeOverride()` | `scene/motion/bone-override:268` | [doc:adr-116 P1] 计算单槽覆盖后的平移与旋转。 |
| `dumpBoneHierarchy()` | `scene/motion/bone-override:1121` | 导出当前聚焦模型的骨骼层级与覆盖状态。 |
| `getAllOverrides()` | `scene/motion/bone-override:780` | 获取当前所有覆盖的条目列表（用于持久化/UI 展示）。 |
| `getFrameHooksSnapshot()` | `scene/motion/bone-override:771` | 按 order 升序返回当前注册的所有帧钩子快照（不含 hook 函数本身）。 |
| `getOverride()` | `scene/motion/bone-override:465` | [doc:adr-116] 读取单条骨骼的覆盖条目（用于 UI 回填）。不存在返回 undefined。 |
| `getOverrideType()` | `scene/motion/bone-override:487` | 查询骨骼覆盖类型（零分配）。 |
| `getWasmIkResolver()` | `scene/motion/bone-override:948` | [ADR-202 §六] 获取 WASM IK 重解回调（供 feet-adjustment 等外部模块调用）。 |
| `protectIkPosition()` | `scene/motion/bone-override:568` | 注册骨骼位置保护（帧钩子内调用）。 |
| `registerBoneOverrideFrameHook()` | `scene/motion/bone-override:748` | — |
| `restoreOverrides()` | `scene/motion/bone-override:802` | 从持久化的条目列表批量恢复覆盖。 |
| `setBoneOverride()` | `scene/motion/bone-override:304` | 设置单条骨骼覆盖。 |
| `setBoneOverridePosition()` | `scene/motion/bone-override:409` | [doc:adr-116] 设置单条骨骼的位置覆盖（P2 引擎扩展）。 |
| `setBoneOverrideQuat()` | `scene/motion/bone-override:375` | 设置单条骨骼覆盖（直接传四元数）。 |
| `setWasmIkResolver()` | `scene/motion/bone-override:931` | [ADR-202 A-class] 注入 WASM IK 重解回调。 |
| `startBoneOverride()` | `scene/motion/bone-override:953` | — |
| `stopBoneOverride()` | `scene/motion/bone-override:1062` | 停止覆盖系统。 |
| `FeetModelProvider()` | `scene/motion/feet-adjustment:49` | 注入：返回需要处理脚部调整的模型及其 runtime bones |
| `FootLandEvent()` | `scene/motion/feet-adjustment:35` | — |
| `SolveFootInput()` | `scene/motion/feet-adjustment:41` | — |
| `SolveFootOutput()` | `scene/motion/feet-adjustment:41` | — |
| `isFeetAdjustmentRunning()` | `scene/motion/feet-adjustment:129` | 查询脚部跟随系统是否正在运行（observer 已注册）。 |
| `setOnFootLand()` | `scene/motion/feet-adjustment:124` | 注入落地事件回调（null 取消）。脚步声控制器调用。 |
| `solveFootTarget()` | `scene/motion/feet-adjustment:40` | — |
| `startFeetAdjustment()` | `scene/motion/feet-adjustment:387` | 启动脚部调整系统：注册为 MotionPipeline bone-override 层（order=5）。 |
| `stopFeetAdjustment()` | `scene/motion/feet-adjustment:462` | 停止脚部调整系统并清空缓存。 |
| `startFallbackDetection()` | `scene/motion/footstep-detect-fallback:68` | 启动独立落地检测（fallback 模式）。 |
| `stopFallbackDetection()` | `scene/motion/footstep-detect-fallback:133` | 停止独立落地检测。 |
| `resolveGroundSfxKind()` | `scene/motion/footstep:54` | 依据当前地面类型推断脚步音色。 |
| `startFootstep()` | `scene/motion/footstep:137` | 启动脚步声系统：注入落地事件回调。 |
| `stopFootstep()` | `scene/motion/footstep:177` | 停止脚步声系统并清空合成缓存。 |
| `getLipSyncState()` | `scene/motion/lipsync-bridge:57` | — |
| `initLipSync()` | `scene/motion/lipsync-bridge:17` | — |
| `resetLipSyncOnFocusChange()` | `scene/motion/lipsync-bridge:65` | — |
| `setLipSyncEnabled()` | `scene/motion/lipsync-bridge:41` | — |
| `setLipSyncIntensity()` | `scene/motion/lipsync-bridge:49` | — |
| `setLipSyncMultiMorphEnabled()` | `scene/motion/lipsync-bridge:53` | — |
| `setLipSyncSensitivity()` | `scene/motion/lipsync-bridge:45` | — |
| `setLipSyncState()` | `scene/motion/lipsync-bridge:61` | — |
| `updateLipSync()` | `scene/motion/lipsync-bridge:73` | 保留空壳避免外部引用断裂，实际逻辑已由 perception observer 调度。 |
| `LoadableProcId()` | `scene/motion/motion-intent:18` | — |
| `addSceneMotion()` | `scene/motion/motion-intent:138` | 新增主动作到场景库。 |
| `clearAllSceneMotions()` | `scene/motion/motion-intent:189` | 清空整个场景动作库 + 默认动作。 |
| `findOrCreateModuleState()` | `scene/motion/motion-intent:202` | [doc:adr-121 P4-1] 在 intent.motionModules 中查找或创建模块状态。 |
| `getActiveMotion()` | `scene/motion/motion-intent:32` | 获取当前默认动作（派生自 _activeMotionId）。 |
| `getActiveMotionId()` | `scene/motion/motion-intent:45` | 获取当前默认动作 id。null = 无默认。 |
| `getAllLoadableProcMotions()` | `scene/motion/motion-intent:57` | 获取全部可加载的程序化动作 ID 列表（含未加载的）。 |
| `getLoadedProceduralMotions()` | `scene/motion/motion-intent:62` | 获取当前已加载的程序化动作集合。 |
| `getMotionGen()` | `scene/motion/motion-intent:50` | 获取当前 generation 值。用于异步操作中判断是否为最新广播。 |
| `getSceneMotions()` | `scene/motion/motion-intent:40` | 获取场景级动作库（所有主动作列表）。 |
| `initMotionIntent()` | `scene/motion/motion-intent:100` | 初始化广播回调。由 bootstrap 点（如 scene.ts initScene）调用一次。 |
| `loadProceduralMotion()` | `scene/motion/motion-intent:67` | 加载一个程序化动作到集合。 |
| `removeSceneMotion()` | `scene/motion/motion-intent:159` | 移除场景库中的某个主动作。 |
| `replaceDefaultMotion()` | `scene/motion/motion-intent:235` | [adr-169] 原位替换默认动作。 |
| `resetMotionIntent()` | `scene/motion/motion-intent:111` | [fix P2] 重置广播回调（场景销毁/重建或 HMR 时调用），使 initMotionIntent 可再次注册。 |
| `resolveCompatibility()` | `scene/motion/motion-intent:331` | 兼容性解析：判断指定模型的骨骼列表是否兼容某 VMD 动作。 |
| `setBroadcastCallback()` | `scene/motion/motion-intent:121` | 测试用例间需 setBroadcastCallback(null) 隔离回调，而 initMotionIntent 的幂等守卫不允许置空。 |
| `setDefaultMotion()` | `scene/motion/motion-intent:178` | 设置默认动作 id。 |
| `setLoadedProceduralMotions()` | `scene/motion/motion-intent:80` | 设置已加载集合（用于场景反序列化）。始终保证 'none' 存在。 |
| `unloadProceduralMotion()` | `scene/motion/motion-intent:72` | 卸载一个程序化动作。'none' 不可卸载。 |
| `BODY_POSTURE_DEF()` | `scene/motion/motion-modules/body-posture:286` | 身体姿态模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） |
| `createBodyPostureModule()` | `scene/motion/motion-modules/body-posture:182` | 创建身体姿态模块实例 |
| `LEFT_FOOT_DEF()` | `scene/motion/motion-modules/foot-modules:256` | — |
| `RIGHT_FOOT_DEF()` | `scene/motion/motion-modules/foot-modules:273` | — |
| `LEFT_HAND_DEF()` | `scene/motion/motion-modules/hand-modules:454` | — |
| `RIGHT_HAND_DEF()` | `scene/motion/motion-modules/hand-modules:482` | — |
| `FrameHookManager()` | `scene/motion/motion-modules/module-base:260` | 帧钩子管理器的返回类型（供 createEnsureActive 复用） |
| `ModuleBaseMethods()` | `scene/motion/motion-modules/module-base:21` | createModuleBase 返回的方法子集（与 MotionOverrideModule 对应方法签名一致） |
| `ModuleBaseOverrides()` | `scene/motion/motion-modules/module-base:27` | 模块基础行为覆盖 |
| `ModuleShellConfig()` | `scene/motion/motion-modules/module-base:302` | [doc:adr-146 P3 主题12] 模块实例外壳 — 消除 6 个工厂末尾重复的 &#96;id/meta/priority/managedBones/buildSchema + |
| `applyModuleSnapshot()` | `scene/motion/motion-modules/module-base:204` | [doc:adr-125] 将快照应用到指定模型的所有模块。 |
| `createEnsureActive()` | `scene/motion/motion-modules/module-base:281` | [doc:adr-146 P3] ensureActive 公共工厂 — 消除 body-posture/foot/hand 复制粘贴的 「先 bake 重烤、再幂等注册帧钩子」模 |
| `createFrameHookManager()` | `scene/motion/motion-modules/module-base:236` | [doc:adr-116 P3] 帧钩子管理器 — 消除 sway/riding 的 _xxxFrameHooks Map 重复模式。 |
| `createModuleBase()` | `scene/motion/motion-modules/module-base:105` | 创建模块通用方法，减少 7 个模块间 ~105 行重复 boilerplate。 |
| `createModuleShell()` | `scene/motion/motion-modules/module-base:312` | — |
| `getBakeActionId()` | `scene/motion/motion-modules/module-base:66` | 读取当前 bake 的 actionId（无则 undefined，回到 activeMotion/fallback 语义） |
| `getModuleActionId()` | `scene/motion/motion-modules/module-base:92` | 读取某模型当前激活模块的 actionId（帧钩子内使用；无则 undefined 回退 activeMotion/fallback） |
| `prepareBake()` | `scene/motion/motion-modules/module-base:332` | [doc:adr-146 P3 主题13] bake 头部守卫 — 消除 6 个 bake 重复的 &#96;getModuleState + enabled 守卫 + claimBone |
| `MotionHistoryEntry()` | `scene/motion/motion-modules/motion-history:10` | — |
| `SnapshotApplier()` | `scene/motion/motion-modules/motion-history:44` | 应用快照到引擎的回调（调用方负责从 registry 读模块实例并 setState/enable/disable） |
| `SnapshotBuilder()` | `scene/motion/motion-modules/motion-history:41` | 构建当前全量快照的回调（调用方负责从 registry 读状态） |
| `canRedo()` | `scene/motion/motion-modules/motion-history:179` | 是否有可重做的记录 |
| `canUndo()` | `scene/motion/motion-modules/motion-history:174` | 是否有可撤销的记录 |
| `clearHistory()` | `scene/motion/motion-modules/motion-history:221` | 清除指定模型的历史（删除模型时调用） |
| `getHistoryCursor()` | `scene/motion/motion-modules/motion-history:190` | 获取当前游标位置（UI 高亮用） |
| `getHistoryEntries()` | `scene/motion/motion-modules/motion-history:185` | 获取历史条目列表（UI 显示用） |
| `jumpToHistory()` | `scene/motion/motion-modules/motion-history:199` | [doc:adr-125 P3] 跳转到指定历史位置。 |
| `pushHistory()` | `scene/motion/motion-modules/motion-history:99` | 记录一次参数变更到历史栈。 |
| `redo()` | `scene/motion/motion-modules/motion-history:162` | 重做一步（恢复到下一条快照），返回是否成功 |
| `undo()` | `scene/motion/motion-modules/motion-history:145` | 撤销一步（恢复到上一条快照），返回是否成功 |
| `computeFootPitch()` | `scene/motion/motion-modules/motion-math:39` | 单足俯仰角（度）。 |
| `computePedalPhase()` | `scene/motion/motion-modules/motion-math:27` | 踏板相位（度，0-360 自然循环）。 |
| `computeSwayYaw()` | `scene/motion/motion-modules/motion-math:12` | 摇摆正弦 yaw（度）。 |
| `applyMotionPreset()` | `scene/motion/motion-modules/preset-types:23` | 应用预设到指定模型。 |
| `generatePresetId()` | `scene/motion/motion-modules/preset-types:45` | — |
| `modulesToPresetMap()` | `scene/motion/motion-modules/preset-types:9` | MotionModuleState[] → MotionPreset['modules'] |
| `BoneConflict()` | `scene/motion/motion-modules/registry:279` | — |
| `PROC_ACTION_PREFIX()` | `scene/motion/motion-modules/registry:129` | [fix:proc-override] actionId 前缀：标识程序化动作的模块作用域（&#96;proc:${procRole}&#96;）。 |
| `applyMotionModulesToModel()` | `scene/motion/motion-modules/registry:388` | [doc:adr-129] 将场景级模块配置应用到指定模型 用于动作广播时应用配置到所有 inherit 模型 |
| `applyProcMotionModulesToModel()` | `scene/motion/motion-modules/registry:136` | [fix:proc-override] 应用程序化动作的模块配置到指定模型（持久化状态 → 运行时）。 |
| `claimBones()` | `scene/motion/motion-modules/registry:265` | 为模块声明对一组骨骼的所有权（bake 前调用）。 |
| `clearAllModulesForModel()` | `scene/motion/motion-modules/registry:379` | 清除指定模型的所有模块覆盖（删除模型时调用） |
| `createModule()` | `scene/motion/motion-modules/registry:70` | 为指定模型创建模块实例 |
| `getAllConflicts()` | `scene/motion/motion-modules/registry:304` | 获取某模型全部模块的冲突明细（按 loser 模块分组） |
| `getBuiltinModuleDefs()` | `scene/motion/motion-modules/registry:421` | 内置模块定义聚合（供 initMotionModules 批量注册，消除 6 个 registerXxx 分散调用）。 |
| `getConflictCount()` | `scene/motion/motion-modules/registry:326` | 获取某模型冲突总数（骨骼数） |
| `getModuleConflicts()` | `scene/motion/motion-modules/registry:291` | 获取某模块被其他模块抢占的骨骼明细（loser 视角：本模块想要但被谁抢） |
| `getModuleDefaultParam()` | `scene/motion/motion-modules/registry:221` | [doc:adr-116] 读取模块注册的默认参数值。 |
| `getModuleState()` | `scene/motion/motion-modules/registry:165` | 获取动作的模块配置（不存在则创建默认状态，种入 defaults）。 |
| `getOwnedBones()` | `scene/motion/motion-modules/registry:271` | 获取模块当前 owned 的骨骼（disable 时用于精确清除） |
| `getRegisteredModules()` | `scene/motion/motion-modules/registry:63` | 获取所有已注册模块的元信息（按优先级排序） |
| `initMotionModules()` | `scene/motion/motion-modules/registry:433` | 注册所有内置模块（幂等，重复调用安全） |
| `registerModule()` | `scene/motion/motion-modules/registry:39` | 注册一个动作覆盖模块。 |
| `releaseOwnedBones()` | `scene/motion/motion-modules/registry:331` | 释放模块的 ownedBones 记录并级联清引擎槽（由 store.releaseBones 负责清除） |
| `setModuleEnabled()` | `scene/motion/motion-modules/registry:243` | 设置模块启用/禁用状态到场景动作意图 |
| `setModuleParam()` | `scene/motion/motion-modules/registry:227` | 写入模块参数到场景动作意图 |
| `setTargetModel()` | `scene/motion/motion-modules/registry:343` | 切换目标模型：禁用当前模型的所有模块覆盖，启用新模型已保存的模块状态。 |
| `unregisterModule()` | `scene/motion/motion-modules/registry:52` | 注销模块 |
| `RIDING_MODEL_DEF()` | `scene/motion/motion-modules/riding-model:291` | 骑行模型模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） |
| `createRidingModelModule()` | `scene/motion/motion-modules/riding-model:193` | 创建骑行模型模块实例 |
| `ModuleDef()` | `scene/motion/motion-modules/types:51` | 模块注册定义（工厂 + 元信息 + 优先级），用于 BUILTIN_MODULE_DEFS 批量注册 |
| `ModuleFactory()` | `scene/motion/motion-modules/types:48` | 模块工厂函数：接受 modelId，返回绑定到该模型的模块实例。 |
| `ModuleMeta()` | `scene/motion/motion-modules/types:9` | 模块元信息 |
| `MotionOverrideModule()` | `scene/motion/motion-modules/types:24` | [doc:adr-116] 动作覆盖模块接口 模块是无状态转换器的壳：状态存储在 ModelInstance.motionOverrideModules 中， 模块实例负责「语义参 |
| `FrameContext()` | `scene/motion/motion-pipeline:14` | 帧上下文，由各层按需取用。调度器内核不依赖其中任何字段。 |
| `MotionPipeline()` | `scene/motion/motion-pipeline:55` | — |
| `PipelineLayer()` | `scene/motion/motion-pipeline:35` | 单个管线层。 |
| `PipelineStage()` | `scene/motion/motion-pipeline:27` | 管线阶段。顺序来自 ADR-116 §一 的 6 层动作管线； Ragdoll(④) 已于 ADR-061 永久移除，此处省略。 |
| `__resetMotionPipelineForTest()` | `scene/motion/motion-pipeline:150` | [fix:round14 P2] 测试/HMR 场景下重置管线单例。 |
| `getMotionPipeline()` | `scene/motion/motion-pipeline:138` | — |
| `_applyBalanceSway()` | `scene/motion/perception-balance:49` | — |
| `_resetBalanceSwayState()` | `scene/motion/perception-balance:38` | 重置增量状态到默认值（每个模型 context 独立持有 balanceState，避免跨模型污染） |
| `_applyBlinking()` | `scene/motion/perception-blinking:16` | — |
| `_applyBreathing()` | `scene/motion/perception-breathing:23` | — |
| `_updateBoneChain()` | `scene/motion/perception-breathing:74` | — |
| `_applyMicroExpression()` | `scene/motion/perception-expression:21` | — |
| `_applyEyeGazeJS()` | `scene/motion/perception-gaze-js:65` | JS 模式：眼部跟随（薄包装：调用 core + 注入 JS 写入策略） |
| `_applyHeadGazeJS()` | `scene/motion/perception-gaze-js:55` | JS 模式：头部跟随（薄包装：调用 core + 注入 JS 写入策略） |
| `_applyEyeGazeWasm()` | `scene/motion/perception-gaze-wasm:60` | WASM 模式：眼部跟随（薄包装：调用 core + 注入 WASM 写入策略） |
| `_applyHeadGazeWasm()` | `scene/motion/perception-gaze-wasm:50` | WASM 模式：头部跟随（薄包装：调用 core + 注入 WASM 写入策略） |
| `EYE_BONE_CANDIDATES()` | `scene/motion/perception-gaze:455` | 眼球骨骼候选名（JS/WASM 路径共用） |
| `EyeGazeWriteStrategy()` | `scene/motion/perception-gaze:216` | 眼部跟随写入策略（JS/WASM 各自实现） |
| `HEAD_BONE_CANDIDATES()` | `scene/motion/perception-gaze:453` | 头部骨骼候选名（JS/WASM 路径共用） |
| `HeadGazeWriteStrategy()` | `scene/motion/perception-gaze:197` | 头部跟随写入策略（JS/WASM 各自实现） |
| `_applyEyeGazeCore()` | `scene/motion/perception-gaze:296` | 眼部跟随共用骨架（eyeCenter → lookDir → targetWorldQ → 每眼 clamp/Slerp/cache → strategy.writeEye） |
| `_applyGaze()` | `scene/motion/perception-gaze:383` | 统一调度入口（perception.ts observer 调用） |
| `_applyHeadGazeCore()` | `scene/motion/perception-gaze:235` | 头部跟随共用骨架（lookDir → targetWorldQ → clamp → Slerp → cache → strategy.writeHead） |
| `_clampEyeGazeTarget()` | `scene/motion/perception-gaze:178` | 眼球专用包装（相对头部坐标系，用更紧的生理锥形） |
| `_clampGazeTargetInParentFrame()` | `scene/motion/perception-gaze:55` | 将"转向相机的目标世界旋转"钳制在相对父骨骼坐标系的 yaw/pitch 锥形内。 |
| `_clampHeadGazeTarget()` | `scene/motion/perception-gaze:163` | 头部专用包装（维持已有回归测试签名不变） |
| `_getGazeTarget()` | `scene/motion/perception-gaze:136` | 获取视线目标点（AR 模式沿相机朝向投射，普通模式用相机位置） |
| `applyGazeWasm()` | `scene/motion/perception-gaze:467` | WASM 模式下的 gaze 应用（供 wasm-layers-blender.ts 调用） |
| `getEyeGazeMaxPitch()` | `scene/motion/perception-gaze:36` | — |
| `getEyeGazeMaxYaw()` | `scene/motion/perception-gaze:36` | — |
| `getEyeGazeSmooth()` | `scene/motion/perception-gaze:36` | — |
| `_applyLipSync()` | `scene/motion/perception-lipsync:52` | — |
| `_disposeLipSyncRuntime()` | `scene/motion/perception-lipsync:48` | 释放指定模型的 lip-sync 运行时（模型移除时调用，防 Map 泄漏） |
| `_applyPerceptionForContext()` | `scene/motion/perception-observer:57` | 对单个 context 应用完整感知管线 |
| `_getActiveContextsByTier()` | `scene/motion/perception-observer:32` | [doc:adr-164] 根据 tier 返回应激活的 context 列表 |
| `getMediumMaxOthers()` | `scene/motion/perception-observer:27` | 获取 medium 档非焦点模型上限 |
| `BalanceSwayState()` | `scene/motion/perception-shared:282` | 重心微动增量状态（供 PerceptionContext.lastOffsets.balance 使用） |
| `DEFAULT_PERCEPTION_STATE()` | `scene/motion/perception-shared:47` | — |
| `Emotion()` | `scene/motion/perception-shared:13` | 情绪类型（微表情驱动） |
| `GazeCache()` | `scene/motion/perception-shared:294` | Gaze 跨帧缓存：头部存世界 Q，眼部存本地 Q（相对父骨骼，避免头部旋转后缓存过期） |
| `GazeConfig()` | `scene/motion/perception-shared:45` | Gaze 配置类型 |
| `MeshMetadata()` | `scene/motion/perception-shared:74` | — |
| `MmdModelLike()` | `scene/motion/perception-shared:79` | MMD 模型最小接口（供 perception 子系统使用，避免 any） |
| `PerceptionContext()` | `scene/motion/perception-shared:300` | 每模型感知上下文（替代原单例，支持焦点 + pinned 多模型） |
| `PerceptionPerfMonitor()` | `scene/motion/perception-shared:320` | 感知层性能监控器：三档自动降级 + 手动覆盖 |
| `PerceptionPool()` | `scene/motion/perception-shared:100` | 单 context 对象池（per-model 隔离，解决全局池覆写污染） |
| `PerceptionState()` | `scene/motion/perception-shared:15` | — |
| `PerceptionTier()` | `scene/motion/perception-shared:317` | — |
| `_createPerceptionPool()` | `scene/motion/perception-shared:110` | 创建单 context 对象池 |
| `_gazeAlpha()` | `scene/motion/perception-shared:259` | 计算 gaze Slerp alpha（基于 deltaTime 的指数衰减，帧率无关） |
| `_gazeLog()` | `scene/motion/perception-shared:463` | — |
| `_incGazeLogFrame()` | `scene/motion/perception-shared:460` | — |
| `_isWasmRuntime()` | `scene/motion/perception-shared:220` | — |
| `_m()` | `scene/motion/perception-shared:151` | — |
| `_propagateChildrenWasm()` | `scene/motion/perception-shared:187` | 递归传播子骨骼 worldMatrix |
| `_q()` | `scene/motion/perception-shared:161` | — |
| `_qAngleDeg()` | `scene/motion/perception-shared:472` | 两四元数夹角（度） |
| `_resetContextPool()` | `scene/motion/perception-shared:133` | 重置当前池的 index（context 切换时重置，避免跨帧累积） |
| `_setContextPool()` | `scene/motion/perception-shared:128` | 切换到指定 context 的池（进入该 context 感知管线前调用） |
| `_v3()` | `scene/motion/perception-shared:141` | — |
| `_writeMatToBuffer()` | `scene/motion/perception-shared:175` | 把 Matrix 写回 Float32Array(16) |
| `feetDebug()` | `scene/motion/perception-shared:481` | — |
| `getEyeGazeMaxPitch()` | `scene/motion/perception-shared:245` | 获取眼部跟随最大俯仰角（弧度） |
| `getEyeGazeMaxYaw()` | `scene/motion/perception-shared:241` | 获取眼部跟随最大偏航角（弧度） |
| `getEyeGazeSmooth()` | `scene/motion/perception-shared:249` | 获取眼部跟随平滑度 |
| `getHeadGazeMaxPitch()` | `scene/motion/perception-shared:237` | 获取头部跟随最大俯仰角（弧度） |
| `getHeadGazeMaxYaw()` | `scene/motion/perception-shared:233` | 获取头部跟随最大偏航角（弧度） |
| `isWasmRuntime()` | `scene/motion/perception-shared:216` | 判断骨骼是否运行在 WASM runtime（无 updateWorldMatrix 方法）。 |
| `setGazeAngles()` | `scene/motion/perception-shared:265` | 更新头部跟随角度限位（度→弧度，由 perception.ts setter 调用） |
| `BalanceSwayState()` | `scene/motion/perception:58` | — |
| `Emotion()` | `scene/motion/perception:58` | — |
| `GazeConfig()` | `scene/motion/perception:58` | — |
| `PerceptionContext()` | `scene/motion/perception:58` | — |
| `PerceptionState()` | `scene/motion/perception:58` | — |
| `__testOnlyGetContext()` | `scene/motion/perception:809` | 测试用：获取指定模型的 context（含 lastOffsets） |
| `_clampEyeGazeTarget()` | `scene/motion/perception:59` | — |
| `_clampHeadGazeTarget()` | `scene/motion/perception:59` | — |
| `_getGazeResetTick()` | `scene/motion/perception:382` | 获取 gaze 重置计数（供测试验证调用时机） |
| `_isWasmRuntime()` | `scene/motion/perception:59` | — |
| `_propagateChildrenWasm()` | `scene/motion/perception:59` | — |
| `_resetGazeState()` | `scene/motion/perception:387` | 重置 gaze 增量状态（清理跨帧缓存，避免切换/开关后出现跳跃） |
| `_writeMatToBuffer()` | `scene/motion/perception:59` | — |
| `activatePerception()` | `scene/motion/perception:316` | 激活感知层（呼吸/眨眼/gaze） |
| `applyGazeWasm()` | `scene/motion/perception:59` | — |
| `deactivatePerception()` | `scene/motion/perception:396` | 注销感知层 |
| `disableAllPerception()` | `scene/motion/perception:723` | 全员关闭感知层（仅焦点 + pinned 保留） |
| `enableAllPerception()` | `scene/motion/perception:697` | 全员激活感知层（受 tier 限制） |
| `getPerceptionPerfManualTier()` | `scene/motion/perception:760` | [doc:adr-164] 获取手动档位设置（'auto' 表示自动降级模式） |
| `getPerceptionPerfTier()` | `scene/motion/perception:755` | 获取当前性能档位 |
| `getPerceptionState()` | `scene/motion/perception:424` | 获取感知状态（焦点 context 状态，兼容旧 API） |
| `getPerceptionStateFor()` | `scene/motion/perception:682` | 获取感知状态（场景级单例；参数对所有模型一致，modelId 参数保留仅为兼容旧调用） |
| `getPinnedModelIds()` | `scene/motion/perception:675` | 获取当前 pinned 模型 ID 列表 |
| `isAllPerceptionEnabled()` | `scene/motion/perception:771` | [doc:adr-164] 获取全员感知开关状态 |
| `onPerceptionModelRemoved()` | `scene/motion/perception:814` | 兼容接口：模型移除时清理（供 proc-motion-bridge.ts 调用） |
| `pinPerception()` | `scene/motion/perception:627` | [doc:adr-164] pin 模型感知（原 ≤5 上限已移除，全员感知由 tier 控制）。 |
| `setAllPerceptionEnabled()` | `scene/motion/perception:776` | [doc:adr-164] 设置全员感知开关状态 |
| `setBalanceSwayAmplitude()` | `scene/motion/perception:512` | 设置重心微动振幅（全局乘数，钳制 0–2.0） |
| `setBalanceSwayEnabled()` | `scene/motion/perception:500` | 设置重心微动开关（[doc:adr-079] Phase 2） |
| `setBalanceSwayPeriod()` | `scene/motion/perception:506` | 设置重心微动周期（秒，钳制 0.5–5.0） |
| `setBlinkAmplitude()` | `scene/motion/perception:568` | 设置眨眼幅度（0–1，钳制） |
| `setBlinkEnabled()` | `scene/motion/perception:474` | 设置眨眼开关 |
| `setBlinkFrequency()` | `scene/motion/perception:562` | 设置眨眼频率（Hz，钳制 0.05–0.5） |
| `setBreathAmplitude()` | `scene/motion/perception:556` | 设置呼吸幅度（弧度，钳制 0–0.05） |
| `setBreathEnabled()` | `scene/motion/perception:468` | 设置呼吸开关 |
| `setBreathFrequency()` | `scene/motion/perception:550` | 设置呼吸频率（Hz，钳制 0.1–1.0） |
| `setEmotion()` | `scene/motion/perception:518` | 设置情绪类型 |
| `setEyeGazeMaxPitch()` | `scene/motion/perception:595` | 设置眼部跟随最大俯仰角（度，钳制 0–15） |
| `setEyeGazeMaxYaw()` | `scene/motion/perception:588` | 设置眼部跟随最大偏航角（度，钳制 0–15） |
| `setEyeGazeSmooth()` | `scene/motion/perception:602` | 设置眼部跟随平滑度（0–1） |
| `setEyeTrackingEnabled()` | `scene/motion/perception:487` | 设置眼部跟随开关 |
| `setGazeConfig()` | `scene/motion/perception:789` | 兼容接口：设置 gaze 配置（供 proc-motion-bridge.ts 调用） |
| `setHeadGazeMaxPitch()` | `scene/motion/perception:581` | 设置头部跟随最大俯仰角（度，钳制 0–90） |
| `setHeadGazeMaxYaw()` | `scene/motion/perception:574` | 设置头部跟随最大偏航角（度，钳制 0–90） |
| `setHeadTrackingEnabled()` | `scene/motion/perception:480` | 设置头部跟随开关 |
| `setLipSyncEnabled()` | `scene/motion/perception:524` | 设置 lip-sync 开关 |
| `setLipSyncIntensity()` | `scene/motion/perception:536` | 设置 lip-sync 强度（钳制 0..1） |
| `setLipSyncMultiMorphEnabled()` | `scene/motion/perception:542` | 设置多口型 morph 开关 |
| `setLipSyncSensitivity()` | `scene/motion/perception:530` | 设置 lip-sync 灵敏度（钳制 0..1） |
| `setMicroExpressionEnabled()` | `scene/motion/perception:494` | 设置微表情开关 |
| `setPerceptionPerfTier()` | `scene/motion/perception:765` | 手动设置性能档位（auto/high/medium/low） |
| `setPerceptionState()` | `scene/motion/perception:429` | 设置感知状态（从存储恢复时使用） |
| `setPerceptionStateFor()` | `scene/motion/perception:687` | 设置感知状态（场景级单例；参数对所有模型一致，modelId 参数保留仅为兼容旧调用） |
| `unpinPerception()` | `scene/motion/perception:648` | unpin 模型感知（非焦点模型同步 deactivate） |
| `PlaybackObservablesDispose()` | `scene/motion/playback:52` | — |
| `initPlaybackObservables()` | `scene/motion/playback:56` | — |
| `seekFromEvent()` | `scene/motion/playback:208` | — |
| `updatePlaybackUI()` | `scene/motion/playback:182` | — |
| `ProcMotionController()` | `scene/motion/proc-motion-bridge:40` | — |
| `activateGazeTracking()` | `scene/motion/proc-motion-bridge:121` | — |
| `createProcBeatDetector()` | `scene/motion/proc-motion-bridge:60` | — |
| `disposeProcMotion()` | `scene/motion/proc-motion-bridge:144` | 释放程序化动作模块全部资源并销毁单例。应用关闭 / 模块卸载时调用。 |
| `getBpmQuantizeEnabled()` | `scene/motion/proc-motion-bridge:112` | — |
| `getProcBeatDetector()` | `scene/motion/proc-motion-bridge:57` | — |
| `getProcMotionState()` | `scene/motion/proc-motion-bridge:81` | — |
| `isProcVmdActive()` | `scene/motion/proc-motion-bridge:54` | — |
| `onModelRemoved()` | `scene/motion/proc-motion-bridge:66` | — |
| `regenerateProcMotion()` | `scene/motion/proc-motion-bridge:127` | — |
| `setBpmQuantizeEnabled()` | `scene/motion/proc-motion-bridge:109` | — |
| `setGazeLayerActive()` | `scene/motion/proc-motion-bridge:124` | — |
| `setProcMotionBoneToggle()` | `scene/motion/proc-motion-bridge:87` | — |
| `setProcMotionBoneToggles()` | `scene/motion/proc-motion-bridge:94` | — |
| `setProcMotionEyeTrackingEnabled()` | `scene/motion/proc-motion-bridge:115` | — |
| `setProcMotionHeadTrackingEnabled()` | `scene/motion/proc-motion-bridge:118` | — |
| `setProcMotionIntensity()` | `scene/motion/proc-motion-bridge:75` | — |
| `setProcMotionInterpOverride()` | `scene/motion/proc-motion-bridge:103` | — |
| `setProcMotionMode()` | `scene/motion/proc-motion-bridge:72` | — |
| `setProcMotionSpeed()` | `scene/motion/proc-motion-bridge:78` | — |
| `setProcMotionState()` | `scene/motion/proc-motion-bridge:84` | — |
| `setProcMotionVpdApplyEnabled()` | `scene/motion/proc-motion-bridge:100` | — |
| `stopProcMotion()` | `scene/motion/proc-motion-bridge:63` | — |
| `updateProcMotion()` | `scene/motion/proc-motion-bridge:69` | — |
| `ProcMotionControllerBase()` | `scene/motion/proc-motion-controller:49` | — |
| `_clearVmdData()` | `scene/motion/proc-motion-controller:35` | 清除模型上的 vmdData/vmdName（纯工具函数，无状态依赖）。 |
| `ProcMotionParamsMixin()` | `scene/motion/proc-motion-params:50` | 参数 setter 群 mixin —— 混入 ProcMotionControllerBase。 |
| `_filterVmdBones()` | `scene/motion/vmd-layers:67` | 过滤 VMD 二进制数据，只保留指定骨骼的关键帧。 |
| `addGazeLayer()` | `scene/motion/vmd-layers:255` | 添加一个视线追踪（gaze）图层。 |
| `addVmdLayer()` | `scene/motion/vmd-layers:130` | 添加一个 VMD 图层到模型。 |
| `addVmdLayersFromPaths()` | `scene/motion/vmd-layers:180` | 批量添加 VMD 图层（场景恢复用）。 |
| `disposeVmdLayerState()` | `scene/motion/vmd-layers:732` | [fix P2] 模型销毁时清理 vmd-layers 模块级 per-model 状态。 |
| `getVmdLayers()` | `scene/motion/vmd-layers:715` | 获取模型的图层列表 |
| `rebuildCompositeAnimation()` | `scene/motion/vmd-layers:722` | 触发复合动画重建（程序化/外部修改 vmdData/vmdLayers 后调用）。 |
| `removeVmdLayer()` | `scene/motion/vmd-layers:292` | 移除一个 VMD 图层 |
| `setVmdLayerWeight()` | `scene/motion/vmd-layers:343` | 设置图层权重 |
| `toggleVmdLayer()` | `scene/motion/vmd-layers:318` | 切换图层启用/禁用 |
| `VMD_HEADER_MIN()` | `scene/motion/vmd-loader:47` | — |
| `VMD_SIGNATURE()` | `scene/motion/vmd-loader:46` | — |
| `isValidVmd()` | `scene/motion/vmd-loader:51` | 验证 ArrayBuffer 是否为合法 VMD 格式：检查签名前缀。 |
| `loadCameraVmdFromPath()` | `scene/motion/vmd-loader:309` | — |
| `loadVMDFromPath()` | `scene/motion/vmd-loader:179` | — |
| `loadVMDMotion()` | `scene/motion/vmd-loader:60` | — |
| `loadVPDPose()` | `scene/motion/vmd-loader:333` | — |
| `DEFAULT_LAYER_BONE_FILTER()` | `scene/motion/wasm-layers-blender:58` | — |
| `WasmLayerConfig()` | `scene/motion/wasm-layers-blender:60` | — |
| `addWasmLayer()` | `scene/motion/wasm-layers-blender:161` | — |
| `initWasmLayersBlender()` | `scene/motion/wasm-layers-blender:54` | 初始化 blender 的场景级依赖（必须在 setupWasmLayersBlender 之前调用）。 |
| `isWasmLayersBlenderActive()` | `scene/motion/wasm-layers-blender:156` | — |
| `removeWasmLayer()` | `scene/motion/wasm-layers-blender:186` | — |
| `setupWasmLayersBlender()` | `scene/motion/wasm-layers-blender:115` | — |
| `teardownWasmLayersBlender()` | `scene/motion/wasm-layers-blender:141` | — |
| `updateWasmLayerWeight()` | `scene/motion/wasm-layers-blender:199` | — |
| `DEFAULT_LAYER_BONE_FILTER()` | `scene/motion/wasm-layers-config:1` | — |
| `applyGroundCollision()` | `scene/physics/ground-collision:118` | 根据当前 envState 还原地面碰撞状态（运行时就绪 / 场景加载后调用）。 |
| `disableGroundCollision()` | `scene/physics/ground-collision:97` | 禁用地面碰撞：从所有世界移除并释放资源。 |
| `enableGroundCollision()` | `scene/physics/ground-collision:51` | 启用地面碰撞：注入静态地板刚体到所有物理世界。幂等。 |
| `isGroundCollisionEnabled()` | `scene/physics/ground-collision:44` | 地面碰撞是否处于启用状态 |
| `AttachmentAnchors()` | `scene/physics/physics-bridge:71` | — |
| `AttachmentFit()` | `scene/physics/physics-bridge:76` | — |
| `FrameUpdateFn()` | `scene/physics/physics-bridge:121` | — |
| `PerFrameUpdateRegistry()` | `scene/physics/physics-bridge:128` | 单一 onBeforeRenderObservable 调度多个按 key 注册的每帧回调。 |
| `autoFitAttachment()` | `scene/physics/physics-bridge:96` | 从模型尺寸启发式推算挂件几何参数。 |
| `findRuntimeBone()` | `scene/physics/physics-bridge:31` | 在模型 runtimeBones 中按名查找。WASM / JS runtime 都暴露 runtimeBones，故后端无关。 |
| `getBoneLocalMatrix()` | `scene/physics/physics-bridge:48` | 取骨骼在 rootMesh **局部坐标系**下的矩阵（列主序 Float32Array[16]），用于挂件锚点跟随。 |
| `getBoneWorldPosition()` | `scene/physics/physics-bridge:56` | 从骨骼局部矩阵提取世界位置（米，场景单位）。 |
| `SkirtAnalysisResult()` | `scene/physics/skirt-analyzer:40` | — |
| `SkirtAnalyzerOptions()` | `scene/physics/skirt-analyzer:55` | — |
| `SkirtChain()` | `scene/physics/skirt-analyzer:35` | — |
| `SkirtSegment()` | `scene/physics/skirt-analyzer:24` | — |
| `analyzeSkirt()` | `scene/physics/skirt-analyzer:156` | 分析 mesh 拓扑，识别裙摆区域并生成虚拟骨骼链。 |
| `QUALITY_PRESETS()` | `scene/physics/virtual-skirt:77` | — |
| `VirtualSkirtConfig()` | `scene/physics/virtual-skirt:39` | — |
| `VirtualSkirtController()` | `scene/physics/virtual-skirt:173` | 虚拟裙骨物理控制器。 |
| `VirtualSkirtQuality()` | `scene/physics/virtual-skirt:63` | 质量档位：auto 按平台自动解析，其余为固定档 |
| `defaultVirtualSkirtConfig()` | `scene/physics/virtual-skirt:127` | — |
| `localToWorld()` | `scene/physics/virtual-skirt:106` | 局部坐标 → 世界坐标（点变换，含平移）。 |
| `resolveVirtualSkirtQuality()` | `scene/physics/virtual-skirt:88` | Phase 5: 解析有效质量档位。 |
| `worldDeltaToLocal()` | `scene/physics/virtual-skirt:119` | 世界位移向量 → 局部位移向量（仅取旋转/缩放分量，忽略平移）。 |
| `_getBundles()` | `scene/physics/wind-physics:43` | — |
| `disposeWindPhysics()` | `scene/physics/wind-physics:205` | 销毁风力物理注入。 |
| `initWindPhysics()` | `scene/physics/wind-physics:147` | 初始化风力物理注入。 |
| `isWindPhysicsActive()` | `scene/physics/wind-physics:226` | 当前运行时是否实际启用了风力物理（WASM Bullet）。 |
| `retryWindPhysicsSubscription()` | `scene/physics/wind-physics:166` | [adr-104] 模型加载成功后由 model-loader 显式调用，重试订阅 physics impl （此时 physics impl 已就绪）。替代原 monkey-pa |
| `CAMERA_PRESETS()` | `scene/pose/camera-angle:23` | 预设相机角度列表 |
| `CameraAnglePreset()` | `scene/pose/camera-angle:10` | 预设角度定义 |
| `applyCameraPreset()` | `scene/pose/camera-angle:68` | 切换到指定预设角度。 |
| `getAllPresets()` | `scene/pose/camera-angle:85` | 获取所有预设的列表（用于 UI 展示）。 |
| `presetCameraAlpha()` | `scene/pose/camera-angle:58` | 计算某预设对应的相机 alpha（弧度），以聚焦模型朝向为参考。 |
| `CompositionMode()` | `scene/pose/composition-guide:10` | 构图辅助线模式。 |
| `GuideLine()` | `scene/pose/composition-guide:13` | 单条辅助线段（SVG 坐标 + 样式）。 |
| `getGuideLines()` | `scene/pose/composition-guide:28` | 计算某模式的辅助线段列表（纯函数，可独立测试）。 |
| `getGuideMode()` | `scene/pose/composition-guide:70` | 获取当前的辅助线模式。 |
| `setGuideMode()` | `scene/pose/composition-guide:78` | 设置构图辅助线模式。 |
| `DEFAULT_WATERMARK()` | `scene/pose/watermark:19` | — |
| `WatermarkConfig()` | `scene/pose/watermark:6` | — |
| `WatermarkPosition()` | `scene/pose/watermark:41` | 水印文字锚点计算结果。 |
| `applyWatermark()` | `scene/pose/watermark:93` | 在 base64 图片数据上叠加水印。 |
| `computeWatermarkPosition()` | `scene/pose/watermark:51` | 计算水印文字绘制位置（纯函数，可独立测试）。 |
| `getWatermarkConfig()` | `scene/pose/watermark:31` | 获取当前水印配置。 |
| `setWatermarkConfig()` | `scene/pose/watermark:36` | 设置水印配置（部分更新）。 |
| `LightConeEntry()` | `scene/render/light-cone:74` | — |
| `createLightCone()` | `scene/render/light-cone:162` | 为聚光灯创建光锥。 |
| `disposeLightCone()` | `scene/render/light-cone:249` | 释放光锥资源（先 mesh 后 material，避免 mesh.dispose 内部引用已释放材质） |
| `rebuildLightConeGeometry()` | `scene/render/light-cone:217` | 锥长/锥角变化时重建几何 |
| `setLightConeEnabled()` | `scene/render/light-cone:244` | 设置光锥可见性 |
| `updateLightConeTransform()` | `scene/render/light-cone:189` | 更新光锥的 transform（位置/朝向），每帧或灯光移动时调用 |
| `updateLightConeUniforms()` | `scene/render/light-cone:203` | 更新光锥的 shader uniforms（颜色/亮度/柔和度） |
| `DEFAULT_PERSONAL_LIGHT()` | `scene/render/lighting-follow:71` | — |
| `PersonalLightSettings()` | `scene/render/lighting-follow:33` | — |
| `attachPersonalLight()` | `scene/render/lighting-follow:170` | — |
| `detachPersonalLight()` | `scene/render/lighting-follow:295` | — |
| `disposeAllPersonalLights()` | `scene/render/lighting-follow:442` | — |
| `getAllPersonalLights()` | `scene/render/lighting-follow:451` | 导出所有个人灯状态（仅非默认值差异落盘由调用方决定） |
| `getPersonalLightDefault()` | `scene/render/lighting-follow:125` | 获取用户保存的个人灯默认值，无则返回 null。 |
| `getPersonalLightState()` | `scene/render/lighting-follow:347` | 返回设置深拷贝（含 color 数组，避免外部误改绕过 setPersonalLightState 的灯同步） |
| `resetPersonalLightDefault()` | `scene/render/lighting-follow:130` | 重置用户默认值回出厂硬编码值。 |
| `restorePersonalLights()` | `scene/render/lighting-follow:463` | 场景反序列化后，按 modelId 恢复个人灯设置（attach 已由 onModelLoaded 触发，此处仅覆盖参数） |
| `setPersonalLightDefault()` | `scene/render/lighting-follow:115` | 将当前个人灯参数保存为用户默认值。 |
| `setPersonalLightState()` | `scene/render/lighting-follow:310` | — |
| `tickPersonalLights()` | `scene/render/lighting-follow:352` | — |
| `tickStageLightFollow()` | `scene/render/lighting-follow:502` | 舞台灯追光 tick：更新所有绑定了 followTarget 的舞台灯 |
| `LIGHTING_PRESETS()` | `scene/render/lighting-presets:21` | — |
| `LightingPreset()` | `scene/render/lighting-presets:12` | — |
| `LightingPresetLight()` | `scene/render/lighting-presets:6` | — |
| `PRESET_NAMES()` | `scene/render/lighting-presets:175` | 预设名称列表（有序） |
| `_addAllMeshesToShadow()` | `scene/render/lighting-shadow:14` | 遍历所有模型的 Mesh，加入阴影生成器。 |
| `_disposeStageShadow()` | `scene/render/lighting-shadow:100` | — |
| `_ensureShadow()` | `scene/render/lighting-shadow:25` | — |
| `_ensureStageShadow()` | `scene/render/lighting-shadow:59` | — |
| `rebuildShadowCasters()` | `scene/render/lighting-shadow:54` | 当模型/道具注册表更新时，重新生成阴影投射者列表。 |
| `_createStageLight()` | `scene/render/lighting-stage:43` | — |
| `_disposeStageLightEntry()` | `scene/render/lighting-stage:283` | 释放单个舞台灯 entry 的全部资源（指示器 + 灯 + 阴影 + 光锥）。 |
| `_updateIndicator()` | `scene/render/lighting-stage:123` | — |
| `addStageLight()` | `scene/render/lighting-stage:298` | — |
| `getActiveStageLightId()` | `scene/render/lighting-stage:201` | — |
| `getStageLightState()` | `scene/render/lighting-stage:211` | — |
| `getStageLights()` | `scene/render/lighting-stage:193` | — |
| `loadStageLights()` | `scene/render/lighting-stage:349` | 批量加载舞台灯（反序列化用），会清空现有灯 |
| `rebuildStageLightShadows()` | `scene/render/lighting-stage:395` | 重建所有舞台灯的阴影投射者列表（模型/道具变化时调用） |
| `removeStageLight()` | `scene/render/lighting-stage:329` | — |
| `setActiveStageLightId()` | `scene/render/lighting-stage:205` | — |
| `setStageLightState()` | `scene/render/lighting-stage:219` | — |
| `CONE_UPDATE_KEYS()` | `scene/render/lighting-state:73` | — |
| `LightingStateValues()` | `scene/render/lighting-state:32` | — |
| `LightingTween()` | `scene/render/lighting-state:27` | — |
| `SHADOW_REBUILD_KEYS()` | `scene/render/lighting-state:65` | — |
| `SUN_DISC_DISTANCE()` | `scene/render/lighting-state:92` | — |
| `SUN_DISC_MIN_INTENSITY()` | `scene/render/lighting-state:95` | 太阳圆盘可见的最小方向光强度。低于此值时隐藏。 |
| `StageLightEntry()` | `scene/render/lighting-state:20` | — |
| `lightingState()` | `scene/render/lighting-state:97` | — |
| `_disposeSunDisc()` | `scene/render/lighting-sun:51` | — |
| `_updateSunDisc()` | `scene/render/lighting-sun:30` | 更新方向光参考圆盘位置和颜色。圆盘始终在光线来源方向（视线反方向）。 |
| `_cancelAllLightingTweens()` | `scene/render/lighting-tween:13` | — |
| `_tweenColor3()` | `scene/render/lighting-tween:59` | — |
| `_tweenValue()` | `scene/render/lighting-tween:20` | — |
| `applyLightingPresetFromEnv()` | `scene/render/lighting-tween:87` | 应用灯光预设——复用现有灯光，平滑过渡参数。 |
| `LightState()` | `scene/render/lighting:37` | — |
| `StageLightState()` | `scene/render/lighting:55` | — |
| `StageLightType()` | `scene/render/lighting:53` | — |
| `_defaultStageLightState()` | `scene/render/lighting:105` | — |
| `disposeLighting()` | `scene/render/lighting:520` | 整体清理光照模块（场景销毁时调用） |
| `getDirLight()` | `scene/render/lighting:149` | 主方向光（未初始化时为 null）。 |
| `getHemiLight()` | `scene/render/lighting:144` | 主半球光（未初始化时为 null）。导出 getter 替代原 &#96;export let&#96;，消除导出可变绑定。 |
| `getLightState()` | `scene/render/lighting:257` | — |
| `initLighting()` | `scene/render/lighting:158` | — |
| `isLightingReady()` | `scene/render/lighting:303` | [fix:P1] 灯光运行时是否就绪（@dom/e2e 环境无灯光/管线时返回 false，供 UI/测试预检跳过守卫域）。 |
| `rebakeEnvBrightness()` | `scene/render/lighting:233` | [doc:adr-132] 当 envBrightness 变化时 rebake 存储的光照强度 |
| `setLightState()` | `scene/render/lighting:342` | 写入灯光状态。守卫未就绪时 logWarn + 返回 false（不再静默吞写）， 使「UI 可操作但 state 未生效」可被观测（@dom 测试环境无灯光对象时会命中）。 |
| `setSkipLightAutoSave()` | `scene/render/lighting:154` | 预设动画期间临时抑制 setLightState 内的自动保存，由 applyEnvPreset 控制 |
| `transitionLighting()` | `scene/render/lighting:432` | 平滑过渡当前灯光到目标灯光参数，默认 2 秒。 |
| `isAutoDegradingReflection()` | `scene/render/performance-env-bridge:18` | env-bridge.ts 调用此函数检查当前是否处于自动降级反射质量变更中 |
| `registerSetEnvState()` | `scene/render/performance-env-bridge:26` | env-bridge.ts 初始化时注册 setEnvState 函数 |
| `setAutoDegradingReflection()` | `scene/render/performance-env-bridge:13` | performance.ts 调用此函数通知 env-bridge 当前反射质量变更来自自动降级 |
| `setEnvStateForPerformance()` | `scene/render/performance-env-bridge:33` | performance.ts 调用此函数设置 envState（延迟绑定，避免循环导入） |
| `PerformanceMode()` | `scene/render/performance:44` | — |
| `RenderBridge()` | `scene/render/performance:19` | — |
| `getCurrentDegradeLevel()` | `scene/render/performance:622` | — |
| `getPerfRenderScaleMul()` | `scene/render/performance:83` | 降级系统对 renderScale 的乘数（1.0=无影响，0.7=降级时降至 70%）。 |
| `getPerformanceMode()` | `scene/render/performance:618` | — |
| `isSnapshotResetSuppressed()` | `scene/render/performance:88` | 供 setLightState/setRenderState 检查是否应跳过 resetPerformanceSnapshot。 |
| `recalcPerformanceReference()` | `scene/render/performance:480` | 重新计算刷新率基准（外接显示器变化时由 render-loop resize 触发）。 |
| `registerRenderBridge()` | `scene/render/performance:34` | ADR-159 P3-A：延迟绑定渲染桥接，由 scene.ts 在 initScene() 时注入。 |
| `resetPerformanceSnapshot()` | `scene/render/performance:630` | 重置性能快照（用户手动修改渲染/光照设置后调用）。 |
| `setPerformanceMode()` | `scene/render/performance:590` | 设置性能模式。 |
| `updatePerformance()` | `scene/render/performance:498` | 每帧调用（渲染循环内）。 |
| `QualityDimension()` | `scene/render/quality-profile:22` | 质量维度定义。 |
| `QualityProfile()` | `scene/render/quality-profile:12` | — |
| `QualityProfileSettings()` | `scene/render/quality-profile:60` | 从注册表派生 QualityProfileSettings 类型。 |
| `inferQualityProfile()` | `scene/render/quality-profile:85` | 从 EnvState 的独立质量字段反推当前 qualityProfile。 |
| `resolveQualityProfile()` | `scene/render/quality-profile:70` | 将 qualityProfile 解析为各域质量设置。 |
| `RenderState()` | `scene/render/renderer:36` | — |
| `ToneMappingMode()` | `scene/render/renderer:28` | — |
| `defaultRenderState()` | `scene/render/renderer:234` | — |
| `disposeRenderer()` | `scene/render/renderer:146` | 释放渲染管线及相关资源。在场景销毁时调用。 |
| `getRenderState()` | `scene/render/renderer:186` | — |
| `initRenderer()` | `scene/render/renderer:114` | — |
| `isRenderReady()` | `scene/render/renderer:656` | [fix:P1] 渲染管线是否就绪（@dom/e2e 环境无 pipeline/scene 时返回 false，供 UI/测试预检跳过守卫域）。 |
| `isRendererReady()` | `scene/render/renderer:141` | 检查渲染器是否已初始化。外部代码在调用 setRenderState 前可先检查。 |
| `isSSRActive()` | `scene/render/renderer:957` | SSR 管线当前是否激活（供 env-reflection 检查，尊重用户手动关闭）。 |
| `pipeline()` | `scene/render/renderer:82` | — |
| `reattachPipeline()` | `scene/render/renderer:899` | Re-attach the rendering pipeline to the current active camera (call after camera switch). |
| `rebuildOutlineState()` | `scene/render/renderer:1016` | 当模型注册表更新时，重新应用边缘高亮状态。 |
| `registerCelGroundCoupling()` | `scene/render/renderer:106` | — |
| `setRenderState()` | `scene/render/renderer:686` | — |
| `setSSRFromReflection()` | `scene/render/renderer:969` | 反射系统专用 SSR 控制接口（不触发 auto-save）。 |
| `transitionRenderState()` | `scene/render/renderer:726` | 平滑过渡渲染状态到目标值，默认 2 秒。 |
| `GizmoAttachOptions()` | `scene/render/transform-gizmo:106` | — |
| `GizmoType()` | `scene/render/transform-gizmo:17` | — |
| `attachGizmo()` | `scene/render/transform-gizmo:126` | 为指定 Node 激活变换 Gizmo。 |
| `computeSnapDistance()` | `scene/render/transform-gizmo:85` | 纯函数：给定轴类型与吸附配置，计算吸附步长（场景单位）。 |
| `detachGizmo()` | `scene/render/transform-gizmo:222` | 移除当前 Gizmo。 |
| `getActiveGizmoTypes()` | `scene/render/transform-gizmo:274` | 获取当前激活的 Gizmo 轴类型组合（用于判断拖拽中是否在改缩放）。 |
| `getGizmoNode()` | `scene/render/transform-gizmo:269` | 获取当前 Gizmo 绑定的实时 Node（拖拽中其 transform 已被 Babylon 实时改写，供数值滑杆读取）。 |
| `getGizmoSnapConfig()` | `scene/render/transform-gizmo:310` | 读取当前网格吸附配置（enabled 默认 false，step 默认 1.0）。 |
| `getGizmoTargetId()` | `scene/render/transform-gizmo:264` | 获取当前 Gizmo 绑定的实体 ID。 |
| `initTransformGizmo()` | `scene/render/transform-gizmo:46` | — |
| `isGizmoActive()` | `scene/render/transform-gizmo:254` | 当前是否有 Gizmo 激活。 |
| `isGizmoDragging()` | `scene/render/transform-gizmo:259` | 当前是否正在拖拽 Gizmo（drag start → drag end 之间为 true）。 |
| `onGizmoDragObservable()` | `scene/render/transform-gizmo:42` | 拖拽进行中（连续）可观察量：任一 Gizmo 轴被拖动时每帧触发， 供数值滑杆实时同步显示（ADR-126 Phase 2 双模态）。 |
| `setGizmoSnapDistance()` | `scene/render/transform-gizmo:293` | 设置网格吸附配置。 |
| `exportSceneBundle()` | `scene/scene-bundle:136` | 导出场景为 bundle zip 文件。 |
| `importSceneBundle()` | `scene/scene-bundle:165` | 导入场景 bundle zip 文件。 |
| `migrateLipSyncFromOldState()` | `scene/scene-migrate:11` | 旧存档 lipSync → 新版 PerceptionState lipSync 字段。 |
| `migratePerceptionData()` | `scene/scene-migrate:46` | 旧存档 perception 格式迁移：PerceptionState → { focused, pinned }。 |
| `migratePerceptionFromProcMotion()` | `scene/scene-migrate:71` | 旧存档 ProcMotionState → 新版 PerceptionState 迁移。 |
| `SceneFile()` | `scene/scene-serialize:145` | — |
| `canUndo()` | `scene/scene-serialize:1304` | — |
| `deserializeScene()` | `scene/scene-serialize:964` | Restore scene state from a SceneFile. |
| `offerSceneUndo()` | `scene/scene-serialize:1348` | 破坏性操作后调用：弹出中性撤销 toast（复用 action-button toast，info 变体）。 |
| `offerSceneUndoAndRefresh()` | `scene/scene-serialize:1375` | offerSceneUndo 的常见变体：撤销恢复后执行 reRender 回调并统一提示 &#96;undoApplied&#96;。 |
| `popUndoSnapshot()` | `scene/scene-serialize:1309` | 弹出最近一次撤销快照（LIFO），供全局撤销按钮 / Ctrl+Z 使用。返回快照字符串，无快照时返回 null。 |
| `pushUndoSnapshot()` | `scene/scene-serialize:1290` | 破坏性操作前调用：抓当前整场景快照压栈（环形，上限 UNDO_LIMIT），返回快照字符串供撤销绑定。 |
| `resolvePathFromRef()` | `scene/scene-serialize:133` | Resolve a file path from either a libraryRef or a raw absolute path. |
| `restoreUndoSnapshot()` | `scene/scene-serialize:1325` | 恢复特定快照到整场景。返回是否成功恢复。 |
| `saveSceneImmediate()` | `scene/scene-serialize:1393` | — |
| `serializeScene()` | `scene/scene-serialize:501` | 序列化当前场景为 SceneFile（分段容错，单模型失败跳过并记录）。 |
| `setSuppressAutoSave()` | `scene/scene-serialize:1263` | — |
| `triggerAutoSaveImpl()` | `scene/scene-serialize:1272` | — |
| `tryRestoreLastScene()` | `scene/scene-serialize:1531` | — |
| `AlphaCtx()` | `scene/scene:171` | — |
| `CameraState()` | `scene/scene:918` | — |
| `DEFAULT_MAT_PARAMS()` | `scene/scene:147` | — |
| `EnvState()` | `scene/scene:881` | — |
| `LightState()` | `scene/scene:920` | — |
| `LoadLastScene()` | `scene/scene:919` | — |
| `MaterialCategory()` | `scene/scene:171` | — |
| `MaterialCategoryParams()` | `scene/scene:171` | — |
| `ModelInstance()` | `scene/scene:881` | — |
| `RenderState()` | `scene/scene:921` | — |
| `SaveLastScene()` | `scene/scene:919` | — |
| `SaveThumbnail()` | `scene/scene:919` | — |
| `SetEnvState()` | `scene/scene:919` | — |
| `StageLightState()` | `scene/scene:920` | — |
| `__envDebug()` | `scene/scene:361` | — |
| `_applyAll()` | `scene/scene:147` | — |
| `_catState()` | `scene/scene:147` | — |
| `_matEnabled()` | `scene/scene:147` | — |
| `_matState()` | `scene/scene:147` | — |
| `animateCameraVmd()` | `scene/scene:904` | — |
| `applyEnvState()` | `scene/scene:891` | — |
| `applyFrameControl()` | `scene/scene:261` | 统一应用帧率控制：帧率限制器开关 + 帧率上限。 |
| `applyMatSssState()` | `scene/scene:173` | — |
| `applyMatState()` | `scene/scene:147` | — |
| `applySss()` | `scene/scene:173` | — |
| `applyUnlitFallback()` | `scene/scene:147` | — |
| `autoFrame()` | `scene/scene:904` | — |
| `autoLoop()` | `scene/scene:862` | — |
| `canUndo()` | `scene/scene:883` | — |
| `captureThumbnail()` | `scene/scene:903` | — |
| `clearCameraVmd()` | `scene/scene:904` | — |
| `disposeModelSssState()` | `scene/scene:173` | — |
| `disposeScene()` | `scene/scene:293` | 级联释放 Scene → Engine 及其所有子资源。 |
| `dom()` | `scene/scene:862` | — |
| `engine()` | `scene/scene:234` | — |
| `envState()` | `scene/scene:862` | — |
| `focusedMmdModel()` | `scene/scene:379` | — |
| `focusedModel()` | `scene/scene:379` | — |
| `focusedModelId()` | `scene/scene:862` | — |
| `formatTime()` | `scene/scene:862` | — |
| `getCameraMode()` | `scene/scene:904` | — |
| `getCameraState()` | `scene/scene:904` | — |
| `getCameraVmdName()` | `scene/scene:904` | — |
| `getCameraVmdPath()` | `scene/scene:904` | — |
| `getMatCatGroups()` | `scene/scene:147` | — |
| `getMatCatParams()` | `scene/scene:147` | — |
| `getMatDetailList()` | `scene/scene:147` | — |
| `getMatParams()` | `scene/scene:147` | — |
| `getMatSssParams()` | `scene/scene:173` | — |
| `getMatSssState()` | `scene/scene:173` | — |
| `getMatState()` | `scene/scene:147` | — |
| `getMaterialCategory()` | `scene/scene:147` | — |
| `getScene()` | `scene/scene:848` | — |
| `hasCameraVmd()` | `scene/scene:904` | — |
| `initCameraSystem()` | `scene/scene:904` | — |
| `initLoader()` | `scene/scene:903` | — |
| `initPlaybackObservables()` | `scene/scene:861` | — |
| `initScene()` | `scene/scene:415` | 场景初始化入口。首次调用时创建 Scene/Engine/运行时； HMR 重入时先调用 _reinitSceneForHMR() 清理旧资源再重建。 |
| `isHeadless()` | `scene/scene:214` | — |
| `isMatCategoryAllEnabled()` | `scene/scene:147` | — |
| `isMatEnabled()` | `scene/scene:147` | — |
| `isPbrMaterial()` | `scene/scene:172` | — |
| `isPlaying()` | `scene/scene:862` | — |
| `loadCameraVmd()` | `scene/scene:904` | — |
| `loadCameraVmdFromPath()` | `scene/scene:855` | — |
| `loadPMXFile()` | `scene/scene:903` | — |
| `loadVMDFromPath()` | `scene/scene:855` | — |
| `loadVMDMotion()` | `scene/scene:855` | — |
| `loadVPDPose()` | `scene/scene:855` | — |
| `mmdRuntime()` | `scene/scene:862` | — |
| `modelManager()` | `scene/scene:352` | — |
| `modelRegistry()` | `scene/scene:862` | — |
| `normPath()` | `scene/scene:882` | — |
| `offerSceneUndo()` | `scene/scene:883` | — |
| `offerSceneUndoAndRefresh()` | `scene/scene:883` | — |
| `popUndoSnapshot()` | `scene/scene:883` | — |
| `pushUndoSnapshot()` | `scene/scene:883` | — |
| `resetMatCatParams()` | `scene/scene:147` | — |
| `resetPerMaterialParams()` | `scene/scene:147` | — |
| `resetSingleMatParams()` | `scene/scene:147` | — |
| `resolveFileUrl()` | `scene/scene:882` | — |
| `restoreUndoSnapshot()` | `scene/scene:883` | — |
| `scene()` | `scene/scene:245` | — |
| `seekDragging()` | `scene/scene:862` | — |
| `seekFromEvent()` | `scene/scene:861` | — |
| `setAutoLoop()` | `scene/scene:862` | — |
| `setCameraState()` | `scene/scene:904` | — |
| `setFocusedModelId()` | `scene/scene:862` | — |
| `setIsPlaying()` | `scene/scene:862` | — |
| `setMatCatParams()` | `scene/scene:147` | — |
| `setMatCategoryEnabled()` | `scene/scene:147` | — |
| `setMatEnabled()` | `scene/scene:147` | — |
| `setMatParams()` | `scene/scene:147` | — |
| `setMatSssParams()` | `scene/scene:173` | — |
| `setMmdRuntime()` | `scene/scene:862` | — |
| `setModelRegistry()` | `scene/scene:862` | — |
| `setSeekDragging()` | `scene/scene:862` | — |
| `setStatus()` | `scene/scene:862` | — |
| `setTriggerAutoSave()` | `scene/scene:880` | — |
| `switchCameraMode()` | `scene/scene:904` | — |
| `triggerAutoSave()` | `scene/scene:880` | — |
| `updatePlaybackUI()` | `scene/scene:861` | — |
| `ActionMenuCtx()` | `scene/shared/menu-node-types:16` | — |
| `ControlSpec()` | `scene/shared/menu-node-types:37` | — |
| `MenuKind()` | `scene/shared/menu-node-types:25` | — |
| `MenuNode()` | `scene/shared/menu-node-types:52` | — |
| `StatePath()` | `scene/shared/menu-node-types:8` | 状态路径：类型化字符串，由解析器按前缀映射到 reactive state 对象 |
| `_resetTextureLRUForTest()` | `scene/shared/texture-lru:104` | 仅供测试：重置缓存状态。 |
| `clearTextureLRU()` | `scene/shared/texture-lru:92` | 清空 LRU 缓存。在 disposeRenderer 中调用，释放所有缓存的纹理 ArrayBuffer。 |
| `readTextureWithLRU()` | `scene/shared/texture-lru:45` | 带 LRU 缓存的纹理读取。命中直接返回 ArrayBuffer，未命中则 readFileBytes 后缓存。 |
| `textureLRUSize()` | `scene/shared/texture-lru:99` | 返回当前缓存条目数（供测试使用）。 |
| `TransformAdapter()` | `scene/transform/transform-adapter:28` | — |
| `TransformCapability()` | `scene/transform/transform-adapter:26` | — |
| `attachGizmoForKind()` | `scene/transform/transform-adapter:69` | 统一 Gizmo 入口：替代三个 attachXxxGizmo。 |
| `detachGizmo()` | `scene/transform/transform-adapter:86` | — |
| `getActiveGizmoTypes()` | `scene/transform/transform-adapter:86` | — |
| `getGizmoNode()` | `scene/transform/transform-adapter:86` | — |
| `getGizmoSnapConfig()` | `scene/transform/transform-adapter:86` | — |
| `getGizmoTargetId()` | `scene/transform/transform-adapter:86` | — |
| `getTransformAdapter()` | `scene/transform/transform-adapter:61` | — |
| `isGizmoActive()` | `scene/transform/transform-adapter:86` | — |
| `isGizmoDragging()` | `scene/transform/transform-adapter:86` | — |
| `onGizmoDragObservable()` | `scene/transform/transform-adapter:86` | — |
| `registerTransformAdapter()` | `scene/transform/transform-adapter:55` | 注册变换适配器；同一适配器可声明多个 kind（如 actor + stage） |
| `setGizmoSnapDistance()` | `scene/transform/transform-adapter:86` | — |
| `isDragModeEnabled()` | `scene/transform/transform-mode:7` | — |
| `setDragModeEnabled()` | `scene/transform/transform-mode:11` | — |
| `TransformPickResult()` | `scene/transform/transform-pick:7` | — |
| `getTransformMetadata()` | `scene/transform/transform-pick:17` | — |
| `pickTransformTarget()` | `scene/transform/transform-pick:33` | — |
| `setTransformMetadata()` | `scene/transform/transform-pick:29` | — |
| `tryAttachGizmoFromPick()` | `scene/transform/transform-pick:54` | — |
| `TransformTarget()` | `scene/transform/transform-selection:12` | — |
| `clearSelectedTransformTarget()` | `scene/transform/transform-selection:42` | 清除选中并卸载 Gizmo（面板关闭/切换时调用）。 |
| `getSelectedTransformTarget()` | `scene/transform/transform-selection:21` | — |
| `retryPendingAttachment()` | `scene/transform/transform-selection:76` | 节点就绪后重试：面板渲染时若适配器节点尚未就绪（attachGizmoForKind 返回 false）， 已记录的选中物在节点就绪后调用本函数补挂一次（交叉审核 P3 节点就绪时 |
| `setSelectedTransformTarget()` | `scene/transform/transform-selection:32` | 声明当前选中物（面板详情渲染时调用）。若拖拽开关开则立即挂 Gizmo。 |
| `syncDragMode()` | `scene/transform/transform-selection:49` | 拖拽开关状态变化后同步：开→挂当前选中物；关→卸载。 |

## 菜单 & UI

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `showAssistant()` | `menus/assistant-panel:27` | — |
| `addAssistantMessage()` | `menus/diagnostic-chat:20` | 添加助手消息 |
| `buildChatSchema()` | `menus/diagnostic-chat:397` | 构建 chat schema（纯 DOM 构建） |
| `buildSystemMessage()` | `menus/diagnostic-chat:351` | 构造 system message |
| `finalizeStream()` | `menus/diagnostic-chat:260` | 流式完成收尾（非 dialogue 模式） |
| `finalizeStreamRow()` | `menus/diagnostic-chat:239` | 定格 streaming row（移除 streaming class + Markdown 渲染） |
| `pruneHistory()` | `menus/diagnostic-chat:319` | 历史截断 |
| `renderChat()` | `menus/diagnostic-chat:25` | 全量重绘对话区 |
| `renderDialogueCards()` | `menus/diagnostic-chat:295` | 渲染情绪卡片（台词模式） |
| `renderStreamingChunk()` | `menus/diagnostic-chat:178` | 流式追加 chunk 到当前 streaming row |
| `showPendingBubble()` | `menus/diagnostic-chat:155` | 显示"思考中"占位气泡 |
| `updateSendButton()` | `menus/diagnostic-chat:380` | 更新发送/停止按钮 |
| `updateSpeakToggle()` | `menus/diagnostic-chat:363` | 更新朗读开关 UI（不支持时隐藏） |
| `applyProvider()` | `menus/diagnostic-config:259` | — |
| `buildConfigSchema()` | `menus/diagnostic-config:473` | — |
| `goKeyAllowsProceed()` | `menus/diagnostic-config:30` | — |
| `loadInitialConfig()` | `menus/diagnostic-config:73` | — |
| `persistConfig()` | `menus/diagnostic-config:218` | — |
| `refreshCaps()` | `menus/diagnostic-config:100` | — |
| `refreshModelList()` | `menus/diagnostic-config:304` | — |
| `updateStatusBadge()` | `menus/diagnostic-config:370` | — |
| `advancePendingQueue()` | `menus/diagnostic-control:222` | 推进队列 |
| `applyPendingAction()` | `menus/diagnostic-control:160` | 应用 pending action |
| `cancelPendingAction()` | `menus/diagnostic-control:205` | 取消 pending action |
| `finalizePendingBatch()` | `menus/diagnostic-control:233` | 本批处理完成：回填 tool 消息，触发后续 stream |
| `handleControlFallback()` | `menus/diagnostic-control:28` | 处理 LLM 文本回退（无 tool_call 时） |
| `renderControlHint()` | `menus/diagnostic-control:44` | 渲染 pending 区域（仅有可撤销操作时显示） |
| `renderPendingAction()` | `menus/diagnostic-control:95` | 渲染待确认操作卡 |
| `tryQueuePendingAction()` | `menus/diagnostic-control:10` | 将 LLM 文本回退解析的 action 入待确认队列 |
| `undoLastAction()` | `menus/diagnostic-control:77` | 撤销上一个破坏性动作 |
| `buildSessionsSchema()` | `menus/diagnostic-session:127` | — |
| `createSession()` | `menus/diagnostic-session:73` | 由 entry point 调用——通过 callbacks 通知 UI 更新 |
| `deleteSessionAndAdjust()` | `menus/diagnostic-session:111` | — |
| `doPersistSession()` | `menus/diagnostic-session:18` | — |
| `flushSession()` | `menus/diagnostic-session:45` | — |
| `fmtTime()` | `menus/diagnostic-session:210` | — |
| `loadActiveSession()` | `menus/diagnostic-session:50` | — |
| `renderSessionList()` | `menus/diagnostic-session:142` | — |
| `schedulePersistSession()` | `menus/diagnostic-session:41` | — |
| `switchSession()` | `menus/diagnostic-session:84` | — |
| `DiagnosticState()` | `menus/diagnostic-state:19` | — |
| `PendingAction()` | `menus/diagnostic-state:8` | — |
| `PendingToolResult()` | `menus/diagnostic-state:14` | — |
| `diagState()` | `menus/diagnostic-state:93` | — |
| `buildCloudLevel()` | `menus/env-cloud-levels:138` | — |
| `getCloudSchema()` | `menus/env-cloud-levels:11` | 导出 cloud schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildExperimentalLevel()` | `menus/env-experimental-levels:29` | — |
| `getExperimentalSchema()` | `menus/env-experimental-levels:11` | 导出 experimental schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildFogLevel()` | `menus/env-fog-levels:71` | — |
| `getFogSchema()` | `menus/env-fog-levels:12` | 导出 fog schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildGroundLevel()` | `menus/env-ground-levels:536` | — |
| `getGroundSchema()` | `menus/env-ground-levels:28` | 导出 ground schema 供 menu-registry 静态分析（ADR-093 元测试） 合并 6 个子 schema 数组，返回完整 ground 面板的 schem |
| `buildLevel()` | `menus/env-level-helpers:14` | 通用的环境功能层级构建器：包裹 cardContainer + renderMenu 模板 |
| `openTexturePicker()` | `menus/env-level-helpers:46` | 打开环境贴图选择器 |
| `EnvTextureBindingTarget()` | `menus/env-menu-state:9` | — |
| `clearEnvTextureBindingTarget()` | `menus/env-menu-state:17` | — |
| `getEnvMenu()` | `menus/env-menu-state:34` | — |
| `getEnvTextureBindingTarget()` | `menus/env-menu-state:21` | — |
| `setEnvMenu()` | `menus/env-menu-state:30` | — |
| `setEnvTextureBindingTarget()` | `menus/env-menu-state:13` | — |
| `buildEnvLevel()` | `menus/env-menu:164` | — |
| `buildParticleLevel()` | `menus/env-menu:254` | — |
| `buildParticleSchema()` | `menus/env-menu:172` | — |
| `clearEnvTextureBindingTarget()` | `menus/env-menu:40` | — |
| `disposeEnvMenu()` | `menus/env-menu:74` | 释放 env-menu 模块资源（取消注册 hooks + HMR/清理时调用） |
| `getEnvMenu()` | `menus/env-menu:61` | — |
| `getEnvTextureBindingTarget()` | `menus/env-menu:40` | — |
| `refreshEnvRoot()` | `menus/env-menu:61` | — |
| `showEnvMenu()` | `menus/env-menu:61` | — |
| `SCENE_PRESETS()` | `menus/env-preset-levels:162` | — |
| `buildPresetLevel()` | `menus/env-preset-levels:324` | — |
| `buildShadowLevel()` | `menus/env-shadow-levels:123` | — |
| `getShadowSchema()` | `menus/env-shadow-levels:15` | 导出 shadow schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildSkyLevel()` | `menus/env-sky-levels:202` | — |
| `getSkySchema()` | `menus/env-sky-levels:17` | 导出 sky schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildWaterLevel()` | `menus/env-water-levels:482` | — |
| `getWaterSchema()` | `menus/env-water-levels:31` | 导出 water schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildWindLevel()` | `menus/env-wind-levels:44` | — |
| `getWindSchema()` | `menus/env-wind-levels:12` | 导出 wind schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `buildTagDetailLevel()` | `menus/library-actions:725` | — |
| `buildTagsOverviewLevel()` | `menus/library-actions:725` | — |
| `findLibraryModelByName()` | `menus/library-actions:725` | 按名称模糊搜索模型（纯查询，不触发加载）。供 ADR-155/197 NL 控制 resolve 使用，避免 resolve 阶段误触发真实加载。 |
| `findLibraryMotionByName()` | `menus/library-actions:725` | 按名称模糊搜索 VMD 动作（纯查询，不触发替换）。 |
| `highlightRow()` | `menus/library-actions:725` | — |
| `importFile()` | `menus/library-actions:680` | — |
| `importFileByPath()` | `menus/library-actions:635` | — |
| `onModelRowClick()` | `menus/library-actions:725` | — |
| `prepareModelRestore()` | `menus/library-actions:110` | — |
| `replaceModel()` | `menus/library-actions:725` | — |
| `replaceMotion()` | `menus/library-actions:725` | — |
| `makeModelMenu()` | `menus/library-browse:376` | — |
| `showModelPopup()` | `menus/library-browse:345` | — |
| `ResourceViewMode()` | `menus/library-core:43` | — |
| `abortThumbnailStreaming()` | `menus/library-core:317` | [adr-136] 取消当前正在进行的缩略图流式加载批次（如弹窗关闭/重开时调用）。 |
| `buildLevel()` | `menus/library-core:853` | — |
| `buildModelFormationLevel()` | `menus/library-core:897` | — |
| `buildModelRootItems()` | `menus/library-core:932` | — |
| `buildResourceItemsForDir()` | `menus/library-core:384` | — |
| `computeRestoreSegments()` | `menus/library-core:161` | — |
| `getPendingMetaGuard()` | `menus/library-core:67` | — |
| `getRelativePathUnderDir()` | `menus/library-core:83` | — |
| `getResourceViewMode()` | `menus/library-core:47` | — |
| `importFile()` | `menus/library-core:1045` | — |
| `initLibrary()` | `menus/library-core:1046` | — |
| `isLeafFlattenDir()` | `menus/library-core:93` | — |
| `isModelDirTarget()` | `menus/library-core:59` | — |
| `loadThumbnailsStreaming()` | `menus/library-core:260` | 流式加载缩略图：并发控制，每加载一张立即更新缓存并通知面板刷新， 替代一次性 GetThumbnailBatch 的"全等"模式，实现缩略图逐张出现。 |
| `modelToResourceItem()` | `menus/library-core:367` | — |
| `modelToRow()` | `menus/library-core:351` | — |
| `prepareModelRestore()` | `menus/library-core:1045` | — |
| `refreshLibrary()` | `menus/library-core:1046` | — |
| `refreshModelRoot()` | `menus/library-core:1023` | 就地更新模型库根层级数据（刷新已注册的角色列表）。 |
| `reloadConfig()` | `menus/library-core:1046` | — |
| `rescanAndSync()` | `menus/library-core:1046` | — |
| `resolveDisplayBrowseDir()` | `menus/library-core:140` | [修复] 解析模型在资源库中的"显示目录"——即用户点击该模型时实际看到的层级。 |
| `selectOverridePath()` | `menus/library-core:1046` | — |
| `selectResourceRoot()` | `menus/library-core:1046` | — |
| `setResourceViewMode()` | `menus/library-core:50` | — |
| `showModelPopup()` | `menus/library-core:1044` | — |
| `splitSubdirSegments()` | `menus/library-core:73` | — |
| `switchStorageMode()` | `menus/library-core:1046` | — |
| `thumbnailKeyForModel()` | `menus/library-core:194` | — |
| `LibraryLoadingState()` | `menus/library-session-store:51` | 资源库会话状态：加载守卫。 |
| `LibraryRestoreState()` | `menus/library-session-store:32` | 资源库会话状态：恢复链路（上次浏览位置 + 高亮模型）。 |
| `LibraryRestoreStatus()` | `menus/library-session-store:17` | [doc:adr-135] P0.3 deferRestore 状态机。 |
| `librarySessionStore()` | `menus/library-session-store:253` | 单例。 |
| `initLibrary()` | `menus/library-setup:83` | — |
| `refreshLibrary()` | `menus/library-setup:447` | — |
| `reloadConfig()` | `menus/library-setup:369` | — |
| `rescanAndSync()` | `menus/library-setup:277` | — |
| `selectOverridePath()` | `menus/library-setup:209` | — |
| `selectResourceRoot()` | `menus/library-setup:184` | — |
| `switchStorageMode()` | `menus/library-setup:228` | — |
| `ModelPresetFile()` | `menus/library:6` | — |
| `applyModelPreset()` | `menus/library:7` | — |
| `initLibrary()` | `menus/library:4` | — |
| `refreshLibrary()` | `menus/library:4` | — |
| `serializeModelPreset()` | `menus/library:7` | — |
| `showModelPopup()` | `menus/library:4` | — |
| `showMotionPopup()` | `menus/library:5` | — |
| `PopupMenuConfig()` | `menus/menu-factory:145` | 轻量级弹窗入口：适用于不需要注册 handle 的一次性场景。 |
| `PopupMenuHandle()` | `menus/menu-factory:46` | 注册后的菜单句柄——提供 get/refresh 能力 |
| `PopupMenuHandlers()` | `menus/menu-factory:11` | 不含 container/onClose 的菜单回调（由工厂统一注入） |
| `RegisteredPopupMenuConfig()` | `menus/menu-factory:20` | 注册式菜单配置——工厂内部维护引用，返回 handle |
| `registerPopupMenu()` | `menus/menu-factory:73` | 注册弹窗菜单——工厂内部维护引用，返回统一的 handle。 |
| `showPopupMenu()` | `menus/menu-factory:159` | — |
| `addOnCloseAllOverlays()` | `menus/menu-overlay:18` | 追加注册关闭回调（不覆盖主回调，供面板化拖拽卸载等场景用） |
| `clearAllMenuWrappers()` | `menus/menu-overlay:72` | — |
| `closeAllOverlays()` | `menus/menu-overlay:23` | Close all visible overlays, reset popup state, and invoke the registered callbacks. |
| `disposeMenuWrapper()` | `menus/menu-overlay:64` | — |
| `getMenuWrapper()` | `menus/menu-overlay:49` | — |
| `setOnCloseAllOverlays()` | `menus/menu-overlay:13` | — |
| `PanelNav()` | `menus/menu-registry:13` | 面板导航元数据（ADR-229 §2.1）。 |
| `RegisteredSchema()` | `menus/menu-registry:26` | — |
| `SchemaCollectFailure()` | `menus/menu-registry:51` | builder 执行失败记录（ADR-229 审核修正：失败不得静默） |
| `SchemaCollectResult()` | `menus/menu-registry:56` | — |
| `_clearRegistry()` | `menus/menu-registry:109` | 清空注册表（仅测试用） |
| `collectAllSchemas()` | `menus/menu-registry:85` | 收集所有已注册 schema，执行 builder 返回快照（失败面板跳过，失败列表见 collectAllSchemasWithFailures） |
| `collectAllSchemasWithFailures()` | `menus/menu-registry:68` | 收集所有已注册 schema，同时返回 builder 失败列表。 |
| `flattenNodes()` | `menus/menu-registry:94` | 递归展开 schema 树（含 children），返回扁平节点列表。 |
| `registerSchema()` | `menus/menu-registry:37` | 注册一个面板的 schema 构建函数（nav 可选，特例面板覆写导航元数据） |
| `ActionMenuCtx()` | `menus/menu-schema:18` | — |
| `ControlSpec()` | `menus/menu-schema:18` | — |
| `MenuKind()` | `menus/menu-schema:18` | — |
| `MenuNode()` | `menus/menu-schema:18` | — |
| `StatePath()` | `menus/menu-schema:18` | — |
| `getBindFn()` | `menus/menu-schema:120` | 按 StatePath 获取 bind 函数（用于 registerControl 自更新） |
| `getStateValue()` | `menus/menu-schema:24` | 按 StatePath 获取当前值 |
| `setStateValue()` | `menus/menu-schema:71` | 按 StatePath 设置值 |
| `stackRegistry()` | `menus/menu-stack-registry:8` | — |
| `SlideMenu()` | `menus/menu:40` | — |
| `getCurrentRenderingMenu()` | `menus/menu:40` | 获取当前正在渲染的 SlideMenu 实例（供 menus 层控件的自更新注册）。 |
| `getOpenMenus()` | `menus/menu:48` | 获取所有当前存活的 SlideMenu 实例（已 dispose 的会自动移除，调用方仍需自行判断可见性） |
| `buildBoneHierarchyLevel()` | `menus/model-detail:1517` | — |
| `buildModelInfoLevel()` | `menus/model-detail:868` | — |
| `buildModelLevel()` | `menus/model-detail:627` | — |
| `buildModelTagsLevel()` | `menus/model-detail:1083` | — |
| `buildModelToolsLevel()` | `menus/model-detail:583` | [doc:adr-167] 叠加动作次级菜单已移除（ADR-144 per-model overlay 废弃）。 |
| `buildMorphPreviewLevel()` | `menus/model-detail:1193` | — |
| `buildMotionSlotLevel()` | `menus/model-detail:442` | 构建动作1（基础）次级菜单：场景库选择 + 已加载动作 + 程序化动作 |
| `buildOpenWithLevel()` | `menus/model-detail:281` | — |
| `buildPersonalLightLevel()` | `menus/model-detail:1206` | — |
| `buildMatRootLevel()` | `menus/model-material:446` | — |
| `ModelPresetEntry()` | `menus/model-preset:37` | — |
| `ModelPresetFile()` | `menus/model-preset:46` | — |
| `applyModelPreset()` | `menus/model-preset:127` | — |
| `applyPresetFromLib()` | `menus/model-preset:293` | — |
| `buildPresetListLevel()` | `menus/model-preset:353` | — |
| `savePresetToLibDialog()` | `menus/model-preset:337` | — |
| `serializeModelPreset()` | `menus/model-preset:80` | — |
| `tryAutoApplyPreset()` | `menus/model-preset:216` | — |
| `DEFAULT_MOTION_SLOTS()` | `menus/motion-binding-ui:121` | — |
| `applyIntentToModel()` | `menus/motion-binding-ui:137` | — |
| `buildActionBindingLevel()` | `menus/motion-binding-ui:373` | — |
| `ensureMotionSlots()` | `menus/motion-binding-ui:126` | [doc:adr-167] 确保 inst.motionSlots 存在并返回（懒初始化；overlay 槽位已移除） |
| `handleModelAction()` | `menus/motion-binding-ui:393` | 处理 per-model 动作控制指令（pause / reset / pose / loop）。 |
| `initMotionBroadcast()` | `menus/motion-binding-ui:199` | — |
| `renderModuleToggleList()` | `menus/motion-binding-ui:59` | 渲染动作模块开关列表到指定容器。 |
| `resetFocusedLayerId()` | `menus/motion-binding-ui:116` | 重置焦点图层 ID（进入动作绑定面板 / 场景级浏览时调用）。 |
| `buildCameraLevel()` | `menus/motion-camera-levels:355` | — |
| `buildVirtualSkirtLevel()` | `menus/motion-cloth-levels:340` | — |
| `disposeAllVirtualSkirts()` | `menus/motion-cloth-levels:68` | 释放全部虚拟裙骨控制器 |
| `disposeVirtualSkirtForModel()` | `menus/motion-cloth-levels:77` | 释放指定模型的虚拟裙骨控制器（供模型卸载流程调用） |
| `buildLayerLevel()` | `menus/motion-detail-ui:48` | 单图层次级菜单：启用开关 / 权重滑块 / 删除。 |
| `buildMotionDetailLevel()` | `menus/motion-detail-ui:356` | [doc:adr-167] 构建动作详情页 level。 |
| `buildMotionToolsLevel()` | `menus/motion-detail-ui:376` | [doc:adr-170] 动作工具页 level——对齐 buildModelToolsLevel 的「详情 vs 工具」分层： 行点击进详情（图层/覆盖），行尾 setting |
| `buildPlaybackSpeedLevel()` | `menus/motion-detail-ui:460` | — |
| `syncPlaybackSpeedToRuntime()` | `menus/motion-detail-ui:428` | 将记忆中的播放速度同步到新的 mmdRuntime 实例（防状态漂移）。 |
| `buildGazeTrackingLevel()` | `menus/motion-gaze-levels:501` | — |
| `getGazeSchema()` | `menus/motion-gaze-levels:55` | 导出 gaze schema 供 menu-registry 静态分析（ADR-093 元测试） |
| `renderPerceptionConflictBanners()` | `menus/motion-gaze-levels:474` | [doc:adr-166 P2-3] 渲染「焦点 + 全部 pinned」模型的感知层冲突 banner。 |
| `updatePerceptionConflictBanner()` | `menus/motion-gaze-levels:436` | [doc:adr-163/adr-164/adr-166] 渲染指定模型的感知层骨骼冲突 banner |
| `buildAdvancedBoneOverrideLevel()` | `menus/motion-override-levels:964` | — |
| `buildModuleParamLevel()` | `menus/motion-override-levels:477` | 模块参数子页：渲染模块的 buildSchema() |
| `renderOverrideCard()` | `menus/motion-override-levels:203` | [doc:adr-116/125] 动作覆盖卡片：标题栏（撤销/重做/历史）+ 骨骼冲突 banner + 模块开关列表 + 高级骨骼覆盖入口。提取自已移除的独立覆盖页（原死路由 |
| `renderPresetCard()` | `menus/motion-override-levels:74` | [doc:adr-145] 动作预设卡片：标题栏（保存按钮）+ 预设列表 / 空状态。 |
| `syncOverrideToInstance()` | `menus/motion-override-levels:978` | 将 bone-override.ts 的运行时状态同步回 ModelInstance.boneOverrides 用于持久化 |
| `applyIntentToModel()` | `menus/motion-popup:30` | — |
| `buildMotionRootItems()` | `menus/motion-popup:36` | — |
| `disposeMotionPopup()` | `menus/motion-popup:78` | 释放 motion-popup 模块资源（取消注册 hooks + UI actions + HMR/清理时调用） |
| `getMotionMenu()` | `menus/motion-popup:68` | — |
| `hideMotionPopup()` | `menus/motion-popup:36` | — |
| `initMotionBroadcast()` | `menus/motion-popup:30` | — |
| `refreshMotionRoot()` | `menus/motion-popup:68` | — |
| `renderModuleToggleList()` | `menus/motion-popup:30` | — |
| `showMotionPopup()` | `menus/motion-popup:68` | — |
| `syncPlaybackSpeedToRuntime()` | `menus/motion-popup:35` | — |
| `buildPoseStudioLevel()` | `menus/motion-pose-levels:252` | — |
| `buildProcLibraryLevel()` | `menus/motion-procmotion-levels:412` | — |
| `buildProcMotionSchema()` | `menus/motion-procmotion-levels:133` | — |
| `buildProcToolsLevel()` | `menus/motion-procmotion-levels:387` | [doc:adr-207] 程序化工具栏 level——对齐 ADR-170「详情 vs 工具」分层： 程序化专属参数（预设/强度/速度/骨骼微动/插值）收敛到工具栏， 详情页只保 |
| `procLabel()` | `menus/motion-procmotion-levels:408` | [doc:adr-207] 程序化动作 ID → 显示名（跨模块复用，避免标签逻辑重复）。 |
| `buildMotionRootItems()` | `menus/motion-root-ui:51` | — |
| `buildMotionRootLevel()` | `menus/motion-root-ui:291` | — |
| `buildRetargetLevel()` | `menus/motion-root-ui:352` | — |
| `hideMotionPopup()` | `menus/motion-root-ui:300` | — |
| `importExternalAnimation()` | `menus/motion-root-ui:383` | 外部动作导入：选文件 → 重定向骨骼 → 播放。 |
| `openProcDetail()` | `menus/motion-root-ui:344` | [doc:adr-207] 行体点击进入程序化统一详情页。 |
| `buildNavMaps()` | `menus/nav-actions:163` | — |
| `disposeNavBindings()` | `menus/nav-actions:257` | 卸载导航按钮监听（HMR/dispose 用） |
| `getNavLabel()` | `menus/nav-actions:322` | 供 core 侧读取导航标签（经桥，不直接 import menus） |
| `initNavActions()` | `menus/nav-actions:267` | [doc:adr-238] nav-actions 启动入口：安装按钮接线 + 构建导航标签映射。 |
| `navActions()` | `menus/nav-actions:121` | — |
| `navLabels()` | `menus/nav-actions:25` | — |
| `toggleOverlay()` | `menus/nav-actions:58` | — |
| `buildOutfitLevel()` | `menus/outfit-ui:158` | — |
| `buildSiteTabs()` | `menus/plaza-browser:303` | — |
| `buildToolbar()` | `menus/plaza-browser:687` | — |
| `ensureSitesLoaded()` | `menus/plaza-browser:237` | — |
| `getCustomPresets()` | `menus/plaza-browser:287` | — |
| `loadPlazaCache()` | `menus/plaza-browser:139` | 从 Go 用户目录缓存（plaza-cache/creators.json + workshop_sites.json）读取站点 + 创作者。缓存不存在时返回 null。 |
| `mergeSites()` | `menus/plaza-browser:205` | — |
| `normalizeCreator()` | `menus/plaza-browser:111` | — |
| `normalizeSite()` | `menus/plaza-browser:82` | — |
| `openExternal()` | `menus/plaza-browser:273` | — |
| `openInWindow()` | `menus/plaza-browser:277` | — |
| `openSiteByMode()` | `menus/plaza-browser:257` | — |
| `preserveBuiltinRouting()` | `menus/plaza-browser:230` | — |
| `renderEmbed()` | `menus/plaza-browser:843` | — |
| `renderHome()` | `menus/plaza-browser:821` | — |
| `renderSiteContent()` | `menus/plaza-browser:358` | — |
| `saveCustomPresets()` | `menus/plaza-browser:295` | — |
| `savePlazaCache()` | `menus/plaza-browser:178` | 将当前站点 + 创作者持久化到 Go 用户目录缓存（plaza-cache/）。 |
| `showActionsMenu()` | `menus/plaza-browser:731` | — |
| `showPlaza()` | `menus/plaza-browser:947` | — |
| `PLAZA_CREATORS()` | `menus/plaza-creators:9` | — |
| `PlazaCreator()` | `menus/plaza-creators:1` | — |
| `ensureObserver()` | `menus/plaza-download:185` | — |
| `handlePlazaDownload()` | `menus/plaza-download:75` | — |
| `installDownloadListener()` | `menus/plaza-download:39` | — |
| `installEventListeners()` | `menus/plaza-download:159` | — |
| `installShortcuts()` | `menus/plaza-download:111` | — |
| `PLAZA_SITES()` | `menus/plaza-sites:15` | — |
| `PlazaSite()` | `menus/plaza-sites:1` | — |
| `GLOBAL_MODE_KEY()` | `menus/plaza-state:14` | — |
| `OpenMode()` | `menus/plaza-state:109` | — |
| `SITE_GROUPS()` | `menus/plaza-state:16` | — |
| `allCreators()` | `menus/plaza-state:32` | — |
| `allSites()` | `menus/plaza-state:31` | — |
| `closePlaza()` | `menus/plaza-state:168` | — |
| `currentEmbedUrl()` | `menus/plaza-state:102` | 内嵌模式下当前 iframe 实际访问的 URL（由注入脚本 postMessage 上报） |
| `currentSiteId()` | `menus/plaza-state:43` | — |
| `downloadListenerInstalled()` | `menus/plaza-state:78` | — |
| `effectiveMode()` | `menus/plaza-state:131` | — |
| `eventListenersInstalled()` | `menus/plaza-state:79` | — |
| `getCurrentSite()` | `menus/plaza-state:48` | — |
| `getLayer()` | `menus/plaza-state:55` | — |
| `layer()` | `menus/plaza-state:54` | — |
| `loadGlobalMode()` | `menus/plaza-state:111` | — |
| `observer()` | `menus/plaza-state:71` | — |
| `plazaIframe()` | `menus/plaza-state:94` | — |
| `plazaProxyActive()` | `menus/plaza-state:64` | — |
| `saveGlobalMode()` | `menus/plaza-state:123` | — |
| `setAllCreators()` | `menus/plaza-state:37` | — |
| `setAllSites()` | `menus/plaza-state:34` | — |
| `setCurrentEmbedUrl()` | `menus/plaza-state:103` | — |
| `setCurrentSiteId()` | `menus/plaza-state:45` | — |
| `setDownloadListenerInstalled()` | `menus/plaza-state:82` | — |
| `setEventListenersInstalled()` | `menus/plaza-state:85` | — |
| `setObserver()` | `menus/plaza-state:72` | — |
| `setPlazaIframe()` | `menus/plaza-state:95` | — |
| `setPlazaProxyActive()` | `menus/plaza-state:65` | — |
| `setShortcutsRegistered()` | `menus/plaza-state:88` | — |
| `shortcutsRegistered()` | `menus/plaza-state:80` | — |
| `stopProxy()` | `menus/plaza-state:158` | — |
| `_plazaBtn()` | `menus/plaza-thumbnail:6` | — |
| `_plazaSectionHeader()` | `menus/plaza-thumbnail:24` | — |
| `PresetListViewerConfig()` | `menus/preset-list-viewer:15` | — |
| `buildPresetListLevel()` | `menus/preset-list-viewer:156` | 构建完整 PopupLevel（适用于纯预设列表场景，如模型预设） |
| `presetListContent()` | `menus/preset-list-viewer:53` | 渲染预设列表内容到现有 container 中。用于混合内容的 PopupLevel（场景预设） |
| `buildSchemaLevel()` | `menus/render-menu:350` | [doc:P6] 构建一个含增量 i18n 刷新的 schema 层级。 |
| `renderMenu()` | `menus/render-menu:26` | 渲染一个 MenuNode 树到 container 中。返回 dispose 函数，调用时级联释放所有 renderCustom 资源 |
| `ResourceHandle()` | `menus/resource-detail-helpers:40` | — |
| `buildAttachmentCard()` | `menus/resource-detail-helpers:388` | [doc:adr-215] 模型附属关系卡片。 |
| `buildDangerCard()` | `menus/resource-detail-helpers:253` | 危险区块：卸载资源（带确认对话框） onRemoved 可选回调，用于卸载后弹窗导航（如 pop 到上一级） |
| `buildMaterialCard()` | `menus/resource-detail-helpers:238` | 材质区块：进入材质调节子层级 |
| `buildSnapSettings()` | `menus/resource-detail-helpers:103` | — |
| `buildTransformCard()` | `menus/resource-detail-helpers:137` | 拖拽操控卡片：Gizmo 拖拽 + 缩放倍率 + 透明度 [doc:adr-049] 位置/旋转由 3D Gizmo 实时拖拽取代，不再显示滑块。 |
| `reconcileTransformSelection()` | `menus/resource-detail-helpers:59` | 面板关闭/切换即卸载（ADR-171 面板化）：菜单 onAfterRender 时调用。 |
| `buildDragModeLevel()` | `menus/scene-drag-levels:7` | — |
| `getSceneMenu()` | `menus/scene-menu-state:16` | — |
| `reRenderSceneMenu()` | `menus/scene-menu-state:22` | — |
| `refreshSceneRoot()` | `menus/scene-menu-state:35` | — |
| `setRefreshSceneRoot()` | `menus/scene-menu-state:31` | — |
| `setSceneMenu()` | `menus/scene-menu-state:12` | — |
| `buildStageTransformLevel()` | `menus/scene-menu:58` | — |
| `disposeSceneMenu()` | `menus/scene-menu:99` | 释放 scene-menu 模块资源（取消注册 hooks + UI actions + HMR/清理时调用） |
| `getSceneMenu()` | `menus/scene-menu:81` | — |
| `refreshSceneRoot()` | `menus/scene-menu:93` | — |
| `saveScene()` | `menus/scene-menu:439` | 保存场景（自动编号到预设目录） |
| `screenshotBatch()` | `menus/scene-menu:356` | 批量截图所有已加载模型 |
| `screenshotCurrent()` | `menus/scene-menu:328` | 截图当前焦点模型 |
| `showSceneMenu()` | `menus/scene-menu:81` | — |
| `buildPhysicsDebugLevel()` | `menus/scene-physics-levels:155` | 构建物理调试子页（材质线框/骨骼 — WASM 相关，由模型详情页调用） |
| `buildPhysicsLevel()` | `menus/scene-physics-levels:37` | 构建 WASM 物理子页（Bullet 骨髁物理 — per-model） |
| `buildWasmPhysicsLevel()` | `menus/scene-physics-levels:88` | 构建 WASM 物理子页（Bullet 骨髁物理信息 + 全局开关） |
| `buildPostProcessColorSchema()` | `menus/scene-render-levels:419` | 后处理 schema — 色彩层（色调映射） |
| `buildPostProcessCoreSchema()` | `menus/scene-render-levels:198` | 后处理 schema — 核心层（高频效果）+ 高级层（光学/环境效果） |
| `buildPostProcessLevel()` | `menus/scene-render-levels:516` | — |
| `buildPresetScenesLevel()` | `menus/scene-render-levels:104` | — |
| `FILTER_PRESET_LABELS()` | `menus/scene-render-presets:149` | — |
| `USER_FILTER_PRESETS()` | `menus/scene-render-presets:293` | — |
| `buildPresetsLevel()` | `menus/scene-render-presets:255` | — |
| `getFilterPreset()` | `menus/scene-render-presets:169` | — |
| `showPresetSaveDialog()` | `menus/scene-render-presets:267` | — |
| `buildStageLevel()` | `menus/scene-stage-levels:161` | — |
| `buildStageTransformLevel()` | `menus/scene-stage-levels:175` | — |
| `buildStageLightLevel()` | `menus/scene-stage-lights:823` | — |
| `buildSettingsAboutLevel()` | `menus/settings-about:247` | — |
| `handleSettingsAction()` | `menus/settings-actions:21` | 全局设置项点击分发：语言切换 + 动作表。settings.ts 的 onItemClick 使用。 |
| `buildSettingsAppearanceLevel()` | `menus/settings-appearance:510` | — |
| `buildCameraSchema()` | `menus/settings-controls:29` | — |
| `buildSettingsControlsLevel()` | `menus/settings-controls:325` | — |
| `buildDiagnosticSchema()` | `menus/settings-diagnostic:409` | — |
| `buildSettingsDiagnosticLevel()` | `menus/settings-diagnostic:513` | — |
| `renderDiagnosticPanel()` | `menus/settings-diagnostic:483` | — |
| `buildSettingsDownloadsLevel()` | `menus/settings-downloads:446` | — |
| `buildEffectsSchema()` | `menus/settings-graphics:204` | — |
| `buildFrameQualitySchema()` | `menus/settings-graphics:102` | — |
| `buildPhysicsHudSchema()` | `menus/settings-graphics:309` | — |
| `buildSettingsGraphicsLevel()` | `menus/settings-graphics:432` | — |
| `buildSettingsLanguageLevel()` | `menus/settings-language:7` | — |
| `buildSettingsMediaLevel()` | `menus/settings-media:469` | — |
| `buildSettingsResourcesLevel()` | `menus/settings-resources:520` | — |
| `FONT_MAP()` | `menus/settings-shared:127` | — |
| `SETTINGS_FONT_RESTORE()` | `menus/settings-shared:127` | — |
| `SettingsMenuHandle()` | `menus/settings-shared:172` | — |
| `THEME_PRESETS()` | `menus/settings-shared:131` | — |
| `applyUIAppearanceDom()` | `menus/settings-shared:141` | — |
| `formatBytes()` | `menus/settings-shared:174` | — |
| `generateTextColors()` | `menus/settings-shared:127` | — |
| `getAutoImportCached()` | `menus/settings-shared:29` | — |
| `getDownloadWatchEnabledCached()` | `menus/settings-shared:50` | — |
| `preloadAutoImportState()` | `menus/settings-shared:21` | 启动时预加载自动导入开关状态。在 main.ts init 中调用。 |
| `preloadDownloadWatchState()` | `menus/settings-shared:42` | 启动时预加载下载监听开关状态。在 main.ts init 中调用。 |
| `setAutoImportCached()` | `menus/settings-shared:33` | — |
| `setAutoLoadCompanionAudio()` | `menus/settings-shared:62` | — |
| `setDownloadWatchEnabledCached()` | `menus/settings-shared:54` | — |
| `setTheme()` | `menus/settings-shared:81` | — |
| `truncatePath()` | `menus/settings-shared:186` | 路径截断显示：超长时保留尾部（用户更关心文件名/末级目录） |
| `addCustomSoftware()` | `menus/settings-system:440` | — |
| `buildSettingsSystemLevel()` | `menus/settings-system:791` | — |
| `buildSoftwareDetailLevel()` | `menus/settings-system:746` | — |
| `scanSoftwareDir()` | `menus/settings-system:466` | — |
| `setBlenderPath()` | `menus/settings-system:412` | — |
| `setMMDPath()` | `menus/settings-system:426` | — |
| `SETTINGS()` | `menus/settings-targets:5` | 设置菜单文件夹导航 target（ADR-157：7 分类信息架构） |
| `SETTINGS_ACTION()` | `menus/settings-targets:17` | 设置菜单动作 target（点击后执行操作，不导航） |
| `SOFTWARE_DETAIL_PREFIX()` | `menus/settings-targets:33` | 动态 target 前缀 —— 用于 &#96;settings:software-detail:&lt;path&gt;&#96; 模式 |
| `SettingsActionTarget()` | `menus/settings-targets:39` | 所有动作 target 的联合类型 |
| `SettingsFolderTarget()` | `menus/settings-targets:36` | 所有文件夹 target 的联合类型 |
| `generateTextColors()` | `menus/settings:13` | — |
| `getSettingsMenu()` | `menus/settings:18` | — |
| `preloadAutoImportState()` | `menus/settings:13` | — |
| `preloadDownloadWatchState()` | `menus/settings:13` | — |
| `refreshSettingsRoot()` | `menus/settings:18` | — |
| `showSettings()` | `menus/settings:18` | — |

## 动作算法

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BeatDetector()` | `motion-algos/beat-detector:31` | — |
| `SolveFootInput()` | `motion-algos/feet-adjustment-math:8` | — |
| `SolveFootOutput()` | `motion-algos/feet-adjustment-math:25` | — |
| `solveFootTarget()` | `motion-algos/feet-adjustment-math:46` | 解算单脚应处的世界 Y 坐标。 |
| `FootLandEvent()` | `motion-algos/feet-event:9` | 落地事件：脚从空中接触地面的瞬间（ADR-088 供脚步声消费）。 |
| `StepDetectInput()` | `motion-algos/footstep-detect:6` | — |
| `StepDetectOutput()` | `motion-algos/footstep-detect:25` | — |
| `detectFootLanding()` | `motion-algos/footstep-detect:36` | 落地判定核心。仅当出现「离地→贴地」上升沿、且去抖间隔满足时返回 landed=true。 |
| `DEFAULT_LIPSYNC_STATE()` | `motion-algos/lipsync:17` | — |
| `LipSyncMorphSet()` | `motion-algos/lipsync:51` | — |
| `LipSyncState()` | `motion-algos/lipsync:10` | — |
| `amplitudeToWeight()` | `motion-algos/lipsync:77` | 振幅 → morph 权重映射。 |
| `findAllLipMorphs()` | `motion-algos/lipsync:61` | 查找模型中所有可用的口型相关 morph。 |
| `findLipMorph()` | `motion-algos/lipsync:31` | 在模型 morph 列表中查找口型 morph，返回首个匹配名。 |
| `PoseType()` | `motion-algos/pose-preset:13` | — |
| `generatePoseVmd()` | `motion-algos/pose-preset:23` | 生成 T-pose / A-pose / rest 的 VMD 二进制数据，可经 VmdLoader 解析后应用。 |
| `genArmBones()` | `motion-algos/proc-motion-autodance-bones-limbs:24` | 生成手臂骨骼帧（左右） 关键修复：改回平滑连续摆动（2 拍周期正弦），而非逐拍脉冲包络（beatBounce）。 |
| `genElbowBones()` | `motion-algos/proc-motion-autodance-bones-limbs:76` | 生成肘部骨骼帧（新增） 肘部随同侧手臂上抬而屈曲（X 轴），并滞后于肩形成 follow-through。 |
| `genFootIkBones()` | `motion-algos/proc-motion-autodance-bones-limbs:200` | 生成足部 IK 骨骼帧 随重心摆动：重心偏右时左足抬起（step touch），配合 Center 的 X 重心转移制造换脚感。 |
| `genShoulderBones()` | `motion-algos/proc-motion-autodance-bones-limbs:161` | 生成肩部骨骼帧 随同侧手臂平滑摆动做耸肩（Y 位移）+ 微旋（Z），形成肩→臂动力链。 |
| `genWristBones()` | `motion-algos/proc-motion-autodance-bones-limbs:124` | 生成腕部骨骼帧 随同侧手臂平滑摆动（共用连续波），保持末端联动，不再逐拍脉冲。 |
| `genAllParentBone()` | `motion-algos/proc-motion-autodance-bones-trunk:147` | 生成 AllParent 骨骼帧（步长6，低频微调） 修复：频率锁定到 4 拍整数周期，不再用 t*0.7/t*0.5 漂移（旧实现与节拍错位产生低频蠕变）。 |
| `genCenterBone()` | `motion-algos/proc-motion-autodance-bones-trunk:25` | 生成中心/下半身骨骼帧（Root / Center） groove 原则：单一相干源（swayAt）驱动重心转移。 |
| `genGrooveBone()` | `motion-algos/proc-motion-autodance-bones-trunk:123` | 生成 Groove 骨骼帧 骨盆微动，强化重心转移的"踩实"感。 |
| `genUpper2Bone()` | `motion-algos/proc-motion-autodance-bones-trunk:76` | 生成上半身2骨骼帧 跟随上半身做更小幅度同向联动（单一 swayAt 源，无脉冲）。 |
| `genUpperBone()` | `motion-algos/proc-motion-autodance-bones-trunk:52` | 生成上半身骨骼帧 随同一重心摆动做俯仰 + 侧倾（单一 swayAt 源，动力链：中心→上半身）。 |
| `genWaistBone()` | `motion-algos/proc-motion-autodance-bones-trunk:99` | 生成腰部骨骼帧 随重心反向扭转（follow-through），制造躯干螺旋联动而非各自为政。 |
| `BeatInfo()` | `motion-algos/proc-motion-autodance-bones:77` | 节拍信息：给定帧号，返回它在拍/循环中的相位。 |
| `BoneResolution()` | `motion-algos/proc-motion-autodance-bones:45` | — |
| `TrigCache()` | `motion-algos/proc-motion-autodance-bones:64` | — |
| `applyInterp()` | `motion-algos/proc-motion-autodance-bones:154` | 根据骨骼名应用插值类型 |
| `applyInterpOverride()` | `motion-algos/proc-motion-autodance-bones:178` | 根据用户覆写设置应用插值类型 |
| `beatBounce()` | `motion-algos/proc-motion-autodance-bones:102` | 每拍弹跳包络：拍头 0 → 拍中峰值 1 → 拍尾 0。 |
| `beatInfo()` | `motion-algos/proc-motion-autodance-bones:88` | — |
| `buildTrigCache()` | `motion-algos/proc-motion-autodance-bones:69` | — |
| `downbeatWeight()` | `motion-algos/proc-motion-autodance-bones:110` | 强拍权重：0/4 为强拍、2/6 为次强、其余为弱拍。 |
| `genAllParentBone()` | `motion-algos/proc-motion-autodance-bones:29` | — |
| `genArmBones()` | `motion-algos/proc-motion-autodance-bones:37` | — |
| `genCenterBone()` | `motion-algos/proc-motion-autodance-bones:29` | — |
| `genElbowBones()` | `motion-algos/proc-motion-autodance-bones:37` | — |
| `genFootIkBones()` | `motion-algos/proc-motion-autodance-bones:37` | — |
| `genGrooveBone()` | `motion-algos/proc-motion-autodance-bones:29` | — |
| `genShoulderBones()` | `motion-algos/proc-motion-autodance-bones:37` | — |
| `genUpper2Bone()` | `motion-algos/proc-motion-autodance-bones:29` | — |
| `genUpperBone()` | `motion-algos/proc-motion-autodance-bones:29` | — |
| `genWaistBone()` | `motion-algos/proc-motion-autodance-bones:29` | — |
| `genWristBones()` | `motion-algos/proc-motion-autodance-bones:37` | — |
| `resolveBones()` | `motion-algos/proc-motion-autodance-bones:130` | 解析骨骼候选名 → 实际骨骼名 |
| `swayAt()` | `motion-algos/proc-motion-autodance-bones:125` | 重心左右摆动（2 拍周期，period = 2 * beatFrames）： +1 偏左、-1 偏右。用于重心转移与上下半身联动。 |
| `EMOTION_CANDIDATES()` | `motion-algos/proc-motion-autodance-emotion:32` | — |
| `EmotionCategory()` | `motion-algos/proc-motion-autodance-emotion:43` | — |
| `findBestEmotionMorphs()` | `motion-algos/proc-motion-autodance-emotion:77` | 从 morph 列表中找出最佳情绪映射 |
| `genAccentMorph()` | `motion-algos/proc-motion-autodance-emotion:171` | 生成情绪强调帧（surprise/wink 随机点缀） |
| `genEmotionCycles()` | `motion-algos/proc-motion-autodance-emotion:133` | 生成情绪轮播帧（多个情绪依次出现） |
| `genShyMorph()` | `motion-algos/proc-motion-autodance-emotion:202` | 生成害羞 morph（仅当存在时） |
| `generateEmotionMorphs()` | `motion-algos/proc-motion-autodance-emotion:232` | 生成全部情绪 morph 帧 |
| `scoreMorph()` | `motion-algos/proc-motion-autodance-emotion:56` | 计算 morph 名称对一组关键词的匹配得分 - 含关键词 +10 分（大小写不敏感） - 含黑名单模式 -10 分 ⚠️ P3: 使用字符串包含匹配精度较低，建议后续用正则或语义 |
| `generateAutoDanceVmd()` | `motion-algos/proc-motion-autodance:46` | 生成 AutoDance VMD |
| `generateIdleVmd()` | `motion-algos/proc-motion-idle:25` | [audit] 待机呼吸生成：params 为 idle 模式专属参数；尊重 boneToggles，关闭的骨类别不生成。 |
| `PROC_AUTODANCE_PRESETS()` | `motion-algos/proc-motion-presets:86` | autodance（自动舞蹈）预设集 |
| `PROC_IDLE_PRESETS()` | `motion-algos/proc-motion-presets:60` | idle（待机呼吸）预设集 |
| `ProcParamsPreset()` | `motion-algos/proc-motion-presets:8` | — |
| `generateProcPresetId()` | `motion-algos/proc-motion-presets:131` | 生成唯一预设 ID（仿 preset-types.generatePresetId，避免跨模块 import 耦合） |
| `getProcParamsPreset()` | `motion-algos/proc-motion-presets:120` | 取单个预设（缺失返回 undefined，UI 层需兜底） |
| `getProcPresetSet()` | `motion-algos/proc-motion-presets:115` | 指定模式的预设集（无则空表） |
| `makeProcPreset()` | `motion-algos/proc-motion-presets:137` | 由当前参数构造自定义预设快照（深拷贝，防与运行时状态共引用） |
| `removeProcPreset()` | `motion-algos/proc-motion-presets:168` | 按 id 删除自定义预设（返回新数组） |
| `upsertProcPreset()` | `motion-algos/proc-motion-presets:154` | 增改自定义预设（同 id 覆盖，否则追加；返回新数组） |
| `BONE_ALLPARENT_CANDIDATES()` | `motion-algos/proc-motion-shared:213` | — |
| `BONE_ARM_IK_L_CANDIDATES()` | `motion-algos/proc-motion-shared:278` | — |
| `BONE_ARM_IK_R_CANDIDATES()` | `motion-algos/proc-motion-shared:286` | — |
| `BONE_CENTER_CANDIDATES()` | `motion-algos/proc-motion-shared:159` | — |
| `BONE_ELBOW_L_CANDIDATES()` | `motion-algos/proc-motion-shared:188` | — |
| `BONE_ELBOW_R_CANDIDATES()` | `motion-algos/proc-motion-shared:189` | — |
| `BONE_GROOVE_CANDIDATES()` | `motion-algos/proc-motion-shared:214` | — |
| `BONE_HEAD_CANDIDATES()` | `motion-algos/proc-motion-shared:163` | — |
| `BONE_KNEE_L_CANDIDATES()` | `motion-algos/proc-motion-shared:257` | — |
| `BONE_KNEE_R_CANDIDATES()` | `motion-algos/proc-motion-shared:265` | — |
| `BONE_LARM_CANDIDATES()` | `motion-algos/proc-motion-shared:165` | — |
| `BONE_LEG_IK_L_CANDIDATES()` | `motion-algos/proc-motion-shared:217` | — |
| `BONE_LEG_IK_R_CANDIDATES()` | `motion-algos/proc-motion-shared:225` | — |
| `BONE_NECK_CANDIDATES()` | `motion-algos/proc-motion-shared:162` | — |
| `BONE_RARM_CANDIDATES()` | `motion-algos/proc-motion-shared:174` | — |
| `BONE_SHOULDER_L_CANDIDATES()` | `motion-algos/proc-motion-shared:191` | — |
| `BONE_SHOULDER_R_CANDIDATES()` | `motion-algos/proc-motion-shared:201` | — |
| `BONE_THIGH_L_CANDIDATES()` | `motion-algos/proc-motion-shared:237` | — |
| `BONE_THIGH_R_CANDIDATES()` | `motion-algos/proc-motion-shared:246` | — |
| `BONE_UPPER2_CANDIDATES()` | `motion-algos/proc-motion-shared:161` | — |
| `BONE_UPPER_CANDIDATES()` | `motion-algos/proc-motion-shared:160` | — |
| `BONE_WAIST_CANDIDATES()` | `motion-algos/proc-motion-shared:212` | — |
| `BONE_WRIST_L_CANDIDATES()` | `motion-algos/proc-motion-shared:184` | — |
| `BONE_WRIST_R_CANDIDATES()` | `motion-algos/proc-motion-shared:185` | — |
| `DEFAULT_PROC_STATE()` | `motion-algos/proc-motion-shared:87` | — |
| `FPS()` | `motion-algos/proc-motion-shared:323` | — |
| `MAX_FRAMES()` | `motion-algos/proc-motion-shared:324` | — |
| `MORPH_BLINK_CANDIDATES()` | `motion-algos/proc-motion-shared:310` | — |
| `PROC_MOTION_BONE_CATEGORIES()` | `motion-algos/proc-motion-shared:14` | — |
| `PROC_VMD_NAME_AUTODANCE()` | `motion-algos/proc-motion-shared:12` | — |
| `PROC_VMD_NAME_IDLE()` | `motion-algos/proc-motion-shared:11` | — |
| `ProcModeKey()` | `motion-algos/proc-motion-shared:9` | 可编辑参数的程序化模式（'off' 无参数）。每个模式独立一套 ProcMotionParams。 |
| `ProcMotionBoneCategory()` | `motion-algos/proc-motion-shared:30` | — |
| `ProcMotionMode()` | `motion-algos/proc-motion-shared:6` | — |
| `ProcMotionParams()` | `motion-algos/proc-motion-shared:37` | [audit] per-mode 可调参数：待机呼吸 / 自动舞蹈 各自独立一套 |
| `ProcMotionState()` | `motion-algos/proc-motion-shared:46` | — |
| `clamp1()` | `motion-algos/proc-motion-shared:326` | — |
| `closingFrame()` | `motion-algos/proc-motion-shared:333` | 循环末尾的 identity 闭合帧（确保动画无缝循环） |
| `getProcMotionBoneCategories()` | `motion-algos/proc-motion-shared:32` | — |
| `matchBone()` | `motion-algos/proc-motion-shared:295` | — |
| `migrateProcState()` | `motion-algos/proc-motion-shared:114` | — |
| `quatW()` | `motion-algos/proc-motion-shared:329` | 四元数 w 分量：sqrt(max(0, 1 - x² - y² - z²)) |
| `generateAutoDanceVmd()` | `motion-algos/procedural-motion:3` | — |
| `generateIdleVmd()` | `motion-algos/procedural-motion:2` | — |
| `shouldAutoDance()` | `motion-algos/procedural-motion:7` | — |
| `shouldIdle()` | `motion-algos/procedural-motion:17` | — |
| `VmdBoneFrame()` | `motion-algos/vmd-evaluator:17` | — |
| `VmdEvaluator()` | `motion-algos/vmd-evaluator:22` | — |
| `createVmdEvaluator()` | `motion-algos/vmd-evaluator:282` | — |
| `shutdownVmdEvaluator()` | `motion-algos/vmd-evaluator:295` | 释放共享 Scene 资源。 |
| `BONE_FRAME_SIZE()` | `motion-algos/vmd-writer:35` | — |
| `BoneKeyFrame()` | `motion-algos/vmd-writer:9` | — |
| `INTERP_EASE_IN_OUT()` | `motion-algos/vmd-writer:31` | — |
| `INTERP_EASE_OUT()` | `motion-algos/vmd-writer:32` | — |
| `INTERP_LINEAR()` | `motion-algos/vmd-writer:30` | — |
| `INTERP_SHARP()` | `motion-algos/vmd-writer:33` | — |
| `InterpCurve()` | `motion-algos/vmd-writer:24` | — |
| `MORPH_FRAME_SIZE()` | `motion-algos/vmd-writer:36` | — |
| `MorphKeyFrame()` | `motion-algos/vmd-writer:17` | — |
| `buildBoneFrame()` | `motion-algos/vmd-writer:123` | 构建单个骨骼关键帧 (111 bytes)。插值用线性默认值。 |
| `buildMorphFrame()` | `motion-algos/vmd-writer:161` | 构建单个 morph 关键帧 (23 bytes)。 |
| `buildVmd()` | `motion-algos/vmd-writer:179` | 构建完整 VMD ArrayBuffer。 |
| `canEncodeName()` | `motion-algos/vmd-writer:108` | 检查名称能否被完整编码为 Shift-JIS（round-trip 无误）。 |
| `VPDBoneData()` | `motion-algos/vpd-parser:14` | — |
| `VPDMorphData()` | `motion-algos/vpd-parser:20` | — |
| `VPDPoseData()` | `motion-algos/vpd-parser:25` | — |
| `decodeVPDData()` | `motion-algos/vpd-parser:51` | 解码 VPD 文本（支持 UTF-8 / UTF-16 / Shift-JIS）。 |
| `loadVPDFromBuffer()` | `motion-algos/vpd-parser:200` | 从 ArrayBuffer（VPD 文件内容）解析并生成 VMD。 |
| `parseVPDText()` | `motion-algos/vpd-parser:98` | 解析 VPD 文本为结构化数据。 |
| `poseDataToVmdBuffer()` | `motion-algos/vpd-parser:182` | 将 VPD 姿势数据转换为标准 VMD 二进制数据。 |

## 顶层配置

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `EnvState()` | `config:3` | — |

---

> 说明列由 gen-funcmap 自动提取导出符号紧邻 JSDoc 的首句摘要（无 JSDoc 则留 —）。