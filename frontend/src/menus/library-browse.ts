// [doc:architecture] Library Browse — 模型浏览菜单创建与弹窗入口
// 从 library-core.ts 拆分

import {
    dom,
    closeAllOverlays,
    setStatus,
    allModels,
    LibraryModel,
    PopupRow,
    PopupLevel,
    normPath,
    modelRegistry,
    recentModels,
    computeLibraryRef,
    stackRegistry,
    getMenuWrapper,
    getBrowseDir,
    libraryRoot,
    isUnderRoot,
} from '../core/config';
import { loadManager } from '../core/load-manager';
import { SlideMenu } from './menu';
import { t } from '../core/i18n/t';
import { logWarn } from '../core/utils';
import { SetLastBrowseDir } from '../core/wails-bindings';
import { buildModelLevel, buildModelToolsLevel } from './model-detail';
import { buildStageTransformLevel } from './scene-menu';
import { buildLevel, modelToRow, buildModelRootItems, isModelDirTarget, abortThumbnailStreaming } from './library-core';
import {
    onModelRowClick,
    replaceModel,
    buildTagsOverviewLevel,
    buildTagDetailLevel,
    highlightRow,
    prepareModelRestore,
    importFile,
} from './library-actions';
import { refreshLibrary } from './library-setup';
import { librarySessionStore } from './library-session-store';

// [修复] 数据未就绪时撤销本次 autoExpand，轮询等待 allModels 扫描/解压完成后
// 再补做 push，避免解压未完成时进入空层（用户感知的"分类1为空/未刷新就进菜单"）。
// [doc:adr-135] 计时器引用已迁入 LibrarySessionStore.restore.timer，由 store 统一管理。

function _isDirDataReady(targetDir: string): boolean {
    const t = normPath(targetDir);
    return (allModels || []).some(
        (m) => m.format === 'pmx' && (normPath(m.dir) === t || isUnderRoot(t, normPath(m.dir)))
    );
}

function deferRestore(menu: SlideMenu, dir: string, seg: string): void {
    librarySessionStore.clearRestoreTimer();
    // [doc:adr-135] P0.3: 进入 polling 状态，UI 显示「正在扫描 X…（已等待 Ys）」
    librarySessionStore.markRestorePolling(seg);
    setStatus(t('library.scanningDir', { dir: seg }), false, true);

    let tries = 0;
    let lastShownSec = -1;
    const tick = () => {
        tries++;
        if (tries > 40) {
            // ~6s 上限，避免永久挂起。timer 已 fire，清空引用。
            librarySessionStore.clearRestoreTimer();
            // [doc:adr-135] P0.3: 超时不再静默。告知用户数据未就绪，需手动点击文件夹展开。
            librarySessionStore.markRestoreTimeout();
            setStatus(t('library.scanTimeout', { dir: seg }), false, true);
            return;
        }
        const nextDir = normPath(dir + '/' + seg);
        if (!_isDirDataReady(nextDir)) {
            // [doc:adr-135] P0.3: 每 1s 更新一次「已等待 Xs」，避免 150ms 闪烁。
            const startedAt = librarySessionStore.getRestoreStartedAt();
            if (startedAt !== null) {
                const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                if (elapsedSec >= 2 && elapsedSec !== lastShownSec) {
                    lastShownSec = elapsedSec;
                    setStatus(
                        t('library.scanningDirWithWait', { dir: seg, sec: elapsedSec }),
                        false,
                        true
                    );
                }
            }
            librarySessionStore.setRestoreTimer(setTimeout(tick, 150));
            return;
        }
        // 数据就绪，timer 已 fire，清空引用。
        librarySessionStore.clearRestoreTimer();
        // 校验：菜单仍停留在该层且恢复态未被改写才补做 push，避免与 restoreBrowsePath 重复或误推
        const cur = menu.currentLevel;
        if (!cur || normPath(cur.dir) !== normPath(dir)) {
            // [doc:adr-135] P0.3: 校验失败也要清状态，否则 status 卡在 polling
            librarySessionStore.clearRestoreStatus();
            return;
        }
        const pa = librarySessionStore.getPendingAutoExpand();
        if (!pa || pa[0] !== seg) {
            // [doc:adr-135] P0.3: 校验失败也要清状态
            librarySessionStore.clearRestoreStatus();
            return;
        }
        librarySessionStore.setPendingAutoExpand(pa.length > 1 ? pa.slice(1) : null);
        menu.push(
            buildLevel(nextDir, seg, (m) => m.format === 'pmx', stackRegistry.modelStack!, [])
        );
        // [doc:adr-135] P0.3: 标记 ready，UI 显示「已展开 X」（短暂提示，2 秒自动消失）
        librarySessionStore.markRestoreReady();
        setStatus(t('library.expanded', { dir: seg }), true);
    };
    librarySessionStore.setRestoreTimer(setTimeout(tick, 150));
}

