# ADR-066: 全屏资源库界面

> **状态**: 已实施（Phase 1-4）
> **关联**: ADR-034（菜单统一）、ADR-045（统一加载）

---

## 一、问题

当前模型库使用 `SlideMenu` 侧边栏 + `slideRow` 行组件。`slideRow` 是**纯文本行**（图标 + 标签 + 箭头），无法显示缩略图。

| 痛点 | 影响 |
|------|------|
| 缩略图基础设施完整但未接入 UI | `thumbnailCache` 被填充但从未渲染 |
| `slideRow` 尺寸固定（~36px 高） | 无法显示有意义的预览图 |
| 模型库纯文字列表 | 用户无法快速识别模型外观 |
| 文件夹层级导航 | 大量模型时点击次数多 |

**目标**：提供可选的全屏/半屏资源浏览模式，支持缩略图网格展示，与现有 SlideMenu 侧边栏共存。

---

## 二、方案对比

### 方案 A：扩展 `slideRow` 支持缩略图

在 `slideRow` 增加 `thumbnailUrl` 可选参数，行内显示小图。

```
优点：改动最小，复用现有组件
缺点：36px 行高无法显示有意义的预览；网格布局无法实现
结论：❌ 不解决核心问题
```

### 方案 B：全屏 Overlay + 网格布局

新增 `FullscreenLibrary` 组件，独立于 SlideMenu，覆盖整个 viewport。

```
优点：完全自由的布局；可支持网格/列表切换；缩略图完整显示
缺点：新组件，工作量大；与 SlideMenu 导航逻辑独立
结论：✅ 功能完整，但需评估工作量
```

### 方案 C：SlideMenu 内嵌 `renderCustom` 网格

在 SlideMenu 的 `renderCustom` 回调中渲染网格，复用 SlideMenu 的导航栈。

```
优点：复用 SlideMenu 导航；可从侧边栏切换触发
缺点：SlideMenu 宽度固定（~320px），网格列数受限；全屏体验差
结论：⚠️ 折中方案，适合 MVP
```

### 方案 D：可切换面板（推荐）

新增 `ResourcePanel` 组件，可从 SlideMenu 侧边栏触发，支持**嵌入模式**（侧边栏内网格）和**展开模式**（全屏覆盖）。

```
优点：
  - 渐进式：MVP 先做嵌入模式，后续扩展全屏
  - 复用 SlideMenu 导航栈（文件夹进入/返回）
  - 缩略图网格在 320px 宽度内仍可显示 2-3 列
  - 全屏模式可复用同一数据源

缺点：
  - 需要新增 `renderCustom` 网格渲染逻辑
  - 需要虚拟滚动处理大量模型
结论：✅ 推荐
```

---

## 三、推荐方案：方案 D

### 3.1 核心前提：互斥切换

**网格模式和列表模式是互斥的视图切换，不是共存。** `renderCustom` 渲染时，根据当前 `resourceViewMode` 选择渲染路径：

```typescript
renderCustom: (container) => {
    if (resourceViewMode === 'grid') {
        createResourcePanel(container, { ... });  // 网格路径
    } else {
        cardContainer(container, (card) => {
            renderItemsWithRAF(card, items, filter, targetStack);  // 列表路径
        });
    }
},
```

两种模式共享同一份 `items` 数据，只是渲染方式不同。切换视图时通过 `replaceCurrentLevel` 重建层级，**但必须保留 filter 状态**（见 3.6）。

### 3.2 架构设计

```
嵌入模式（侧边栏内）：
┌─────────────────────────────────────┐
│  SlideMenu                          │
│  ┌─────────────────────────────────┐│
│  │ [模型库] [最近] [收藏] ...      ││
│  │─────────────────────────────────││
│  │  ResourcePanel                  ││
│  │  ┌─────┐ ┌─────┐ ┌─────┐      ││
│  │  │ 🖼️ │ │ 🖼️ │ │ 🖼️ │      ││
│  │  └─────┘ └─────┘ └─────┘      ││
│  │  [🔍 搜索] [⊞ 展开全屏]       ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘

全屏模式（position: fixed 覆盖）：
┌─────────────────────────────────────┐
│ ← 返回   模型库 / 初音ミク   🔍    │
│─────────────────────────────────────│
│  ┌───────┐ ┌───────┐ ┌───────┐    │
│  │  🖼️  │ │  🖼️  │ │  🖼️  │    │
│  └───────┘ └───────┘ └───────┘    │
│  ┌───────┐ ┌───────┐ ┌───────┐    │
│  │  🖼️  │ │  🖼️  │ │  🖼️  │    │
│  └───────┘ └───────┘ └───────┘    │
└─────────────────────────────────────┘

全屏 Overlay 显示策略：
  - position: fixed, z-index 覆盖 SlideMenu
  - SlideMenu 导航栈冻结（不销毁，仅隐藏）
  - 关闭全屏后 SlideMenu 状态原样恢复
```

### 3.3 全屏 Overlay 实现

