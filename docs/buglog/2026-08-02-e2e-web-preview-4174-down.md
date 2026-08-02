# E2E @web 冒烟失败：vite preview 4174 起不来

> **状态**: 🔴 未修复

**日期**: 2026-08-02
**严重程度**: 🟡 P3
**影响范围**: `frontend/playwright.config.ts`（webServer 配置）、`frontend/e2e/web-smoke.spec.ts`（`WEB_URL`）、构建产物 `frontend/dist-web/app/index.web.html`
**发现方式**: CI 失败（E2E — Web Entry Smoke `@web`）
**修复提交**: （待修复）

---

## 问题描述

CI 的 `e2e-web-smoke` / `e2e-web-full` job 下，`@web` 测试（Web 入口 smoke，`frontend/e2e/web-smoke.spec.ts`）始终失败。表象是 vite preview 4174 端口「起不来」——Playwright 在 `timeout: 600000`（10min）内反复等待 `http://localhost:4174/MikuMikuAR/` 就绪失败，最终健康检查超时，所有 `@web` 用例集体超时/失败。

该失败为**已知存量**，与业务代码无关，CI 已将其标记为非阻塞（不影响发版）。本次 v1.8.0 发版前已确认属历史存量。

## 复现步骤

1. `cd frontend`
2. `RUN_WEB_E2E=1 npx playwright test --grep "@web"`
3. 观察：Playwright 自动 `vite build --config vite.web.config.ts && vite preview --port 4174`，随后等待 `http://localhost:4174/MikuMikuAR/` 超时。

本地可直接验证 preview 行为：

```
npx vite preview --config vite.web.config.ts --port 4199 --strictPort
# 日志：➜ Local: http://127.0.0.1:4199/MikuMikuAR/app/
curl http://127.0.0.1:4199/MikuMikuAR/app/   # → 404（目录索引找不到 index.html）
```

## 根因分析

**主因（致命）— 入口 HTML 文件名不匹配**：
- `vite.web.config.ts` 的 `build.rollupOptions.input` 指向 `index.web.html`，因此构建产物为 `dist-web/app/index.web.html`（**不是** `index.html`）。
- vite preview（及任何标准静态服务器）在目录 `/MikuMikuAR/app/` 下做目录索引时，默认寻找 `index.html`，找不到即返回 404。
- **关键对照**：GitHub Pages 部署流程在 `web-pages.yml` 第 84–89 行有一显式步骤 `cp dist-web/app/index.web.html dist-web/app/index.html` 来补齐这个文件，所以**线上 web 入口功能正常**；但 E2E 的 preview 启动命令（`playwright.config.ts` 的 `webServer[1].command`）**缺少这步复制**，导致 preview 下 `dist-web/app/` 只有 `index.web.html` → 404。

**次因（路径不匹配）— base 与测试 URL 不一致**：
- `vite.web.config.ts:22` 的 `base = '/MikuMikuAR/app/'`，preview 实际服务在 `http://localhost:4174/MikuMikuAR/app/`。
- 但 `playwright.config.ts:51` 的 `webServer[1].url` 与 `web-smoke.spec.ts:12` 的 `WEB_URL` 默认值都写成 `http://localhost:4174/MikuMikuAR/`（**少了 `/app/` 段**）。即使主因修了，这里仍会 404。

两个原因叠加，使得无论怎么重试 preview 都「起不来」。

## 修复方案

**首选（最小改动、与现有 Pages 流程对齐，不推倒重来）**：给 E2E 的 preview 启动命令补上和 Pages 部署完全一致的 `cp` 步骤，并把 URL 路径修正为 `/MikuMikuAR/app/`。

`frontend/playwright.config.ts`（第 46–57 行 webServer[1]）：

```diff
  ...(process.env.RUN_WEB_E2E ? [{
      command: "sudo fuser -k 4174/tcp 2>/dev/null || true; npx vite build --config vite.web.config.ts && npx vite preview --config vite.web.config.ts --port 4174 --strictPort",
-     url: "http://localhost:4174/MikuMikuAR/",
+     command: "sudo fuser -k 4174/tcp 2>/dev/null || true; npx vite build --config vite.web.config.ts && cp dist-web/app/index.web.html dist-web/app/index.html && npx vite preview --config vite.web.config.ts --port 4174 --strictPort",
+     url: "http://localhost:4174/MikuMikuAR/app/",
      reuseExistingServer: true,
      timeout: 600000,
  }] : []),
```

`frontend/e2e/web-smoke.spec.ts`（第 12 行）：

```diff
- const WEB_URL = process.env.WEB_URL || "http://localhost:4174/MikuMikuAR/";
+ const WEB_URL = process.env.WEB_URL || "http://localhost:4174/MikuMikuAR/app/";
```

**长效方案（可选，需评估影响，勿擅自推倒重来）**：统一 web 入口文件名为 `index.html`，从源头消除 `index.web.html` 这个别名——即让 web 构建直接产出 `index.html`，并删除 `web-pages.yml` 的 `cp` 步骤与所有对 `index.web.html` 的引用。改动面更大（涉及 Pages 部署链路、`web-pages.yml` 的 `paths` 触发器、可能的 dev 入口区分逻辑），应作为独立重构评估，不宜与本次修复混在一起。

## 教训

1. **构建产物文件名是隐性契约**：`input` 文件名直接决定输出 HTML 名，静态服务器/Pages/预览三套消费的「索引文件名」假设必须一致。任何一处「只拷贝不统一」的临时补丁（如 Pages 的 `cp`）都可能让其他消费方（E2E preview）踩坑。
2. **base 路径要三处对齐**：`vite.web.config.ts` 的 `base`、Playwright 的 `webServer.url`、测试里的 `WEB_URL` 必须同一路径。新增子路径部署时，最容易漏改测试侧。
3. **「起不来」优先怀疑目录索引/路径**：preview server 进程其实正常启动（日志明确打印 `Local: .../MikuMikuAR/app/`），失败在健康检查 URL 的 404，而非 server 没起。排障时应直接 `curl` 各路径确认 200/404，而非假设 server 崩溃。

## 进展（2026-08-02）

已应用最小修复：`playwright.config.ts` 的 webServer `command` 加 `cp dist-web/app/index.web.html dist-web/app/index.html` 步骤、`url` 改为 `/MikuMikuAR/app/`；`web-smoke.spec.ts` 的 `WEB_URL` 同步。

验证结果：
- web 构建成功（`vite build --config vite.web.config.ts` EXIT=0，产物 `dist-web/app/index.web.html`）。
- 修复后 preview 在 `http://localhost:4174/MikuMikuAR/app/` 返回 **HTTP 200**（修复前同路径 404）；原 `/MikuMikuAR/` 仍 404，印证路径修正必要。
- 端到端 `RUN_WEB_E2E=1 npx playwright test --grep "@web"`：webServer 健康检查已通过（server 能 ready），但**所有 @web 用例仍失败**，统一报 `waitForSelector("#btnMainAction") timeout`。

结论：本 bug 的「preview 4174 起不来」根因（index.web.html vs index.html + 路径错配）**已修复**；但 @web 测试仍失败暴露出**第二个独立问题**——web 入口页面加载后未渲染 `#btnMainAction`（疑似 web 入口 JS 运行时崩溃）。该崩溃与本次修复无关；当前工作区存在未提交的 src 改动（`browser-adapter.ts` / `texture-fallback.ts` 等），疑为其所致。建议：先 stash/提交这些改动排除干扰，再单独排查 web 入口运行时崩溃（必要时立新 bug）。
