# MikuMikuAR 项目现状

## 当前状态

MikuMikuAR — Wails (Go) + babylon-mmd 的桌面 PMX 查看器，当前处于**体验打磨阶段**。核心渲染链路、模型库管理、多模型场景、zip 解压、外部库挂载均已就绪。

### 已实现

**渲染层**
- [x] Wails 骨架 + Go 后端文件操作（`app.go`）
- [x] Go 本地 HTTP 文件服务器（`app.go:StartFileServer`）— 每目录独立端口，永不互相覆盖
- [x] 文件服务器 — `basenameFallbackFS` 兜底（basename 匹配），支持 URL 路径直接请求
- [x] CORS — 无条件 `Access-Control-Allow-Origin: *`
- [x] Babylon.js 场景 + WASM Bullet 物理（共享时间轴，支持多模型同场）
- [x] PMX 模型 HTTP URL 加载与渲染
- [x] 模型自动 framing — 加载后计算包围盒调整相机，切换焦点时自动适配
- [x] VMD 播放链路（`VmdLoader` → `MmdWasmAnimation` → `createRuntimeAnimation`）
- [x] VMD HTTP 化 — 从 base64 桥接改为 HTTP fetch + `&d=` 跨目录
- [x] WASM 动画副作用 import 修复（`mmdWasmRuntimeModelAnimation`）
- [x] 动画自动循环 — 播完后 `seek(0)` + `replay`
- [x] BMP/TGA 贴图格式加载器注册
- [x] `basenameFallbackFS` — 贴图 404 时按文件名忽略目录/大小写回退
- [x] 参考地面 + 调优相机位置
- [x] 键盘快捷键 — 空格暂停/播放、Esc 关闭弹窗、←/→ seek ±5s
- [x] 加载进度反馈 — `onProgress` 显示 `加载中 42%`

**多模型场景**
- [x] `ModelInstance` 类型 + `Map` 注册表 — 每模型独立状态（mesh、mmdModel、VMD）
- [x] 多模型同场 — 加载新模型不销毁旧模型，多个模型共享 WASM 物理时间轴
- [x] 重复文件检测 — 相同 PMX 路径自动切换焦点，不重复加载
- [x] 自动排列 — `arrangeModels()` spacing=3 横向居中排布
- [x] 焦点切换 — 场景面板点击模型行，相机自动 framing
- [x] VMD 独立绑定 — `loadVMDMotion(data, name, targetModelId)` 精确指定目标模型
- [x] 模型删除 — 场景面板 ✕ 按钮销毁模型并清理 registry

**模型库管理**
- [x] PMX header 解析（`pmx.go`）— 签名校验 + UTF-16LE/UTF-8 编码 + 4 段元数据
- [x] 递归目录扫描（`app.go:ScanModelDir`）— .pmx / .vmd / .zip 全覆盖
- [x] DanceXR 分类映射 — `dancexrCategories` 8 种分类
- [x] zip 条目内省 — 不提取直接遍历 zip 列出内部条目
- [x] 垃圾模型名过滤 — `isGarbageModelName` 过滤使用条款当名字的数据
- [x] zip 条目名编码 — Shift-JIS / UTF-8 自动识别解码
- [x] 底部弹窗 UI — 🎵 图标 → 面包屑导航 + 竖向模型列表
- [x] 模型搜索 — 实时过滤 `name_jp`/`name_en`/`comment`/`pmx_path`
- [x] 模型信息栏 — 底部持久显示当前焦点模型的名称 + VMD 名
- [x] 播放控制 — 暂停/播放按钮 + 时间显示 `00:00.00 / 00:00.00`
- [x] 可拖拽进度条 — mouse + touch (pointer events) 支持
- [x] 场景面板 — 右侧列表显示已加载模型，焦点高亮，✕ 删除
- [x] 配置持久化 — `%APPDATA%\MikuMikuAR\config.json` + `index.json`
- [x] 目录选择 binding（`app.go:SelectDir`）

**设置系统**
- [x] 弹窗设置页 — ⚙ 按钮打开设置面板，切换模型显示名称优先级（`name_jp` / `name_en` / `filename`）
- [x] 设置持久化 — 切换即时生效，存入 `config.json`

**缩略图系统（方案 B：预渲染缓存）**
- [x] `SaveThumbnail` / `GetThumbnail` / `GetThumbnailBatch` — Go 端缩略图存取（`app.go`）
- [x] `captureThumbnail` — 模型加载完成后自动截图（`scene.ts`）
- [x] `HasThumb` 字段在扫描时自动检测 — `scanDirRecursive` 检查缩略图文件是否存在
- [x] 弹窗缩略图加载 — `showPopup` 时批量拉取，模型行显示 36×36 预览（`library.ts`）

**zip 容器**
- [x] `ExtractZip` binding — 全解 zip 到 cache 后加载 PMX/VMD
- [x] cache 复用 — `manifest.json` 比对源 zip mtime+size（含版本号，编码逻辑变更自动失效）
- [x] zip slip 防护 — 解压时校验路径不越出目标目录
- [x] `CleanOrphanCache` — 库扫描时自动清理孤儿 cache
- [x] `ClearExtractCache` binding — 一键清除全部提取缓存
- [x] zip 虚拟文件夹 — 内部条目归入 zip 名下，下钻可见
- [x] zip 内 VMD 支持 — 解压后走 VMD HTTP 链路
- [x] zip 条目名编码检测 — 用 `NonUTF8` 标志位 + `detectUTF8` 判定 Shift-JIS vs UTF-8
- [x] 控制字符清理 — 过滤文件名中的 0x80/U+0080 等无效字节
- [x] PMX 头从 zip 直接解析 — 扫描时打开 zip 条目读取前 2KB，获取 `name_jp`/`name_en`