```typescript
// ui-fullscreen-overlay.ts

interface FullscreenOverlayOptions {
    /** 渲染内容的工厂函数 */
    renderContent: (container: HTMLElement) => void;
    /** 标题 */
    title: string;
    /** 返回回调 */
    onBack: () => void;
}

function openFullscreenOverlay(options: FullscreenOverlayOptions): FullscreenOverlayHandle {
    // 1. 创建 fixed 覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';
    // position: fixed; inset: 0; z-index: 1000; background: var(--bg);
    
    // 2. 顶部栏：返回按钮 + 标题
    const header = document.createElement('div');
    header.className = 'fullscreen-header';
    // ... 渲染返回按钮和标题
    
    // 3. 内容区
    const content = document.createElement('div');
    content.className = 'fullscreen-content';
    options.renderContent(content);
    
    // 4. SlideMenu 冻结（不销毁，仅隐藏）
    // SlideMenu 的 DOM 不移除，保持导航栈状态
    
    // 5. 返回句柄
    return {
        close: () => {
            overlay.remove();
            // SlideMenu 恢复显示
        }
    };
}
```

### 3.3.1 状态机

全屏 Overlay 的生命周期由一个集中状态机管理，所有关闭入口（Escape / Overlay 背景点击 / 自定义关闭按钮）统一调用 `closeOverlay()`，避免重复/遗漏。

```
CLOSED (初始)
  │
  ▼ [点击网格视图按钮]
EMBEDDED_GRID (侧边栏内网格)
  │
  ▼ [点击展开按钮]
FULLSCREEN (position: fixed, SlideMenu frozen)
  │
  ▼ [Escape / Overlay 背景点击 / 关闭按钮]
EMBEDDED_GRID (SlideMenu 恢复显示)
  │
  ▼ [点击列表视图按钮]
CLOSED (恢复原有 slideRow 列表)
```

```typescript
// ui-fullscreen-overlay.ts — 状态管理

type OverlayState = 'CLOSED' | 'EMBEDDED_GRID' | 'FULLSCREEN';

let currentState: OverlayState = 'CLOSED';
let currentOverlay: FullscreenOverlayHandle | null = null;

function openFullscreen(): void {
    if (currentState !== 'EMBEDDED_GRID') return;
    
    currentOverlay = openFullscreenOverlay({
        title: getCurrentTitle(),
        onBack: () => closeFullscreen(),
        renderContent: (container) => { /* 渲染网格 */ },
    });
    freezeSlideMenu();  // 隐藏 SlideMenu DOM，保持状态
    currentState = 'FULLSCREEN';
}

function closeFullscreen(): void {
    if (currentState !== 'FULLSCREEN') return;
    
    currentOverlay?.close();
    currentOverlay = null;
    unfreezeSlideMenu();  // 恢复 SlideMenu DOM 显示
    currentState = 'EMBEDDED_GRID';
}

// 所有关闭入口统一调用
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentState === 'FULLSCREEN') {
        closeFullscreen();  // 唯一出口
    }
});

// Overlay 背景点击
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        closeFullscreen();  // 唯一出口
    }
});
```

### 3.4 导航集成：事件冒泡

**`ResourcePanel` 不维护独立导航状态。** 所有导航操作通过事件冒泡到 SlideMenu：

```typescript
// ResourcePanel 的事件设计
interface ResourcePanelEvents {
    /** 用户点击文件夹 → 冒泡到 SlideMenu 执行 stack.push */
    enterFolder: CustomEvent<{ path: string }>;
    /** 用户点击返回 → 冒泡到 SlideMenu 执行 stack.pop */
    back: CustomEvent<void>;
    /** 用户点击模型 → 执行加载 */
    select: CustomEvent<{ model: LibraryModel }>;
}

// ResourcePanel 内部
function onFolderClick(path: string): void {
    container.dispatchEvent(new CustomEvent('enterFolder', { detail: { path } }));
}

// SlideMenu 监听
container.addEventListener('enterFolder', (e) => {
    const { path } = e.detail;
    this.stack.push(buildLevel(path, ...));
});
```

**全屏模式下的返回行为**：
- 点击"返回" → 关闭全屏 Overlay → SlideMenu 恢复显示（导航栈冻结状态）
- 点击文件夹 → 在全屏内导航（如果全屏模式也需要文件夹导航）

### 3.5 虚拟滚动：Phase 2

**虚拟滚动必须在嵌入模式就实现**，否则 500+ 模型时 DOM 节点过多导致卡顿。

```typescript
// ui-virtual-grid.ts

interface VirtualGridOptions {
    /** 全部数据 */
    items: LibraryModel[];
    /** 每项高度（固定） */
    itemHeight: number;
    /** 列数 */
    columns: number;
    /** 渲染单项的工厂函数 */
    renderItem: (item: LibraryModel) => HTMLElement;
}

function createVirtualGrid(
    container: HTMLElement,
    options: VirtualGridOptions
): VirtualGridHandle {
    // 使用 IntersectionObserver + 占位元素
    // 只渲染可见行 ± 1 行缓冲
    
    const rowHeight = options.itemHeight;
    const visibleRows = Math.ceil(container.clientHeight / rowHeight);
    const buffer = 1;
    
    // 滚动时动态替换内容
    let scrollTop = 0;
    container.addEventListener('scroll', () => {
        scrollTop = container.scrollTop;
        renderVisibleRows(scrollTop, visibleRows, buffer);
    });
    
    return { updateItems, dispose };
}
```

