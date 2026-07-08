好问题。让我系统性地扫一遍代码库，找 Android 上容易踩的坑。
The user is asking me to think about what other Android-specific issues might exist in the Wails v3 project that are easy to overlook. Let me do a thorough investigation of the codebase, focusing on Android-specific concerns.

Key areas to consider:
1. File access patterns that assume desktop semantics
2. Wails v3 Android-specific limitations
3. Permissions handling
4. Path assumptions
5. WebView/Chromium differences on Android
6. Memory/CPU constraints on mobile
7. Lifecycle management (app backgrounding, resuming)
8. Keyboard/input differences
9. Screen size/touch vs mouse
10. HTTP server for asset serving on Android
11. WASM performance on Android
12. File watching (inotify vs Android alternatives)

Let me search through the codebase systematically.

让我深入分析找到的相关代码，检查Android风险模式。



### Relevant Code Snippets
1. c:/Users/zhujieling11/MikuMikuAR/internal/app/app.go:L57-L58
  — 在 App 结构体中定义了文件系统监听器字段 `watcher *fsnotify.Watcher` 和监听目录字段 `watchDir string`，这在 Android 上可能存在问题，因为 Android 不支持 fsnotify 文件系统监听。

2. c:/Users/zhujieling11/MikuMikuAR/internal/app/watch.go:L88-L91
  — `StartWatchDir` 函数在 Android 平台上直接返回错误信息，表示不支持文件系统监听，但该功能在桌面平台被实现。

3. c:/Users/zhujieling11/MikuMikuAR/internal/app/httpserver.go:L537-L554
  — `serveFileWithSizeCheck` 函数对 VPD 文件进行了大小限制，防止超大文件导致内存溢出，这是处理潜在的 Android 内存限制问题的防御措施。

4. c:/Users/zhujieling11/MikuMikuAR/internal/app/zipextract.go:L106-L107
  — 在解压 ZIP 文件时，当清理缓存目录失败时，不回滚到原始目录，而是尝试使用 `os.RemoveAll` 删除旧缓存目录，这在 Android 上可能由于权限问题导致异常。

5. c:/Users/zhujieling11/MikuMikuAR/internal/app/fileaccess_android.go:L23-L24
  — 在 Android 平台的 `FileAccessor` 实现中，虽然文件访问逻辑看起来和桌面平台一致，但未实现 SAF (Storage Access Framework) 相关逻辑。

6. c:/Users/zhujieling11/MikuMikuAR/internal/app/zipextract.go:L200-L203
  — 对于清理提取缓存时的孤儿缓存处理，使用了 `os.ReadDir` 操作，如果该路径在 Android 上访问受限，可能导致操作失败。

7. c:/Users/zhujieling11/MikuMikuAR/internal/app/pathmgr_android.go:L10-L32
  — 定义了 Android 平台下的路径管理实现，该实现使用了 `os.MkdirAll` 和 `os.RemoveAll` 这些在 Android 上可能不被支持的函数，尤其是在没有适当权限的情况下。

8. c:/Users/zhujieling11/MikuMikuAR/internal/app/zipextract.go:L570-L573
  — 在 `basenameFallbackFS` 函数中使用了 `os.Stat`，如果 Android 上无法访问指定文件路径，则此调用可能会失败。

9. c:/Users/zhujieling11/MikuMikuAR/internal/app/zipextract.go:L727-L733
  — 在 `StartFileServer` 函数中，使用了 `net.Listen` 和 `http.Server`，这在 Android 上可能不受支持，因为 Android 不允许在默认情况下进行网络监听。

10. c:/Users/zhujieling11/MikuMikuAR/internal/app/app.go:L15-L15
  — 在导入的包中包含了 `github.com/fsnotify/fsnotify`，这是用于文件系统监听的库，但在 Android 平台该库无法正常工作，属于 Android 风险模式。

