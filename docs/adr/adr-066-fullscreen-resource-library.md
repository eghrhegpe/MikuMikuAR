# ADR-066: 全屏资源库界面（精简版）

> **状态**: ✅ 已实施（Phase 1-4）
> **关联**: ADR-034（菜单统一）、ADR-045（统一加载）
> **恢复/记忆行为**: 见上层汇总 ADR-097（模型记忆优先 + 文件夹记忆回退，统一恢复链路）

---

## 问题

`slideRow` 纯文本行（~36px 高）无法显示缩略图；模型库纯文字列表用户无法快速识别模型外观。

**目标**：可选全屏/半屏资源浏览模式，缩略图网格展示，与 SlideMenu 侧边栏共存。

---

## 方案选择

| 方案 | 结论 |
|------|------|
| A: 扩展 slideRow 加缩略图 | ❌ 行高固定无法显示有意义预览 |
| B: 全屏 Overlay + 独立网格 | ⚠️ 工作量大，独立导航逻辑 |
| C: SlideMenu 内嵌 renderCustom | ⚠️ 宽度固定~320px，全屏体验差 |
| **D: 可切换面板（推荐）** | ✅ 渐进式（嵌入→全屏），复用 SlideMenu 导航 |

---

## 架构要点

### 三模式状态机

```
CLOSED → [点击网格按钮] → EMBEDDED_GRID（侧边栏内）
  → [点击展开] → FULLSCREEN（position:fixed，SlideMenu冻结）
  → [Escape/点击背景/关闭] → EMBEDDED_GRID
  → [点击列表] → CLOSED（恢复slideRow列表）
```

**关键**：全屏时 SlideMenu DOM 不销毁仅隐藏，关闭时原样恢复。

### 导航集成

`ResourcePanel` 不维护独立导航状态，所有导航操作通过 `CustomEvent` 冒泡到 SlideMenu：

```ts
// ResourcePanel 内部
container.dispatchEvent(new CustomEvent('enterFolder', { detail: { path } }));
container.dispatchEvent(new CustomEvent('back', { detail: {} }));
// SlideMenu 监听
container.addEventListener('enterFolder', (e) => stack.push(buildLevel(...)));
```

### 视图切换保留 filter

```ts
function switchViewMode(mode: 'grid' | 'list'): void {
    const currentFilter = currentLevel?.filter;
    replaceCurrentLevel(buildLevel(currentLevel.dir, currentLevel.label, currentFilter));
}
```

### 虚拟滚动

`IntersectionObserver` + 占位元素，只渲染可见行 ± 1 行缓冲，500+ 模型时 DOM 节点可控。

---

## 组件接口

```ts
interface ResourcePanelOptions {
    items: LibraryModel[];
    thumbnailCache: Map<string, string>;
    onSelect: (model: LibraryModel) => void;
    layout?: 'grid' | 'list';
    columns?: number;
}
```

---

## 实施路线

| Phase | 内容 |
|-------|------|
| Phase 1 | `ui-resource-panel.ts` 基础网格 + `IntersectionObserver` 懒加载 |
| Phase 2 | `ui-virtual-grid.ts` 虚拟滚动 + library-core 集成 + 视图切换 |
| Phase 3 | `ui-fullscreen-overlay.ts` 全屏容器 + SlideMenu 冻结/恢复 |
| Phase 4 | 缩略图预加载 + 视图模式持久化 + 搜索集成 |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 全屏与 SlideMenu 状态同步 | DOM 不销毁，仅隐藏/显示 |
| 视图切换丢失 filter | `buildLevel` 传递 filter 参数 |
| 移动端适配 | 响应式列数：320px→2列，768px→4列，1024px→6列 |
| 缩略图未生成 | fallback 到 Iconify 图标 |
