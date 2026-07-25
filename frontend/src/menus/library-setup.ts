// [doc:architecture] Library Setup — 模型库初始化/配置/扫描/刷新
// 从 library-core.ts 拆分

import { isAndroidPlatform } from '../core/platform';
import {
    GetConfig,
    SetResourceRoot,
    SetOverridePath,
    SetStorageMode,
    SelectDir,
    ScanModelDir,
    GetLibraryIndex,
    GetRecentModels,
    CleanOrphanCache,
} from '../core/wails-bindings';
import {
    dom,
    setStatus,
    setLibraryRoot,
    libraryRoot,
    setResourceRoot,
    setAllModels,
    allModels,
    setOverridePaths,
    LibraryModel,
    normPath,
    setDisplayNamePriority,
    DisplayNamePriority,
    stackRegistry,
} from '../core/config';
import { feedbackStatus } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import { tryCatchStatus, isUnderRoot } from '../core/utils';
import { logWarn } from '../core/logger';
import { safeCallAsync } from '../core/safe-call';
import { showConfirm } from '../core/dialog';
import { getFsaAuthState, isFsaAuthPromptDismissed, dismissFsaAuthPrompt } from '../core/backend/browser-adapter';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { buildLevel, setResourceViewMode } from './library-core';
import { showModelPopup } from './library-browse';

// ======== 初始化 ========

export async function initLibrary(): Promise<void> {
    try {
        const cfg = await GetConfig();
        let cfgRoot = cfg.resource_root || cfg.library_root || cfg.override_paths?.pmx || '';
        if (!cfgRoot) {
            const state = await getFsaAuthState();
            if (state === 'unsupported') {
                // 非 FSA 浏览器（桌面端/旧浏览器）：无目录授权能力，维持原轻提示
                feedbackStatus('library.firstUseHint', undefined, false);
                return;
            }
            if (state === 'granted') {
                // 持久化句柄仍有效但 config 未记录根路径：补上后走正常 rescan 自愈，不弹 picker
                cfgRoot = 'web://selected-dir';
            } else {
                // 'none' | 'revoked'：对齐安卓，弹确认框引导授权；跳过则记住不再弹，避免纯导入用户被骚扰
                if (!(await isFsaAuthPromptDismissed())) {
                    const ok = await showConfirm(t('library.fsaAuthPrompt'), t('library.fsaAuthTitle'));
                    if (ok) {
                        await selectResourceRoot(false);
                        return;
                    }
                    await dismissFsaAuthPrompt();
                }
                feedbackStatus('library.firstUseHint', undefined, false);
                return;
            }
        }
        setLibraryRoot(cfgRoot);
        setResourceRoot(cfgRoot);
        setOverridePaths(cfg.override_paths || {});
        if (cfg.display_name_priority) {
            setDisplayNamePriority(cfg.display_name_priority as DisplayNamePriority);
        }
        if (
            cfg.ui_state?.resourceViewMode === 'grid' ||
            cfg.ui_state?.resourceViewMode === 'list'
        ) {
            setResourceViewMode(cfg.ui_state.resourceViewMode);
        }
        try {
            const recents = await GetRecentModels();
            if (recents && recents.length > 0) {
                const { setRecentModels } = await import('../core/config');
                setRecentModels(recents.slice(0, 20));
            }
        } catch (err) {
            logWarn('library-setup', 'Load recent models:', err);
        }
        try {
            const cached = await GetLibraryIndex();
            const validCached = cached ? cached.filter((m) => m.file_path) : [];
            if (validCached.length > 0) {
                setAllModels(validCached);
            }
        } catch {
            /* no cache */
        }
        try {
            await rescanAndSync();
        } catch (err) {
            logWarn('library-setup', 'ScanModelDir refresh:', err);
        }
        // [doc:adr-177] 曾授权但句柄失效（revoked）：库显示缓存不阻塞，仅轻提示引导重设根目录
        if ((await getFsaAuthState()) === 'revoked') {
            feedbackStatus('library.fsaRevokedHint', undefined, false);
        }
        safeCallAsync('library-setup', 'CleanOrphanCache:', () => CleanOrphanCache());
        feedbackStatus('library.browseHint2', undefined, false);
    } catch (err) {
        logWarn('library-setup', 'initLibrary:', err);
        setStatus(t('library.loadLibraryFailed') + translateGoError(err), false);
    }
}

// ======== 配置 ========

export async function selectResourceRoot(requireConfirm = true): Promise<void> {
    if (isAndroidPlatform()) {
        feedbackStatus('library.androidDirNotSupported', undefined, false);
        return;
    }
    if (requireConfirm) {
        const ok = await showConfirm(t('library.confirmRescan'), t('library.confirmRescanTitle'));
        if (!ok) {
            return;
        }
    }
    const dir = await tryCatchStatus(async () => {
        const d = await SelectDir();
        return d ? d : undefined;
    }, t('library.dirSetFailed'));
    if (!dir) {
        return;
    }
    await tryCatchStatus(async () => {
        await SetResourceRoot(dir);
        await reloadConfig();
        await refreshLibrary();
    }, t('library.dirSetFailed'));
}

