# ADR-087: 模型广场 · 浏览器体验增强路线图

> **状态**: 规划中（有条件通过 · 已纳入 2026-07-11 代码审核 5 项修正）
> **关联**: ADR-075（模型广场基础架构 + 预热单实例窗口）、ADR-077（Cookie 中继）、ADR-078（下载拦截）、ADR-003（下载策略方案 C）
> **来源**: 2026-07-11 预热窗口落地后，对 Wails v3 → go-webview2 → WebView2 COM 全链路的 API 勘察

---

## 背景

ADR-075 的 B 模式（Wails 窗口）已通过预热单实例窗口将冷启动从 1–3s 降至 ~200ms（`NavigatePlazaWindow` + `RegisterHook(WindowClosing)` 拦截关闭保活）。但勘察发现：**当前 window 模式仅使用了 `SetURL` / `Show` / `Hide` 三个 API，底层 Wails v3 的 `WebviewWindow` 还暴露了大量未启用的能力**（`ExecJS` / `Reload` / `SetZoom` / `EmitEvent` / 导航事件），go-webview2 层面更有 `AddScriptToExecuteOnDocumentCreated` 和原生 `postMessage` 通道。

同时，三模式当前能力落差明显：

| 能力 | embed | window | external |
|------|-------|--------|----------|
| 页面加载 | ✅ Go 代理 + iframe | ✅ 预热窗口 | ✅ 系统浏览器 |
| 下载拦截 | ✅ 注入 JS → postMessage → 入库 | 🔴 无 | 🔴 无 |
| Cookie 中继 | ✅ 代理 cookiejar | 🔴 无 | N/A |
| 导航控制 | ✅ 前端 toolbar | 🔴 无 | N/A |
| URL 追踪 | ✅ 前端已知 | 🔴 无 | N/A |
| 加载指示 | 🔴 无 | 🔴 无 | N/A |
| 下载进度 | 🔴 仅状态栏文字 | 🔴 无 | 🔴 无 |

**核心结论**：window 模式是 API 最丰富的一路，但当前体验最单薄——只解决了「打开快」，没解决「用得爽」。

---

## 决策

按优先级分三档实施浏览器体验增强。所有方案复用现有基础设施（Go 反向代理、`DownloadFromPlaza`、`RegisterHook`），不引入新依赖。

### 技术勘察关键发现

| API | 层级 | 用途 | 当前状态 |
|-----|------|------|---------|
| `WebviewWindow.ExecJS(js)` | Wails v3 | 在窗口上下文执行任意 JS（一次性） | 🟢 可用 |
| `WebviewWindow.Reload()` | Wails v3 | 刷新当前页面 | 🟢 可用 |
| `WebviewWindow.SetZoom(f)` | Wails v3 | 页面缩放 | 🟢 可用 |
| `WebviewWindow.EmitEvent(name, data)` | Wails v3 | 从窗口向主窗口发事件 | 🟢 可用 |
| `WebviewWindow.RegisterHook(event, fn)` | Wails v3 | 拦截窗口事件（已用于 WindowClosing） | 🟢 已用 |
| `Windows.WebViewNavigationCompleted` (1208) | 事件 | 页面加载完成 | 🟢 可用 |
| `Windows.WindowKeyDown` (1225) | 事件 | 键盘按键 | 🟢 可用 |
| `Chromium.Init(script)` | go-webview2 | `AddScriptToExecuteOnDocumentCreated` — 每页自动执行 | 🔴 Wails v3 未暴露 |
| `Chromium.MessageReceived` | go-webview2 | WebView2 原生 `postMessage` 接收 | 🔴 Wails v3 未暴露 |
| `Chromium.AddWebResourceRequestedFilter` | go-webview2 | 拦截任意请求 | 🔴 Wails v3 未暴露 |

> **关键约束**：底层 go-webview2 的 `Init`（每页自动注入脚本）和 `MessageReceived`（原生消息通道）极为理想，但 Wails v3 的 `WebviewWindow` 未暴露它们。因此 window 模式的下载拦截走**代理桥接**方案（复用 `StartProxy` + `ExecJS` 注入 + `fetch` 回传），而非原生注入。

---

## 🔴 P0：Window 模式下载拦截 — 代理桥接

### 原理

让 window 模式也走 Go 代理（同 embed 模式），注入脚本改用 `fetch` 代替 `postMessage` 回传下载请求。

