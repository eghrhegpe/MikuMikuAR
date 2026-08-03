---
kind: core_leaf_modules
name: 核心零依赖叶模块
tier: leaf
category: core
scope:
  - frontend/src/core/async.ts
  - frontend/src/core/clamp.ts
  - frontend/src/core/debounce.ts
  - frontend/src/core/deep-clone.ts
  - frontend/src/core/format-timestamp.ts
  - frontend/src/core/path.ts
  - frontend/src/core/set-key.ts
source_files:
  - frontend/src/core/async.ts
  - frontend/src/core/clamp.ts
  - frontend/src/core/debounce.ts
  - frontend/src/core/deep-clone.ts
  - frontend/src/core/format-timestamp.ts
  - frontend/src/core/path.ts
  - frontend/src/core/set-key.ts
adr:
  - ADR-191
  - ADR-190
symbols:
  - Abortable
  - DebouncedTimer
  - LoadingGuard
  - clamp
  - clamp01
  - clampInt
  - clampPct
  - computeLibraryRef
  - debounce
  - deepClone
  - delay
  - fireAndForget
  - formatTimestamp
  - getBaseName
  - getDirPath
  - isStageLike
  - isUnderRoot
  - lerp
  - lerpArray
  - makeLazyLoader
  - normPath
  - setKey
  - swallowError
  - waitForFrame
invariants:
  - 所有模块不引入 dom/state/fileservice/status-bar/i18n/feedback/menus 等应用层；async.ts 仅依赖同属叶层的 logger
  - 从这些模块导入不会拖起应用层，避免 vitest fork worker 挂死（ADR-191）
  - normPath 有缓存机制，缓存上限 5000 条目
  - 禁止从 @/core/utils 神桶导入这些模块——纯模块应直接引用本叶
tests:
  - 分散在各模块对应测试文件中
use_when:
  - 纯工具函数
  - 零依赖叶
  - 路径工具
  - 数学工具
  - 异步工具
  - 防抖
  - 深拷贝
  - 时间戳格式化
  - ADR-191
---

# 核心零依赖叶模块

## 系统概览

核心零依赖叶模块聚合。这些模块遵循「零依赖叶」纪律（ADR-191），不引入任何应用层（dom/state/fileservice/status-bar/i18n 等），可安全被纯几何/物理模块引用而不会拖起整套应用层。AGENTS.md 明确禁止从 `@/core/utils` 神桶导入，要求直接引用本叶。

## 核心职责

### 异步工具（`async.ts`）
- `swallowError(promise)` — 吞掉 promise 异常并记录日志，比空 `.catch(() => {})` 可调试
- `fireAndForget(fn)` — 启动异步操作但不等待，异常由 swallowError 兜底
- `delay(ms)` — Promise 包装的延迟
- `waitForFrame()` — Promise 包装的等待下一帧
- `LoadingGuard` — 并发加载守卫，支持 Set 模式（多 key 去重）和 Boolean 模式（单实例锁定）
- `DebouncedTimer` — 防抖定时器，封装 setTimeout 的 schedule/cancel 样板
- `Abortable` — 可复用的 AbortController 封装，abort 后自动重置

### 数学工具（`clamp.ts`）
- `clamp(v, lo, hi)` — 数值钳制
- `clamp01(v)` — 钳制到 [0, 1]
- `clampInt(v, lo, hi)` — 整数钳制
- `lerp(a, b, t)` — 线性插值
- `lerpArray(a, b, t)` — 逐元素线性插值数组
- `clampPct(v)` — 百分比钳制到 [0, 100]

### 函数防抖（`debounce.ts`）
- `debounce(fn, ms)` — 函数防抖，返回带 `cancel()` 方法的防抖函数

### 深拷贝（`deep-clone.ts`）
- `deepClone(x)` — 基于 JSON 序列化的深拷贝（不支持函数/undefined/Symbol/RegExp）

### 时间戳格式化（`format-timestamp.ts`）
- `formatTimestamp(d?)` — 格式化日期为 `HH:MM:SS.mmm` 字符串

### 路径工具（`path.ts`）
- `normPath(p)` — 标准化路径（反斜杠→正斜杠、去尾斜杠、Android SAF 透传），带缓存
- `getBaseName(p)` — 跨平台取路径末段文件名
- `getDirPath(p)` — 跨平台取父目录路径
- `isUnderRoot(base, child)` — 路径归属判定，拒绝 `..` 逃逸段
- `isStageLike(kind)` — 判断是否为舞台类（缩略图使用 16:9 宽高比）

### 泛型工具（`set-key.ts`）
- `setKey(obj, key, value)` — 泛型键值写入，避免大量 `obj[key] = value` 重复

## 与其他子系统关系

- 被全项目纯模块引用，代替旧的 `@/core/utils` 神桶导入
- 这些模块的下沉解决了 vitest fork worker 挂死问题（ADR-191）

## 不变量

- 所有模块为零依赖叶，不引入 `dom/state/fileservice/status-bar/i18n/feedback/menus` 等应用层；`logger` 亦属叶层（零依赖），`async.ts` 可依赖它
- 从这些模块导入不会拖起应用层，纯模块可安全引用
- `normPath` 缓存上限 5000 条目，超限时清空
- 禁止从 `@/core/utils` 神桶间接导入——应直接引用本叶

## 验证入口

- 测试分散在各模块对应测试文件中
- 命令：`cd frontend && npm run test -- core/async.test.ts` 等