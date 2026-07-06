// [doc:architecture] Settings — 设置页 + 外部库管理
// 规范文档: docs/architecture.md §模型库管理
// 职责: 配置读写、外部库挂载、软件目录扫描、MenuStack 设置页
// Settings page + external library management (MenuStack-based).

import {
    SetDisplayNamePriority,
    SelectDir,
    AddExternalPath,
    RemoveExternalPath,
    RenameExternalPath,
    ClearExtractCache,
    ClearThumbnailCache,
    ClearAllCaches,
    SetDownloadWatchDir,
    SetDownloadAutoImport,
    GetDownloadAutoImport,
    GetDownloadWatchStatus,
    StopWatchDir,
    SetUIScale,
    SetUIPopupWidth,
    SetUIAccent,
    SetUIFontFamily,
    SetUIAnimations,
    SetUIBlurBg,
    SetPerformanceMode,
    GetBuildInfo,
    GetCacheStats,
} from '../core/wails-bindings';
import {
    dom,
    closeAllOverlays,
    setStatus,
    resourceRoot,
    libraryRoot,
    overridePaths,
    externalPaths,
    displayNamePriority,
    setDisplayNamePriority,
    DisplayNamePriority,
    PopupRow,
    PopupLevel,
    escapeHtml,
    cardContainer,
    UIState,
    uiState,
    setUIState,
    librarySortMode,
    setLibrarySortMode,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { selectResourceRoot, selectOverridePath } from './library-core';
import { slideRow, addToggleRow, addSliderRow, addSectionTitle, addDangerRow, addEmptyRow } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { setPerformanceMode, getPerformanceMode } from '../scene/render/performance';
import { setVolume, getVolume } from '../outfit/audio';
import { setBpmQuantizeEnabled, getBpmQuantizeEnabled } from '../scene/motion/proc-motion-bridge';
import { rescanAndSync, reloadConfig } from './library';
import { softwareKindIcon } from '../core/icons';
import { showConfirm, showPrompt } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import { getAllShortcuts, setKeyBinding, resetKeyBinding, resetAllKeyBindings, loadKeyBindings, exportKeyBindings } from '../core/shortcut-registry';
import { SETTINGS, SETTINGS_ACTION, SOFTWARE_DETAIL_PREFIX, type SettingsFolderTarget } from './settings-targets';

// ======== Helpers re-exported ========
export { refreshLibrary } from './library';

// ======== Software Management (external) ========
import { buildSettingsSoftwareLevel, buildSoftwareDetailLevel } from './settings-software';

// ======== Auto-import state cache ========
// buildRootItems 是同步签名，无法内部 await；用模块级缓存 + 启动预加载。
let autoImportCached = false;

/** 启动时预加载自动导入开关状态。在 main.ts init 中调用。 */
export async function preloadAutoImportState(): Promise<void> {
    try {
        autoImportCached = await GetDownloadAutoImport();
    } catch {
        autoImportCached = false;
    }
}

// ======== VMD 伴音自动加载 ========
/** 加载 VMD 动作时自动发现并加载同目录同名音频（.mp3/.wav/.ogg/.flac）。默认开启。 */
let autoLoadCompanionAudio = true;

export function isAutoLoadCompanionAudioEnabled(): boolean {
    return autoLoadCompanionAudio;
}

export function setAutoLoadCompanionAudio(v: boolean): void {
    autoLoadCompanionAudio = v;
}

// ======== Settings (SlideMenu) ========

const { getMenu: getSettingsMenu, refreshRoot: refreshSettingsRoot, show: showSettings } = registerPopupMenu({
    wrapperKey: 'settings-menu',
    popupType: 'settings',
    overlayClass: 'sceneOverlay-settings',
    buildRoot: () => buildSettingsRoot(),
    buildRootItems: () => buildSettingsRootItems(),
    handlers: {
        onItemClick: (row) => handleSettingsAction(row),
        onFolderEnter: settingsOnFolderEnter,
    },
});

export { getSettingsMenu, refreshSettingsRoot, showSettings };

/** 设置弹窗根级 items 构建器——items-based，支持增量 patch */
/** 缓存：items 固定不变，无需重复创建 */
let _cachedRootItems: PopupRow[] | null = null;

function buildSettingsRootItems(): PopupRow[] {
    if (_cachedRootItems) return _cachedRootItems;

    const items: PopupRow[] = [];
    items.push({ kind: 'folder', label: '外观', icon: 'lucide:palette', target: SETTINGS.APPEARANCE });
    items.push({ kind: 'folder', label: '文件名', icon: 'lucide:file-text', target: SETTINGS.FILENAME });
    items.push({ kind: 'folder', label: '性能', icon: 'lucide:zap', target: SETTINGS.PERFORMANCE });
    items.push({ kind: 'folder', label: '路径', icon: 'lucide:folder-tree', target: SETTINGS.PATHS });
    items.push({ kind: 'folder', label: '软件', icon: 'lucide:package', target: SETTINGS.SOFTWARE });
    items.push({ kind: 'folder', label: '截图', icon: 'lucide:camera', target: SETTINGS.SCREENSHOT });
    items.push({ kind: 'folder', label: '音频', icon: 'lucide:volume-2', target: SETTINGS.AUDIO });
    items.push({ kind: 'folder', label: '快捷键', icon: 'lucide:keyboard', target: SETTINGS.SHORTCUTS });
    items.push({ kind: 'folder', label: '关于', icon: 'lucide:info', target: SETTINGS.ABOUT });
    _cachedRootItems = items;
    return items;
}

function buildSettingsRoot(): PopupLevel {
    return {
        label: '设置',
        dir: '',
        items: buildSettingsRootItems(),
    };
}

function buildSettingsFilenameLevel(): PopupLevel {
    return {
        label: '文件名',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // 排序模式
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:arrow-up-down',
                    librarySortMode === 'name' ? '动作排序：名称' : '动作排序：默认',
                    true,
                    () => {
                        setLibrarySortMode(librarySortMode === 'name' ? 'default' : 'name');
                        getSettingsMenu()?.updateControls();
                    }
                );
                const sortRow = c.querySelector('.slide-item');
                if (sortRow) {
                    const labelSpan = sortRow.querySelector('.slide-label');
                    if (labelSpan) {
                        getCurrentRenderingMenu()?.registerControl(() => {
                            labelSpan.textContent = librarySortMode === 'name' ? '动作排序：名称' : '动作排序：默认';
                        });
                    }
                }
            });
            // 显示名称优先级
            const priorityIndex = displayNamePriority === 'name_jp' ? 0 : displayNamePriority === 'name_en' ? 1 : 2;
            cardContainer(container, (c) => {
                addSliderRow(c, '显示名称优先级', priorityIndex, 0, 2, 1, (v) => {
                    applyDisplayNamePriority(NAME_PRIORITY_INDEX[v]);
                    getSettingsMenu()?.updateControls();
                }, 'lucide:type', undefined, {
                    bind: () => displayNamePriority === 'name_jp' ? 0 : displayNamePriority === 'name_en' ? 1 : 2,
                    onUpdate: (el) => {
                        const valEl = el.querySelector('.cs-value');
                        if (valEl) valEl.textContent = NAME_PRIORITY_LABELS[displayNamePriority];
                    },
                });
            });
            // 材质分类映射
            cardContainer(container, (c) => {
                addSectionTitle(c, '材质分类映射（正则 → 分类）');

                const map = uiState.materialCategoryMap || {};
                const entries = Object.entries(map);

                for (const [pattern, category] of entries) {
                    slideRow(c, 'lucide:tag', pattern, false, () => {}, category,
                        undefined, undefined, undefined,
                        { actionIcon: '✕', onActionClick: () => {
                            delete uiState.materialCategoryMap![pattern];
                            if (Object.keys(uiState.materialCategoryMap!).length === 0) {
                                delete uiState.materialCategoryMap;
                            }
                            setUIState({ materialCategoryMap: uiState.materialCategoryMap });
                            getSettingsMenu()?.reRender();
                        }}
                    );
                }

                // 添加新映射
                slideRow(c, 'lucide:plus', '添加材质映射', false, async () => {
                    const pattern = await showPrompt('输入正则匹配模式（如 skirt|スカート）：');
                    if (!pattern) return;
                    try {
                        new RegExp(pattern);
                    } catch {
                        setStatus('✗ 无效的正则表达式', false);
                        return;
                    }
                    const category = await showPrompt('输入目标分类（皮肤/头发/眼睛/服装/配件/道具）：');
                    if (!category) return;
                    if (!['皮肤', '头发', '眼睛', '服装', '配件', '道具'].includes(category)) {
                        setStatus('✗ 无效的分类名', false);
                        return;
                    }
                    if (!uiState.materialCategoryMap) {
                        uiState.materialCategoryMap = {};
                    }
                    uiState.materialCategoryMap[pattern] = category;
                    setUIState({ materialCategoryMap: uiState.materialCategoryMap });
                    getSettingsMenu()?.reRender();
                });
            });
            // 自动导入
            addSectionTitle(container, '自动导入');
            cardContainer(container, (c) => {
                addToggleRow(c, '自动导入', autoImportCached, (v) => {
                    autoImportCached = v;
                    SetDownloadAutoImport(v).catch(() => {});
                    getSettingsMenu()?.updateControls();
                    setStatus(v ? '✓ 自动导入已开启' : '✓ 自动导入已关闭', true);
                }, 'lucide:download', {
                    bind: () => autoImportCached,
                });
            });
            cardContainer(container, (c) => {
                let dirInput: HTMLInputElement;
                let refreshStatus: () => Promise<void>;

                const statusEl = document.createElement('div');
                statusEl.style.cssText = 'font-size:11px;color:var(--text);padding:4px 14px;';
                c.appendChild(statusEl);

                refreshStatus = async () => {
                    try {
                        const dir = await GetDownloadWatchStatus();
                        statusEl.textContent = dir ? `监听中: ${dir}` : '监听已停止';
                    } catch {
                        statusEl.textContent = '监听已停止';
                    }
                };
                refreshStatus();

                const dirRow = document.createElement('div');
                dirRow.style.cssText = 'display:flex;gap:6px;padding:6px 14px;';
                dirInput = document.createElement('input');
                dirInput.type = 'text';
                dirInput.placeholder = '选择监听目录...';
                dirInput.readOnly = true;
                dirInput.style.cssText =
                    'flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;';
                const selectBtn = document.createElement('button');
                selectBtn.textContent = '📁';
                selectBtn.className = 'mode-btn';
                selectBtn.addEventListener('click', async () => {
                    try {
                        const dir = await SelectDir();
                        if (!dir) {
                            return;
                        }
                        dirInput.value = dir;
                        await SetDownloadWatchDir(dir);
                        refreshStatus();
                        setStatus(`✓ 监听目录已设置: ${dir}`, true);
                    } catch {
                        setStatus('✗ 设置监听目录失败', false);
                    }
                });
                dirRow.appendChild(dirInput);
                dirRow.appendChild(selectBtn);
                c.appendChild(dirRow);

                GetDownloadWatchStatus()
                    .then((dir) => {
                        if (dir) {
                            dirInput.value = dir;
                        }
                    })
                    .catch(() => {});
            });

            cardContainer(container, (c) => {
                addDangerRow(c, 'lucide:stop-circle', '停止监听', async () => {
                    const _r = await tryCatchStatus(() => StopWatchDir(), '✗ 停止监听失败');
                    if (_r !== undefined) {
                        setStatus('✓ 已停止监听', true);
                    }
                });
            });
        },
    };
}

