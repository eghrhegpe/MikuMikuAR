---
kind: core_utils
name: 工具函数叶模块群
tier: leaf
category: core
scope:
  - frontend/src/core/format.ts
  - frontend/src/core/math-geometry.ts
  - frontend/src/core/collections.ts
  - frontend/src/core/escape-html.ts
  - frontend/src/core/json-stringify.ts
  - frontend/src/core/auto-save.ts
  - frontend/src/core/ui-card.ts
  - frontend/src/core/ui-loading.ts
  - frontend/src/core/status-helpers.ts
  - frontend/src/core/uuid.ts
  - frontend/src/core/image.ts
  - frontend/src/library/library-path.ts
source_files:
  - frontend/src/core/format.ts
  - frontend/src/core/math-geometry.ts
  - frontend/src/core/collections.ts
  - frontend/src/core/escape-html.ts
  - frontend/src/core/json-stringify.ts
  - frontend/src/core/auto-save.ts
  - frontend/src/core/ui-card.ts
  - frontend/src/core/ui-loading.ts
  - frontend/src/core/status-helpers.ts
  - frontend/src/core/uuid.ts
  - frontend/src/core/image.ts
  - frontend/src/library/library-path.ts
adr:
  - adr-191-god-barrel-debarreling
symbols:
  - formatTime
  - formatError
  - dist2d
  - dist3d
  - degToRad
  - radToDeg
  - ensureArray
  - filterKeys
  - Cache
  - allSettledFilter
  - escapeHtml
  - jsonStringify
  - jsonParse
  - setTriggerAutoSave
  - triggerAutoSave
  - cardContainer
  - withLoadingIndicator
  - tryCatchStatus
  - generateUuid
  - canvasToBase64
  - computeLibraryRef
  - resolveLibraryRef
  - CATEGORY_DIR
invariants:
  - 零依赖叶模块只 import 自身或同类叶模块
  - 应用层叶模块（ui-card/ui-loading/status-helpers/auto-save）可依赖 core/dom/i18n 等应用层，但不反向依赖场景/菜单
  - 通过 @/core/config barrel 聚合导出，保持现有消费方兼容
tests:
  - browse-dir.test.ts
  - library-core.*.test.ts
  - scene-serialize-undo.test.ts
use_when:
  - 文本格式化
  - 数学/几何计算
  - 集合与 Promise 工具
  - HTML 转义
  - JSON 安全序列化
  - 自动保存触发
  - UI 卡片容器
  - 加载指示器
  - 状态栏包装
  - UUID 生成
  - 图书馆路径引用/解析
---

## 系统概览
**原 `@/core/utils` 神桶已被拆分为多个具体叶模块**。ADR-191 去桶化后，每个工具函数按职责归入零依赖或应用层叶模块，避免整桶 ESM 求值拉起整套应用层依赖链导致的 vitest worker 挂死问题。

## 核心职责
| 模块 | 职责 | 依赖级别 |
|------|------|----------|
| `format.ts` | `formatTime`、`formatError` 文本格式化 | 零依赖 |
| `math-geometry.ts` | `dist2d`/`dist3d`/`degToRad`/`radToDeg` 纯数学 | 零依赖 |
| `collections.ts` | `ensureArray`、`filterKeys`、`Cache`、`allSettledFilter` | 零依赖 |
| `escape-html.ts` | `escapeHtml` HTML 转义 | 零依赖 |
| `json-stringify.ts` | `jsonStringify`、`jsonParse` 安全 JSON | 零依赖 |
| `uuid.ts` | `generateUuid` UUID v4 | 零依赖 |
| `image.ts` | `canvasToBase64` Canvas 编码 | 零依赖（仅 HTMLCanvasElement） |
| `auto-save.ts` | `setTriggerAutoSave`/`triggerAutoSave` | 应用层叶（不依赖具体保存实现） |
| `ui-card.ts` | `cardContainer` UI 卡片容器 | 应用层叶（依赖 dom） |
| `ui-loading.ts` | `withLoadingIndicator` 加载指示器 | 应用层叶（依赖 dom/i18n） |
| `status-helpers.ts` | `tryCatchStatus` 状态栏错误包装 | 应用层叶（依赖 status-bar） |
| `library/library-path.ts` | `computeLibraryRef`/`resolveLibraryRef`/`CATEGORY_DIR`/`getBrowseDir` | 应用层叶（依赖 libraryRoot） |

## 对外 API（节选）
- `formatTime(seconds)` — 秒数 → "mm:ss.cs" 格式。
- `formatError(err, maxLen)` — 错误对象 → 简短可读字符串。
- `escapeHtml(s)` — HTML 特殊字符转义。
- `jsonStringify(x)` / `jsonParse<T>(s)` — 安全 JSON，异常时返回 null。
- `triggerAutoSave()` — 触发自动保存。
- `withLoadingIndicator(key, fn)` — 带加载提示的异步包装。
- `computeLibraryRef(filePath)` — 计算模型在库中的相对引用。

## 与其他子系统关系
- `core/config.ts` 作为 barrel 聚合导出部分叶模块，供仍通过 `@/core/config` 消费的代码兼容使用。
- `menus/` 直接引用 `library/library-path.ts`、`core/auto-save.ts`、`core/ui-loading.ts` 等具体叶模块。
- `scene/` 直接引用 `core/async.ts`、`core/auto-save.ts`、`core/format.ts`、`core/uuid.ts`、`core/image.ts` 等。

## 不变量
- 零依赖叶模块禁止 import 应用层/场景层/菜单层模块。
- 应用层叶模块允许依赖 `core/dom`、`core/i18n`、`core/status-bar` 等通用基础设施，但禁止反向依赖 `scene/*` 或 `menus/*`。
- 所有叶模块均可独立单元测试，不会触发整桶依赖求值。
