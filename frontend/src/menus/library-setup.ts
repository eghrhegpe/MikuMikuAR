// [doc:architecture] Library Setup — 模型库初始化/配置/扫描/刷新
// 从 library-core.ts 拆分

import { getCachedCapabilities } from '../core/backend';
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
    setLoadingStatus,
    hideLoadingStatus,
    setLibraryRoot,
    libraryRoot,
    setResourceRoot,
    setAllModels,
    allModels,
    setOverridePaths,
    LibraryModel,
    setDisplayNamePriority,
    DisplayNamePriority,
} from '../core/config';
import { stackRegistry } from './menu-stack-registry';
import { normPath } from '../core/path';
import { feedbackStatus } from '../core/feedback';
import { isUnderRoot } from '../core/path';
import { tryCatchStatus } from '../core/status-helpers';
import { logWarn } from '../core/logger';
import { safeCallAsync } from '../core/safe-call';
import { showConfirm } from '../core/dialog';
import {
    getFsaAuthState,
    isFsaAuthPromptDismissed,
    dismissFsaAuthPrompt,
    reauthorizeFsaRoot,
} from '../core/backend/browser-adapter';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { addDisposableListener } from '../core/dom';
import { buildLevel, setResourceViewMode } from './library-core';
import { showModelPopup } from './library-browse';
// [doc:adr-238] 导航按钮接线 + 标签映射（从 core/init.ts 下沉），main.ts side-effect import 拉起
import { initNavActions, disposeNavBindings } from './nav-actions';

// [fix:tree-shake] 必须显式调用 initNavActions()：esbuild（vite dev）与 Rollup（build）
// 都会移除「绑定未被使用」的 import——nav-actions 若仅被 import 而不调用，其模块顶层
// 副作用（installNavBindings 按钮接线 + registerUiAction 注册）永不执行，导致按钮
// 无响应、toggleOverlayMode/navAction 未注册。initNavActions 内部幂等（installNavBindings
// 有 _navDisposables 守卫），nav-actions 自身顶层调用 + 此处调用重复执行安全。
initNavActions();

// ======== 初始化 ========

/** [doc:adr-238] mmar:zip-imported 监听幂等保护（initLibrary 可能被 HMR 重复执行） */
let _zipImportedListenerInstalled = false;

/** [doc:adr-180] 启动授权引导：弹确认框（用户手势）→ 对已有句柄 requestPermission 重新授权（不重选目录）。
 * 返回 true 表示 _fsaRootHandle 已有效、可继续真扫；false 表示用户跳过/拒绝/无句柄。 */
async function promptReauthorize(): Promise<boolean> {
    if (await isFsaAuthPromptDismissed()) {
        return false;
    }
    const ok = await showConfirm(t('library.fsaAuthPrompt'), t('library.fsaAuthTitle'));
    if (!ok) {
        await dismissFsaAuthPrompt();
        return false;
    }
    const granted = await reauthorizeFsaRoot();
    if (!granted) {
        feedbackStatus('library.fsaRevokedHint', undefined, false);
    }
    return granted;
}

export async function initLibrary(): Promise<void> {
    try {
        // [doc:adr-238] nav-actions 模块加载即完成按钮接线 + 标签映射（main.ts side-effect
        // import 本模块→import nav-actions 已拉起），此处无需显式调用 initNavActions。
        const cfg = await GetConfig();
        let cfgRoot = cfg.resource_root || cfg.library_root || cfg.override_paths?.pmx || '';
        const state = await getFsaAuthState();

        if (!cfgRoot) {
            if (state === 'unsupported') {
                // 非 FSA 浏览器（桌面端/旧浏览器）：无目录授权能力，维持原轻提示
                feedbackStatus('library.firstUseHint', undefined, false);
                return;
            }
            if (state === 'none') {
                // 从未授权 → 首次选目录（showDirectoryPicker）
                if (!(await isFsaAuthPromptDismissed())) {
                    const ok = await showConfirm(
                        t('library.fsaAuthPrompt'),
                        t('library.fsaAuthTitle')
                    );
                    if (ok) {
                        await selectResourceRoot(false); // 内部 showDirectoryPicker + 扫描
                        return;
                    }
                    await dismissFsaAuthPrompt();
                }
                feedbackStatus('library.firstUseHint', undefined, false);
                return;
            }
            // 'granted' | 'revoked'：句柄已存在（granted 有效 / revoked 需重授）
            if (state === 'revoked') {
                const reauthOk = await promptReauthorize();
                if (!reauthOk) {
                    feedbackStatus('library.firstUseHint', undefined, false);
                    return;
                }
            }
            cfgRoot = 'web://selected-dir';
        } else {
            // 已配置根目录：句柄失效（revoked）则重授权后再真扫；失败降级读缓存不阻塞
            if (state === 'revoked') {
                await promptReauthorize();
            }
        }

        // ===== 通用初始化路径 =====
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
        } catch (e) {
            logWarn('library-setup', 'GetLibraryIndex failed', e);
        }
        try {
            await rescanAndSync();
        } catch (err) {
            logWarn('library-setup', 'ScanModelDir refresh:', err);
        }
        safeCallAsync('library-setup', 'CleanOrphanCache:', () => CleanOrphanCache());
        feedbackStatus('library.browseHint2', undefined, false);
        // [doc:adr-238] zip 拖拽导入完成后重扫库：core/drop-import 不再直接 import 本模块
        // （core 回归叶子），改派发 mmar:zip-imported 事件。initLibrary 为启动唯一入口，
        // 监听器注册带幂等保护（HMR 安全）。
        if (!_zipImportedListenerInstalled) {
            _zipImportedListenerInstalled = true;
            addDisposableListener(window, 'mmar:zip-imported', () => {
                safeCallAsync('library-setup', 'refresh after zip import', () => refreshLibrary());
            });
        }
    } catch (err) {
        logWarn('library-setup', 'initLibrary:', err);
        setStatus(t('library.loadLibraryFailed') + translateGoError(err), false);
    }
}