function buildSettingsAppearanceLevel(): PopupLevel {
    const initialScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const initialWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--popup-width')) || 280;
    const initialAnim = getComputedStyle(document.documentElement).getPropertyValue('--ui-animations').trim() !== '0';
    const initialBlur = getComputedStyle(document.documentElement).getPropertyValue('--ui-blur').trim() !== '0';

    return {
        label: '外观',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(c, 'UI 缩放', initialScale, 0.8, 1.3, 0.05, (v) => {
                    document.documentElement.style.setProperty('--ui-scale', String(v));
                    SetUIScale(v).catch(() => {});
                    getSettingsMenu()?.updateControls();
                }, 'lucide:maximize', undefined, {
                    bind: () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1,
                });
                addSliderRow(c, '弹窗宽度', initialWidth, 220, 360, 10, (v) => {
                    document.documentElement.style.setProperty('--popup-width', v + 'px');
                    SetUIPopupWidth(v).catch(() => {});
                    getSettingsMenu()?.updateControls();
                }, 'lucide:sidebar', undefined, {
                    bind: () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--popup-width')) || 280,
                });
            });

            const currentAccent =
                getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
                '#4a6cf7';
            cardContainer(container, (c) => {
                addSectionTitle(c, '主题色');
                const themeRows: HTMLElement[] = [];
                for (const p of THEME_PRESETS) {
                    const isActive = currentAccent.toLowerCase() === p.color.toLowerCase();
                    const row = document.createElement('div');
                    row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                    row.dataset.themeColor = p.color;
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check-circle' : 'circle'}"></iconify-icon></span><span class="slide-label">${p.label}</span>`;
                    const swatch = document.createElement('span');
                    swatch.className = 'theme-swatch';
                    swatch.style.cssText = `width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid var(--white-12);flex-shrink:0;margin-left:auto;`;
                    row.appendChild(swatch);
                    row.addEventListener('click', () => setTheme(p.color));
                    c.appendChild(row);
                    themeRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a6cf7';
                    for (const row of themeRows) {
                        const color = row.dataset.themeColor!;
                        const isActive = accent.toLowerCase() === color.toLowerCase();
                        row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                        const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
                        if (icon) icon.setAttribute('icon', `lucide:${isActive ? 'check-circle' : 'circle'}`);
                    }
                });
            });
            cardContainer(container, (c) => {
                c.className = 'card-container accent-input-card';
                c.style.cssText = 'display:flex;gap:6px;padding:8px 14px;align-items:center;';
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = '#RRGGBB';
                input.className = 'tag-input';
                input.value = currentAccent;
                const applyBtn = document.createElement('button');
                applyBtn.className = 'btn btn-sm btn-primary';
                applyBtn.textContent = '应用';
                applyBtn.addEventListener('click', () => {
                    const hex = input.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                        setTheme(hex);
                    } else {
                        setStatus('✗ 无效的 hex 颜色', false);
                    }
                });
                c.appendChild(input);
                c.appendChild(applyBtn);
                getCurrentRenderingMenu()?.registerControl(() => {
                    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a6cf7';
                    input.value = accent;
                });
            });

            const currentCss = getComputedStyle(document.documentElement)
                .getPropertyValue('--font')
                .trim();
            cardContainer(container, (c) => {
                addSectionTitle(c, '字体');
                const fontRows: HTMLElement[] = [];
                for (const [key, f] of Object.entries(FONT_MAP)) {
                    const isActive = currentCss === f.css;
                    const row = slideRow(c, `lucide:${isActive ? 'check' : 'circle'}`, f.label, false, () => {
                        document.documentElement.style.setProperty('--font', f.css);
                        SetUIFontFamily(key).catch(() => {});
                        getSettingsMenu()?.updateControls();
                        setStatus(`✓ 字体已设为 ${f.label}`, true);
                    }, undefined, undefined, isActive);
                    row.dataset.fontKey = key;
                    fontRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const fontCss = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
                    for (const row of fontRows) {
                        const key = row.dataset.fontKey!;
                        const isActive = FONT_MAP[key] && fontCss === FONT_MAP[key].css;
                        row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                        const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
                        if (icon) icon.setAttribute('icon', `lucide:${isActive ? 'check' : 'circle'}`);
                    }
                });
            });

            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    '滑动动画',
                    initialAnim,
                    (v) => {
                        document.documentElement.style.setProperty(
                            '--ui-animations',
                            v ? '1' : '0'
                        );
                        SetUIAnimations(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                    },
                    'lucide:move',
                    {
                        bind: () => getComputedStyle(document.documentElement).getPropertyValue('--ui-animations').trim() !== '0',
                    }
                );
                addToggleRow(
                    c,
                    '背景模糊',
                    initialBlur,
                    (v) => {
                        document.documentElement.style.setProperty('--ui-blur', v ? '1' : '0');
                        document
                            .querySelectorAll<HTMLElement>('.overlay')
                            .forEach((el) => el.classList.toggle('blur-bg', v));
                        SetUIBlurBg(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                    },
                    'lucide:monitor',
                    {
                        bind: () => getComputedStyle(document.documentElement).getPropertyValue('--ui-blur').trim() !== '0',
                    }
                );
            });

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:rotate-ccw', '恢复默认外观', false, () => {
                    const root = document.documentElement;
                    root.style.setProperty('--ui-scale', '1');
                    root.style.setProperty('--popup-width', '280px');
                    root.style.setProperty('--accent', '#4a6cf7');
                    root.style.setProperty('--accent-rgb', '74, 108, 247');
                    root.style.setProperty('--accent-dim', 'rgba(74,108,247,0.2)');
                    root.style.setProperty(
                        '--font',
                        "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif"
                    );
                    root.style.setProperty('--ui-animations', '1');
                    root.style.setProperty('--ui-blur', '0');
                    document
                        .querySelectorAll<HTMLElement>('.overlay')
                        .forEach((el) => el.classList.remove('blur-bg'));
                    SetUIScale(1).catch(() => {});
                    SetUIPopupWidth(280).catch(() => {});
                    SetUIAccent('#4a6cf7').catch(() => {});
                    SetUIFontFamily('system').catch(() => {});
                    SetUIAnimations(true).catch(() => {});
                    SetUIBlurBg(false).catch(() => {});
                    getSettingsMenu()?.updateControls();
                    setStatus('✓ 外观已恢复默认', true);
                });
            });
        },
    };
}

