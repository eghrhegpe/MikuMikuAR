// [doc:adr-195] 下载文件夹统一摄入：扫描系统下载文件夹 → 入库（不加载到场景）→ 模型库可见。
// 取代 ADR-181 的"暂存目录 + 二扫"机制：复用模型库同一套入库逻辑（写 entry:/dir: 键），
// 不再写 dl:file: 旁路 + imported: 独立账本，不再 importFileByPath 加载进场景。

import { cardContainer } from '../core/config';
import { addSectionTitle, slideRow } from '../core/ui-helpers';
import { t } from '../core/i18n/t';
import {
    ImportZip,
    ListDirRecursive,
    SelectDir,
    WriteTextFile,
    ImportLocalFile,
    GetStorageMode,
} from '../core/wails-bindings';
import {
    ingestModelFiles,
    getFsaDownloadHandle,
    getFsaDownloadAuthState,
    reauthorizeFsaDownload,
    selectFsaDownloadDir,
} from '../core/backend/browser-adapter';
import { isWebPlatform, isAndroidPlatform } from '../core/platform';
import { getCachedCapabilities } from '../core/backend';
import { idbSet, idbDelete, idbKeys } from '../core/backend/idb';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { SettingsMenuHandle } from './settings-shared';

const _SUPPORTED_RE = /\.(pmx|vmd|mp3|wav|ogg|flac|wma|vpd|zip)$/i;
const _MAX_ZIP_BYTES = 500 * 1024 * 1024;

// [doc:adr-195] 安卓系统下载目录（shared 模式下经 MANAGE_EXTERNAL_STORAGE 可读）。
// 镜像 internal/app/pathmgr_android.go 的 DownloadsDir()；待 wails 绑定重生成后可改为调用 DownloadDir() 绑定。
const ANDROID_DOWNLOADS_DIR = '/sdcard/Download';

let _desktopDownloadPath: string | null = null;
// [doc:adr-195] 会话内去重（替代原 imported:<hash> 持久账本）：避免同会话重复扫描重复入库。
const _ingestedStems = new Set<string>();

// ——— 网页：独立 FSA 下载文件夹句柄（P3：不强制共用模型库 root 句柄）———

async function getDownloadDirWeb(): Promise<string | null> {
    const h = await getFsaDownloadHandle();
    return h ? h.name : null;
}

// ——— 桌面 / 安卓：下载文件夹路径 ———

async function getDownloadDirLocal(): Promise<string | null> {
    if (isAndroidPlatform()) {
        // 安卓下载文件夹固定为系统 /sdcard/Download（shared 模式），无需用户选择
        return ANDROID_DOWNLOADS_DIR;
    }
    return _desktopDownloadPath;
}

// ——— 网页递归列举 ———