// ======== 配置 ========

export async function selectResourceRoot(requireConfirm = true): Promise<void> {
    if (!getCachedCapabilities().fsSelectDir) {
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
    if (!getCachedCapabilities().fsSelectDir) {
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
    if (!getCachedCapabilities().androidStorageMode) {
        return;
    }
    const ok = await showConfirm(
        mode === 'shared' ? t('library.confirmSwitchShared') : t('library.confirmSwitchPrivate'),
        t('library.confirmSwitchTitle')
    );
    if (!ok) {
        return;
    }
    // [doc:adr-017] shared 模式需 MANAGE_EXTERNAL_STORAGE 权限。
    // 启动期 checkAndroidStoragePermission() 只弹一次（androidStoragePromptShown 守卫），
    // 用户在设置页主动切换 shared 时必须主动请求权限，否则授权链路断裂——
    // Go 端 SetStorageMode 只写 config.root=/sdcard/MMD，不触发任何权限请求。
    // 未授权时仍写 config，用户授权后 storage:permissionGranted 事件触发
    // init.ts 的 refreshLibrary 自动扫出模型（ADR-017 §四授权链路）。
    if (mode === 'shared') {
        const w = window.wails;
        if (
            w &&
            typeof w.hasStoragePermission === 'function' &&
            typeof w.requestStoragePermission === 'function' &&
            !w.hasStoragePermission()
        ) {
            setStatus(t('main.needFileAccess'), true);
            w.requestStoragePermission();
        }
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

// ======== 扫描重入锁（[fix P2] 快速连点「重扫」防并发覆盖） ========
let _scanInFlight: Promise<LibraryModel[]> | null = null;
// [code_review P2] coalescing 标志：扫描进行中又收到新请求（换资源根/存储模式/
// zip 导入完成等上下文已变场景）时置位，当前扫描 finally 完成后补扫一次——
// 只复用旧 Promise 会静默丢弃合法重扫，旧目录结果应用到新状态。
let _rescanRequested = false;

export async function rescanAndSync(): Promise<LibraryModel[]> {
    // [fix P2] 重入锁：快速连点「重扫」时两个 ScanModelDir 异步流并发，
    // 后启动的可能先返回 → setAllModels 覆盖顺序错乱；A 完成还会清掉 B 的进度回调。
    // 进行中先复用同一 Promise 防并发竞态；但若请求上下文已变（libraryRoot/
    // storageMode 变化或 zip 导入完成），置 coalescing 标志，当前扫描完成后补扫。
    if (_scanInFlight) {
        _rescanRequested = true;
        return _scanInFlight;
    }
    console.info('[debug] rescanAndSync called');
    // 底部状态栏：旋转图标 + 正在扫描目录
    const dir = libraryRoot || t('library.title');
    setLoadingStatus(t('library.scanningDir', { dir }));
    const run = (async (): Promise<LibraryModel[]> => {
        try {
        // [doc:adr-183] 注册节流进度回调：扫描中每扫完一个子目录触发，
        // 节流 500ms 增量读 IDB 刷新 setAllModels，避免「扫完才一次性显示」的体感问题。
        // 浏览器端走 browserAdapter（有进度回调），桌面端走 Go binding（无回调，UI 不刷新直至完成）。
        let lastFlushTs = 0;
        let pendingFlush = false;
        const flush = async () => {
            pendingFlush = false;
            try {
                // 增量读 IDB 当前已扫到的 entry，刷新 UI
                const models = (await GetLibraryIndex()) || [];
                setAllModels(models);
                window.dispatchEvent(new CustomEvent('mmar:library-scanned'));
            } catch (e) {
                console.warn('[web-scan] 增量刷新失败', e);
            }
        };
        const throttledCb = (scannedDirs: number, currentDir: string) => {
            const now = Date.now();
            // 更新当前扫描目录到状态栏（子目录名，如 PMX/subdir）
            if (currentDir) {
                setLoadingStatus(t('library.scanningDir', { dir: currentDir }));
            }
            if (now - lastFlushTs < 500) {
                // 节流窗口内，调度延迟刷新
                if (!pendingFlush) {
                    pendingFlush = true;
                    setTimeout(
                        () => {
                            lastFlushTs = Date.now();
                            flush();
                        },
                        500 - (now - lastFlushTs)
                    );
                }
                return;
            }
            lastFlushTs = now;
            flush();
        };
        try {
            const { setScanProgressCallback } = await import('../core/backend/browser-adapter');
            setScanProgressCallback(throttledCb);
        } catch {
            /* 桌面端无 browser-adapter 模块，忽略 */
        }
        const models = (await ScanModelDir()) || [];
        console.info('[debug] rescanAndSync: ScanModelDir returned', models?.length, 'models');
        if (models && models.length > 0) {
            console.info('[debug] first model:', models[0].file_path, 'dir:', models[0].dir);
        }
        setAllModels(models);
        // 注销回调，避免后续误触发
        try {
            const { setScanProgressCallback } = await import('../core/backend/browser-adapter');
            setScanProgressCallback(null);
        } catch {
            /* 桌面端忽略 */
        }
        window.dispatchEvent(new CustomEvent('mmar:library-scanned'));
        return models;
    } finally {
        hideLoadingStatus();
        // 清除"正在扫描"文本，状态栏自动隐藏（空文本 → syncStatusBarVisibility → display:none）
        setStatus('', false, false);
        _scanInFlight = null;
        // [code_review P2] coalescing 补扫：扫描期间收到的新请求（上下文已变）
        // 在旧扫描 finally 完成后触发一次新扫描，避免合法重扫被静默丢弃。
        if (_rescanRequested) {
            _rescanRequested = false;
            void rescanAndSync();
        }
    }
    })();
    _scanInFlight = run;
    return _scanInFlight;
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
    // [doc:adr-183] 手动重扫 = 用户手势，可作授权过期兜底：revoked 时先重授权再真扫，
    // 对齐 initLibrary 启动引导；成功则下方 rescanAndSync 真扫，失败降级读缓存 + 提示。
    if ((await getFsaAuthState()) === 'revoked') {
        const reauthOk = await promptReauthorize();
        if (!reauthOk) {
            feedbackStatus('library.fsaRevokedHint', undefined, false);
        }
    }
    const models = await tryCatchStatus(async () => {
        return await rescanAndSync();
    }, t('library.scanFailed'));
    if (models === undefined) {
        // [fix P2] 扫描失败分支也恢复浏览路径 + 显式提示缓存态，
        // 避免用户停留在被清空的视图上且路径恢复逻辑被跳过。
        // [fix code_review P2×2] ① stack 可能为 null（扫描期间 popup 被关闭，library-browse
        // onClose 置 null）——null 守卫防 .push 抛 TypeError；② push 前先 resetToRoot 镜像
        // 成功分支（showModelPopup→resetToRoot），避免旧层级叠加导致 back 导航/路径重复。
        const stack = stackRegistry.modelStack;
        if (prevPath.length > 0 && libraryRoot && stack) {
            stack.resetToRoot();
            const rootDir = normPath(libraryRoot);
            const rootLevel = buildLevel(
                rootDir,
                t('library.title'),
                (m) => m.format === 'pmx',
                stack,
                []
            );
            stack.push(rootLevel);
            restoreBrowsePath(prevPath);
        }
        return;
    }
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

// [doc:adr-238] 注册文件选择器行为供 core/action-defs 经 ui-action-bridge 调用
// （定义留 core、实现归 menus 启动链，切断 core→menus 反向依赖）。
import { registerUiAction } from '@/core/ui-action-bridge';
registerUiAction('selectResourceRoot', () => selectResourceRoot());
registerUiAction('selectOverridePath', (kind: string) => selectOverridePath(kind));

// [doc:adr-238] 注册库刷新供 core/action-defs 经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('refreshLibrary', () => refreshLibrary());

// [doc:adr-238] 注册 initLibrary 供 core/init 经 scene-action-bridge 调用（切断 core→menus）
registerSceneAction('initLibrary', () => initLibrary());