const THEME_PRESETS: Array<{ label: string; color: string }> = [
    { label: '经典蓝', color: '#4a6cf7' },
    { label: '樱花粉', color: '#f74a6c' },
    { label: '薄荷绿', color: '#4af7a6' },
    { label: '日落橙', color: '#f7a64a' },
    { label: '暗夜紫', color: '#6c4af7' },
    { label: '极简灰', color: '#888888' },
];

const NAME_PRIORITY_LABELS: Record<DisplayNamePriority, string> = {
    name_jp: '日语名',
    name_en: '英语名',
    filename: '文件名',
};

const NAME_PRIORITY_INDEX: Record<number, DisplayNamePriority> = {
    0: 'name_jp',
    1: 'name_en',
    2: 'filename',
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return { r: 74, g: 108, b: 247 };
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
    };
}

function rgbToString(rgb: { r: number; g: number; b: number }): string {
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

function generateTextColors(hex: string): { bright: string; dim: string; muted: string } {
    const rgb = hexToRgb(hex);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;

    // factor 直接作为混合比例：0 = 纯白，1 = 纯主题色
    // 亮主题（brightness>128）→ 文字偏暗 → factor 大（更多主题色）
    // 暗主题 → 文字偏亮 → factor 小（更多白）
    const mix = (factor: number) => {
        const f = Math.max(0, Math.min(1, factor));
        const r = Math.round(rgb.r * f + 255 * (1 - f));
        const g = Math.round(rgb.g * f + 255 * (1 - f));
        const b = Math.round(rgb.b * f + 255 * (1 - f));
        return `rgb(${r}, ${g}, ${b})`;
    };

    return {
        bright: mix(brightness > 128 ? 0.85 : 0.1),
        dim: mix(brightness > 128 ? 0.6 : 0.25),
        muted: mix(brightness > 128 ? 0.4 : 0.4),
    };
}

async function setTheme(hex: string): Promise<void> {
    const root = document.documentElement;
    const textColors = generateTextColors(hex);

    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', rgbToString(hexToRgb(hex)));
    root.style.setProperty('--accent-dim', hex + '33');
    root.style.setProperty('--text-bright', textColors.bright);
    root.style.setProperty('--text-dim', textColors.dim);
    root.style.setProperty('--text-muted', textColors.muted);

    const _r = await tryCatchStatus(() => SetUIAccent(hex), '✗ 主题色保存失败');
    if (_r !== undefined) {
        setStatus(`✓ 主题色已设为 ${hex}`, true);
    }
    getSettingsMenu()?.updateControls();
}

const FONT_MAP: Record<string, { label: string; css: string }> = {
    system: {
        label: '系统默认',
        css: "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif",
    },
    noto: {
        label: '思源黑体',
        css: "'Source Han Sans SC', 'Noto Sans CJK SC', system-ui, sans-serif",
    },
    yahei: {
        label: '微软雅黑',
        css: "'Microsoft YaHei', 'Microsoft YaHei UI', system-ui, sans-serif",
    },
};

function buildSettingsPathsLevel(): PopupLevel {
    const root = resourceRoot;
    const rootSub = root ? (root.length > 20 ? '...' + root.slice(-17) : root) : '未设置';
    const paths = overridePaths || {};
    // key → 默认子目录名（与 Go 端 GetPath 的目录名一致，大小写不统一）
    const defaultDirName: Record<string, string> = {
    pmx: 'PMX',
    vmd: 'VMD',
    audio: 'audio',
    stage: 'stage',
    prop: 'prop',
    environment: 'environment',
    md_dress: 'MD-dress',
    setting: 'setting',
};
    const pathSub = (key: string, defSub: string) => {
        const val = paths[key as keyof typeof paths];
        let actual: string;
        if (val) {
            actual = val as string;
        } else if (root) {
            // 无覆写时显示默认路径 ResourceRoot/类别子目录
            actual = `${root}/${defaultDirName[key] || key}`;
        } else {
            return defSub;
        }
        return actual.length > 20 ? '...' + actual.slice(-17) : actual;
    };
    return {
        label: '路径',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // Card 1: 资源根目录
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:folder', '资源根目录', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.RESOURCE_ROOT }), rootSub);
            });
            // Card 2: 资源路径覆盖
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:box', 'PMX 模型', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_PMX }), pathSub('pmx', '默认'));
                slideRow(c, 'lucide:music', 'VMD 动作', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_VMD }), pathSub('vmd', '默认'));
                slideRow(c, 'lucide:headphones', 'Audio 音乐', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_AUDIO }), pathSub('audio', '默认'));
                slideRow(c, 'lucide:box', 'Prop 道具', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_PROP }), pathSub('prop', '默认'));
                slideRow(c, 'lucide:home', 'Stage 场景', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_STAGE }), pathSub('stage', '默认'));
                slideRow(c, 'lucide:cloud', 'Environment', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_ENVIRONMENT }), pathSub('environment', '默认'));
                slideRow(c, 'lucide:shirt', 'MD-dress', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_MD_DRESS }), pathSub('md_dress', '默认'));
                slideRow(c, 'lucide:settings', '配置目录', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_SETTING }), pathSub('setting', '默认'));
            });
            // Card 3: 外部库
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plug', '外部库管理', true, () => handleSettingsAction({ kind: 'folder', label: '', icon: '', target: SETTINGS.EXTERNAL }));
            });
        },
    };
}

