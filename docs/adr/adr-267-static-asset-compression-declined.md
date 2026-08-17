# ADR-267: 静态资源压缩不下发 — 桌面 loopback 与 Pages CDN 已覆盖，预压缩实测净负

> **状态**: ✅ 已采纳（2026-10-23）
> **日期**: 2026-10-23

## 背景

体检报告把「静态资源零压缩」列为 P1：`frontend/dist` 13.7MB，其中 `lib/babylon.js` 7.81MiB、
`assets/index-*.js` 1.79MB，仓库里没有任何 gzip/Brotli 下发逻辑，`internal/` 只有
`internal/app/proxy.go:410` 与 `internal/llm/client.go:184` 的**请求侧** `Content-Encoding`。
当时的推断是「8.2MB 明文过网」，修法是构建期预压缩 + Go 中间件。

推方案前先量了两端的真实链路，推断不成立：

**桌面端（生产主路径）**。资产不是过网，而是 `main.go:19` 的 `//go:embed all:frontend/dist`
打进二进制，由 `main.go:35` 的 `app.CoopCoepMiddleware(application.AssetFileServerFS(assets))`
在同进程内以 loopback 交给 WebView2。这条路径的瓶颈是「读内存 + 拷贝」，不是带宽。

**Web 端（GitHub Pages）**。`frontend/vite.web.config.ts` 不 externalize
（该文件第 8 行注释：web 入口无 babylon UMD script 标签，必须打进 bundle），Babylon 被拆成
`babylon-vendor` chunk（同文件 72–74 行）；`frontend/index.web.html` 第 6 行已注明移除 UMD 标签。
即 Web 端根本不加载那个 8.2MB 文件，且 Pages 的 CDN 已经替我们压缩。实测 HEAD 请求：

```
assets/index.web-*.js  200  content-length=273114  content-encoding=gzip  cache-control=max-age=600
assets/iconify-*.js    200  content-length=8541    content-encoding=gzip
```

## 决策

**不引入构建期预压缩（gzip/Brotli），不加 Go 压缩中间件。**

实测数据（`frontend/public/lib/babylon.js` = 7.81MiB，Node zlib，单机）：

| 方案 | 体积 | 构建/压缩耗时 | 运行时解压 |
|------|------|--------------|-----------|
| 原样 | 7.81MB | — | 读取 3.4ms |
| gzip -6 | 1.69MB | 163ms | **21ms** |
| gzip -9 | 1.68MB | 256ms | 21ms |
| brotli q11 | 1.17MB | **14297ms** | 20ms |

桌面端走预压缩的净效果：省下 loopback 拷贝的个位数毫秒，代价是每次加载 **+21ms 解压 CPU**、
二进制常驻 **+1.69MB**（`embed` 只增不减），外加 Range/`Content-Length`/`Vary` 的协商正确性风险。
两头一算，净负。

Web 端已由 Pages CDN 覆盖（上表实测 `content-encoding=gzip`），自建预压缩文件还拿不到
`Content-Encoding` 响应头——Pages 不支持自定义 header，`.gz` 只会变成「下载一个压缩包」。

## 备选方案

- **Go 中间件在线 gzip**：省掉构建步骤，但把 163ms 压缩开销搬进每次冷启动的第一个请求，更差；
  且 `http.ServeContent` 需要改写成流式 pipe，Range 语义随之丢失。
- **预压缩 + 自定义 header**：桌面端只换来 ±10ms；Web 端 Pages 无法下发 header，只有自建 CDN 才成立。
- **砍体积而非压体积**（Babylon 模块裁剪 / 重打包 UMD）：真正能减的是解析时间而非传输时间，
  但要维护一份 Babylon 子集构建，与 ADR-266 的「字节级对齐 devDependency」直接冲突——已否决。

## 影响

- 不新增脚本、不动 `main.go`、不动构建流水线。
- 复评条件（任一成立再回来看）：桌面端资产改为远端拉取（非 embed）；Web 端离开 GitHub Pages
  迁到可自定义响应头的主机；或 Babylon UMD 体积降到 2MB 以下使解压开销不再显眼。
- 真正值得继续做的是**代码产出量**而非传输：`assets/index-*.js` 1.79MB 对应的是应用自身逻辑，
  已在 ADR-254 的 B 类（`browser-adapter.ts` 2386 行等）里跟踪。

## 相关文档

> ADR-266（Babylon UMD 供应源对齐 — 同一次体检的相邻结论）
> ADR-254（P4 backlog 登记簿 — 体积治理的排期位置）
> `docs/audit-playbook.md`（体检口径）
