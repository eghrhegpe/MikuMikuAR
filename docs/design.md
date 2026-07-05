# MikuMikuAR — UI 设计规范

> 本文档定义前端菜单系统的视觉规范、组件体系和未来统一方向。所有新增 UI 代码必须遵循本规范。

---

## 一、文档地图

| 关联文档 | 关系 |
|----------|------|
| [AGENTS.md](../AGENTS.md) | AI 代理入口，定义「文档宪法」和任务触发索引 |
| [menu-architecture.md](./menu-architecture.md) | MenuStack 导航架构、添加新功能流程 |
| [terminology.md](./terminology.md) | 代码级命名规范（图标、状态栏、Go 错误） |
| [reusables.md](./reusables.md) | 复用函数索引（AI 写代码前必查） |
| [design-archive.md](./design-archive.md) | 已否决的设计方案归档 |

---

## 二、设计原则

### 2.1 核心理念

- **透明菜单优先**：所有菜单覆盖在 3D 视口之上，菜单本身透明，避免遮挡 3D 内容
- **信息密度适中**：单面板不超过 2-3 个信息层级，避免嵌套过深
- **操作即反馈**：每个交互都有即时视觉响应（hover / active / 状态变化）

### 2.2 配色体系

所有文本颜色基于 CSS 变量，透明菜单必须使用高对比度亮色：

```css
:root {
    /* 文本色（从亮到暗） */
    --text:       #fff;   /* 纯白，主文本 */
    --text-bright: #bbb;  /* 高亮/强调文本 */
    --text-dim:   #888;   /* 次要信息 */
    --text-muted: #555;   /* 极弱信息 */

    /* 边框 */
    --white-04: rgba(255,255,255,0.04);
    --white-06: rgba(255,255,255,0.06);
    --white-08: rgba(255,255,255,0.08);
    --white-12: rgba(255,255,255,0.12);
    --white-16: rgba(255,255,255,0.16);

    /* 强调色 */
    --accent:     #4a6cf7;
    --accent-hover: #3a5ce7;
    --accent-dim: rgba(74,108,247,0.2);
}
```

> **规则**：`--text` 必须是 `#fff`，透明菜单用浅色背景时保证可读性。

---

## 三、组件体系

> **模块结构**：UI 组件已从单体 `ui-helpers.ts` 拆分为独立模块。各函数分布在以下源文件，导出通过 `ui-helpers.ts` barrel re-export 保持向后兼容：
> - `ui-slide-row.ts` — `slideRow`、`HeaderToggleConfig`、`SlideAction`、`SlideRowExtra`
> - `ui-rows.ts` — `addToggleRow`、`addSliderRow`、`addModeRow`、`addDangerRow`、`addFieldRow`、`addEmptyRow`、`sliderRow`、`toggleRow`
> - `ui-advanced-rows.ts` — `addColorSliderRow`、`addModeSlider`
> - `ui-collapsible.ts` — `addCollapsible`、`addSectionTitle`、`addPresetChip`
> - `ui-types.ts` — `ControlOptions`
>
> 调用方 `import { ... } from '../core/ui-helpers'` 无需改动。

### 3.1 卡片容器 `lcard`

所有子界面内容必须包裹在 `lcard` 容器中，保证统一的卡片视觉。

**工具函数**：
```ts
cardContainer(container: HTMLElement, fn: (c: HTMLElement) => void): void
// 自动移除 .render-card，创建 .lcard 容器，注入 fn(c)
```

**CSS 样式**：
```css
.lcard {
    background: var(--card-bg, rgba(255,255,255,0.06));
    border: 1px solid var(--white-08);
    border-radius: 12px;
    margin: 8px;
}
```

**使用规范**：
- `renderCustom` 回调中，第一步调用 `cardContainer(container, (c) => { ... })`
- 禁止在 `renderCustom` 内手动创建带 `.render-card` 的 DOM
- 返回按钮 `.slide-back` 在 `app.css` 中已实现为独立小卡片，优先级高于 `lcard` 背景色

### 3.2 交互行 `cs-row`

用于在同一界面内切换模式并联动展开参数面板（如「环境调色板」的天空模式行）。