/** 设置动作映射表——替代原 handleSettingsAction 的 switch 链 */
const SETTINGS_ACTIONS: Record<string, (row: PopupRow) => void> = {
    [SETTINGS_ACTION.CLEAR_EXTRACT_CACHE]: () => {
        ClearExtractCache()
            .then(() => {
                setStatus('✓ 提取缓存已清除', true);
                window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
            })
            .catch(console.warn);
    },
    [SETTINGS_ACTION.CLEAR_THUMBNAIL]: () => {
        (async () => {
            if (await showConfirm('确定要清除所有缩略图缓存吗？下次加载模型时将重新生成。')) {
                ClearThumbnailCache()
                    .then(() => {
                        setStatus('✓ 缩略图缓存已清除', true);
                        window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                    })
                    .catch(console.warn);
            }
        })();
    },
    [SETTINGS_ACTION.CLEAR_ALL_CACHE]: () => {
        (async () => {
            if (await showConfirm('确定要清除全部缓存吗？包括提取缓存、缩略图、HTTP 隔离目录。下次加载模型时将重新生成。')) {
                ClearAllCaches()
                    .then(() => {
                        setStatus('✓ 全部缓存已清除', true);
                        window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                    })
                    .catch(console.warn);
            }
        })();
    },
    [SETTINGS_ACTION.RESOURCE_ROOT]: () => selectResourceRoot().catch(console.warn),
    [SETTINGS_ACTION.PATH_PMX]: (row) => selectOverridePath('pmx').catch(console.warn),
    [SETTINGS_ACTION.PATH_VMD]: (row) => selectOverridePath('vmd').catch(console.warn),
    [SETTINGS_ACTION.PATH_AUDIO]: (row) => selectOverridePath('audio').catch(console.warn),
    [SETTINGS_ACTION.PATH_PROP]: (row) => selectOverridePath('prop').catch(console.warn),
    [SETTINGS_ACTION.PATH_STAGE]: (row) => selectOverridePath('stage').catch(console.warn),
    [SETTINGS_ACTION.PATH_ENVIRONMENT]: (row) => selectOverridePath('environment').catch(console.warn),
    [SETTINGS_ACTION.PATH_MD_DRESS]: (row) => selectOverridePath('md_dress').catch(console.warn),
    [SETTINGS_ACTION.PATH_SETTING]: (row) => selectOverridePath('setting').catch(console.warn),
};

