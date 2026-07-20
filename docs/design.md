# MikuMikuAR — UI 组件规范

> 本文档是 UI 代码的**唯一规范**。新增 UI 代码必须遵循本文件定义的组件体系和命名约定。
> 加菜单项的流程见 [`menu-how-to.md`](./menu-how-to.md)。
> 声明式 Schema 架构详见 [ADR-093](./adr/adr-093-menu-declarative-schema.md)。

---

## 双轨架构

菜单 UI 有两种构建方式，**声明式 Schema 为推荐主路径**：

| 方式 | 入口 | 适用场景 |
|------|------|---------|
| **声明式 Schema**（推荐） | `buildXxxSchema(): MenuNode[]` + `renderMenu()` | 表单控件、折叠分组、条件渲染、动态列表 |
| **命令式 Builder**（保留） | `slideRow` / `addSliderRow` / `addToggleRow` … | `renderCustom` 内部、纯导航 `items`、渲染后端工具 |

二者关系：**命令式 Builder 是声明式 Schema 的渲染后端**。`renderMenu` 遍历 `MenuNode[]` 后，按 `kind` 分发到 `ui-helpers` 的 builder 函数生成 DOM。新增菜单应优先用 Schema；只有当状态无法由 StatePath 表达、或为纯导航 `PopupRow` 列表时，才退回命令式。

---

## 声明式 Schema（ADR-093）

### MenuNode 节点

定义于 `frontend/src/menus/menu-schema.ts`。

```ts
type StatePath = `env.${string}` | `render.${string}` | `light.${string}` | `ui.${string}` | `perception.${string}` | `motionModule.${string}`;

type MenuKind = 'folder' | 'slider' | 'colorSlider' | 'toggle'
              | 'modeSlider' | 'modeRow' | 'sectionTitle' | 'divider' | 'custom';

interface MenuNode {
    id: string;                      // 稳定唯一 id
    kind: MenuKind;
    label?: string;                  // i18n key，folder/divider 可省
    icon?: string;
    defaultOpen?: boolean;           // folder
    headerToggle?: {                 // folder 折叠头部开关
        bind: StatePath;
        get?: (v: unknown) => boolean;   // 状态值→boolean（如 groundType='terrain'→true）
        set?: (v: boolean) => unknown;   // boolean→状态值
    };
    children?: MenuNode[];           // folder
    control?: ControlSpec;           // slider/toggle/modeSlider/modeRow/colorSlider
    renderCustom?: (container: HTMLElement) => (() => void) | void;  // custom 逃生舱
    visibleWhen?: () => boolean;     // 条件守卫，false 时不渲染
}
```

### StatePath 状态路径

类型化字符串，由 `menu-schema.ts` 按前缀映射到 reactive state 对象，避免内联闭包，保证可审计。

| 前缀 | 读取 | 写入 |
|------|------|------|
| `env.` | `envState` | `setEnvState()` |
| `render.` | `getRenderState()` | `setRenderState()` |
| `light.` | `getLightState()` | `setLightState()` |
| `ui.` | `uiState` | `setUIState()` |
| `perception.` | `getPerceptionState()` | `setPerceptionState()` |
| `motionModule.` | `modelRegistry.get(focusedModelId)?.motionOverrideModules` | 自动创建/更新 `motionOverrideModules` |

### ControlSpec 控件规格

```ts
interface ControlSpec {
    bind: StatePath;              // 状态绑定，renderMenu 自动 registerControl 增量更新
    min?: number; max?: number; step?: number;
    icon?: string;
    options?: Array<{ value: string; label: string }>;  // modeSlider/modeRow
    get?: (v: unknown) => unknown;   // 衍生控件：状态值→显示值
    set?: (v: unknown) => unknown;   // 衍生控件：控件值→状态值
    onChange?: (v: unknown) => void; // 值变更副作用（如重建水体）
}
```

**衍生控件常见用法**：
- 字符串↔角度数字（`windDirection`）
- `undefined`→boolean 默认值（`vsync`）
- 枚举↔boolean（`groundType='terrain'`↔true）

### renderMenu 单渲染器

定义于 `frontend/src/menus/render-menu.ts`。

```ts
function renderMenu(schema: MenuNode[], container: HTMLElement): () => void
```

- 遍历 `MenuNode[]`，按 `kind` 分发到 `ui-helpers`（`addSliderRow` / `addToggleRow` / `addCollapsible` …）
- 对每个 `control.bind` 自动调用 `registerControl`，接入 reactive 管线实现状态自更新
- 收集所有 `renderCustom` 返回的 dispose 函数，返回聚合 dispose 供层级卸载时级联释放

### visibleWhen 条件守卫

