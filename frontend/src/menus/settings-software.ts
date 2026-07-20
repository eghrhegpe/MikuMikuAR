import {
    ScanSoftwareDir,
    LaunchSoftware,
    AddCustomSoftware,
    RemoveCustomSoftware,
    UpdateCustomSoftware,
    SetBlenderPath,
    SetMMDPath,
    SelectExeFile,
} from '../core/wails-bindings';
import { setStatus, cardContainer, escapeHtml } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addDangerRow, addFieldRow, addSectionTitle } from '../core/ui-helpers';
import { softwareKindIcon } from '../core/icons';
import { showPrompt } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import { getSettingsMenu } from './settings';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 路径设置 API（统一入口） ========

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
            ?.replace(/\.exe$/i, '') || '未知';
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

let cachedSoftwareEntries: import('../core/wails-bindings').SoftwareEntry[] | null = null;

export async function scanSoftwareDir(): Promise<void> {
    try {
        cachedSoftwareEntries = await ScanSoftwareDir();
    } catch (err) {
        console.error('ScanSoftwareDir error:', err);
        cachedSoftwareEntries = [];
    }
}

function buildSoftwareListSchema(): MenuNode[] {
    return [
        {
            id: 'software:list',
            kind: 'custom',
            renderCustom: async (container) => {
                await scanSoftwareDir();
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
                                () => getSettingsMenu()?.push(buildSoftwareDetailLevel(entry.path)),
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
            },
        },
        {
            id: 'software:actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '操作');
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

export function buildSettingsSoftwareLevel(): PopupLevel {
    return {
        label: t('settings.software.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildSoftwareListSchema(), container);
        },
    };
}

function buildSoftwareDetailManagedSchema(
    entry: import('../core/wails-bindings').SoftwareEntry
): MenuNode[] {
    return [
        {
            id: 'software-detail:info',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '软件信息');
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
                    addSectionTitle(inner, '操作');
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
    entry: import('../core/wails-bindings').SoftwareEntry
): MenuNode[] {
    return [
        {
            id: 'software-detail:info',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '软件信息');
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
                    addSectionTitle(inner, '操作');
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

export function buildSoftwareDetailLevel(path: string): PopupLevel {
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
        ? buildSoftwareDetailManagedSchema(entry)
        : buildSoftwareDetailAutoSchema(entry);

    return {
        label: entry.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(schema, container);
        },
    };
}
