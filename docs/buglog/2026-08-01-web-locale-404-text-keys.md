# 网页版界面文本全变 key 字符串（locales/*.json 404）

> **状态**: 🟢 已修复

**日期**: 2026-08-01
**严重程度**: 🟠 P2
**影响范围**: `.github/workflows/web-pages.yml`
**发现方式**: 用户反馈
**修复提交**: 待填

---

## 问题描述

GitHub Pages 网页版打开后，界面文本全部显示为翻译 key（如 `settings.appearance`），
Network 面板可见 `locales/zh-CN.json` 请求 404。

## 复现步骤

1. 访问 https://eghrhegpe.github.io/MikuMikuAR/
2. 观察界面所有文本均为 key 字符串
3. DevTools → Network 可见 `zh-CN.json 404`、`en.json 404` 等

## 根因分析

语言包 JSON 是**构建产物**：由 `scripts/generate-locale-json.mjs` 从
`frontend/src/core/i18n/locales/*.ts` 编译输出到 `frontend/public/locales/`，
该目录被 `.gitignore` 排除（第 17 行），不入库。

`npm run build`（本地桌面端构建）会在 `tsc && vite build` 前先跑该脚本
（见 frontend/package.json）。但 `web-pages.yml` 的 CI 直接用
`npx vite build --config vite.web.config.ts`，**跳过了生成脚本**。

CI 环境 checkout 后 `public/locales/` 为空 → `dist-web` 产物缺语言包 →
GitHub Pages 上请求 `locales/zh-CN.json` 404 → `loadLocale` 捕获后置
`bundles[lang] = {}` → `t()` 回退链全空，只能返回 key 本身 → 界面文本挂死。

## 修复方案

`web-pages.yml` 在构建步骤前新增 `Generate locale JSON` 步骤，
执行 `node ../scripts/generate-locale-json.mjs`（working-directory=frontend），
与本地 `npm run build` 保持同一构建管线。

## 教训

1. CI 里手写 `npx vite build` 而不用 `npm run build`，容易丢掉 package.json
   scripts 里串联的预构建步骤（此处是 locale 生成）。
2. 构建产物目录被 gitignore 时，CI 必须显式补一次生成，不能假设仓库里有文件。
3. 界面文本全是 key 时，优先查 `t()` 回退链与语言包 fetch 是否 404，
   而不是怀疑翻译文件本身。