**外部库挂载**
- [x] `Config.ExternalPaths` — 多源联合扫描
- [x] `AddExternalPath` / `RemoveExternalPath` — 管理 binding
- [x] 弹窗根层 🔌 虚拟入口

**下载引擎**
- [x] `DownloadFile` binding — HTTP 下载 + 进度 EventsEmit 推送
- [x] `DownloadAndImport` binding — zip 自动扫描首个 PMX 并解压落库
- [x] 🌐 资源站弹窗 — 点击弹出网站列表（模之屋 / Niconi / DeviantArt / BowlRoll），数据驱动可扩展
- [x] `ImportLocalFile` binding — 本地 zip/pmx/vmd 文件导入模型库
- [x] 下载进度条 UI — 底部栏显示文件名 + 进度百分比
- [x] 下载完成自动刷新模型库 + 进度条 2 秒后自动隐藏

**下载目录监听（方案 B）**
- [x] `StartWatchDir` / `StopWatchDir` — fsnotify 目录监听生命周期
- [x] `watchLoop` — 800ms debounce，仅监听 `.zip/.pmx/.vmd` Create/Write
- [x] `watch:newfile` 事件 — 检测到新文件通知前端
- [x] 导入通知 toast — 右下角浮层（📦 检测到新模型 / 文件名 / [导入] [忽略]）
- [x] `SetDownloadWatchDir` — 配置持久化 + 启动自动恢复
- [x] 设置面板 — 下载监听目录输入 + 📁 选择 + 自动导入 checkbox

**UI 架构（MenuStack 导航栈系统）**
- [x] `MenuStack` 类 — 通用导航栈（push/pop/popTo），所有弹窗共享同一套渲染逻辑（`menu.ts`）
- [x] `PopupRow.kind` 扩展为 `"folder" | "model" | "action"` — 设置项作为 action 行接入导航栈
- [x] `.menu-item` / `.menu-list` 统一样式 — 替换散装 `.popup-row`、`.overlay-row`、`.site-row`
- [x] 滑动切换动画 — `.slide-left-out` / `.slide-right-in` 等四个动画类
- [x] 自动导入模式 — 勾选后检测到新文件跳过确认直接导入

**网站跳转弹窗**
- [x] 🌐 底部按钮改为弹窗形式 — 数据驱动 `sites[]` 列表，可自由增删
- [x] 内置入口：模之屋 / Niconi / DeviantArt / BowlRoll
- [x] 点击行 → `BrowserOpenURL` 在外部浏览器打开

**CSS 统一重构**
- [x] 删除 `index.html` 内联 410 行 `<style>` → 移入 `src/app.css`
- [x] 删除 `src/style.css`（20 行）— 合并到 app.css
- [x] CSS 变量体系 — `--accent` / `--overlay-bg` / `--text` 等 12 个设计 token
- [x] 统一弹窗复用类 — `.overlay` / `.overlay-header` / `.overlay-close` / `.overlay-body` / `.overlay-row` 等 15 个 class
- [x] 消除 5 套弹窗重复样式（background/blur/border/radius／header/close）
- [x] 消除 20+ 处硬编码色值 → CSS 变量
- [x] inline style 收归 — popupSearchInput / dlUrlInput / dlNameInput 改为 class

**图标系统**
- [x] Lucide → Iconify 迁移 — `@iconify/iconify` + `iconify-icon` 接管所有图标渲染
- [x] 混合图标库 — Lucide 主库（通用）+ Tabler 补专用（`cube-3d-sphere`、`run` 等）
- [x] `iconify-icon` web component 替换 `<i data-lucide>` — 无需 tree-shaking 配置
- [x] 底栏图标差异化 — 模型（`tabler:cube-3d-sphere`）、动作（`lucide:music`）、场景（`lucide:monitor`）、设置（`lucide:settings`）
- [x] `lucide` npm 包移除 — 节省 ~200KB bundle

**代码质量**
- [x] `openFileDialog` 提取 — `SelectPMXFile` / `SelectVMDMotion` 从 22 行各减至 5 行
- [x] `decodeZipName` 自动编码检测 — Shift-JIS / GBK 双向解码评分择优

**场景面板**
- [x] 右侧场景面板移除 — 功能合并到模型弹窗「加载模型」上方（已加载模型作为按钮 + 分隔线）
- [x] `divider` 行类型 — `PopupRow.kind: "divider"`，`menu.ts` 渲染为分隔线

**场景菜单（独立底部导航）**
- [x] 新增 `btnScene` 底部导航按钮 — 位于 动作 和 设置 之间
- [x] 场景弹窗 `#sceneOverlay` — 整合相机模式切换 + 灯光控制
- [x] 相机模式子菜单 — 轨道/自由飞行/镜头预设/演唱会（从模型弹窗移来）
- [x] 灯光控制子菜单 — 环境光/方向光强度 + 方向光角度 XZ 滑块（从设置移来）

**菜单架构**
- [x] 面包屑改为返回箭头 — `← 当前层名`，点击返回上层
- [x] 模型弹窗根菜单重构 — 常用操作（加载模型/重新扫描）提前，分组（加载模型+重新扫描）→ 管理功能（收藏/标签/舞蹈套装）；移除「即将推出」占位项；动作倍率/角色定制删除
- [x] 动作弹窗重构 — 移除「即将推出」占位项；舞蹈套装从模型弹窗移入，与加载动作并列
- [x] 设置弹窗 MenuStack 化 — 外部库从独立 Overlay 移入系统子菜单；系统子菜单分组（外部库管理/添加外部库 → 路径子菜单 → 清除缓存子菜单）；路径文案「检测 MMD 路径」→「自动检测 MMD」

