# UI 重复率审核报告

> **审核日期**: 2026-07-05
> **范围**: `frontend/src/menus/` + `frontend/src/core/ui-*.ts` + `frontend/src/app.css`
> **方法**: 静态分析（className 赋值统计 + 类名引用频次 + inline style 检测）

---

## 一、总体数据

| 指标 | 数值 | 说明 |
|------|------|------|
| 菜单文件数 | 23 个 | `src/menus/*.ts` |
| `className` 赋值行 | **145 行** | 散落于各菜单文件 |
| inline style 行 | **31 行** | `style="..."` 或 `style.cssText =` |
| CSS 类名总数 | ~110 个 | `app.css` 中定义的类 |
| TS 引用 className 的文件 | **32 个** | 含 core/ 测试等 |
| 核心组件封装文件 | 5 个 | `ui-slide-row.ts` `ui-rows.ts` `ui-advanced-rows.ts` `ui-collapsible.ts` |

---

## 二、核心组件复用率

### 2.1 已封装组件（通过 ui-helpers.ts 暴露）

| 组件 | 暴露函数 | CSS 类 | 复用情况 |
|------|----------|--------|----------|
| **slideRow** | `slideRow()` | `.slide-item` `.slide-icon` `.slide-label` 等 | ✅ 高复用（所有菜单） |
| **csRow 系列** | `addSliderRow()` `addColorSliderRow()` `addModeSlider()` | `.cs-row` `.cs-bar` `.cs-fill` | ✅ 高复用（5+ 菜单） |
| **toggleRow** | `addToggleRow()` | `.toggle-row` `.toggle` `.toggle-label` | ✅ 中等复用 |
| **collapsible** | `addCollapsible()` | `.collapsible-header` `.collapsible-panel` 等 | ✅ 中等复用 |
| **presetChip** | `addPresetChip()` | `.preset-chip` `.preset-group` | ✅ 高复用（7 个文件） |
| **sectionTitle** | `addSectionTitle()` | `.section-title` | 低 |

### 2.2 未封装 / 重复逻辑

| 模式 | 发现位置 | 重复次数 | 问题等级 |
|------|----------|----------|----------|
| **手动创建 `.slide-item`** | `model-detail.ts` `settings.ts` `settings-software.ts` 等 | 10+ | 🔴 高 |
| **inline style（flex/right 等基础样式）** | 多个菜单 | 31 行 | 🟡 中 |
| **`.btn-sm` 独立拼接** | `model-material.ts` `settings.ts` 等 | 8 次 | 🟡 中 |
| **Danger 文字行（红字+icon）** | `settings.ts` `model-detail.ts` `settings-software.ts` | 3 文件 | 🟡 中 |
| **Tag 列表（chips + input + add btn）** | `model-detail.ts` `settings.ts` | 2 文件 | 🟢 低 |
| **Empty state 占位** | `library-core.ts` `motion-popup.ts` 等 | 4+ | 🟢 low |
| **LCard / cardContainer** | 全局 | 统一封装 | ✅ 好 |
| **Tag 容器 + chips** | `model-detail.ts` `settings.ts` | 2 处 | 🟢 低 |

---

## 三、高重复代码模式（Top 10）

### 🔴 #1 — `.slide-item` 手动创建（最严重）

```typescript
// 模式代码（出现在 settings.ts / model-detail.ts / library-core.ts 等）
const row = document.createElement('div');
row.className = 'slide-itemSticky' + (isActive ? ' slide-focused' : '');
// 然后手动 innerHTML 注入 icon + label + sublabel + tag + arrow + actionBtn
```

**替代方案**：已有 `slideRow()` 封装，支持 `icon, label, hasArrow, onClick, sublabel, tag, focused`。应使用封装而非手动创建。

**涉及文件**：`settings.ts`(5 处) `model-detail.ts`(4 处) `library-core.ts`(2 处) `motion-popup.ts`(3 处)

### 🟡 #2 — inline style 基础布局

```typescript
// 反复出现的模式
style="flex:0 0 auto;margin-right:6px;"
style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;"
style="color:var(--text-dim);flex:none;"
```

**替代方案**：提取为 `--slide-meta-label` `--slide-value-right` 等 CSS 类。

