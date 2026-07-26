// [doc:adr-181] 下载管理面板：扫描 → 解压 → 入库 → 标记
// 替换 fsnotify watch 机制，为网页/桌面提供统一的下载摄入入口。

import { cardContainer } from '../core/config';
import { addSectionTitle, slideRow } from '../core/ui-helpers';
import { t } from '../core/i18n/t';
import { ImportZip, ListDirRecursive, SelectDir, ReadTextFile, WriteTextFile } from '../core/wails-bindings';
import { importFileByPath } from './library-actions';
import { isWebPlatform } from '../core/platform';
import { getCachedCapabilities } from '../core/backend';
import { idbGet, idbSet, idbDelete, idbKeys } from '../core/backend/idb';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { SettingsMenuHandle } from './settings-shared';

const _SUPPORTED_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|vpd|zip)$/i;
const _MAX_ZIP_BYTES = 500 * 1024 * 1024;

const _stagingFsaIdbKey = 'dl:stagingFsaHandle';

let _desktopStagingPath: string | null = null;

async function hashFile(bytes: Uint8Array): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

async function getStagingDirWeb(): Promise<string | null> {
    const h = await idbGet<FileSystemDirectoryHandle>('config', _stagingFsaIdbKey);
    if (!h) return null;
    const ph = h as FileSystemDirectoryHandle & {
        queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof ph.queryPermission === 'function') {
        try {
            const p = await ph.queryPermission({ mode: 'readwrite' });
            if (p === 'granted') return h.name;
        } catch {
            /* 权限失效 */
        }
    }
    return null;
}