function applyDisplayNamePriority(priority: DisplayNamePriority): void {
    setDisplayNamePriority(priority);
    SetDisplayNamePriority(priority).catch(console.warn);
}

function handleSettingsAction(row: PopupRow): void {
    if (row.target) {
        SETTINGS_ACTIONS[row.target]?.(row);
    }
}

// ======== External Paths ========

function buildSettingsExternalLevel(): PopupLevel {
    return {
        label: '外部库管理',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (externalPaths.length === 0) {
                    addEmptyRow(c, '暂无外部库');
                    return;
                }
                for (const ep of externalPaths) {
                    slideRow(c, 'lucide:plug', ep.name, false, () => {},
                        escapeHtml(ep.path), undefined, undefined, undefined, {
                            inlineSub: true,
                            actionIcons: [
                                {
                                    icon: '✎',
                                    title: '重命名',
                                    onClick: async () => {
                                        const newName = await showPrompt('输入新的显示名称：', ep.name);
                                        if (newName && newName.trim() && newName.trim() !== ep.name) {
                                            const r = await tryCatchStatus(async () => {
                                                await RenameExternalPath(ep.path, newName.trim());
                                                return true;
                                            }, '✗ 重命名失败');
                                            if (r) {
                                                await reloadConfig();
                                                getSettingsMenu()?.reRender();
                                                setStatus('✓ 已重命名', true);
                                            }
                                        }
                                    },
                                },
                                {
                                    icon: '✕',
                                    danger: true,
                                    title: '删除',
                                    onClick: async () => {
                                        try {
                                            await RemoveExternalPath(ep.path);
                                            await reloadConfig();
                                            if (libraryRoot) {
                                                await rescanAndSync();
                                            }
                                            getSettingsMenu()?.reRender();
                                        } catch (err) {
                                            console.error('RemoveExternalPath error:', err);
                                        }
                                    },
                                },
                            ],
                        },
                    );
                }
            });

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加外部库', false, async () => {
                    try {
                        const dir = await SelectDir();
                        if (!dir) {
                            return;
                        }
                        await AddExternalPath(dir);
                        await reloadConfig();
                        if (libraryRoot) {
                            await rescanAndSync();
                        }
                        getSettingsMenu()?.reRender();
                        setStatus('✓ 外部库已添加', true);
                    } catch (err) {
                        console.error('AddExternalPath error:', err);
                    }
                });
            });
        },
    };
}

// ======== Performance Settings ========

const PERFORMANCE_MODES: Array<{
    key: 'auto' | 'quality' | 'balanced' | 'performance';
    label: string;
    desc: string;
}> = [
    { key: 'auto', label: '自动', desc: '监控帧率，自动降低质量' },
    { key: 'quality', label: '质量优先', desc: '最高质量，不自动降级' },
    { key: 'balanced', label: '平衡', desc: '中等质量，适合大多数设备' },
    { key: 'performance', label: '性能优先', desc: '最低质量，确保流畅' },
];

