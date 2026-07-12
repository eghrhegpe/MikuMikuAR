// [doc:architecture] Preset List Viewer — 通用预设列表组件
// 提取 scene-render-levels (场景预设) 和 model-preset (模型预设) 的共有模式：
//   异步加载列表 → 行渲染 → 点击应用 → 删除确认 → 空状态
// 特化需求通过 extraActions 插槽注入（如模型预设的 autoApply toggle）。
// 提供两个入口：
//   buildPresetListLevel — 返回完整 PopupLevel（纯预设列表场景）
//   presetListContent   — 渲染到现有容器（混合内容的 PopupLevel）

import type { PopupLevel } from '../core/config';
import { cardContainer, setStatus } from '../core/config';
import { showConfirm } from '../core/dialog';

export interface PresetListViewerConfig<T> {
    /** 子菜单标题（仅 buildPresetListLevel 用） */
    label?: string;
    /**
     * 异步加载列表数据。
     * 当传入了 preloadedItems 时可省略。
     */
    loadItems?: () => Promise<T[]>;
    /** 获取行标签文字 */
    getLabel: (item: T) => string;
    /** 点击行时触发（应用预设） */
    onApply: (item: T) => Promise<void>;

    /** 行标识 key（默认 getLabel） */
    getKey?: (item: T) => string;
    /** 行图标 iconify 名（默认 "lucide:bookmark"） */
    getIcon?: (item: T) => string;
    /** 副标签文字 */
    getSublabel?: (item: T) => string;
    /**
     * 删除回调。成功时正常返回，失败时抛出异常。
     * 组件据此决定是否触发 onReRender。
     */
    onDelete?: (item: T) => Promise<void>;
    /** 删除确认文本 */
    deleteConfirmText?: (item: T) => string;
    /** 空状态提示文字 */
    emptyText?: string;
    /** 特化操作插槽（如 autoApply toggle），注入到 label 后、删除按钮前 */
    extraActions?: (item: T) => HTMLElement | null;
}

/** 渲染预设列表内容到现有 container 中。用于混合内容的 PopupLevel（场景预设） */
export async function presetListContent<T>(
    container: HTMLElement,
    config: PresetListViewerConfig<T>,
    onReRender: () => void,
    /** 预加载的 items——跳过 loadItems 避免重复请求 */
    preloadedItems?: T[]
): Promise<void> {
    container.classList.remove('render-card');

    const items: T[] = preloadedItems ?? (await config.loadItems?.().catch(() => [])) ?? [];

    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText =
            'font-size:12px;color:var(--text-dim);text-align:center;padding:24px;';
        empty.textContent = config.emptyText || '暂无预设';
        container.appendChild(empty);
        return;
    }

    cardContainer(container, (c) => {
        for (const item of items) {
            const iconName = config.getIcon?.(item) ?? 'lucide:bookmark';

            const row = document.createElement('div');
            row.className = 'slide-item';

            // Icon
            const iconSpan = document.createElement('span');
            iconSpan.className = 'slide-icon';
            const iconify = document.createElement('iconify-icon');
            iconify.icon = iconName;
            iconSpan.appendChild(iconify);
            row.appendChild(iconSpan);

            // Label
            const labelSpan = document.createElement('span');
            labelSpan.className = 'slide-label';
            labelSpan.textContent = config.getLabel(item);
            row.appendChild(labelSpan);

            // Sublabel
            const sub = config.getSublabel?.(item);
            if (sub) {
                const subSpan = document.createElement('span');
                subSpan.style.cssText = 'font-size:11px;color:var(--text-dim);margin-right:4px;';
                subSpan.textContent = sub;
                row.appendChild(subSpan);
            }

            // Extra actions (autoApply toggle etc.)
            const extra = config.extraActions?.(item);
            if (extra) {
                row.appendChild(extra);
            }

            // Delete button
            if (config.onDelete) {
                const delBtn = document.createElement('span');
                delBtn.textContent = '✕';
                delBtn.title = '删除';
                delBtn.style.cssText =
                    'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 6px;';
                delBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    const msg =
                        config.deleteConfirmText?.(item) ??
                        `确定删除「${config.getLabel(item)}」？`;
                    if (!(await showConfirm(msg))) {
                        return;
                    }
                    try {
                        await config.onDelete!(item);
                        onReRender();
                    } catch (e) {
                        console.warn('[PresetListViewer] onDelete failed:', e);
                    }
                });
                row.appendChild(delBtn);
            }

            // Click to apply — 跳过 extraActions 内的点击（如 autoApply toggle）
            row.addEventListener('click', (ev) => {
                if ((ev.target as HTMLElement).closest('.toggle')) {
                    return;
                }
                config.onApply(item);
            });

            c.appendChild(row);
        }
    });
}

/** 构建完整 PopupLevel（适用于纯预设列表场景，如模型预设） */
export function buildPresetListLevel<T>(
    config: PresetListViewerConfig<T>,
    onReRender: () => void
): PopupLevel {
    return {
        label: config.label ?? '',
        dir: '',
        items: [],
        renderCustom: (container) => presetListContent(container, config, onReRender),
    };
}
