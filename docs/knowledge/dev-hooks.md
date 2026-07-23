---
kind: dev_hooks
name: 开发环境 E2E 钩子
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/dev-hooks.ts
adr:
  - ADR-102
---

## 系统概览
DEV 仅有的 E2E capture + scene inspection 钩子，从 `main.ts` 拆分而来。在 `window` 上挂载 `__capture` 截图函数与 `__scene` 检查对象，供 Playwright 数值断言使用，避免脆弱的像素截图对比。生产构建下默认不注入（设 `VITE_E2E_MODE=true` 后可编入）。

## 核心职责
- `dev-hooks.ts` — E2E 截图捕获、场景状态检查、换装驱动、测试网格创建。

## 对外 API（节选）
- `setupE2ECapture()` — 挂载 `window.__capture` 与 `window.__scene`。

## `__scene` 属性
- `fps` — 当前帧率。
- `meshCount` — 场景网格数（含系统网格，断言阈值而非精确值）。
- `currentAnimation` — 当前聚焦模型的动画名。
- `outfitVariants()` — 获取换装变体列表。
- `applyOutfit(variantName)` — 应用换装变体（驱动真实路径）。
- `fingerprint()` — 16x16 亮度指纹（稳化的画面变化检测）。
- `capture()` — 截图 base64 data URL。
- `createTestMesh()` — 创建程序化红色立方体（CI 测试用，无需 PMX 文件）。
- `clearTestMeshes()` — 清理 e2e 测试网格。

## 与其他子系统关系
- 依赖 `scene/scene` 获取场景/引擎/聚焦模型引用。
- 依赖 `outfit/outfit` 的 `loadOutfits` / `applyOutfitVariant` 驱动换装。