### 3.6 视图切换：保留 Filter 状态

`replaceCurrentLevel` 重建层级时，必须传递当前 filter 状态：

```typescript
// library-core.ts

function buildLevel(
    dir: string,
    label: string,
    filter?: (m: LibraryModel) => boolean,  // 保留 filter 参数
    targetStack?: SlideMenu
): PopupLevel {
    return {
        label,
        dir,
        items: [],
        renderCustom: (container) => {
            // 获取当前目录下的模型（已过滤）
            const currentModels = getModelsForDir(dir, filter);
            
            if (resourceViewMode === 'grid') {
                createResourcePanel(container, {
                    items: currentModels,
                    thumbnailCache,
                    onSelect: onModelRowClick,
                    onEnterFolder: (path) => {
                        // 保持 filter 传递
                        stack.push(buildLevel(path, getFolderName(path), filter, stack));
                    },
                    onBack: () => stack.pop(),
                });
            } else {
                cardContainer(container, (card) => {
                    renderItemsWithRAF(card, items, filter, targetStack);
                });
            }
        },
    };
}

// 视图切换时保留 filter
function switchViewMode(mode: 'grid' | 'list'): void {
    setResourceViewMode(mode);
    const currentLevel = currentSlideMenu.currentLevel;
    // 从当前 level 提取 filter（如果有）
    const currentFilter = currentLevel?.filter;
    replaceCurrentLevel(
        buildLevel(currentLevel.dir, currentLevel.label, currentFilter)
    );
}
```

### 3.7 组件接口

```typescript
// 新增：ui-resource-panel.ts

interface ResourcePanelOptions {
    /** 数据源：模型列表（已过滤） */
    items: LibraryModel[];
    /** 缩略图缓存 */
    thumbnailCache: Map<string, string>;
    /** 点击回调 */
    onSelect: (model: LibraryModel) => void;
    /** 布局模式 */
    layout?: 'grid' | 'list';
    /** 网格列数（自适应） */
    columns?: number;
}

function createResourcePanel(
    container: HTMLElement,
    options: ResourcePanelOptions
): ResourcePanelHandle {
    // 返回句柄：updateItems(), setLayout(), dispose()
    // 导航通过 CustomEvent 冒泡，不维护独立状态
}
```

---

## 四、实施路线

### Phase 1：基础设施（~2 天）

- [ ] 新增 `ui-resource-panel.ts` 组件
- [ ] 实现 `createResourcePanel()` 基础网格渲染
- [ ] 实现 `IntersectionObserver` 懒加载
- [ ] CSS 变量：`--resource-thumb-size`、`--resource-gap`

### Phase 2：嵌入模式 + 虚拟滚动（~2 天）

- [ ] 新增 `ui-virtual-grid.ts` 虚拟滚动
- [ ] `library-core.ts` 集成 `ResourcePanel`
- [ ] 视图切换按钮（grid/list），保留 filter 状态
- [ ] 文件夹导航通过 CustomEvent 冒泡到 SlideMenu

### Phase 3：全屏模式（~2 天）

- [ ] 新增 `ui-fullscreen-overlay.ts` 全屏容器
- [ ] 从嵌入模式展开/收起动画
- [ ] SlideMenu 导航栈冻结/恢复机制
- [ ] 键盘导航（方向键 + Enter）

### Phase 4：优化（~1 天）

- [ ] 缩略图预加载（相邻页面）
- [ ] 视图模式持久化到 config
- [ ] 搜索栏集成（复用现有搜索逻辑）

---

## 五、边界与风险

| 风险 | 缓解 |
|------|------|
| 虚拟滚动复杂度 | Phase 2 实现，保证嵌入模式可用 |
| 全屏与 SlideMenu 状态同步 | SlideMenu 导航栈冻结，不销毁 DOM |
| 视图切换丢失 filter | `buildLevel` 保留 filter 参数，切换时传递 |
| 移动端适配 | 响应式列数：320px→2列，768px→4列，1024px→6列 |
| 缩略图未生成 | fallback 到 Iconify 图标（现有行为） |

---

## 六、验证

1. 侧边栏模型库 → 切换 grid 模式 → 显示缩略图网格
2. 搜索过滤 → 切换 list/grid → filter 条件保留
3. 点击文件夹 → 进入子目录 → 返回按钮正常
4. 点击展开按钮 → 全屏覆盖 → SlideMenu 冻结
5. 全屏模式搜索 → 实时过滤
6. 关闭全屏 → SlideMenu 恢复，导航栈完整
7. 500+ 模型 → 滚动无卡顿（虚拟滚动）
8. `npm run check && npm run test && npm run build` 全绿
