# ADR-173: UI 行控件公共化第三轮 + 命名去 `_` 前缀

> **状态**: 已完成（2026-07-24 执行）

## 背景

代码审计第二轮（2026-07-24）发现两类问题：

1. **UI 重复**：两处面板各有内联骨骼选择 DOM（select + 搜索过滤），camera-levels 用 `addModeRow` 铺满上百按钮，体验差；4 处手写 `toggle.header-toggle`（label+checkbox+span）重复。
2. **命名混乱**：4 个 public 导出函数带 `_` 前缀（`_buildLevel`/`_openTexturePicker`/`_syncOverrideToInstance`/`_computeOverride`），破坏命名一致性，调用方看起来像私有函数。

## 决策

### 1. 骨骼选择行公共组件

新建 `addBoneSelectRow(container, label, boneNames, currentName, onChange, opts?)` → `ui-rows.ts`，统一两处入口：

| 旧实现 | 新实现 |
|--------|--------|
| `motion-camera-levels.ts`：`addModeRow` 铺按钮（上百骨骼） | `addBoneSelectRow` 分组下拉 + 搜索 + IK 标记 |
| `motion-override-levels.ts`：40 行内联 select+search+IK 标记 | 一行 `addBoneSelectRow` |

同时从 `motion-override-levels.ts` 删除内联重复：
- 私有 `IK_BONE_NAMES` / `_isIkBone` / `_buildBoneOptions` → 提升为公共 `isIkBone` / `buildBoneGroups` → `ui-rows.ts`

相关工具函数：

```ts
// 判定骨骼是否为 IK 相关
export function isIkBone(boneName: string): boolean

// 按 MMD 标准将骨骼数组分组
export function buildBoneGroups(bones: readonly string[]): [string, string[]][]
```

### 2. 标题栏开关公共组件

新建 `createHeaderToggle(config: HeaderToggleConfig)` → `ui-rows.ts`，统一 4 处 `toggle.header-toggle` 构造：

| 调用方 | 替换前 | 替换后 |
|--------|--------|--------|
| `menu.ts` 弹窗标题开关 | ~18 行内联 DOM | `createHeaderToggle({ value, onChange, bind })` |
| `ui-collapsible.ts` 折叠面板开关 | ~24 行内联 DOM + bind | 同上 |
| `ui-slide-row.ts` 行内开关 | ~45 行内联 DOM + bind + disabled | 同上 |
| `model-material.ts` 材质行开关 | ~30 行内联 DOM + 双触发修复 | 同上 |

公共 `HeaderToggleConfig` 接口：

```ts
export interface HeaderToggleConfig {
    value: boolean
    onChange: (v: boolean) => void
    bind?: () => boolean          // 自更新
    disabled?: boolean
    onDisabledClick?: () => void
    disabledHint?: string
}
```

核心修复：统一 `<label>` 包裹 checkbox 时的**双触发去重**（跳过 `target===input` synthetic click + `preventDefault` 阻止原生切换）。

### 3. CSS 类补全（修复悬空类名 + 颜色硬编码）

| 类名 | 状态 | 说明 |
|------|------|------|
| `.cs-hint` | **新增** | `font-size:11px; color:var(--text-dim); line-height:1.5`；修复 11 处悬空引用 |
| `.bone-select-row` | **新增** | addBoneSelectRow wrapper，含 `.cs-label-sm` / `.full-input` / `select` 子规则 |
| `.card-title-bar` | **新增** | `display:flex; align-items:center; justify-content:space-between; padding:8px 14px 4px` |
| `.card-title-text` | **新增** | `font-size:12px; color:var(--text); font-weight:600` |
| `.conflict-banner` | **新增** | `padding:2px 14px 8px; font-size:11px; line-height:1.5` |
| `.btn-group` | 已有但未推广 | `display:flex; gap:4px; padding:4px 14px 8px`（仅 motion-pose-levels 使用）|

内联 style → 类替换：

| 位置 | 旧内联 | 新类 |
|------|--------|------|
| motion-override-levels:577/687 | `font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600` | `.card-title` |
| motion-override-levels:81/219 | titleBar flex 行 + titleText | `.card-title-bar` + `.card-title-text` |
| motion-override-levels:421 / motion-gaze-levels:501 | conflict banner 内联 | `.conflict-banner` |