**体验增强功能（Phase 5）**
- [x] 模型统计信息 — 模型详情 → 模型信息，显示顶点/面/骨骼/表情数等 PMX 元数据
- [x] 批量截图 — 场景菜单 → 截图 → 截图当前 / 批量截图到目录，PNG 格式
- [x] 近期播放 — 模型弹窗根菜单「最近打开」，最多 20 条，自动去重置顶
- [x] 收藏合并到标签系统 — 底层存储在内置标签「收藏」，自动迁移旧数据
- [x] 表情预览 — 模型详情 → 表情预览，滑块调节所有 morph 权重 0~1，关闭弹窗自动重置
- [x] 标签系统 — 完整的标签管理（添加/删除/按标签筛选），模型详情页标签管理

**材质与渲染增强（Phase 6）**
- [x] 材质参数调节（按部位分类）— 皮肤/头发/眼睛/服装，每类调节 Diffuse/高光/环境光
- [x] 线框显示开关 — 场景菜单 → 模型 → 每个卡片显示线框 toggle
- [x] 重力控制 — 场景菜单 → 物理 → 重力强度滑块（0~2 倍默认重力）

**播放列表（Phase 7）**
- [x] 播放列表 — 创建/删除/添加模型/开始播放/上一下一（Go 端持久化）

**弹窗管理**
- [x] `closeAllOverlays()` — 统一关闭所有弹窗（通用化：查询 `.overlay.visible` 自动隐藏）
- [x] 单例模式 — 打开任一弹窗自动关闭其他，避免重叠
- [x] Esc 简化 — 一键关所有弹窗，不再逐个判断
- [x] settings / scene 弹窗静态面包屑清理 — 与 modelPopup 统一，由 MenuStack 在底部渲染

**状态栏提示系统**
- [x] hover hint 系统 — 鼠标悬停 nav 按钮 / 菜单行时，状态栏显示操作说明
- [x] `data-hint` 属性驱动 — 静态元素（HTML）+ 动态元素（MenuStack 行）统一走同一套机制
- [x] 渐进式引导文字 — 首次无库显示提示、已配库显示操作指引、"暂无描述"/"暂无提示" 回退
- [x] VMD 缓存通知浮层 — 无模型时加载 VMD 弹蓝色通知 `💃 VMD 已缓存 — 加载任意模型后自动应用`
- [x] VMD 状态合并 — 模型加载同时应用缓存 VMD 时，状态栏合并显示 `✓ 模型名 + VMD名`
- [x] 状态栏默认文字 — HTML 直接设为 `"点击 📦 打开模型库 · 鼠标拖拽旋转 · 滚轮缩放"`，不等 JS 初始化

**代码质量**
- [x] 前端模块拆分 — `config.ts` + `scene.ts` + `library.ts` + `main.ts` + `download.ts`
- [x] 移除下载引擎 + 目录监听全套 — 抽入 `MMDDownloader/` 作为独立项目骨架
- [x] HTTP 服务重构 — 从单服务器（不同目录互相覆盖）改为多服务器映射（每目录独立端口）
- [x] 移除 `/get/` 路由 — 全部请求走 `basenameFallbackFS`，消除 `n=` 参数带来的编码/路径/插件检测问题
- [x] CORS 简化 — 从条件判断改为无条件 `*`（桌面应用无 CSRF 风险）
- [x] `ExtractZip` 错误全处理 — 不再静默忽略
- [x] PMX header 解析单元测试 — `pmx_test.go`（7 用例）
- [x] `decodeZipName` 编码检测 — `NonUTF8` 标志位 + `detectUTF8` + 控制字符清理
- [x] `userConfigDir` 可注入 — `configDir()` 通过包级变量调用，测试可覆写
- [x] `detectBlender` 纯函数拆分 — `detectBlenderAt(lookPath, candidates)` 参数可注入
- [x] `basenameFallbackFS` 响应缓冲修复 — `bufferingResponseWriter` 解决 404 commit 后无法退的问题
- [x] `app_test.go`（12 用例：configDir 4 + writeConfig 5 + detectBlender 3）
- [x] `fs_test.go`（8 用例：basenameFallbackFS 正常/子目录/fallback 命中/大小写/中文/未命中/空目录/不存在目录）
- [x] Go 端 `pendingVmdData`/`pendingVmdName` → `pendingVmd` 原子对象 — 消除配对遗漏风险
- [x] Go 端移除僵尸 `setCurrentPort` — 多模型时代已用 `inst.port`
- [x] Go 端 `updateConfig(mutate, rescan)` — 6 个函数统一 Config 读写模式
- [x] Go 端 `ensureDir(subDir, useCache)` — 3 个目录函数消除重复 `MkdirAll` 模式
- [x] Go 端 `openFileDialog` 复用 — `SelectSceneOpenFile` 改用共享 helper
- [x] 前端 `scene-menu.ts` 消除 `cloneNode` 重复 ID — 改为 `createElement`
- [x] `fileservice.ts` 统一 URL 构造 — `resolveFileUrl` 收拢 `loadPMXFile`/`loadVMDFromPath` 散落的构造逻辑，消除"改一处漏一处"
- [x] `rescanAndSync()` — 收拢 5 处 `ScanModelDir+setAllModels+SetLibraryRoot` 重复模式
- [x] `reloadConfig()` — 收拢 2 处 `GetConfig+setLibraryRoot+setExternalPaths` 重复模式（`settings.ts`）
- [x] `modelToRow` null safety — `m.file_path` / `m.zip_inner` 缺失时不再崩溃
- [x] `closeAllOverlays()` 通用化 — `document.querySelectorAll(".overlay.visible")` 替代硬编码列表
- [x] `initLibrary` 状态信息合并 — 无库显示引导、有库显示操作指引，删除与 HTML 默认重复的 setStatus
- [x] 前端 Vitest 测试套件（10 文件 160 tests，全量覆盖真 import 而非本地 mock）:
  - `vpd-parser.test.ts`（21 tests）— 真·import vpd-parser，TDD 产物，锁 VMD 帧格式/编码检测/pose 解析
  - `material-editor.test.ts`（39 tests）— 真·import scene.ts（`_catOf`/`_applyAll`/`setMatParams` 等），含 `_applyAll` 叠加顺序 regression 5 tests，Babylon.js 全 mock 环境
  - `model-preset.test.ts`（20 tests）— 真·import library.ts + scene.ts（`serializeModelPreset`/`applyModelPreset`/`stopVMD`/`getMatState`/`applyMatState`）
  - `config.test.ts`（13 tests）— 纯函数补测（`formatTime`/`escapeHtml`/`normPath`）
  - `vmd-writer.test.ts`（10 tests）— VMD 二进制格式正确性（帧大小/签名/插值/偏移）
  - `beat-detector.test.ts`（10 tests）— 节拍检测逻辑（周期峰值/平坦/间隔约束/BPM 估计）
  - `procedural-motion.test.ts`（17 tests）— Idle/Auto Dance VMD 生成 + auto-switch 逻辑

