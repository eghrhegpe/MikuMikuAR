// [doc:architecture] Motion Root UI — 根菜单构建 + 外部动作导入
// 从 motion-popup.ts 拆出：buildMotionRootItems / buildMotionRootLevel /
// buildRetargetLevel / _importExternalAnimation

import {
    setStatus,
    isPlaying,
    setIsPlaying,
    mmdRuntime,
    stackRegistry,
    getBrowseDir,
    closeAllOverlays,
} from '../core/config';
import type { PopupLevel, PopupRow } from '../core/config';
import { modelManager, updatePlaybackUI, triggerAutoSave, pushUndoSnapshot, offerSceneUndoAndRefresh } from '../scene/scene';
import { getActiveMotion, setActiveMotion } from '../scene/motion/motion-intent';
import { getProcMotionState } from '../scene/scene';
import { clearAudio, getAudioName } from '../outfit/audio';
import { t } from '../core/i18n/t';
import { logWarn } from '../core/logger';
import { SelectImportFile } from '../core/wails-bindings';
import {
    loadAndRetargetAnimation,
    playRetargetedAnimation,
} from '../scene/motion/animation-retargeter';
import { DEFAULT_MOTION_SLOTS } from './motion-binding-ui';
import type { ModelMotionSlots } from '@/core/types';
// 循环依赖安全：getMotionMenu 仅在函数体内调用
import { getMotionMenu } from './motion-popup';
import { buildLayerLevel } from './motion-detail-ui';

// ═══════════════════════════════════════════════════════════
// 根菜单构建
// ═══════════════════════════════════════════════════════════

/** 构建当前动作源显示标签（VMD 或程序化动作） */
function _buildCurrentMotionLabel(): { label: string; icon: string } {
    const active = getActiveMotion();
    if (active?.vmdName) {
        return { label: active.vmdName, icon: 'lucide:clapperboard' };
    }
    const procState = getProcMotionState();
    if (procState.mode !== 'off') {
        const modeLabel =
            procState.mode === 'idle' ? t('motion.modeIdle') : t('motion.modeAutodance');
        return { label: modeLabel, icon: 'lucide:wind' };
    }
    return { label: t('motion.noMotionHint'), icon: 'lucide:circle-slash' };
}

export function buildMotionRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    const { label: motionLabel, icon: motionIcon } = _buildCurrentMotionLabel();

    // ===== Card 1: 当前动作（场景级）+ 图层管理 =====
    const active = getActiveMotion();
    const procState = getProcMotionState();
    const hasMotion = !!active?.vmdName || procState.mode !== 'off';

    if (hasMotion && active) {
        items.push({
            kind: 'action',
            label: motionLabel,
            icon: motionIcon,
            target: '__motion_detail__',
            sublabel: t('motion.currentMotion'),
            wrapLabel: true,
            trailing: {
                icon: 'lucide:trash-2',
                title: t('motion.clearVmd'),
                danger: true,
                onClick: () => {
                    const snap = pushUndoSnapshot();
                    setActiveMotion(null);
                    if (isPlaying && mmdRuntime) {
                        mmdRuntime.pauseAnimation();
                        setIsPlaying(false);
                    }
                    updatePlaybackUI();
                    getMotionMenu()?.reRender();
                    triggerAutoSave();
                    setStatus(t('motion.motionCleared'), true);
                    offerSceneUndoAndRefresh(t('motion.motionCleared'), snap, () => {
                        getMotionMenu()?.reRender();
                    });
                },
            },
        });
        // 场景级图层列表（内联显示）
        for (const layer of active.vmdLayers) {
            items.push({
                kind: 'action',
                label: layer.name,
                icon: 'lucide:layers',
                target: '',
                sublabel: `${(layer.weight * 100).toFixed(0)}%`,
                trailing: {
                    icon: 'lucide:settings-2',
                    title: t('library.modelTools'),
                    onClick: () => {
                        const foc = modelManager.focused();
                        const targetId =
                            foc?.id ??
                            [...modelManager.modelRegistry.values()].find((m) => m.kind === 'actor')
                                ?.id ??
                            '';
                        const lvl = buildLayerLevel(layer.id, targetId);
                        getMotionMenu()?.push(lvl);
                    },
                },
            });
        }
    } else {
        items.push({
            kind: 'action',
            label: motionLabel,
            icon: motionIcon,
            target: '',
            sublabel: t('motion.noMotionHint'),
            wrapLabel: true,
        });
    }

    // ===== Card 2: 库 =====
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'action',
        label: t('motion.browseMotionLibrary'),
        icon: 'lucide:folder-search',
        target: '__scene_motion_browse__',
    });
    items.push({
        kind: 'action',
        label: getAudioName() || t('motion.browseMusic'),
        icon: 'lucide:music',
        target: '__music_browse__',
        sublabel: getAudioName() ? t('motion.musicLibrary') : undefined,
        wrapLabel: true,
        trailing: getAudioName()
            ? {
                  icon: 'lucide:trash-2',
                  title: t('motion.removeMusic'),
                  danger: true,
                  onClick: () => {
                      const snap = pushUndoSnapshot();
                      clearAudio();
                      getMotionMenu()?.reRender();
                      setStatus(t('motion.musicRemoved'), true);
                      offerSceneUndoAndRefresh(t('motion.musicRemoved'), snap, () => {
                          getMotionMenu()?.reRender();
                      });
                  },
              }
            : undefined,
    });

    // ===== Card 3: 场景工具 =====
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'folder',
        label: t('motion.camera'),
        icon: 'lucide:video',
        target: 'motion:camera',
    });
    items.push({
        kind: 'folder',
        label: t('motion.poseStudio.title'),
        icon: 'lucide:camera',
        target: 'motion:poseStudio',
    });
    items.push({
        kind: 'folder',
        label: t('motion.gazeTracking'),
        icon: 'lucide:eye',
        target: 'motion:gaze',
    });
    if (modelManager.size > 0) {
        items.push({
            kind: 'folder',
            label: t('motion.externalImport'),
            icon: 'lucide:upload',
            target: 'motion:retarget',
        });
    }
    return items;
}

