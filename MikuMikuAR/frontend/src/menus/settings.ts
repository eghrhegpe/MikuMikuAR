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
    SetDownloadWatchDir,
    SetDownloadAutoImport,
    GetDownloadWatchStatus,
    StopWatchDir,
    SetUIScale,
    SetUIPopupWidth,
    SetUIAccent,
    SetUIFontFamily,
    SetUIAnimations,
    SetUIBlurBg,
    SetPerformanceMode,
} from '../../wailsjs/go/main/App';
import {
    dom,
    closeAllOverlays,
    setStatus,
    libraryRoot,
    externalPaths,
    displayNamePriority,
    setDisplayNamePriority,
    DisplayNamePriority,
    PopupRow,
    PopupLevel,
    escapeHtml,
    cardContainer,
    UIState,
    librarySortMode,
    setLibrarySortMode,
} from '../core/config';
import { SlideMenu } from './menu';
import { slideRow, addToggleRow } from '../core/ui-helpers';
import { setPerformanceMode, getPerformanceMode } from '../scene/scene-performance';
import { rescanAndSync, reloadConfig } from './library';
import { softwareKindIcon, createIconifyIcon } from '../core/icons';

// ======== Helpers re-exported ========
export { refreshLibrary } from './library';

// ======== Software Management (external) ========
import { buildSettingsSoftwareLevel, buildSoftwareDetailLevel } from './settings-software';

// ======== Settings (SlideMenu) ========

let settingsMenu: SlideMenu | null = null;

function buildSettingsRoot(): PopupLevel {
    return {
        label: '设置',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:palette', '显示', true, () =>
                    settingsMenu.push(buildSettingsDisplayLevel())
                );
                slideRow(c, 'lucide:monitor', '界面', true, () =>
                    settingsMenu.push(buildSettingsUILevel())
                );
                slideRow(c, 'lucide:download', '自动导入', true, () =>
                    settingsMenu.push(buildSettingsDownloadLevel()),
                    undefined, undefined,
                    { value: false, onChange: async (v) => {
                        try {
                            await SetDownloadAutoImport(v);
                            setStatus(v ? '✓ 自动导入已开启' : '✓ 自动导入已关闭', true);
                        } catch {
                            setStatus('✗ 设置失败', false);
                        }
                    }}
                );
                slideRow(c, 'lucide:zap', '性能', true, () =>
                    settingsMenu.push(buildSettingsPerformanceLevel())
                );
                slideRow(c, 'lucide:settings', '系统', true, () =>
                    settingsMenu.push(buildSettingsSystemLevel())
                );
                slideRow(c, 'lucide:package', '软件管理', true, () =>
                    settingsMenu.push(buildSettingsSoftwareLevel())
                );
            });
        },
    };
}

function buildSettingsDisplayLevel(): PopupLevel {
    const current = displayNamePriority;
    function pick(p: DisplayNamePriority): void {
        setDisplayNamePriority(p);
        SetDisplayNamePriority(p).catch(console.warn);
        settingsMenu.reRender();
    }
    return {
        label: '显示',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    current === 'name_jp' ? 'lucide:check-circle' : 'lucide:circle',
                    '日文名（name_jp）',
                    false,
                    () => pick('name_jp')
                );
                slideRow(
                    c,
                    current === 'name_en' ? 'lucide:check-circle' : 'lucide:circle',
                    '英文名（name_en）',
                    false,
                    () => pick('name_en')
                );
                slideRow(
                    c,
                    current === 'filename' ? 'lucide:check-circle' : 'lucide:circle',
                    '文件名（filename）',
                    false,
                    () => pick('filename')
                );
            });
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:arrow-up-down',
                    librarySortMode === 'name' ? '动作排序：名称' : '动作排序：默认',
                    true,
                    () => {
                        setLibrarySortMode(librarySortMode === 'name' ? 'default' : 'name');
                        settingsMenu.reRender();
                    }
                );
            });
        },
    };
}

