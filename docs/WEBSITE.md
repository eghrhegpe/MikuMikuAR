---
title: 网站与 Web 部署架构
description: MikuMikuAR 站点技术栈、路径约定、构建部署与本地预览的集中说明——面向 AI 与开发者的一站式入口
---

# 网站与 Web 部署架构

> **读者**：所有协作 AI（Copilot / CodeBuddy / WorkBuddy 等）与开发者。
> **定位**：本文是「网站怎么搭、怎么部署、本地怎么跑」的**唯一集中入口**。其余信息（见 §8）均为分散来源，读本文一份即可建立全貌。
> **权威事实源**：部署逻辑以 [`.github/workflows/web-pages.yml`](../.github/workflows/web-pages.yml) 为准；本文为其人类可读摘要。

---

## 1. 一句话定位

**一个 GitHub Pages 站点，承载两类内容**：

- **文档站（根）**——VitePress 渲染的 `docs/` 全量文档（用户指南 / 架构 / ADR / 知识卡 / 运维）。
- **主应用 Web 入口（`/app/`）**——同一套 `frontend/src` 经 Vite web 构建发布的浏览器版 MMD 编辑器。

两者由同一条 CI 流水线构建、合并为**一次 artifact、一次部署**。

## 2. 技术栈

| 组成 | 技术 | 版本/说明 |
|------|------|-----------|
| 文档站 | VitePress（Vue + Markdown） | `^1.6.3`，本地搜索（`provider: local`） |
| 主应用 Web | Vite + Babylon.js 9.16 + TypeScript | 入口 `frontend/index.web.html` → `vite.web.config.ts` |
| 部署 | GitHub Pages（`actions/deploy-pages`） | 仓库 `eghrhegpe/MikuMikuAR`，无需 `gh-pages` 分支 |
| 桌面壳 | Wails v3（Go 薄壳） | 与网页版**共用** `frontend/src`，见 §7 差异 |

## 3. 站点整体架构

```
eghrhegpe.github.io/MikuMikuAR/          ← Pages 根 = 文档站（VitePress base=/MikuMikuAR/）
├── /guide/       用户指南（docs/guide/*，自动扫描）
├── /architecture  架构与规范（docs/ 根散 md）
├── /adr/         决策记录（docs/adr/*）
├── /knowledge/   知识卡（docs/knowledge/*）
├── /buglog/      开发运维 · Bug 日志
├── /releases/    开发运维 · 发版记录
└── /app/         主应用 Web 入口（Vite base=/MikuMikuAR/app/）
```

- **路径重分配**：文档站占根、主应用降为 `/app/` 子路径（ADR-177 / ADR-225）。
- **旧路径兼容**：历史 `/docs/` 路径经 [`scripts/redirect-stubs/docs-404-redirect.html`](../scripts/redirect-stubs/docs-404-redirect.html) 跳回根；根投放墓碑 Service Worker 注销旧 scope 的 SW（ADR-225）。

## 4. 路径约定速查

| 用途 | URL |
|------|-----|
| 文档站首页 | `https://eghrhegpe.github.io/MikuMikuAR/` |
| 用户指南 | `…/MikuMikuAR/guide/` |
| 主应用 Web 入口 | `…/MikuMikuAR/app/` |
| 仓库 | `https://github.com/eghrhegpe/MikuMikuAR` |

## 5. 关键文件索引

| 文件 | 作用 |
|------|------|
| [`.github/workflows/web-pages.yml`](../.github/workflows/web-pages.yml) | **部署流水线（权威事实源）**：构建+合并+deploy-pages |
| [`docs/.vitepress/config.ts`](./.vitepress/config.ts) | VitePress 配置（base、srcDir、sidebar 自动扫描、srcExclude） |
| [`docs/package.json`](./package.json) | VitePress 依赖与脚本（`dev`/`build`/`preview`） |
| [`frontend/vite.web.config.ts`](../frontend/vite.web.config.ts) | 网页版构建配置（base=`/MikuMikuAR/app/`、Wails stub、MPR） |
| [`frontend/index.web.html`](../frontend/index.web.html) | 网页版入口 HTML |
| [`scripts/redirect-stubs/`](../scripts/redirect-stubs/) | `/docs/` 跳转 stub + 根墓碑 SW（`sw-tombstone.js`） |
| [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) | GitHub Copilot 专用架构速览（本文的 Copilot 子集） |

## 6. 构建与部署（CI）

**流水线**：[`web-pages.yml`](../.github/workflows/web-pages.yml)（名称 `Web — GitHub Pages Deploy`）。

- **触发**：`main` 分支 push，且 `frontend/index.web.html`、`frontend/vite.web.config.ts`、`frontend/src/**`、`frontend/bindings/**`、`docs/**`、`.github/workflows/web-pages.yml`、`scripts/redirect-stubs/**` 任一改动；亦支持 `workflow_dispatch` 手动触发。
- **权限**：`pages: write` + `id-token: write`（`deploy-pages` 需要）。
- **步骤摘要**：
  1. `npm ci`（frontend）→ 恢复 Vite 构建缓存
  2. `node ../scripts/generate-locale-json.mjs`（编译语言包到 `public/locales/`，否则线上 404 回退 key）
  3. `npx vite build --config vite.web.config.ts`（`VITE_MMD_WASM_MT=1` → 解锁多线程物理）→ 产物 `frontend/dist-web/app/`
  4. `cp dist-web/app/index.web.html dist-web/app/index.html`（Pages 默认入口）
  5. `cd docs && npm ci && npm run build` → VitePress 产物 `docs/.vitepress/dist/`
  6. `cp -r ../docs/.vitepress/dist/. dist-web/`（拷**目录内容**而非目录，避免根 `index.html` 缺失）
  7. 追加 `/docs/` 跳转 stub、`404.html`、根墓碑 `sw.js`
  8. `actions/upload-pages-artifact` + `actions/deploy-pages`
