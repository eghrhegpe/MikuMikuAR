# ADR-067: Android 端口隐患清单与修复策略

> **状态**: 待实施
> **关联**: ADR-057（Base64 查询参数）、ADR-058（basenameFallbackFS 多编码兜底）
> **触发**: 2026-07-08 代码库扫描 + 首次 Android 构建（`build-android.ps1`）

---

## 一、问题

MikuMikuAR 最初为 Windows 桌面设计，架构隐含大量桌面假设。Android 端口（Wails v3 + WebView）可编译通过，但存在十项程度不等的运行时隐患——从"模型加载不出来"到"截图直接崩溃"。

### 扫描方法论

- 逐文件审查 `build/android/` 下 Java/XML 代码
- 审查所有 `//go:build android` 的 Go 文件
- 搜索前端中非桌面安全的 API 调用（`navigator.clipboard`、`AudioContext`、`toDataURL`、`Browser.OpenURL`）
- 搜索 import 了平台特定库的 Go 端点
- Git grep 跨平台边界点

---

## 二、隐患清单

### P0 — 阻塞级（首次启动即炸）

| ID | 问题 | 根因 | 影响 |
|----|------|------|------|
| A0-01 | HTTP 模型文件服务器被 mixed content 拦截 | WebView 页面跑在 `https://wails.localhost/`，`setMixedContentMode(MIXED_CONTENT_NEVER_ALLOW)` 拒绝所有 `http://127.0.0.1:<port>` 请求（`MainActivity.java:129`） | 模型预览图能扫到，但 3D 画面空白——渲染引擎拿不到 PMX/VMD 文件 |
| A0-02 | `setAllowFileAccess(false)` 封闭文件路径 | `MainActivity.java:126` 显式禁用了 `file://` 访问 | 任何依赖 `file://` 的资源加载路径全部无效 |

### P1 — 功能降级

| ID | 问题 | 根因 | 影响 |
|----|------|------|------|
| A1-01 | `Browser.OpenURL` 在 Android 上行为未定义 | Wails v3 的 `Browser.OpenURL` 是桌面概念，Android 端无文档保证。5 处调用点 | "检查更新"、"查看许可证"、"报告问题"按钮静默无响应 |
| A1-02 | Blender/MMD/外部程序菜单项可见 | `go build -tags android` 编译时 `integration.go` 中 `isAndroid` 守卫已拦截调用，但前端菜单未隐藏 | 用户看到"在 Blender 中打开"并点击 → 红字报错 |
| A1-03 | `isAndroidPlatform()` 调用时机过早 | `window.wails` bridge 在 WebView 加载初期尚未注入。如果模块在构造函数/顶层就调用 `isAndroidPlatform()` | 读到 `undefined !== 'android'` → 误判为桌面，进入错误代码路径 |

### P2 — 偶发级

| ID | 问题 | 根因 | 影响 |
|----|------|------|------|
| A2-01 | localStorage 5MB 配额并静默截断 | Android WebView localStorage 软配额为 5MB，超限不弹提示直接写失败。`scene-serialize.ts` 的 try/catch 兜住不崩，但写入半截 | JSON.parse 下次加载时抛出 → 场景配置归零 |
| A2-02 | Android 返回键冲突 | `onBackPressed()` 默认行为要么退出 App，要么无反应。MenuStack 的导航栈有自己的 pop 逻辑 | 用户想关闭设置面板 → 直接退出了 App |
| A2-03 | 键盘弹出触发 Canvas 重绘风暴 | `windowSoftInputMode="adjustResize"`（`AndroidManifest.xml:53`）导致 Android 调整 Activity 尺寸 → WebView resize → Babylon `engine.resize()` 重绘 | 低端机上连续 resize 引发帧率抖动 |
| A2-04 | 截图 `toDataURL` OOM | `main.ts:999` 的 `getImageData()` 和截图 `toDataURL()` 无 try/catch。低端 Android 设备（2-3GB RAM）上高分辨率 Canvas → OOM 崩溃 | 截图功能直接闪退 |
| A2-05 | `AudioContext` 自动播放限制 | 虽然 `setMediaPlaybackRequiresUserGesture(false)` 已设置，部分国产 ROM WebView 忽略此设置 | 音乐/节拍检测静音 |
| A2-06 | clipboard 写入不在手势回调链中 | `navigator.clipboard.writeText` 在安全上下文下仍需用户手势触发。代码有 `.catch` 兜底不会崩 | 复制功能静默失败 |

