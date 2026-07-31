// settings-about.ts — 关于页面
// 卡片 1：版本 + 技术栈（替代 build/commit/go 等开发细节）
// 卡片 2：链接（GitHub README + 知识库入口）
// 卡片 3：更新（进入页面自动检测一次，无需手动按钮/开关）

import {
    GetBuildInfo,
    CheckForUpdate,
    DownloadApk,
    DownloadAndRunInstaller,
} from '../core/wails-bindings';
import { cardContainer } from '../core/config';
import { slideRow, addSectionTitle } from '../core/ui-helpers';
import { showInfoToast } from '../core/toast';
import { t } from '../core/i18n/t';
import { openExternalLink } from '../core/platform';
import { getCachedCapabilities } from '../core/backend';
import { renderMenu } from './render-menu';
import type { PopupLevel } from '../core/config';
import type { MenuNode } from './menu-schema';
import type { SettingsMenuHandle } from './settings-shared';
import { safeCallAsync } from '../core/safe-call';

/** 防止每次进入关于页都触发更新检查——一次会话只检查一次。 */
let _updateCheckedThisSession = false;

function buildAboutSchema(_getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：版本 + 技术栈
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

                    const techStack = document.createElement('div');
                    techStack.style.cssText =
                        'font-size:10px;color:var(--text-dim);margin-top:6px;line-height:1.6;';
                    techStack.textContent = 'Wails v3 · Go · Babylon.js 9.x · babylon-mmd';
                    title.appendChild(techStack);

                    inner.appendChild(title);
                    safeCallAsync('settings-about', '', () =>
                        GetBuildInfo().then((info) => {
                            const el = title.querySelector<HTMLElement>('[data-app-version]');
                            if (el) {
                                el.textContent = `v${info.version}`;
                            }
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
                    slideRow(inner, 'lucide:book-open', t('about.readme'), false, () => {
                        openExternalLink('https://github.com/eghrhegpe/MikuMikuAR#readme');
                    });
                    slideRow(inner, 'lucide:map', t('about.guide'), false, () => {
                        openExternalLink('https://eghrhegpe.github.io/MikuMikuAR/guide/');
                    });
                    slideRow(inner, 'lucide:library', t('about.knowledge'), false, () => {
                        openExternalLink(
                            'https://github.com/eghrhegpe/MikuMikuAR/tree/main/docs/knowledge'
                        );
                    });
                });
            },
        },
        // 卡片 3：社区工具
        {
            id: 'about:community-tools',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.communityTools'));
                    slideRow(inner, 'lucide:github', t('about.nanoemCn'), false, () => {
                        openExternalLink('https://github.com/BesingBG/nanoem-cn');
                    });
                });
            },
        },
        // 卡片 3：更新（自动检测）
        {
            id: 'about:update',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.update'));

                    const updateStatus = document.createElement('div');
                    updateStatus.style.cssText =
                        'font-size:12px;color:var(--text);padding:4px 14px 8px;';
                    updateStatus.textContent = t('settings.about.update.checking');
                    inner.appendChild(updateStatus);

                    const updateLink = document.createElement('a');
                    updateLink.href = '#';
                    updateLink.style.cssText =
                        'display:none;font-size:12px;color:var(--accent);cursor:pointer;padding:0 14px 10px;';
                    updateLink.textContent = t('settings.about.update.goDownload');
                    inner.appendChild(updateLink);

                    // 进入关于页自动检测一次（每会话仅一次）
                    if (_updateCheckedThisSession) {
                        updateStatus.textContent = '';
                        return;
                    }
                    _updateCheckedThisSession = true;

                    safeCallAsync('settings-about', '', async () => {
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
                            const hasDirectInstall =
                                !!r.downloadUrl && getCachedCapabilities().installLocal;
                            const isDesktopInstall =
                                hasDirectInstall && !getCachedCapabilities().installApk;
                            updateLink.textContent = hasDirectInstall
                                ? t('settings.about.update.downloadInstall')
                                : t('settings.about.update.goDownload');
                            updateLink.onclick = async (e) => {
                                e.preventDefault();
                                if (!hasDirectInstall) {
                                    openExternalLink(r.url);
                                    return;
                                }
                                updateLink.textContent = t('settings.about.update.downloading');
                                updateLink.style.pointerEvents = 'none';
                                try {
                                    if (isDesktopInstall) {
                                        const result = await DownloadAndRunInstaller();
                                        if (result && result.success) {
                                            updateLink.textContent = t(
                                                'settings.about.update.installLaunched'
                                            );
                                        } else {
                                            const errMsg = result?.error || '';
                                            updateLink.textContent = t(
                                                'settings.about.update.downloadFailed'
                                            );
                                            showInfoToast(
                                                errMsg || t('settings.about.update.failed')
                                            );
                                            openExternalLink(r.url);
                                        }
                                    } else {
                                        const result = await DownloadApk();
                                        if (result && result.success && result.localPath) {
                                            const onInstallFailed = () => {
                                                updateLink.textContent = t(
                                                    'settings.about.update.downloadFailed'
                                                );
                                                updateLink.style.pointerEvents = '';
                                                openExternalLink(r.url);
                                            };
                                            window.addEventListener(
                                                'update:installFailed',
                                                onInstallFailed
                                            );
                                            window.wails?.installApk?.(result.localPath);
                                            updateLink.textContent = t(
                                                'settings.about.update.installLaunched'
                                            );
                                            setTimeout(() => {
                                                window.removeEventListener(
                                                    'update:installFailed',
                                                    onInstallFailed
                                                );
                                            }, 10000);
                                        } else {
                                            const errMsg = result?.error || '';
                                            updateLink.textContent = t(
                                                'settings.about.update.downloadFailed'
                                            );
                                            showInfoToast(
                                                errMsg || t('settings.about.update.failed')
                                            );
                                            openExternalLink(r.url);
                                        }
                                    }
                                } catch {
                                    updateLink.textContent = t(
                                        'settings.about.update.downloadFailed'
                                    );
                                    openExternalLink(r.url);
                                } finally {
                                    updateLink.style.pointerEvents = '';
                                }
                            };
                        }
                    });
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
