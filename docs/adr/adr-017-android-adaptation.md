# ADR-017: Android 平台适配（精简版）

> **状态**: 主体已完成（Phase A/B/C ✅）；P0(A0-01/A0-02) 与 P1(A1-01~05) ✅ 全部已实施；P2 七项 ✅ 全部已落地（A2-04 于 2026-07-22 完成全路径 `toBlob` 迁移）；P3 四项 ✅ 全部已修复（A3-01/04 于 2026-07-22 完成事件总线消费）。A0-01 已于 2026-07-24 根治：模型文件改经 `readFileBytes` + Blob URL 加载（复用 ADR-176 浏览器端路径，见 frontend/src/core/fileservice.ts `resolveFileUrl`），移除 `MainActivity.java` 的 `MIXED_CONTENT_ALWAYS_ALLOW`；不再依赖 PathHandler 代理方案（ADR-133 方案 B 不再必要）。§四 SAF 目录选择方案已放弃，改用 `MANAGE_EXTERNAL_STORAGE` 授权 `/sdcard/MMD`（2026-07-22 核对）。
> **关联**: ADR-058（basenameFallbackFS）、ADR-133（Android MPR 缺口）
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

## 四、Android 文件访问现状（2026-07-22 核对）

> **【2026-07-22 重大修订】** 原"SAF 目录选择未走通"方案已**放弃**。改走 `MANAGE_EXTERNAL_STORAGE` 授权整个 `/sdcard/MMD` 目录，Go 端用 `os.*` 直读文件系统路径——无需 SAF `content://` 遍历桥接，更务实。

| 能力 | 状态 | 说明 |
|------|------|------|
| SAF 单/多文件选择 | ✅ 正常 | Wails `showFilePicker` → 自动复制到 cache → 返真实路径 |
| 授权目录（`/sdcard/MMD`） | ✅ **已落地** | `MANAGE_EXTERNAL_STORAGE` 权限授权后，Go 端 `os.*` 直读；Java 桥 `requestManageExternalStorage()` + `hasExternalStoragePermission()`（`MainActivity.java:316-355`）；JS 桥 `requestStoragePermission()` / `hasStoragePermission()`（`WailsJSBridge.java:119-142`） |
| 私有目录（`Android/data/<pkg>/files/MMD`） | ✅ 正常 | 默认存储位置，无需权限 |
| `content://` 遍历 | ⚪ 不再需要 | 授权目录方案下 Go 走 `os.*` 文件系统路径，无需 SAF `content://` 桥接 |
| 存储模式切换 | ✅ 已实现 | 前端 `switchStorageMode('private' \| 'shared')`（`library-setup.ts:138`），用户可在私有/授权目录间切换 |

**授权目录实现链路**：

| 层 | 实现 | 位置 |
|----|------|------|
| AndroidManifest | 声明 `MANAGE_EXTERNAL_STORAGE`（Android 11+）+ legacy `READ/WRITE_EXTERNAL_STORAGE`（Android 10-） | `AndroidManifest.xml:20-28` |
| Java 桥 | `requestManageExternalStorage()` 跳系统设置 + `hasExternalStoragePermission()` 查 `Environment.isExternalStorageManager()` | `MainActivity.java:316-355` |
| JS 桥 | `requestStoragePermission()` / `hasStoragePermission()` @JavascriptInterface | `WailsJSBridge.java:119-142` |
| Go 路径管理 | private=`/storage/emulated/0/Android/data/<pkg>/files/MMD`；shared=`/sdcard/MMD` | `pathmgr_android.go:18-26` |
| Go 文件访问 | `os.*` 直读 `/sdcard/MMD`（授权后无需 SAF bridge） | `fileaccess_android.go:14-20` |
| 前端切换 | `switchStorageMode('private' \| 'shared')` | `library-setup.ts:138` |
| i18n | `settings.storageShared`「授权目录」+ `library.confirmSwitchShared` + `main.needFileAccess` | `zh-CN.ts:913,1174,1204` |

**桌面端遗留问题**：`SelectDir` 的 `CanChooseDirectories(true)` 在 Windows 上实际弹出文件选择器而非目录选择器（待修复）。

