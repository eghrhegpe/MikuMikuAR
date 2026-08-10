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
# Pin to go.mod version instead of @latest to avoid API drift
WAILS_VER=$(grep 'wails/v3' go.mod | head -1 | awk '{print $2}')
go install "github.com/wailsapp/wails/v3/cmd/wails3@$WAILS_VER"
```

---

## 1. 快速 DOM 回归（无需 Wails）✅ CLI 友好 — `@dom`

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

## 2. 完整 3D 集成（需 Wails + WebView2）⚠️ 仅 Windows — `@webgl`

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

> [2026-08-10] E2E 已挂回 **push**（`.github/workflows/e2e-suite.yml`，分支 main/master），
> 作为独立 workflow 与 CI 分开显示。分层门禁：真门禁失败即红；环境硬伤 job 为
> best-effort + failure-count gate（超阈值才红，杜绝「全败仍全绿」假绿）。

| Job | Runner | 触发 | 性质 | 命令 | 覆盖 |
|-----|--------|------|------|------|------|
| `e2e-dom` | ubuntu-latest | push / dispatch / 周一 cron | ✅ **阻塞门禁**（failed>0 即红） | 起 Vite → `npx playwright test --grep "@dom\b" --grep-invert "@overlay"` | `@dom` 纯 DOM 断言（a11y/nav/`__scene` hook，不含 WebGL overlay） |
| `e2e-web-smoke` | ubuntu-latest | 同上 | ✅ **阻塞门禁**（failed>0 即红） | build + preview dist-web → `npx playwright test --grep "@web-smoke(?![A-Za-z0-9_-])"` | `@web-smoke` ×5（web-smoke.spec.ts：首屏 + 环境菜单 + 快捷键） |
| `e2e-web-full` | ubuntu-latest | 同上 | ⚠️ **best-effort**（gate：failed>5 红） | build + preview dist-web → `npx playwright test --grep "@web\b" --grep-invert "@web-smoke"` | `@web` ×18（全量除 smoke，含 FSA 授权流 + 下载面板 + 能力声明） |
| `e2e-wails` | windows-latest | 同上 | ⚠️ **best-effort**（gate：failed>8 红） | 起 `wails3 dev`(带 9222) → `npx playwright test --grep "@webgl\b"` | `@webgl` ×16（真实模型加载 + 动作/换装 + 截图管线） |

> **设计意图**：`e2e-dom`（@dom，Ubuntu Chromium）和 `e2e-web-smoke`（@web-smoke）快且稳，
> 作为真·阻塞门禁（分开显示，前端挂了 AI 好修）。`e2e-wails`（@webgl，需 Windows + WebView2/CDP）
> 与 `e2e-web-full`（@web 全量，含 FSA/IndexedDB 探针）有无 GPU 等环境硬伤，设为 best-effort
> 并加失败计数 gate（阈值 8/5，均 < 实测测试总数 16/18，杜绝「全败仍全绿」）——测试失败仍出报告、
> 不假装绿，超阈值才标红，不阻塞 push。
> 分支保护 rules 如需强制可勾选 `E2E — DOM/Overlay Gate (@dom, vitePage)` + `E2E — Web Entry Smoke (@web, vite preview)`。

本地复刻 CI 行为即上述「1 / 2」两套命令。本地 `wails3 dev` 就绪时直接套用「3」一次跑全量，最接近 CI 的 `e2e-dom + e2e-wails` 合并结果。

### @webgl 本地开发注意事项

`@webgl` 测试在 CI 上设为非阻塞，但本地开发时仍是验证 3D 集成的核心手段。为减少炸测：

1. **启动前必杀残留 WebView2**：`Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force`
2. **用 `MMCAR_DEBUG_PORT=9222` 而非 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`**：Wails v3 会屏蔽后者
3. **验证端口**：`Invoke-WebRequest http://127.0.0.1:9222/json/version` 返回 JSON 后再跑测
4. **最简启动脚本**：根目录 `.\start-e2e.ps1` 已内置以上三步

---

## 7.5. 测试覆盖全景（2026-08-10 更新）

### 两阶段测试策略

本项目采用「**@dom 稳定门禁 + @webgl 可选深度**」的两阶段策略：

| 阶段 | 标签 | 运行环境 | CI 兼容 | 用途 |
|------|------|----------|---------|------|
| **基础门禁** | `@dom` | vitePage (Chromium → :5173) | ✅ Linux/Mac/Windows 通用 | DOM/UI 回归 + Babylon 程序化逻辑验证 |
| **深度集成** | `@webgl` | wailsPage (CDP → Wails WebView2 :9222) | ⚠️ 仅 Windows + Wails v3 | 真实 PMX 加载、动作播放、换装、截图管线 |
| **网页入口** | `@web` | vite preview (:4174) | ✅ Linux/Mac/Windows 通用 | Web 入口能力门控 + IndexedDB CRUD |

