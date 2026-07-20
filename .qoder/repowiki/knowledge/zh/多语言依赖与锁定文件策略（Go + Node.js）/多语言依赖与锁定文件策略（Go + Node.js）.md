---
kind: dependency_management
name: 多语言依赖与锁定文件策略（Go + Node.js）
category: dependency_management
scope:
    - '**'
source_files:
    - go.mod
    - go.sum
    - frontend/package.json
    - frontend/package-lock.json
    - Taskfile.yml
    - build/Taskfile.yml
    - scripts/build-windows.ps1
    - scripts/build-linux.sh
    - scripts/build-android.ps1
---

## 1. 使用的系统与方法
- Go 后端：使用 `go.mod` / `go.sum` 进行模块声明与版本锁定，未启用 vendor 目录，依赖通过官方代理或 GOPROXY 拉取。
- 前端应用：位于 `frontend/`，使用 npm 作为包管理器，以 `package.json` 声明依赖、`package-lock.json` 锁定版本；同时支持 bun/pnpm/yarn 安装路径，但默认以 npm 为准。
- 构建编排：根级 `Taskfile.yml` 统一封装 `task build/package/run/dev` 等任务，内部调用 Wails v3 CLI 与 Vite，并在 `build/Taskfile.yml` 中抽象出跨平台子任务。
- 绑定生成：Wails v3 的 `wails3 generate bindings` 在构建前自动生成 `frontend/bindings/**/*`，由 Taskfile 的 `generate:bindings` 任务驱动，并受 `go.mod`/`go.sum` 变更触发。

## 2. 关键文件与位置
- Go 依赖清单与锁文件：
  - `go.mod`：声明 module、Go 版本及所有 require（含 indirect），当前仅引入 wailsapp/wails/v3、fsnotify、rardecode、text 等少量核心库。
  - `go.sum`：对应校验和（随 go mod tidy 更新）。
- 前端依赖清单与锁文件：
  - `frontend/package.json`：声明 devDependencies（Vite、TypeScript、ESLint、Prettier、Playwright、Vitest 等）与运行时依赖（BabylonJS 全家桶、babylon-mmd、jszip、@preact/signals-core、encoding-japanese 等）。
  - `frontend/package-lock.json`：npm 生成的精确树。
  - `frontend/node_modules/`：本地安装的依赖目录（不纳入版本控制）。
- 顶层脚本入口：
  - `package.json`（仓库根）：提供 `test:e2e`、`build`、`dev`、`build:*` 等快捷命令，转发到 `frontend/` 或 `scripts/`。
  - `Taskfile.yml` 与 `build/Taskfile.yml`：封装 `install:frontend:deps`、`build:frontend`、`generate:bindings`、`generate:icons` 等可复用任务。
- 构建脚本：
  - `scripts/build-windows.ps1`、`scripts/build-linux.sh`、`scripts/build-android.ps1`、`scripts/build-darwin.sh`、`scripts/build-ios.sh`：各平台打包入口，最终都落到 `task package` 流程。

## 3. 架构与约定
- 双清单、单锁文件策略
  - Go 侧严格遵循 `go.mod` + `go.sum` 组合，禁止手动编辑 `go.sum`，通过 `task common:go:mod:tidy`（内部包装 `go mod tidy`）统一维护。
  - 前端侧以 `frontend/package.json` + `frontend/package-lock.json` 为唯一来源，Taskfile 的 `install:frontend:deps:npm` 将 `sources` 指向这两个文件，确保变更时重新安装。
- 包管理器可插拔但默认固定
  - `build/Taskfile.yml` 暴露 `install:frontend:deps:bun|pnpm|yarn` 分支，通过环境变量 `PACKAGE_MANAGER` 切换；但默认值为 `npm`，且 CI/文档均以 npm 为准，避免团队分歧。
- 绑定生成与依赖解耦
  - `generate:bindings` 任务显式依赖 `go:mod:tidy`，保证 Go 端依赖稳定后再执行 `wails3 generate bindings`，从而让前端 TypeScript 绑定与 Go API 保持同步。
- 资源与第三方 CSS 的“半 vendoring”
  - 对 Puppertino CSS 采用“本地缓存 + 按需下载”模式：若 `frontend/public/puppertino/puppertino.css` 不存在则尝试从 GitHub 拉取，存在则直接使用，属于轻量 vendoring 变体。
- 无私有注册表与 GOPRIVATE 配置
  - 仓库内未发现 `.npmrc`、`.yarnrc`、`GOPRIVATE`、`go.work` 等私有源/工作区配置，所有依赖均来自公共源（golang.org/x、GitHub Releases、npm registry）。

## 4. 开发者应遵守的规则
- 新增 Go 依赖
  - 使用 `go get <module>` 后提交 `go.mod` 与 `go.sum` 变更；不要直接手写 `go.sum`。
  - 若涉及 Windows/Linux/macOS 平台特定依赖，注意在 `internal/app/*.go` 的 build tag 下隔离，避免污染通用依赖图。
- 新增前端依赖
  - 在 `frontend/package.json` 中添加，然后运行 `cd frontend && npm install` 生成/更新 `package-lock.json`；提交两者。
  - 仅在确有必要时才切换到 bun/pnpm/yarn，并通过 `PACKAGE_MANAGER=xxx task install:frontend:deps` 验证；默认始终使用 npm。
- 绑定与构建顺序
  - 修改 Go 结构体或导出方法后，先执行 `task generate:bindings` 再生成前端代码，再启动开发服务器；否则可能出现类型缺失或编译失败。
- 依赖审计与升级
  - 使用 `npm audit --audit-level=high`（已暴露为 `frontend:audit`）与 `npm outdated`（`frontend:outdated`）定期扫描；Go 侧可通过 `go list -m -u all` 查看可升级项。
- 资源与第三方静态文件
  - 对于体积较小、版本稳定的 CSS/字体等资源（如 Puppertino），优先放入 `frontend/public/` 并纳入版本控制；大体积二进制资源建议通过运行时下载或外部 CDN 管理。