### 🟡 #3 — 危险/删除行

```typescript
// 模式（settings.ts / model-detail.ts / settings-software.ts / scene-stage-levels.ts）
const delRow = document.createElement('div');
delRow.className = 'slide-item';
delRow.innerHTML = `<span class="slide-icon">...</span><span class="slide-label danger-text">删除 XXX</span>`;
```

**替代方案**：`slideRow()` 增加 `variant: 'danger'` 参数，自动添加 `danger-text`。

### 🟡 #4 — Mode 按钮组

```typescript
// 模式（env-feature-levels.ts / motion-camera-levels.ts / model-preset.ts）
const chipGroup = document.createElement('div');
chipGroup.className = 'preset-group';
const btn = document.createElement('button');
btn.className = 'preset-chip' + (active ? ' active' : '');
```

**现状**：`addPresetChip()` 已封装。但部分地方仍手动创建（如 `model-preset.ts` 中的 undoBtn）。

### 🟡 #5 — `.btn-sm` / `.btn-primary` 重复拼接

```typescript
// 模式
btn.className = 'btn btn-sm btn-primary';  // 或 btn-ghost, btn-danger
```

**涉及**：`settings.ts`(3) `model-detail.ts`(2) `model-material.ts`(2) 等

---

## 四、文件级重复率排名

按 `className` 赋值行数（越多越需要关注）：

| 排名 | 文件 | className 行 | inline style | 重复模式 |
|------|------|-------------|--------------|----------|
| 1 | `settings.ts` | 19 | 12 行 | `.slide-item` 手动、tag chips、btn 拼接 |
| 2 | `model-detail.ts` | 19 | 6 行 | `.slide-item` 手动、morph 行、tag chips |
| 3 | `menu.ts` | 15 | 0 | 框架代码，合理 |
| 4 | `motion-popup.ts` | 12 | 0 | `.slide-item` 手动、empty state |
| 5 | `env-feature-levels.ts` | 9 | 1 行 | warning block、slider |
| 6 | `library-core.ts` | 9 | 5 行 | empty state、inline style |
| 7 | `outfit-ui.ts` | 7 | 0 | slide-item 手动 |
| 8 | `scene-stage-lights.ts` | 7 | 0 | chip group 手动 |
| 9 | `env-preset-levels.ts` | 6 | 0 | chip group 手动 |
| 10 | `model-preset.ts` | 6 | 0 | mode btn 手动 |

---

## 五、建议改进

### 立即处理（高 ROI）

1. **扩展 `slideRow()` 参数**
   - 新增 `variant?: 'default' | 'danger' | 'focused'`
   - 支持 `actionIcon?: string` + `onActionClick?: () => void`（右侧按钮）
   - 这样 `settings.ts` 和 `model-detail.ts` 中 80% 的手动 `.slide-item` 可删除

2. **创建通用卡片组件**
   ```typescript
   // 统一 Tag 容器
   export function addTagChipGroup(container, tags, onAdd, onDelete): void
   // 统一 Danger 删除行
   export function addDangerRow(container, icon, label, onClick): void
   ```

### 中期处理

3. **消除 inline style**
   - 将反复出现的 `style="..."` 提取为 CSS 类（如 `.flex-right-overflow` `.text-dim`）
   - 目标：从 31 行 → < 10 行

4 **建立 Button 枚举**（代码级）
   ```typescript
   // 替代拼接
   className: Btn.primary + ' ' + Btn.sm   // 或 Btn.ghost_sm
   ```

4. **长期**
   - 考虑将 `renderCustom` 中的 DOM 构建改为函数式组合（类似 React 的 createElement 辅助函数），进一步减少样板代码
   - 引入 lint 规则禁止直接设置 `.slide-item` / `.cs-row` / `.preset-chip` 等已封装类的 `className`

---

## 六、结论

| 维度 | 评估 |
|------|------|
| **CSS 复用** | ✅ 良好。`app.css` 的 BEM 命名规范，组件级变量体系完善 |
| **TS 封装** | 🟡 部分良好。`ui-*.ts` 已封装约 60% 常见模式 |
| **实际复用** | 🔴 **较低**。大量菜单文件仍手动拼接 `className` 和 `innerHTML` |
| **inline style** | 🔴 **偏多**。31 行分散在 7 文件，是维护隐患 |

