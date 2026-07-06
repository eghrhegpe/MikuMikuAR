import {
    ScanSoftwareDir,
    LaunchSoftware,
    OpenSoftwareDir,
    AddCustomSoftware,
    RemoveCustomSoftware,
    UpdateCustomSoftware,
    AutoDetectMMD,
    SetBlenderPath,
    SetMMDPath,
    SelectExeFile,
} from '../core/wails-bindings';
import { setStatus, cardContainer, escapeHtml } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addDangerRow, addFieldRow } from '../core/ui-helpers';
import { softwareKindIcon } from '../core/icons';
import { showPrompt } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import { getSettingsMenu } from './settings';

// ======== 路径设置 API（统一入口） ========

export async function detectMMD(): Promise<void> {
    const path = await tryCatchStatus(() => AutoDetectMMD(), '✗ 未找到 MMD，请手动添加');
    if (path !== undefined) {
        setStatus(`✓ MMD 已检测: ${path}`, true);
    }
}

export async function setBlenderPath(): Promise<void> {
    const path = await SelectExeFile();
    if (!path) {
        return;
    }
    const r = await tryCatchStatus(async () => {
        await SetBlenderPath(path);
        return true;
    }, '✗ 设置失败');
    if (r) {
        setStatus('✓ Blender 路径已设置', true);
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
    }, '✗ 设置失败');
    if (r) {
        setStatus('✓ MMD 路径已设置', true);
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
    const args = await showPrompt('输入启动参数模板（支持 {model} 占位符，留空则不带参数）：', '');
    if (args === null) {
        return false;
    }
    const r = await tryCatchStatus(async () => {
        await AddCustomSoftware(path, name, args);
        return true;
    }, '✗ 添加失败');
    if (r) {
        await scanSoftwareDir();
        setStatus(`✓ 已添加: ${name}`, true);
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

export function buildSettingsSoftwareLevel(): PopupLevel {
    return {
        label: '软件管理',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            await scanSoftwareDir();
            const entries = cachedSoftwareEntries;

            if (entries && entries.length > 0) {
                cardContainer(container, (c) => {
                    for (const entry of entries) {
                        slideRow(
                            c,
                            softwareKindIcon(entry.kind),
                            escapeHtml(entry.name),
                            false,
                            () => getSettingsMenu()?.push(buildSoftwareDetailLevel(entry.path)),
                            escapeHtml(entry.kind),
                            entry.managed ? '自定义' : 'auto',
                            undefined,
                            undefined,
                            {
                                actionIcon: '▶',
                                onActionClick: async () => {
                                    const r = await tryCatchStatus(async () => {
                                        await LaunchSoftware(entry.path, entry.args || '');
                                        return true;
                                    }, `✗ 启动 ${entry.name}`);
                                    if (r) {
                                        setStatus(`✓ 已启动: ${entry.name}`, true);
                                    }
                                },
                            }
                        );
                    }
                });
            }

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加自定义软件', false, async () => {
                    if (await addCustomSoftware()) {
                        getSettingsMenu()?.reRender();
                    }
                });
                slideRow(c, 'lucide:search', '自动检测 MMD', false, () => detectMMD());
                slideRow(c, 'lucide:folder', '设置 MMD 路径', false, () => setMMDPath());
                slideRow(c, 'lucide:cube-3d', '设置 Blender 路径', false, () => setBlenderPath());
            });

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:folder-open', '打开目录', false, () =>
                    OpenSoftwareDir().catch(console.warn)
                );
            });
        },
    };
}

export function buildSoftwareDetailLevel(path: string): PopupLevel {
    const entries = cachedSoftwareEntries || [];
    const entry = entries.find((e) => e.path === path);
    if (!entry) {
        return {
            label: '未知软件',
            dir: '',
            items: [{ kind: 'action', label: '软件未找到', icon: 'alert-circle', target: '' }],
        };
    }

    if (entry.managed) {
        return {
            label: entry.name,
            dir: '',
            items: [],
            renderCustom: async (container) => {
                cardContainer(container, (c) => {
                    const fields: Array<{ label: string; value: string }> = [
                        { label: '名称', value: entry.name },
                        { label: '路径', value: entry.path },
                        { label: '类型', value: entry.kind },
                    ];
                    for (const f of fields) {
                        addFieldRow(c, f.label, escapeHtml(f.value));
                    }
                    const argRow = document.createElement('div');
                    argRow.style.cssText = 'padding:6px 14px;';
                    const argLbl = document.createElement('div');
                    argLbl.style.cssText =
                        'font-size:10px;color:var(--text-dim);margin-bottom:2px;';
                    argLbl.textContent = '启动参数 (支持 {model} 占位符)';
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
                        }, '✗ 更新失败');
                        if (r) {
                            entry.args = input.value;
                            setStatus('✓ 参数已更新', true);
                        }
                    });
                    val.appendChild(input);
                    argRow.appendChild(val);
                    c.appendChild(argRow);
                });

                cardContainer(container, (c) => {
                    slideRow(c, 'lucide:play', '启动', false, () => {
                        LaunchSoftware(entry.path, '')
                            .then(() => setStatus(`✓ 已启动: ${entry.name}`, true))
                            .catch((err: unknown) =>
                                setStatus(
                                    '✗ ' + (err instanceof Error ? err.message : String(err)),
                                    false
                                )
                            );
                    });

                    addDangerRow(c, 'lucide:trash-2', '删除', async () => {
                        const r = await tryCatchStatus(async () => {
                            await RemoveCustomSoftware(entry.path);
                            return true;
                        }, '✗ 删除失败');
                        if (r) {
                            cachedSoftwareEntries = (cachedSoftwareEntries || []).filter(
                                (e) => e.path !== entry.path
                            );
                            setStatus(`✓ 已删除: ${entry.name}`, true);
                            const menu = getSettingsMenu();
                            menu?.pop();
                            menu?.reRender();
                        }
                    });
                });
            },
        };
    }

    return {
        label: entry.name,
        dir: '',
        items: [],
        renderCustom: async (container) => {
            cardContainer(container, (c) => {
                const fields: Array<{ label: string; value: string }> = [
                    { label: '名称', value: entry.name },
                    { label: '路径', value: entry.path },
                    { label: '类型', value: entry.kind },
                ];
                for (const f of fields) {
                    addFieldRow(c, f.label, escapeHtml(f.value));
                }
            });

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:play', '启动', false, () => {
                    LaunchSoftware(entry.path, entry.args)
                        .then(() => setStatus(`✓ 已启动: ${entry.name}`, true))
                        .catch((err: unknown) =>
                            setStatus(
                                '✗ ' + (err instanceof Error ? err.message : String(err)),
                                false
                            )
                        );
                });

                slideRow(c, 'lucide:plus', '转为自定义（以便编辑参数）', false, async () => {
                    const args = await showPrompt(
                        '输入启动参数模板（支持 {model} 占位符，留空则不带参数）：',
                        ''
                    );
                    if (args === null) {
                        return;
                    }
                    const r = await tryCatchStatus(async () => {
                        await AddCustomSoftware(entry.path, entry.name, args);
                        return true;
                    }, '✗ 转为自定义');
                    if (r) {
                        cachedSoftwareEntries = await ScanSoftwareDir();
                        setStatus(`✓ 已转为自定义: ${entry.name}`, true);
                        const menu = getSettingsMenu();
                        menu?.pop();
                        menu?.reRender();
                    }
                });
            });
        },
    };
}
