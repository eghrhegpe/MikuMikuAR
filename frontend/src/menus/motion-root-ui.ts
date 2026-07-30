// [doc:architecture] Motion Root UI — 根菜单构建 + 外部动作导入
// 从 motion-popup.ts 拆出：buildMotionRootItems / buildMotionRootLevel /
// buildRetargetLevel / _importExternalAnimation

import { closeAllOverlays } from '../core/config';
import type { PopupLevel, PopupRow } from '../core/config';
import { feedbackInfo, feedbackStatus } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import {
    modelManager,
    triggerAutoSave,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
    getProcMotionState,
    setProcMotionMode,
    regenerateProcMotion,
} from '../scene/scene';
import type { ProcMotionMode } from '../motion-algos/procedural-motion';
import {
    getActiveMotion,
    getSceneMotions,
    getActiveMotionId,
    setDefaultMotion,
    getLoadedProceduralMotions,
} from '../scene/motion/motion-intent';
import type { LoadableProcId } from '../scene/motion/motion-intent';
// [doc:adr-170] 行尾「动作工具」推进独立工具页；循环依赖安全：仅在函数体内调用
import { buildMotionToolsLevel } from './motion-detail-ui';
import { clearAudio, getAudioName } from '../outfit/audio';
import { t } from '../core/i18n/t';
import { SelectRetargetFile } from '../core/wails-bindings';
import {
    loadAndRetargetAnimation,
    playRetargetedAnimation,
} from '../scene/motion/animation-retargeter';
import { DEFAULT_MOTION_SLOTS } from './motion-binding-ui';
import type { ModelMotionSlots } from '@/core/types';
// 循环依赖安全：getMotionMenu 仅在函数体内调用
import { getMotionMenu } from './motion-popup';

// ═══════════════════════════════════════════════════════════
// 根菜单构建
// ═══════════════════════════════════════════════════════════