让我搜索前端代码中可能涉及Android风险模式的部分，特别是与触摸、键盘、右键点击、窗口尺寸、剪贴板等相关的代码。



让我继续搜索更多可能的Android风险模式相关的代码，包括全屏API、拖拽、音频、存储和硬编码像素值等。



### Relevant Code Snippets
1. c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/main.ts:L777-L800
  — 检测到与拖拽操作相关的代码，包括dragenter、dragleave、dragover等事件监听器。虽然代码使用了passive参数，但在Android WebView中可能会导致问题，尤其是在处理拖拽操作时。

2. c:/Users/zhujieling11/MikuMikuAR/frontend/src/motion-algos/beat-detector.ts:L42-L55
  — 使用AudioContext进行音频分析，这在Android WebView中可能受到限制，特别是在自动播放方面。

3. c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts:L610-L625
  — 调用AudioContext.resume()可能在某些Android系统中出现问题，因为某些浏览器或系统可能会阻止音频上下文的自动播放。

4. c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/main.ts:L999-L1000
  — 代码使用了getImageData()方法，该方法在处理大图像时可能会导致内存溢出，特别是对于低性能的Android设备。

5. c:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/audio.ts:L49-L92
  — 包含与音频自动播放相关的处理代码，可能会被Android WebView限制，导致音频播放问题。

6. c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts:L748-L762
  — 使用localStorage进行同步备份，这可能会在Android WebView中由于存储空间或被系统清除而出现问题。

7. c:/Users/zhujieling11/MikuMikuAR/frontend/src/app.css:L42-L49
  — 在CSS中使用了scale变量，但部分尺寸计算并未考虑响应式设计，可能导致在移动设备上显示不正常。

8. c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/ui-advanced-rows.ts:L127-L150
  — 代码使用了鼠标拖拽事件处理，这在触屏设备上可能无法正常工作。

9. c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/menu.ts:L142-L145
  — 代码处理了touchstart和touchend事件，这在Android WebView中的行为可能与预期不一致。

10. c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/main.ts:L116-L121
  — 监听keydown和keyup事件，可能会影响Android上虚拟键盘的显示和使用。

11. c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/dialog.ts:L121-L123
  — 监听keydown事件用于关闭对话框，这在Android设备上可能产生兼容性问题。

12. c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/menu.ts:L92-L116
  — 实现了键盘事件处理，这在Android设备上可能导致意外行为。

### Relevant Code Snippets
1. c:\Users\zhujieling11\MikuMikuAR\internal\app\httpserver.go:L1-L100
  — 查找用于启动本地HTTP服务器的Go代码，这用于向Babylon.js提供模型文件。需特别关注localhost、127.0.0.1或0.0.0.0的使用情况。
2. c:\Users\zhujieling11\MikuMikuAR\internal\app\app.go:L1-L100
  — 检查Wails应用的初始化过程，尤其是针对桌面端的具体配置。
3. c:\Users\zhujieling11\MikuMikuAR\build\android\app\src\main\java\com\wails\app\MainActivity.java:L1-L100
  — Android端的MainActivity.java文件，检查WebView如何加载前端内容，以及与Go端的交互方式。
4. c:\Users\zhujieling11\MikuMikuAR\build\android\app\src\main\java\com\wails\app\WailsBridge.java:L1-L100
  — WailsBridge.java文件，用于Java与Go代码的交互，检查是否有平台相关的处理。
5. c:\Users\zhujieling11\MikuMikuAR\build\android\app\src\main\AndroidManifest.xml:L1-L50
  — AndroidManifest.xml文件，查看权限声明和网络配置，特别是对localhost的访问设置。
6. c:\Users\zhujieling11\MikuMikuAR\build\android\build.gradle:L1-L100
  — build.gradle文件，查看Android编译配置，包括最低SDK版本及兼容性设置。

