// [doc:architecture] Motion Popup — 动作弹窗（barrel + 路由 + 入口注册）
// 拆分后保留: registerPopupMenu 注册 / MOTION_FOLDER_ROUTES / motionOnItemClick 路由
// 子文件: motion-binding-ui / motion-detail-ui / motion-root-ui

import type { PopupLevel, PopupRow } from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { registerLoadRefreshHook, registerLibraryScannedHook } from '../core/load-refresh-registry';
import { executeActionById } from '../core/action-executor';
import { registerMotionActions } from '../core/action-defs/motion-actions';
import { buildProcLibraryLevel } from './motion-procmotion-levels';
import { buildGazeTrackingLevel } from './motion-gaze-levels';
import { buildCameraLevel } from './motion-camera-levels';
import { buildPoseStudioLevel } from './motion-pose-levels';

// ── 子文件导入 ──
import { buildPlaybackSpeedLevel } from './motion-detail-ui';
import {
    buildMotionRootLevel,
    buildMotionRootItems,
    buildRetargetLevel,
    hideMotionPopup,
    openProcDetail,
} from './motion-root-ui';
import type { LoadableProcId } from '../scene/motion/motion-intent';

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

// [doc:P4] 加载模型后刷新根菜单 items（使动作列表等即时更新）
const _unregisterLoadRefresh = registerLoadRefreshHook(() => {
    if (getMotionMenu()) {
        refreshMotionRoot();
    }
});

// 库扫描完成时刷新菜单（通过注册表统一监听，替代独立 addDisposableListener）
const _unregisterLibraryScanned = registerLibraryScannedHook(() => getMotionMenu()?.reRender());

export { getMotionMenu, refreshMotionRoot, showMotionPopup };

// [doc:adr-238] 注册动作菜单操作供 core/action-defs 经 ui-action-bridge 调用
// [fix code_review P2] 保存 registerUiAction 返回的身份 token（fn 引用注销），
// dispose 只删本实例闭包，不误删后续替换模块的注册。
import { registerUiAction } from '@/core/ui-action-bridge';
const _unregisterGetMotionMenu = registerUiAction('getMotionMenu', () => getMotionMenu());
const _unregisterRefreshMotionRoot = registerUiAction('refreshMotionRoot', () => refreshMotionRoot());

/** 释放 motion-popup 模块资源（取消注册 hooks + UI actions + HMR/清理时调用） */
export function disposeMotionPopup(): void {
    _unregisterLoadRefresh();
    _unregisterLibraryScanned();
    // [fix P2] 注销本模块注册的 UI action（identity token，防闭包残留）。
    // 注：当前 disposeMotionPopup 尚无调用者（与 disposeEnvMenu/disposeSceneMenu
    // 一致，菜单 dispose 未接入 core/init _initCleanup）；此处为将来接线预留的
    // 正确清理语义，勿改回 delete-by-key（会误删替换模块注册）。
    _unregisterGetMotionMenu();
    _unregisterRefreshMotionRoot();
}

// ═══════════════════════════════════════════════════════════
// 子层路由表（ADR-065）
// ═══════════════════════════════════════════════════════════

const MOTION_FOLDER_ROUTES: Record<string, () => PopupLevel> = {
    'motion:camera': buildCameraLevel,
    'motion:playbackSpeed': buildPlaybackSpeedLevel,
    'motion:proc-library': buildProcLibraryLevel,
    'motion:gaze': buildGazeTrackingLevel,
    'motion:poseStudio': buildPoseStudioLevel,
    'motion:retarget': buildRetargetLevel,
};

function motionOnFolderEnter(row: PopupRow): PopupLevel | null {
    const builder = MOTION_FOLDER_ROUTES[row.target as string];
    if (builder) {
        const lvl = builder();
        if (!lvl.itemBuilder) {
            lvl.itemBuilder = () => builder().items;
        }
        return lvl;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════
// 点击路由
// ═══════════════════════════════════════════════════════════

// [doc:adr-155] 动作注册：由于 scene/motion 与其 action-defs 存在循环依赖，
// 不能在模块加载期顶层调用（此时 action-defs 依赖未初始化）。
// 改为首次点击时同步注册（则所有模块已就绪），同步 registerMotionActions
// 已完成后才 dispatch，既破环又消除异步竞态。
let _motionRegistered = false;

function _ensureMotionActions(): void {
    if (!_motionRegistered) {
        registerMotionActions();
        _motionRegistered = true;
    }
}

function motionOnItemClick(row: PopupRow): void {
    _ensureMotionActions();
    if (row.model) {
        const outcome = getMotionMenu()?.currentLevel?.outcome;
        if (row.model.format === 'vmd' && outcome?.mode === 'bindCameraVmd') {
            void executeActionById('motion:load-camera-vmd', { path: row.model.file_path });
            return;
        }
        if (row.model.format === 'vmd') {
            void executeActionById('motion:add-scene-vmd', {
                path: row.model.file_path,
                name:
                    row.model.file_path
                        .split(/[/\\]/)
                        .pop()
                        ?.replace(/\.\w+$/, '') || '',
            });
            return;
        }
        hideMotionPopup();
        if (row.model.format === 'audio') {
            void executeActionById('motion:load-audio', { path: row.model.file_path });
            return;
        }
        if (row.model.format === 'vpd') {
            void executeActionById('motion:load-vpd', { path: row.model.file_path });
            return;
        }
        return;
    }
    if (row.target && row.target.startsWith('action:binding:')) {
        void executeActionById('motion:open-binding', {
            modelId: row.target.replace('action:binding:', ''),
        });
        return;
    }
    if (row.target && row.target.startsWith('procmotion:set-mode:')) {
        void executeActionById('motion:procmotion:set-mode', {
            mode: row.target.replace('procmotion:set-mode:', ''),
        });
        return;
    }
    if (row.target === 'lipsync:toggle') {
        void executeActionById('motion:lipsync:toggle', {});
        getMotionMenu()?.reRender();
        return;
    }
    // per-model 播放控制（委托到注册表）
    if (row.target && row.target.startsWith('action:motion:')) {
        const parts = row.target.split(':');
        const action = parts[2];
        const id = parts.slice(3).join(':');
        if (id) {
            void executeActionById(`motion:model:${action}`, { modelId: id });
        }
        return;
    }
    if (row.target === '__music_browse__') {
        void executeActionById('motion:browse-music', {});
        return;
    }
    if (row.target === '__scene_motion_browse__') {
        void executeActionById('motion:browse-scene-motions', {});
        return;
    }
    if (row.target === '__motion_detail__' || row.target.startsWith('__motion_detail__:')) {
        void executeActionById('motion:open-detail', {
            sceneMotionId: row.target.split(':')[1] || undefined,
        });
        return;
    }
    // [audit] proc 行体点击：激活并进入程序化统一详情页（与 VMD 行体点击进详情对齐）
    if (row.target && row.target.startsWith('__proc_detail__:')) {
        const procId = row.target.split(':')[1] as LoadableProcId;
        if (procId) {
            openProcDetail(procId);
        }
        return;
    }
    // 清除场景级动作（ADR-167：清空整个场景库 + 默认动作）
    if (row.target === '__motion_clear__') {
        void executeActionById('motion:clear-all', {});
        return;
    }
    if (row.target === '__retarget_mixamo__') {
        void executeActionById('motion:retarget:mixamo', {});
        return;
    }
    if (row.target === '__retarget_vrm__') {
        void executeActionById('motion:retarget:vrm', {});
        return;
    }
    if (row.target === '__retarget_custom__') {
        void executeActionById('motion:retarget:custom', {});
        return;
    }
}