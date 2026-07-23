# ADR-033: config.ts 四向分裂 + tryCatchStatus 泛化 + slideRow 收束

> **日期**: 2026-07-05
> **状态**: 已完成 — config.ts 分裂、tryCatchStatus 替换 13 处、slideRow 替换 5 处，tsc + vite build 通过

---

## 背景

`frontend/src/core/config.ts` 在持续半年多的迭代中累积了 879 行代码，身兼 7 种职责：类型定义、全局状态、DOM 元素引用、UI 辅助工具、工具函数、文件路径处理。被 37 个源文件直接 import，成为项目耦合度最高的单一模块（耦合评分 8/10）。

同时，代码中存在大量重复模式：
1. **try/catch + setStatus 模板代码** — ~30 处横跨 16 个文件的相同结构（catch + err instanceof Error + setStatus）
2. **手动 slide-item DOM 重建** — 59 处跨 16 文件的 `document.createElement('div'); className = 'slide-item'; ...` 模式，而 `slideRow()` 已在 ui-helpers.ts 封装

## 决策

### 1. config.ts → types.ts / state.ts / dom.ts / utils.ts 四大模块

| 新文件 | 职责 | 约行数 |
|--------|------|--------|
| `core/types.ts` | 所有 type/interface 定义 | ~180 |
| `core/state.ts` | 全局可变状态 + setter | ~200 |
| `core/dom.ts` | DOM 元素引用（dom.canvas 等） | ~30 |
| `core/utils.ts` | 工具函数（setStatus/formatError/etc.） | ~290 |

`config.ts` 改为 barrel re-export 文件：

```typescript
export * from './types';
export { ... } from './state';
export * from './dom';
export { ... } from './utils';
```

**依赖图**（无循环依赖）：
```
types.ts → (babylon types, Mesh, Texture, ClothConfig)
state.ts → types.ts, reactivity.ts, DEFAULT_CLOTH_CONFIG
utils.ts → types.ts, dom.ts, state.ts, fileservice.ts (type-only)
dom.ts   → (无 dependency)
```

**零侵入原则**：所有现有 import `from '../core/config'` 无需改动，config.ts 的 barrel re-export 保持接口完全一致。

### 2. tryCatchStatus 泛化

```typescript
export async function tryCatchStatus<T>(
    fn: () => T | Promise<T>,
    context: string
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
        setStatus(`${context}: ${msg}`, false);
        console.warn(`[${context}]`, err);
        return undefined;
    }
}
```

替换前：
```typescript
try {
    await SaveModelPreset(json, path);
    setStatus('✓ 预设已保存', true);
} catch (err: unknown) {
    setStatus('✗ 保存失败: ' + (err instanceof Error ? err.message : String(err)), false);
}
```

替换后：
```typescript
const r = await tryCatchStatus(() => SaveModelPreset(json, path), '✗ 保存失败');
if (r !== undefined) {
    setStatus('✓ 预设已保存', true);
}
```

**替换量**：13 处跨 4 文件（model-preset.ts ×6, model-detail.ts ×2, outfit-ui.ts ×3, settings.ts ×2）。

**模板代码消除收益**：
- 移除重复的 `err instanceof Error ? err.message : String(err)` 模式
- 标准化错误日志（统一 `console.warn('[context]', err)`）
- 单一错误处理路径，便于未来统一修改（如上报、国际化）

### 3. slideRow 收束

自 `ui-helpers.ts` 定义 `slideRow()` 以来，手动 `className = 'slide-item'` 的 DOM 构建逐步向它迁移。本次收束 5 处剩余手动模式，重点替换带 sublabel/arrow 参数的行。

**替换量**：5 处跨 4 文件（model-detail.ts ×1, env-feature-levels.ts ×2, motion-popup.ts ×1, library-core.ts ×1）。

**收益**：
- 消除 DOM 创建样板代码（~15 行 → 1 行调用）
- 统一 icon/标签/箭头样式（CSS 变量只需在 slideRow 内维护一处）
- 所有 target 文件已 import `slideRow`，零 import 改动

### 4. 不做的事（明确不 scope）

- **不拆更细**：`utils.ts` 仍含多种职责（`setStatus` + `formatError` + `computeLibraryRef` + `normPath`），但短期内提取不经济，保留到 400+ 行再评估。
- **不替换所有 slide-item**：59 处中大量含自定义 toggle、delete btn、inline style 等非标准内容，slideRow 不支持。只替换与 slideRow 签名精确匹配的简单行。
- **不改 try/catch 中带复杂逻辑的块**：含 re-throw、early return、多分支的 catch 块保持原样。

## 影响

- **耦合度**：config.ts 7 职责 → 4+1 文件，被 import 密度降低 4 倍。新模块可以独立演化。
- **模板代码**：~43 处重复模式合并为集中调用，新增全局 `tryCatchStatus` 模式供未来使用。
- **构建时间**：零影响。barrel import 在 Vite tree-shaking 下与内联 import 等价。
- **调试**：所有 `tryCatchStatus` 错误自带 `console.warn('[context]', err)`，定位问题更易。
- **迁移风险**：config.ts barrel re-export 保持引用兼容，无需修改任何现有 import 语句。

