// settings-about.ts — 关于页面 + 设置导入/导出/重置

import {
    SetUIScale,
    SetUIPopupWidth,
    SetUIAccent,
    SetUIFontFamily,
    SetUIAnimations,
    SetUIBlurBg,
    SetPerformanceMode,
    GetBuildInfo,
    GetCacheStats,
    CheckForUpdate,
    SetUIAutoUpdate,
} from '../core/wails-bindings';
import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { schedulePersistUI } from '../scene/env/env-bridge';
import { slideRow, addToggleRow, addSectionTitle } from '../core/ui-helpers';
import { Browser } from '@wailsio/runtime';
import { t } from '../core/i18n/t';
import { openExternalURL } from '../core/platform';
import { renderMenu } from './render-menu';
import type { PopupLevel } from '../core/config';
import type { MenuNode } from './menu-schema';
import { SETTINGS_ACTION } from './settings-targets';
import { applyUIAppearanceDom, formatBytes, type SettingsMenuHandle } from './settings-shared';
import { getAllShortcuts, formatKeyBinding } from '../core/shortcut-registry';
import { setPerformanceMode } from '../scene/render/performance';
import { engine, applyFrameControl } from '../scene/scene';
import { refreshCameraUserSettings } from '../scene/camera/camera';
import { setVolume, getVolume, setAudioOffset, getAudioOffset } from '../outfit/audio';
import { handleSettingsAction } from './settings-paths';
import { swallowError, logWarn, jsonStringify } from '../core/utils';
import { addDisposableListener } from '../core/dom';
import { showConfirm } from '../core/dialog';

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
    engine.setHardwareScalingLevel(1 / (uiState.renderScale ?? 1));
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
                    throw new Error('文件格式不正确');
                }
                Object.assign(uiState, parsed);
                schedulePersistUI();
                reapplyImportedSettings();
                // getSettingsMenu will be called via reRender from the caller
                setStatus(t('settings.imported'), true);
            } catch (e) {
                setStatus(
                    t('settings.importFailed') + (e instanceof Error ? e.message : String(e)),
                    true
                );
            }
        };
        reader.onerror = () => setStatus(t('settings.readFailed'), true);
        reader.readAsText(file);
    };
    input.click();
}

function resetAllSettings(getSettingsMenu: () => SettingsMenuHandle): void {
    for (const k of Object.keys(uiState)) {
        delete (uiState as Record<string, unknown>)[k];
    }
    schedulePersistUI();
    reapplyImportedSettings();
    getSettingsMenu()?.reRender();
    setStatus(t('settings.resetToDefault'), true);
}

function buildAboutSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    // 从注册表动态读取快捷键，避免硬编码漂移
    const registeredShortcuts = getAllShortcuts().map((s) => ({
        key: formatKeyBinding(s.currentKey, s.currentCtrl, s.currentShift, s.currentAlt),
        desc: t(s.label),
    }));
    // 补充：非注册表的连续移动控制（WASD/Q-E 不适合进 shortcut-registry）
    const extraControls: Array<{ key: string; desc: string }> = [
        { key: 'WASD', desc: t('settings.about.shortcuts.freefly') },
        { key: 'Q / E', desc: t('settings.about.shortcuts.freeflyUpDown') },
    ];
    const shortcuts = [...registeredShortcuts, ...extraControls];

    return [
        // 卡片 1：版本信息
        {
            id: 'about:version',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '版本信息');
                    const title = document.createElement('div');
                    title.style.cssText = 'text-align:center;padding:16px 14px 8px;';
                    title.innerHTML = `
                        <div style="font-size:15px;font-weight:600;color:var(--text);">MikuMikuAR</div>
                        <div data-app-version style="font-size:11px;color:var(--text-dim);margin-top:2px;">v…</div>
                    `;
                    inner.appendChild(title);
                    GetBuildInfo()
                        .then((info) => {
                            const el = title.querySelector<HTMLElement>('[data-app-version]');
                            if (el) {
                                el.textContent = `v${info.version}`;
                            }
                            const detail = document.createElement('div');
                            detail.className = 'about-version-info';
                            detail.innerHTML = `<div>build: ${info.buildTime}</div><div>commit: ${info.commitHash}</div><div>go: ${info.goVersion}</div>`;
                            inner.appendChild(detail);
                        })
                        .catch((err) => logWarn('settings-about', '', err));
                });
            },
        },
        // 卡片 2：快捷键列表
        {
            id: 'about:shortcuts',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.shortcuts'));
                    for (const s of shortcuts) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.style.cssText = 'padding:6px 14px;';
                        row.innerHTML = `<span class="slide-label" style="flex:1;">${s.desc}</span><span style="font-family:monospace;font-size:11px;color:var(--accent);background:var(--accent-dim);padding:2px 8px;border-radius:4px;">${s.key}</span>`;
                        inner.appendChild(row);
                    }
                });
            },
        },
        // 卡片 3：链接
        {
            id: 'about:links',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.links'));
                    slideRow(inner, 'lucide:github', t('about.github'), false, () => {
                        if (!openExternalURL('https://github.com/eghrhegpe/MikuMikuAR')) {
                            Browser.OpenURL('https://github.com/eghrhegpe/MikuMikuAR');
                        }
                    });
                    slideRow(inner, 'lucide:scroll', t('about.license'), false, () => {
                        if (
                            !openExternalURL(
                                'https://github.com/eghrhegpe/MikuMikuAR/blob/main/LICENSE'
                            )
                        ) {
                            Browser.OpenURL(
                                'https://github.com/eghrhegpe/MikuMikuAR/blob/main/LICENSE'
                            );
                        }
                    });
                    slideRow(inner, 'lucide:bug', t('about.issues'), false, () => {
                        if (!openExternalURL('https://github.com/eghrhegpe/MikuMikuAR/issues')) {
                            Browser.OpenURL('https://github.com/eghrhegpe/MikuMikuAR/issues');
                        }
                    });
                });
            },
        },
        // 卡片 4：缓存统计
        {
            id: 'about:cache',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.cache'));
                    const statRow = document.createElement('div');
                    statRow.className = 'slide-item';
                    statRow.style.cssText =
                        'padding:8px 14px;flex-direction:column;align-items:stretch;gap:4px;';
                    statRow.innerHTML =
                        '<div data-cache-total style="font-size:13px;color:var(--text);font-weight:500;">统计中…</div><div data-cache-detail style="font-size:10px;color:var(--text-dim);line-height:1.6;font-family:monospace;"></div>';
                    inner.appendChild(statRow);

                    const refreshCacheStats = () => {
                        GetCacheStats()
                            .then((s) => {
                                const total =
                                    statRow.querySelector<HTMLElement>('[data-cache-total]');
                                const detail =
                                    statRow.querySelector<HTMLElement>('[data-cache-detail]');
                                if (total) {
                                    total.textContent = `${t('settings.about.cache.total')} ${formatBytes(s.totalBytes)}`;
                                }
                                if (detail) {
                                    detail.innerHTML = `<div>${t('settings.about.cache.resource')}: ${formatBytes(s.resourceBytes)}</div><div>${t('settings.about.cache.extracted')}: ${formatBytes(s.extractedBytes)} (${s.extractedCount} 项)</div><div>${t('settings.about.cache.thumbnails')}: ${formatBytes(s.thumbnailBytes)} (${s.thumbnailCount} 项)</div>`;
                                }
                            })
                            .catch((err) => logWarn('settings-about', '', err));
                    };
                    refreshCacheStats();
                    const refreshDisp = addDisposableListener(
                        window,
                        'mmar:cache-cleared',
                        refreshCacheStats
                    );
                    const cleanupObserver = new MutationObserver(() => {
                        if (!c.isConnected) {
                            refreshDisp.dispose();
                            cleanupObserver.disconnect();
                        }
                    });
                    cleanupObserver.observe(document.documentElement, {
                        childList: true,
                        subtree: true,
                    });
                });
            },
        },
        // 卡片 5：更新
        {
            id: 'about:update',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.update'));
                    addToggleRow(
                        inner,
                        t('settings.about.update.autoCheck'),
                        uiState.autoUpdateEnabled === true,
                        (v) => {
                            setUIState({ autoUpdateEnabled: v });
                            SetUIAutoUpdate(v);
                            setStatus(
                                t('settings.autoUpdate', {
                                    state: v ? t('common.on') : t('common.off'),
                                }),
                                true
                            );
                        }
                    );
                    const resultRow = document.createElement('div');
                    resultRow.className = 'slide-item';
                    resultRow.style.cssText =
                        'flex-direction:column;align-items:stretch;gap:4px;padding:8px 14px;';
                    resultRow.innerHTML =
                        '<div data-update-status style="font-size:12px;color:var(--text);">点击「检查更新」查看版本</div><a data-update-link href="#" style="display:none;font-size:12px;color:var(--accent);cursor:pointer;">前往下载最新版本 →</a>';
                    inner.appendChild(resultRow);
                    slideRow(
                        inner,
                        'lucide:download',
                        t('settings.about.update.checkNow'),
                        false,
                        async () => {
                            const statusEl =
                                resultRow.querySelector<HTMLElement>('[data-update-status]');
                            const linkEl =
                                resultRow.querySelector<HTMLAnchorElement>('[data-update-link]');
                            if (statusEl) {
                                statusEl.textContent = t('settings.about.update.checking');
                            }
                            if (linkEl) {
                                linkEl.style.display = 'none';
                            }
                            try {
                                const r = await CheckForUpdate();
                                if (!r) {
                                    if (statusEl) {
                                        statusEl.textContent = t('settings.about.update.failed');
                                    }
                                    return;
                                }
                                if (r.error) {
                                    if (statusEl) {
                                        statusEl.textContent = t('settings.about.update.error', {
                                            err: r.error,
                                        });
                                    }
                                    return;
                                }
                                if (statusEl) {
                                    statusEl.textContent = r.available
                                        ? t('settings.about.update.available', {
                                              latest: r.latest,
                                              current: r.current,
                                          })
                                        : t('settings.about.update.latest', { current: r.current });
                                }
                                if (linkEl && r.available && r.url) {
                                    linkEl.style.display = 'inline';
                                    linkEl.onclick = (e) => {
                                        e.preventDefault();
                                        if (!openExternalURL(r.url)) {
                                            Browser.OpenURL(r.url);
                                        }
                                    };
                                }
                            } catch {
                                if (statusEl) {
                                    statusEl.textContent = t('settings.about.update.failed');
                                }
                            }
                        }
                    );
                });
            },
        },
        // 卡片 6：维护（缓存清理）
        {
            id: 'about:maintenance',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.maintenance'));
                    slideRow(
                        inner,
                        'lucide:trash-2',
                        t('settings.about.maintenance.clearExtract'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.CLEAR_EXTRACT_CACHE,
                            })
                    );
                    slideRow(
                        inner,
                        'lucide:image',
                        t('settings.about.maintenance.clearThumbnail'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.CLEAR_THUMBNAIL,
                            })
                    );
                    slideRow(
                        inner,
                        'lucide:trash',
                        t('settings.about.maintenance.clearAll'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.CLEAR_ALL_CACHE,
                            })
                    );
                });
            },
        },
        // 卡片 7：设置管理（导入/导出/重置）
        {
            id: 'about:settings-mgmt',
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
                            showConfirm(t('settings.about.settingsMgmt.resetConfirm')).then(
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

export function buildSettingsAboutLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.about.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildAboutSchema(getSettingsMenu), container);
        },
    };
}