### P3 — 架构建议

| ID | 问题 | 根因 | 影响 |
|----|------|------|------|
| A3-01 | 未对接 Android 生命周期 | `onPause`/`onStop` 时 Go 端 goroutine 继续运行，Android 后台杀进程回收内存 | 切后台再返回时场景需要重新加载 |
| A3-02 | WASM 默认启用 | `MmdWasmRuntime` 在低端 Android 设备初始化失败或帧率极低，JS 回退路径存在但首次加载体验差 | 卡好几秒然后突然动 |
| A3-03 | 拖拽事件在触屏上无效 | `main.ts:777-800` 的 `dragenter`/`dragleave` 在触屏设备上不触发 | 部分交互失效 |

---

## 三、决策

### 3.1 资源加载策略：WebViewAssetLoader PathHandler（推荐）

**问题 A0-01/A0-02 的统一解决方案。**

当前模型 HTTP 服务器在 `127.0.0.1:<port>` 上运行，WebView 无法跨协议（https→http）访问。修改方式不采用放宽 mixed content，而是将模型文件的路由注册到 `WebViewAssetLoader` 的自定义 `PathHandler` 上：

```
https://wails.localhost/models/<port>/file.pmx
  │
  ▼
WebViewAssetLoader.PathHandler
  │
  ▼
Java → JNI → Go `serveFile()` → 返回 byte[]
```

**优点**：
- 零网络安全配置项（无需 `network_security_config.xml`）
- 不削弱 `MIXED_CONTENT_NEVER_ALLOW`
- 不开放 `file://` 或 `content://`
- 复用现有的 Go `serveFile()` 入口

**缺点**：
- 需要改 Java 代码（`MainActivity.java` 的 WebView client + JNI 桥）
- 无法直接复用现有 HTTP 服务器的中间件（CORS、日志）

### 3.2 Platform-aware 菜单守卫

**解决 A1-02：** `library-core.ts` 中所有外部程序入口点已通过 `isAndroidPlatform()` 守卫，但缺少集中检查。统一加一个 `guardExternalAction()` 函数：

```typescript
function guardExternalAction(label: string): boolean {
    if (isAndroidPlatform()) {
        showToast({ message: `${label} 在 Android 上不可用`, type: 'warning' });
        return false;
    }
    return true;
}
```

覆盖点：`OpenInBlender`、`OpenInMMD`、`OpenInCustomApp`、`ShowInExplorer`。

### 3.3 Bridge 就绪等待

**解决 A1-03：** 所有调用 `isAndroidPlatform()` 的上层代码必须确保 `window.wails` bridge 已就绪。引入 `awaitWailsBridge()`：

```typescript
async function awaitWailsBridge(timeout = 3000): Promise<boolean> {
    const poll = (resolve: (v: boolean) => void, reject: (e: Error) => void) => {
        if (typeof window.wails?.platform === 'function') {
            resolve(true);
        } else {
            setTimeout(() => poll(resolve, reject), 50);
        }
    };
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Wails bridge timeout')), timeout);
        poll((v) => { clearTimeout(timer); resolve(v); }, reject);
    });
}
```

### 3.4 Browser.OpenURL 降级

**解决 A1-01：** Go 端 `isAndroid` 守卫 → fallback 到创建一个临时 `<a>` 标签触发 `window.open()`：

