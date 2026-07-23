// settings-about.ts — 关于页面（ADR-157 瘦身：仅版本信息 / 链接 / 更新）
// 设置导入/导出/重置已迁移至 settings-system.ts；快捷键只读副本已删除（可编辑版在操控页）。

import { GetBuildInfo, CheckForUpdate, SetUIAutoUpdate } from '../core/wails-bindings';
import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { slideRow, addToggleRow, addSectionTitle } from '../core/ui-helpers';
import { browser } from '../core/runtime-bridge';
import { t } from '../core/i18n/t';
import { openExternalURL } from '../core/platform';
import { renderMenu } from './render-menu';
import type { PopupLevel } from '../core/config';
import type { MenuNode } from './menu-schema';
import type { SettingsMenuHandle } from './settings-shared';
import { safeCallAsync } from '../core/safe-call';

function buildAboutSchema(_getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：版本信息
        {
            id: 'about:version',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.versionInfo'));
                    const title = document.createElement('div');
                    title.style.cssText = 'text-align:center;padding:16px 14px 8px;';

                    const appName = document.createElement('div');
                    appName.style.cssText = 'font-size:15px;font-weight:600;color:var(--text);';
                    appName.textContent = 'MikuMikuAR';
                    title.appendChild(appName);

                    const appVersion = document.createElement('div');
                    appVersion.dataset.appVersion = '';
                    appVersion.style.cssText =
                        'font-size:11px;color:var(--text-dim);margin-top:2px;';
                    appVersion.textContent = 'v…';
                    title.appendChild(appVersion);

                    inner.appendChild(title);
                    safeCallAsync('settings-about', '', () =>
                        GetBuildInfo().then((info) => {
                            const el = title.querySelector<HTMLElement>('[data-app-version]');
                            if (el) {
                                el.textContent = `v${info.version}`;
                            }
                            const detail = document.createElement('div');
                            detail.className = 'about-version-info';

                            const buildRow = document.createElement('div');
                            buildRow.textContent = `build: ${info.buildTime}`;
                            detail.appendChild(buildRow);

                            const commitRow = document.createElement('div');
                            commitRow.textContent = `commit: ${info.commitHash}`;
                            detail.appendChild(commitRow);

                            const goRow = document.createElement('div');
                            goRow.textContent = `go: ${info.goVersion}`;
                            detail.appendChild(goRow);

                            inner.appendChild(detail);
                        })
                    );
                });
            },
        },
        // 卡片 2：链接
        {
            id: 'about:links',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.links'));
                    slideRow(inner, 'lucide:github', t('about.github'), false, () => {
                        if (!openExternalURL('https://github.com/eghrhegpe/MikuMikuAR')) {
                            void browser.openURL('https://github.com/eghrhegpe/MikuMikuAR');
                        }
                    });
                    slideRow(inner, 'lucide:scroll', t('about.license'), false, () => {
                        if (
                            !openExternalURL(
                                'https://github.com/eghrhegpe/MikuMikuAR/blob/main/LICENSE'
                            )
                        ) {
                            void browser.openURL(
                                'https://github.com/eghrhegpe/MikuMikuAR/blob/main/LICENSE'
                            );
                        }
                    });
                    slideRow(inner, 'lucide:bug', t('about.issues'), false, () => {
                        if (!openExternalURL('https://github.com/eghrhegpe/MikuMikuAR/issues')) {
                            void browser.openURL('https://github.com/eghrhegpe/MikuMikuAR/issues');
                        }
                    });
                });
            },
        },
        // 卡片 3：更新
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
                            void SetUIAutoUpdate(v);
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

                    const updateStatus = document.createElement('div');
                    updateStatus.dataset.updateStatus = '';
                    updateStatus.style.cssText = 'font-size:12px;color:var(--text);';
                    updateStatus.textContent = t('settings.about.update.checkHint');
                    resultRow.appendChild(updateStatus);

                    const updateLink = document.createElement('a');
                    updateLink.dataset.updateLink = '';
                    updateLink.href = '#';
                    updateLink.style.cssText =
                        'display:none;font-size:12px;color:var(--accent);cursor:pointer;';
                    updateLink.textContent = t('settings.about.update.goDownload');
                    resultRow.appendChild(updateLink);

                    inner.appendChild(resultRow);
                    slideRow(
                        inner,
                        'lucide:download',
                        t('settings.about.update.checkNow'),
                        false,
                        async () => {
                            updateLink.style.display = 'none';
                            updateStatus.textContent = t('settings.about.update.checking');
                            try {
                                const r = await CheckForUpdate();
                                if (!r) {
                                    updateStatus.textContent = t('settings.about.update.failed');
                                    return;
                                }
                                if (r.error) {
                                    updateStatus.textContent = t('settings.about.update.error', {
                                        err: r.error,
                                    });
                                    return;
                                }
                                updateStatus.textContent = r.available
                                    ? t('settings.about.update.available', {
                                          latest: r.latest,
                                          current: r.current,
                                      })
                                    : t('settings.about.update.latest', { current: r.current });
                                if (r.available && r.url) {
                                    updateLink.style.display = 'inline';
                                    updateLink.onclick = (e) => {
                                        e.preventDefault();
                                        if (!openExternalURL(r.url)) {
                                            void browser.openURL(r.url);
                                        }
                                    };
                                }
                            } catch {
                                updateStatus.textContent = t('settings.about.update.failed');
                            }
                        }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildSettingsAboutLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.about.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildAboutSchema(getSettingsMenu), container);
        },
    };
}