**结构**：
```
┌──────────────────────────────────────┐
│ [icon] 标签文字              当前 ▶  │  ← cs-row
│ [参数面板，内容区]                    │  ← cs-params（展开时）
└──────────────────────────────────────┘
```

**CSS 类**：
```css
.cs-row           { ... }      /* 行容器，cursor:pointer */
.cs-row .cs-top   { ... }      /* 顶栏：图标 + 标签 + 状态 */
.cs-row .cs-icon  { ... }      /* 图标区 */
.cs-row .cs-label { flex:1 }   /* 标签文字 */
.cs-row .cs-value{ ... }       /* 状态文字（当前/▶） */
.cs-params        { padding:0 14px 10px; overflow:hidden; transition:... }
```

**交互规则**：
- 点击非当前行 → 切换模式 + 展开参数 + 收起其他
- 点击当前行 → toggle 折叠/展开
- 左侧高亮：`border-left: 2px solid var(--accent)` + `background: var(--card-hover)`
- `cs-value` 当前模式显示「当前」（accent 色），其他显示 `▶`（dim 色）

### 3.3 预设芯片 `preset-chip`

用于快速切换预设值（环境预设、水面预设等），出现在面板顶部或 `cs-row` 上方。

**构建函数**：
```ts
function addPresetChip(
    container: HTMLElement,   // 父容器（通常是 div.preset-group）
    label: string,            // 按钮文本
    active: boolean,          // 是否激活（追加 'active' class）
    onClick: () => void,      // 点击回调
    opts?: { onUpdate?: (btn: HTMLButtonElement) => void }
): HTMLButtonElement
```

`addPresetChip` 只负责单个 chip 创建+追加，group 容器和数据源由调用方管理。支持 `onUpdate` 自更新回调。

**CSS 样式**：
```css
.preset-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 12px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--white-08);
    background: transparent;
    color: var(--text);
    font-size: var(--font-ui-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    user-select: none;
}
.preset-chip:hover {
    background: var(--white-08);
    border-color: var(--white-16);
    color: var(--text-bright);
}
.preset-chip:active { transform: scale(0.96); background: var(--white-12); }
.preset-chip.active {
    border-color: var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
}
.preset-chip iconify-icon { width: 14px; height: 14px; font-size: 14px; }
```

**预设组容器**：
```css
.preset-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 14px 10px;
}
```

### 3.4 分区标题 `section-title`

用于在单卡片内划分语义区块（如「☀️ 光照控制」「🎨 天空外观」）。

**构建函数**：
```ts
function addSectionTitle(container: HTMLElement, text: string): void
// 创建 div.section-title，textContent 设为 text，追加到 container
```

**CSS 样式**：
```css
.section-title {
    font-size: 11px;
    color: var(--text);
    padding: 8px 14px 4px;
    border-bottom: 1px solid var(--white-06);
    margin-bottom: 2px;
    letter-spacing: 0.3px;
}
```

### 3.5 通用行按钮 `slideRow`

最通用的菜单行组件，支持点击+箭头/标签+详情文字+右侧 toggle 开关 + 变体/操作按钮/动态图标/键值布局。**大部分菜单列表项用此函数创建。**

```ts
interface HeaderToggleConfig {
    value: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    disabledHint?: string;
    onDisabledClick?: () => void;
    bind?: () => boolean;     // 声明取值方式，updateControls() 时自动同步
}

interface SlideAction {
    icon: string;              // 按钮文字（如 '✕'、'✎'、'▶'）
    title?: string;            // hover 提示
    danger?: boolean;          // 是否危险操作（红色）
    onClick: (e: MouseEvent) => void;
}

interface SlideRowExtra {
    variant?: 'default' | 'danger' | 'accent';  // label 颜色变体
    actionIcon?: string;       // 右侧单操作按钮（快捷方式）
    onActionClick?: (e: MouseEvent) => void;
    actionIcons?: SlideAction[];  // 多操作按钮数组（与 actionIcon 叠加渲染）
    rightLabel?: string;       // 键值布局—右侧值文字（如 "1.2s"）
    iconFactory?: () => HTMLElement;  // 动态图标工厂（替代 icon 字符串）
    inlineSub?: boolean;       // sublabel 内联在 label 后（非右对齐），适合 text-overflow
}

function slideRow(
    container: HTMLElement,    // 父容器
    icon: string,              // Iconify 图标名（如 "lucide:folder"）
    label: string,             // 标签文字
    hasArrow: boolean,         // 是否显示右侧箭头（>）
    onClick: () => void,       // 点击回调
    sublabel?: string,         // 灰色辅助文字（如文件名/状态）
    tag?: string,              // 彩色标签徽章（如 "Beta"）
    focused?: boolean,         // 是否聚焦/选中态
    headerToggle?: HeaderToggleConfig,
    extra?: SlideRowExtra,     // 可选扩展配置
): HTMLElement
```

