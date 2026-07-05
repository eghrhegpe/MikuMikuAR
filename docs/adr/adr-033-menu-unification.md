# ADR-033: 菜单体系大统一 — slideRow + cardContainer + lcard

**日期**: 2026-07-05
> **状态**: 已完成 — 全量迁移完成，所有菜单面板统一为 slideRow/cardContainer 体系，CSS 变量集中管理

---

## 背景

在 2026 年 6 月中旬前，前端的菜单系统由三种不同的"UI 方言"拼凑而成：

| 方言 | 代表 | 症状 |
|------|------|------|
| **直接 DOM** | `createElement('div')` + `style.cssText` | 每个菜单自己写样式、自己的类名，同一个 `.lcard` 选择器在 5 个文件里有 5 种不同实现 |
| **innerHTML 拼接** | `row.innerHTML = '<span>...</span>'` | XSS 风险（打开文件名含特殊字符即破防），无 type-check，错误定位靠眼 |
| **render-card** | 旧弹窗系统遗留 | 与 lcard 体系并存，同一个菜单可能先 render-card 再包 lcard，两层背景色叠加 |

menu 数量从 10 个增长到 30+ 后，每个文件各自写 DOM 的维护成本以 O(n²) 增长：

- **样式无法统一修改**：改一个按钮样式要改 16 个文件
- **新菜单添加成本高**：写新面板先从老文件复制一段 DOM 模板
- **XSS 反复出现**：audit 日志追踪到 4 次 innerHTML 漏洞修复，每次 fix 在某一个文件，其他文件继续爆

## 决策

### 1. 三件套：所有菜单面板统一用同一组工具

| 组件 | 角色 | 逐级特殊化 |
|------|------|-----------|
| `cardContainer()` | 菜单最外层容器，统一 `lcard` 样式 | 通用 |
| `slideRow()` | 菜单行项：图标 + 标签 + 箭头/详情/toggle | ↓ |
| `addToggleRow()` / `addSliderRow()` / `addModeSlider()` / `addColorSliderRow()` | 特化交互控件 | 专用 |

**层级关系**：
```
cardContainer(container, (c) => {
    slideRow(c, icon, label, true, onClick);          // 菜单项
    slideRow(c, icon, label, false, onClick, sublabel); // 带详情
    addToggleRow(c, label, value, onChange, icon);     // 开关
    addSliderRow(c, label, value, min, max, step, onChange, icon); // 滑条
});
```

不在 `cardContainer` 外直接创建 `lcard`，不在面板内手动创建 `slide-item`。

### 2. `slideRow` 承担 90% 的菜单项

`slideRow` 是最重要的统一节点。它替换了此前每个文件各自写的 `createElement('div'); className = 'slide-item'; createElement('span'); className = 'slide-icon'; ...` ~59 处手动 DOM 重建。

核心设计：**一个函数涵盖所有常用菜单行布局**。

```typescript
slideRow(container, icon, label, hasArrow, onClick, sublabel?, tag?, headerToggle?)
```

两种渲染模式：
- 不带 `headerToggle` → 经典 `slide-item` 样式，可选的 `>` 箭头
- 带 `headerToggle` → `collapsible-header` 样式 + 右侧开关 + `▾` 箭头

### 3. CSS 变量集中管理

所有菜单的配色、间距、圆角统一通过 `app.css` 的 CSS 变量控制：

```css
--card-bg, --card-hover, --card-active, --border, --text, --text-dim, --accent
```

不再允许在 `style.cssText` 或内联 `style` 中写死颜色值。组件函数内部使用这些变量，所有面板自动继承主题。

### 4. `updateControls()` 响应式机制（参见 ADR-027）

在统一体系之上，`addToggleRow` / `addSliderRow` 等控件支持 `ControlOptions.bind` 声明取值的来源函数。`updateControls()` 遍历当前菜单的所有注册控件，自动拉取最新值刷新显示，消除手动 `reRenderCustom` 的样板代码。

### 5. 命名规范

| 概念 | 命名 | 示例 |
|------|------|------|
| 菜单构建函数 | `build` + 功能 + `Level` | `buildSkyLevel` |
| 组件函数 | `add` + 组件名 | `addToggleRow` |
| 简化变体 | 去掉 `add` 前缀 | `toggleRow` / `sliderRow` |
| 行样式 | `slide-item` / `collapsible-header` | — |
| 分区标题 | `section-title` | — |

## 不做的事（明确 scope 外）

- **不创建 UI 框架**：不在 React/Vue/Svelte 之间选，DOM 构建函数就是框架。项目用 Wails + WebView2，没有虚拟 DOM 或 DI 容器。
- **不写模板 DSL**：slideRow/addToggleRow 的参数签名就是 DSL，不需要额外的 XML/JSON 配置。
- **不改遗留的第三方菜单**：`model-material.ts` 的部分老代码仍使用旧折叠样式，逐步迁移而非一次性重写。

## 影响

- **新菜单添加成本**：从复制粘贴 30 行 DOM 模板 → 写 3-6 行 `slideRow` / `addSliderRow` 调用
- **全局样式修改**：改 `--card-hover` 一个 CSS 变量，影响全部 30+ 菜单面板
- **XSS 消除**：`slideRow` / `addToggleRow` / `addSliderRow` 全部使用 `textContent` 而非 `innerHTML`，新建的菜单项天然免疫 XSS
- **审计友好**：`cardContainer` / `slideRow` 可以单点加日志或监控，不需要改 16 个文件
- **历史痕迹**：迁入统一体系前的老文件仍有 `style.cssText` / `innerHTML` 残留，audit 清单中标记为 P1/P2 逐步清理
