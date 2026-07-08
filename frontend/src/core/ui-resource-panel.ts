// [doc:architecture] ResourcePanel — 缩略图网格组件
// 支持网格/列表布局，IntersectionObserver 懒加载
// [doc:adr-066] 大数据量时使用 VirtualGrid 虚拟滚动

import { createIconifyIcon } from './icons';
import { createVirtualGrid, type VirtualGridHandle } from './ui-virtual-grid';

// ======== Types ========

export interface ResourcePanelOptions {
    /** 数据源：模型列表 */
    items: ResourceItem[];
    /** 缩略图缓存 */
    thumbnailCache: Map<string, string>;
    /** 点击回调 */
    onSelect: (item: ResourceItem) => void;
    /** 文件夹进入回调 */
    onEnterFolder?: (path: string) => void;
    /** 布局模式 */
    layout?: 'grid' | 'list';
    /** 网格列数（自适应，0=自动） */
    columns?: number;
    /** 单项高度（网格模式，px） */
    itemHeight?: number;
}

export interface ResourceItem {
    /** 唯一标识 */
    id: string;
    /** 显示名称 */
    label: string;
    /** 文件路径（用于缩略图缓存） */
    filePath: string;
    /** 图标名称（fallback） */
    icon: string;
    /** 是否为文件夹 */
    isFolder?: boolean;
    /** 子标签 */
    sublabel?: string;
    /** 原始数据 */
    data?: unknown;
}

export interface ResourcePanelHandle {
    /** 更新数据源 */
    updateItems: (items: ResourceItem[]) => void;
    /** 切换布局 */
    setLayout: (layout: 'grid' | 'list') => void;
    /** 销毁 */
    dispose: () => void;
}

// ======== CSS Variables ========

const CSS_VARS = `
    --resource-thumb-size: 80px;
    --resource-gap: 8px;
    --resource-radius: 8px;
    --resource-label-height: 20px;
`;

// ======== Main Component ========

/** 超过此数量时启用虚拟滚动 */
const VIRTUAL_THRESHOLD = 50;

export function createResourcePanel(
    container: HTMLElement,
    options: ResourcePanelOptions
): ResourcePanelHandle {
    const {
        items,
        thumbnailCache,
        onSelect,
        onEnterFolder,
        layout = 'grid',
        columns = 0,
        itemHeight = 120,
    } = options;

    // 状态
    let currentItems = [...items];
    let currentLayout = layout;
    let observer: IntersectionObserver | null = null;
    let virtualGrid: VirtualGridHandle<ResourceItem> | null = null;

    // 创建容器
    const panel = document.createElement('div');
    panel.className = 'resource-panel';
    panel.style.cssText = CSS_VARS;
    container.appendChild(panel);

    // 清理虚拟滚动和观察器
    function cleanup(): void {
        if (virtualGrid) {
            virtualGrid.dispose();
            virtualGrid = null;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    // 渲染
    function render(): void {
        cleanup();
        panel.innerHTML = '';

        if (currentLayout === 'grid' && currentItems.length > VIRTUAL_THRESHOLD) {
            virtualGrid = createVirtualGridFromItems(panel, currentItems, thumbnailCache, onSelect, onEnterFolder, itemHeight);
        } else if (currentLayout === 'grid') {
            renderGrid(panel, currentItems, thumbnailCache, onSelect, onEnterFolder, itemHeight);
        } else {
            renderList(panel, currentItems, thumbnailCache, onSelect, onEnterFolder);
        }
    }

    // 初始化观察器
    observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const el = entry.target as HTMLElement;
                    const path = el.dataset.resourcePath;
                    if (path && thumbnailCache.has(path)) {
                        el.style.backgroundImage = `url(data:image/png;base64,${thumbnailCache.get(path)})`;
                    }
                    observer?.unobserve(el);
                }
            }
        },
        { rootMargin: '200px' }
    );

    // 初始渲染
    render();

    // 返回句柄
    return {
        updateItems: (newItems: ResourceItem[]) => {
            currentItems = [...newItems];
            render();
        },
        setLayout: (newLayout: 'grid' | 'list') => {
            if (currentLayout !== newLayout) {
                currentLayout = newLayout;
                render();
            }
        },
        dispose: () => {
            cleanup();
            panel.remove();
        },
    };
}

// ======== Virtual Grid Rendering [doc:adr-066] ========

function createVirtualGridFromItems(
    container: HTMLElement,
    items: ResourceItem[],
    cache: Map<string, string>,
    onSelect: (item: ResourceItem) => void,
    onEnterFolder?: (path: string) => void,
    itemHeight: number = 120
): VirtualGridHandle<ResourceItem> {
    // 计算列数：基于容器宽度
    const thumbSize = 80; // --resource-thumb-size
    const gap = 8; // --resource-gap
    const cols = Math.max(1, Math.floor((container.clientWidth || 280) / (thumbSize + gap)));

    return createVirtualGrid<ResourceItem>(container, {
        items,
        itemHeight,
        columns: cols,
        renderItem: (item) => createGridCard(item, cache, onSelect, onEnterFolder, itemHeight),
        bufferRows: 2,
    });
}

// ======== Grid Rendering ========

