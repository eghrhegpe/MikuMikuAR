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
import { setStatus, cardContainer, escapeHtml, PopupLevel } from '../core/config';
import { slideRow } from '../core/ui-helpers';
import { softwareKindIcon, createIconifyIcon } from '../core/icons';
import { showPrompt } from '../core/dialog';

// ======== 路径设置 API（统一入口） ========

export async function detectMMD(): Promise<void> {
    try {
        const path = await AutoDetectMMD();
        setStatus(`✓ MMD 已检测: ${path}`, true);
    } catch {
        setStatus('✗ 未找到 MMD，请手动添加', false);
    }
}

export async function setBlenderPath(): Promise<void> {
    try {
        const path = await SelectExeFile();
        if (!path) return;
        await SetBlenderPath(path);
        setStatus('✓ Blender 路径已设置', true);
    } catch (err: unknown) {
        setStatus('✗ 设置失败: ' + (err instanceof Error ? err.message : String(err)), false);
    }
}

export async function setMMDPath(): Promise<void> {
    try {
        const path = await SelectExeFile();
        if (!path) return;
        await SetMMDPath(path);
        setStatus('✓ MMD 路径已设置', true);
    } catch (err: unknown) {
        setStatus('✗ 设置失败: ' + (err instanceof Error ? err.message : String(err)), false);
    }
}