```typescript
function openExternalURL(url: string): void {
    if (isAndroidPlatform()) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
        return;
    }
    Browser.OpenURL(url);
}
```

### 3.5 Back gesture 桥接

**解决 A2-02：** `MainActivity.java` 覆写 `onBackPressed()` 向 JS 发事件：

```java
@Override
public void onBackPressed() {
    if (!bridge.isBackHandled()) {
        super.onBackPressed();
    }
}
```

前端注册监听 `window.wails?.events?.on('android:back', () => menuStack.pop())`。

### 3.6 生命周期持久化

**解决 A3-01：** 监听 Android `onPause` → 触发 Go 绑定的 `SaveSceneConfig()`；`onResume` → 触发 `ReloadSceneConfig()`。Go 端提供导出方法。

### 3.7 Keyboard resize 优化

**解决 A2-03：** 将 `windowSoftInputMode` 改为 `adjustNothing`，前端通过 `window.visualViewport` API 手动管理键盘偏移。Babylon.js 在键盘弹出时只 `engine.resize()` 一次而非连续重绘。

---

## 四、实施路线

### Phase 1：阻塞清除（~2 天）

- [ ] A0-01/A0-02：实现 `WebViewAssetLoader.PathHandler` 代理模型文件服务
- [ ] 修改 `MainActivity.java`：注册 `PathHandler`，移除 `setAllowFileAccess(false)` 对模型路径的阻断
- [ ] 验证：Android 上模型预览和 3D 场景正常加载

### Phase 2：功能降级（~1 天）

- [ ] A1-01：`openExternalURL()` 封装 + 替换 5 处 `Browser.OpenURL` 调用点
- [ ] A1-02：`guardExternalAction()` 集中守卫 + 排查所有外部程序菜单项
- [ ] A1-03：`awaitWailsBridge()` 引入 + 主要入口点集成

### Phase 3：稳定性（~2 天）

- [ ] A2-01：localStorage 写入时检测 `QuotaExceededError`，回退到 Go 端文件存储
- [ ] A2-02：`onBackPressed()` → 发 `android:back` 事件 → MenuStack pop
- [ ] A2-03：`adjustNothing` + `visualViewport` 手动管理
- [ ] A2-04：`toDataURL()` 包裹 try/catch，失败降分辨率重试
- [ ] A2-05/A2-06：确认已有兜底是否充分，不足补充

### Phase 4：架构（~1 天）

- [ ] A3-01：`onPause` → `SaveSceneConfig()`，`onResume` → `ReloadSceneConfig()`
- [ ] A3-02：Android 默认走 JS runtime，WASM 作为可选高配模式

---

## 五、边界与风险

| 风险 | 缓解 |
|------|------|
| `WebViewAssetLoader.PathHandler` 不支持大文件流式传输 | 分块读取，Go 端返回 `io.ReadSeeker` |
| JNI 桥接的字节数组拷贝性能开销 | 大模型（>50MB PMX）考虑 mmap 或临时文件路径传参 |
| `adjustNothing` 导致键盘遮挡输入框 | 依赖 `IntersectionObserver` 手动滚动到可见区域 |
| 部分国产 ROM WebView 不兼容 | 降级策略：Android 检测到无法创建 AudioContext 时静默跳过节拍检测 |
| localStorage 回退到 Go 文件存储在连续写入场景下性能差 | 加防抖（500ms），参考现有 `schedulePersistUI()` 模式 |

---

## 六、验证

1. Android 真机：模型预览 + 3D 场景加载正常（P0）
2. 设置页："在 Blender 中打开"等外部程序菜单隐藏或灰显（P1）
3. 返回手势关闭 MenuStack 面板而非退出 App（P2）
4. 键盘弹出时不触发 Canvas 重绘抖动（P2）
5. 截图功能在 2GB RAM 设备上不崩溃（P2）
6. `npm run check && npm run test && npm run build` 全绿（桌面端回归）
