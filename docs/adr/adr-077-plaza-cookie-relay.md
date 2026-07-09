# ADR-077: 模型广场 · Cookie 中继（登录态代理）

> **状态**: 提案
> **关联**: ADR-075（模型广场基础架构）、ADR-003（下载策略方案 C）
> **来源**: 2026-07-09 广场增强讨论

---

## 背景

ADR-075 双路模型中，内嵌代理（模式 A）仅适用于免登录展示站。需登录的站点（模之屋、Booth 商店等）被迫走系统浏览器外链，用户需在外部完成登录 → 下载 → 回到应用内等待 fsnotify 监听落库，体验割裂。

根因：iframe 内访问 `https://pixiv.net` 时，Cookie 域名为 `pixiv.net`，而代理地址是 `127.0.0.1`，浏览器拒绝跨域 Cookie 传输。

---

## 决策

在 Go 代理层增加 **Cookie 中继**：代理作为 Cookie 的可信中间人，双向搬运 Cookie。

### 工作流

```
1. iframe 内用户登录 → 浏览器发 POST 到 127.0.0.1:PORT/login
2. 代理转发到目标站 → 拦截响应 Set-Cookie 头
3. 存入 Go 端 cookiejar（net/http/cookiejar.Jar）
4. 后续请求 → Director 从 jar 中取出匹配域名的 Cookie 注入请求头
5. 目标站看到合法 Cookie → 认为是正常登录态
```

### 关键实现

```go
type proxySession struct {
    server   *http.Server
    port     int
    listener net.Listener
    jar      *cookiejar.Jar  // net/http/cookiejar，按 eTLD+1 存储
}
```

- `ModifyResponse` 拦截 `Set-Cookie`，写入 `jar`
- `Director` 从 `jar` 取 Cookie 注入 `req.Header`
- Cookie 生命周期跟随 `StopProxy()`，关闭即销毁

### 安全边界

| 约束 | 措施 |
|------|------|
| Cookie 仅在代理生命周期内有效 | `StopProxy()` 调用 `jar.SetCookies()` 清空 |
| 不持久化到磁盘 | 内存 jar，进程退出即丢失 |
| 仅代理 `a.httpServers` 注册的域名 | `jar.TLDReps()` 限制，防止注入任意域 |

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `internal/app/proxy.go` | `proxySession` 结构体 + `cookiejar.Jar` 集成 |
| `internal/app/proxy_test.go` | Cookie 中继单元测试 |

---

## 风险

- **HttpOnly Cookie**：`Set-Cookie` 含 `HttpOnly` 时浏览器不会暴露给 JS，但代理层在 HTTP 传输层拦截，不受此限制 → 可正常中继
- **SameSite 策略**：`SameSite=Strict` 的 Cookie 在跨站请求中不发送，但代理层是服务端注入，不受浏览器 SameSite 限制
- **CAPTCHA / 二次验证**：登录流程中若触发验证码，用户仍在 iframe 内操作，代理透明透传即可