**样式**：
- **无 headerToggle** → `className = 'slide-item'` + `>` 箭头（hasArrow 时）
- **有 headerToggle** → `collapsible-header` 样式 + 右侧开关 + `▾` 箭头

**变体（extra.variant）**：
| variant | label 效果 | 适用场景 |
|---------|-----------|----------|
| `'default'` | 标准白色 | 普通菜单项 |
| `'danger'` | 红色（`--danger`） | 删除/卸载/停止等危险操作 |
| `'accent'` | 主题色（`--accent`） | 管理链接、高亮入口 |

**操作按钮**：
- **单按钮**：`{ actionIcon: '✕', onActionClick: (e) => del() }`
- **多按钮**：`{ actionIcons: [ { icon: '✎', title: '重命名', onClick: rename }, { icon: '✕', danger: true, onClick: del } ] }`

**动态图标（extra.iconFactory）**：
当图标状态需要条件切换时（如 check/circle 表示激活/非激活），使用工厂函数替代固定 icon 字符串：
```ts
slideRow(c, '', '默认', false, onClick, undefined, undefined, undefined, {
    iconFactory: () => createIconifyIcon(
        isActive ? 'lucide:check-circle' : 'lucide:circle'
    ),
})
```

**键值布局（extra.rightLabel）**：
左侧字段名 + 右侧值，适用于信息展示面板：
```ts
slideRow(c, '', '多边形', false, () => {}, undefined, undefined, undefined, {
    rightLabel: fmtNumber(triCount),
})
```
`rightLabel` 有值时，label 被 `.field-label` 样式渲染为字段名，右侧显示 `.field-value`。

**内联 sublabel（extra.inlineSub）**：
`inlineSub: true` 时，sublabel 紧跟在 label 后并自动截断（text-overflow），替代默认的右对齐布局。适用于路径/描述等需填满空白的文字。

**用法示例——简单菜单项**：
```ts
slideRow(c, 'lucide:info', '模型信息', true, () => {
    stack.push(buildModelInfoLevel());
});
```

**用法示例——带 toggle 开关**：
```ts
slideRow(c, 'lucide:eye', '可见', false, () => {}, undefined, undefined, {
    value: inst.visible,
    onChange: (v) => { setVisibility(id, v); },
});
```

**用法示例——带辅助文字**：
```ts
slideRow(c, 'lucide:folder-open', '浏览音乐库', true, () => {
    pushMusicLevel();
}, getAudioName() || '无音乐');
```

**用法示例——危险操作行**：
```ts
slideRow(c, 'lucide:trash-2', '卸载模型', false, () => {
    removeModel(id);
}, undefined, undefined, undefined, {
    variant: 'danger',
});
```

**用法示例——双按钮行**：
```ts
slideRow(c, 'lucide:plug', ep.name, false, () => {},
    ep.path, undefined, undefined, {
        inlineSub: true,
        actionIcons: [
            { icon: '✎', title: '重命名', onClick: rename },
            { icon: '✕', danger: true, onClick: del },
        ],
    },
);
```

### 3.6 通用折叠 `addCollapsible`

用于将低频/高级参数折叠收起，保持主面板简洁。

```ts
addCollapsible(container, {
    title: string;
    icon?: string;
    variant?: 'default' | 'mat';
    defaultOpen?: boolean;
    headerToggle?: {
        value: boolean;
        onChange: (v: boolean) => void;
        bind?: () => boolean;
    };
    renderContent: (inner: HTMLElement) => void;
}): void
```