async function pickStagingDirWeb(): Promise<string | null> {
    const picker = (
        window as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker;
    if (typeof picker !== 'function') return null;
    try {
        const h = await picker();
        await idbSet('config', _stagingFsaIdbKey, h);
        return h.name;
    } catch {
        return null;
    }
}

async function pickStagingDirDesktop(): Promise<string | null> {
    const dir = await SelectDir();
    if (!dir) return null;
    _desktopStagingPath = dir;
    return dir;
}

async function getStagingDirDesktop(): Promise<string | null> {
    return _desktopStagingPath;
}

async function listFilesWeb(
    handle: FileSystemDirectoryHandle,
    relPath = ''
): Promise<{ name: string; relPath: string; bytes: Uint8Array }[]> {
    const results: { name: string; relPath: string; bytes: Uint8Array }[] = [];
    try {
        for await (const entry of (handle as unknown as { values: () => AsyncIterableIterator<FileSystemHandle> }).values()) {
            const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            if (entry.kind === 'file') {
                if (!_SUPPORTED_RE.test(entry.name) || entry.name === '.imported.json') continue;
                const fileHandle = entry as FileSystemFileHandle;
                try {
                    const file = await fileHandle.getFile();
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    results.push({ name: entry.name, relPath: entryRel, bytes });
                } catch {
                    /* 跳过读取失败的文件 */
                }
            } else if (entry.kind === 'directory' && entry.name !== '_imported') {
                const subHandle = entry as FileSystemDirectoryHandle;
                const sub = await listFilesWeb(subHandle, entryRel);
                results.push(...sub);
            }
        }
    } catch {
        /* 句柄失效 */
    }
    return results;
}

async function webManifestKey(handleId: string, hash: string): Promise<string> {
    return `imported:${handleId}:${hash}`;
}

async function webMarkImported(handleId: string, hash: string): Promise<void> {
    await idbSet('config', await webManifestKey(handleId, hash), true);
}

async function webIsImported(handleId: string, hash: string): Promise<boolean> {
    return (await idbGet<boolean>('config', await webManifestKey(handleId, hash))) === true;
}

interface DesktopManifest {
    [stem: string]: string[];
}

async function readDesktopManifest(stagingPath: string): Promise<DesktopManifest> {
    try {
        const content = await ReadTextFile(`${stagingPath}/.imported.json`);
        return JSON.parse(content) as DesktopManifest;
    } catch {
        return {};
    }
}

async function writeDesktopManifest(stagingPath: string, manifest: DesktopManifest): Promise<void> {
    await WriteTextFile(`${stagingPath}/.imported.json`, JSON.stringify(manifest, null, 2));
}

async function runDownloadManager(
    getSettingsMenu: () => SettingsMenuHandle,
    onProgress: (msg: string) => void
): Promise<void> {
    if (isWebPlatform()) {
        await runDownloadManagerWeb(getSettingsMenu, onProgress);
    } else if (getCachedCapabilities().localStaging) {
        await runDownloadManagerDesktop(getSettingsMenu, onProgress);
    } else {
        onProgress(t('downloads.androidNotReady'));
    }
}

async function runDownloadManagerWeb(
    getSettingsMenu: () => SettingsMenuHandle,
    onProgress: (msg: string) => void
): Promise<void> {
    const handle = await idbGet<FileSystemDirectoryHandle>('config', _stagingFsaIdbKey);
    if (!handle) {
        onProgress(t('downloads.stagingNotSet'));
        return;
    }

    const ph = handle as FileSystemDirectoryHandle & {
        queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (typeof ph.queryPermission === 'function') {
        try {
            const p = await ph.queryPermission({ mode: 'readwrite' });
            if (p !== 'granted') {
                onProgress(t('downloads.permissionNeeded'));
                return;
            }
        } catch {
            onProgress(t('downloads.permissionNeeded'));
            return;
        }
    }

    const handleId = (await idbGet<string>('config', _stagingFsaIdbKey + ':id')) ?? handle.name;
    await idbSet('config', _stagingFsaIdbKey + ':id', handleId);

    onProgress(t('downloads.scanning'));
    const files = await listFilesWeb(handle);

    if (files.length === 0) {
        onProgress(t('downloads.noNewFiles'));
        getSettingsMenu()?.updateControls();
        return;
    }

    onProgress(t('downloads.importingN', { count: files.length }));
    let ok = 0;
    let fail = 0;

    for (const f of files) {
        const hash = await hashFile(f.bytes);
        if (await webIsImported(handleId, hash)) {
            continue;
        }
        try {
            const stem = f.name.replace(/\.[^.]+$/, '');
            await idbSet('models', `dl:file:${stem}`, f.bytes);

            if (f.name.toLowerCase().endsWith('.zip')) {
                if (f.bytes.byteLength > _MAX_ZIP_BYTES) {
                    fail++;
                    continue;
                }
                await ImportZip(`dl:file:${stem}`);
            } else {
                await importFileByPath(`dl:file:${stem}`);
            }
            await webMarkImported(handleId, hash);
            ok++;
        } catch (err) {
            console.warn('[downloads] import failed:', f.name, err);
            fail++;
        }
        onProgress(t('downloads.importingProgress', { ok, fail, total: files.length }));
    }

    onProgress(t('downloads.done', { ok, fail }));
    getSettingsMenu()?.updateControls();
}

async function runDownloadManagerDesktop(
    getSettingsMenu: () => SettingsMenuHandle,
    onProgress: (msg: string) => void
): Promise<void> {
    const stagingPath = _desktopStagingPath;
    if (!stagingPath) {
        onProgress(t('downloads.stagingNotSet'));
        return;
    }

    onProgress(t('downloads.scanning'));
    const entries = await ListDirRecursive(stagingPath);
    const files = entries.filter(
        (e) => _SUPPORTED_RE.test(e.name) && !e.name.endsWith('.imported.json')
    );

    if (files.length === 0) {
        onProgress(t('downloads.noNewFiles'));
        getSettingsMenu()?.updateControls();
        return;
    }

    const manifest = await readDesktopManifest(stagingPath);

    onProgress(t('downloads.importingN', { count: files.length }));
    let ok = 0;
    let fail = 0;

    for (const e of files) {
        const fullPath = `${stagingPath}/${e.relativePath}`;
        const stem = e.name.replace(/\.[^.]+$/, '');
        if (manifest[stem]) {
            continue;
        }
        try {
            if (e.name.toLowerCase().endsWith('.zip')) {
                const result = await ImportZip(fullPath);
                if (!result) {
                    fail++;
                    continue;
                }
                if (result.file_path) {
                    await importFileByPath(result.file_path);
                }
            } else {
                await importFileByPath(fullPath);
            }
            manifest[stem] = [e.relativePath];
            ok++;
        } catch (err) {
            console.warn('[downloads] import failed:', e.name, err);
            fail++;
        }
        onProgress(t('downloads.importingProgress', { ok, fail, total: files.length }));
    }

    await writeDesktopManifest(stagingPath, manifest);
    onProgress(t('downloads.done', { ok, fail }));
    getSettingsMenu()?.updateControls();
}

async function clearImported(
    getSettingsMenu: () => SettingsMenuHandle,
    onDone: () => void
): Promise<void> {
    if (!confirm(t('downloads.clearConfirm'))) return;

    if (isWebPlatform()) {
        const handleId = (await idbGet<string>('config', _stagingFsaIdbKey + ':id')) ?? '';
        const keys = await idbKeys('config');
        for (const k of keys) {
            if (k.startsWith(`imported:${handleId}:`)) {
                await idbDelete('config', k);
            }
        }
    } else if (getCachedCapabilities().localStaging && _desktopStagingPath) {
        try {
            await WriteTextFile(`${_desktopStagingPath}/.imported.json`, '{}');
        } catch {
            /* 忽略 */
        }
    }
    onDone();
}

function buildDownloadSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'downloads:staging',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('downloads.stagingDir'));

                    const statusEl = document.createElement('div');
                    statusEl.style.cssText =
                        'font-size:11px;color:var(--text-muted,inherit);margin:4px 0 8px;word-break:break-all;';
                    inner.appendChild(statusEl);

                    const updateStatus = async () => {
                        if (isWebPlatform()) {
                            const name = await getStagingDirWeb();
                            statusEl.textContent = name
                                ? t('downloads.stagingSet', { dir: name })
                                : t('downloads.stagingNotSet');
                        } else if (getCachedCapabilities().localStaging) {
                            const path = await getStagingDirDesktop();
                            statusEl.textContent = path
                                ? t('downloads.stagingSet', { dir: path })
                                : t('downloads.stagingNotSet');
                        } else {
                            statusEl.textContent = t('downloads.androidStagingHint');
                        }
                    };
                    updateStatus();

                    slideRow(
                        inner,
                        'lucide:folder-plus',
                        t('downloads.pickStagingDir'),
                        false,
                        async () => {
                            let picked: string | null = null;
                            if (isWebPlatform()) {
                                picked = await pickStagingDirWeb();
                            } else if (getCachedCapabilities().localStaging) {
                                picked = await pickStagingDirDesktop();
                            }
                            if (picked) updateStatus();
                            getSettingsMenu()?.reRender();
                        }
                    );
                });
            },
        },
        {
            id: 'downloads:scan',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('downloads.scanImport'));

                    const msgEl = document.createElement('div');
                    msgEl.style.cssText =
                        'font-size:11px;color:var(--text-muted,inherit);margin:4px 0 8px;min-height:16px;';
                    inner.appendChild(msgEl);

                    let running = false;

                    slideRow(
                        inner,
                        'lucide:download',
                        t('downloads.scanAndImport'),
                        false,
                        async () => {
                            if (running) return;
                            running = true;
                            msgEl.textContent = t('downloads.running');
                            getSettingsMenu()?.updateControls();
                            await runDownloadManager(
                                getSettingsMenu,
                                (msg) => {
                                    msgEl.textContent = msg;
                                }
                            );
                            running = false;
                        }
                    );
                });
            },
        },
        {
            id: 'downloads:manage',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('downloads.manageImported'));

                    slideRow(
                        inner,
                        'lucide:trash-2',
                        t('downloads.clearImported'),
                        false,
                        () =>
                            clearImported(getSettingsMenu, () => {
                                getSettingsMenu()?.reRender();
                            })
                    );
                });
            },
        },
    ];
}

export function buildSettingsDownloadsLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.downloads'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildDownloadSchema(getSettingsMenu), container);
        },
    };
}