function renderGrid(
    container: HTMLElement,
    items: ResourceItem[],
    cache: Map<string, string>,
    onSelect: (item: ResourceItem) => void,
    onEnterFolder?: (path: string) => void,
    itemHeight: number = 120
): void {
    const grid = document.createElement('div');
    grid.className = 'resource-grid';
    grid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(var(--resource-thumb-size), 1fr));
        gap: var(--resource-gap);
        padding: var(--resource-gap);
    `;

    for (const item of items) {
        const card = createGridCard(item, cache, onSelect, onEnterFolder, itemHeight);
        grid.appendChild(card);
    }

    container.appendChild(grid);
}

function createGridCard(
    item: ResourceItem,
    cache: Map<string, string>,
    onSelect: (item: ResourceItem) => void,
    onEnterFolder?: (path: string) => void,
    itemHeight: number = 120
): HTMLElement {
    const card = document.createElement('div');
    card.className = 'resource-card';
    card.style.cssText = `
        background: var(--card-bg);
        border: 1px solid var(--white-08);
        border-radius: var(--resource-radius);
        overflow: hidden;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
    `;

    // 缩略图区域
    const thumb = document.createElement('div');
    thumb.className = 'resource-thumb';
    thumb.dataset.resourcePath = item.filePath;
    thumb.style.cssText = `
        width: 100%;
        height: ${itemHeight - 40}px;
        background: var(--bg-overlay-alt);
        background-size: cover;
        background-position: center;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // 缩略图或 fallback 图标
    if (cache.has(item.filePath)) {
        thumb.style.backgroundImage = `url(data:image/png;base64,${cache.get(item.filePath)})`;
    } else {
        const iconEl = createIconifyIcon(item.isFolder ? 'folder' : item.icon);
        if (iconEl) {
            iconEl.style.cssText = 'width: 32px; height: 32px; opacity: 0.5;';
            thumb.appendChild(iconEl);
        }
    }

    // 标签
    const label = document.createElement('div');
    label.className = 'resource-label';
    label.style.cssText = `
        padding: 6px 8px;
        font-size: var(--font-ui-sm);
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;
    label.textContent = item.label;
    label.title = item.label;

    card.appendChild(thumb);
    card.appendChild(label);

    // 点击事件
    card.addEventListener('click', () => {
        if (item.isFolder && onEnterFolder) {
            onEnterFolder(item.id);
        } else {
            onSelect(item);
        }
    });

    // Hover 效果
    card.addEventListener('mouseenter', () => {
        card.style.background = 'var(--card-hover)';
        card.style.borderColor = 'var(--white-16)';
    });
    card.addEventListener('mouseleave', () => {
        card.style.background = 'var(--card-bg)';
        card.style.borderColor = 'var(--white-08)';
    });

    return card;
}

// ======== List Rendering ========

function renderList(
    container: HTMLElement,
    items: ResourceItem[],
    cache: Map<string, string>,
    onSelect: (item: ResourceItem) => void,
    onEnterFolder?: (path: string) => void
): void {
    const list = document.createElement('div');
    list.className = 'resource-list';
    list.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--resource-gap);
    `;

    for (const item of items) {
        const row = createListRow(item, cache, onSelect, onEnterFolder);
        list.appendChild(row);
    }

    container.appendChild(list);
}

function createListRow(
    item: ResourceItem,
    cache: Map<string, string>,
    onSelect: (item: ResourceItem) => void,
    onEnterFolder?: (path: string) => void
): HTMLElement {
    const row = document.createElement('div');
    row.className = 'resource-row';
    row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--card-bg);
        border: 1px solid var(--white-08);
        border-radius: var(--resource-radius);
        cursor: pointer;
        transition: background 0.15s;
    `;

    // 缩略图（小尺寸）
    const thumb = document.createElement('div');
    thumb.className = 'resource-thumb-sm';
    thumb.dataset.resourcePath = item.filePath;
    thumb.style.cssText = `
        width: 40px;
        height: 40px;
        border-radius: 4px;
        background: var(--bg-overlay-alt);
        background-size: cover;
        background-position: center;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    if (cache.has(item.filePath)) {
        thumb.style.backgroundImage = `url(data:image/png;base64,${cache.get(item.filePath)})`;
    } else {
        const iconEl = createIconifyIcon(item.isFolder ? 'folder' : item.icon);
        if (iconEl) {
            iconEl.style.cssText = 'width: 20px; height: 20px; opacity: 0.5;';
            thumb.appendChild(iconEl);
        }
    }

    // 标签
    const label = document.createElement('div');
    label.style.cssText = `
        flex: 1;
        font-size: var(--font-ui);
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;
    label.textContent = item.label;

    // 子标签
    if (item.sublabel) {
        const sub = document.createElement('span');
        sub.style.cssText = `
            font-size: var(--font-ui-sm);
            color: var(--text-dim);
            margin-left: 8px;
        `;
        sub.textContent = item.sublabel;
        label.appendChild(sub);
    }

    // 箭头
    if (item.isFolder) {
        const arrow = document.createElement('span');
        arrow.style.cssText = 'color: var(--text-dim); font-size: 12px;';
        arrow.textContent = '›';
        row.appendChild(arrow);
    }

    row.appendChild(thumb);
    row.appendChild(label);

    // 点击事件
    row.addEventListener('click', () => {
        if (item.isFolder && onEnterFolder) {
            onEnterFolder(item.id);
        } else {
            onSelect(item);
        }
    });

    // Hover 效果
    row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--card-hover)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'var(--card-bg)';
    });

    return row;
}
