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
import { events } from '../core/runtime-bridge';
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
                                // dev 版本不加 v 前缀
                                el.textContent = info.version === 'dev' ? 'dev' : `v${info.version}`;
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
                        openExternalLink('https://eghrhegpe.github.io/MikuMikuAR/');
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

                    const updateBtn = document.createElement('button');
                    updateBtn.className = 'btn btn-sm btn-primary';
                    updateBtn.style.cssText = 'display:none;margin:0 14px 10px;';
                    updateBtn.textContent = t('settings.about.update.goDownload');
                    inner.appendChild(updateBtn);

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
                            updateBtn.style.display = 'inline';
                            const hasDirectInstall =
                                !!r.downloadUrl && getCachedCapabilities().installLocal;
                            const isDesktopInstall =
                                hasDirectInstall && !getCachedCapabilities().installApk;
                            updateBtn.textContent = hasDirectInstall
                                ? t('settings.about.update.downloadInstall')
                                : t('settings.about.update.goDownload');
                            updateBtn.onclick = async (e) => {
                                e.preventDefault();
                                if (!hasDirectInstall) {
                                    openExternalLink(r.url);
                                    return;
                                }
                                updateBtn.textContent = t('settings.about.update.downloading');
                                updateBtn.style.pointerEvents = 'none';

                                // 注册进度监听器（返回 unsubscribe 函数）
                                const unsubscribeProgress = events.on('update:downloadProgress', (data) => {
                                    const d = data as { percent?: number };
                                    if (typeof d.percent === 'number') {
                                        updateBtn.textContent = t('settings.about.update.downloading') + ` ${Math.round(d.percent)}%`;
                                    }
                                });

                                try {
                                    if (isDesktopInstall) {
                                        const result = await DownloadAndRunInstaller();
                                        if (result && result.success) {
                                            updateBtn.textContent = t(
                                                'settings.about.update.installLaunched'
                                            );
                                        } else {
                                            const errMsg = result?.error || '';
                                            updateBtn.textContent = t(
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
                                                updateBtn.textContent = t(
                                                    'settings.about.update.downloadFailed'
                                                );
                                                updateBtn.style.pointerEvents = '';
                                                openExternalLink(r.url);
                                            };
                                            window.addEventListener(
                                                'update:installFailed',
                                                onInstallFailed
                                            );
                                            window.wails?.installApk?.(result.localPath);
                                            updateBtn.textContent = t(
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
                                            updateBtn.textContent = t(
                                                'settings.about.update.downloadFailed'
                                            );
                                            showInfoToast(
                                                errMsg || t('settings.about.update.failed')
                                            );
                                            openExternalLink(r.url);
                                        }
                                    }
                                } catch {
                                    updateBtn.textContent = t(
                                        'settings.about.update.downloadFailed'
                                    );
                                    openExternalLink(r.url);
                                } finally {
                                    updateBtn.style.pointerEvents = '';
                                    // 清理进度监听器
                                    unsubscribeProgress();
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