function buildSettingsPerformanceLevel(): PopupLevel {
    return {
        label: '性能',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const current = getPerformanceMode();
                const perfRows: HTMLElement[] = [];
                for (const m of PERFORMANCE_MODES) {
                    const isActive = current === m.key;
                    const row = slideRow(c, `lucide:${isActive ? 'check-circle' : 'circle'}`, m.label, false, () => {
                        setPerformanceMode(m.key);
                        SetPerformanceMode(m.key).catch(() => {});
                        getSettingsMenu()?.updateControls();
                        setStatus(`✓ 性能模式: ${m.label}`, true);
                    }, m.desc, undefined, isActive);
                    row.dataset.perfKey = m.key;
                    perfRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const currentMode = getPerformanceMode();
                    for (const row of perfRows) {
                        const key = row.dataset.perfKey!;
                        const isActive = currentMode === key;
                        row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                        const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
                        if (icon) icon.setAttribute('icon', `lucide:${isActive ? 'check-circle' : 'circle'}`);
                    }
                });
            });

            // 帧率限制
            cardContainer(container, (c) => {
                const currentFps = uiState.fpsLimit ?? 0;
                addSliderRow(c, '帧率上限', currentFps, 0, 144, 1, (v) => {
                    const limit = Math.round(v);
                    setUIState({ fpsLimit: limit === 0 ? 0 : limit });
                    getSettingsMenu()?.updateControls();
                    setStatus(limit === 0 ? '✓ 帧率不限制' : `✓ 帧率上限: ${limit} FPS`, true);
                }, 'lucide:gauge', undefined, {
                    bind: () => uiState.fpsLimit ?? 0,
                });
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = '设为 0 表示不限制。移动端建议 30 以省电。';
                c.appendChild(hint);
            });
        },
    };
}

// ======== Screenshot Settings ========

function buildSettingsScreenshotLevel(): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // Format selector: PNG / JPEG / WebP
            cardContainer(container, (c) => {
                addSectionTitle(c, '截图格式');
                const formats: Array<{ key: 'image/png' | 'image/jpeg' | 'image/webp'; label: string; icon: string }> = [
                    { key: 'image/png', label: 'PNG', icon: 'lucide:file-image' },
                    { key: 'image/jpeg', label: 'JPEG', icon: 'lucide:file-image' },
                    { key: 'image/webp', label: 'WebP', icon: 'lucide:file-image' },
                ];
                const formatRows: HTMLElement[] = [];
                for (const f of formats) {
                    const isActive = (uiState.screenshotFormat ?? 'image/png') === f.key;
                    const row = slideRow(c, `lucide:${isActive ? 'check-circle' : 'circle'}`, f.label, false, () => {
                        uiState.screenshotFormat = f.key;
                        setUIState({ screenshotFormat: f.key });
                        getSettingsMenu()?.updateControls();
                        setStatus(`✓ 截图格式已设为 ${f.label}`, true);
                    }, undefined, undefined, isActive);
                    row.dataset.formatKey = f.key;
                    formatRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const current = uiState.screenshotFormat ?? 'image/png';
                    for (const row of formatRows) {
                        const key = row.dataset.formatKey!;
                        const isActive = current === key;
                        row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                        const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
                        if (icon) icon.setAttribute('icon', `lucide:${isActive ? 'check-circle' : 'circle'}`);
                    }
                });
            });

            // Quality slider
            cardContainer(container, (c) => {
                addSliderRow(c, '截图质量', uiState.screenshotQuality ?? 0.9, 0.5, 1.0, 0.05, (v) => {
                    uiState.screenshotQuality = v;
                    setUIState({ screenshotQuality: v });
                    getSettingsMenu()?.updateControls();
                }, 'lucide:gauge', undefined, {
                    bind: () => uiState.screenshotQuality ?? 0.9,
                    onUpdate: (el) => {
                        const valEl = el.querySelector('.cs-value');
                        if (valEl) valEl.textContent = Math.round((uiState.screenshotQuality ?? 0.9) * 100) + '%';
                    },
                });
            });
        },
    };
}

// ======== Audio Settings ========

function buildSettingsAudioLevel(): PopupLevel {
    return {
        label: '音频',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // Default volume
            cardContainer(container, (c) => {
                addSliderRow(c, '默认音量', getVolume(), 0, 1, 0.05, (v) => {
                    setVolume(v);
                    getSettingsMenu()?.updateControls();
                }, 'lucide:volume-2', undefined, {
                    bind: () => getVolume(),
                    onUpdate: (el) => {
                        const valEl = el.querySelector('.cs-value');
                        if (valEl) valEl.textContent = Math.round(getVolume() * 100) + '%';
                    },
                });
            });

            // Mute toggle
            cardContainer(container, (c) => {
                let muteFlag = false;
                addToggleRow(c, '静音', false, (v) => {
                    muteFlag = v;
                    if (v) {
                        setVolume(0);
                    } else {
                        setVolume(1);
                    }
                    getSettingsMenu()?.updateControls();
                }, 'lucide:volume-x', {
                    bind: () => getVolume() === 0,
                });
            });

            // BPM Quantization
            cardContainer(container, (c) => {
                addToggleRow(c, 'BPM 量化', true, (v) => {
                    setBpmQuantizeEnabled(v);
                    getSettingsMenu()?.updateControls();
                    setStatus(v ? '✓ BPM 量化已开启' : '✓ BPM 量化已关闭', true);
                }, 'lucide:activity', {
                    bind: () => getBpmQuantizeEnabled(),
                });
            });

            // 加载动作时自动加载同目录音乐
            cardContainer(container, (c) => {
                addToggleRow(c, '加载动作时自动加载同目录音乐', autoLoadCompanionAudio, (v) => {
                    setAutoLoadCompanionAudio(v);
                    getSettingsMenu()?.updateControls();
                    setStatus(v ? '✓ 伴音自动加载已开启' : '✓ 伴音自动加载已关闭', true);
                }, 'lucide:disc-3', {
                    bind: () => autoLoadCompanionAudio,
                });
            });
        },
    };
}