```
用户点击站点 (window 模式)
  └─ NavigatePlazaWindow(url)
       ├─ StartProxy(url)              ← 启动 Go 反向代理
       ├─ win.SetURL(proxyURL)         ← 窗口导航到代理 URL（非直连）
       ├─ win.Show() + win.Focus()
       └─ 代理 ModifyResponse 注入脚本
            └─ 脚本拦截 .pmx/.zip 链接
                 └─ fetch('http://127.0.0.1:PORT/__plaza_dl__', {method:'POST', body:...})
                      └─ Go 端收到 → DownloadFromPlaza → 入库
```

### 注入脚本差异（window 模式 vs embed 模式）

```js
// embed 模式: parent.postMessage({type:'plaza-download-request',...}, '*')
// window 模式: fetch 到本地代理端点
// ⚠️ href 可能是相对路径（如 "/download/123.zip"），必须先绝对化，
//    否则 Go 端拿到的 URL 无法下载。用 new URL(href, document.baseURI) 归一。
const absUrl = new URL(href, document.baseURI).href;
fetch(location.origin + '/__plaza_dl__', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({url: absUrl, filename: absUrl.split('/').pop()})
});
```

### Go 端新增 `/__plaza_dl__` 路由（含 CORS）

```go
if r.URL.Path == "/__plaza_dl__" {
    w.Header().Set("Access-Control-Allow-Origin", "*")
    w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
    w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
    if r.Method == "OPTIONS" { w.WriteHeader(204); return }
    // 解析 body → DownloadFromPlaza(url, filename)
    return
}
```

### 改动点

| 文件 | 改动 |
|------|------|
| `internal/app/proxy.go` | `plazaInjectScript` 增加 mode 参数（embed=postMessage / window=fetch）；代理 handler 增加 `/__plaza_dl__` POST 路由 |
| `internal/app/plaza_window.go` | `NavigatePlazaWindow` 先调 `StartProxy` 再导航到代理 URL；`ClosePlazaWindow` 时调 `StopProxy` 回收 |
| `frontend/bindings/` | 自动生成（如有新 Go 方法） |

> **端口释放竞态（审核发现）**：`StopProxy` → 快速重开（用户连续切站）时，前一个 `net.Listener` 的 OS 端口可能尚未释放（TIME_WAIT / 关闭异步），`StartProxy` 立即 `Listen` 同端口会 `bind: address already in use`。缓解：`NavigatePlazaWindow` 内 `StartProxy` 前对目标端口做「关闭完成」等待——`StopProxy` 用 channel/WaitGroup 标记 listener 已 `Close()`，或 `StartProxy` 采用「端口 0 让 OS 自动分配 + 重试 3 次超时」策略，避免固定端口冲突。

**收益**：window 模式从「无下载闭环」升级为「与 embed 相同的完整闭环」，且复用全部代理基础设施（Cookie 中继、SSRF 防护、路径穿越防护）。

---

## 🔴 P0：Window 模式导航控制

### 可用 API

- `ExecJS("history.back()")` → 后退
- `ExecJS("history.forward()")` → 前进
- `Reload()` → 刷新当前页面
- `SetZoom(float64)` / `ZoomIn()` / `ZoomOut()` → 缩放

### Go 新增方法

```go
func (a *App) PlazaGoBack() error {
    a.plazaWinMu.Lock(); defer a.plazaWinMu.Unlock()
    if a.plazaWin == nil { return fmt.Errorf("plaza window not ready") }
    a.plazaWin.ExecJS("history.back()")
    return nil
}
// PlazaGoForward() → ExecJS("history.forward()")
// PlazaReload() → a.plazaWin.Reload()
```

### 前端遥控面板

当 window 模式打开时，主窗口的 plaza 层不关闭，切换为「遥控面板」（后退 / 前进 / 刷新 / 当前 URL / 关闭窗口 / 切换站点），控制逻辑调用上述 Go 方法。

---

## 🟡 P1：导航事件监听 — URL 追踪 + 加载指示

### URL 追踪方案

⚠️ **代理 URL 污染（审核发现）**：window 模式走代理桥接时，页面实际加载的是 `http://127.0.0.1:PORT/...`，`location.href` 返回的是**代理 URL 而非原始目标站 URL**。若直接回传 `location.href`，遥控面板会显示 `127.0.0.1:xxxx` 这种无意义地址，且重定向后无法还原真实站点路径。

**修正**：不依赖前端 `location.href` 作为真实 URL 来源，改由**代理 handler 记录真实目标 URL**（代理转发时本就持有 upstream URL），导航完成事件里由 Go 端把「代理 URL ↔ 真实 URL」映射后回传真实 URL。前端 `ExecJS` 仅回传 `document.title`（标题不受代理影响）。