export async function addCustomSoftware(): Promise<boolean> {
    try {
        const path = await SelectExeFile();
        if (!path) return false;
        const name = path.split(/[/\\]/).pop()?.replace(/\.exe$/i, '') || '未知';
        const args = await showPrompt('输入启动参数模板（支持 {model} 占位符，留空则不带参数）：', '');
        if (args === null) return false;
        await AddCustomSoftware(path, name, args);
        await scanSoftwareDir();
        setStatus(`✓ 已添加: ${name}`, true);
        return true;
    } catch (err: unknown) {
        setStatus('✗ 添加失败: ' + (err instanceof Error ? err.message : String(err)), false);
        return false;
    }
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
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.addEventListener('click', (e) => {
                            if ((e.target as HTMLElement).closest('.btn')) {
                                return;
                            }
                            const pushFn = (window as any).__getSettingsMenuPush?.();
                            if (pushFn) {
                                pushFn(buildSoftwareDetailLevel(entry.path));
                            }
                        });
                        row.innerHTML = `
                            <span class="slide-icon"><iconify-icon icon="${softwareKindIcon(entry.kind)}"></iconify-icon></span>
                            <span class="slide-label">${escapeHtml(entry.name)}</span>
                            <span class="slide-sublabel">${escapeHtml(entry.kind)}</span>
                            <span class="slide-tag">${entry.managed ? '自定义' : 'auto'}</span>
                            <button class="btn btn-ghost btn-sm btn-icon" title="直接启动">▶</button>
                        `;
                        row.querySelector('.btn')!.addEventListener('click', (e) => {
                            e.stopPropagation();
                            LaunchSoftware(entry.path, entry.args || '')
                                .then(() => {
                                    setStatus(`✓ 已启动: ${entry.name}`, true);
                                })
                                .catch((err: unknown) => {
                                    setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false);
                                });
                        });
                        c.appendChild(row);
                    }
                });
            }

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加自定义软件', false, async () => {
                    if (await addCustomSoftware()) {
                        // refresh
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
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.style.cssText =
                            'display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;';
                        row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;font-size:11px;">${escapeHtml(f.value)}</span>`;
                        c.appendChild(row);
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
                        try {
                            await UpdateCustomSoftware(entry.path, entry.name, input.value);
                            entry.args = input.value;
                            setStatus('✓ 参数已更新', true);
                        } catch {
                            setStatus('✗ 更新失败', false);
                        }
                    });
                    val.appendChild(input);
                    argRow.appendChild(val);
                    c.appendChild(argRow);
                });

                cardContainer(container, (c) => {
                    const launchRow = document.createElement('div');
                    launchRow.className = 'slide-item';
                    const li = document.createElement('span');
                    li.className = 'slide-icon';
                    const le = createIconifyIcon('lucide:play');
                    if (le) {
                        li.appendChild(le);
                    }
                    launchRow.appendChild(li);
                    const ll = document.createElement('span');
                    ll.className = 'slide-label';
                    ll.textContent = '启动';
                    launchRow.appendChild(ll);
                    launchRow.addEventListener('click', () => {
                        LaunchSoftware(entry.path, entry.args)
                            .then(() => setStatus(`✓ 已启动: ${entry.name}`, true))
                            .catch((err: unknown) => setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false));
                    });
                    c.appendChild(launchRow);

                    const delRow = document.createElement('div');
                    delRow.className = 'slide-item';
                    const di = document.createElement('span');
                    di.className = 'slide-icon';
                    const de = createIconifyIcon('lucide:trash-2');
                    if (de) {
                        di.appendChild(de);
                    }
                    delRow.appendChild(di);
                    const dl = document.createElement('span');
                    dl.className = 'slide-label danger-text';
                    dl.textContent = '删除';
                    delRow.appendChild(dl);
                    delRow.addEventListener('click', async () => {
                        try {
                            await RemoveCustomSoftware(entry.path);
                            cachedSoftwareEntries = (cachedSoftwareEntries || []).filter(
                                (e) => e.path !== entry.path
                            );
                            setStatus(`✓ 已删除: ${entry.name}`, true);
                            const popFn = (window as any).__getSettingsMenuPop?.();
                            const reRenderFn = (window as any).__getSettingsMenuReRender?.();
                            popFn?.();
                            reRenderFn?.();
                        } catch {
                            setStatus('✗ 删除失败', false);
                        }
                    });
                    c.appendChild(delRow);
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
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.style.cssText =
                        'display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;';
                    row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;font-size:11px;">${escapeHtml(f.value)}</span>`;
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                const launchRow = document.createElement('div');
                launchRow.className = 'slide-item';
                const li = document.createElement('span');
                li.className = 'slide-icon';
                const le = createIconifyIcon('lucide:play');
                if (le) {
                    li.appendChild(le);
                }
                launchRow.appendChild(li);
                const ll = document.createElement('span');
                ll.className = 'slide-label';
                ll.textContent = '启动';
                launchRow.appendChild(ll);
                launchRow.addEventListener('click', () => {
                    LaunchSoftware(entry.path, '')
                        .then(() => setStatus(`✓ 已启动: ${entry.name}`, true))
                        .catch((err: unknown) => setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false));
                });
                c.appendChild(launchRow);

                const convertRow = document.createElement('div');
                convertRow.className = 'slide-item';
                const ci = document.createElement('span');
                ci.className = 'slide-icon';
                const ce = createIconifyIcon('lucide:plus');
                if (ce) {
                    ci.appendChild(ce);
                }
                convertRow.appendChild(ci);
                const cl = document.createElement('span');
                cl.className = 'slide-label';
                cl.textContent = '转为自定义（以便编辑参数）';
                convertRow.appendChild(cl);
                convertRow.addEventListener('click', async () => {
                    try {
                        const args = await showPrompt('输入启动参数模板（支持 {model} 占位符，留空则不带参数）：', '');
                        if (args === null) {
                            return;
                        }
                        await AddCustomSoftware(entry.path, entry.name, args);
                        cachedSoftwareEntries = await ScanSoftwareDir();
                        setStatus(`✓ 已转为自定义: ${entry.name}`, true);
                        const popFn = (window as any).__getSettingsMenuPop?.();
                        const reRenderFn = (window as any).__getSettingsMenuReRender?.();
                        popFn?.();
                        reRenderFn?.();
                    } catch (err: unknown) {
                        setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false);
                    }
                });
                c.appendChild(convertRow);
            });
        },
    };
}