颜色 fallback 修复（fallback 值与 `:root` 变量不一致）：
- `var(--danger,#e05050)` → `var(--danger)`（motion-override-levels:178）
- `var(--warn,#e0a030)` → `var(--warn)`（motion-override-levels:478、motion-gaze-levels:456、render-menu.ts:166）

### 4. `_isWasmRuntime` 去重

`bone-override.ts` 内的本地 `_isWasmRuntime`（与 `perception-shared.ts` 导出版完全重复）已删除，改为 import 共享实现。共享版改名 `isWasmRuntime`，保留 `_isWasmRuntime` 别名兼容感知层既有引用。

### 5. 命名去 `_` 前缀（4 个 public 函数）

| 原名 | 新名 | 调用方数 |
|------|------|----------|
| `_buildLevel` | `buildLevel` | 10（所有 env-*-levels.ts + scene-drag-levels.ts） |
| `_openTexturePicker` | `openTexturePicker` | 3（env-menu.ts、env-sky-levels.ts、env-ground-levels.ts） |
| `_syncOverrideToInstance` | `syncOverrideToInstance` | 1（motion-override-levels.ts 内部） |
| `_computeOverride` | `computeOverride` | 1（内部）+ 14（测试文件） |

## 结果

- 新增公共组件：`addBoneSelectRow`、`createHeaderToggle`、`isIkBone`、`buildBoneGroups`
- 消除 ~150 行重复 DOM 构造代码
- 修复 2 个真 bug（`.cs-hint` / `.bone-select-row` 悬空无 CSS 定义）
- 消除 4 处颜色 fallback 不一致
- 4 个 public API 命名规范

## 相关文件

| 文件 | 改动 |
|------|------|
| `frontend/src/core/ui-rows.ts` | 新增 `createHeaderToggle` + `addBoneSelectRow` + `isIkBone` + `buildBoneGroups` |
| `frontend/src/core/ui-helpers.ts` | barrel re-export 新增符号 |
| `frontend/src/core/ui-collapsible.ts` | 使用 `createHeaderToggle` |
| `frontend/src/core/ui-slide-row.ts` | 使用 `createHeaderToggle`，删除本地 `HeaderToggleConfig` |
| `frontend/src/menus/menu.ts` | 使用 `createHeaderToggle` |
| `frontend/src/menus/model-material.ts` | 使用 `createHeaderToggle` |
| `frontend/src/menus/motion-camera-levels.ts` | `addModeRow` → `addBoneSelectRow` |
| `frontend/src/menus/motion-override-levels.ts` | 内联 select → `addBoneSelectRow`；删除 `_isIkBone`/`_buildBoneOptions`/`IK_BONE_NAMES`；标题→类；conflict-banner→类 |
| `frontend/src/menus/scene-prop-levels.ts` | 标题→类 |
| `frontend/src/menus/env-level-helpers.ts` | 命名去 `_` 前缀 |
| `frontend/src/menus/env-*.ts`（9 个） | 更新 `buildLevel`/`openTexturePicker` 调用 |
| `frontend/src/scene/motion/perception-shared.ts` | `isWasmRuntime` 重命名，保留 `_isWasmRuntime` 别名 |
| `frontend/src/scene/motion/bone-override.ts` | 删除本地 `_isWasmRuntime`；命名去 `_` |
| `frontend/src/app.css` | 新增 5 个 CSS 类 |
| `frontend/src/__tests__/ui-helpers.test.ts` | 新增 `isIkBone`/`buildBoneGroups`/`addBoneSelectRow` 测试（+7 测试） |
| `frontend/src/__tests__/env-feature-levels.contract.test.ts` | 更新命名测试 |
| `frontend/src/__tests__/scene/bone-override.test.ts` | 更新命名测试 |

## 未纳入项（经评估后放弃）

- **`addModelBoneSelectPair`**：resource-detail-helpers 与 scene-stage-lights 的 model+bone select 联动，业务逻辑差异大（filter、placeholder、change 回调），强抽 API 膨胀。
- **`.btn-group` 推广至 motion-override btnGroup**：现有 `.btn-group` 含 `padding:4px 14px 8px`，与 titleBar 内 btnGroup 布局冲突（会撑出多余高度），保留 inline style 更安全。
- **`addSimpleBoneSelectRow`**：model-detail 的单骨骼 select（18 行），cssText 与 `.setting-select` 差异大，无跨文件重复，不值得抽取。