```go
win.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(event *application.WindowEvent) {
    // 真实 URL 从代理层的 last-forwarded-target 取，而非信任前端 location.href
    realURL := a.proxy.LastTargetURL()
    a.plazaWin.ExecJS(`fetch(location.origin+'/__plaza_url__',{method:'POST',body:JSON.stringify({title:document.title})})`)
    // /__plaza_url__ handler 合并 realURL + title 后 Emit
})
// Go 端收到后：
a.wailsApp.Event.Emit("plaza:urlChanged", map[string]string{"url": realURL, "title": title})
```

> embed 模式不受此影响（前端本就通过代理已知目标 URL）。仅 window 模式需要此映射。

前端：

```ts
import { EventsOn } from '@wailsio/runtime';
EventsOn('plaza:urlChanged', (data) => {
    urlDisplay.textContent = data.title || data.url;
});
```

### 加载指示

同一事件触发时前端隐藏 loading spinner；embed 模式的 `.plaza-iframe` 加 `onload` 事件隐藏 spinner。

---

## 🟡 P1：下载进度报告

用 `ProgressReader` 包装 `DownloadFromPlaza` 的 `io.Copy`，定期 `EmitEvent`：

```go
type progressReader struct {
    reader   io.Reader
    total    int64
    read     int64
    lastEmit time.Time
    fileName string
}
func (pr *progressReader) Read(p []byte) (int, error) {
    n, err := pr.reader.Read(p)
    pr.read += int64(n)
    if time.Since(pr.lastEmit) > 500*time.Millisecond {
        globalApplication.Event.Emit("plaza:downloadProgress", map[string]any{
            "fileName": pr.fileName, "read": pr.read, "total": pr.total,
            "percent": float64(pr.read) / float64(pr.total) * 100,
        })
        pr.lastEmit = time.Now()
    }
    return n, err
}
```

前端监听 `plaza:downloadProgress` → 更新进度条。

> **前置确认（审核发现）**：`progressReader` 包装 `reader` 的前提是 `DownloadFromPlaza` 内部走 **`io.Copy(dst, resp.Body)`** 这类流式拷贝。若现状是 `http.Get` 后 `io.ReadAll` 一次性读入内存，则无中间流可包装，`progressReader` 不适用。
> - **实施第一步**：先 grep `DownloadFromPlaza` 确认底层拷贝方式。
> - **通用改法**：用 `io.TeeReader(resp.Body, progressWriter)` 或将 `resp.Body` 包一层再传给 `io.Copy`，无论目标是文件还是内存缓冲都适用，比替换 `io.Copy` 侵入更小。
> - 若 `total`（Content-Length）缺失，`percent` 无法计算 → 退化为「已下载字节数」文本显示。

---

## 🟡 P1：Per-site 模式记忆

```ts
function effectiveMode(site: PlazaSite): OpenMode {
    const key = `miku.plaza.mode.${site.name}`;
    const saved = localStorage.getItem(key);
    return saved ?? site.mode; // 回退到站点默认推荐模式
}
```

站点卡片显示各自模式徽标，点击可单独切换并持久化。

---

## 🟢 P2：拖放导入 — 补齐 external 模式闭环

在主窗口注册 `dragover`/`drop` 事件，用户从系统浏览器拖 zip → 直接 `ImportLocalFile` 入库。

```ts
window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files)
        .filter(f => /\.(zip|pmx|vmd|vpd)$/i.test(f.name));
    files.forEach(f => ImportLocalFile(f.path));
});
```

---

## 🟢 P2：下载完成 Toast + 模型库自动刷新

```ts
EventsOn('plaza:downloadComplete', (result) => {
    showToast(`${result.fileName} 已入库`, {
        action: '查看模型库',
        onClick: () => refreshModelLibrary()
    });
});
```

---

## 🟢 P2：键盘快捷键（window 模式）

通过 `Windows.WindowKeyDown` 事件：

| 快捷键 | 动作 |
|--------|------|
| F5 / Ctrl+R | `PlazaReload()` |
| Alt+← | `PlazaGoBack()` |
| Alt+→ | `PlazaGoForward()` |
| Ctrl+W | `ClosePlazaWindow()`（隐藏） |
| Ctrl+= / Ctrl+- | `ZoomIn()` / `ZoomOut()` |

---

## 完整路线图

