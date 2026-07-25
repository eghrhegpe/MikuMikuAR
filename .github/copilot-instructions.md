# MikuMikuAR — GitHub Copilot 上下文（架构速览）

你是本仓库的协作 AI。完整开发规范见根目录 `AGENTS.md`（CodeBuddy 入口）与 `docs/`。

## 一句话定位
**前端优先的 Babylon.js 9.16（TypeScript + Vite）3D MMD 应用**：通过 Wails v3 包装为 Windows/Android 桌面与移动 App，同时通过 Vite web 构建发布为浏览器版（GitHub Pages）。同一套 `frontend/src` 代码，双形态交付。

## 关键事实（避免误判）
- 这是 **TypeScript 前端项目**，不是 Go 项目。`main.go` 仅是 Wails 桌面壳入口；业务逻辑几乎全在 `frontend/src/`。
- 后端能力（文件 IO / 扫描 / HTTP / 缩略图 / i18n）由 Go（`internal/`）提供，但已通过 `BackendService` 接口抽象，前端有 `go-adapter`（桌面）与 `browser-adapter`（网页，IndexedDB）双实现（ADR-176）。**网页版不依赖 Go 运行时**。
- 平台：桌面 Windows ✅ / Android ✅（c-shared + WebView）；iOS / Linux 🟡 理论兼容未实测。网页版可在任意现代浏览器运行（含 iOS / Linux）。
- 网页版地址：https://eghrhegpe.github.io/MikuMikuAR/ （构建配置 `frontend/vite.web.config.ts`，产物 `dist-web/`）。

## 仓库结构
- `main.go` / `main_android.gen.go` — Wails 入口（桌面 + Android）
- `internal/` — Go 后端
- `frontend/src/` — 前端应用（core / scene / menus / motion-algos / outfit / physics）
- `docs/` — 架构、160+ ADR、状态、知识卡
- `AGENTS.md` — AI 开发入口（命令 / 约定 / 指针）

## 开发命令
- 前端：`cd frontend && npm install && npm run dev`（或 `wails3 dev -config ./build/config.yml -port 9245`）
- 测试：`cd frontend && npm run check && npm run test`（Vitest，2050+ 用例）
- 重构：用 `npm run codemod`（ts-morph AST 感知），禁止 Python re.sub 改写。

## 纪律
- 新建 ADR 前取 `docs/adr/` 最大编号 +1；编号只给 ADR / novel。
- 提交格式 `<type>: <描述>`；禁止 `git stash`。
- 改动后跑 `npm run check`（根）与最小相关测试。
