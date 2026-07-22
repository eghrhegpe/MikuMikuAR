// settings-system.ts — 系统设置子菜单（ADR-157：缓存 + 外部软件 + 设置管理）
// 修复：缓存统计改由 renderCustom dispose 释放监听（移除全树 MutationObserver）；
//       设置导入增加白名单 + 数值 clamp 校验（替代裸 Object.assign）。

import {
    GetCacheStats,
    OpenCacheDir,
    SetUIScale,
    SetUIPopupWidth,
    SetUIAccent,
    SetUIFontFamily,
    SetUIAnimations,
    SetUIBlurBg,
    SetPerformanceMode,
    ScanSoftwareDir,
    LaunchSoftware,
    AddCustomSoftware,
    RemoveCustomSoftware,
    UpdateCustomSoftware,
    SetBlenderPath,
    SetMMDPath,
    SelectExeFile,
} from '../core/wails-bindings';
import {
    setStatus,
    uiState,
    setUIState,
    cardContainer,
    escapeHtml,
    type PopupLevel,
} from '../core/config';
import { slideRow, addSectionTitle, addDangerRow, addFieldRow } from '../core/ui-helpers';
import { showConfirm, showPrompt } from '../core/dialog';
import { addDisposableListener, type Disposable } from '../core/dom';
import { softwareKindIcon } from '../core/icons';
import { tryCatchStatus, swallowError, jsonStringify } from '../core/utils';
import { safeCallAsync } from '../core/safe-call';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { schedulePersistUI } from '../scene/env/env-bridge';
import { setPerformanceMode } from '../scene/render/performance';
import { engine, applyFrameControl } from '../scene/scene';
import { calcHardwareScaling } from '../core/render-loop';
import { refreshCameraUserSettings } from '../scene/camera/camera';
import { setVolume, getVolume, setAudioOffset, getAudioOffset } from '../outfit/audio';
import { SETTINGS_ACTION } from './settings-targets';
import { SETTINGS_ACTIONS } from './settings-actions';
import { applyUIAppearanceDom, formatBytes } from './settings-shared';
import type { SlideMenu } from './menu';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 设置导入白名单校验（修复零校验污染 uiState） ========

type SettingValidator = (v: unknown) => unknown | undefined;
const num =
    (min: number, max: number): SettingValidator =>
    (v) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const bool: SettingValidator = (v) => (typeof v === 'boolean' ? v : undefined);
const str: SettingValidator = (v) => (typeof v === 'string' ? v : undefined);
const enumOf =
    (...allowed: string[]): SettingValidator =>
    (v) =>
        typeof v === 'string' && allowed.includes(v) ? v : undefined;
const plainObj: SettingValidator = (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
const boolOrNull: SettingValidator = (v) => (typeof v === 'boolean' || v === null ? v : undefined);

const UI_SETTINGS_VALIDATORS: Record<string, SettingValidator> = {
    scale: num(0.5, 2),
    popupWidth: num(160, 600),
    accent: str,
    fontFamily: str,
    animations: bool,
    blurBg: bool,
    performanceMode: enumOf('auto', 'quality', 'balanced', 'performance', 'custom'),
    fpsLimit: num(0, 240),
    vsync: bool,
    defaultPhysicsEnabled: bool,
    renderScale: num(0.25, 4),
    cameraSensitivity: num(0.1, 10),
    invertYAxis: bool,
    autoScaleModel: bool,
    autoCenterModel: bool,
    materialCategoryMap: plainObj,
    screenshotFormat: enumOf('image/png', 'image/jpeg', 'image/webp'),
    screenshotQuality: num(0.1, 1),
    thumbnailResolution: num(64, 8192),
    screenshotDir: str,
    autoCameraEnabled: bool,
    autoCameraBeatsPerSwitch: num(1, 64),
    autoUpdateEnabled: bool,
    resourceViewMode: enumOf('list', 'grid'),
    volume: num(0, 1),
    audioOffset: num(-30, 30),
    bpmQuantizeEnabled: bool,
    autoLoadCompanionAudio: bool,
    sfxEnabled: bool,
    sfxVolume: num(0, 1),
    footstepEnabled: bool,
    footstepVolume: num(0, 1),
    audioRepeatMode: enumOf('none', 'one', 'all', 'shuffle'),
    keyBindings: plainObj,
    showFpsClock: boolOrNull,
    showRuntimeBadge: boolOrNull,
    keepAwake: bool,
    screenOrientation: enumOf('auto', 'portrait', 'landscape'),
};

/** 仅保留白名单内的键，并按规则收敛数值范围；未知键/非法值一律丢弃。 */
function sanitizeImportedSettings(parsed: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(UI_SETTINGS_VALIDATORS)) {
        if (key in parsed) {
            const v = validator(parsed[key]);
            if (v !== undefined) {
                clean[key] = v;
            }
        }
    }
    return clean;
}