// ======== 模型菜单创建 ========

const makeModelMenu = (container: HTMLElement): SlideMenu => {
    return new SlideMenu({
        container,
        onClose: closeAllOverlays,
        onFolderEnter: async (row) => {
            if (row.target === '__recent__') {
                const recentMap = new Map<string, number>();
                recentModels.forEach((ref, i) => recentMap.set(ref, i));
                const recentModelsList = allModels
                    .filter((m) => {
                        const ref = computeLibraryRef(m.file_path);
                        return ref && recentMap.has(ref);
                    })
                    .sort((a, b) => {
                        const refA = computeLibraryRef(a.file_path);
                        const refB = computeLibraryRef(b.file_path);
                        return (recentMap.get(refA!) ?? 999) - (recentMap.get(refB!) ?? 999);
                    });
                return {
                    label: t('library.recent'),
                    dir: '',
                    items:
                        recentModelsList.length > 0
                            ? recentModelsList.map((m) => modelToRow(m))
                            : [
                                  {
                                      kind: 'action' as const,
                                      label: t('library.noRecent'),
                                      icon: 'clock',
                                      target: '',
                                      sublabel: t('library.noRecentHint'),
                                  },
                              ],
                };
            }
            if (row.target === '__tags__') {
                return buildTagsOverviewLevel();
            }
            if (row.target && row.target.startsWith('__tag:')) {
                return buildTagDetailLevel(row.target.replace('__tag:', ''));
            }
            if (row.target === 'models:browse') {
                if (!libraryRoot) {
                    return {
                        label: t('library.title'),
                        dir: '',
                        items: [],
                        renderCustom: (container) => {
                            container.style.cssText =
                                'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                            container.innerHTML = `<div>${t('library.noRootDir')}</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">${t('library.noRootDirHint')}</div>`;
                        },
                    };
                }
                const browseDir = getBrowseDir('pmx');
                await prepareModelRestore(browseDir, 'pmx');
                return buildLevel(
                    browseDir,
                    t('library.title'),
                    (m) => m.format === 'pmx',
                    stackRegistry.modelStack!,
                    []
                );
            }
            if (isModelDirTarget(row.target)) {
                return buildLevel(
                    row.target,
                    row.label,
                    (m) => m.format === 'pmx',
                    stackRegistry.modelStack!
                );
            }
            return null;
        },
        onItemClick: (row: PopupRow) => {
            if (row.target && row.target.startsWith('scene:')) {
                const id = row.target.replace('scene:', '');
                const inst = modelRegistry.get(id);
                if (!inst) {
                    return;
                }
                if (inst.kind === 'stage') {
                    stackRegistry.modelStack?.push(buildStageTransformLevel(id));
                    return;
                }
                stackRegistry.modelStack?.push(buildModelLevel(id));
                return;
            }
            if (row.model) {
                // [doc:adr-131] 契约派发：读 currentLevel.outcome，按 mode 派发选中后行为
                const outcome = stackRegistry.modelStack?.currentLevel?.outcome ?? {
                    mode: 'close' as const,
                };
                if (row.model.format === 'vmd' && outcome.mode === 'stay') {
                    loadManager.load({
                        kind: 'vmd',
                        path: row.model.file_path,
                        modelId: outcome.modelId,
                    });
                    return;
                }
                if (outcome.mode === 'jumpToDir' && outcome.modelId) {
                    onModelRowClick(row.model, outcome.modelId);
                    return;
                }
                // 默认 close：加载即关闭浏览器
                closeAllOverlays();
                replaceModel(row.model);
                return;
            }
            if (row.target === 'models:rescan') {
                refreshLibrary();
                return;
            }
            if (row.target === 'models:import-file') {
                importFile();
                return;
            }
        },
        onHover: (row, entering) => {
            if (!entering) {
                setStatus('', false);
                return;
            }
            const hints: Record<string, string> = {
                'models:browse': t('library.browseHint'),
                'models:import-file': t('library.importHint'),
            };
            const hint = hints[row.target || ''];
            if (hint) {
                setStatus(hint, false);
            }
        },
        onLevelEnter: (level, menu) => {
            const dir = normPath(level.dir);
            if (!dir || dir === '.' || dir === '/') {
                return;
            }
            const browseRoot = getBrowseDir('pmx');
            if (!browseRoot) {
                return;
            }
            const pendingFocus = librarySessionStore.getPendingFocusModel();
            const pendingAuto = librarySessionStore.getPendingAutoExpand();
            if (pendingFocus && normPath(level.dir) === pendingFocus.dir) {
                highlightRow(container, pendingFocus.rowKey);
                librarySessionStore.setPendingFocusModel(null);
            }
            if (pendingAuto && pendingAuto.length > 0) {
                const seg = pendingAuto[0];
                const nextDir = normPath(dir + '/' + seg);
                // [修复] 数据守卫：仅当 allModels 已扫描到该目录的 pmx 才进入，
                // 否则解压/扫描未完成时 push 会得到空层（"分类1为空"）。
                if (!_isDirDataReady(nextDir)) {
                    logWarn('library-browse', '[restore] defer autoExpand, data not ready', {
                        nextDir,
                    });
                    deferRestore(menu, dir, seg);
                    return;
                }
                librarySessionStore.setPendingAutoExpand(pendingAuto.length > 1 ? pendingAuto.slice(1) : null);
                logWarn('library-browse', '[restore] autoExpand push', {
                    from: dir,
                    seg,
                    nextDir,
                    transitioning: menu.isTransitioning,
                });
                menu.push(
                    buildLevel(
                        nextDir,
                        seg,
                        (m) => m.format === 'pmx',
                        stackRegistry.modelStack!,
                        []
                    )
                );
                return;
            }
            if (dir === browseRoot) {
                return;
            }
            if (isUnderRoot(browseRoot, dir)) {
                void SetLastBrowseDir('pmx', dir);
            }
        },
    });
};

