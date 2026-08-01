# ADR-225: Web 部署路径重分配 — 文档站占 Pages 根、主应用降 /app/ 子路径

> **状态**: 已实施（2026-08-01）
> **日期**: 2026-08-01
> **前置**: ADR-177（Web Loader 统一路径）、ADR-099 / ADR-133（MMD WASM 多线程）、ADR-176（前后端适配器）

## 背景

- 上轮（commit abfd4c7a）将文档站（VitePress）base 设为 `/MikuMikuAR/docs/`、主应用 web 入口占 Pages 根 `/MikuMikuAR/`。
- **缺陷（进错站混淆）**：根路径 `/MikuMikuAR/`（无子路径）即主应用 3D 入口。GitHub 仓库 About 的 🌐 Website 按钮、旧书签、手写 URL 默认落到根 → 主应用，而非用户预期的文档站。这是"网页有时候跳到主应用而非文档站"的根因。
- 二者本就是**一次部署、一个 artifact（`dist-web`）里的两个 SPA**，区别仅在路径分配；主应用走 Wails 本地 bundle，完全不依赖该 Pages URL，路径可自由重分配。
- 上轮的 `/guide/→/docs/` 重定向 stub（guide-redirect.html）已无意义：文档站上提至根后，`/guide/` 成为真实文档子目录（guide 章节），不应再被 stub 遮蔽。

## 决策

1. **文档站占根**：VitePress `base` 由 `/MikuMikuAR/docs/` 改为 `/MikuMikuAR/`（`docs/guide/.vitepress/config.ts`）；产物由 `web-pages.yml` 拷入 `dist-web/`（根）。`/MikuMikuAR/` 即文档中心首页。
2. **主应用降子路径**：web 入口 `base` 由 `/MikuMikuAR/` 改为 `/MikuMikuAR/app/`、`build.outDir` 由 `dist-web` 改为 `dist-web/app`（`frontend/vite.web.config.ts`）；`web-pages.yml` 将其 index.web.html 复制为 `dist-web/app/index.html` 作为 /app/ 入口。主应用线上地址变为 `https://eghrhegpe.github.io/MikuMikuAR/app/`。
3. **旧 /docs/ 链接兜底**：根 `404.html`（docs-404-redirect.html）逻辑改为——路径含 `/MikuMikuAR/docs/` → 剥离该段跳回根（文档首页）；其余未知 404（含 /app/ 之外的异常路径）兜底回根。保留对历史 `/docs/...` 外链的兼容。
4. **移除 /guide/ stub**：删除 `scripts/redirect-stubs/guide-redirect.html` 及其在 `web-pages.yml` 的拷贝步骤；`/guide/`（及 `/knowledge/`、`/adr/` 等）现为真实文档路由，旧 `/guide/...` 外链仍可直接命中真实页面。
5. **入口链接同步**：`settings-about.ts` 文档链接、`README.md` 网页版/知识库链接、`CLAUDE.md`、`docs/web-data-origin-isolation.md`、`docs/guide/README.md` 注释中的 Pages URL 全部对齐新路径。

## 备选方案

- **保持主应用占根、仅修入口链接**：改动最小，但根=应用的结构性歧义仍在，repo Website 按钮等外部入口无法约束，未选。
- **合并进同一 SPA（文档内嵌 WebGL app）**：关注点严重耦合、文档构建膨胀，未选。
- **根放"应用/文档"双入口落地页**：破坏根=文档的直接访问体验，未选。

## 影响

- **修改**：`docs/guide/.vitepress/config.ts`（base→根）、`frontend/vite.web.config.ts`（base→/app/、outDir→dist-web/app）、`frontend/index.web.html`（注释）、`frontend/src/menus/settings-about.ts`（文档链接→根）、`README.md`（网页版→/app/、知识库→根）、`CLAUDE.md`、`docs/web-data-origin-isolation.md`、`docs/guide/README.md`（注释）、`.github/workflows/web-pages.yml`（路径段重分配 + stub 改 /docs/）。
- **删除**：`scripts/redirect-stubs/guide-redirect.html`。
- **服务 worker 范围变化**：app 的 `sw.js`（COOP/COEP 注入）作用域由根收缩为 `/MikuMikuAR/app/`，更精确；文档站不需要该 worker。
- **验证**：base/outDir 已 grep 确认；docs 目录（排除 upstream）无残留 `/docs/`、`/guide/` 绝对链接。完整 GitHub Pages 构建因沙箱 safe-delete 阈值未在本地跑完，逻辑经配置对齐校验。

## 相关文档

- ADR-177（Web Loader 统一路径，本 ADR 重分配其路径分配部分）
- `.github/workflows/web-pages.yml`（部署路径段）
- `docs/guide/.vitepress/config.ts` / `frontend/vite.web.config.ts`（base 定义）
