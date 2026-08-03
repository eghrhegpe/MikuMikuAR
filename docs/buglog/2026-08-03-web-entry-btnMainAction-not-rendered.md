# E2E @web 冒烟失败：web 入口加载后未渲染 #btnMainAction

> **状态**: 🔴 未修复

**日期**: 2026-08-03
**严重程度**: 🟡 P3
**影响范围**: `frontend/e2e/web-smoke.spec.ts`、web 入口运行时（`vite.web.config.ts` 构建产物 `dist-web/app/`）
**发现方式**: CI 失败（E2E — Web Entry Smoke `@web`，接 `2026-08-02-e2e-web-preview-4174-down.md` 主因修复后的遗留）
**修复提交**: （待修复）

---

## 问题描述

`2026-08-02-e2e-web-preview-4174-down.md` 的「preview 4174 起不来」根因（`index.web.html` vs `index.html` + base 路径错配）修复后，preview 健康检查通过，但**所有 @web 用例仍失败**，统一报 `waitForSelector("#btnMainAction") timeout`——web 入口页面加载后未渲染主按钮。

## 复现步骤

1. `cd frontend`
2. `RUN_WEB_E2E=1 npx playwright test --grep "@web"`
3. 观察：webServer 健康检查通过（server ready），但用例在 `page.waitForSelector("#btnMainAction", { timeout: 20000 })`（`web-smoke.spec.ts:22`）超时

## 根因分析（初步）

- 页面 HTTP 200、HTML 已加载，但 JS 运行时未把 `#btnMainAction` 渲染出来——**疑似 web 入口 JS 运行时崩溃**（初始化链路中断，未走到菜单渲染）。
- 对照：桌面入口（5173 dev）与 GitHub Pages 线上 web 入口均正常，问题特定于 `vite.web.config.ts` 构建产物。
- 2026-08-02 排查时工作区存在未提交的 src 改动（`browser-adapter.ts` / `texture-fallback.ts` 等），疑为其所致；**需先排除工作区脏改动干扰，再单独排查 web 入口运行时崩溃**。

## 待办排查方向

1. 提交/清理工作区未提交改动后复测，确认是否脏改动所致
2. 若仍失败：打开 web 入口 DevTools 看 JS 崩溃堆栈（`#btnMainAction` 是根菜单主按钮，渲染链路在 `init.ts` → 菜单注册）
3. 对比 `vite.web.config.ts` 与默认 `vite.config.ts` 的差异（runtime-stub / BASE_URL / externalize 差异）

## 教训

1. 「起得来」≠「跑得起来」：健康检查通过只证明静态资源可服务，用例失败说明运行时崩溃——排障第二阶段要看 JS 执行栈而非网络层。
2. 修复「起不来」类问题后，应立即复跑完整用例确认是否暴露下一层问题（本 bug 即 4174 修复后的连锁暴露）。
