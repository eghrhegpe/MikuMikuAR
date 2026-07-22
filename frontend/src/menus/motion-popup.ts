// [doc:architecture] Motion Popup — 动作弹窗（barrel + 路由 + 入口注册）
// 拆分后保留: registerPopupMenu 注册 / MOTION_FOLDER_ROUTES / motionOnItemClick 路由
// 子文件: motion-binding-ui / motion-detail-ui / motion-root-ui

import {
    setStatus,
    PopupLevel,
    PopupRow,
    getBrowseDir,
    isPlaying,
    setIsPlaying,
    mmdRuntime,
    stackRegistry,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { loadManager } from '../core/load-manager';
import {
    updatePlaybackUI,
    loadVPDPose,
    triggerAutoSave,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
} from '../scene/scene';
import { getAudioName } from '../outfit/audio';
import {
    setProcMotionMode,
    regenerateProcMotion,
    getLipSyncState,
    setLipSyncEnabled,
} from '../scene/scene';
import type { ProcMotionMode } from '../motion-algos/procedural-motion';
import { buildProcMotionLevel } from './motion-procmotion-levels';
import { buildGazeTrackingLevel } from './motion-gaze-levels';
import { buildCameraLevel } from './motion-camera-levels';
import { buildPoseStudioLevel } from './motion-pose-levels';
import { t } from '../core/i18n/t';
import {
    addSceneMotion,
    clearAllSceneMotions,
    replaceDefaultMotion,
} from '../scene/motion/motion-intent';
import { logWarn } from '../core/logger';
import { addDisposableListener } from '../core/dom';

// ── 子文件导入 ──
import {
    resetFocusedLayerId,
    buildActionBindingLevel,
    handleModelAction,
} from './motion-binding-ui';
import { buildMotionDetailLevel, buildPlaybackSpeedLevel } from './motion-detail-ui';
import {
    buildMotionRootLevel,
    buildMotionRootItems,
    buildRetargetLevel,
    importExternalAnimation,
    hideMotionPopup,
} from './motion-root-ui';

// ═══════════════════════════════════════════════════════════
// Barrel Re-Exports（外部调用方继续从 ./motion-popup 导入）
// ═══════════════════════════════════════════════════════════

export {
    renderModuleToggleList,
    applyIntentToModel,
    initMotionBroadcast,
} from './motion-binding-ui';
export { syncPlaybackSpeedToRuntime } from './motion-detail-ui';
export { hideMotionPopup, buildMotionRootItems } from './motion-root-ui';

// ═══════════════════════════════════════════════════════════
// 入口注册
// ═══════════════════════════════════════════════════════════

const {
    getMenu: getMotionMenu,
    refreshRoot: refreshMotionRoot,
    show: showMotionPopup,
} = registerPopupMenu({
    wrapperKey: 'motion-popup',
    popupType: 'motion',
    overlayClass: 'sceneOverlay-motion',
    buildRoot: () => buildMotionRootLevel(),
    buildRootItems: () => buildMotionRootItems(),
    handlers: {
        onItemClick: motionOnItemClick,
        onFolderEnter: motionOnFolderEnter,
    },
});

export { getMotionMenu, refreshMotionRoot, showMotionPopup };

// 当库扫描完成时，如果动作菜单已打开则 reRender
const _onLibraryScanned = (): void => {
    getMotionMenu()?.reRender();
};
const _libraryScannedDisp = addDisposableListener(
    window,
    'mmar:library-scanned',
    _onLibraryScanned
);

/** 释放 motion-popup 模块资源（HMR/清理时调用） */
export function disposeMotionPopup(): void {
    _libraryScannedDisp.dispose();
}

// ═══════════════════════════════════════════════════════════
// 子层路由表（ADR-065）
// ═══════════════════════════════════════════════════════════

const MOTION_FOLDER_ROUTES: Record<string, () => PopupLevel> = {
    'motion:camera': buildCameraLevel,
    'motion:playbackSpeed': buildPlaybackSpeedLevel,
    'motion:procmotion': buildProcMotionLevel,
    'motion:gaze': buildGazeTrackingLevel,
    'motion:poseStudio': buildPoseStudioLevel,
    'motion:retarget': buildRetargetLevel,
};

function motionOnFolderEnter(row: PopupRow): PopupLevel | null {
    const builder = MOTION_FOLDER_ROUTES[row.target as string];
    if (builder) {
        const lvl = builder();
        lvl.itemBuilder = () => builder().items;
        return lvl;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════
// 点击路由
// ═══════════════════════════════════════════════════════════

function motionOnItemClick(row: PopupRow): void {
    if (row.model) {
        // [doc:adr-131] 相机 VMD 加载入口
        const outcome = getMotionMenu()?.currentLevel?.outcome;
        if (row.model.format === 'vmd' && outcome?.mode === 'bindCameraVmd') {
            loadManager
                .load({ kind: 'camera-vmd', path: row.model.file_path })
                .then(() => {
                    const menu = getMotionMenu();
                    if (menu) {
                        menu.pop();
                        menu.reRender();
                    }
                })
                .catch((err) => {
                    logWarn('motion-popup', 'Load camera VMD failed:', err);
                    setStatus(t('motion.loadFailed'), false);
                });
            return;
        }
        // 场景级 VMD 加载（ADR-167：每次都加入场景库，不再 1+5 混合）
        if (row.model.format === 'vmd') {
            addSceneMotion({
                vmdPath: row.model.file_path,
                vmdName: row.model.name_jp || row.model.name_en || '',
                vmdLayers: [],
                source: 'vmd',
            });
            const menu = getMotionMenu();
            if (menu) {
                const root = menu.getLevel(0);
                if (root) {
                    root.items = buildMotionRootItems();
                }
                menu.pop();
            }
            return;
        }
        hideMotionPopup();
        if (row.model.format === 'audio') {
            loadManager.load({ kind: 'audio', path: row.model.file_path });
            setStatus(t('motion.musicLoaded', { name: getAudioName() }), true);
            if (getMotionMenu()) {
                getMotionMenu()?.reRender();
            }
            return;
        }
        if (row.model.format === 'vpd') {
            loadVPDPose(row.model.file_path);
            return;
        }
        return;
    }
    // per-model 动作绑定面板入口
    if (row.target && row.target.startsWith('action:binding:')) {
        const id = row.target.replace('action:binding:', '');
        resetFocusedLayerId();
        const lvl = buildActionBindingLevel(id);
        lvl.itemBuilder = () => buildActionBindingLevel(id).items;
        if (getMotionMenu()) {
            getMotionMenu()?.push(lvl);
        }
        return;
    }
    if (row.target && row.target.startsWith('procmotion:set-mode:')) {
        setProcMotionMode(row.target.replace('procmotion:set-mode:', '') as ProcMotionMode);
        regenerateProcMotion();
        return;
    }
    if (row.target === 'lipsync:toggle') {
        setLipSyncEnabled(!getLipSyncState().enabled);
        getMotionMenu()?.reRender();
        return;
    }
    // per-model 播放控制（委托到 motion-binding-ui）
    if (row.target && row.target.startsWith('action:motion:')) {
        const parts = row.target.split(':');
        const action = parts[2];
        const id = parts.slice(3).join(':');
        if (id) {
            handleModelAction(action, id);
        }
        return;
    }
    if (row.target === '__music_browse__') {
        const level = stackRegistry.buildLevel!(
            getBrowseDir('audio'),
            t('motion.musicLibrary'),
            (m) => m.format === 'audio',
            getMotionMenu() ?? undefined
        );
        if (getMotionMenu()) {
            getMotionMenu()?.push(level);
        }
        return;
    }
    // [doc:adr-129] 场景级动作库浏览
    if (row.target === '__scene_motion_browse__') {
        resetFocusedLayerId();
        const level = stackRegistry.buildLevel!(
            getBrowseDir('vmd'),
            t('motion.browseMotionLibrary'),
            (m) => m.format === 'vmd',
            getMotionMenu() ?? undefined,
            undefined,
            {
                mode: 'stay',
                onVmdPick: (path: string, name: string) => {
                    // [doc:adr-167] 每次选择都作为新主动作加入场景库（非 1+5 叠加）
                    const vmdName = name.replace(/\.vmd$/i, '');
                    addSceneMotion({
                        vmdPath: path,
                        vmdName,
                        vmdLayers: [],
                        source: 'vmd',
                    });
                    const menu = getMotionMenu();
                    if (menu) {
                        const root = menu.getLevel(0);
                        if (root) {
                            root.items = buildMotionRootItems();
                        }
                    }
                },
                onVmdReplace: (path: string, name: string) => {
                    const vmdName = name.replace(/\.vmd$/i, '');
                    replaceDefaultMotion({
                        vmdPath: path,
                        vmdName,
                        vmdLayers: [],
                        source: 'vmd',
                    });
                    const menu = getMotionMenu();
                    if (menu) {
                        const root = menu.getLevel(0);
                        if (root) {
                            root.items = buildMotionRootItems();
                        }
                    }
                },
            }
        );
        if (getMotionMenu()) {
            getMotionMenu()?.push(level);
        }
        return;
    }
    // [doc:adr-167] 动作详情入口：target 编码 sceneMotionId（__motion_detail__:<id>）
    if (row.target === '__motion_detail__' || row.target.startsWith('__motion_detail__:')) {
        const sceneMotionId = row.target.split(':')[1] || undefined;
        const lvl = buildMotionDetailLevel(sceneMotionId);
        lvl.itemBuilder = () => [];
        getMotionMenu()?.push(lvl);
        return;
    }
    // 清除场景级动作（ADR-167：清空整个场景库 + 默认动作）
    if (row.target === '__motion_clear__') {
        const snap = pushUndoSnapshot();
        clearAllSceneMotions();
        if (isPlaying && mmdRuntime) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        updatePlaybackUI();
        refreshMotionRoot();
        triggerAutoSave();
        setStatus(t('motion.motionCleared'), true);
        offerSceneUndoAndRefresh(t('motion.motionCleared'), snap, () => {
            refreshMotionRoot();
        });
        return;
    }
    if (row.target === '__retarget_mixamo__') {
        importExternalAnimation('mixamo');
        return;
    }
    if (row.target === '__retarget_vrm__') {
        importExternalAnimation('vrm');
        return;
    }
    if (row.target === '__retarget_custom__') {
        importExternalAnimation('custom');
        return;
    }
}