**设计意图**：`@dom` 和 `@web` 作为**阻塞门禁**（可在任意 OS 的 CI 上稳定运行），确保核心回归覆盖；`@webgl` 作为**非阻塞**（仅 Windows CI，`continue-on-error`），提供深度集成验证但不阻塞合并。

> **💡 快速判断标准**：
> - ✅ **CLI 友好**：只依赖 Playwright 自带 Chromium，跑 `npm run test:e2e -- --grep "@dom"` (或 `@web`)
> - ⚠️ **需桌面环境**：必须有 Wails 运行时，跑 `npm run test:e2e -- --grep "@webgl"` 前需先启动 `wails3 dev`

### @dom — 桌面 DOM 层（vitePage, 77 tests）✅ CLI 友好

| Spec 文件 | 测试数 | 覆盖内容 |
|-----------|--------|---------|
| `smoke.spec.ts` | 3 | 首屏 canvas + nav 按钮 + Ctrl+1~5 快捷键切换 |
| `a11y.spec.ts` | 1 | axe-core WCAG 无障碍扫描 |
| `ai-control.spec.ts` | 3 | AI 控制面板 DOM 渲染 |
| `library-panel-dom.spec.ts` | 3 | 模型库按钮渲染 + 首次提示 + 关闭重开 |
| `motion-panel-dom.spec.ts` | 3 | 动作弹窗标题/区段 + 相机模式交互 + 返回 |
| `motion-playback-dom.spec.ts` | 2 | 底部播放栏 DOM + 空态引导 |
| `scene-panel-dom.spec.ts` | 3 | 场景区段 + 后处理迁移 + 舞台灯光 |
| `scene-water-dom.spec.ts` | 1 | 水面预设 + 参数滑块 |
| `settings-panel-dom.spec.ts` | 4 | 设置区段 + 快捷键 + 外观 + 关闭重开 |
| `shortcuts-dom.spec.ts` | 3 | 快捷键面板 + Ctrl+1~5 + 播放按钮挂载 |
| `settings-theme-lang-dom.spec.ts` | 6 | 主题/外观 + 路径 + 性能 + 渲染 + 音频 + 完整性 |
| `desktop-capabilities-dom.spec.ts` | 7 | nav 全集 + 相机入口 + 导入/重扫 + library/paths 区段 |
| `schema-driven.spec.ts` | 30 | **声明式菜单引擎**：schema-snapshot 单源驱动，面板级聚合导航 + action 分级断言 |
| `menu-declaration.spec.ts` | 2 | 声明式菜单扫描：结构契约（唯一 id/深度/tab 叶子）+ tab 导航 |
| `model-load.spec.ts` (DOM 部分) | 2 | createTestMesh + clearTestMeshes 程序化 mesh 生命周期 |
| `export-screenshot.spec.ts` (DOM 部分) | 1 | 设置面板「截图」入口 DOM 断言 |
| `model-lifecycle-webgl.spec.ts` (DOM 部分) | 2 | 程序化 mesh 生命周期 + removeActiveModel 空场景安全调用 |
| `env-sky.spec.ts` (DOM 部分) | 1 | 天空统一层级模式/预设/光照控制 |

### @webgl — 桌面 3D 集成（wailsPage/CDP, 16 tests）⚠️ 需 Windows + Wails

| Spec 文件 | 测试数 | 覆盖内容 |
|-----------|--------|---------|
| `model-load.spec.ts` (WebGL 部分) | 3 | 真实 PMX 加载 meshCount + FPS + 确定性加载 |
| `action-play.spec.ts` | 2 | 动作切换 + 换装变体（需带动作/换装的模型） |
| `export-screenshot.spec.ts` (WebGL 部分) | 1 | __scene.capture() Babylon→PNG 管线 |
| `env-sky.spec.ts` (WebGL 部分) | 2 | 夜景预设渲染 + 截图基线比对 |
| `model-lifecycle-webgl.spec.ts` (WebGL 部分) | 3 | 真实模型加载→删除→重加载 + modelManager 状态验证 |
| `physics-health.spec.ts` | 5 | 物理健康检查：刚体计数 + 风力订阅/骨骼位移 + 风速归零稳定性 |

