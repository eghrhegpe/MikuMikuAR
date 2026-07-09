# ADR-017: Android 平台适配（精简版）

> **状态**: 主体已完成（Phase A/B/C ✅）；§六 P0(A0-01/A0-02) 与 P1(A1-01~03) 已实施；A0-01 采用 `MIXED_CONTENT_ALWAYS_ALLOW` 偏离推荐方案（技术债）；SAF 目录选择（§四）仍待实施（核对于 2026-07-10）
> **关联**: ADR-058（basenameFallbackFS）
> **来源**: ADR-017 + ADR-023 + ADR-067 + ADR-068 四合一（2026-07-08）

---

## 一、平台工作原理

| 层次 | 桌面 | Android |
|------|------|---------|
| Go 编译 | 原生可执行文件 | `CGO_ENABLED=1` + NDK → `libwails.so` |
| 前端渲染 | Wails WebView | Android WebView（Chrome 内核） |
| 内置资源 | `embed.FS` → HTTP 文件服务器 | `WebViewAssetLoader` 进程内服务 |
| 用户资源 | `StartFileServer` → `127.0.0.1:PORT` | 同上，Android Linux 内核 TCP 正常 |
| 对话框 | Wails Dialog API | SAF 文件选择器；SaveFile 不支持 |
| 文件访问 | 直接 `os.*` | 沙盒内 `os.*` 可用；外部文件经 Wails Dialog 选后复制到 cache |

**关键性质**：Android 是 Linux 内核，`net.Listen` / `os.ReadDir` / WASM / SharedArrayBuffer 均正常工作。

---

## 二、已完成的修复

### P0 修复（ADR-017 + ADR-068）

| Bug | 根因 | 修复 |
|-----|------|------|
| `openFileDialog` 硬挡 Android | 过时 `isAndroid` 守卫 | 移除守卫，Wails v3 SAF 文件选择器正常走通 |
| `prompt()`/`confirm()` ~20 处 | Android WebView 不实现 `onJsPrompt` | 替换为 Wails MessageDialog / 自定义 CSS 模态框 |
| AndroidManifest 缺 cleartext | — | 追加 `android:usesCleartextTraffic="true"` |
| 构建环境陷阱（B1） | `go:embed all:frontend/dist` 不自动重新编译 | 前端改动后须跑 `build-android.ps1`（全链路），`./gradlew installDebug` 不够 |
| Dialog overlay 残留（B2） | `#mmd-dialog-overlay` inline `pointer-events` 未清除 | `cleanup()` 中清除 inline 值 |
| 对话框未随菜单关闭（B3） | `closeAllOverlays()` 不处理 `#mmd-dialog-overlay` | `closeAllOverlays()` 新增 dialog 清理 |
| `tryCatchStatus` 误判成功为失败（B4） | async 回调不 return 值 | 替换为直接 `try/catch` |
| Go RWMutex 不可重入死锁（B5） | `updateConfig` 持写锁 → `GetConfig` 申请读锁 → 自死锁 | `writeConfigAndRescan` 直调 `scanAllCategories(cfg)` 传入已有 cfg |
| Config 写入后未缓存（B6） | `writeConfig()` 清缓存后未填充 | 写成功后 `cachedCfg = cfg` |
| Bootstrap 配置从未写入（B7） | 只写了 `setting/` 路径，未写 bootstrap | `writeConfig()` 同时写 bootstrap + setting 两处 |
| 目录名大小写不匹配（B8） | Go `/sdcard/MMD/PMX` vs 前端 `/pmx` | `CATEGORY_DIR` 映射表统一大小写 |

### Phase A/B 修复（ADR-023）

| 修复 | 说明 |
|------|------|
| 缓存目录重构 | `serveRootDir()` 统一走 `CacheRoot()`；Android `CacheRoot` 改为 `/data/data/<pkg>/cache` |
| FileAccessor 抽象 | 10 处 `os.*` → `fileAccessor.*`，桌面/安卓各一套实现，零行为差异 |

### ADR-068 追加修复

| Bug | 文件 |
|-----|------|
| 环境贴图浏览路径硬编码（B9） | `env-menu.ts`、`env-feature-levels.ts` |
| `motion-pose-levels.ts` 动态 import 运行时失败（B10） | 改为静态 `import` |

---

## 三、FileAccessor 抽象

**问题**：10 处 `os.*` 读取散落 3 个文件，接 SAF 需逐处修改。

**方案**：5 方法接口 + build tags 平台实现。

