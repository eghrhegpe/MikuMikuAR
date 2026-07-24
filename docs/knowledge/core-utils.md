---
kind: core_utils
name: 工具函数库
category: core
scope:
  - frontend/src/core/utils.ts
source_files:
  - frontend/src/core/utils.ts
adr: []
symbols:
  - clamp01
  - debounce
  - getBaseName
  - normPath
  - isUnderRoot
  - withLoadingIndicator
  - formatTime
  - triggerAutoSave
invariants:
  - 纯函数工具，无状态依赖
  - 被 core/scene/menus 约 35 个模块引用
tests: []
use_when:
  - 工具函数
  - clamp
  - debounce
  - 文件名校验
  - 路径归一化
  - 时间格式
  - 加载指示器
  - 自动保存触发
---

## 系统概览
**通用工具函数库**。提供 clamp、debounce、路径处理、文件名校验、时间格式、加载指示器、
自动保存触发等跨模块共享的纯函数工具，被核心/场景/菜单三大目录广泛引用。

## 核心职责
- `utils.ts` — 纯函数工具集合，无状态依赖。

## 对外 API（节选）
- `clamp01(v)` — 将值限制在 [0, 1] 区间。
- `debounce(fn, ms)` — 防抖函数。
- `getBaseName(path)` — 从路径提取文件名（不含扩展名）。
- `normPath(path)` — 路径归一化（统一分隔符）。
- `isUnderRoot(path, root)` — 判断路径是否在根目录下。
- `withLoadingIndicator(asyncFn)` — 异步操作包装，带加载指示。
- `formatTime(seconds)` — 秒数 → "mm:ss" 格式。
- `triggerAutoSave()` — 触发自动保存。

## 与其他子系统关系
- 被约 35 个模块引用（core/scene/menus 全覆盖）。
- 通过 `config.ts` barrel re-export。

## 不变量
- 纯函数，无状态依赖，可单测。
- 不 import 任何场景/菜单模块，避免循环依赖。