**UI 自定义系统**
- [x] CSS 功能性 token 体系 — `--font-ui`/`--font-ui-sm`/`--font-title`/`--font-time` 等 7 个用途化变量，替代旧尺寸名变量（`--font-size-md` 等保留别名）
- [x] UI 缩放 — `--ui-scale` 全局联动，设置页滑块 0.8~1.3
- [x] 弹窗宽度 — `--popup-width` 缩放感知，用户可调 220~360px
- [x] 主题色 — 6 预设色块 + 自定义 hex 输入，即时切换 accent 色系
- [x] 字体切换 — 系统默认/思源黑体/微软雅黑三档
- [x] DanceXR 风格 UI — 透明弹窗 + 不透明浮动卡片（`--card-bg`），每个菜单行独立圆角卡片
- [x] 材质列表美化 — 颜色色块、材质序号、大分类折叠（>15 默认收起）、参数微调下拉面板
- [x] 滑动动画开关 — 关闭后 MenuStack 过渡 0s，弹窗直接切换
- [x] 背景模糊开关 — 开时 overlay 恢复毛玻璃效果
- [x] Go 端 UIState 持久化 — `Scale`/`PopupWidth`/`Accent`/`FontFamily`/`Animations`/`BlurBg` 6 字段
- [x] 设置页「界面」子菜单 — UI 缩放 + 高级设置（弹窗宽度/动画/模糊/主题色/字体/恢复默认）
- [x] 硬编码 `font-size` 替换 — app.css 中 70+ 处 `Npx` 改为 `var(--font-*)`，随缩放联动

**拖拽导入**
- [x] `ImportZip` Go binding — 打开 zip 扫首个 .pmx → `ExtractZip`（约 20 行）
- [x] `OnFileDrop` 监听 — Wails 原生 API，返回 OS 文件路径，不依赖浏览器 drag API
- [x] 文件分发 — `.zip` → `ImportZip` → `refreshLibrary`；`.pmx` → `loadPMXFile`；`.vmd` → `loadVMDFromPath`
- [x] 串行队列 — `for await` 循环逐个处理，防止多文件并发冲突
- [x] 拖拽遮罩视觉反馈 — 蓝色半透明遮罩 + 虚线框指示器（`dragenter`/`dragleave` 计数器防闪烁）
- [x] 状态栏反馈 — 拖放过程中显示「导入压缩包…」「加载模型…」等实时状态

**HTTP 目录隔离**
- [x] `IsolateModelDir` — 外部文件自动 copy 到 `%TEMP%/MikuMikuAR/serve/<hash>/` 后再启动文件服务器，防止下载目录整站暴露（`app.go:1406`）
- [x] `isSafePath` — 路径前缀校验，仅信任库目录 + 外部库路径（`app.go:1376`）
- [x] `resolveFileUrl` — 前端统一入口，先隔离再启动服务器（`fileservice.ts:14`）

**Bug 修复**
- [x] `index.json` 旧缓存 `file_path` 为空 — `GetLibraryIndex` 反序列化后过滤空条目；前端缓存加载时二次过滤；移除前端的 `|| ""` 防御（#22）
- [x] `watchLoop` timer 竞态 — `time.AfterFunc`+`timer.Reset` 改为 `time.Ticker`，消除 Go 文档警告的 race（#23）
- [x] 无 Content-Length 进度反馈 — 每 500ms 发 `downloading_unknown` 心跳；前端显示滚动动画进度条（#24）
- [x] 自动导入失败进度条不消失 — catch 块加 `hideDownloadBar(5000)`（#25）
- [x] `HasThumb` 永为 false — `scanDirRecursive` 加 `thumbDir` 参数，扫描时检测缩略图文件（#26）
- [x] 拖拽多文件并发 — `for await` 串行化，避免 `loadPMXFile` 并发守卫丢弃后续文件（#27）