```go
type FileAccessor interface {
    Stat(path string) (os.FileInfo, error)
    Open(path string) (io.ReadCloser, error)
    ReadDir(path string) ([]os.DirEntry, error)
    WalkDir(root string, fs.WalkDirFunc) error
    Abs(path string) (string, error)
}
```

**原则**：
- 只抽象读取，写入在私有目录不需抽象
- 桌面端零行为差异（`os` 包薄包装）
- 安卓端 `content://` 返回 `ErrContentUriNotSupported`，不静默失败

**文件**：`fileaccess.go` / `fileaccess_desktop.go` / `fileaccess_android.go`

---

## 四、Android 文件访问现状（勘误后）

| 能力 | 状态 | 说明 |
|------|------|------|
| SAF 单/多文件选择 | ✅ 正常 | Wails `showFilePicker` → 自动复制到 cache → 返真实路径 |
| SAF 目录选择 | ❌ **未走通** | Wails 安卓直接拒绝（`dialogs_android.go:120`）；Java `openDocumentTree` 是孤儿桥（无人调用）+ `androidFileAccessor` 不支持 `content://` 遍历 |
| `content://` 遍历 | ❌ 不支持 | `androidFileAccessor` 对全部 `content://` 返回 `ErrContentUriNotSupported` |

**桌面端遗留问题**：`SelectDir` 的 `CanChooseDirectories(true)` 在 Windows 上实际弹出文件选择器而非目录选择器（待修复）。

**目录选择三条路径（勘误后）**：
- **C（止血·推荐）**：前端捕获 `SelectDir()` 异常并提示「安卓暂不支持选目录」
- **A（治本）**：Go 显式调 `openDocumentTree` + `androidFileAccessor` 经 `ContentResolver` 遍历 `content://` tree（即重启原 B 路径）
- **B（务实）**：资源根目录改 app 私有/授权目录，模型经 SAF 文件选择器导入

---

## 五、经验教训

1. **Go `embed.FS` 构建陷阱**：`go:embed all:frontend/dist` 在编译时静态内嵌前端。修改前端后必须跑 `build-android.ps1`（Go 交叉编译），`./gradlew installDebug` 只重打包 APK，不重新编译 `libwails.so`
2. **Go `sync.RWMutex` 不可重入**：持写锁的 goroutine 再获取读锁会导致自死锁。`updateConfig`（写锁）内部只能使用已持有的 `cfg` 参数，禁止调用 `GetConfig` 或 `ScanModelDir`
3. **配置双重路径**：bootstrap（`configDir()`）和完整配置（`settingDir()`）须同时写入
4. **大小写一致性**：Windows 不区分大小写不暴露的问题在 Android/Linux 文件系统上直接导致浏览为空。目录名映射表（`CATEGORY_DIR` / `defaultDirName` / `app.go:defs`）三处须保持同步

---

## 六、待实施的端口隐患（ADR-067）

> 以下为 ADR-067 扫描出的隐患清单，已排除本 ADR 中已修复的项目。

> **【2026-07-10 核对更新】** 本清单原标注为"待实施"，实际核对代码后：P0 两项（A0-01/A0-02）与 P1 三项（A1-01~03）**均已实施**。其中 A0-02 与推荐方向一致；A0-01 实际以 `MIXED_CONTENT_ALWAYS_ALLOW` 放行，与下方推荐方案及决策点 3（"补 usesCleartextTraffic 而非放宽安全策略"）冲突，列为**技术债**，建议后续改为 `WebViewAssetLoader.PathHandler` 代理模型文件。P2/P3 仍列待实施，本次核对未覆盖。

### P0 — 阻塞级

| ID | 问题 | 影响 | 实际状态（2026-07-10 核对） |
|----|------|------|------|
| A0-01 | HTTP 模型文件服务器被 mixed content 拦截 | WebView 页面在 `https://wails.localhost/`，拒绝 `http://127.0.0.1` 请求 → 3D 画面空白 | ✅ 已修复，但用 `MIXED_CONTENT_ALWAYS_ALLOW`（`MainActivity.java:135`）放行，**偏离推荐 PathHandler 代理方案**且与决策点 3 冲突 → 技术债（模型仍走 `http://127.0.0.1:port`，见 `fileservice.ts:44`） |
| A0-02 | `setAllowFileAccess(false)` 禁用所有 `file://` 访问 | 所有依赖 `file://` 的资源加载路径全部失效 | ✅ 已修复：`MainActivity.java:132` 禁用 `file://`，资源改经 `WebViewAssetLoader`+`WailsPathHandler`（`https://wails.localhost`），方向一致 |