| 优先级 | 功能 | 技术依赖 | 预计工作量 |
|--------|------|---------|-----------|
| 🔴 P0 | Window 下载拦截（代理桥接） | `StartProxy` + `/__plaza_dl__` + 注入脚本 fetch 变体 | 2h |
| 🔴 P0 | Window 导航控制 | `ExecJS("history.back()")` + Go 方法 + 前端遥控面板 | 1.5h |
| 🟡 P1 | 导航事件 + URL 追踪 | `Windows.WebViewNavigationCompleted` + `EmitEvent` | 1.5h |
| 🟡 P1 | 下载进度 | `ProgressReader` + `EmitEvent` | 1h |
| 🟡 P1 | Per-site 模式记忆 | localStorage per-site key | 0.5h |
| 🟡 P1 | Embed 加载指示 | CSS spinner + iframe `onload` | 0.5h |
| 🟢 P2 | 拖放导入 | `drop` event + `ImportLocalFile` | 1h |
| 🟢 P2 | 下载完成 toast | `EmitEvent` + toast 组件 | 0.5h |
| 🟢 P2 | 键盘快捷键 | `Windows.WindowKeyDown` | 0.5h |

---

## 风险与限制

- **代理桥接的 CORS**：`/__plaza_dl__` 端点需显式设置 `Access-Control-Allow-Origin: *` 并接受 `OPTIONS` 预检，否则外部页面 `fetch` 被浏览器拦截。
- **WebView2 原生注入未暴露**：若未来 fork Wails 暴露 `Chromium.Init` + `MessageReceived`，window 模式可改为「原生注入 + 原生消息通道」方案，比代理桥接更优雅（无需 Go 代理，延迟更低）。当前以代理桥接为务实路径。
- **动态下载链接**：Bowlroll 等站下载链接可能藏在二次确认页或 JS 动态生成，静态正则拦截不到 → 降级走 **fsnotify 兜底（复用 ADR-003 方案 C 的已有下载目录监听，非本 ADR 新增依赖）**。
- **`ExecJS` 时序**：注入脚本需在页面加载后执行。`WebViewNavigationCompleted` 事件是可靠触发点，但首帧渲染前可能有短暂空白 → 配合加载指示 spinner 缓解。
- **多窗口并发**：当前仅一个预热窗口实例。若未来需要多站并行浏览（tab 化），需扩展为窗口池或 fork `NewWithOptions` 配合 `Init` 注入。

### 审核发现修正汇总（2026-07-11 有条件通过）

| 级别 | 位置 | 问题 | 修正 |
|------|------|------|------|
| 🟠 P2 | §P1 URL 追踪 | 重定向时 `location.href` 返回代理 URL 而非原始 URL | 由代理 handler 记录真实目标 URL 回传，前端仅回传 title |
| 🟠 P2 | §P0 下载拦截 | 注入脚本中 `href` 可能为相对路径 | 脚本端 `new URL(href, document.baseURI).href` 绝对化 |
| 🟡 P3 | §P1 下载进度 | `ProgressReader` 依赖底层 `io.Copy`，若为 `http.Get`+`ReadAll` 则不适用 | 先确认底层拷贝方式；改用 `io.TeeReader` 降低侵入 |
| 🟡 P3 | §P0 改动点 | 快速重开时 `StopProxy` 端口可能未释放 | 增加端口关闭完成等待 / 端口 0 自动分配 + 超时重试 |
| 🟢 P4 | §风险 | fsnotify 兜底跨层，易误解为新增依赖 | 已标注属 ADR-003 方案 C 既有方案，非本 ADR 新增 |

---

## 涉及文件（预期）

| 文件 | 改动 |
|------|------|
| `internal/app/proxy.go` | `/__plaza_dl__` + `/__plaza_url__` 路由；`plazaInjectScript` 增加 mode 参数；`ProgressReader` |
| `internal/app/plaza_window.go` | `NavigatePlazaWindow` 调 `StartProxy` + 导航代理 URL；`PlazaGoBack` / `PlazaGoForward` / `PlazaReload`；`WebViewNavigationCompleted` 监听 |
| `frontend/src/menus/plaza.ts` | 遥控面板 UI；`EventsOn('plaza:urlChanged')` / `('plaza:downloadProgress')` / `('plaza:downloadComplete')`；per-site 模式记忆；drop 监听 |
| `frontend/src/app.css` | 加载 spinner；遥控面板样式 |
| `frontend/bindings/` | 自动生成（Go 方法增删后重跑 `npm run generate:bindings`） |
| `frontend/src/__tests__/bindings/app.contract.test.ts` | 更新函数列表（如新增 Go 方法） |

---

## 后续增强（已拆分）

| 方向 | 内容 | 优先级 |
|------|------|--------|
| 多 tab 并行浏览 | 窗口池 / fork `NewWithOptions` + `Init` 注入 | P3 |
| 跨站搜索聚合 | 搜索栏同时查询多站 + 结果聚合面板 | P3 |
| 最近访问历史 | 跟踪 per-site 访问 URL，plaza 首页快捷回访 | P3 |
| 原生注入方案 | fork Wails 暴露 `Chromium.Init` + `MessageReceived` | 待评估 |