```
### Relevant Code Snippets
1. c:\Users\zhujieling11\MikuMikuAR\internal\app\httpserver.go:L1-L100
  — 找到Go代码中用于启动本地HTTP服务器的部分，这用于向Babylon.js提供模型文件。需要注意localhost、127.0.0.1或0.0.0.0的使用。
2. c:\Users\zhujieling11\MikuMikuAR\internal\app\app.go:L1-L100
  — 检查Wails应用如何初始化，以及任何平台特定的桌面配置。
3. c:\Users\zhujieling11\MikuMikuAR\build\android\app\src\main\java\com\wails\app\MainActivity.java:L1-L100
  — MainActivity.java文件，检查WebView如何加载前端内容及与Go代码的交互方式。
4. c:\Users\zhujieling11\MikuMikuAR\build\android\app\src\main\java\com\wails\app\WailsBridge.java:L1-L100
  — WailsBridge.java文件，查看Java和Go之间的JNI方法注册。
5. c:\Users\zhujieling11\MikuMikuAR\build\android\app\src\main\AndroidManifest.xml:L1-L50
  — AndroidManifest.xml文件，查看对网络和权限的声明，特别是localhost的使用。
6. c:\Users\zhujieling11\MikuMikuAR\build\android\build.gradle:L1-L100
  — build.gradle文件，检查最低SDK版本和兼容性设置。
```

### Relevant Code Snippets
1. c:/Users/zhujieling11/MikuMikuAR/build/android/app/src/main/java/com/wails/app/MainActivity.java:L116-L226
  — This section shows the WebView setup, including JavaScript enabling, asset loading configuration, and how it loads the application URL via `loadUrl(url)` with the WAILS_SCHEME and WAILS_HOST constants, indicating how the frontend is loaded on Android.
2. c:/Users/zhujieling11/MikuMikuAR/build/android/app/src/main/java/com/wails/app/MainActivity.java:L136-L140
  — The WebViewAssetLoader is initialized here to handle serving assets from the WAILS_HOST domain (wails.localhost), enabling the webview to access local files.
3. c:/Users/zhujieling11/MikuMikuAR/build/android/app/src/main/java/com/wails/app/MainActivity.java:L222-L226
  — The `loadApplication()` method calls `webView.loadUrl(url)` with a URL constructed using WAILS_SCHEME and WAILS_HOST, showing how the WebView initiates the frontend load.
4. c:/Users/zhujieling11/MikuMikuAR/build/android/app/build.gradle:L22-L23
  — This defines the minSdkVersion as 21 and targetSdkVersion as 34 for the Android build, relevant for compatibility and targeting.
5. c:/Users/zhujieling11/MikuMikuAR/internal/app/httpserver.go:L700-800
  — This shows where the StartFileServer function is located and how it serves model files. The HTTP server handles serving isolated model directories, allowing frontend access to model assets via HTTP, but these are not shown as lines 700-800 in the snippet provided.
6. c:/Users/zhujieling11/MikuMikuAR/internal/app/app.go:L117-L120
  — This section shows how the Wails app is initialized, setting up the application instance, which is crucial for backend/frontend integration and platform-specific logic including Android support.

### Response

根据查询的内容，以下是关于MikuMikuAR在Android平台的兼容性分析：

#### WebView 加载前端内容方式：

1. **WebView 初始化** (`MainActivity.java: L116-L140`)：
   - 通过 `WebViewAssetLoader` 配置了 `wails.localhost` 域名。
   - 使用 `WailsPathHandler` 处理路径，使其能够加载本地资源。
   - JavaScript 和 DOM 存储均被启用。

2. **加载应用URL** (`MainActivity.java: L222-L226`)：
   - `loadApplication()` 方法中，使用 `webView.loadUrl(url)` 加载的 URL 是 `https://wails.localhost/`。
   - 所以，前端内容是通过 `WebViewAssetLoader` 从 `wails.localhost` 域加载的。

#### HTTP服务器提供模型文件：