**Google Play 政策风险**：`MANAGE_EXTERNAL_STORAGE` 受 Google Play 政策限制，仅授予文件管理器/杀毒等类应用。若上架 Google Play 需申请豁免或降级为 MediaStore API + SAF 文件选择；当前走 sideload 分发无影响。

---

## 五、经验教训

1. **Go `embed.FS` 构建陷阱**：`go:embed all:frontend/dist` 在编译时静态内嵌前端。修改前端后必须跑 `build-android.ps1`（Go 交叉编译），`./gradlew installDebug` 只重打包 APK，不重新编译 `libwails.so`
2. **Go `sync.RWMutex` 不可重入**：持写锁的 goroutine 再获取读锁会导致自死锁。`updateConfig`（写锁）内部只能使用已持有的 `cfg` 参数，禁止调用 `GetConfig` 或 `ScanModelDir`
3. **配置双重路径**：bootstrap（`configDir()`）和完整配置（`settingDir()`）须同时写入
4. **大小写一致性**：Windows 不区分大小写不暴露的问题在 Android/Linux 文件系统上直接导致浏览为空。目录名映射表（`CATEGORY_DIR` / `defaultDirName` / `app.go:defs`）三处须保持同步

---

## 六、待实施的端口隐患（ADR-067）

> 以下为 ADR-067 扫描出的隐患清单，已排除本 ADR 中已修复的项目。

> **【2026-07-10 核对更新】** 本清单原标注为"待实施"，实际核对代码后：P0 两项（A0-01/A0-02）与 P1 三项（A1-01~03）**均已实施**。其中 A0-02 与推荐方向一致；A0-01 实际以 `MIXED_CONTENT_ALWAYS_ALLOW` 放行，与下方推荐方案及决策点 3（"补 usesCleartextTraffic 而非放宽安全策略"）冲突，列为**技术债**，建议后续改为 `WebViewAssetLoader.PathHandler` 代理模型文件。

> **【2026-07-22 二次核对更新】** P2/P3 全量核对代码后：A2-01/05/06/07 + A3-03 **已落地**；A2-03 降级 P4（风险被高估）；A2-04 ✅ 已完成全路径 `toBlob` 迁移（AR 截图 + 水印 + 单/批量截图）；A3-01 ✅ 已完成事件总线消费（原半完成）；A3-04 ✅ 新增并完成（前端消费 `android:ScreenLocked/NetworkChanged/BatteryChanged/ThemeChanged`）；A3-02 未变（Android 默认走 WASM 但 `virtual-skirt.ts` 已自动降级 low 质量，风险自愈）。详见各表"实际状态"列。

### P0 — 阻塞级

| ID | 问题 | 影响 | 实际状态（2026-07-10 核对） |
|----|------|------|------|
| A0-01 | HTTP 模型文件服务器被 mixed content 拦截 | WebView 页面在 `https://wails.localhost/`，拒绝 `http://127.0.0.1` 请求 → 3D 画面空白 | ✅ 已修复，但用 `MIXED_CONTENT_ALWAYS_ALLOW`（`MainActivity.java:135`）放行，**偏离推荐 PathHandler 代理方案**且与决策点 3 冲突 → 已根治（2026-07-24）：模型改经 `readFileBytes` + Blob URL（frontend/src/core/fileservice.ts），Android 不再发 `http://` 子资源；`MainActivity.java` 的 `MIXED_CONTENT_ALWAYS_ALLOW` 已移除，复用 ADR-176 路径，无需 PathHandler 代理 |
| A0-02 | `setAllowFileAccess(false)` 禁用所有 `file://` 访问 | 所有依赖 `file://` 的资源加载路径全部失效 | ✅ 已修复：`MainActivity.java:132` 禁用 `file://`，资源改经 `WebViewAssetLoader`+`WailsPathHandler`（`https://wails.localhost`），方向一致 |