**本次重构前 UI 重复率 ≈ 35%**（31 inline + 约 45 行手动创建 `.slide-item` / `.preset-group` 等，占 145 总行的 ~30~40%）。

---

## 七、重构结果（2026-07-05 — 第一轮）

| 指标 | 改前 | 改后 |
|------|------|------|
| `className` 赋值行 | 145 行 | **~105 行**（↓28%） |
| inline style 行 | 31 行 | **~21 行**（↓32%） |
| 手动 `.slide-item` | 10+ 处 | **~5 处**（↓50%） |
| 核心新组件 | — | `slideRow(extra)` `addDangerRow()` `addFieldRow()` |
| CSS 新类 | — | `.field-label` `.field-value` `.slide-act-btn` |
| 测试回归 | — | ✅ 958/958 通过 |

### 具体改动（第一轮）

| 文件 | 改动 | 效果 |
|------|------|------|
| `core/ui-slide-row.ts` | 加 `SlideRowExtra` 接口：`variant`、`actionIcon`、`onActionClick`、`rightLabel` | 一次封装消除多处重复 |
| `core/ui-rows.ts` | 加 `addDangerRow()` `addFieldRow()` | 危险行和字段行标准化 |
| `core/ui-helpers.ts` | 导出新类型和函数 | — |
| `core/app.css` | 加 `.field-label` `.field-value` `.slide-act-btn` | 替代 inline style |
| `menus/model-detail.ts` | 用 `addFieldRow` / `addDangerRow` 替换两处手动 | -12 行 |
| `menus/settings.ts` | 用 `addDangerRow` / `slideRow(actionIcon)` 替换 | -14 行 |
| `menus/settings-software.ts` | 用 `addFieldRow` / `addDangerRow` / `slideRow(actionIcon)` 替换 | -22 行 |
| `menus/library-core.ts` | 用 `slideRow` 替换手动创建 | -8 行 |
| `menus/scene-stage-levels.ts` | 用 `addDangerRow` 替换 | -8 行 |
| `menus/scene-stage-lights.ts` | 用 `addDangerRow` 替换 | -10 行 |

### 第二轮（2026-07-05）— 解决剩余模式

| 文件 | 改动 | 效果 |
|------|------|------|
| `core/ui-slide-row.ts` | 加 `variant: 'accent'`、`actionIcons[]`、`iconFactory`、`inlineSub` | 支持 accent 色标签、多操作按钮、动态图标、内联 sublabel |
| `core/ui-rows.ts` | 加 `addEmptyRow()` | 空状态占位行标准化 |
| `core/app.css` | 加 `.accent-text` `.slide-item-muted` `.slide-sublabel-inline` `.slide-act-danger` | 替代 inline style |
| `core/ui-helpers.ts` | 导出 `addEmptyRow` `SlideAction` | — |
| `menus/motion-popup.ts` | 用 `addEmptyRow` 替换 2 处空状态 | -6 行 |
| `menus/model-detail.ts` | 用 `variant: 'accent'` 替换 "管理软件" inline style | 消除 innerHTML |
| `menus/outfit-ui.ts` | 用 `slideRow(iconFactory)` 替换变体行手动 DOM | -30 行 |
| `menus/settings.ts` | 用 `slideRow(inlineSub + actionIcons[])` 替换外部库行 innerHTML | 消除 innerHTML |
| 测试回归 | — | ✅ 982/982 通过 |

### 截至目前未纳入重构的模式

- **motion-popup.ts 图层行** — 权重滑条 + 实时百分比 + toggle + 删除，4 控件组合太特殊
- **model-detail.ts / library-core.ts favorites** — 动态颜色 + 条件文字 toggle，耦合度高
- **env-preset-levels.ts 空状态** — 非 `.slide-item` 上下文，在自定义 listHost 中
- **scene-stage-lights.ts opacity toggle** — 按钮启用/禁用视觉反馈，非重复模式

**剩余估计重复率 ≈ 15%**（仅剩高度特化的 ~4 处自定义模式）。
