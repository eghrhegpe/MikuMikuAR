# E2E 测试运行手册（Runbook）

MikuMikuAR 的端到端测试基于 **Playwright**，采用双模式 fixture：

- `vitePage`：Playwright 自带 Chromium 打 Vite 开发服务器（`:5173`），**不依赖 Wails 运行时**。
- `wailsPage`：经 `connectOverCDP` 连 Wails WebView2 的调试端口（`:9222`），**真·Wails 运行时**，用于断言 3D 渲染。

测试按标签切分：`@dom`（仅 vitePage）、`@webgl`（仅 wailsPage）。运行前请先读上层策略文档 [`docs/adr/adr-060-e2e-testing-strategy.md`](../../docs/adr/adr-060-e2e-testing-strategy.md)。

> 为什么分两类：详见 ADR-060 风险表——`connectOverCDP` 是 Chromium 专用协议，Wails 在 Linux 用 WebKitGTK 不兼容，故 `@webgl` 只能在 Windows（原生 WebView2）跑；`@dom` 可在任意平台（含 CI ubuntu）跑。

> ⚠️ **PowerShell 用户必读**：本手册示例多为 bash 风格。在 PowerShell 下，`@dom`/`@webgl` 这类带 `@` 的标签**必须用引号包住**（`"@webgl"`），否则 `@webgl` 会被当成 splatting 变量 `$webgl` 而报 `cannot be retrieved`。下文已对 `wails3` / 标签做了修正。

---

## 0. 一次性前置条件

```bash
cd frontend
npm install                        # 安装前端依赖（含 @playwright/test）
npx playwright install chromium    # 安装 Playwright 浏览器二进制（CI 里也一样要装）
```

仅跑 `@webgl` 还需本地有 **Go + Wails CLI v3**：

```bash
go install github.com/wailsapp/wails/v3/cmd/wails@latest
```

---

## 1. 快速 DOM 回归（无需 Wails）— `@dom`

开两个终端：

```bash
# 终端 A：起 Vite 开发服务器
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173

# 终端 B：跑 DOM 层测试（smoke 3 + env-sky 2 = 5 个）
cd frontend
npx playwright test --grep "@dom"   # 标签加引号（PowerShell splat 坑）
```

也可走 npm 脚本等价写法：

```bash
npm run test:e2e -- --grep "@dom"
```

✅ 验证内容：菜单/overlay 显隐、快捷键、环境面板渲染（天空模式控件、预设 chips、颜色控件）。

---

## 2. 完整 3D 集成（需 Wails + WebView2）— `@webgl`

> **推荐在 Windows 上跑**（原生 WebView2 才兼容 `connectOverCDP`）。

开两个终端：

```powershell
# 终端 A：先杀掉残留 WebView2 进程（关键！否则复用旧进程 → 9222 不开），再暴露 CDP 端口
#   （wails3 dev 会同时提供前端 5173 与 WebView 9222）
cd <项目根>

# ⚠️ 关键修复：WebView2 按 user-data-folder 复用浏览器进程，浏览器参数（含调试端口）
#    仅在进程【首次创建】时读取。残留 msedgewebview2.exe 会被复用并忽略本次参数。
Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force

# 用 MMCAR_DEBUG_PORT 触发 main.go 注入 --remote-debugging-port（见下方「机制说明」）
#   ❌ 不要用 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS：Wails v3 会显式设置浏览器参数，
#      从而【屏蔽】该 env var（已源码实锤），设了也无效。
$env:MMCAR_DEBUG_PORT="9222"
wails3 dev
#   ⚠️ 若用 `wails dev` 却报 "open wails.json: not found"，说明 PATH 上的 `wails`
#      是老的 v2；本项目是 v3，须改用 `wails3`（或把 v3 的 wails 放到 PATH 前置）。
#   ⚠️ 该 $env 必须与 `wails3 dev` 在同一终端、且等构建完成+窗口弹出后再测。

# 终端 B：先验证 9222 真的开了，再跑 WebGL 层测试
#   （返回 JSON 才成功；Connection refused = 端口没开，别急着跑测试）
Invoke-WebRequest http://127.0.0.1:9222/json/version
cd frontend
npx playwright test --grep "@webgl"   # 标签必须加引号（PowerShell splat 坑）
```

> **机制说明（重要）**：`@webgl` 经 `connectOverCDP` 连 `127.0.0.1:9222`。该端口由 `main.go` 读取 `MMCAR_DEBUG_PORT` 后注入 `application.Options.Windows.AdditionalBrowserArgs`(`--remote-debugging-port=<port>`)。**不能**用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`——Wails v3 在 `webview_window_windows.go` 显式设置了 `AdditionalBrowserArgs`(至少含 `--disable-features=msSmartScreenProtection`),程序化参数非空时 WebView2 原生 loader 不再合并该 env var,故设了无效。

> **最简路径**：直接跑根目录的 `.\start-e2e.ps1` —— 它已内置「杀残留 WebView2 + 设 MMCAR_DEBUG_PORT=9222 + `wails3 dev`」三步。

> macOS/Linux 上 `wails3 dev` 起的是 WebKitGTK，`connectOverCDP` 连不上 → `@webgl` 会 `ECONNREFUSED 9222`。这是预期限制，不是测试 bug。
> 若 `Invoke-WebRequest` 仍 `Connection refused`：① 确认 `msedgewebview2` 残留已杀(`Stop-Process -Name msedgewebview2`);② 确认本次 `wails3 dev` 是**全新启动**(窗口是这次弹出的);③ `netstat -ano | findstr 9222` 看端口状态;④ 确认用的是 `MMCAR_DEBUG_PORT` 而非被屏蔽的 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`。