export function buildMotionRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    const sceneMotions = getSceneMotions();
    const activeId = getActiveMotionId();

    // ===== [doc:adr-207] Section 1: 已加载动作 =====
    items.push({
        kind: 'sectionTitle',
        label: t('motion.section.loadedMotion'),
        icon: '',
        target: '',
    });
    if (sceneMotions.length === 0) {
        // 空提示行（非交互，仅告知用户从动作库加载）
        items.push({
            kind: 'action',
            label: t('motion.section.loadedMotionEmpty'),
            icon: 'lucide:inbox',
            target: '',
            wrapLabel: true,
        });
    } else {
        for (const motion of sceneMotions) {
            // [doc:adr-170] 选中范式：行首 check-circle「选中」，行尾 settings-2「动作工具」
            const isSelected = motion.id === activeId;
            const radioIcon = isSelected ? 'lucide:check-circle' : 'lucide:circle';
            items.push({
                kind: 'action',
                label: motion.vmdName || t('motion.intent.none'),
                icon: radioIcon,
                target: `__motion_detail__:${motion.id ?? ''}`,
                sublabel: isSelected ? t('motion.defaultMotion') : undefined,
                wrapLabel: true,
                rowKey: 'motion:' + (motion.id ?? '') + (isSelected ? ':on' : ':off'),
                leading: {
                    icon: radioIcon,
                    title: t('motion.selectMotion'),
                    onClick: () => {
                        if (!motion.id || motion.id === activeId) {
                            return;
                        }
                        const snap = pushUndoSnapshot();
                        setDefaultMotion(motion.id);
                        // [doc:adr-207] 单一指针互斥：VMD 设为默认时清空程序化 mode，
                        // 避免程序化区残留旧选中态（'off' ↔ 'none'）。
                        setProcMotionMode('off');
                        getMotionMenu()?.reRender();
                        triggerAutoSave();
                        showInfoToast(t('motion.defaultMotionSet', { name: motion.vmdName }));
                        offerSceneUndoAndRefresh(
                            t('motion.defaultMotionSet', { name: motion.vmdName }),
                            snap,
                            () => getMotionMenu()?.reRender()
                        );
                    },
                },
                trailing: {
                    icon: 'lucide:settings-2',
                    title: t('motion.motionTools'),
                    onClick: () => {
                        if (!motion.id) {
                            return;
                        }
                        getMotionMenu()?.push(buildMotionToolsLevel(motion.id));
                    },
                },
            });
        }
    }

    // ===== [doc:adr-207] Section 2: 已加载程序化动作（集合驱动 + 选中语义） =====
    // [doc:adr-207] 用 divider 划分 lcard 边界，使各功能区独立成卡（section-title 作为卡片头）
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'sectionTitle',
        label: t('motion.section.loadedProc'),
        icon: '',
        target: '',
    });
    const loadedProc = getLoadedProceduralMotions();
    // [doc:adr-207] 跨两区选中互斥：场景默认是唯一指针。VMD 默认（activeId 非空）存在时，
    // 程序化区一律不显选中——'off'/'none' 只在「无 VMD 默认」时才是真正的场景默认。
    const curProcMode = getProcMotionState().mode;
    const hasVmdDefault = activeId != null;
    for (const procId of loadedProc) {
        const mode = _procIdToMode(procId);
        const isSelected = !hasVmdDefault && mode === curProcMode;
        const radioIcon = isSelected ? 'lucide:check-circle' : 'lucide:circle';
        const isNone = procId === 'none';
        items.push({
            kind: 'action',
            label: _procLabel(procId),
            icon: radioIcon,
            target: '',
            sublabel: isSelected ? t('motion.defaultMotion') : undefined,
            rowKey: 'proc:' + procId + (isSelected ? ':on' : ':off'),
            leading: {
                icon: radioIcon,
                title: t('motion.selectMotion'),
                onClick: () => {
                    if (isSelected) {
                        return;
                    }
                    const snap = pushUndoSnapshot();
                    // [doc:adr-207] 单一指针互斥：选中程序化行须清除 VMD 默认，
                    // 否则 activeId 残留使程序化选中态被 hasVmdDefault 压制、视觉跳回 VMD。
                    setDefaultMotion(null);
                    setProcMotionMode(mode);
                    regenerateProcMotion();
                    getMotionMenu()?.reRender();
                    triggerAutoSave();
                    const name = _procLabel(procId);
                    showInfoToast(t('motion.defaultMotionSet', { name }));
                    offerSceneUndoAndRefresh(
                        t('motion.defaultMotionSet', { name }),
                        snap,
                        () => getMotionMenu()?.reRender()
                    );
                },
            },
            // 'none'（无动作）无参数可调，不提供设置页入口
            trailing: isNone
                ? undefined
                : {
                      icon: 'lucide:settings-2',
                      title: t('motion.motionTools'),
                      onClick: () => {
                          // 循环依赖安全：函数体内动态引入 buildProcMotionLevel
                          void import('./motion-procmotion-levels').then((m) => {
                              getMotionMenu()?.push(m.buildProcMotionLevel());
                          });
                      },
                  },
        });
    }

    // ===== [doc:adr-207] Section 3: 动作库 =====
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'sectionTitle',
        label: t('motion.section.library'),
        icon: '',
        target: '',
    });
    items.push({
        kind: 'action',
        label: t('motion.browseMotionLibrary'),
        icon: 'lucide:folder-search',
        target: '__scene_motion_browse__',
    });
    // [doc:adr-207] 程序化动作子页入口
    items.push({
        kind: 'folder',
        label: t('motion.procMotion'),
        icon: 'lucide:wand-sparkles',
        target: 'motion:proc-library',
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
                      feedbackInfo('motion.musicRemoved', undefined);
                      offerSceneUndoAndRefresh(t('motion.musicRemoved'), snap, () => {
                          getMotionMenu()?.reRender();
                      });
                  },
              }
            : undefined,
    });

    // ===== [doc:adr-207] Section 4: 更多（正交工具） =====
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'sectionTitle',
        label: t('motion.section.more'),
        icon: '',
        target: '',
    });
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

/** [doc:adr-207] 程序化动作 ID → 显示名 */
function _procLabel(id: LoadableProcId): string {
    switch (id) {
        case 'none':
            return t('motion.proc.none');
        case 'idle':
            return t('motion.modeIdle');
        case 'autodance':
            return t('motion.modeAutodance');
    }
}

/** [doc:adr-207] 程序化动作 ID → 全局 ProcMotionState.mode（'none' ↔ 'off'） */
function _procIdToMode(id: LoadableProcId): ProcMotionMode {
    return id === 'none' ? 'off' : id;
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
        path = await SelectRetargetFile();
    } catch {
        return; // 用户取消
    }
    if (!path) {
        return;
    }

    const foc = modelManager.focused();
    if (!foc || !foc.mmdModel) {
        feedbackStatus('motion.retarget.noModel', undefined, false);
        return;
    }

    const mesh = foc.mmdModel.mesh;
    if (!mesh || !mesh.skeleton) {
        feedbackStatus('motion.retarget.noBones', undefined, false);
        return;
    }

    const scene = mesh.getScene();
    const result = await loadAndRetargetAnimation(scene, path, mesh.skeleton, preset);
    if (!result) {
        return;
    }

    closeAllOverlays();
    playRetargetedAnimation(scene, result, path);
    showInfoToast(t('motion.retarget.loaded', { preset }));
}
