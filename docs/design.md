# MikuMikuAR — UI 组件规范

> 本文档是 UI 代码的**唯一规范**。新增 UI 代码必须遵循本文件定义的组件体系和命名约定。
> 加菜单项的流程见 [`menu-how-to.md`](./menu-how-to.md)。

---

## 组件体系

UI 组件分布在以下源文件，统一通过 `ui-helpers.ts` barrel re-export：

- `ui-slide-row.ts` — `slideRow`、`HeaderToggleConfig`、`SlideAction`、`SlideRowExtra`
- `ui-rows.ts` — `addToggleRow`、`addSliderRow`、`addModeRow`、`addDangerRow`、`addFieldRow`、`addEmptyRow`、`sliderRow`、`toggleRow`
- `ui-advanced-rows.ts` — `addColorSliderRow`、`addModeSlider`
- `ui-collapsible.ts` — `addCollapsible`、`addSectionTitle`、`addPresetChip`
- `ui-types.ts` — `ControlOptions`

调用方 `import { ... } from '../core/ui-helpers'`，无需感知拆分。

---

### 卡片容器 `lcard`

所有子界面内容必须包裹在 `lcard` 容器中。

```ts
cardContainer(container: HTMLElement, fn: (c: HTMLElement) => void): void
// 自动移除 .render-card，创建 .lcard，注入 fn(c)
```

CSS 样式：
```css
.lcard {
    background: var(--card-bg, rgba(255,255,255,0.06));
    border: 1px solid var(--white-08);
    border-radius: 12px;
    margin: 8px;
}
```

**规则**：`renderCustom` 回调中第一件事就是 `cardContainer(container, (c) => { ... })`。禁止手动创建 `.render-card`。

---

### 交互行 `cs-row`

用于同一界面内切换模式并联动展开参数面板。

结构：`cs-row`（图标 + 标签 + 状态 `▶`） + `cs-params`（展开时显示）

**交互规则**：
- 点击非当前行 → 切换模式 + 展开参数 + 收起其他
- 点击当前行 → toggle 折叠/展开
- 左侧高亮：`border-left: 2px solid var(--accent)` + `background: var(--card-hover)`
- `cs-value` 当前模式显示「当前」（accent 色），其他显示 `▶`（dim 色）

---

### 预设芯片 `preset-chip`

```ts
function addPresetChip(
    container: HTMLElement, label: string, active: boolean, onClick: () => void,
    opts?: { onUpdate?: (btn: HTMLButtonElement) => void }
): HTMLButtonElement
```

**CSS**：`.preset-chip`（基础样式）、`.preset-chip.active`（accent 色边框/背景）、`.preset-group`（flex wrap 容器，gap: 6px）。

---

### 分区标题 `section-title`

```ts
function addSectionTitle(container: HTMLElement, text: string): void
```

`.section-title`：`font-size: 11px`、`border-bottom: 1px solid var(--white-06)`。

---

### 通用行按钮 `slideRow`

最通用的菜单行组件。**大部分菜单列表项用此函数创建。**

```ts
interface HeaderToggleConfig {
    value: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    disabledHint?: string;
    onDisabledClick?: () => void;
    bind?: () => boolean;
}

interface SlideAction {
    icon: string; title?: string; danger?: boolean; onClick: (e: MouseEvent) => void;
}

interface SlideRowExtra {
    variant?: 'default' | 'danger' | 'accent';
    actionIcon?: string;
    onActionClick?: (e: MouseEvent) => void;
    actionIcons?: SlideAction[];
    rightLabel?: string;
    iconFactory?: () => HTMLElement;
    inlineSub?: boolean;
}

function slideRow(
    container: HTMLElement, icon: string, label: string, hasArrow: boolean,
    onClick: () => void, sublabel?: string, tag?: string, focused?: boolean,
    headerToggle?: HeaderToggleConfig, extra?: SlideRowExtra,
): HTMLElement
```

**变体**：
| variant | 效果 | 场景 |
|---------|------|------|
| `'default'` | 标准白色 | 普通菜单项 |
| `'danger'` | 红色 | 删除/卸载 |
| `'accent'` | 主题色 | 高亮入口 |

**用法示例**：
```ts
// 简单导航
slideRow(c, 'lucide:info', '模型信息', true, () => stack.push(buildModelInfoLevel()));

// 带 toggle 开关
slideRow(c, 'lucide:eye', '可见', false, () => {}, undefined, undefined, {
    value: inst.visible, onChange: (v) => setVisibility(id, v),
});

// 危险操作
slideRow(c, 'lucide:trash-2', '卸载模型', false, removeModel(id), undefined, undefined, undefined, { variant: 'danger' });

// 键值展示
slideRow(c, '', '多边形', false, () => {}, undefined, undefined, undefined, { rightLabel: fmtNumber(triCount) });

// 双按钮
slideRow(c, 'lucide:plug', ep.name, false, () => {}, ep.path, undefined, undefined, {
    inlineSub: true, actionIcons: [{ icon: '✎', title: '重命名', onClick: rename }, { icon: '✕', danger: true, onClick: del }],
});

// 动态图标
slideRow(c, '', '默认', false, onClick, undefined, undefined, undefined, {
    iconFactory: () => createIconifyIcon(isActive ? 'lucide:check-circle' : 'lucide:circle'),
});
```

