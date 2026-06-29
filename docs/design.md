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

### 3.4 通用折叠 `addCollapsible`

用于将低频/高级参数折叠收起，保持主面板简洁。

**工具函数**：
```ts
addCollapsible(container, {
    title: string;          // 标题文字
    icon?: string;         // Iconify 图标名（如 "lucide:settings"）
    defaultOpen?: boolean; // 默认是否展开（默认 false）
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

### 3.5 分区标题 `section-title`

用于在单卡片内划分语义区块（如「☀️ 光照控制」「🎨 天空外观」）。

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

### 3.6 模式滑条 `addModeSlider`

用于在少量选项间切换（如天空模式：程序化 / 纯色 / 贴图）。

详见 [reusables.md](./reusables.md#addmodeslider)。

### 3.7 标准滑条 `addSliderRow`

详见 [reusables.md](./reusables.md#addsliderrow)。

### 3.8 标准颜色滑条 `addColorSliderRow`

详见 [reusables.md](./reusables.md#addcolorsliderrow)。

### 3.9 标准开关 `addToggleRow`

详见 [reusables.md](./reusables.md#addtogglerow)。

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
| P1 | 模型详情（`model-detail.ts`） | 部分 `lcard` 化 | 全面 `lcard` + `cardContainer` |
| P1 | 模型材质（`model-material.ts`） | 材质专用折叠 | 迁移到 `addCollapsible` |
| P2 | 动作库弹窗（`motion-popup.ts`） | 基本完成 | 验证所有子界面一致性 |
| P2 | 设置页（`settings.ts`） | 基本完成 | 验证所有子界面一致性 |
| P3 | 服装变体（`outfit-ui.ts`） | 待评估 | 待评估是否需要改造 |
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
| 预设组 | `preset-group`（class）+ `preset-chip`（子元素） | — |
| 分区标题 | `section-title`（class） | — |

---

## 七、变更日志

| 日期 | 变更 |
|------|------|
| 2026-06-29 | 完成 `buildEnvUnifiedLevel` 重构，新增 `section-title`、`preset-chip`、`addCollapsible` 体系；`--text` 改为 `#fff` |
| 2026-06-29 | 完成相机模式 `buildCameraLevel` 改造，`cs-row` + 内联参数面板 |
| 2026-06-29 | 完成 `preset-chip` 统一：水面预设、光照预设、场景预设按钮全部升级 |
| 2026-06-29 | 完成 `cardContainer` 工具：`library-core.ts`、`motion-popup.ts`、`settings.ts` |