// ======== 设置管理（导出 / 导入 / 重置） ========

function exportSettings(): void {
    const data = jsonStringify(uiState);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `mikumikuar-settings-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(t('settings.exported'), true);
}

function reapplyImportedSettings(): void {
    applyFrameControl();
    engine.setHardwareScalingLevel(
        calcHardwareScaling(window.devicePixelRatio || 1, uiState.renderScale ?? 1)
    );
    refreshCameraUserSettings();
    setVolume(getVolume());
    setAudioOffset(getAudioOffset());
    applyUIAppearanceDom(uiState);
    const pm = uiState.performanceMode ?? 'auto';
    setPerformanceMode(pm);
    swallowError(SetPerformanceMode(pm));
    swallowError(SetUIScale(uiState.scale ?? 1));
    if (uiState.popupWidth) {
        swallowError(SetUIPopupWidth(uiState.popupWidth));
    }
    if (uiState.accent) {
        swallowError(SetUIAccent(uiState.accent));
    }
    if (uiState.fontFamily) {
        swallowError(SetUIFontFamily(uiState.fontFamily));
    }
    swallowError(SetUIAnimations(uiState.animations !== false));
    swallowError(SetUIBlurBg(!!uiState.blurBg));
}

function importSettings(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result)) as Record<string, unknown>;
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    throw new Error(t('settings.importBadFormat'));
                }
                // 白名单 + clamp 校验，未知键/非法值丢弃，避免脏数据污染全局状态
                const clean = sanitizeImportedSettings(parsed);
                Object.assign(uiState, clean);
                schedulePersistUI();
                reapplyImportedSettings();
                setStatus(t('settings.imported'), true);
            } catch (e) {
                setStatus(t('settings.importFailed') + translateGoError(e), true);
            }
        };
        reader.onerror = () => setStatus(t('settings.readFailed'), true);
        reader.readAsText(file);
    };
    input.click();
}

function resetAllSettings(getSettingsMenu: () => SlideMenu | null): void {
    for (const k of Object.keys(uiState)) {
        delete (uiState as Record<string, unknown>)[k];
    }
    schedulePersistUI();
    reapplyImportedSettings();
    getSettingsMenu()?.reRender();
    setStatus(t('settings.resetToDefault'), true);
}

function buildSettingsMgmtSchema(getSettingsMenu: () => SlideMenu | null): MenuNode[] {
    return [
        {
            id: 'system:settings-mgmt',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.settingsMgmt'));
                    slideRow(
                        inner,
                        'lucide:download',
                        t('settings.about.settingsMgmt.export'),
                        false,
                        () => exportSettings()
                    );
                    slideRow(
                        inner,
                        'lucide:upload',
                        t('settings.about.settingsMgmt.import'),
                        false,
                        () => {
                            importSettings();
                            getSettingsMenu()?.reRender();
                        }
                    );
                    slideRow(
                        inner,
                        'lucide:rotate-ccw',
                        t('settings.about.settingsMgmt.reset'),
                        false,
                        () => {
                            void showConfirm(t('settings.about.settingsMgmt.resetConfirm')).then(
                                (ok) => {
                                    if (ok) {
                                        resetAllSettings(getSettingsMenu);
                                    }
                                }
                            );
                        }
                    );
                    const hint = document.createElement('div');
                    hint.className = 'setting-hint';
                    hint.textContent = t('settings.about.settingsMgmt.hint');
                    inner.appendChild(hint);
                });
            },
        },
    ];
}

// ======== 缓存管理（修复：dispose 释放监听，移除全树 MutationObserver） ========

function buildCacheSchema(): MenuNode[] {
    return [
        {
            id: 'system:cache',
            kind: 'custom',
            renderCustom: (c) => {
                let refreshDisp: Disposable | null = null;

                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.cache'));
                    // 缓存统计
                    const statRow = document.createElement('div');
                    statRow.className = 'slide-item';
                    statRow.style.cssText =
                        'padding:8px 14px;flex-direction:column;align-items:stretch;gap:4px;';
                    const totalEl = document.createElement('div');
                    totalEl.style.cssText = 'font-size:13px;color:var(--text);font-weight:500;';
                    totalEl.textContent = t('settings.about.cache.counting');
                    statRow.appendChild(totalEl);
                    const detailEl = document.createElement('div');
                    detailEl.style.cssText =
                        'font-size:10px;color:var(--text-dim);line-height:1.6;font-family:monospace;';
                    statRow.appendChild(detailEl);
                    inner.appendChild(statRow);

                    const refreshCacheStats = () => {
                        safeCallAsync('system', '', () =>
                            GetCacheStats().then((s) => {
                                totalEl.textContent = `${t('settings.about.cache.total')} ${formatBytes(s.totalBytes)}`;
                                detailEl.textContent = '';
                                const resourceRow = document.createElement('div');
                                resourceRow.textContent = `${t('settings.about.cache.resource')}: ${formatBytes(s.resourceBytes)}`;
                                detailEl.appendChild(resourceRow);
                                const extractedRow = document.createElement('div');
                                extractedRow.textContent = `${t('settings.about.cache.extracted')}: ${formatBytes(s.extractedBytes)} (${s.extractedCount} ${t('common.items')})`;
                                detailEl.appendChild(extractedRow);
                                const thumbRow = document.createElement('div');
                                thumbRow.textContent = `${t('settings.about.cache.thumbnails')}: ${formatBytes(s.thumbnailBytes)} (${s.thumbnailCount} ${t('common.items')})`;
                                detailEl.appendChild(thumbRow);
                            })
                        );
                    };
                    refreshCacheStats();
                    refreshDisp = addDisposableListener(
                        window,
                        'mmar:cache-cleared',
                        refreshCacheStats
                    );

                    // 缓存清理按钮
                    slideRow(
                        inner,
                        'lucide:folder-open',
                        t('settings.about.maintenance.openExtract'),
                        false,
                        () => {
                            OpenCacheDir('extracted').catch((err: unknown) => {
                                const msg =
                                    typeof err === 'object' && err !== null && 'message' in err
                                        ? String((err as { message: unknown }).message)
                                        : String(err);
                                setStatus(t('settings.error', { message: msg }), false);
                            });
                        }
                    );
                    slideRow(
                        inner,
                        'lucide:trash-2',
                        t('settings.about.maintenance.clearExtract'),
                        false,
                        () => SETTINGS_ACTIONS[SETTINGS_ACTION.CLEAR_EXTRACT_CACHE]()
                    );
                    slideRow(
                        inner,
                        'lucide:folder-open',
                        t('settings.about.maintenance.openThumbnail'),
                        false,
                        () => {
                            OpenCacheDir('thumbnails').catch((err: unknown) => {
                                const msg =
                                    typeof err === 'object' && err !== null && 'message' in err
                                        ? String((err as { message: unknown }).message)
                                        : String(err);
                                setStatus(t('settings.error', { message: msg }), false);
                            });
                        }
                    );
                    slideRow(
                        inner,
                        'lucide:image',
                        t('settings.about.maintenance.clearThumbnail'),
                        false,
                        () => SETTINGS_ACTIONS[SETTINGS_ACTION.CLEAR_THUMBNAIL]()
                    );
                    slideRow(
                        inner,
                        'lucide:trash',
                        t('settings.about.maintenance.clearAll'),
                        false,
                        () => SETTINGS_ACTIONS[SETTINGS_ACTION.CLEAR_ALL_CACHE]()
                    );
                });

                // 由 renderMenu 级联调用：菜单关闭/重渲染时释放缓存事件监听
                return () => {
                    refreshDisp?.dispose();
                    refreshDisp = null;
                };
            },
        },
    ];
}

// ======== 外部软件（列表 / 详情 / 路径设置） ========

let cachedSoftwareEntries: import('../core/wails-bindings').SoftwareEntry[] | null = null;

export async function setBlenderPath(): Promise<void> {
    const path = await SelectExeFile();
    if (!path) {
        return;
    }
    const r = await tryCatchStatus(async () => {
        await SetBlenderPath(path);
        return true;
    }, t('settings.software.setFailed'));
    if (r) {
        setStatus(t('settings.software.blenderSet'), true);
    }
}

export async function setMMDPath(): Promise<void> {
    const path = await SelectExeFile();
    if (!path) {
        return;
    }
    const r = await tryCatchStatus(async () => {
        await SetMMDPath(path);
        return true;
    }, t('settings.software.setFailed'));
    if (r) {
        setStatus(t('settings.software.mmdSet'), true);
    }
}

export async function addCustomSoftware(): Promise<boolean> {
    const path = await SelectExeFile();
    if (!path) {
        return false;
    }
    const name =
        path
            .split(/[/\\]/)
            .pop()
            ?.replace(/\.exe$/i, '') || t('common.unknown');
    const args = await showPrompt(t('settings.software.argsHint'), '');
    if (args === null) {
        return false;
    }
    const r = await tryCatchStatus(async () => {
        await AddCustomSoftware(path, name, args);
        return true;
    }, t('settings.software.addFailed'));
    if (r) {
        await scanSoftwareDir();
        setStatus(t('settings.softwareAdded', { name }), true);
        return true;
    }
    return false;
}

export async function scanSoftwareDir(): Promise<void> {
    try {
        cachedSoftwareEntries = await ScanSoftwareDir();
    } catch (err) {
        console.error('ScanSoftwareDir error:', err);
        cachedSoftwareEntries = [];
    }
}

function buildSoftwareListSchema(getSettingsMenu: () => SlideMenu | null): MenuNode[] {
    return [
        {
            id: 'system:software-list',
            kind: 'custom',
            renderCustom: (container) => {
                // 同步壳 + 内部 async + disposed 守卫：MenuNode.renderCustom 契约不允许返回 Promise（与 settings-resources 范式一致）
                let disposed = false;
                void (async () => {
                    await scanSoftwareDir();
                    if (disposed) {
                        return;
                    }
                    const entries = cachedSoftwareEntries;
                    if (entries && entries.length > 0) {
                        cardContainer(container, (c) => {
                            addSectionTitle(c, t('settings.software.title'));
                            for (const entry of entries) {
                                slideRow(
                                    c,
                                    softwareKindIcon(entry.kind),
                                    escapeHtml(entry.name),
                                    false,
                                    () =>
                                        getSettingsMenu()?.push(
                                            buildSoftwareDetailLevel(entry.path, getSettingsMenu)
                                        ),
                                    escapeHtml(entry.kind),
                                    entry.managed ? t('settings.software.custom') : 'auto',
                                    undefined,
                                    undefined,
                                    {
                                        trailing: {
                                            icon: '▶',
                                            onClick: async () => {
                                                const r = await tryCatchStatus(
                                                    async () => {
                                                        await LaunchSoftware(
                                                            entry.path,
                                                            entry.args || ''
                                                        );
                                                        return true as const;
                                                    },
                                                    t('settings.softwareStartFail', {
                                                        name: entry.name,
                                                    })
                                                );
                                                if (r !== undefined) {
                                                    setStatus(
                                                        t('settings.softwareStarted', {
                                                            name: entry.name,
                                                        }),
                                                        true
                                                    );
                                                }
                                            },
                                        },
                                    }
                                );
                            }
                        });
                    }
                })();
                return () => {
                    disposed = true;
                };
            },
        },
        {
            id: 'system:software-actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.software.actions'));
                    slideRow(
                        inner,
                        'lucide:plus',
                        t('settings.software.addCustom'),
                        false,
                        async () => {
                            if (await addCustomSoftware()) {
                                getSettingsMenu()?.reRender();
                            }
                        }
                    );
                    slideRow(inner, 'lucide:folder', t('settings.software.setMmdPath'), false, () =>
                        setMMDPath()
                    );
                    slideRow(
                        inner,
                        'lucide:hexagon',
                        t('settings.software.setBlenderPath'),
                        false,
                        () => setBlenderPath()
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

function buildSoftwareDetailManagedSchema(
    entry: import('../core/wails-bindings').SoftwareEntry,
    getSettingsMenu: () => SlideMenu | null
): MenuNode[] {
    return [
        {
            id: 'software-detail:info',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.software.info'));
                    const fields: Array<{ label: string; value: string }> = [
                        { label: t('settings.software.name'), value: entry.name },
                        { label: t('settings.software.path'), value: entry.path },
                        { label: t('settings.software.kind'), value: entry.kind },
                    ];
                    for (const f of fields) {
                        addFieldRow(inner, f.label, escapeHtml(f.value));
                    }
                    const argRow = document.createElement('div');
                    argRow.style.cssText = 'padding:6px 14px;';
                    const argLbl = document.createElement('div');
                    argLbl.style.cssText =
                        'font-size:10px;color:var(--text-dim);margin-bottom:2px;';
                    argLbl.textContent = t('settings.software.argsHint');
                    argRow.appendChild(argLbl);
                    const val = document.createElement('div');
                    val.style.cssText =
                        'background:var(--white-08);border:1px solid var(--border);border-radius:4px;padding:4px 6px;';
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = entry.args || '';
                    input.style.cssText =
                        'width:100%;background:transparent;border:none;color:var(--text);font-size:12px;outline:none;';
                    input.addEventListener('blur', async () => {
                        const r = await tryCatchStatus(async () => {
                            await UpdateCustomSoftware(entry.path, entry.name, input.value);
                            return true;
                        }, t('settings.software.updateFailed'));
                        if (r) {
                            entry.args = input.value;
                            setStatus(t('settings.software.paramsUpdated'), true);
                        }
                    });
                    val.appendChild(input);
                    argRow.appendChild(val);
                    inner.appendChild(argRow);
                });
            },
        },
        {
            id: 'software-detail:actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.software.actions'));
                    slideRow(inner, 'lucide:play', t('settings.software.launch'), false, () => {
                        LaunchSoftware(entry.path, entry.args || '')
                            .then(() =>
                                setStatus(t('settings.softwareStarted', { name: entry.name }), true)
                            )
                            .catch((err: unknown) =>
                                setStatus(
                                    t('status.error', {
                                        message: translateGoError(err),
                                    }),
                                    false
                                )
                            );
                    });

                    addDangerRow(
                        inner,
                        'lucide:trash-2',
                        t('settings.software.delete'),
                        async () => {
                            const r = await tryCatchStatus(
                                async () => {
                                    await RemoveCustomSoftware(entry.path);
                                    return true;
                                },
                                t('settings.softwareDeleteFail', { name: entry.name })
                            );
                            if (r) {
                                cachedSoftwareEntries = (cachedSoftwareEntries || []).filter(
                                    (e) => e.path !== entry.path
                                );
                                setStatus(
                                    t('settings.softwareDeleted', { name: entry.name }),
                                    true
                                );
                                const menu = getSettingsMenu();
                                menu?.pop();
                                menu?.reRender();
                            }
                        }
                    );
                });
            },
        },
    ];
}

function buildSoftwareDetailAutoSchema(
    entry: import('../core/wails-bindings').SoftwareEntry,
    getSettingsMenu: () => SlideMenu | null
): MenuNode[] {
    return [
        {
            id: 'software-detail:info',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.software.info'));
                    const fields: Array<{ label: string; value: string }> = [
                        { label: t('settings.software.name'), value: entry.name },
                        { label: t('settings.software.path'), value: entry.path },
                        { label: t('settings.software.kind'), value: entry.kind },
                    ];
                    for (const f of fields) {
                        addFieldRow(inner, f.label, escapeHtml(f.value));
                    }
                });
            },
        },
        {
            id: 'software-detail:actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.software.actions'));
                    slideRow(inner, 'lucide:play', t('settings.software.launch'), false, () => {
                        LaunchSoftware(entry.path, entry.args)
                            .then(() =>
                                setStatus(t('settings.softwareStarted', { name: entry.name }), true)
                            )
                            .catch((err: unknown) =>
                                setStatus(
                                    t('status.error', {
                                        message: translateGoError(err),
                                    }),
                                    false
                                )
                            );
                    });

                    slideRow(
                        inner,
                        'lucide:plus',
                        t('settings.software.convertToCustom'),
                        false,
                        async () => {
                            const args = await showPrompt(t('settings.software.argsHint'), '');
                            if (args === null) {
                                return;
                            }
                            const r = await tryCatchStatus(async () => {
                                await AddCustomSoftware(entry.path, entry.name, args);
                                return true;
                            }, t('settings.software.convertFailed'));
                            if (r) {
                                cachedSoftwareEntries = await ScanSoftwareDir();
                                setStatus(
                                    t('settings.softwareToCustom', { name: entry.name }),
                                    true
                                );
                                const menu = getSettingsMenu();
                                menu?.pop();
                                menu?.reRender();
                            }
                        }
                    );
                });
            },
        },
    ];
}

export function buildSoftwareDetailLevel(
    path: string,
    getSettingsMenu: () => SlideMenu | null
): PopupLevel {
    const entries = cachedSoftwareEntries || [];
    const entry = entries.find((e) => e.path === path);
    if (!entry) {
        return {
            label: t('settings.software.unknown'),
            dir: '',
            items: [
                {
                    kind: 'action',
                    label: t('settings.software.notFound'),
                    icon: 'alert-circle',
                    target: '',
                },
            ],
        };
    }

    const schema = entry.managed
        ? buildSoftwareDetailManagedSchema(entry, getSettingsMenu)
        : buildSoftwareDetailAutoSchema(entry, getSettingsMenu);

    return {
        label: entry.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(schema, container);
        },
    };
}

// ======== 系统页组装 ========

function buildSystemSchema(getSettingsMenu: () => SlideMenu | null): MenuNode[] {
    return [
        ...buildCacheSchema(),
        ...buildSoftwareListSchema(getSettingsMenu),
        ...buildSettingsMgmtSchema(getSettingsMenu),
    ];
}

export function buildSettingsSystemLevel(getSettingsMenu: () => SlideMenu | null): PopupLevel {
    return {
        label: t('settings.system'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildSystemSchema(getSettingsMenu), container);
        },
    };
}