---

### 通用折叠 `addCollapsible`

```ts
addCollapsible(container, {
    title: string; icon?: string; variant?: 'default' | 'mat';
    defaultOpen?: boolean;
    headerToggle?: { value: boolean; onChange: (v: boolean) => void; bind?: () => boolean; };
    renderContent: (inner: HTMLElement) => void;
}): void
```

---

### 标准开关 `addToggleRow`

```ts
addToggleRow(container, label: string, value: boolean, onChange: (v: boolean) => void, icon?: string, opts?: ControlOptions): void
```

简化变体：`toggleRow(c, label, value, icon, onChange, onSave?)` —— onChange 后自动调 onSave。

---

### 标准滑条 `addSliderRow`

```ts
addSliderRow(container, label: string, value: number, min: number, max: number, step: number,
    onChange: (v: number) => void, icon?: string, onDragEndCb?: (v: number) => void, opts?: ControlOptions<number>): void
```

简化变体：`sliderRow(c, label, value, min, max, step, icon, onDragEnd)` —— 拖拽结束时触发。

---

### 模式按钮组 `addModeRow`

```ts
addModeRow<T extends string | number>(container, label: string,
    options: Array<{ value: T; label: string }>, currentValue: T, onChange: (v: T) => void): void
```

适合 2–6 个选项；选项过多改用 `addModeSlider`。

---

### 模式滑条 `addModeSlider`

```ts
addModeSlider<T extends string | number>(container, label: string,
    options: Array<{ value: T; label: string }>, currentValue: T,
    onChange: (v: T) => void, icon?: string, onDragEndCb?: (v: T) => void, opts?: ControlOptions<T>): void
```

---

### 标准颜色滑条 `addColorSliderRow`

```ts
addColorSliderRow(container, label: string, color: [number, number, number],
    onChange: (v: [number, number, number]) => void, opts?: ControlOptions<[number, number, number]>): void
```

---

### 控件选项 `ControlOptions`

| 字段 | 类型 | 作用 |
|------|------|------|
| `bind` | `() => T` | 声明取值函数，`updateControls()` 自动刷新 |
| `onUpdate` | `(el: HTMLElement) => void` | 自定义更新逻辑，优先级高于 `bind` |

---

### 快捷行助手

```ts
function addDangerRow(container, icon: string, label: string, onClick: () => void): HTMLElement
// 等价于 slideRow(..., { variant: 'danger' })

function addFieldRow(container, label: string, value: string): HTMLElement
// 等价于 slideRow(..., { rightLabel: value })

function addEmptyRow(parent: HTMLElement, text: string): HTMLElement
// 空状态占位行
```

---

### 相关 CSS 类索引

| CSS 类 | 作用 | 绑定组件 |
|--------|------|----------|
| `.danger-text` | 红色文字 | `slideRow(variant:'danger')` |
| `.accent-text` | 主题色文字 | `slideRow(variant:'accent')` |
| `.slide-focused` | 聚焦/选中行高亮 | `slideRow(focused:true)` |
| `.field-label` / `.field-value` | 键值布局 | `addFieldRow` / `rightLabel` |
| `.slide-act-btn` / `.slide-act-danger` | 操作按钮 | `actionIcon` / `actionIcons[]` |
| `.slide-item-muted` | 空状态占位 | `addEmptyRow` |
| `.slide-sublabel-inline` | 内联 sublabel | `inlineSub: true` |
| `.toggle-row` | toggle 行容器 | `addToggleRow` |
| `.mode-btn` / `.mode-btn.active` | 模式按钮 | `addModeRow` |
| `.clr-block` / `.clr-swatch` | 颜色选择器 | `addColorSliderRow` |
| `.collapsible-mat` | 材质面板折叠变体 | `addCollapsible(variant:'mat')` |

---

## 界面分层规范

每个菜单面板按使用频率分为三层：

| 层级 | 内容 | 可见性 |
|------|------|--------|
| 核心层 | 预设按钮、核心控制滑块、模式切换 | 默认展开 |
| 外观层 | 颜色选择、视觉属性 | 默认展开 |
| 高级层 | 低频参数（星空、旋转速度等） | 默认折叠 |

折叠策略：预设按钮和模式切换放核心层顶部；亮度/强度放核心层；低频参数用 `addCollapsible` 折叠。

---

## 命名约定

| 概念 | 命名 | 示例 |
|------|------|------|
| 组件函数（构建 UI） | `build` + 功能名 + `Level` | `buildEnvUnifiedLevel` |
| 路由处理函数 | `onFolderEnter` | `envOnFolderEnter` |
| 菜单实例变量 | `xxxMenu` | `envMenu`, `sceneMenu` |
| 操作处理函数 | `handle` + 动作 + `Action` | `handleSceneAction` |
