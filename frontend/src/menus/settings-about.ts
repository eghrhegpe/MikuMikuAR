// settings-about.ts — 关于页面 + 设置导入/导出/重置

import {
    SetUIScale, SetUIPopupWidth, SetUIAccent, SetUIFontFamily,
    SetUIAnimations, SetUIBlurBg, SetPerformanceMode,
    GetBuildInfo, GetCacheStats, CheckForUpdate, SetUIAutoUpdate,
} from '../core/wails-bindings';
import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { slideRow, addToggleRow, addSectionTitle } from '../core/ui-helpers';
import { Browser } from '@wailsio/runtime';
import { t } from '../core/i18n/t';
import type { PopupLevel, PopupRow } from '../core/config';
import { SETTINGS_ACTION, SOFTWARE_DETAIL_PREFIX } from './settings-targets';
import { applyUIAppearanceDom, formatBytes } from './settings-shared';
import { setPerformanceMode } from '../scene/render/performance';
import { engine, applyFrameControl } from '../scene/scene';
import { refreshCameraUserSettings } from '../scene/camera/camera';
import { setVolume, getVolume, setAudioOffset, getAudioOffset } from '../outfit/audio';
import { handleSettingsAction } from './settings-paths';
import { buildSoftwareDetailLevel } from './settings-software';

type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

let _cacheClearedListenerRegistered = false;

function exportSettings(): void {
    const data = JSON.stringify(uiState, null, 2);
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
    SetPerformanceMode(pm).catch(() => {});
    SetUIScale(uiState.scale ?? 1).catch(() => {});
    if (uiState.popupWidth) SetUIPopupWidth(uiState.popupWidth).catch(() => {});
    if (uiState.accent) SetUIAccent(uiState.accent).catch(() => {});
    if (uiState.fontFamily) SetUIFontFamily(uiState.fontFamily).catch(() => {});
    SetUIAnimations(uiState.animations !== false).catch(() => {});
    SetUIBlurBg(!!uiState.blurBg).catch(() => {});
}

function importSettings(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result)) as Record<string, unknown>;
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    throw new Error('文件格式不正确');
                }
                Object.assign(uiState, parsed);
                reapplyImportedSettings();
                // getSettingsMenu will be called via reRender from the caller
                setStatus(t('settings.imported'), true);
            } catch (e) {
                setStatus(t('settings.importFailed') + (e instanceof Error ? e.message : String(e)), true);
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
    reapplyImportedSettings();
    getSettingsMenu()?.reRender();
    setStatus(t('settings.resetToDefault'), true);
}

