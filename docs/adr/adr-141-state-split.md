# ADR-141: state.ts 拆分 — 状态基座重构

- **状态**: 实施完成
- **日期**: 2026-07-19
- **相关**: ADR-137（EnvState 单一源 schema）、ADR-138（env-dispatcher 破循环）

## 背景与问题

`core/state.ts`（438 行）混合了运行时状态、库状态、缓存状态、UI 状态、播放状态、路径配置、偏好设置，违反单一职责，共有 **29 个导出符号**需要重新归类：

| 当前混杂的变量 | 职责 | 应归属 |
|---------------|------|--------|
| `modelRegistry`, `propRegistry`, `mmdRuntime`, `focusedModelId` | 场景运行时 | scene-state |
| `isPlaying`, `autoLoop`, `seekDragging` | 播放控制 | playback-state |
| `allModels`, `recentModels`, `thumbnailCache`, `expandedFolders`,
  `modelMetaCache`, `_recentMotions` | 资源库 | library-state |
| `uiState`, `activeTimeOfDayPreset`, `popupOpen` | UI 持久化 | ui-state |
| `libraryRoot`, `resourceRoot`, `overridePaths` | 资源库路径 | library-state |
| `displayNamePriority`, `librarySortMode` | UI 偏好 | library-state |
| `currentPort` | 运行时配置 | scene-state |
| `getMmdRuntimeType` / `setMmdRuntimeType` | 运行时配置 | scene-state |

问题：
1. 职责过载：任何模块都可能修改 state.ts 中的任意变量
2. "幽灵路径"：状态写入点分散，难以追踪
3. 测试困难：单测需 mock 整个 state.ts

## 决策

将 state.ts 拆分为 4 个独立 store + 前置解耦，每个 ≤120 行：

```
core/state.ts (438 行)
    │
    ▼ 拆分
    ├── core/scene-state.ts     ← modelRegistry, propRegistry, mmdRuntime, focusedModelId,
    │                              currentPort, getMmdRuntimeType/setMmdRuntimeType, createDefaultFeetState
    ├── core/playback-state.ts  ← isPlaying, autoLoop, seekDragging
    ├── core/library-state.ts   ← allModels, recentModels, thumbnailCache, expandedFolders,
    │                              modelMetaCache, recentMotions, libraryRoot, resourceRoot,
    │                              overridePaths, displayNamePriority, librarySortMode
    └── core/ui-state.ts        ← uiState（新建）, activeTimeOfDayPreset, popupOpen
```

`config.ts` barrel re-export 保持兼容，外部 import 路径零变化。

## 方案设计

### 1. 新文件结构

```typescript
// core/scene-state.ts
export const sceneState = {
    modelRegistry: new Map<string, ModelEntry>(),
    propRegistry: new Map<string, PropEntry>(),
    mmdRuntime: null as MmdRuntime | null,
    focusedModelId: null as string | null,
    currentPort: 0,
};
export function getMmdRuntimeType(): 'wasm' | 'js' { ... }
export function setMmdRuntimeType(v: 'wasm' | 'js'): void { ... }
export function createDefaultFeetState(): FeetState { ... }

// core/playback-state.ts
export const playbackState = {
    isPlaying: false,
    autoLoop: true,
    seekDragging: false,
    // cameraMode 移除（死代码，生产代码无调用方）
};

// core/library-state.ts
export const libraryState = {
    allModels: [] as LibraryModel[],
    recentModels: [] as string[],
    thumbnailCache: new Map<string, string>(),
    expandedFolders: new Set<string>(),
    modelMetaCache: new Map<string, { name_jp: string; name_en: string; comment: string }>(),
    libraryRoot: '',
    resourceRoot: '',
    overridePaths: {} as OverridePaths,
    displayNamePriority: 'filename' as DisplayNamePriority,
    librarySortMode: 'default' as LibrarySortMode,
};
// recentMotions 保留为模块级 private var + getter/add（序列化格式不变）

// core/ui-state.ts（新建）
export const uiState: UIState = {};
export let activeTimeOfDayPreset = 'noon';
export let popupOpen = false;
```

### 2. config.ts barrel 保持兼容

```typescript
// config.ts — 保持外部 import 路径不变
export { sceneState } from './scene-state';
export { playbackState } from './playback-state';
export { libraryState } from './library-state';
export { uiState } from './ui-state';
export { envState } from './env-state'; // 已有
```

### 3. 迁移策略

- 新建 4 文件，逐变量搬迁（保留 setter 签名不变）
- 每次搬迁后跑全量测试
- 最终 state.ts 仅保留 re-export + envState（≤80 行）

## 影响面

- **代码**: `core/state.ts`、`core/scene-state.ts`（新建）、`core/playback-state.ts`（新建）、`core/library-state.ts`（新建）、`core/ui-state.ts`（新建）、`core/logger.ts`（新建，见阶段 0）
- **行为**: 无行为变化；`setCameraMode`、`setCurrentPort`、`setExpandedFolders` 标记 `@deprecated` 后移除
- **测试**: 各 store 独立单测；新增跨 store barrel 连通性测试

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| import 路径遗漏 | 🟠 中 | barrel re-export 保持兼容，IDE 全局搜索验证 |
| 变量搬迁后引用丢失 | 🟡 中 | 每次搬迁后跑全量测试 |
| 循环依赖（state ↔ utils） | 🟡 中 | **阶段 0** 提取 `logWarn` 到 `logger.ts`，解除后再拆分 |
| `thumbnailCache.setThumbnailCache` 耦合 UI | 🟢 低 | 用 `onThumbnailUpdate` 回调注册（与 `setUIPersistCallback` 模式一致）替代动态 import |
| `expandedFolders` Set 序列化 | 🟢 低 | 搬迁后明确持久化合约：存 JSON `string[]`，加载时 `new Set()` |

## 分阶段实施

- **阶段 0（本 ADR + 前置解耦）**:
  - 确定完整变量归属清单（29 个导出符号）
  - 提取 `logWarn` → `core/logger.ts`，解除 `state ↔ utils` 循环依赖
  - 标记 `setCameraMode`、`setCurrentPort`、`setExpandedFolders` 为 `@deprecated` 后移除
  - 将 `setThumbnailCache` 中的动态 `import('./ui-resource-panel')` 替换为回调注册
- **阶段 1**: 新建 scene-state.ts + 迁移场景运行时变量
- **阶段 2**: 新建 playback-state.ts + 迁移播放控制变量
- **阶段 3**: 新建 library-state.ts + 迁移资源库变量（含路径/偏好/缓存）
- **阶段 4**: 新建 ui-state.ts + 迁移 UI 状态变量
- **阶段 5**: 精简 state.ts 为 barrel + 全量测试

## 验收标准

- `core/state.ts` 精简为 barrel：仅 `export *` 重导出 4 个 store + 保留 `envState`（约 159 行，其中 schema 派生构造器 `buildDefaultEnvState` 占约 130 行，属 ADR-137 单一源，不计入 store 行数预算）
- 4 个新 store 文件各 ≤120 行（实测：scene-state 76 / playback-state 23 / library-state 120 / ui-state 36）
- `npm run test` 全绿
- 外部 import 路径零变化（`from '@/core/config'` 仍可用）
- `import { logWarn } from '@/core/logger'` 迁移完成，`utils.ts` 不再依赖 `state.ts`
- `setCameraMode`、`setCurrentPort`、`setExpandedFolders` 从代码库中完全移除