- [x] `OpenInBlender` binding — `exec.Command` 启动本地 Blender 并传入 PMX 路径
- [x] `detectBlender` — 自动检测 PATH + 6 个常见 Windows 安装路径
- [x] `SetBlenderPath` — 手动配置路径持久化到 `config.json`
- [x] 弹窗模型行 ✏️ 按钮 — PMX 格式模型显示编辑按钮，点击唤起 Blender
- [x] 配置写入分离 — `writeConfig` 轻写 vs `writeConfigAndRescan` 全量扫描

### 计划中
- [x] 标签系统（替代 DanceXR 分类硬编码）✅ 已完成（Phase 1）
- [x] 场景保存/加载（`.mmascene` JSON 格式，含模型/VMD/相机状态）✅ 已完成
- [x] 渲染调参系统（Phase 2）— Bloom/FXAA/边缘高亮/色调映射/曝光/对比度/FOV/背景色 + 5 内置预设 + 用户自定义预设持久化 ✅ 已完成
- [x] 音乐同步 + 相机 VMD + 舞蹈套装（Phase 3）✅ 已完成
- [x] 模型统计信息 + 批量截图 + 近期播放 + 表情预览（Phase 5）✅ 已完成
- [x] 单独材质编辑器（逐材质独立调参）✅ 已完成
- [x] VPD 姿势导入（VPD → VMD 帧转换，含编码自动检测 Shift-JIS/UTF-8）✅ 已完成
- [x] 模型加载预设（角色设置快照）✅ 已完成
- [x] 软件管理（扫描 software/ 目录 + 自定义软件 + 模型详情「用…打开」）
- [x] 程序化动作（Auto Dance / Idle Motion）
- [x] 音乐节拍检测（Web Audio API 能量峰值法）
- [x] 换装系统（服装变体/纹理替换）✅ 已完成
- [x] 物理分类开关（按部位选择性开关物理）✅ 已完成
- [x] LipSync（实时振幅驱动「あ」morph）— Web Audio 人声频段能量 → amplitudeToWeight → setModelMorphWeight
- [ ] 天空 / 水体 / 道具 / 特效
- [x] 软件管理（扫描 software/ 目录 + 自定义软件 + 模型详情「用…打开」）
- [x] 模型加载预设（角色设置快照）✅ 已完成
- [ ] ❌ 模之屋下载接管 — 放弃。WebView 方案风险过高，见 ADR-003
- [ ] Android 端适配

---

## 开发路线图

```
Week 1-2    VMD 播放 + 纹理加载               ← ✅
              ↓
Week 3-4    模型库浏览                       ← ✅
              ↓
Week 5-6    zip 容器                         ← ✅ 提前交付
              ↓
Week 7+     外部库挂载 + 体验打磨            ← ✅
              ↓
Phase 1     标签系统                              ← 当前
              ↓
Phase 2     渲染调参系统                      ← ✅ 已完成
               ├── 材质参数(按部位) + 单独材质编辑器 ✅ 已完成
               ├── 后处理滤镜(Bloom/轮廓线/色彩校正) ✅
               ├── 渲染预设 + 色调映射 ✅
               ├── 曝光/FOV/重力 ✅
               └── 线框/骨骼显示切换 ✅ 已完成
              ↓
Phase 3     音乐同步 + 相机VMD               ← ✅ 已完成
              ├── 音乐同步(MP3/WAV/OGG) + 音频偏移 ✅
              ├── 相机 VMD 轨道 ✅
              └── 舞蹈套装(VMD+音频捆绑) ✅
              ↓
Phase 4     下载目录监听 + 自动导入 (ADR-008) ← ✅ 已完成
              ↓
Phase 5     体验完善                          ← ✅ 已完成
              ├── 模型统计信息(顶点/面/骨骼/表情) ✅
              ├── 批量截图(截图当前/批量截图到目录) ✅
              ├── 近期播放(最近打开的模型) ✅
              ├── 收藏底层合并到标签系统 ✅
              └── 表情预览(滑块调节所有morph) ✅
              ↓
Phase 6     材质与渲染增强                    ← ✅ 全部完成
               ├── 材质参数调节(按部位:皮肤/头发/眼睛) ✅
               ├── 单独材质编辑器(逐材质独立调参) ✅
               ├── 线框/骨骼显示切换 ✅
               └── 重力控制(衣物/头发物理摆动) ✅
              ↓
Phase 7     播放列表与预设                    ← ✅ 全部完成
               ├── 播放列表(模型顺序列表/标签自动生成) ✅
               ├── 模型加载预设(角色设置快照) ✅
               └── 软件管理(扫描 software/ 目录) ✅
              ↓
Phase 8     动作与环境增强                    ← ✅ 已完成
              ├── VPD 姿势导入
              ├── 程序化动作(Auto Dance/Idle Motion)
              ├── 换装系统/纹理增强
              ├── LipSync/音乐节拍检测
              └── 天空/水体/道具/特效
              ↓
Phase 9     扩展物理与平台                    ← 深度规划
              ├── 布料模拟/软体物理/粒子
              └── 多相机模式(Freefly/One-shot/Concert)
              ↓
Phase 10    Android 适配                     ← 远期
```

---

## Bug 记录

