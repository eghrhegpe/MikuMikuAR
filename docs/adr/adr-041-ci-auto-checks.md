# ADR-041: CI 自动检查 — Markdown 链接校验 + AI Mistake Tracker

**日期**：2026-07-05
> **状态**: 已完成

---

## 背景

文档链接失效和 AI 反复犯错是两个低频但高成本的问题。前者导致 AI 读到断裂引用后决策错误，后者导致同一类 bug 反复出现。

## 决策

### 1. Markdown 链接校验脚本

新建 `tests/test_markdown_links.py`，白名单排除合法链接（外部 URL、HTML 标签、代码块），验证 AGENTS.md/docs/ 内部 27 个 Markdown 链接全部有效。加入 `.github/workflows/ci.yml` config-syntax job。

### 2. AI Mistake Tracker

新建 `tests/ai_mistake_tracker.py`，分析 git 历史中的 fix 提交模式：

- 分类统计 fix 提交
- 检测连续修复链（同一子系统的连续 fix = AI 反复犯错热点）
- 文件热力图（哪些文件被反复修改 = 文档不够清晰的信号）
- 规则违反扫描
- 支持 `--json` 输出供 CI 集成

CI 集成：新增 `ai-mistake-report` job，仅 main 分支 push 时运行，输出 JSON 报告 + 可读摘要，上传为 artifact。不阻塞 CI（纯报告型）。

### 4. E2E 提交门禁（CI 流水线，详见 ADR-060）

在 `.github/workflows/ci.yml` 新增两个 job，把 ADR-060 的 E2E 防线接进提交门禁：

- **`e2e`（阻塞门禁，ubuntu-latest）**：仅跑 `@dom` 标签的 spec（`smoke` + `env-sky` 的 DOM-only 滑块测试），通过 Playwright 自带 Chromium 打 Vite 开发服务器（5173），**不依赖 Wails 运行时**。验证菜单/overlay/快捷键等 DOM 层回归。
- **`e2e-wails`（best-effort，windows-latest，`continue-on-error`）**：跑 `@webgl` 标签的 spec（model-load / action-play / export-screenshot / env-sky 截图），`wails dev` 启动真实 WebView2 并开放 CDP 9222，Playwright `connectOverCDP` 连接断言 3D 渲染（`window.__scene` 数值钩子 + 截图基线）。

**平台约束（关键）**：`connectOverCDP` 是 Chromium 专用协议；Wails 在 Linux（ubuntu）上用 WebKitGTK，其远程调试器**不兼容 CDP**，故 `wailsPage` 测试只能在 `windows-latest`（原生 WebView2）上跑。`e2e-wails` 当前 `continue-on-error: true`，待在真实 runner 上验证稳定后翻为阻塞。

E2E spec 用 Playwright 原生 tag（`@dom` / `@webgl`）切分，CI 以 `npx playwright test --grep @dom|@webgl` 过滤。

### 3. 数据发现（300 commit 样本）

| 子系统 | fix 数 | 最长连续链 | 根因 |
|--------|--------|-----------|------|
| env (天空 shader) | 31 | 16 次 | Babylon.js ShaderMaterial 生命周期管理复杂，GL 程序复用冲突 |
| ci/build | 24 | 9 次 | Wails v3 构建参数与 v2 不兼容 |
| library-core.ts | 6 | - | 路径迁移后旧字段残留 |

基于 tracker 数据写入 AGENTS.md「AI 高频犯错区」3 条高价值警告。

## 教训

反馈循环比预防文档更有效。tracker 数据直接反哺 AGENTS.md 的硬约束，比人工猜测"AI 会犯什么错"更可靠。
