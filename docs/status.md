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
- [x] 模型弹窗根菜单 — 场景(动态)/加载模型/相机模式/动作倍率/角色定制/重新扫描
- [x] 外部库移至设置弹窗
- [x] 重新扫描移至模型弹窗根菜单

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

**拖拽导入**
- [x] `ImportZip` Go binding — 打开 zip 扫首个 .pmx → `ExtractZip`（约 20 行）
- [x] `OnFileDrop` 监听 — Wails 原生 API，返回 OS 文件路径，不依赖浏览器 drag API
- [x] 文件分发 — `.zip` → `ImportZip` → `refreshLibrary`；`.pmx` → `loadPMXFile`；`.vmd` → `loadVMDFromPath`
- [x] 串行队列 — `for await` 循环逐个处理，防止多文件并发冲突
- [x] 拖拽遮罩视觉反馈 — 蓝色半透明遮罩 + 虚线框指示器（`dragenter`/`dragleave` 计数器防闪烁）
- [x] 状态栏反馈 — 拖放过程中显示「导入压缩包…」「加载模型…」等实时状态

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
- [ ] 标签系统（替代 DanceXR 分类硬编码）
- [ ] 场景保存/加载（模型 + VMD + 相机状态持久化）
- [ ] VMD 舞蹈套装管理（VMD + 音频捆绑）
- [ ] 播放列表/收藏功能
- [ ] 多相机模式切换
- [ ] 模之屋下载接管（WebView + 拦截）
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
Phase 1     标签系统 + 场景保存/加载          ← 当前
              ↓
Phase 2     VMD 舞蹈套装 + 播放列表 + 多相机
              ↓
Phase 3     模之屋下载接管 → Android 适配
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
| 18 | ~~CORS * 过于宽松 — 限制到 127.0.0.1/localhost/Wails origin~~ | ✅ |
| 19 | ~~旧 HTTP 服务 Close 不等待 — 改 Shutdown 带超时~~ | ✅ |
| 20 | ~~httpSrvDir/Port 无锁保护 — 加 getter + mutex~~ | ✅ |
| 21 | ~~前端空 catch 吞噬错误 — 加 console.warn + setStatus~~ | ✅ |

---

## 核心价值定位

与其他方案的区别：

| 对比 | DanceXR | babylon-mmd demo | MikuMikuAR |
|------|---------|------------------|--------|
| 定位 | 成品播放器 | 技术演示 | **聚合管理器 + 播放器** |
| 桌面集成 | 原生 | 纯网页 | Wails 原生壳 |
| 库管理 | 文件系统 | 无 | **✅ 已实现** |
| 聚合生态 | 封闭 | 无 | **DanceXR + Blender + 模之屋** |

MikuMikuAR 的独特价值在于**聚合生态**：让 DanceXR、Blender、模之屋的用户共享同一个模型库。

## 下一步

从「功能骨架搭建」转向「聚合生态」+「体验打磨」：
1. **标签系统** — 模型库标签/分类管理
2. **场景保存/加载** — 保存当前场景状态为 .mmascene
3. **模之屋下载接管** — WebView 拦截下载链接