| # | 现象 | 状态 |
|---|------|------|
| 1 | ~~模型无颜色/纹理 — basenameFallbackFS 兜底后已正常~~ | ✅ |
| 2 | ~~VMD 走 base64 桥接 — 已改为 HTTP fetch~~ | ✅ |
| 3 | ~~VMD 加载失败 — 缺失 `mmdWasmRuntimeModelAnimation` import~~ | ✅ |
| 4 | ~~PMX "is not pmx file" — Wails []byte 共享池~~ | ✅ HTTP 替代 |
| 5 | ~~进度条拖拽与 auto-loop 竞态 — seekDragging 守卫~~ | ✅ |
| 6 | ~~VMD 僵尸态 — 先加载后销毁旧动画~~ | ✅ |
| 7 | ~~VMD 缓存被 clearCurrentModel 清掉 — pendingVmd 保存~~ | ✅ |
| 8 | ~~搜索结果 zip 不工作 — onModelRowClick 共用函数~~ | ✅ |
| 9 | ~~pendingVmdData 逻辑混乱 — 提前清除 + 传目标模型 ID~~ | ✅ |
| 10 | ~~auto-loop 多模型不准 — ModelInstance.animationDuration~~ | ✅ |
| 11 | ~~clearCurrentModel 语义错误 — 改 removeFocusedModel~~ | ✅ |
| 12 | ~~进度条总时长/seek 范围错误 — 改用焦点模型时长~~ | ✅ |
| 13 | ~~跨模型 VMD 端口错误 — 从 focusedModel().port 取~~ | ✅ |
| 14 | ~~删除模型后不重排 — removeModel 末调用 arrangeModels~~ | ✅ |
| 15 | ~~箭头键 seek 未用焦点模型时长 — 改用 animationDuration~~ | ✅ |
| 16 | ~~无模型时 currentPort 残留 — registry 空时重置~~ | ✅ |
| 17 | ~~ExtractZip 静默忽略错误 — 加日志 + 错误返回~~ | ✅ |
| 18 | ~~CORS 条件判断简化 → 无条件 `*` (桌面无 CSRF 风险)~~ | ✅ |
| 19 | ~~旧 HTTP 服务 Close 不等待 — 改 Shutdown 带超时~~ | ✅ |
| 20 | ~~httpSrvDir/Port 无锁保护 — 加 getter + mutex~~ | ✅ |
| 21 | ~~前端空 catch 吞噬错误 — 加 console.warn + setStatus~~ | ✅ |
| 22 | ~~OpenWithSoftware `{model}` 路径含空格被切碎 — 按段替换而非整体替换~~ | ✅ |
| 23 | ~~软件管理列表首次访问闪白 — renderCustom 内 await scan~~ | ✅ |
| 24 | ~~软件详情子菜单 `cachedSoftwareEntries` 可能过期 — renderCustom 总是先 fetch~~ | ✅ |
| 25 | ~~shouldIdle 不处理 autodance 模式，音乐停止后不降级 Idle — 补充 `mode === "autodance"`~~ | ✅ |
| 26 | ~~场景反序列化后程序化动作不启动 — deserializeScene 末尾调 regenerateProcMotion~~ | ✅ |
| 27 | ~~regenerateProcMotion 首次选模式时因 procVmdActive=false 跳过 — 改为 `off` 才跳过~~ | ✅ |
| 28 | ~~startProcMotion 未清除 inst.vmdName，动作弹窗显示残留 "IdleMotion" — 补 `vmdName = ""`~~ | ✅ |
| 29 | ~~暂停/播放按钮和动作菜单「暂停」误动 autoLoop，与 Space 键不一致 — 移除 autoLoop 操作~~ | ✅ |

---

## 核心价值定位

与其他方案的区别：

| 对比 | DanceXR | babylon-mmd demo | gzhlaker_mmdmanager | MMD Viewer (纯Web) | MmdOnlineStudioV1 | MikuMikuAR |
|------|---------|------------------|---------------------|-------------------|-------------------|--------|
| 定位 | 成品播放器 | 技术演示 | 桌面管理器 | **渲染调参标杆** | 在线轻量查看器 | **聚合管理器 + 播放器** |
| 桌面集成 | 原生 | 纯网页 | Electron | 纯浏览器 | 纯浏览器 | **Wails 轻量原生** |
| 库管理 | 文件系统 | 无 | ✅ 文件浏览 | 无 | 无 | **✅ 完整库管理** |
| 多模型同场 | ✅ | ❌ | ❌ | ❌ | ❌ | **✅ 核心优势** |
| 渲染调参 | ❌ | ❌ | ❌ | **✅ 极丰富** | ❌ | ⬜ 补齐中 |
| 物理 | ✅ WASM Bullet | ammo.js | ❌ | ammo.js | ❌ | **✅ WASM Bullet** |
| 模型统计 | ❌ | ❌ | ❌ | ❌ | ✅ 顶点/材质/骨骼 | ✅ 顶点/面/骨骼/表情 |
| 聚合生态 | 封闭 | 无 | 封闭 | 无 | 无 | **DanceXR+Blender+模之屋** |

MikuMikuAR 的独特价值在于**聚合生态**：让 DanceXR、Blender、模之屋的用户共享同一个模型库。

---

## DanceXR 功能对标进度总览

基于 [requirements.md](requirements.md) §「DanceXR 功能对标与规划参考」的详细映射表，以下为整体搬运进度：

| 分类 | 总数 | ✅ 已覆盖 | 📋 可规划 | 🔄 转发层 | ❌ 不适配 | 完成率 |
|------|------|----------|-----------|-----------|----------|--------|
| 模型支持 | 7 | 6 | 1 | 0 | 0 | **86%** |
| 外观(渲染) | 10 | 9 | 1 | 0 | 0 | **90%** |
| 物理 | 1 | 1 | 0 | 0 | 0 | **100%** |
| 动作与媒体 | 10 | 7 | 0 | 3 | 0 | **70%** |
| 氛围与环境 | 2 | 2 | 0 | 0 | 0 | **100%** |
| 相机 | 2 | 1 | 1 | 0 | 0 | **50%** |
| 系统与平台 | 4 | 3 | 1 | 0 | 0 | **75%** |
| **合计** | **36** | **30** | **3** | **3** | **0** | **83%** |