export function buildSettingsAboutLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
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
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText = 'text-align:center;padding:16px 14px 8px;';
                title.innerHTML = `
                    <div style="font-size:15px;font-weight:600;color:var(--text);">MikuMikuAR</div>
                    <div data-app-version style="font-size:11px;color:var(--text-dim);margin-top:2px;">v…</div>
                `;
                c.appendChild(title);
                GetBuildInfo()
                    .then((info) => {
                        const el = title.querySelector<HTMLElement>('[data-app-version]');
                        if (el) { el.textContent = `v${info.version}`; }
                        const detail = document.createElement('div');
                        detail.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:6px;line-height:1.6;font-family:monospace;';
                        detail.innerHTML = `<div>build: ${info.buildTime}</div><div>commit: ${info.commitHash}</div><div>go: ${info.goVersion}</div>`;
                        c.appendChild(detail);
                    })
                    .catch(() => {});
            });

            cardContainer(container, (c) => {
                addSectionTitle(c, '快捷键');
                for (const s of shortcuts) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.style.cssText = 'padding:6px 14px;';
                    row.innerHTML = `<span class="slide-label" style="flex:1;">${s.desc}</span><span style="font-family:monospace;font-size:11px;color:var(--accent);background:var(--accent-dim);padding:2px 8px;border-radius:4px;">${s.key}</span>`;
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                const licenseRow = document.createElement('div');
                licenseRow.className = 'slide-item';
                licenseRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:scroll"></iconify-icon></span><span class="slide-label">开源许可证</span>`;
                c.appendChild(licenseRow);
            });

            cardContainer(container, (c) => {
                addSectionTitle(c, '缓存占用');
                const statRow = document.createElement('div');
                statRow.className = 'slide-item';
                statRow.style.cssText = 'padding:8px 14px;flex-direction:column;align-items:stretch;gap:4px;';
                statRow.innerHTML = `<div data-cache-total style="font-size:13px;color:var(--text);font-weight:500;">统计中…</div><div data-cache-detail style="font-size:10px;color:var(--text-dim);line-height:1.6;font-family:monospace;"></div>`;
                c.appendChild(statRow);

                const refreshCacheStats = () => {
                    GetCacheStats()
                        .then((s) => {
                            const total = statRow.querySelector<HTMLElement>('[data-cache-total]');
                            const detail = statRow.querySelector<HTMLElement>('[data-cache-detail]');
                            if (total) { total.textContent = `总计 ${formatBytes(s.totalBytes)}`; }
                            if (detail) {
                                detail.innerHTML = `<div>提取: ${formatBytes(s.extractedBytes)} (${s.extractedCount} 项)</div><div>缩略图: ${formatBytes(s.thumbnailBytes)} (${s.thumbnailCount} 项)</div><div>隔离: ${formatBytes(s.serveBytes)} (${s.serveCount} 项)</div>`;
                            }
                        })
                        .catch(() => {});
                };
                refreshCacheStats();
                // 只注册一次，避免重复打开"关于"页面累积监听器
                if (!_cacheClearedListenerRegistered) {
                    _cacheClearedListenerRegistered = true;
                    window.addEventListener('mmar:cache-cleared', refreshCacheStats);
                }
            });

            cardContainer(container, (c) => {
                addSectionTitle(c, '更新');
                addToggleRow(c, '自动检查更新（启动时）', uiState.autoUpdateEnabled === true,
                    (v) => { setUIState({ autoUpdateEnabled: v }); SetUIAutoUpdate(v); setStatus(`✓ 自动检查更新: ${v ? '开' : '关'}`, true); }
                );
                const resultRow = document.createElement('div');
                resultRow.className = 'slide-item';
                resultRow.style.cssText = 'flex-direction:column;align-items:stretch;gap:4px;padding:8px 14px;';
                resultRow.innerHTML = `<div data-update-status style="font-size:12px;color:var(--text);">点击「检查更新」查看版本</div><a data-update-link href="#" style="display:none;font-size:12px;color:var(--accent);cursor:pointer;">前往下载最新版本 →</a>`;
                c.appendChild(resultRow);
                slideRow(c, 'lucide:download', '检查更新', false, async () => {
                    const statusEl = resultRow.querySelector<HTMLElement>('[data-update-status]');
                    const linkEl = resultRow.querySelector<HTMLAnchorElement>('[data-update-link]');
                    if (statusEl) statusEl.textContent = '检查中…';
                    if (linkEl) linkEl.style.display = 'none';
                    try {
                        const r = await CheckForUpdate();
                        if (!r) { if (statusEl) statusEl.textContent = '检查失败'; return; }
                        if (r.error) { if (statusEl) statusEl.textContent = `检查出错：${r.error}`; return; }
                        if (statusEl) { statusEl.textContent = r.available ? `发现新版本 v${r.latest}（当前 v${r.current}）` : `已是最新版本（v${r.current}）`; }
                        if (linkEl && r.available && r.url) { linkEl.style.display = 'inline'; linkEl.onclick = (e) => { e.preventDefault(); Browser.OpenURL(r.url); }; }
                    } catch { if (statusEl) statusEl.textContent = '检查失败'; }
                });
            });

            cardContainer(container, (c) => {
                addSectionTitle(c, '维护工具');
                slideRow(c, 'lucide:trash-2', '清除提取缓存', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.CLEAR_EXTRACT_CACHE }));
                slideRow(c, 'lucide:image', '清除缩略图缓存', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.CLEAR_THUMBNAIL }));
                slideRow(c, 'lucide:trash', '清除全部缓存', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.CLEAR_ALL_CACHE }));
            });

            cardContainer(container, (c) => {
                addSectionTitle(c, '设置管理');
                slideRow(c, 'lucide:download', '导出设置', false, () => exportSettings());
                slideRow(c, 'lucide:upload', '导入设置', false, () => { importSettings(); getSettingsMenu()?.reRender(); });
                slideRow(c, 'lucide:rotate-ccw', '恢复默认设置', false, () => {
                    if (window.confirm('确定要恢复所有设置为默认值吗？此操作不可撤销。')) {
                        resetAllSettings(getSettingsMenu);
                    }
                });
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = '导出为 JSON 备份；导入将合并到当前设置并立即生效。外观/性能模式会持久化，其余偏好在当前会话生效。';
                c.appendChild(hint);
            });
        },
    };
}