async function listFilesWeb(
    handle: FileSystemDirectoryHandle,
    relPath = ''
): Promise<{ name: string; relPath: string; bytes: Uint8Array }[]> {
    const results: { name: string; relPath: string; bytes: Uint8Array }[] = [];
    try {
        for await (const entry of (
            handle as unknown as { values: () => AsyncIterableIterator<FileSystemHandle> }
        ).values()) {
            const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
            if (entry.kind === 'file') {
                if (!_SUPPORTED_RE.test(entry.name)) continue;
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

// ——— 调度 ———

async function runDownloadManager(
    getSettingsMenu: () => SettingsMenuHandle,
    onProgress: (msg: string) => void
): Promise<void> {
    if (isWebPlatform()) {
        await runDownloadManagerWeb(getSettingsMenu, onProgress);
    } else if (getCachedCapabilities().localStaging || isAndroidPlatform()) {
        await runDownloadManagerLocal(getSettingsMenu, onProgress);
    } else {
        onProgress(t('downloads.androidNotReady'));
    }
}

async function runDownloadManagerWeb(
    getSettingsMenu: () => SettingsMenuHandle,
    onProgress: (msg: string) => void
): Promise<void> {
    const handle = await getFsaDownloadHandle();
    if (!handle) {
        onProgress(t('downloads.stagingNotSet'));
        return;
    }

    const perm = await getFsaDownloadAuthState();
    if (perm === 'revoked') {
        const ok = await reauthorizeFsaDownload();
        if (!ok) {
            onProgress(t('downloads.permissionNeeded'));
            return;
        }
    } else if (perm === 'none') {
        onProgress(t('downloads.stagingNotSet'));
        return;
    }

    onProgress(t('downloads.scanning'));
    const files = await listFilesWeb(handle);

    if (files.length === 0) {
        onProgress(t('downloads.noNewFiles'));
        getSettingsMenu()?.updateControls();
        return;
    }

    // [doc:adr-195] 决策 1：扫描前预览——确认将导入 N 个文件（不自动加载到场景）
    if (!confirm(t('downloads.scanConfirm', { count: files.length }))) {
        onProgress(t('downloads.canceled'));
        getSettingsMenu()?.updateControls();
        return;
    }

    onProgress(t('downloads.importingN', { count: files.length }));
    let ok = 0;
    let fail = 0;

    // [doc:adr-195] 决策 3+4：批量摄入只入库、不加载场景。
    // 非 zip（pmx/vmd/音频）→ ingestModelFiles 单事务写 file:/entry: 键；
    // zip → 写 file:<stem> 后 ImportZip 展开（读 file:<stem>，不加载场景）。
    const modelFiles: { name: string; bytes: Uint8Array }[] = [];
    const zipTasks: { stem: string; bytes: Uint8Array }[] = [];
    for (const f of files) {
        const lower = f.name.toLowerCase();
        const stem = f.name.replace(/\.[^.]+$/, '');
        if (lower.endsWith('.zip')) {
            if (f.bytes.byteLength > _MAX_ZIP_BYTES) {
                fail++;
                continue;
            }
            if (_ingestedStems.has(stem)) continue;
            zipTasks.push({ stem, bytes: f.bytes });
            _ingestedStems.add(stem);
        } else {
            if (_ingestedStems.has(stem)) continue;
            modelFiles.push({ name: f.name, bytes: f.bytes });
            _ingestedStems.add(stem);
        }
    }

    if (modelFiles.length) {
        try {
            ok += await ingestModelFiles(modelFiles);
        } catch (err) {
            console.warn('[downloads] batch ingest failed', err);
            fail += modelFiles.length;
        }
    }

    for (const z of zipTasks) {
        try {
            await idbSet('models', `file:${z.stem}`, z.bytes);
            await ImportZip(`file:${z.stem}`);
            ok++;
        } catch (err) {
            console.warn('[downloads] zip import failed:', z.stem, err);
            fail++;
        }
    }

    onProgress(t('downloads.done', { ok, fail }));
    getSettingsMenu()?.updateControls();
}

async function runDownloadManagerLocal(
    getSettingsMenu: () => SettingsMenuHandle,
    onProgress: (msg: string) => void
): Promise<void> {
    const isAndroid = isAndroidPlatform();
    let downloadPath: string | null;
    if (isAndroid) {
        // [doc:adr-195] 安卓须 shared 模式才能读 /sdcard/Download
        const mode = await GetStorageMode();
        if (mode !== 'shared') {
            onProgress(t('downloads.androidNeedShared'));
            return;
        }
        downloadPath = ANDROID_DOWNLOADS_DIR;
    } else {
        downloadPath = _desktopDownloadPath;
        if (!downloadPath) {
            onProgress(t('downloads.stagingNotSet'));
            return;
        }
    }

    onProgress(t('downloads.scanning'));
    const entries = await ListDirRecursive(downloadPath);
    const files = entries.filter((e) => _SUPPORTED_RE.test(e.name));

    if (files.length === 0) {
        onProgress(t('downloads.noNewFiles'));
        getSettingsMenu()?.updateControls();
        return;
    }

    if (!confirm(t('downloads.scanConfirm', { count: files.length }))) {
        onProgress(t('downloads.canceled'));
        getSettingsMenu()?.updateControls();
        return;
    }

    onProgress(t('downloads.importingN', { count: files.length }));
    let ok = 0;
    let fail = 0;

    for (const e of files) {
        const fullPath = `${downloadPath}/${e.relativePath}`;
        const stem = e.name.replace(/\.[^.]+$/, '');
        if (_ingestedStems.has(stem)) continue;
        try {
            if (e.name.toLowerCase().endsWith('.zip')) {
                // [doc:adr-195] zip 解压入库（ImportZip 写 dir:/outfit: 键，不加载场景）
                const result = await ImportZip(fullPath);
                if (!result) {
                    fail++;
                    continue;
                }
            } else {
                // [doc:adr-195] 裸文件复制进资源根（ImportLocalFile 写入 PMX/VMD/pose 分类目录，
                // ScanModelDir 可扫到），不加载到场景。取代原 importFileByPath 加载进场景。
                await ImportLocalFile(fullPath);
            }
            _ingestedStems.add(stem);
            ok++;
        } catch (err) {
            console.warn('[downloads] import failed:', e.name, err);
            fail++;
        }
        onProgress(t('downloads.importingProgress', { ok, fail, total: files.length }));
    }

    onProgress(t('downloads.done', { ok, fail }));
    getSettingsMenu()?.updateControls();
}

async function clearImported(
    getSettingsMenu: () => SettingsMenuHandle,
    onDone: () => void
): Promise<void> {
    if (!confirm(t('downloads.clearConfirm'))) return;

    // 重置本会话去重
    _ingestedStems.clear();

    // 一次性清理旧版 dl:file: / imported: 残留键（无害，库不读）
    if (isWebPlatform()) {
        const cfgKeys = await idbKeys('config');
        for (const k of cfgKeys) {
            if (k.startsWith('imported:') || k.startsWith('dl:file:')) await idbDelete('config', k);
        }
        const modelKeys = await idbKeys('models');
        for (const k of modelKeys) {
            if (k.startsWith('dl:file:')) await idbDelete('models', k);
        }
    } else if (getCachedCapabilities().localStaging && _desktopDownloadPath) {
        try {
            await WriteTextFile(`${_desktopDownloadPath}/.imported.json`, '{}');
        } catch {
            /* 忽略 */
        }
    }
    onDone();
}

function buildDownloadSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'downloads:folder',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('downloads.stagingDir'));

                    const statusEl = document.createElement('div');
                    statusEl.style.cssText =
                        'font-size:11px;color:var(--text-muted,inherit);margin:4px 0 8px;word-break:break-all;';
                    inner.appendChild(statusEl);

                    // [doc:adr-195] 决策 1：显示支持格式与扫描范围，解决"扫啥不知道"
                    const hintEl = document.createElement('div');
                    hintEl.style.cssText =
                        'font-size:11px;color:var(--text-muted,inherit);margin:0 0 8px;';
                    hintEl.textContent = t('downloads.supportedHint');
                    inner.appendChild(hintEl);

                    const updateStatus = async () => {
                        if (isWebPlatform()) {
                            const name = await getDownloadDirWeb();
                            statusEl.textContent = name
                                ? t('downloads.stagingSet', { dir: name })
                                : t('downloads.stagingNotSet');
                        } else if (isAndroidPlatform()) {
                            const mode = await GetStorageMode().catch(() => 'shared');
                            statusEl.textContent =
                                mode === 'shared'
                                    ? t('downloads.stagingSet', { dir: ANDROID_DOWNLOADS_DIR })
                                    : t('downloads.androidNeedShared');
                        } else if (getCachedCapabilities().localStaging) {
                            const path = await getDownloadDirLocal();
                            statusEl.textContent = path
                                ? t('downloads.stagingSet', { dir: path })
                                : t('downloads.stagingNotSet');
                        } else {
                            statusEl.textContent = t('downloads.androidStagingHint');
                        }
                    };
                    updateStatus();

                    // 网页 / 桌面可手动选择下载文件夹；安卓为固定系统路径（共享模式），不显示选择按钮
                    if (isWebPlatform()) {
                        slideRow(
                            inner,
                            'lucide:folder-plus',
                            t('downloads.pickStagingDir'),
                            false,
                            async () => {
                                const picked = await selectFsaDownloadDir();
                                if (picked) updateStatus();
                                getSettingsMenu()?.reRender();
                            }
                        );
                    } else if (!isAndroidPlatform() && getCachedCapabilities().localStaging) {
                        slideRow(
                            inner,
                            'lucide:folder-plus',
                            t('downloads.pickStagingDir'),
                            false,
                            async () => {
                                const dir = await SelectDir();
                                if (dir) {
                                    _desktopDownloadPath = dir;
                                    updateStatus();
                                }
                                getSettingsMenu()?.reRender();
                            }
                        );
                    }
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
                            await runDownloadManager(getSettingsMenu, (msg) => {
                                msgEl.textContent = msg;
                            });
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