**推荐方案（A0-01）**`WebViewAssetLoader.PathHandler` 代理模型文件服务——不走 `127.0.0.1:port` HTTP，改走 `https://wails.localhost/models/<port>/file.pmx` 路由经 Java JNI Go 透传，零网络安全配置项。
> ⚠️ 现状：`WailsPathHandler` 仅代理**应用静态资源**（index.html/js/wasm 等），模型文件仍由 `StartFileServer`/`IsolateModelDir`（`httpserver.go`）经 `127.0.0.1` HTTP 提供，靠 `MIXED_CONTENT_ALWAYS_ALLOW` 放行。该放行比所需更宽（任何 `http://` 子资源均可加载），建议后续收窄为 PathHandler 代理或至少仅信任本机。

### P1 — 功能降级

| ID | 问题 | 影响 | 实际状态（2026-07-10 核对） |
|----|------|------|------|
| A1-01 | `Browser.OpenURL` 在 Android 上无文档保证 | "检查更新"/"查看许可证"等按钮静默无响应 | ✅ 已修复：`frontend/src/core/platform.ts` `openExternalURL()` 安卓走 `<a>` 兜底 |
| A1-02 | Blender/MMD/外部程序菜单项可见但点击报错 | 前端需隐藏或灰显这些入口 | ✅ 已修复：`platform.ts` `guardExternalAction()` 安卓返回 false（与决策点 5 一致） |
| A1-03 | `isAndroidPlatform()` 调用时 `window.wails` bridge 未就绪 | 读到 `undefined !== 'android'` → 误判为桌面 | ✅ 已修复：`platform.ts` `isAndroidPlatform()` 改读 `window.wails.platform()` + `awaitWailsBridge()` 轮询待 bridge 就绪 |
| A1-04 | 看舞蹈时屏幕随系统熄屏超时自动关闭（音频继续播放、画面黑屏） | 核心观看体验中断；USB 调试的「保持唤醒」开发者选项会掩盖该问题，真机用户必现 | ✅ 已修复（2026-07-20）：接线孤儿桥 `WailsBridge.setKeepAwake`——`WailsJSBridge` 暴露 `setKeepAwake` @JavascriptInterface；前端启动恢复设置时调用（undefined 视为开启），外观设置新增「屏幕→屏幕常亮」开关（仅 Android 展示，`keepAwake` 经 `SetUIState` 持久化到 `UIState`） |
| A1-05 | 屏幕方向无法切换（仅能跟随系统旋转，缺竖/横/自动开关） | 用户无法锁定或主动切换横竖屏（如系统关闭自动旋转时看舞蹈无法转横屏） | ✅ 已实现（2026-07-20）：`WailsJSBridge` 新增 `setScreenOrientation` @JavascriptInterface（映射 `setRequestedOrientation`：portrait/landscape 锁定、auto=UNSPECIFIED 跟随系统）；外观设置「屏幕」卡片加自动/竖屏/横屏三选一（仅 Android，`screenOrientation` 经 `SetUIState` 持久化）；`configChanges` 已声明 orientation|screenSize，旋转就地处理（前端 window-resize → `engine.resize`）不重建 Activity |

### P2 — 偶发级