function buildSettingsUILevel(): PopupLevel {
    return {
        label: '界面',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addCsRow(c, 'UI 缩放', 'lucide:maximize', 0.8, 1.3, 0.05, 1, (v) => {
                    document.documentElement.style.setProperty('--ui-scale', String(v));
                    SetUIScale(v).catch(() => {});
                });
                addCsRow(c, '弹窗宽度', 'lucide:sidebar', 220, 360, 10, 280, (v) => {
                    document.documentElement.style.setProperty('--popup-width', v + 'px');
                    SetUIPopupWidth(v).catch(() => {});
                });
            });

            const currentAccent =
                getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
                '#4a6cf7';
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.className = 'section-title';
                title.textContent = '主题色';
                c.appendChild(title);
                for (const p of THEME_PRESETS) {
                    const isActive = currentAccent.toLowerCase() === p.color.toLowerCase();
                    const row = document.createElement('div');
                    row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check-circle' : 'circle'}"></iconify-icon></span><span class="slide-label">${p.label}</span>`;
                    const swatch = document.createElement('span');
                    swatch.style.cssText = `width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid var(--white-12);flex-shrink:0;margin-left:auto;`;
                    row.appendChild(swatch);
                    row.addEventListener('click', () => setTheme(p.color));
                    c.appendChild(row);
                }
            });
            cardContainer(container, (c) => {
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
            });

            const currentCss = getComputedStyle(document.documentElement)
                .getPropertyValue('--font')
                .trim();
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.className = 'section-title';
                title.textContent = '字体';
                c.appendChild(title);
                for (const [key, f] of Object.entries(FONT_MAP)) {
                    const isActive = currentCss === f.css;
                    const row = document.createElement('div');
                    row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check' : 'circle'}"></iconify-icon></span><span class="slide-label">${f.label}</span>`;
                    row.addEventListener('click', () => {
                        document.documentElement.style.setProperty('--font', f.css);
                        SetUIFontFamily(key).catch(() => {});
                        settingsMenu?.reRender();
                        setStatus(`✓ 字体已设为 ${f.label}`, true);
                    });
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    '滑动动画',
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--ui-animations')
                        .trim() !== '0',
                    (v) => {
                        document.documentElement.style.setProperty(
                            '--ui-animations',
                            v ? '1' : '0'
                        );
                        SetUIAnimations(v).catch(() => {});
                    },
                    'lucide:move'
                );
                addToggleRow(
                    c,
                    '背景模糊',
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--ui-blur')
                        .trim() !== '0',
                    (v) => {
                        document.documentElement.style.setProperty('--ui-blur', v ? '1' : '0');
                        document
                            .querySelectorAll<HTMLElement>('.overlay')
                            .forEach((el) => el.classList.toggle('blur-bg', v));
                        SetUIBlurBg(v).catch(() => {});
                    },
                    'lucide:monitor'
                );
            });

            cardContainer(container, (c) => {
                const resetRow = document.createElement('div');
                resetRow.className = 'slide-item';
                resetRow.innerHTML =
                    '<span class="slide-icon"><iconify-icon icon="lucide:rotate-ccw"></iconify-icon></span><span class="slide-label">恢复默认</span>';
                resetRow.addEventListener('click', () => {
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
                    setDisplayNamePriority('filename');
                    SetDisplayNamePriority('filename').catch(() => {});
                    setPerformanceMode('auto');
                    SetPerformanceMode('auto').catch(() => {});
                    settingsMenu?.reRender();
                    setStatus('✓ 设置已恢复默认', true);
                });
                c.appendChild(resetRow);
            });
        },
    };
}