返回 `false` 时该节点不渲染。用于按状态条件显示子参数（如地面 PBR 开启时才显示金属度/粗糙度子参数、多灯时才显示删除按钮）。

### renderCustom 逃生舱与 dispose 契约

无法数据化的内容（动态列表、异步加载、表单交互）用 `custom` kind：

```ts
{
    id: 'outfit:main',
    kind: 'custom',
    renderCustom: (c) => {
        cardContainer(c, (inner) => { /* 自由渲染 DOM */ });
        return () => { /* 可选 dispose：释放监听器/计时器 */ };
    },
}
```

**dispose 契约**（ADR-093 §5 P1 风险项）：
- `renderCustom` 返回的函数会被 `renderMenu` 收集并在层级卸载时调用
- 内部创建的子控件**必须**通过 `getCurrentRenderingMenu()?.registerControl(update)` 注册，使 `SlideMenu.dispose()` 能级联释放
- 未返回 dispose 且未注册控件的 `renderCustom`，其 DOM/监听器在层级切换时泄漏

### folder 节点 vs PopupRow 导航

**关键区分**：schema `folder` 是折叠容器（用 `children` 展开子节点），**不是导航项**。纯导航用 `PopupRow` items + `target` 路由（`onFolderEnter` 返回 `PopupLevel`），不要转为 schema。

| 用途 | 机制 |
|------|------|
| 折叠分组（同页面展开/收起子参数） | ✅ schema `folder` + `children` |
| 跳转到子页面（导航栈 push） | ✅ `PopupRow` items + `target` 路由 |
| 动态实例下钻（点击实例→详情层） | ✅ `custom` 节点 + `slideRow` + `stack.push()` |

### 何时用 Schema、何时用 Builder

| 场景 | 推荐方式 |
|------|---------|
| 状态可由 StatePath 表达的表单控件 | ✅ Schema（slider/toggle/modeSlider/modeRow/colorSlider） |
| 折叠分组 + 子节点 | ✅ Schema（folder + children） |
| 按状态条件显示/隐藏的子参数 | ✅ Schema（visibleWhen） |
| 动态列表（实例数运行时变化） | ✅ Schema `custom` 节点 + 内部用 builder |
| 异步加载内容 | ✅ Schema `custom` 节点 + `void` IIFE 包裹 async |
| 纯导航项（folder → target 路由） | ❌ 保持 `PopupRow` items |
| 动态列表渲染后端（如 `library-core.buildLevel`） | ❌ 保持 `PopupLevel.renderCustom` |

### Schema 示例

```ts
function buildExampleSchema(): MenuNode[] {
    return [
        { id: 'title', kind: 'sectionTitle', label: 'section.basic' },
        {
            id: 'intensity',
            kind: 'slider',
            label: 'env.intensity',
            icon: 'lucide:sun',
            control: { bind: 'env.sunIntensity', min: 0, max: 4, step: 0.05 },
        },
        {
            id: 'enabled',
            kind: 'toggle',
            label: 'env.enabled',
            control: {
                bind: 'env.featureEnabled',
                get: (v) => v ?? true,     // undefined → true 默认值
                set: (v) => v,
            },
        },
        {
            id: 'group',
            kind: 'folder',
            label: 'env.advanced',
            defaultOpen: false,
            visibleWhen: () => envState.featureEnabled,
            children: [
                { id: 'param', kind: 'slider', label: 'env.param',
                  control: { bind: 'env.param', min: 0, max: 1, step: 0.01 } },
            ],
        },
        {
            id: 'list',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    for (const item of getDynamicList()) {
                        slideRow(inner, item.icon, item.label, true, () => stack.push(...));
                    }
                });
            },
        },
    ];
}

export function buildExampleLevel(): PopupLevel {
    return {
        label: '示例', dir: '', items: [],
        renderCustom: (container) => { renderMenu(buildExampleSchema(), container); },
    };
}
```

---

## 命令式 Builder 体系

UI 组件分布在以下源文件，统一通过 `ui-helpers.ts` barrel re-export：

- `ui-slide-row.ts` — `slideRow`、`HeaderToggleConfig`、`SlideAction`、`SlideRowExtra`
- `ui-rows.ts` — `addToggleRow`、`addSliderRow`、`addModeRow`、`addDangerRow`、`addFieldRow`、`addEmptyRow`、`sliderRow`、`toggleRow`
- `ui-advanced-rows.ts` — `addColorSliderRow`、`addModeSlider`
- `ui-collapsible.ts` — `addCollapsible`、`addSectionTitle`、`addPresetChip`
- `ui-types.ts` — `ControlOptions`