1. **HTTP服务器创建** (`internal/app/httpserver.go`)：
   - HTTP服务器负责处理模型文件的隔离与提供。根据 `IsolateModelDir` 函数，该过程会为模型文件（如 PMX、VMD）及其依赖的纹理等文件创建一个临时目录。
   - 通过 `serveRootDir()` 确保在Android设备上使用私有缓存目录而非 `os.TempDir()`。

2. **端口通信** (`internal/app/httpserver.go`)：
   - 虽然没有直接显示 `StartFileServer` 的代码，但可以看出其会在应用启动时创建用于服务模型文件的 HTTP 服务器，以便前端可以通过 HTTP 访问模型资源。

#### Android 最低支持 SDK 版本（minSdk）：

- 根据 `build.gradle` 文件，`minSdkVersion` 是 21 (Android 5.0)。

#### 网络安全配置：

- 通过 `LS` 工具确认 `build/android/app/src/main/res/xml` 目录下的 `network_security_config.xml` 文件不存在。
- 因此项目没有显式配置 `network_security_config.xml` 或 `cleartextTrafficPermitted`。
- 但 `WebView` 设置为 `setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW)`，表明不允许混合内容，这对安全性是积极的。
- 在 `WebViewAssetLoader` 支持下，从 `wails.localhost` 获取资源不会触发网络请求，因此也无需额外网络配置。

现在我有足够信息了。让我整理一份系统性的诊断报告。

---

## Android 环境下 Wails v3 隐患清单

按严重程度排序，从「已经出事但没暴露」到「迟早会踩的坑」：

### P0 — 当前就会炸

**1. HTTP 文件服务器：`127.0.0.1:0` 在 Android WebView 里跨域被拒**