function addCsRow(
    container: HTMLElement,
    label: string,
    icon: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    onChange: (v: number) => void
): void {
    let currentValue = initial;
    const range = max - min;
    const row = document.createElement('div');
    row.className = 'cs-row';

    const top = document.createElement('div');
    top.className = 'cs-top';
    const iconBox = document.createElement('span');
    iconBox.className = 'cs-icon';
    const iconEl = createIconifyIcon(icon);
    if (iconEl) {
        iconBox.appendChild(iconEl);
    }
    top.appendChild(iconBox);
    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'cs-value';
    const fmt = (v: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(2));
    val.textContent = fmt(currentValue);
    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement('div');
    bar.className = 'cs-bar';
    const fill = document.createElement('div');
    fill.className = 'cs-fill';
    const pct = ((currentValue - min) / range) * 100;
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    bar.appendChild(fill);

    function updateDisplay(v: number): void {
        currentValue = v;
        val.textContent = fmt(v);
        fill.style.width = Math.max(0, Math.min(100, ((v - min) / range) * 100)) + '%';
    }

    row.addEventListener('click', (e) => {
        const rect = row.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        let delta: number;
        if (x < 0.25) {
            delta = -(range * 0.15);
        } else if (x < 0.5) {
            delta = -(range * 0.05);
        } else if (x < 0.75) {
            delta = range * 0.05;
        } else {
            delta = range * 0.15;
        }
        let newVal = Math.round((currentValue + delta) / step) * step;
        newVal = Math.max(min, Math.min(max, newVal));
        updateDisplay(newVal);
        onChange(newVal);
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);
}

const THEME_PRESETS: Array<{ label: string; color: string }> = [
    { label: '经典蓝', color: '#4a6cf7' },
    { label: '樱花粉', color: '#f74a6c' },
    { label: '薄荷绿', color: '#4af7a6' },
    { label: '日落橙', color: '#f7a64a' },
    { label: '暗夜紫', color: '#6c4af7' },
    { label: '极简灰', color: '#888888' },
];

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

    const mix = (target: number) => {
        const factor = target / 255;
        const r = Math.round(rgb.r * factor + 255 * (1 - factor));
        const g = Math.round(rgb.g * factor + 255 * (1 - factor));
        const b = Math.round(rgb.b * factor + 255 * (1 - factor));
        return `rgb(${r}, ${g}, ${b})`;
    };

    return {
        bright: mix(brightness > 128 ? 0.15 : 0.1),
        dim: mix(brightness > 128 ? 0.3 : 0.2),
        muted: mix(brightness > 128 ? 0.45 : 0.35),
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

    try {
        await SetUIAccent(hex);
        setStatus(`✓ 主题色已设为 ${hex}`, true);
    } catch {
        setStatus('✗ 主题色保存失败', false);
    }
    settingsMenu.reRender();
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

function buildSettingsClearCacheLevel(): PopupLevel {
    return {
        label: '清除缓存',
        dir: '',
        items: [
            { kind: 'action', label: '提取缓存', icon: 'trash-2', target: 'set:clearextractcache' },
            {
                kind: 'action',
                label: '缩略图缓存',
                icon: 'image',
                target: 'set:clearthumbnail',
            },
        ],
    };
}

function buildSettingsSystemLevel(): PopupLevel {
    return {
        label: '系统',
        dir: '',
        items: [
            { kind: 'folder', label: '外部库管理', icon: 'plug', target: 'settings:external' },
            { kind: 'folder', label: '清除缓存', icon: 'trash-2', target: 'settings:clearcache' },
        ],
    };
}

function handleSettingsAction(row: PopupRow): void {
    switch (row.target) {
        case 'set:name_jp':
        case 'set:name_en': {
            const priority = row.target.replace('set:', '') as DisplayNamePriority;
            setDisplayNamePriority(priority);
            SetDisplayNamePriority(priority).catch(console.warn);
            break;
        }
        case 'set:filename':
            setDisplayNamePriority('filename');
            SetDisplayNamePriority('filename').catch(console.warn);
            break;
        case 'set:clearextractcache':
            ClearExtractCache()
                .then(() => setStatus('✓ 提取缓存已清除', true))
                .catch(console.warn);
            break;
        case 'set:clearthumbnail':
            if (confirm('确定要清除所有缩略图缓存吗？下次加载模型时将重新生成。')) {
                ClearThumbnailCache()
                    .then(() => setStatus('✓ 缩略图缓存已清除', true))
                    .catch(console.warn);
            }
            break;
        case 'set:addexternal':
            (async () => {
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
                    setStatus('✓ 外部库已添加', true);
                } catch (err) {
                    console.error('AddExternalPath error:', err);
                }
            })();
            break;
        default:
            break;
    }
}

// ======== Download Settings ========

function buildSettingsExternalLevel(): PopupLevel {
    return {
        label: '外部库管理',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (externalPaths.length === 0) {
                    const empty = document.createElement('div');
                    empty.style.cssText =
                        'font-size:11px;color:var(--text-dim);padding:8px 0;text-align:center;';
                    empty.textContent = '暂无外部库';
                    c.appendChild(empty);
                    return;
                }
                for (const ep of externalPaths) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.innerHTML = `
                        <span class="slide-icon"><iconify-icon icon="lucide:plug"></iconify-icon></span>
                        <span class="slide-label" style="flex:0 0 auto;margin-right:6px;">${escapeHtml(ep.name)}</span>
                        <span class="slide-sublabel" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);font-size:10px;">${escapeHtml(ep.path)}</span>
                        <button class="ext-rename" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:2px 4px;">✎</button>
                        <button class="ext-del" style="background:none;border:none;color:var(--danger,#e74c3c);cursor:pointer;font-size:12px;padding:2px 4px;">✕</button>
                    `;
                    row.querySelector('.ext-rename')!.addEventListener('click', async () => {
                        const newName = prompt('输入新的显示名称：', ep.name);
                        if (newName && newName.trim() && newName.trim() !== ep.name) {
                            try {
                                await RenameExternalPath(ep.path, newName.trim());
                                await reloadConfig();
                                settingsMenu.reRender();
                                setStatus('✓ 已重命名', true);
                            } catch {
                                setStatus('✗ 重命名失败', false);
                            }
                        }
                    });
                    row.querySelector('.ext-del')!.addEventListener('click', async () => {
                        try {
                            await RemoveExternalPath(ep.path);
                            await reloadConfig();
                            if (libraryRoot) {
                                await rescanAndSync();
                            }
                            settingsMenu.reRender();
                        } catch (err) {
                            console.error('RemoveExternalPath error:', err);
                        }
                    });
                    c.appendChild(row);
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
                        settingsMenu.reRender();
                        setStatus('✓ 外部库已添加', true);
                    } catch (err) {
                        console.error('AddExternalPath error:', err);
                    }
                });
            });
        },
    };
}