// ======== 弹窗入口 ========

export function showModelPopup(): void {
    dom.sceneOverlay.classList.remove('sceneOverlay-motion', 'sceneOverlay-settings');
    dom.sceneOverlay.classList.add('sceneOverlay-model');
    dom.sceneOverlay.dataset.popupType = 'model';
    // [doc:adr-135] 重置菜单前清理上一次会话残留的 restore 态（pendingAutoExpand / pendingFocusModel / timer），
    // 防止重开弹窗时误触发上次的 autoExpand。loading 不重置（解压/替换可能跨弹窗重置进行）。
    librarySessionStore.reset();
    // [adr-136] 取消上一次会话残留的缩略图流式加载批次（快速切弹窗不再堆积 GetThumbnail）
    abortThumbnailStreaming();

    const wrapper = getMenuWrapper('model-popup');
    if (stackRegistry.modelStack) {
        stackRegistry.modelStack.resetToRoot();
        stackRegistry.modelStack.setLevel(0, {
            label: t('library.model'),
            dir: '',
            items: buildModelRootItems(),
            itemBuilder: buildModelRootItems,
        });
        stackRegistry.modelStack.reRender();
        return;
    }
    stackRegistry.modelStack = makeModelMenu(wrapper);
    stackRegistry.modelStack.reset({
        label: t('library.model'),
        dir: '',
        items: buildModelRootItems(),
        itemBuilder: buildModelRootItems,
    });
}

export { makeModelMenu };