**CSS 样式**：
```css
.collapsible-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.12s;
    min-height: 44px;
}
.collapsible-header:hover { background: var(--card-hover); }
.collapsible-header:active { background: var(--card-active); }
.collapsible-icon { width: 20px; height: 20px; display: flex; align-items: center; color: var(--text-muted); }
.collapsible-label { flex: 1; font-size: 15px; color: var(--text); }
.collapsible-arrow { font-size: 12px; color: var(--text-dim); transition: transform 0.25s ease; }
.collapsible-panel { overflow: hidden; max-height: 0; transition: max-height 0.3s ease, opacity 0.25s ease; opacity: 0; }
.collapsible-panel.open { opacity: 1; }
.collapsible-inner { padding: 2px 0 4px; }
```

### 3.7 标准开关 `addToggleRow`

单行切换开关。整行可点击（toggle 区域除外）。

```ts
addToggleRow(
    container: HTMLElement,   // 父容器
    label: string,            // 标签文字
    value: boolean,           // 当前值
    onChange: (v: boolean) => void,
    icon?: string,            // Iconify 图标名（如 "lucide:eye"）
    opts?: ControlOptions     // bind / onUpdate（可选）
): void
```

**用法示例**：
```ts
addToggleRow(c, '启用物理', cfg.physics, (v) => { setPhysics(v); }, 'lucide:zap');
```

> **简化变体** `toggleRow(container, label, value, icon, onChange, onSave?)` ——自动在 onChange 后调用 onSave（如自动保存配置）。

### 3.8 标准滑条 `addSliderRow`

连续数值调节，支持拖拽 thumb + 行内区间点击 + 键盘操作。

```ts
addSliderRow(
    container: HTMLElement,        // 父容器
    label: string,                 // 标签文字
    value: number,                 // 当前值
    min: number,                   // 最小值
    max: number,                   // 最大值
    step: number,                  // 步长（如 0.05 / 1）
    onChange: (v: number) => void, // 实时回调
    icon?: string,                 // Iconify 图标名
    onDragEndCb?: (v: number) => void,  // 拖拽结束回调
    opts?: ControlOptions<number>       // bind / onUpdate
): void
```

**交互行为**：
- 拖拽 thumb 实时更新
- 点击行左侧 1/4 → 减 15%，左中 → 减 5%，右中 → 加 5%，右侧 1/4 → 加 15%
- 键盘 ← → 按 step 步进，Shift + ← → 10x 步进，Home / End → 极值
- 图标可选，显示在标签左侧

**用法示例**：
```ts
addSliderRow(c, '亮度', value, 0, 2, 0.05, (v) => { setBrightness(v); }, 'lucide:sun');
```

> **简化变体** `sliderRow(container, label, value, min, max, step, icon, onDragEnd)` ——无实时回调，仅在拖拽结束时触发。

### 3.9 模式按钮组 `addModeRow`

离散选项切换（如材质分类筛选），外观为一行按钮组，每个选项一个按钮。

```ts
addModeRow<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void
): void
```

**交互规则**：
- 活跃按钮带 `.active` class（accent 色边框/背景）
- 点击任一按钮 → 设为活跃 + 调用 `onChange`
- 适合 2–6 个选项；选项过多时改用 `addModeSlider`（3.10）

**用法示例**：
```ts
addModeRow(c, '材质分类', [
    { value: 'all', label: '全部' },
    { value: 'skin', label: '皮肤' },
    { value: 'cloth', label: '衣物' },
], currentFilter, (v) => { setFilter(v); });
```

### 3.10 模式滑条 `addModeSlider`

离散选项切换（如天空模式：程序化 / 纯色 / 贴图），外观与 `addSliderRow` 一致。

```ts
addModeSlider<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void,
    icon?: string,
    onDragEndCb?: (v: T) => void,
    opts?: ControlOptions<T>
): void
```

**用法示例**：
```ts
addModeSlider(c, '天空模式', [
    { value: 'procedural', label: '程序化' },
    { value: 'solid', label: '纯色' },
    { value: 'texture', label: '贴图' },
], skyMode, (v) => { setSkyMode(v); }, 'lucide:cloud-sun');
```

### 3.11 标准颜色滑条 `addColorSliderRow`

RGB 三通道颜色选择器，每通道独立滑条 + 色块预览。