export async function selectOverridePath(category: string): Promise<void> {
    if (isAndroidPlatform()) {
        feedbackStatus('library.androidDirNotSupported', undefined, false);
        return;
    }
    const dir = await tryCatchStatus(async () => {
        const d = await SelectDir();
        return d ? d : undefined;
    }, t('library.dirSetFailed'));
    if (!dir) {
        return;
    }
    await tryCatchStatus(async () => {
        await SetOverridePath(category, dir);
        await reloadConfig();
        await refreshLibrary();
    }, t('library.dirSetFailed'));
}

export async function switchStorageMode(mode: 'private' | 'shared'): Promise<void> {
    if (!isAndroidPlatform()) {
        return;
    }
    const ok = await showConfirm(
        mode === 'shared' ? t('library.confirmSwitchShared') : t('library.confirmSwitchPrivate'),
        t('library.confirmSwitchTitle')
    );
    if (!ok) {
        return;
    }
    try {
        await SetStorageMode(mode);
        await reloadConfig();
        await refreshLibrary();
    } catch (err) {
        setStatus(
            `${t('library.dirSetFailed')}: ${err instanceof Error ? err.message : '未知错误'}`,
            true
        );
        throw err;
    }
}

export async function rescanAndSync(): Promise<LibraryModel[]> {
    console.info('[debug] rescanAndSync called');
    const models = (await ScanModelDir()) || [];
    console.info('[debug] rescanAndSync: ScanModelDir returned', models?.length, 'models');
    if (models && models.length > 0) {
        console.info('[debug] first model:', models[0].file_path, 'dir:', models[0].dir);
    }
    setAllModels(models);
    window.dispatchEvent(new CustomEvent('mmar:library-scanned'));
    return models;
}

export async function reloadConfig(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg) {
        setResourceRoot(cfg.resource_root || '');
        setLibraryRoot(cfg.resource_root || cfg.override_paths?.pmx || '');
        setOverridePaths(cfg.override_paths || {});
    }
}

// ======== 浏览路径恢复 ========

function getCurrentBrowsePath(): string[] {
    const stack = stackRegistry.modelStack;
    if (!stack || stack.levelCount === 0) {
        return [];
    }
    const dirs: string[] = [];
    for (let i = 0; i < stack.levelCount; i++) {
        const level = stack.getLevel(i);
        if (level && level.dir && level.dir !== '') {
            dirs.push(level.dir);
        }
    }
    return dirs;
}

function hasSubdir(
    parentDir: string,
    childName: string,
    filter?: (m: LibraryModel) => boolean
): boolean {
    const parent = normPath(parentDir);
    for (const m of allModels) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        if (!isUnderRoot(parent, mdir)) {
            continue;
        }
        const rel = mdir.substring(parent.length + 1);
        const parts = rel.split('/').filter(Boolean);
        if (parts.length > 0 && parts[0] === childName) {
            return true;
        }
    }
    return false;
}

function restoreBrowsePath(pathDirs: string[]): void {
    const stack = stackRegistry.modelStack;
    if (!stack || pathDirs.length <= 1 || !libraryRoot) {
        return;
    }
    const rootDir = normPath(libraryRoot);
    if (pathDirs[0] !== rootDir) {
        return;
    }
    const filter = (m: LibraryModel) => m.format === 'pmx';
    let currentDir = rootDir;
    for (let i = 1; i < pathDirs.length; i++) {
        const targetDir = normPath(pathDirs[i]);
        if (!isUnderRoot(currentDir, targetDir)) {
            break;
        }
        const childName = targetDir.substring(currentDir.length + 1).split('/')[0];
        if (!childName || !hasSubdir(currentDir, childName, filter)) {
            break;
        }
        const nextDir = currentDir + '/' + childName;
        const nextLevel = buildLevel(nextDir, childName, filter, stack);
        stack.push(nextLevel);
        currentDir = nextDir;
    }
}

// ======== 刷新 ========

export async function refreshLibrary(): Promise<void> {
    const prevPath = getCurrentBrowsePath();
    feedbackStatus('library.scanning', undefined, false);
    const models = await tryCatchStatus(async () => {
        return await rescanAndSync();
    }, t('library.scanFailed'));
    if (models === undefined) {
        return;
    }
    showInfoToast(t('library.entriesCount', { n: (models || []).length }));
    CleanOrphanCache().catch((err) =>
        logWarn('library-setup', 'CleanOrphanCache (background):', err)
    );
    if (
        dom.sceneOverlay.classList.contains('visible') &&
        dom.sceneOverlay.dataset.popupType === 'model'
    ) {
        showModelPopup();
        if (prevPath.length > 0 && libraryRoot) {
            const rootDir = normPath(libraryRoot);
            const rootLevel = buildLevel(
                rootDir,
                t('library.title'),
                (m) => m.format === 'pmx',
                stackRegistry.modelStack!,
                []
            );
            stackRegistry.modelStack!.push(rootLevel);
            restoreBrowsePath(prevPath);
        }
    }
}