**推荐方案（A0-01）**`WebViewAssetLoader.PathHandler` 代理模型文件服务——不走 `127.0.0.1:port` HTTP，改走 `https://wails.localhost/models/<port>/file.pmx` 路由经 Java JNI Go 透传，零网络安全配置项。
> ⚠️ 现状：`WailsPathHandler` 仅代理**应用静态资源**（index.html/js/wasm 等），模型文件仍由 `StartFileServer`/`IsolateModelDir`（`httpserver.go`）经 `127.0.0.1` HTTP 提供，靠 `MIXED_CONTENT_ALWAYS_ALLOW` 放行。该放行比所需更宽（任何 `http://` 子资源均可加载），建议后续收窄为 PathHandler 代理或至少仅信任本机。

### P1 — 功能降级

| ID | 问题 | 影响 | 实际状态（2026-07-10 核对） |
|----|------|------|------|
| A1-01 | `Browser.OpenURL` 在 Android 上无文档保证 | "检查更新"/"查看许可证"等按钮静默无响应 | ✅ 已修复：`frontend/src/core/platform.ts` `openExternalURL()` 安卓走 `<a>` 兜底 |
| A1-02 | Blender/MMD/外部程序菜单项可见但点击报错 | 前端需隐藏或灰显这些入口 | ✅ 已修复：`platform.ts` `guardExternalAction()` 安卓返回 false（与决策点 5 一致） |
| A1-03 | `isAndroidPlatform()` 调用时 `window.wails` bridge 未就绪 | 读到 `undefined !== 'android'` → 误判为桌面 | ✅ 已修复：`platform.ts` `isAndroidPlatform()` 改读 `window.wails.platform()` + `awaitWailsBridge()` 轮询待 bridge 就绪 |

### P2 — 偶发级

| ID | 问题 | 影响 |
|----|------|------|
| A2-01 | localStorage 5MB 配额超限后静默截断 | 场景配置写入半截 → 重启后 `JSON.parse` 失败 → 配置归零 |
| A2-02 | Android 返回键与 MenuStack 导航冲突 | 关闭面板时直接退出 App |
| A2-03 | 键盘弹出触发 Canvas 重绘风暴（`adjustResize`） | 低端机帧率抖动 |
| A2-04 | 截图 `toDataURL` 低端机 OOM | 截图功能闪退 |
| A2-05 | 部分国产 ROM `AudioContext` 自动播放限制 | 音乐/节拍检测静音 |
| A2-06 | `clipboard.writeText` 需用户手势触发 | 复制功能静默失败 |

### P3 — 架构建议

| ID | 问题 | 影响 |
|----|------|------|
| A3-01 | 未对接 Android 生命周期 | 切后台再返回时场景需重新加载 |
| A3-02 | WASM 默认启用在低端机初始化慢 | 首载体验差，JS 回退路径存在 |
| A3-03 | 拖拽事件在触屏上无效 | 部分交互失效 |

> **P2/P3 核对说明**：A2-01~A3-03 仍按原计划列为待实施，本次（2026-07-10）核对未覆盖，状态以原表为准。

---

## 七、决策要点

1. **适配策略**：小步迭代，保持 `isAndroid` 守卫模式，不引入全量 PlatformAdapter 抽象
2. **文件选择**：移除 `openFileDialog` 的 Android 封锁，SAF 文件选择自动可用
3. **网络配置**：补 `usesCleartextTraffic` 而非放宽安全策略
4. **对话框**：统一用 Wails MessageDialog / CSS 模态框，废弃 `prompt()/confirm()`
5. **外部程序菜单**：前端集中守卫，`guardExternalAction()` 对 Android 用户提示不可用

---

## 八、涉及文件清单

| 文件 | 改动 |
|------|------|
| `internal/app/app.go` | 移除 `openFileDialog` Android 守卫 |
| `internal/app/fileaccess.go` | 接口 + 单例 |
| `internal/app/fileaccess_desktop.go` | 桌面实现 |
| `internal/app/fileaccess_android.go` | 安卓实现 |
| `internal/app/model_preset.go` | B5 死锁修复 / B6 缓存填充 / B7 bootstrap 写入 |
| `build/android/.../AndroidManifest.xml` | `usesCleartextTraffic` |
| `frontend/src/core/dialog.ts` | B2 overlay 清理 |
| `frontend/src/core/utils.ts` | B3/B8 dialog 清理 + CATEGORY_DIR |
| `frontend/src/core/library-core.ts` | B4 try/catch 替换 |
| `frontend/src/menus/*.ts` | `prompt()` → Wails Dialog |