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
    layerBindingTargetId,
    motionBindingTargetId,
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
import { buildLevel, modelToRow, buildModelRootItems, isModelDirTarget } from './library-core';
import { onModelRowClick, replaceModel, buildTagsOverviewLevel, buildTagDetailLevel, highlightRow, prepareModelRestore, importFile } from './library-actions';
import { refreshLibrary } from './library-setup';
import { getPendingAutoExpand, setPendingAutoExpand, getPendingFocusModel, setPendingFocusModel } from './library-core';

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
                    items: recentModelsList.length > 0
                        ? recentModelsList.map((m) => modelToRow(m))
                        : [{ kind: 'action' as const, label: t('library.noRecent'), icon: 'clock', target: '', sublabel: t('library.noRecentHint') }],
                };
            }
            if (row.target === '__tags__') return buildTagsOverviewLevel();
            if (row.target && row.target.startsWith('__tag:')) {
                return buildTagDetailLevel(row.target.replace('__tag:', ''));
            }
            if (row.target === 'models:browse') {
                if (!libraryRoot) {
                    return {
                        label: t('library.title'), dir: '', items: [],
                        renderCustom: (container) => {
                            container.style.cssText = 'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                            container.innerHTML = `<div>${t('library.noRootDir')}</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">${t('library.noRootDirHint')}</div>`;
                        },
                    };
                }
                const browseDir = getBrowseDir('pmx');
                await prepareModelRestore(browseDir, 'pmx');
                return buildLevel(browseDir, t('library.title'), (m) => m.format === 'pmx', stackRegistry.modelStack!, []);
            }
            if (isModelDirTarget(row.target)) {
                return buildLevel(row.target, row.label, (m) => m.format === 'pmx', stackRegistry.modelStack!);
            }
            return null;
        },
        onItemClick: (row: PopupRow) => {
            if (row.target && row.target.startsWith('scene:')) {
                const id = row.target.replace('scene:', '');
                const inst = modelRegistry.get(id);
                if (!inst) return;
                if (inst.kind === 'stage') {
                    stackRegistry.modelStack?.push(buildStageTransformLevel(id));
                    return;
                }
                stackRegistry.modelStack?.push(buildModelLevel(id));
                return;
            }
            if (row.model) {
                if (row.model.format === 'vmd' && layerBindingTargetId) {
                    const targetId = layerBindingTargetId;
                    closeAllOverlays();
                    loadManager.load({ kind: 'vmd', path: row.model.file_path, modelId: targetId });
                    return;
                }
                if (row.model.format === 'vmd' && motionBindingTargetId) {
                    const targetId = motionBindingTargetId;
                    closeAllOverlays();
                    loadManager.load({ kind: 'vmd', path: row.model.file_path, modelId: targetId });
                    return;
                }
                closeAllOverlays();
                replaceModel(row.model);
                return;
            }
            if (row.target === 'models:rescan') { refreshLibrary(); return; }
            if (row.target === 'models:import-file') { importFile(); return; }
        },
        onHover: (row, entering) => {
            if (!entering) { setStatus('', false); return; }
            const hints: Record<string, string> = {
                'models:browse': t('library.browseHint'),
                'models:import-file': t('library.importHint'),
            };
            const hint = hints[row.target || ''];
            if (hint) setStatus(hint, false);
        },
        onLevelEnter: (level, menu) => {
            const dir = normPath(level.dir);
            if (!dir || dir === '.' || dir === '/') return;
            const browseRoot = getBrowseDir('pmx');
            if (!browseRoot) return;
            const pendingFocus = getPendingFocusModel();
            const pendingAuto = getPendingAutoExpand();
            if (pendingFocus && normPath(level.dir) === pendingFocus.dir) {
                highlightRow(container, pendingFocus.rowKey);
                setPendingFocusModel(null);
            }
            if (pendingAuto && pendingAuto.length > 0) {
                const seg = pendingAuto[0];
                const nextDir = normPath(dir + '/' + seg);
                setPendingAutoExpand(pendingAuto.length > 1 ? pendingAuto.slice(1) : null);
                logWarn('library-browse', '[restore] autoExpand push', { from: dir, seg, nextDir, transitioning: menu.isTransitioning });
                menu.push(buildLevel(nextDir, seg, (m) => m.format === 'pmx', stackRegistry.modelStack!, []));
                return;
            }
            if (dir === browseRoot) return;
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

    const wrapper = getMenuWrapper('model-popup');
    if (stackRegistry.modelStack) {
        stackRegistry.modelStack.resetToRoot();
        stackRegistry.modelStack.setLevel(0, {
            label: t('library.model'), dir: '', items: buildModelRootItems(), itemBuilder: buildModelRootItems,
        });
        stackRegistry.modelStack.reRender();
        return;
    }
    stackRegistry.modelStack = makeModelMenu(wrapper);
    stackRegistry.modelStack.reset({
        label: t('library.model'), dir: '', items: buildModelRootItems(), itemBuilder: buildModelRootItems,
    });
}

export { makeModelMenu };