# ADR-078: 模型广场 · 下载拦截（iframe 内一键入库）

> **状态**: 已实施
> **关联**: ADR-075（模型广场基础架构）、ADR-003（下载策略方案 C · fsnotify 落库）
> **来源**: 2026-07-09 广场增强讨论

---

## 背景

当前下载链路：用户在 iframe 内看到模型 → 点击下载 → 浏览器默认行为下载到系统 Downloads → 等待 fsnotify 监听 → 自动导入。存在两个痛点：

1. 下载位置不可控（用户可能改了浏览器默认下载目录）
2. 无进度反馈，用户不知道何时入库完成

---

## 决策

在代理层注入轻量 JS 脚本，拦截目标站的下载链接点击，走 Go 端 HTTP 下载直接入库。

### 架构

```
iframe 内注入 script
  ├─ 拦截 <a href="*.pmx|*.vmd|*.zip"> 点击
  ├─ postMessage({ type: 'download', url, filename }) 给父窗口
  └─ preventDefault() 阻止浏览器默认下载

父窗口 (plaza.ts) 收到 postMessage
  └─ 调用 Go binding: DownloadFromPlaza(url, filename)

Go 端 (proxy.go)
  ├─ 从 cookiejar 取登录态注入请求
  ├─ HTTP GET 下载到 resource_root 对应分类目录
  ├─ 去重（文件名 + 大小哈希）
  └─ 返回 DownloadResult{ path, size, alreadyExists }
```

### 注入方式

代理响应 HTML 时，在 `</head>` 前插入：

```html
<script>
window.addEventListener('message', e => {
  if (e.data?.type === 'plaza-download-request') {
    // 转发给父窗口
    parent.postMessage(e.data, '*');
  }
});
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.href;
  if (/\.(pmx|vmd|zip|vpd)$/i.test(href)) {
    e.preventDefault();
    parent.postMessage({
      type: 'plaza-download-request',
      url: href,
      filename: href.split('/').pop()
    }, '*');
  }
}, true);
</script>
```

### Go 端下载

```go
func (a *App) DownloadFromPlaza(url, filename string) (DownloadResult, error) {
    // 1. 从 proxySession.jar 取 Cookie
    // 2. http.Get with Cookie header
    // 3. 写入 resource_root/model/ 或 resource_root/motion/（按扩展名分类）
    // 4. 去重检查
    // 5. 返回结果
}
```

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/proxy.go` | 注入脚本 + `DownloadFromPlaza` 方法 |
| `frontend/src/menus/plaza.ts` | `postMessage` 监听 + 进度 Toast |
| `frontend/bindings/` | 自动生成 |

---

## 风险

- **站内 JS 拦截失效**：部分站用 `download` 属性或 JS 动态生成 blob URL 下载，静态正则拦截不到 → 降级走 fsnotify 兜底
- **大文件下载阻塞**：Go 端同步下载会阻塞 Wails 线程 → 改为 goroutine + 前端轮询进度
- **CORS preflight**：注入的 script 与父窗口同源（都在 127.0.0.1），postMessage 无跨域限制

---

## 已知问题

### Bug 1：`TestDownloadFromPlaza_SizeLimit` 污染用户配置（2026-07-23 修复）

**根因**：`internal/app/proxy_test.go` 的 `TestDownloadFromPlaza_SizeLimit` 用 `t.TempDir()` 作为 `ResourceRoot`，但**漏调 `testConfigDir(t)`** 隔离配置目录，导致 `updateConfig` 把临时目录路径 `TestDownloadFromPlaza_SizeLimit4042439480\001` 写入用户真实的 `%APPDATA%/MikuMikuAR/config.json` 的 `resource_root` 字段。

同文件 `TestDownloadFromPlaza`（第140行）有正确的 `testConfigDir(t)` 隔离，SizeLimit 测试是漏网的。

**影响**：`resource_root` 指向已失效的 `%TEMP%` 临时目录，`ScanModelDir` 扫描错误目录导致音乐库/道具列表为空，设置页显示乱码路径。

**修复**：补上 `testConfigDir(t)` 调用（commit `5e66ea3f`）。详见 `docs/buglog/2026-07-17-adr124-file-access-migration.md` Bug 5。

### Bug 2：`SelectDir` 起始目录失效导致对话框打不开（2026-07-23 修复）

**根因**：Bug 1 污染 `resource_root` 后，`getLastDir("library")` 解析相对路径 `./PMX` 时用失效的 `resource_root` 拼出 `...\Temp\TestDownloadFromPlaza_SizeLimit4042439480\001\PMX`，`SelectDir` 直接把失效路径传给 `dialog.SetDirectory` → WebView2 `GetFileAttributesEx` 失败（HTTP 422 Unprocessable Entity）→ 对话框无法弹出 → 用户无法重选根目录，形成死锁。

**修复**：`SelectDir` 调用 `dialog.SetDirectory` 前用 `os.Stat` 校验起始目录存在，失效则跳过设置，WebView2 回退到默认起始位置（commit `124ff9d2`）。

**教训**：下载测试的 `ResourceRoot` 设置必须配合 `testConfigDir(t)` 隔离；`SelectDir` 类对话框不应信任传入路径的有效性。
