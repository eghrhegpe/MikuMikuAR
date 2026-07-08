// [doc:architecture] VirtualGrid — 虚拟滚动网格组件
// 只渲染可见行 ± 缓冲，减少 DOM 节点

// ======== Types ========

export interface VirtualGridOptions<T> {
    /** 全部数据 */
    items: T[];
    /** 每项高度（固定，px） */
    itemHeight: number;
    /** 列数 */
    columns: number;
    /** 渲染单项的工厂函数 */
    renderItem: (item: T, index: number) => HTMLElement;
    /** 缓冲行数 */
    bufferRows?: number;
}

export interface VirtualGridHandle<T> {
    /** 更新数据源 */
    updateItems: (items: T[]) => void;
    /** 更新列数 */
    setColumns: (columns: number) => void;
    /** 滚动到顶部 */
    scrollToTop: () => void;
    /** 销毁 */
    dispose: () => void;
}

// ======== Main Component ========

export function createVirtualGrid<T>(
    container: HTMLElement,
    options: VirtualGridOptions<T>
): VirtualGridHandle<T> {
    const {
        items: initialItems,
        itemHeight,
        columns,
        renderItem,
        bufferRows = 2,
    } = options;

    // 状态
    let currentItems = [...initialItems];
    let currentColumns = columns;
    let scrollTop = 0;

    // 计算
    const getRowsCount = () => Math.ceil(currentItems.length / currentColumns);
    const getRowHeight = () => itemHeight;
    const getVisibleRows = () => Math.ceil(container.clientHeight / getRowHeight());
    const getTotalHeight = () => getRowsCount() * getRowHeight();

    // 创建容器
    const wrapper = document.createElement('div');
    wrapper.className = 'virtual-grid-wrapper';
    wrapper.style.cssText = `
        position: relative;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
    `;
    container.appendChild(wrapper);

    // 创建内容区（用于撑开滚动高度）
    const content = document.createElement('div');
    content.className = 'virtual-grid-content';
    content.style.cssText = `
        position: relative;
        width: 100%;
        height: ${getTotalHeight()}px;
    `;
    wrapper.appendChild(content);

    // 渲染行
    function renderVisibleRows(): void {
        const startRow = Math.max(0, Math.floor(scrollTop / getRowHeight()) - bufferRows);
        const endRow = Math.min(
            getRowsCount(),
            Math.ceil((scrollTop + container.clientHeight) / getRowHeight()) + bufferRows
        );

        // 清空现有内容
        content.innerHTML = '';

        // 渲染可见行
        for (let row = startRow; row < endRow; row++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'virtual-grid-row';
            rowDiv.style.cssText = `
                position: absolute;
                top: ${row * getRowHeight()}px;
                left: 0;
                right: 0;
                height: ${getRowHeight()}px;
                display: grid;
                grid-template-columns: repeat(${currentColumns}, 1fr);
                gap: var(--resource-gap);
                padding: 0 var(--resource-gap);
            `;

            // 渲染该行的项
            for (let col = 0; col < currentColumns; col++) {
                const index = row * currentColumns + col;
                if (index < currentItems.length) {
                    const itemEl = renderItem(currentItems[index], index);
                    itemEl.style.height = `${getRowHeight() - 8}px`; // 减去 gap
                    rowDiv.appendChild(itemEl);
                } else {
                    // 空位占位
                    const placeholder = document.createElement('div');
                    rowDiv.appendChild(placeholder);
                }
            }

            content.appendChild(rowDiv);
        }
    }

    // 滚动事件
    let rafId: number | null = null;
    wrapper.addEventListener('scroll', () => {
        scrollTop = wrapper.scrollTop;
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
            renderVisibleRows();
            rafId = null;
        });
    });

    // 初始渲染
    renderVisibleRows();

    // 返回句柄
    return {
        updateItems: (newItems: T[]) => {
            currentItems = [...newItems];
            content.style.height = `${getTotalHeight()}px`;
            renderVisibleRows();
        },
        setColumns: (newColumns: number) => {
            if (currentColumns !== newColumns) {
                currentColumns = newColumns;
                content.style.height = `${getTotalHeight()}px`;
                renderVisibleRows();
            }
        },
        scrollToTop: () => {
            wrapper.scrollTop = 0;
        },
        dispose: () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
            }
            wrapper.remove();
        },
    };
}
