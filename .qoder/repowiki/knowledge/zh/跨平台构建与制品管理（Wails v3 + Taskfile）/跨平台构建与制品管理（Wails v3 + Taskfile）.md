---
kind: build_system
name: 跨平台构建与制品管理（Wails v3 + Taskfile）
category: build_system
scope:
    - '**'
source_files:
    - Taskfile.yml
    - build/config.yml
    - scripts/build-windows.ps1
    - scripts/build-linux.sh
    - scripts/build-darwin.sh
    - scripts/build-android.ps1
    - scripts/build-ios.sh
    - scripts/wails/release.ps1
    - frontend/package.json
---

## 1. 构建系统总览
- 框架：基于 Wails v3 的 Go+Web 桌面应用，前端使用 Vite + TypeScript + Babylon.js。
- 任务编排：根目录 `Taskfile.yml` 作为统一入口，通过 `includes` 将 Windows/macOS/Linux/iOS/Android 各平台子任务拆分到 `build/<platform>/Taskfile.yml`；本地开发常用 `task dev`、`task build`、`task package` 等命令。
- 脚本兜底：当 `wails3 task` 不可用时，提供 `scripts/build-{windows,linux,darwin,android}.ps1|sh` 直接调用 `npm ci` + `vite build` + `go build`/`wails3 build` 完成端到端构建。
- 产物输出：所有平台产物统一复制到仓库根 `dist/`，命名带版本与平台信息，如 `MikuMikuAR-<version>-windows-amd64.exe`、`mikumikuar-<version>-linux-amd64`、`mikumikuar-<version>-darwin-arm64`、`MikuMikuAR-<version>-android-arm64.apk`。

## 2. 关键文件与职责
- 顶层任务入口
  - `Taskfile.yml`：定义通用变量（APP_NAME、BIN_DIR、VITE_PORT、APP_VERSION/BUILD_TIME/COMMIT_HASH）、公共任务（build/package/run/dev/server/docker），并 include 各平台子任务。
  - `build/config.yml`：Wails 应用元信息（companyName/productName/version/fileAssociations 等），由构建脚本在运行前同步 `package.json` 的版本号。
- 平台构建脚本（独立可执行，适合 CI/手工一键构建）
  - `scripts/build-windows.ps1`：Windows 专用，处理 WorkBuddy safe-delete 垫片、清理 Android 残留 GOARCH/CC 等环境变量、同步 config.yml 与 windows Taskfile 占位符、启用 MPR 多线程物理、先 `npm ci` + `vite build`，再 `wails3 build`（失败回退 `go build`），最终重命名为 `MikuMikuAR-<version>-windows-amd64.exe`。
  - `scripts/build-linux.sh` / `scripts/build-darwin.sh`：Linux/macOS 专用，流程与 Windows 一致，Darwin 版根据 `uname -m` 区分 amd64/arm64。
  - `scripts/build-android.ps1`：Android 专用，负责前端构建→拷贝到 `build/android/app/src/main/assets`、生成 overlay.json、调用 `scripts/build-android-so.ps1` 编译多架构 `.so`、Gradle assembleDebug/Release（Release 需 keystore 环境变量），产出 APK 到 `dist/`。
  - `scripts/build-ios.sh`：iOS 占位脚本，提示使用 `task ios:build` 或 Xcode 项目。
- 发布流水线脚本
  - `scripts/wails/release.ps1`：三阶段 release 构建（Go test → go build -ldflags=-s -w → frontend npm run build），用于正式打包前的快速验证。
- 前端工程配置
  - `frontend/package.json`：定义 `dev/build/check/test/e2e/lint/format/generate:bindings` 等脚本，依赖 `@wailsio/runtime`、`babylon-mmd`、`jszip` 等；`generate:bindings` 通过 `wails3 generate bindings` 从 Go 侧生成 TS 绑定到 `frontend/bindings`。
  - `frontend/vite.config.ts` / `vitest.config.ts` / `playwright.config.ts`：Vite 构建、单元测试与 E2E 测试配置。
- 辅助工具脚本（位于 `scripts/`）
  - `gen-icon-bundle.mjs`、`gen-textures.py`、`gen_appicon.py`：图标与纹理资源生成。
  - `i18n-check.mjs`、`goerr-lint.mjs`：国际化与错误 i18n 静态检查（被 `task check:goerr` 调用）。
  - `setup-github-secrets.ps1`、`verify-sab.js`：CI 环境准备与安全校验。

## 3. 架构与约定
- 版本号来源：统一取自根 `package.json` 的 `version`，构建脚本在运行前用正则替换 `build/config.yml` 中的 `info.version`，并在 Windows 路径额外替换 `build/windows/Taskfile.yml` 中 `{{.APP_VERSION}}/{{.BUILD_TIME}}/{{.COMMIT_HASH}}` 占位符，确保 `main.AppVersion` 等运行时字段正确。
- 构建标签（build tags）：
  - `debug`：开发调试模式，保留更多日志与符号。
  - `production`：生产优化，配合 `-s -w` ldflags 剥离符号表。
  - `mpr`：启用多线程物理（MPR）与 COOP/COEP 中间件，同时通过 `VITE_MMD_WASM_MT=1` 注入前端 define 门控 WASM 路径。
- 开发体验：`task dev` 启动 `wails3 dev -config ./build/config.yml -port <VITE_PORT>`，`build/config.yml` 的 `dev_mode.executes` 顺序为：阻塞式 `wails3 build DEV=true` → 后台 `common:dev:frontend`（Vite HMR）→ 主进程 `run`，实现“改 TS 不退出软件”的热重载体验。
- 产物命名规范：`<app>-<version>-<os>-<arch>[.<ext>]`，例如 `MikuMikuAR-1.5.3-windows-amd64.exe`、`mikumikuar-1.5.3-linux-amd64`、`mikumikuar-1.5.3-darwin-arm64`、`MikuMikuAR-1.5.3-android-arm64.apk`。
- 平台隔离：各平台差异集中在 `scripts/build-*.ps1|sh` 与 `build/<platform>/Taskfile.yml`（若存在），顶层 `Taskfile.yml` 仅做路由分发，避免重复逻辑。

## 4. 开发者应遵循的规则
- 新增平台或修改构建流程时，优先更新对应 `scripts/build-<platform>.ps1|sh`，保持“读取 package.json 版本 → 同步 config.yml → 前端 npm ci + vite build → Go 编译 → 重命名到 dist/”的统一步骤顺序。
- 需要注入运行时版本/时间/提交哈希时，务必同步更新 `build/config.yml` 与 Windows 路径下的 `build/windows/Taskfile.yml` 占位符，否则“关于/检查更新”会显示 `dev`。
- 切换 debug/production 构建时，统一通过 `--production` 参数或 `Production` switch 控制 BUILD_TAGS 与 ldflags，不要手动拼 `-s -w`。
- 启用 MPR 多线程物理必须同时设置 `VITE_MMD_WASM_MT=1` 与 Go build tag `mpr`，二者缺一不可。
- 本地开发请使用 `task dev`，不要直接 `wails3 build`，以利用 `dev_mode.executes` 的 Vite HMR 热重载链路。
- 新增前端依赖后，如需暴露给 Go 层，运行 `npm run generate:bindings` 重新生成 `frontend/bindings`，并提交变更以便 CI 校验。
- 发布前建议先执行 `scripts/wails/release.ps1` 进行三阶段快速验证（Go test → go build -ldflags=-s -w → frontend build），再通过各平台脚本产出最终制品。