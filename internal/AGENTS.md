# internal/ — Go 后端专用 AGENTS.md

> **定位**：Go 后端构建/测试命令 + 写码硬约定 + 「去哪里查」指针。
> AI 在 `internal/` 内编辑时优先读本文件；根 [`AGENTS.md`](../AGENTS.md) 是项目宪法 + 全局文档地图。
> **本文件不手列目录树 / 架构 / 测试 / 风险 / 依赖** —— 模块现状一律由 `docs/knowledge/go-*.md` 知识卡承载（source_files 自动校验），手工维护必漂移。

---

## 一、构建与测试命令

> **执行位置**：所有命令在项目根目录执行。

| 命令 | 用途 | 说明 |
|------|------|------|
| `go build ./...` | 构建全部 | 验证编译通过 |
| `go test ./...` | 运行全部测试 | |
| `go test ./internal/...` | 仅后端测试 | |
| `go vet ./...` | 静态分析 | 检查常见错误 |
| `task run` | 本地运行 | Wails v3 运行（无独立 `cmd/` 入口） |
| `node scripts/goerr-lint.mjs --strict` | Go/前端错误 i18n 静态检查 | ADR-117 防回归 |

### 高频最小集

```bash
go build ./... && go test ./internal/...
```

---

## 二、写新代码的约定

1. **错误包装** — 使用 `util.WrapError(op, err)` 或 `util.WrapErrorf(op, msg, err)`
2. **panic 恢复** — 对外暴露的方法使用 `util.SafeCall()` / `util.SafeCallVoid()`（绝不让 panic 穿越 Wails 绑定层）
3. **配置变更** — 通过 `a.updateConfig(mutate, rescan)` 原子操作，持久化走 `writeConfig()`
4. **文件访问** — 使用 `fileAccessor` 而非 `os.*`（为 Android SAF 预留）
5. **平台分支** — 使用 `isAndroid` 变量检查，`runtime.GOOS` 用于构建标签
6. **测试** — 使用 `testConfigDir(t)` 隔离配置目录，避免污染用户环境
7. **错误 i18n** — 用户可见错误用 `i18nerr.New`/`UserError` 信封（ADR-117），不裸抛技术栈文本

---

## 三、「去哪里查」指针（本文件不手列事实索引）

> 模块现状快照见 `docs/knowledge/go-*.md` 知识卡（含 `invariants`/`source_files`），改卡后 `npm run gen:docsindex` 重生成索引；本文件禁止回写任何模块事实。

| 要查什么 | 怎么查 |
|----------|--------|
| 全部后端卡索引 | [`docs/knowledge/index.md`](../docs/knowledge/index.md)（`#backend` 分组） |
| App 生命周期 + 配置系统 | [`go-app.md`](../docs/knowledge/go-app.md) |
| 模型库扫描 | [`go-library.md`](../docs/knowledge/go-library.md) |
| ZIP 解压缓存 + 文件服务器 | [`go-zipextract.md`](../docs/knowledge/go-zipextract.md) |
| 模型隔离安全 HTTP | [`go-httpserver.md`](../docs/knowledge/go-httpserver.md) |
| 下载目录监听 | [`go-watch.md`](../docs/knowledge/go-watch.md) |
| 文件/路径平台抽象 | [`go-fileaccess.md`](../docs/knowledge/go-fileaccess.md) |
| 场景序列化与打包 | [`go-scene.md`](../docs/knowledge/go-scene.md) |
| 预设持久化与标签 | [`go-presets.md`](../docs/knowledge/go-presets.md) |
| 广场代理（SSRF 防护） | [`go-proxy.md`](../docs/knowledge/go-proxy.md) |
| 广场窗口与配置 | [`go-plaza.md`](../docs/knowledge/go-plaza.md) |
| LLM 客户端与 AI 绑定 | [`go-llm.md`](../docs/knowledge/go-llm.md) |
| 更新检查与安装 | [`go-update.md`](../docs/knowledge/go-update.md) |
| Blender/MMD 软件集成 | [`go-integration.md`](../docs/knowledge/go-integration.md) |
| KTX2 纹理编码 | [`go-ktx2.md`](../docs/knowledge/go-ktx2.md) |
| Go 错误 i18n 信封 | [`go-i18nerr.md`](../docs/knowledge/go-i18nerr.md) |
| 通用工具（util） | [`go-util.md`](../docs/knowledge/go-util.md) |
| 缩略图缓存 | [`go-thumbnail.md`](../docs/knowledge/go-thumbnail.md) |
| 文件对话框 | [`go-dialogs.md`](../docs/knowledge/go-dialogs.md) |
| ADR 决策 + 状态 | `grep docs/adr/` + [`docs/status.md`](../docs/status.md) |