```ts
addColorSliderRow(
    container: HTMLElement,
    label: string,
    color: [number, number, number],
    onChange: (v: [number, number, number]) => void,
    opts?: ControlOptions<[number, number, number]>
): void
```

**用法示例**：
```ts
addColorSliderRow(c, '漫反射色', [1, 0.8, 0.6], (v) => { setDiffuse(v); });
```

### 3.12 控件选项 `ControlOptions`

`addSliderRow` / `addToggleRow` / `addModeSlider` / `addColorSliderRow` 的可选参数。两种模式二选一：

| 字段 | 类型 | 作用 |
|------|------|------|
| `bind` | `() => T` | 声明取值函数，`updateControls()` 自动拉取最新值并刷新显示 |
| `onUpdate` | `(el: HTMLElement) => void` | 自定义更新逻辑，优先级高于 `bind` |

**用法示例**：
```ts
addSliderRow(c, '角度', angle, 0, 360, 1, onChange, undefined, undefined, {
    bind: () => state.angle
});
```

---

### 3.13 快捷行助手

基于 `slideRow` 封装的语义化快捷函数，消除重复的相似调用模式。

#### `addDangerRow`

红色危险/删除操作行。等价于 `slideRow(..., { variant: 'danger' })`。

```ts
function addDangerRow(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
): HTMLElement
```

**用法示例**：
```ts
addDangerRow(c, 'lucide:trash-2', '停止监听', () => stopWatch());
```

#### `addFieldRow`

键值信息行（左字段名 + 右值）。等价于 `slideRow('', label, ..., { rightLabel: value })`。

```ts
function addFieldRow(
    container: HTMLElement,
    label: string,     // 字段名
    value: string,     // 字段值
): HTMLElement
```

**用法示例**：
```ts
addFieldRow(c, '多边形', fmtNumber(triCount));
addFieldRow(c, '顶点', fmtNumber(vertCount));
```

#### `addEmptyRow`

空状态占位行（灰色文字，不可点击）。替代手动 `style.opacity='0.5'` 模式。

```ts
function addEmptyRow(
    parent: HTMLElement,
    text: string,
): HTMLElement
```

**用法示例**：
```ts
if (recent.length === 0) {
    addEmptyRow(c, '暂无最近使用动作');
    return;
}
```

### 3.14 相关 CSS 类索引

| CSS 类 | 作用 | 绑定组件 |
|--------|------|----------|
| `.danger-text` | 红色文字（danger variant） | `slideRow(variant:'danger')` |
| `.accent-text` | 主题色文字（accent variant） | `slideRow(variant:'accent')` |
| `.slide-focused` | 聚焦/选中行高亮 | `slideRow(focused:true)` |
| `.field-label` | 键名样式（加粗/宽） | `addFieldRow` / `rightLabel` |
| `.field-value` | 键值样式（右对齐/窄） | `addFieldRow` / `rightLabel` |
| `.slide-act-btn` | 操作按钮图标按钮 | `actionIcon` / `actionIcons[]` |
| `.slide-act-danger` | 危险操作按钮（红色） | `SlideAction.danger: true` |
| `.slide-item-muted` | 空状态占位行 | `addEmptyRow` |
| `.slide-sublabel-inline` | 内联 sublabel（可截断） | `inlineSub: true` |
| `.toggle-row` | toggle 行容器（flex + 整行点击） | `addToggleRow` |
| `.mode-btn` | 模式按钮 | `addModeRow` |
| `.mode-btn.active` | 模式按钮激活态 | `addModeRow` |
| `.clr-block` | 颜色选择器区块 | `addColorSliderRow` |
| `.clr-swatch` | 色块预览 | `addColorSliderRow` |
| `.collapsible-mat` | 材质面板折叠变体 | `addCollapsible(variant:'mat')` |

---

## 四、界面分层规范

### 4.1 层级划分原则

每个菜单面板按使用频率分为三层：

| 层级 | 内容 | 可见性 |
|------|------|--------|
| **核心层** | 预设按钮、核心控制滑块、模式切换 | 默认展开 |
| **外观层** | 颜色选择、视觉属性 | 默认展开 |
| **高级层** | 低频参数（星空、旋转速度、太阳角度等） | 默认折叠 |

### 4.2 折叠策略