// ======== Download Settings ========

function buildSettingsDownloadLevel(): PopupLevel {
    return {
        label: '下载',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            let dirInput: HTMLInputElement;
            let refreshStatus: () => Promise<void>;

            cardContainer(container, (c) => {
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
                const stopRow = document.createElement('div');
                stopRow.className = 'slide-item';
                const si = document.createElement('span');
                si.className = 'slide-icon';
                const se = createIconifyIcon('lucide:stop-circle');
                if (se) {
                    si.appendChild(se);
                }
                stopRow.appendChild(si);
                const sl = document.createElement('span');
                sl.className = 'slide-label';
                sl.textContent = '停止监听';
                sl.style.color = 'var(--danger,#e74c3c)';
                stopRow.appendChild(sl);
                stopRow.addEventListener('click', async () => {
                    try {
                        await StopWatchDir();
                        dirInput.value = '';
                        refreshStatus();
                        setStatus('✓ 已停止监听', true);
                    } catch {
                        setStatus('✗ 停止监听失败', false);
                    }
                });
                c.appendChild(stopRow);
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
                for (const m of PERFORMANCE_MODES) {
                    const isActive = current === m.key;
                    const row = document.createElement('div');
                    row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                    row.innerHTML = `
                        <span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check-circle' : 'circle'}"></iconify-icon></span>
                        <span class="slide-label">${m.label}</span>
                        <span class="slide-sublabel">${m.desc}</span>
                    `;
                    row.addEventListener('click', () => {
                        setPerformanceMode(m.key);
                        SetPerformanceMode(m.key).catch(() => {});
                        settingsMenu.reRender();
                        setStatus(`✓ 性能模式: ${m.label}`, true);
                    });
                    c.appendChild(row);
                }
            });
        },
    };
}

export async function showSettings(): Promise<void> {
    dom.sceneOverlay.innerHTML = '';
    dom.sceneOverlay.classList.remove('sceneOverlay-model', 'sceneOverlay-motion');
    dom.sceneOverlay.classList.add('sceneOverlay-settings');
    dom.sceneOverlay.dataset.popupType = 'settings';

    settingsMenu?.dispose();
    settingsMenu = new SlideMenu({
        container: dom.sceneOverlay,
        onClose: () => {
            (window as any).__getSettingsMenuPush = null;
            (window as any).__getSettingsMenuPop = null;
            (window as any).__getSettingsMenuReRender = null;
            (window as any).__handleSettingsAction = null;
            closeAllOverlays();
        },
        onItemClick: (row) => handleSettingsAction(row),
        onFolderEnter: (row) => {
            switch (row.target) {
                case 'settings:display':
                    return buildSettingsDisplayLevel();
                case 'settings:download':
                    return buildSettingsDownloadLevel();
                case 'settings:ui':
                    return buildSettingsUILevel();
                case 'settings:system':
                    return buildSettingsSystemLevel();
                case 'settings:external':
                    return buildSettingsExternalLevel();
                case 'settings:clearcache':
                    return buildSettingsClearCacheLevel();
                case 'settings:software':
                    return buildSettingsSoftwareLevel();
                default:
                    if (row.target && row.target.startsWith('settings:software-detail:')) {
                        const path = row.target.slice('settings:software-detail:'.length);
                        return buildSoftwareDetailLevel(path);
                    }
                    return null;
            }
        },
        onAfterRender: () => {},
    });

    (window as any).__getSettingsMenuPush = () => settingsMenu?.push.bind(settingsMenu);
    (window as any).__getSettingsMenuPop = () => settingsMenu?.pop.bind(settingsMenu);
    (window as any).__getSettingsMenuReRender = () => settingsMenu?.reRender.bind(settingsMenu);
    (window as any).__handleSettingsAction = handleSettingsAction;

    settingsMenu.reset(buildSettingsRoot());
}