// ======== About ========

function buildSettingsAboutLevel(): PopupLevel {
    const shortcuts: Array<{ key: string; desc: string }> = [
        { key: 'Ctrl+1', desc: '模型库' },
        { key: 'Ctrl+2', desc: '动作面板' },
        { key: 'Ctrl+3', desc: '场景设置' },
        { key: 'Ctrl+4', desc: '环境设置' },
        { key: 'Ctrl+5', desc: '设置' },
        { key: 'Space', desc: '播放/暂停' },
        { key: 'Esc', desc: '关闭弹窗' },
        { key: '← / →', desc: '快退/快进 5 秒' },
        { key: 'WASD', desc: '自由飞行相机移动' },
        { key: 'Q / E', desc: '自由飞行相机下降/上升' },
    ];

    return {
        label: '关于',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // 版本信息 + 构建诊断
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText = 'text-align:center;padding:16px 14px 8px;';
                title.innerHTML = `
                    <div style="font-size:15px;font-weight:600;color:var(--text);">MikuMikuAR</div>
                    <div data-app-version style="font-size:11px;color:var(--text-dim);margin-top:2px;">v…</div>
                `;
                c.appendChild(title);
                // 异步从 Go 端读取构建信息（ldflags 注入）
                GetBuildInfo()
                    .then((info) => {
                        const el = title.querySelector<HTMLElement>('[data-app-version]');
                        if (el) el.textContent = `v${info.version}`;
                        // 构建详情行
                        const detail = document.createElement('div');
                        detail.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:6px;line-height:1.6;font-family:monospace;';
                        detail.innerHTML = `
                            <div>build: ${info.buildTime}</div>
                            <div>commit: ${info.commitHash}</div>
                            <div>go: ${info.goVersion}</div>
                        `;
                        c.appendChild(detail);
                    })
                    .catch(() => {});
            });

            // 快捷键
            cardContainer(container, (c) => {
                addSectionTitle(c, '快捷键');
                for (const s of shortcuts) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.style.cssText = 'padding:6px 14px;';
                    row.innerHTML = `
                        <span class="slide-label" style="flex:1;">${s.desc}</span>
                        <span style="font-family:monospace;font-size:11px;color:var(--accent);background:var(--accent-dim);padding:2px 8px;border-radius:4px;">${s.key}</span>
                    `;
                    c.appendChild(row);
                }
            });

            // 许可证
            cardContainer(container, (c) => {
                const licenseRow = document.createElement('div');
                licenseRow.className = 'slide-item';
                licenseRow.innerHTML = `
                    <span class="slide-icon"><iconify-icon icon="lucide:scroll"></iconify-icon></span>
                    <span class="slide-label">开源许可证</span>
                `;
                c.appendChild(licenseRow);
            });

            // 缓存统计
            cardContainer(container, (c) => {
                addSectionTitle(c, '缓存占用');
                const statRow = document.createElement('div');
                statRow.className = 'slide-item';
                statRow.style.cssText = 'padding:8px 14px;flex-direction:column;align-items:stretch;gap:4px;';
                statRow.innerHTML = `
                    <div data-cache-total style="font-size:13px;color:var(--text);font-weight:500;">统计中…</div>
                    <div data-cache-detail style="font-size:10px;color:var(--text-dim);line-height:1.6;font-family:monospace;"></div>
                `;
                c.appendChild(statRow);

                const refreshCacheStats = () => {
                    GetCacheStats()
                        .then((s) => {
                            const total = statRow.querySelector<HTMLElement>('[data-cache-total]');
                            const detail = statRow.querySelector<HTMLElement>('[data-cache-detail]');
                            if (total) total.textContent = `总计 ${formatBytes(s.totalBytes)}`;
                            if (detail) {
                                detail.innerHTML = `
                                    <div>提取: ${formatBytes(s.extractedBytes)} (${s.extractedCount} 项)</div>
                                    <div>缩略图: ${formatBytes(s.thumbnailBytes)} (${s.thumbnailCount} 项)</div>
                                    <div>隔离: ${formatBytes(s.serveBytes)} (${s.serveCount} 项)</div>
                                `;
                            }
                        })
                        .catch(() => {});
                };
                refreshCacheStats();
                // 清缓存后自动刷新统计
                window.addEventListener('mmar:cache-cleared', refreshCacheStats);
            });

            // 维护工具：清除缓存
            cardContainer(container, (c) => {
                addSectionTitle(c, '维护工具');
                slideRow(c, 'lucide:trash-2', '清除提取缓存', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.CLEAR_EXTRACT_CACHE }));
                slideRow(c, 'lucide:image', '清除缩略图缓存', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.CLEAR_THUMBNAIL }));
                slideRow(c, 'lucide:trash', '清除全部缓存', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.CLEAR_ALL_CACHE }));
            });
        },
    };
}

// ======== Shortcuts Settings ========

/** Format a key code + modifiers into a display string like "Ctrl+1" or "←". */
function _fmtKeyBinding(key: string, ctrl: boolean, shift: boolean, alt: boolean): string {
    const parts: string[] = [];
    if (ctrl) parts.push('Ctrl');
    if (shift) parts.push('Shift');
    if (alt) parts.push('Alt');
    let display = key;
    if (key === 'Space') display = 'Space';
    else if (key === 'Escape') display = 'Esc';
    else if (key === 'ArrowLeft') display = '←';
    else if (key === 'ArrowRight') display = '→';
    else if (key === 'ArrowUp') display = '↑';
    else if (key === 'ArrowDown') display = '↓';
    else if (key === 'Enter') display = 'Enter';
    else if (key.startsWith('Digit')) display = key.slice(5);
    else if (key.startsWith('Key')) display = key.slice(3);
    parts.push(display);
    return parts.join('+');
}