> **注意**：`@webgl` 测试需要 Windows + Wails v3 + WebView2，且依赖本地模型库配置。
> 若 `wails3 dev` 未启动或 CDP 端口未开，这些测试会快速失败并出现在报告中，**不会阻塞合并**。
> 本地启动步骤：`Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force` → `$env:MMCAR_DEBUG_PORT="9222"` → `wails3 dev` → `Invoke-WebRequest http://127.0.0.1:9222/json/version` 验证端口。

### @web — 网页端全量（vite preview 4174, 23 tests）✅ CLI 友好

| Spec 文件 | 测试数 | 覆盖内容 |
|-----------|--------|---------|
| `web-smoke.spec.ts` | 5 | 首屏 + 环境菜单 + Ctrl 快捷键 + AR/广场门控 |
| `web-resources.spec.ts` | 4 | PMX/VMD/ZIP 加载闭环（循环化）+ IndexedDB CRUD |
| `web-capabilities.spec.ts` | 5 | ar/plazaWindow/watchDir 门控 + 广场内联 + nav 全集 |
| `web-fsa-auth.spec.ts` | 4 | FSA 授权状态探针 + dismissed 标志 + 导入/重扫入口 |
| `web-download-panel.spec.ts` | 5 | 下载入口 + 浏览区段 + 打开/关闭稳定性 |

---

## 3.5. Web 入口测试（@web，ADR-177 Phase 4 + ADR-176~183）

主应用 web 入口（`index.web.html` → `vite.web.config.ts`）的全量测试，不依赖 Wails runtime。

```bash
cd frontend
npm run test:e2e:web            # 自动 build + preview dist-web/ → 跑 @web
# 或手动：
npx vite build --config vite.web.config.ts
npx vite preview --config vite.web.config.ts --port 4174
npx playwright test --grep "@web"
```

- **webServer**：`playwright.config.ts` 自动 `vite build + vite preview`（4174 端口，`/MikuMikuAR/` base path）
- **fixtures**：`frontend/e2e/fixtures/`（sample.pmx 834KB + sample.vmd 19KB + sample.zip 854KB），通过 `page.route()` 注入，不打进 bundle
- **覆盖项**：首屏渲染、6+1 nav 按钮、菜单导航、能力门控（AR/广场窗口隐藏 + watchDir/windowsCopy 声明）、PMX/ZIP/VMD 加载闭环、IndexedDB CRUD、FSA 授权流程（四态探针 + dismissed 标志 + initLibrary 引导）、下载管理面板、模型库打开/关闭稳定性

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
- 走 3D：用 `wailsPage` + `window.__scene` 数值断言（`fps` / `meshCount` / `constraintCount` / `currentAnimation` / `fingerprint()`）；换装走 `__scene.driver.applyOutfit()` 钩子（写操作统一在 `__scene.driver`，只读探针在 `__scene` 顶层），勿做 3-4 层菜单 DOM 导航。
- 每个 spec 顶层 `test.describe` 标注 `@dom` 或 `@webgl` 标签，CI 据此切分。
- 改动 `core/main.ts`（`window.__scene` 钩子）前，按项目多 AI 铁律先在当日 `memory/YYYY-MM-DD.md` 认领。

---

## 10. 声明式菜单测试引擎

### 核心思想

既然菜单系统本身是**声明式**的（`MenuNode` 数据 → 渲染 → DOM），测试也不应该硬编码 `page.click()` + `waitForSelector`。

[menu-declaration.spec.ts](file:///C:/Users/zhujieling11/MikuMikuAR/frontend/e2e/menu-declaration.spec.ts) 实现了一个自动扫描引擎：

1. **`scanMenuTree()`**：在浏览器中递归扫描所有 `[data-testid]` 元素
2. **复合分类器**：基于 CSS class（`collapsible-wrapper`→folder, `slide-item`→tab, `cs-row`→slider 等）+ testid 前缀判断节点类型
3. **树结构重建**：通过向上追溯最近 testid 祖先，确定 parent-child 关系
4. **自动断言**：验证唯一性、深度限制、分类合理性、导航可达性

### 优势

| 维度 | 传统命令式测试 | 声明式引擎 |
|------|---------------|-----------|
| **新增菜单** | 手写 `page.click()` + `expect()` | 零成本，自动覆盖 |
| **DOM 重构** | 所有测试可能断裂 | 仅需更新分类器（单点修改） |
| **维护成本** | 每个菜单项需 2-3 个测试 | 6 个测试覆盖全量菜单 |
| **CI 耗时** | 随菜单项线性增长 | 固定 ~9s |

### 运行

```bash
npx playwright test --grep "@dom"  # 包含声明式引擎
# 或单独跑：
npx playwright test e2e/menu-declaration.spec.ts
```