- **并发**：`group: web-pages`，`cancel-in-progress: true`。

## 7. 网页版 vs 桌面版差异（AI 易误判点）

| 维度 | 桌面版（Wails v3） | 网页版（GitHub Pages） |
|------|------|------|
| 运行时 | Go 后端 + WebView2 | 纯浏览器，**不依赖 Go 运行时** |
| 后端能力 | `go-adapter`（文件 IO / 缩略图 / i18n） | `browser-adapter`（IndexedDB，ADR-176） |
| Wails 运行时 | 真实 `@wailsio/runtime` | 替换为 `runtime-stub.ts` 的 no-op，`__MMKU_WEB__` 短路 |
| 多线程物理 | 原生 | 需 `VITE_MMD_WASM_MT=1` + COOP/COEP（`crossOriginIsolated` 解锁 `SharedArrayBuffer`） |
| 语言包 | 编译期 | 运行时 `fetch` JSON（`public/locales/`） |

## 8. 文档站内部要点（VitePress）

配置见 [`docs/.vitepress/config.ts`](./.vitepress/config.ts)：

- **`base: '/MikuMikuAR/'`**，**`srcDir: '.'`**（站点根即 `docs/`，全量文档进站）。
- **自动扫描 sidebar**：`guide/`、`docs/` 根 md、`adr/`（编号倒序）、`knowledge/`（按 category 分组）、`buglog/`（日期倒序）、`releases/`（版本倒序）均自动收录，**新增页面无需手改 sidebar 数组**。
- **`srcExclude`**（不发布）：`guide/README.md`、`guide/img/**`、`knowledge/.archive/**`、`audit/**`、`research/**`、`superpowers/**`、`ai-new/**`、`upstream/**`、`AGENTS.md`、`dep-graph.md`。
- **`ignoreDeadLinks: true`**：正文相对链接（如 `../../AGENTS`）多为 GitHub 仓库浏览用途，站内按路由解析会死链，统一忽略；站内导航由 sidebar 保证。
- **nav**：首页 / 用户指南 / 知识卡 / 决策记录 / 开发运维 / GitHub。
- **写作规范**：内容格式见 [`docs/guide/README.md`](./guide/README.md)（frontmatter 模板、命名约定、铁律）。

## 9. 相关 ADR 与文档

| 主题 | 入口 |
|------|------|
| Web Loader 与主应用统一路径 | [/adr/adr-177-web-loader-main-app-unification](/adr/adr-177-web-loader-main-app-unification) |
| Web 页面路径重分配 | [/adr/adr-225-web-pages-path-reallocation](/adr/adr-225-web-pages-path-reallocation) |
| 模型广场 Web 浏览 | [/adr/adr-075-model-plaza-web-browsing](/adr/adr-075-model-plaza-web-browsing) |
| 广场浏览器体验 | [/adr/adr-087-plaza-browser-experience](/adr/adr-087-plaza-browser-experience) |
| 广场 cookie relay | [/adr/adr-077-plaza-cookie-relay](/adr/adr-077-plaza-cookie-relay) |
| 广场数据源统一与持久化 | [/adr/adr-224-plaza-广场数据源统一与持久化](/adr/adr-224-plaza-广场数据源统一与持久化) |
| FSA 句柄持久化 / 认证 / 能力矩阵 host keys | [/adr/adr-180-fsa-handle-persistence](/adr/adr-180-fsa-handle-persistence) · [/adr/adr-183-fsa-auth-guidance](/adr/adr-183-fsa-auth-guidance) · [/adr/adr-178-capability-matrix-host-keys](/adr/adr-178-capability-matrix-host-keys) |
| 前端 Backend 适配器双实现 | [/adr/adr-176-frontend-backend-adapter](/adr/adr-176-frontend-backend-adapter) |
| 网页端数据存储与 Origin 隔离 | [web-data-origin-isolation.md](./web-data-origin-isolation.md) |
| 文档自动化工具链 | [/adr/adr-230-docs-automation-toolchain](/adr/adr-230-docs-automation-toolchain) |

## 10. AI 上下文入口矩阵

| 入口文件 | 覆盖的 AI |
|------|------|
| 根 `AGENTS.md` | CodeBuddy / WorkBuddy 总入口 |
| [`docs/AGENTS.md`](./AGENTS.md) | 文档索引 / AI 路由 |
| [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) | GitHub Copilot 专用 |
| **本文 `docs/WEBSITE.md`** | **所有 AI——站点架构集中说明（推荐首读）** |

---

### 维护约定

- 改部署行为 → **先改 `web-pages.yml`，再同步本文 §6**（本文是摘要，非真相源）。
- 新增文档页 → 放入 `docs/` 对应目录，sidebar 自动扫描入列；若在 `docs/` 根新增 `.md`，会自动进入「架构与规范」分组（表外沉底）。
- 新增需排除的文档 → 改 `config.ts` 的 `srcExclude` 与 `ROOT_NOBUILD`（双源单一真相，勿手改两处）。
- 本文目标：**让任何新 AI session 读一份即懂「网站是咋搭的」**，替代翻阅多处注释与 ADR。