function _isModifierOnly(code: string): boolean {
    return code === 'ControlLeft' || code === 'ControlRight'
        || code === 'ShiftLeft' || code === 'ShiftRight'
        || code === 'AltLeft' || code === 'AltRight'
        || code === 'MetaLeft' || code === 'MetaRight';
}

/** Tracks which shortcut is waiting for a new key binding (null = none). */
let _rebindingId: string | null = null;

function buildSettingsShortcutsLevel(): PopupLevel {
    return {
        label: '快捷键',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // Reset waiting state on each render
            _rebindingId = null;

            // Load persisted overrides into the registry
            const persisted = (uiState as Record<string, unknown>).keyBindings as
                Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }> | undefined;
            if (persisted) {
                loadKeyBindings(persisted);
            }

            const allShortcuts = getAllShortcuts();

            // Group by 'group' field, preserving registration order
            const groups = new Map<string, typeof allShortcuts>();
            for (const s of allShortcuts) {
                const list = groups.get(s.group);
                if (list) {
                    list.push(s);
                } else {
                    groups.set(s.group, [s]);
                }
            }

            for (const [groupName, items] of groups) {
                addSectionTitle(container, groupName);
                cardContainer(container, (c) => {
                    for (const s of items) {
                        const combo = _fmtKeyBinding(s.currentKey, s.currentCtrl, s.currentShift, s.currentAlt);
                        const isOverridden = s.currentKey !== s.defaultKey
                            || s.currentCtrl !== (s.defaultCtrl ?? false)
                            || s.currentShift !== (s.defaultShift ?? false)
                            || s.currentAlt !== (s.defaultAlt ?? false);
                        const sublabel = combo + (isOverridden ? ' · 自定义' : '');

                        slideRow(c, 'lucide:keyboard', s.label, false, () => {
                            if (_rebindingId) return;
                            _rebindingId = s.id;

                            // Update row to show waiting state
                            const labelSpan = c.querySelector('.slide-label');
                            const sublabelSpan = c.querySelector('.slide-sublabel');
                            if (labelSpan) labelSpan.textContent = '按下新组合键...';
                            if (sublabelSpan) sublabelSpan.textContent = '';

                            const handler = (e: KeyboardEvent) => {
                                if (e.repeat) return;
                                e.stopPropagation();
                                e.preventDefault();

                                // Ignore modifier-only presses (keep waiting)
                                if (_isModifierOnly(e.code)) return;

                                document.removeEventListener('keydown', handler, true);

                                // Cancel on Escape
                                if (e.code === 'Escape') {
                                    _rebindingId = null;
                                    getSettingsMenu()?.reRender();
                                    return;
                                }

                                const id = _rebindingId!;
                                _rebindingId = null;

                                const result = setKeyBinding(id, e.code, e.ctrlKey, e.shiftKey, e.altKey);
                                if (!('conflictId' in result)) {
                                    (uiState as Record<string, unknown>).keyBindings = exportKeyBindings();
                                    getSettingsMenu()?.reRender();
                                } else {
                                    const conflictId = result.conflictId;
                                    const conflictLabel = result.conflictLabel;
                                    showConfirm(`快捷键 "${conflictLabel}" 已使用此组合键，是否覆盖？`).then((ok) => {
                                        if (ok) {
                                            resetKeyBinding(conflictId);
                                            setKeyBinding(id, e.code, e.ctrlKey, e.shiftKey, e.altKey);
                                            (uiState as Record<string, unknown>).keyBindings = exportKeyBindings();
                                        }
                                        getSettingsMenu()?.reRender();
                                    });
                                }
                            };
                            document.addEventListener('keydown', handler, true);
                        }, sublabel);
                    }
                });
            }

            // Reset all button
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:rotate-ccw', '恢复默认快捷键', false, () => {
                    resetAllKeyBindings();
                    (uiState as Record<string, unknown>).keyBindings = exportKeyBindings();
                    getSettingsMenu()?.reRender();
                    setStatus('✓ 快捷键已恢复默认', true);
                });
            });
        },
    };
}

/** 格式化字节数为人类可读字符串 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const idx = Math.min(i, units.length - 1);
    const val = bytes / Math.pow(1024, idx);
    return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/** settings 的 onFolderEnter 路由（从 showSettings 提取） */
const SETTINGS_FOLDER_ROUTES: Record<SettingsFolderTarget, () => PopupLevel> = {
    [SETTINGS.APPEARANCE]: buildSettingsAppearanceLevel,
    [SETTINGS.FILENAME]: buildSettingsFilenameLevel,
    [SETTINGS.PERFORMANCE]: buildSettingsPerformanceLevel,
    [SETTINGS.PATHS]: buildSettingsPathsLevel,
    [SETTINGS.EXTERNAL]: buildSettingsExternalLevel,
    [SETTINGS.SOFTWARE]: buildSettingsSoftwareLevel,
    [SETTINGS.SCREENSHOT]: buildSettingsScreenshotLevel,
    [SETTINGS.AUDIO]: buildSettingsAudioLevel,
    [SETTINGS.SHORTCUTS]: buildSettingsShortcutsLevel,
    [SETTINGS.ABOUT]: buildSettingsAboutLevel,
};

function settingsOnFolderEnter(row: PopupRow): PopupLevel | null {
    if (row.target) {
        const builder = SETTINGS_FOLDER_ROUTES[row.target];
        if (builder) return builder();

        if (row.target.startsWith(SOFTWARE_DETAIL_PREFIX)) {
            const path = row.target.slice(SOFTWARE_DETAIL_PREFIX.length);
            return buildSoftwareDetailLevel(path);
        }
    }
    return null;
}


