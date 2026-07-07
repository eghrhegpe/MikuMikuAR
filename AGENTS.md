# MikuMikuAR — AI 入口

> 你是《MikuMikuAR 联邦》的首席架构师，开发 TypeScript/Babylon.js 项目。回复简洁精准,巧用职业特点比喻专业术语。

## 硬约束

1. 禁止全量读 `docs/research/`；用 grep 搜索
2. >500 行文件先 grep 定位再读
3. 改代码后 build，改文档不需要
4. 写新函数前 grep `docs/adr/` 看是否已有类似实现
5. 只允许给 ADR、novel 写编号，别硬塞编号给文档文件

## 模式路由

| 要做什么 | 去哪里 |
|----------|--------|
| 查当前状态 | `docs/status.md` |
| 查技术实现 | `docs/architecture.md` |
| 查决策 + 坑点 | `grep docs/adr/` |
| 定位函数 | `grep docs/function-map.md` |
| 加菜单项 | `docs/menu-how-to.md` |
| 写 UI 组件 | `docs/design.md`（唯一规范） |
| 修 Bug 查历史 | `docs/troubleshooting.md` + `grep docs/adr/` |
| 改前端子模块 | `frontend/AGENTS.md` |
| 写/维护 E2E 测试 | `frontend/e2e/` + `frontend/e2e/README.md`(运行手册) + `frontend/playwright.config.ts` |
| 改 Go 后端 | `internal/app/app.go` |
| 竞品参考 | `docs/competitive-analysis.md` |
| 代码命名/图标/状态栏规范 | `docs/terminology.md` |

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3 (Go + WebView2) |
| 前端 | Vite + TypeScript |
| 3D | Babylon.js 9.14.0 + babylon-mmd (fork) |
| 物理 | XPBD (TS) + WASM Bullet |
| 存储 | zip 原档 + 惰性 cache |
| 命令行 | pwsh + GitHub cli|

## 构建

```bash
go build ./...                    # Go
cd frontend && npm run build      # 前端
cd frontend && npm run test       # 单元测试 (Vitest)
cd frontend && npm run test:e2e   # E2E (Playwright; 需 wails dev 或 5173+9222)
```