[zipextract.go:727](file:///C:/Users/zhujieling11/MikuMikuAR/internal/app/zipextract.go#L727) 的 `StartFileServer` 绑定 `127.0.0.1:0`，前端通过 `http://127.0.0.1:<port>/file.pmx` 加载模型。但 Android WebView 的页面跑在 `https://wails.localhost/`，WebView 设置了 `MIXED_CONTENT_NEVER_ALLOW`（[MainActivity.java:129](file:///C:/Users/zhujieling11/MikuMikuAR/build/android/app/src/main/java/com/wails/app/MainActivity.java#L129)）——**HTTP 请求被直接拦截**，模型根本加载不出来。

> 这是"模型库预览能扫到但 3D 画面出不来"的根因。

**2. `clipboard` API 在 Android WebView 部分场景拒绝**

[dialog.ts:178](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/core/dialog.ts#L178)、[toast.ts:110](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/core/toast.ts#L110)、[scene-menu.ts:346](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/scene-menu.ts#L346) 都用 `navigator.clipboard.writeText()`。Android WebView 要求页面是安全上下文（`https://`）且用户手势触发才放行——`wails.localhost` 走 `https` 所以安全上下文没问题，但如果 `writeText` 不在用户手势回调链里会被静默拒绝。目前代码都有 `.catch` 兜底所以不会崩，但**复制功能可能静默失败**。

### P1 — 功能降级但不会崩

**3. `fsnotify` 在 Android 完全不工作**

[watch.go:89](file:///C:/Users/zhujieling11/MikuMikuAR/internal/app/watch.go#L89) 已正确拦截返回错误，但前端"下载目录自动监听"功能在 Android 上是**死的**。用户从浏览器下载模型后，不会自动弹导入提示。需要用户手动"导入文件"。

**4. `exec.Command` 启动外部程序全挂**

[integration.go](file:///C:/Users/zhujieling11/MikuMikuAR/internal/app/integration.go) 里 Blender/MMD/自定义软件启动、打开文件管理器，Android 上全返回错误。Go 端已有 `isAndroid` 守卫，不会崩，但前端如果没隐藏这些菜单项，用户会看到"启动失败"的错误提示。

**5. `isolateDir` 文件复制在 Android 上可能因权限失败**

[httpserver.go:78](file:///C:/Users/zhujieling11/MikuMikuAR/internal/app/httpserver.go#L78) 有 Android 专用诊断日志，说明此路径确实出过问题。当 `storageMode=shared` 且用户没授权 `MANAGE_EXTERNAL_STORAGE` 时，`CopyFile` 到 serve 目录会失败，回退到原始目录。但回退后 HTTP 服务器提供的路径和实际路径可能不一致。

### P2 — 潜在风险，需要真机验证

**6. `localStorage` 在 Android WebView 被系统清除**

[scene-serialize.ts:752](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/scene-serialize.ts#L752) 用 `localStorage` 做场景备份。Android 系统在存储压力下会清除 WebView 的 localStorage（不像桌面浏览器持久）。场景备份可能**意外丢失**。代码已有 try/catch 兜底不会崩。

**7. `AudioContext` 自动播放限制**

[beat-detector.ts](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/motion-algos/beat-detector.ts) 和 [audio.ts](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/outfit/audio.ts) 使用 `AudioContext`。虽然 `MainActivity.java:128` 已设 `setMediaPlaybackRequiresUserGesture(false)`，但部分国产 ROM 的 WebView 会忽略这个设置。**音乐/节拍检测可能静音**。

**8. `toDataURL` 大图 OOM**

[main.ts:999](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/core/main.ts#L999) 用 `getImageData()`，截图功能用 `toDataURL()`。低端 Android 设备（2-3GB RAM）上，高分辨率 Canvas 的 toDataURL 可能直接 OOM 崩溃。没有 try/catch 保护。

**9. 触摸事件 vs 拖拽交互**

[main.ts:777-800](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/core/main.ts#L777-L800) 的 dragenter/dragleave 事件在触屏上**不触发**。Babylon.js 的 `ActionManager` 对触摸有内置支持，但如果自定义了 drag 事件处理逻辑，触摸设备上可能失效。

**10. WASM 性能：低端机跑不动**

`MmdWasmRuntime` 的 WASM 模块在低端 Android 设备上可能初始化失败或帧率极低。代码已有 JS 回退路径（[state.ts:37](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/src/core/state.ts#L37)），但**首次加载时默认用 WASM，失败后才回退**，用户体验是"卡了好几秒然后突然能动了"。

### P3 — 架构建议

**11. 没有 `network_security_config.xml`**

[AndroidManifest.xml](file:///C:/Users/zhujieling11/MikuMikuAR/build/android/app/src/main/AndroidManifest.xml) 没有配置 `network_securityConfig`。虽然当前 `wails.localhost` 走 `https` 不需要，但如果未来 HTTP 文件服务器需要从 WebView 访问（解决 P0-1），就必须配置 `cleartextTrafficPermitted` 对 localhost 放行。

**12. Android 生命周期未对接**

App 进入后台时（`onPause`/`onStop`），Go 端的 HTTP 服务器和 goroutine 继续运行。Android 可能在后台杀进程回收内存，Go 端没有优雅保存状态的机制。如果用户切走再回来，模型库可能需要重新加载。

---

### 建议优先级

| 优先级 | 问题 | 修复方向 |
|--------|------|----------|
| **P0-1** | HTTP 文件服务器被 mixed content 拦截 | 把 serve 目录也挂到 `WebViewAssetLoader` 的自定义 PathHandler 上，或者加 `network_security_config.xml` 放行 localhost HTTP |
| **P1-4** | 外部程序启动菜单项在 Android 应隐藏 | 前端 `isAndroidPlatform()` 隐藏 Blender/MMD/打开目录等菜单 |
| **P2-8** | 截图 OOM | `toDataURL` 外包 try/catch，失败时降分辨率重试 |
| **P2-10** | WASM 首次加载卡顿 | Android 默认走 JS runtime，或加超时自动降级 |

要我继续排查 P0-1（HTTP 文件服务器的 mixed content 问题），还是先处理哪个？