**卡片容器 `cardContainer`**：用于 `renderCustom` 回调中创建 `.lcard`，定义在 `core/utils.ts`，通过 `core/config.ts` 导出；不通过 `ui-helpers.ts` 导出。

调用方 `import { ... } from '../core/ui-helpers'`，无需感知拆分。

## 快速入口

| 要做什么 | 优先方式 | 备选（命令式） |
|----------|---------|---------------|
| 加一个 schema 菜单面板 | `buildXxxSchema(): MenuNode[]` + `renderMenu()` | — |
| 加一个滑条（绑定状态） | schema `slider` + `control.bind` | `addSliderRow` |
| 加一个开关（绑定状态） | schema `toggle` + `control.bind` | `addToggleRow` |
| 加一个模式切换 | schema `modeSlider` / `modeRow` | `addModeSlider` / `addModeRow` |
| 加一个颜色控制 | schema `colorSlider` | `addColorSliderRow` |
| 加一个折叠分组 | schema `folder` + `children` | `addCollapsible` |
| 加一个分区标题 | schema `sectionTitle` | `addSectionTitle` |
| 按状态条件显示/隐藏 | schema `visibleWhen` | — |
| 加一组预设按钮 | — | `addPresetChip`（通常在 `custom` 节点内） |
| 加一个纯导航行 | — | `slideRow`（或 `PopupRow` items + `target`） |
| 加一个异步/动态列表 | schema `custom` 节点 + `void` IIFE | — |
| 创建 `.lcard` | — | `cardContainer()`（在 `renderCustom` 内） |

---

### 卡片容器 `lcard`

卡片有两种创建方式：

**1. `renderCustom` 菜单**：手动调用 `cardContainer()` 创建 `.lcard`。

```ts
// 从 core/config.ts 导入：
import { cardContainer } from '../core/config';

cardContainer(container: HTMLElement, fn: (c: HTMLElement) => void): void
// 自动移除 .render-card，创建 .lcard，注入 fn(c)
```

**2. 纯 items 菜单**：`buildPanel()` 自动按 `divider` 分组，每组包裹一个 `.lcard`。

条件：`PopupLevel` 只设置了 `items` 字段，未设置 `renderCustom`。

```
items: [预设场景, 保存场景, divider, 后处理, 舞台, 截图, divider, 物理]
         ↓
<div class="lcard">预设场景 / 保存场景</div>
<div class="lcard">后处理 / 舞台 / 截图</div>
<div class="lcard">物理</div>
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

**规则**：`renderCustom` 回调中第一件事就是 `cardContainer(container, (c) => { ... })`。禁止手动创建 `.render-card`。items 菜单不需要手动处理卡片——`buildPanel()` 自动完成。

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
    opts?: { onUpdate?: (btn: HTMLButtonElement) => void; wrap?: boolean }
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
    wrapLabel?: boolean;
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

**内部 DOM 结构**：

```html
<div class="cs-bar" tabindex="0" role="slider" aria-valuenow="..." aria-valuemin="..." aria-valuemax="...">
  <div class="cs-fill" style="width: NN%"></div>
  <div class="cs-thumb" style="left: NN%"></div>