> 统计口径：仅统计对标表中非 🔄/❌ 的可实现功能。AI/AI 语音/成人内容等全部 🔄/❌ 不纳入。

### 已完成的核心里程碑

| 阶段 | 功能 | 状态 |
|------|------|------|
| Phase 1 | 标签系统 | ✅ |
| Phase 2 | 渲染调参（Bloom/色调映射/曝光/FOV/预设） | ✅ |
| Phase 3 | 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ |
| Phase 4 | 下载目录监听 + 自动导入 | ✅ |
| Phase 5 | 体验完善（统计/截图/播放记录/表情预览） | ✅ |
| Phase 6 | 材质与渲染增强（材质调节/线框/重力） | ✅ |
| Phase 7 | 播放列表 + 模型加载预设 + 软件管理 | ✅ |
| Phase 8 | 程序化动作 + 音乐节拍检测 + 换装系统 + 物理分类开关 | ✅ |

**LipSync（实时振幅驱动）**
- [x] `lipsync.ts` 纯函数模块（findLipMorph / amplitudeToWeight / LipSyncState）
- [x] `BeatDetector.getLevel` 暴露频段能量
- [x] `scene.ts` 动画 tick 集成 + setter/getter + SceneFile 序列化
- [x] 场景菜单「程序化动作 → LipSync」子菜单（启用 + 灵敏度 + 强度）

### 待搬运的 DanceXR 深度功能

| 功能 | 优先级 | 依赖 |
|------|--------|------|
| VPD 姿势导入 | P3 | VMD 加载器扩展 | ✅ 已完成 |
| 程序化动作（Idle Motion/Auto Dance） | P3 | WASM 动画扩展 | ✅ 已完成 |
| 换装系统 / 纹理增强 | P4 | 模型系统扩展 | ✅ 已完成 |
| 物理分类开关 | P3 | 骨骼名正则分类 | ✅ 已完成 |
| LipSync / 音乐节拍 | P4 | 音频系统扩展 |
| 布料模拟 / 软体物理 | P4 | WASM 物理扩展 |
| 天空 / 水体 / 道具 / 特效 | P4 | 场景系统扩展 |

---

## 下一步

核心管线与基础功能已全部就绪，进入**深度功能搬运与体验精化**阶段：

**短期（Phase 8）：动作与环境增强**
- ✅ 程序化动作（Auto Dance / Idle Motion）— 已完成
- ✅ 音乐节拍检测（Web Audio API 能量峰值法）— 已完成
- ✅ 单独材质编辑器（逐材质独立调参）— 已完成
- ✅ 模型加载预设（角色设置快照）— 已完成
- ✅ 换装系统（服装变体）— 已完成
- ✅ 物理分类开关（按部位选择性开关物理）— 已完成

**测试基建已就绪**
- Vitest 前端测试套件 160 tests，10 文件全量真 import
- `material-editor` + `model-preset` 伪测试清零，regression 由 `_applyAll` 叠加顺序 5 tests + `serializeModelPreset`/`applyModelPreset` 来回 11 tests 锁住
- Babylon.js mock 层可复用于后续任何需要真 import scene.ts 的测试文件

**中长期（Phase 9-10）：扩展物理与平台**
- 布料模拟 / 软体物理 / 粒子
- 多相机模式（Freefly/One-shot/Concert）
- Android 端适配

---

## 键盘快捷键体系（v2 现状）

### 设计原则

- Ctrl+1~5 = 5 个导航按钮开/关，与 DOM `data-shortcut` 声明式绑定
- 弹窗内不混入 Ctrl+数字（旧版 `clickPopupItem` 已删除，不适用于 MenuStack + renderCustom 架构）
- 所有弹窗关闭统一走 `closeAllOverlays()`（Escape / 点空白 / 点其他按钮）

### 绑定方式

| 快捷键 | 按钮 ID | DOM 属性 | 映射函数 | 行为 |
|--------|---------|----------|---------|------|
| Ctrl+1 | `#btnMainAction` | `data-shortcut="1"` `aria-controls="modelPopup"` | `togglePopup()` | toggle |
| Ctrl+2 | `#btnMotionPopup` | `data-shortcut="2"` `aria-controls="motionPopup"` | `toggleOverlay()` → `showMotionPopup()` | toggle |
| Ctrl+3 | `#btnScene` | `data-shortcut="3"` `aria-controls="sceneOverlay"` | `toggleOverlay()` → `showSceneMenu()` | toggle |
| Ctrl+4 | `#btnEnv` | `data-shortcut="4"` `aria-controls="sceneOverlay"` | `toggleOverlay()` → `showEnvMenu()` | toggle |
| Ctrl+5 | `#btnSettings` | `data-shortcut="5"` `aria-controls="settingsOverlay"` | `toggleOverlay()` → `showSettings()` | toggle |

### 菜单内键盘导航（SlideMenu）

| 按键 | 行为 |
|------|------|
| `↑` | 选中上一项（首项→尾项循环） |
| `↓` | 选中下一项（尾项→首项循环） |
| `→` / `Enter` | 激活选中项（进子菜单 / 执行 action） |
| `←` | `pop()` 回退一层 |
| `.slide-focused` | CSS 高亮类（`--accent-dim` outline） |

聚焦管理：`reset()` / `reRender()` / 动画结束 → 自动聚焦第一项。`renderCustom` 层自动禁用。

### 无障碍