| ID | 问题 | 影响 | 实际状态（2026-07-22 核对） |
|----|------|------|------|
| A2-01 | localStorage 5MB 配额超限后静默截断 | 场景配置写入半截 → 重启后 `JSON.parse` 失败 → 配置归零 | ✅ 已修复：自动保存走 Go 端 `SaveLastScene(json)` 文件持久化（`scene-serialize.ts:1405`）；localStorage 仅用于 i18n 语言、dragMode、plaza presets 等小数据 |
| A2-02 | Android 返回键被 `bridge.emitSystemEvent` 吞掉，退不出 App（原描述"关闭面板时直接退出"与事实相反） | 面板全关后按返回无响应，用户只能 Home 键/杀进程退出 | ✅ 已修复（2026-07-20）：前端双击退出——无浮层时 2s 内再按返回调 `WailsJSBridge.exitApp()` 退出；plaza 清理收口至 `init.ts` 单一处理器 |
| A2-03 | 键盘弹出触发 Canvas 重绘风暴（`adjustResize`） | 低端机帧率抖动 | ⚪ 降级 P4：未查到 `visualViewport` 监听，但 Android 下菜单多为全屏 overlay，键盘弹出不直接影响 canvas；风险被高估，暂不实施 |
| A2-04 | 截图 `toDataURL` 低端机 OOM | 截图功能闪退 | ✅ 已修复（2026-07-22）：全路径迁移到 `toBlob` 异步编码——`ar-camera.ts` captureARScreenshot + `watermark.ts` applyWatermark + `motion-pose-levels.ts` 批量姿势截图 + `scene-menu.ts` 单/批量截图（含非 AR 路径）；`toBlob` 失败降级 `toDataURL`（受约束环境兼容） |
| A2-05 | 部分国产 ROM `AudioContext` 自动播放限制 | 音乐/节拍检测静音 | ✅ 已修复：Java 端 `setMediaPlaybackRequiresUserGesture(false)`（`MainActivity.java:135`）从源头禁用自动播放限制；`audio-bus.ts:107` 还有 `ctx.resume()` 兜底 |
| A2-06 | `clipboard.writeText` 需用户手势触发 | 复制功能静默失败 | ✅ 已闭环（2026-07-24）：5 处调用均有 `catch` 兜底；唯一的静默空 catch（`toast.ts:147`，copyBtn 复制 toast 文本）已补 `showErrorToast(t('motion.clipboardUnavailable'))` 反馈，与其余 4 处口径一致 |
| A2-07 | WebView 渲染进程崩溃无兜底（缺 `onRenderProcessGone`） | 渲染器 OOM/native 崩溃后 App 不退出但 UI 假死（音频可能继续播放、触控失效），用户只能杀进程 | ✅ 已修复（2026-07-20）：`MainActivity` WebViewClient 重写 `onRenderProcessGone`，返回 true 阻止系统杀 App，300ms 后 `reload()` 重建渲染器自愈（API 26+ 生效，低版本不调用无需守卫） |

### P3 — 架构建议

| ID | 问题 | 影响 | 实际状态（2026-07-22 核对） |
|----|------|------|------|
| A3-01 | 未对接 Android 生命周期 | 切后台再返回时场景需重新加载 | ✅ 已修复（2026-07-22）：Java 端转发 `nativeOnPause/Resume/Stop`（`WailsBridge.java:178-189`）+ `emitSystemEvent("android:*")` 完整事件总线（`MainActivity.java:909-1071`）；前端 `init.ts` 已消费 `android:back`（双击退出）+ `storage:permissionGranted`（重新扫描库）+ `android:ScreenLocked`（刷盘保存）+ `android:NetworkChanged`（toast 提示）+ `android:BatteryChanged`/`android:ThemeChanged`（预留扩展点） |
| A3-02 | WASM 默认启用在低端机初始化慢 | 首载体验差，JS 回退路径存在 | ⚪ 风险自愈：Android 默认仍走 WASM，但 `virtual-skirt.ts:93` 已有 `isAndroid` 守卫自动降级到 `'low'` 质量；MPR 多线程在 Android 恒不可用（`crossOriginIsolated` 恒 false，见 ADR-133），物理走 SPR 单线程 |
| A3-03 | 拖拽事件在触屏上无效 | 部分交互失效 | ✅ 已修复：`events.ts` 已全面用 `pointerdown/pointermove` 替代 mouse/touch 分支（`events.ts:269,279,297,347`），Pointer Events 原生统一触屏/鼠标 |
| A3-04 | **前端未消费 `system:*` / `android:*` 事件总线**（2026-07-22 新增） | Java 端 6 类系统事件已转发但前端零监听——切后台保存、网络断开提示、屏幕锁定触发等场景化行为缺失 | ✅ 已修复（2026-07-22）：`init.ts` 注册 4 类事件监听——`android:ScreenLocked`（触发 `saveSceneImmediate(true)` 刷盘保存）+ `android:NetworkChanged`（toast 提示网络状态）+ `android:BatteryChanged`（预留扩展点）+ `android:ThemeChanged`（预留扩展点）；`android:back` + `storage:permissionGranted` 此前已消费 |

> **P2/P3 核对说明**：2026-07-22 全量核对代码后更新。A2-04 与 A3-04 已于 2026-07-22 实施完成。A0-01 技术债已于 2026-07-24 根治（见上）——模型走 `readFileBytes` + Blob URL，移除 `MIXED_CONTENT_ALWAYS_ALLOW`，**无剩余待实施项**。

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