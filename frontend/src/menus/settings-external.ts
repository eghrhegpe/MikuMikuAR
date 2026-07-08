// settings-external.ts — 外部库管理子菜单

import { SelectDir, AddExternalPath, RemoveExternalPath, RenameExternalPath } from '../core/wails-bindings';
import { setStatus, libraryRoot, externalPaths, cardContainer, escapeHtml } from '../core/config';
import { slideRow, addEmptyRow } from '../core/ui-helpers';
import { showPrompt } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import { reloadConfig } from './library';
import { rescanAndSync } from './library';
import { t } from '../core/i18n/t';
import type { PopupLevel } from '../core/config';

type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

export function buildSettingsExternalLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
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
                    slideRow(
                        c,
                        'lucide:plug',
                        ep.name,
                        false,
                        () => {},
                        escapeHtml(ep.path),
                        undefined,
                        undefined,
                        undefined,
                        {
                            inlineSub: true,
                            actionIcons: [
                                {
                                    icon: '✎',
                                    title: '重命名',
                                    onClick: async () => {
                                        const newName = await showPrompt(
                                            '输入新的显示名称：',
                                            ep.name
                                        );
                                        if (
                                            newName &&
                                            newName.trim() &&
                                            newName.trim() !== ep.name
                                        ) {
                                            const r = await tryCatchStatus(async () => {
                                                await RenameExternalPath(ep.path, newName.trim());
                                                return true;
                                            }, '✗ 重命名失败');
                                            if (r) {
                                                await reloadConfig();
                                                getSettingsMenu()?.reRender();
                                                setStatus(t('settings.renamed'), true);
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
                        }
                    );
                }
            });

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加外部库', false, async () => {
                    const dir = await tryCatchStatus(async () => {
                        const d = await SelectDir();
                        if (!d) {
                            return undefined;
                        }
                        return d;
                    }, t('settings.externalLibFailed'));
                    if (!dir) {
                        return;
                    }
                    await tryCatchStatus(async () => {
                        await AddExternalPath(dir);
                        await reloadConfig();
                        if (libraryRoot) {
                            await rescanAndSync();
                        }
                        getSettingsMenu()?.reRender();
                        setStatus(t('settings.externalLibAdded'), true);
                    }, t('settings.externalLibFailed'));
                });
            });
        },
    };
}