- 5 个 nav 按钮有 `aria-label` / `aria-controls` / `aria-expanded`（动态同步）
- `closeAllOverlays()` + `toggleOverlay()` 结束时自动同步 `aria-expanded`
- `.slide-item` 尚无 `role="menuitem"` / `tabindex`（待补）

### 已知冲突（记录，暂不修）

| 冲突 | 表现 | 原因 |
|------|------|------|
| Space 在菜单内仍触 Play/Pause | 菜单开着按 Space 切换播放而非激活菜单项 | 全局 keydown handler 优先于菜单内 handler |
| `→/←` 与全局 seek 冲突 | 菜单内按 `→/←` 走菜单导航；菜单关时走 seek ±5s | 当前行为正确，但用户可能误触 |
| WASD freefly 与菜单共存 | 菜单开着时 WASD 仍控制相机 | freefly 独立于弹窗状态 |
| `.slide-focused` 无键盘显式焦点环 | 仅有背景色+outline，不支持 Tab 键切换 | 依赖容器键盘事件而非原生 tabindex |

## 程序化动作逻辑审查记录（2026-06-27）

### 已修复
| # | 问题 | 严重度 | 文件 | 修复 |
|---|------|--------|------|------|
| 1 | `startProcMotion` 在 `loadVMDMotion` 异步失败后 `procVmdActive` 残留 → 系统认为已有 VMD 不再重试 | P0 | `scene.ts` | `try/catch` → catch 回设 `false` |
| 2 | `autoSwitch=false` 时手动设 `idle`/`autodance` 模式不生效 | P0 | `scene.ts` | `wantAutoDance/Idle` 改为 `mode !== "off"` 时不依赖 autoSwitch |
| 3 | `updateProcMotion` 是 async fire-and-forget，60fps tick 可能并发 | P1 | `scene.ts` | `procStarting` 锁 + `try/finally` |
| 4 | `stopProcMotion` 只设 flag 不清 WASM 动画 → 关闭后动画继续播放 | P1 | `scene.ts` | 调用 `setRuntimeAnimation(null)` |
| 5 | `loadVMDMotion` 设置 `inst.vmdData` → `hasUserVmd=true` → 下一 tick 立即杀死 procedural VMD → 无限循环 | P0 | `scene.ts` | 加载后清除 `inst.vmdData` |
| 6 | auto-switch 一次后永久失效：`updateProcMotion` 把 mode 从 `"off"` 改为 `"idle"`，之后 `shouldAutoDance` 永远返回 false | P0 | `scene.ts` | 新增 `procActiveKind` 追踪实际加载类型，不篡改 `procState.mode` |
| 7 | `loadVMDMotion` 在 `playAnimation()` 阶段失败后 `inst.vmdData` 未被清理 → `hasUserVmd` 永久 true | P0 | `scene.ts` | catch 块也清 `inst.vmdData` |
| 8 | 焦点切换后 `stopProcMotion` 清错了模型（用 `focusedModel()` 而非持有 VMD 的模型） | P1 | `scene.ts` | 新增 `procModelId` 精确追踪 |
| 9 | 删除模型后 `procVmdActive` 残留 → 新模型无法获取 procedural motion | P2 | `scene.ts` | `removeModel` 中检查并清理 |
| 10 | `scene-menu.ts`：「模式」用 `kind:"folder"` 但 `onFolderEnter` 无 case → 点不动 | P0 | `scene-menu.ts` | 新增 `case "procmotion:mode"` |
| 11 | `scene-menu.ts`：「自动切换」用 `kind:"folder"` 但功能是 toggle → 点不动 | P0 | `scene-menu.ts` | 改为 `kind:"action"` |
| 12 | `scene-menu.ts`：label `"Idle 呼吸"`/`"Auto Dance"` 含英文 | P2 | `scene-menu.ts` | 改为 `"待机呼吸"`/`"自动舞蹈"` |
| 13 | `vmd-writer.ts`：`encodeBoneName` try/catch 两分支完全一样 | P3 | `vmd-writer.ts` | 去掉 try/catch 直接 UTF-8 |
| 14 | `beat-detector.ts`：`BeatInfo`/`isBeat()`/`getEnergy()` 死代码；每帧 `reduce` 全量求和 | P3 | `beat-detector.ts` | 删除 / 改为 running sum |
| 15 | `procedural-motion.ts`：`BONE_NECK`/`half` 死代码；3 个循环各自算一次 sin | P3 | `procedural-motion.ts` | 删除 / 预计算 sin 数组 |

### 截图面板审查（无 bug）
- `dom.canvas` 只抓 WebGL 画布，不影响 UI 覆盖层 ✓
- `batch` 截图后 `focusModel(prevFocused)` 恢复焦点 ✓
- `modelRegistry` 在 async 操作期间没被篡改 ✓

### 相机面板审查（无 bug）
- 模式切换 + `refreshCameraLevel` 下标 `levelCount-1` 在栈顶操作时正确 ✓
- VMD 相机条件渲染 `hasCameraVmd()` 逻辑正确 ✓
- `clearCameraVmd` 自动切回 orbit ✓

### 设计不一致（非 bug）
- Orbit 参数滑块实时更新相机 (`cam.radius = v`)，但 freefly/concert 参数存值后要等下次切换模式才生效

- `clickPopupItem(N)` → 已删除。MenuStack 架构下弹窗内 Ctrl+N 不匹配（`renderCustom` 无 `.menu-item`、折叠子项编号漂移）
- `triggerNavButton()` / `navButtonLabels` → 已删除，替换为 `navActions` + `navLabels` 声明式映射
- `isAnyPopupOpen()` → 已删除，Ctrl+N 不再分"弹窗内/外"两个语义