/** 构建 per-model 角色状态子标签 */
function _buildActorSublabel(inst: {
    vmdName?: string;
    motionSlots?: ModelMotionSlots;
}): string | undefined {
    const slots = inst.motionSlots ?? DEFAULT_MOTION_SLOTS;
    if (slots.primary.status === 'incompatible') {
        return t('motion.intent.incompatible');
    }
    if (slots.primary.source === 'pinned') {
        const name = inst.vmdName || slots.primary.pinned?.vmdName || '?';
        return t('motion.pinnedFmt', { name });
    }
    const active = getActiveMotion();
    if (active && active.vmdPath) {
        return t('motion.followGlobal');
    }
    return inst.vmdName || undefined;
}

export function buildMotionRootLevel(): PopupLevel {
    return {
        label: t('motion.title'),
        dir: '',
        items: buildMotionRootItems(),
        itemBuilder: () => buildMotionRootItems(),
    };
}

export function hideMotionPopup(): void {
    closeAllOverlays();
}

// ═══════════════════════════════════════════════════════════
// 外部动作导入（Retarget）
// ═══════════════════════════════════════════════════════════

export function buildRetargetLevel(): PopupLevel {
    return {
        label: t('motion.retarget.title'),
        dir: '',
        items: [
            {
                kind: 'action',
                label: t('motion.retarget.mixamo'),
                icon: 'lucide:user',
                target: '__retarget_mixamo__',
                sublabel: t('motion.retarget.mixamoHint'),
            },
            {
                kind: 'action',
                label: t('motion.retarget.vrm'),
                icon: 'lucide:user',
                target: '__retarget_vrm__',
                sublabel: t('motion.retarget.vrmHint'),
            },
            {
                kind: 'action',
                label: t('motion.retarget.customMap'),
                icon: 'lucide:edit',
                target: '__retarget_custom__',
                sublabel: t('motion.retarget.customHint'),
            },
        ],
    };
}

/** 外部动作导入：选文件 → 重定向骨骼 → 播放。 */
export async function importExternalAnimation(
    preset: 'mixamo' | 'vrm' | 'custom' = 'mixamo'
): Promise<void> {
    let path: string;
    try {
        path = await SelectImportFile();
    } catch {
        return; // 用户取消
    }
    if (!path) {
        return;
    }

    const foc = modelManager.focused();
    if (!foc || !foc.mmdModel) {
        setStatus(t('motion.retarget.noModel'), false);
        return;
    }

    const mesh = foc.mmdModel.mesh;
    if (!mesh || !mesh.skeleton) {
        setStatus(t('motion.retarget.noBones'), false);
        return;
    }

    const scene = mesh.getScene();
    const result = await loadAndRetargetAnimation(scene, path, mesh.skeleton, preset);
    if (!result) {
        return;
    }

    closeAllOverlays();
    playRetargetedAnimation(scene, result);
    setStatus(t('motion.retarget.loaded', { preset }), true);
}