| 控件 | 推荐位置 | 理由 |
|------|----------|------|
| 预设按钮 | 核心层（顶部） | 最高频，一键切换氛围 |
| 模式切换 | 核心层（顶部） | 决定其他控件的显隐 |
| 亮度/强度 | 核心层 | 高频调节 |
| 天空颜色 | 外观层 | 按模式动态显示 |
| 星空 toggle | 高级层（折叠） | 小细节，非每次需要 |
| 太阳角度 | 高级层（折叠） | 新手用预设即可 |
| 灯光同步天空色 | 高级层（折叠） | 高级用户微调用 |
| 天空旋转速度 | 高级层（折叠） | 动画效果，低频 |

---

## 五、待统一清单

以下模块尚未完成卡片化或尚未迁移到新组件体系，按优先级排序：

| 优先级 | 模块 | 当前状态 | 目标 |
|--------|------|----------|------|
| P1 | 模型材质（`model-material.ts`） | 材质专用折叠 | 迁移到 `addCollapsible` |
| P2 | 模型详情（`model-detail.ts`） | 已完成 `addFieldRow`/`addDangerRow`/`slideRow(accent)` 改造 | 残余少量 custom 行 |
| P2 | 动作库弹窗（`motion-popup.ts`） | 已完成 `addEmptyRow` 改造 | 图层行（滑条+双按钮）保持 custom |
| P2 | 设置页（`settings.ts`） | 已完成 `actionIcons[]`/`inlineSub`/`addEmptyRow` 改造 | 残余软件条目 inline style |
| P3 | 服装变体（`outfit-ui.ts`） | 已完成 `slideRow(iconFactory)` 改造 | 已标准化 |
| P3 | 其他遗留界面 | — | 逐步按本规范统一 |

---

## 六、命名约定

| 概念 | 命名 | 示例 |
|------|------|------|
| 组件函数（构建 UI） | `build` + 功能名 + `Level` | `buildEnvUnifiedLevel` |
| 路由处理函数 | `onFolderEnter` | `envOnFolderEnter` |
| 菜单实例变量 | `xxxMenu` | `envMenu`, `sceneMenu` |
| 操作处理函数 | `handle` + 动作 + `Action` | `handleSceneAction` |
| 卡片容器工具 | `cardContainer` | — |
| 折叠组件 | `addCollapsible` | — |
| 模式按钮组 | `addModeRow` | — |
| 模式滑条 | `addModeSlider` | — |
| 预设芯片构建 | `addPresetChip` | — |
| 区块标题构建 | `addSectionTitle` | — |
| 预设组容器 | `preset-group`（class）+ `preset-chip`（子元素） | — |
| 分区标题 | `section-title`（class） | — |
| 危险操作行 | `addDangerRow` | — |
| 字段信息行 | `addFieldRow` | — |
| 空状态占位行 | `addEmptyRow` | — |

---

## 七、变更日志

| 日期 | 变更 |
|------|------|
| 2026-07-05 | 更新 `docs/design.md` 跟进 UI 模块拆分：`ui-helpers.ts` 拆为 `ui-slide-row.ts` / `ui-rows.ts` / `ui-advanced-rows.ts` / `ui-collapsible.ts` / `ui-types.ts`；`slideRow` 新增 `focused` 参数；新增 `addModeRow`、`addPresetChip`、`addSectionTitle` 文档；CSS 类索引补充新类 |
| 2026-06-29 | 完成 `buildEnvUnifiedLevel` 重构，新增 `section-title`、`preset-chip`、`addCollapsible` 体系；`--text` 改为 `#fff` |
| 2026-06-29 | 完成相机模式 `buildCameraLevel` 改造，`cs-row` + 内联参数面板 |
| 2026-06-29 | 完成 `preset-chip` 统一：水面预设、光照预设、场景预设按钮全部升级 |
| 2026-06-29 | 完成 `cardContainer` 工具：`library-core.ts`、`motion-popup.ts`、`settings.ts` |
| 2026-07-05 | 重构完成：`slideRow` 扩展 `variant`/`actionIcons[]`/`iconFactory`/`inlineSub`；新增 `addDangerRow`/`addFieldRow`/`addEmptyRow` 快捷助手；全线替换 6 个菜单文件中的手动 DOM 和 inline style |