</div>
```

| 子元素 | 作用 | 关键样式 |
|--------|------|----------|
| `.cs-fill` | 已填充部分的进度条 | `height: 100%`, `width: NN%`（行内），`background: linear-gradient(...)` |
| `.cs-thumb` | 滑块手柄 | `position: absolute`, `left: NN%`（行内），`height: 100%` |

**两个布局上下文**：

`.cs-bar` 可在两种结构中复用：

| 上下文 | 父容器 | `.cs-bar` 尺寸策略 | 来源 |
|--------|--------|---------------------|------|
| 独立滑块 | `.cs-row`（column flex） | `width: 100%` 填满行宽 | `addSliderRow` |
| 颜色行内滑块 | `.clr-row`（row flex） | `flex: 1` 填充剩余空间 | `addColorSliderRow` |

基类 `.cs-bar` 使用 `width: 100%`（兼容 column/block 布局），颜色行内场景通过 `.clr-row .cs-bar { flex: 1; width: auto; }` 覆盖为 flex 尺寸。

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
| `.cs-bar` / `.cs-fill` / `.cs-thumb` | 滑条轨道/填充/手柄 | `addSliderRow` / `addColorSliderRow` |
| `.clr-block` / `.clr-swatch` | 颜色选择器 | `addColorSliderRow` |
| `.clr-row` / `.clr-channel` / `.clr-value` | 颜色行（flex row 布局） | `addColorSliderRow` |
| `.cs-params` | 相机模式参数面板 | `motion-camera-levels.ts` |
| `.collapsible-mat` | 材质面板折叠变体 | `addCollapsible(variant:'mat')` |
| `.slide-label.wrap-2` / `.preset-chip.wrap-2` | 长文本换行 | `wrapLabel: true` / `opts.wrap: true` |

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

## Button / Row 类型使用分布

> 统计数据不含测试文件（`__tests__/`）。
> ⚠️ 以下数据为概览，精确数量请 `grep` 重新统计。

### 视图 A：`PopupRow.kind` 类型分布（menu 弹窗节点类型）

> 定义在 `core/types.ts:178`。适合审视菜单项的语义角色。

| Kind | 生产行数 | 典型举例 | 占比 |
|------|----------|----------|------|
| `action` | ~22 | 截图、加载 VMD、保存场景、相机切换 | ~31% |
| `folder` | ~22 | 环境子菜单、渲染预设、场景设置 | ~31% |
| `divider` | ~10 | 菜单分组分隔线 | ~14% |
| `toggle` | ~11 | 物理参数开关（scene-physics-levels） | ~16% |
| `slider` | ~5 | 物理滑条（scene-physics-levels） | ~7% |
| `model` | ~1 | 库内模型入口（library-core） | ~1% |
| `modeSlider` | 多个 | 相机模式、环境特征、场景渲染/灯光 | ✅ 已进入生产 |
| `chips` | 接入 `menu.ts`，生产数据使用较少 | 预设/选项切换 | 已接入 buildPanel |

**合计：~71 个 PopupRow 节点**（menu 测试文件除外）。

### 视图 B：UI Builder 函数调用次数（实际 UI 行数）

> 这些函数内部生成的 DOM 行数没有直接统计，但**调用次数**可以反映 UI 规模。适合评估 UI 复杂度。

| Builder 函数 | 调用次数 | 分布文件数 | 典型场景 |
|-------------|----------|-----------|---------|
| `addSliderRow` / `addColorSliderRow` | ~200 次 | 19 个 | 音量 0-100%、音频偏移 -5~5s、材质参数 |
| `addToggleRow` | ~112 次 | 29 个 | 静音、BPM 量化、伴音自动加载、物理开关 |
| `slideRow`（含 `sliderRow` / `addFieldRow` / `addEmptyRow`） | ~110 次 | 29 个 | 通用导航行 |
| `addDangerRow` | 1 次 | 1 个 | 停止监听（危险区，用 `variant: 'danger'`） |
| `addModeRow` / `addModeSlider` | ~50 次 | 19 个 | 相机模式切换、程序化动作选择 |
| `addCollapsible` | ~200 次 | 19 个 | 环境/物理/渲染各参数区块折叠 |
| `addPresetChip` | ~50 次 | 8 个 | 预设按钮组（场景/材质/环境预设） |

### 容易混淆的概念

| 你可能以为的 | 实际 |
|------------|------|
| `slideRow` 是 `kind: 'slideRow'` | ❌ 错。`slideRow()` 是 UI 构建函数，`PopupRow.kind` 没有 `'slideRow'` 值 |
| `addDangerRow` 是独立 kind | ❌ 错。`addDangerRow()` 底层就是 `slideRow(..., { variant: 'danger' })`，危险操作靠 `variant` 区分 |
| `modeSlider` / `chips` 是死代码 | ❌ 错。`PopupRow.kind = 'modeSlider'` 已通过 `addModeSlider()` 进入生产；`chips` 已接入 `menu.ts` 渲染路径，但生产数据较少 |

### 健康检查

| 指标 | 当前状态 | 备注 |
|------|---------|------|
| `addDangerRow` 使用率 | 🟡 偏低 | 危险操作偏少，可能缺少危险警告，需 grep 重新确认 |
| `toggle` vs `action` 比例 | 🟢 合理 | 大部分菜单项是可执行 action，少量是开关 |
| 类型使用状态 | 🟢 `modeSlider` 已进入生产；🟡 `chips` 已接入但生产数据较少 | 类型定义存在且已接入渲染路径 |
| UI 规模 | 🟢 200+ slider / 110+ toggle | 规模适中，覆盖完整 |

---

## 命名约定

| 概念 | 命名 | 示例 |
|------|------|------|
| Schema 工厂函数 | `build` + 功能名 + `Schema` | `buildExampleSchema` |
| Schema 导出的 PopupLevel | `build` + 功能名 + `Level` | `buildExampleLevel` |
| 路由处理函数 | `onFolderEnter` | `envOnFolderEnter` |
| 菜单实例变量 | `xxxMenu` | `envMenu`, `sceneMenu` |
| 操作处理函数 | `handle` + 动作 + `Action` | `handleSceneAction` |
| MenuNode id | `<域>:<功能>[:<子>]` | `env:sky`, `scene:render:dof` |