---

## 3. 一次性跑全部（wails3 dev 就绪时）

`wails3 dev` 已同时提供 5173 与 9222，因此可一条命令跑全 14 个：

```bash
cd frontend
npx playwright test            # 等价于 npx playwright test（不加 --grep）
# 或 npm run test:e2e
```

---

## 4. 查看报告

测试结束后 Playwright 生成 HTML 报告：

```bash
npx playwright show-report     # 默认托管在 http://localhost:9323
```

失败用例的截图/视频在 `frontend/test-results/<用例名>/`（仅失败或重试时生成）。

---

## 5. 截图基线（指纹）管理

`env-sky.spec.ts` 用 16×16 亮度指纹与基线比对（容忍度 0.08），而非像素级 diff：

- **首次运行自动生成**：基线 JSON 落在 `frontend/e2e/__baselines__/`，无需手工创建。
- **重置某条基线**：删除对应 `.json` 文件，下次运行会重新生成。
- **重算全部**：`rm -f frontend/e2e/__baselines__/*.json`。

---

## 6. 单元测试（Vitest，与 E2E 分开）

```bash
cd frontend
npm run test                   # 或 npx vitest run
```

算法/物理/换装/绑定契约等逻辑层回归，秒级、无运行时依赖，改逻辑后默认跑。

---

## 7. CI 门禁对照

| Job | Runner | 性质 | 命令 | 覆盖 |
|-----|--------|------|------|------|
| `e2e` | ubuntu-latest | **阻塞门禁** | 起 Vite → `npx playwright test --grep "@dom"` | `@dom` ×5 |
| `e2e-wails` | windows-latest | `continue-on-error` | 起 `wails3 dev`(带 9222) → `npx playwright test --grep "@webgl"` | `@webgl` ×7 |

本地复刻 CI 行为即上述「1 / 2」两套命令。本地 `wails3 dev` 就绪时直接套用「3」一次跑全量，最接近 CI 的 `e2e + e2e-wails` 合并结果。

---

## 8. 常见失败与排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `@webgl` 报 `connect ECONNREFUSED 127.0.0.1:9222` | **用了被 Wails v3 屏蔽的 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`**(无效)；或未设 `MMCAR_DEBUG_PORT`；或残留 `msedgewebview2.exe` 复用旧进程 | 改用 `MMCAR_DEBUG_PORT=9222`(main.go 注入 `AdditionalBrowserArgs`)；先 `Stop-Process -Name msedgewebview2`；再 `.\start-e2e.ps1`；`Invoke-WebRequest http://127.0.0.1:9222/json/version` 验证 |
| `@dom` 报 `Executable doesn't exist ... chromium` | 浏览器二进制未装 | `npx playwright install chromium` |
| 纯 Vite 模式下控制台报 `Init failed: ... @wailsio_runtime` | 无 Wails 运行时，**属正常**；菜单 DOM 仍渲染，`@dom` 不受影响 | 忽略；仅 `@dom` 断言依赖 DOM |
| strict mode 冲突（`getByText` 命中多元素） | 文本同时出现在菜单项与状态栏 | 选择器加 `{ exact: true }` 或换唯一 `id` |
| `@webgl` 在 macOS/Linux 全红 | WebKitGTK 不兼容 CDP | 改到 Windows 跑，或只跑 `@dom` |
| `npx playwright test --grep @webgl` 报 `The variable '$webgl' cannot be retrieved` | **PowerShell 把 `@webgl` 当 splatting 变量 `$webgl`** | 标签加引号：`--grep "@webgl"`（bash/zsh 无需引号） |
| `wails dev` 报 `open wails.json: not found` | PATH 上的 `wails` 是老的 v2，项目是 v3 | 改用 `wails3 dev`（或把 v3 的 wails 放到 PATH 前置） |

---

## 9. 新增 / 维护 spec 约定

- 走 DOM：用 `vitePage`，仅断言菜单/overlay/滑块等真实渲染的节点（canvas 内无 DOM，勿用 `toBeVisible` 判 3D）。
- 走 3D：用 `wailsPage` + `window.__scene` 数值断言（`fps` / `meshCount` / `constraintCount` / `currentAnimation` / `fingerprint()`）；换装走 `__scene.applyOutfit()` 钩子，勿做 3-4 层菜单 DOM 导航。
- 每个 spec 顶层 `test.describe` 标注 `@dom` 或 `@webgl` 标签，CI 据此切分。
- 改动 `core/main.ts`（`window.__scene` 钩子）前，按项目多 AI 铁律先在当日 `memory/YYYY-MM-DD.md` 认领。
