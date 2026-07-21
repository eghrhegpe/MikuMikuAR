// [doc:architecture] Motion Detail UI — 动作详情页 + 图层管理 + 播放速度
// 从 motion-popup.ts 拆出：buildLayerLevel / buildMotionDetailSchema /
// buildMotionDetailLevel / 播放速度 / buildPlaybackSpeedLevel

import { setStatus, mmdRuntime, cardContainer, focusedModelId } from '../core/config';
import type { PopupLevel } from '../core/config';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addSectionTitle,
    addPresetChip,
} from '../core/ui-helpers';
import {
    modelManager,
    updatePlaybackUI,
    triggerAutoSave,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
} from '../scene/scene';
import {
    getVmdLayers,
    toggleVmdLayer,
    setVmdLayerWeight,
    removeVmdLayer,
} from '../scene/motion/vmd-layers';
import { getActiveMotion, getSceneMotions, removeSceneMotion } from '../scene/motion/motion-intent';
import { t } from '../core/i18n/t';
import type { MenuNode } from './menu-schema';
import { renderMenu } from './render-menu';
import { createIconifyIcon } from '../core/icons';
import { undo, redo, canUndo, canRedo } from '../scene/motion/motion-modules/motion-history';
import { applyModuleSnapshot } from '../scene/motion/motion-modules/module-base';
import { renderModuleToggleList } from './motion-binding-ui';
import { buildModuleParamLevel, buildAdvancedBoneOverrideLevel } from './motion-override-levels';
// 循环依赖安全：getMotionMenu 仅在函数体内调用
import { getMotionMenu } from './motion-popup';

// ═══════════════════════════════════════════════════════════
// 图层次级菜单
// ═══════════════════════════════════════════════════════════

/** 单图层次级菜单：启用开关 / 权重滑块 / 删除。 */
export function buildLayerLevel(layerId: string, id: string): PopupLevel {
    return {
        label: t('motion.layerSettings'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const layer = getVmdLayers(id).find((l) => l.id === layerId);
            if (!layer) {
                return;
            }
            const schema: MenuNode[] = [
                {
                    id: 'layer:enable',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            addToggleRow(
                                inner,
                                t('motion.enable'),
                                layer.enabled,
                                () => {
                                    toggleVmdLayer(layerId, id);
                                    getMotionMenu()?.reRender();
                                },
                                'lucide:eye',
                                {
                                    bind: () =>
                                        getVmdLayers(id).find((l) => l.id === layerId)?.enabled ??
                                        false,
                                }
                            );
                        });
                    },
                },
                {
                    id: 'layer:weight',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            addSliderRow(
                                inner,
                                t('motion.weight'),
                                layer.weight,
                                0,
                                1,
                                0.05,
                                (v) => setVmdLayerWeight(layerId, v, id),
                                'lucide:sliders-horizontal'
                            );
                        });
                    },
                },
                {
                    id: 'layer:delete',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            slideRow(
                                inner,
                                'lucide:trash-2',
                                t('motion.deleteLayer'),
                                false,
                                () => {
                                    const snap = pushUndoSnapshot();
                                    removeVmdLayer(layerId, id);
                                    triggerAutoSave();
                                    getMotionMenu()?.pop();
                                    getMotionMenu()?.reRender();
                                    offerSceneUndoAndRefresh(t('motion.deleteLayer'), snap, () => {
                                        getMotionMenu()?.reRender();
                                    });
                                },
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                { variant: 'danger' }
                            );
                        });
                    },
                },
            ];
            renderMenu(schema, container);
        },
    };
}

// ═══════════════════════════════════════════════════════════
// 动作详情页（ADR-129 Phase 2）
// ═══════════════════════════════════════════════════════════

/**
 * [doc:adr-167] 动作详情子页 schema——某个主动作的统一管理入口。
 * 整合：动作名 + 删除 / 内部图层管理 / 动作覆盖模块 / 播放速度。
 * @param sceneMotionId 指定主动作 id；undefined 时回退到当前默认动作（兼容旧调用）
 */
function buildMotionDetailSchema(sceneMotionId?: string): MenuNode[] {
    // [doc:adr-167] 按 id 解析指定主动作；未传或找不到则回退到默认动作
    const sceneMotions = getSceneMotions();
    const active = getActiveMotion();
    const motion = sceneMotionId
        ? (sceneMotions.find((m) => m.id === sceneMotionId) ?? active)
        : active;
    const foc = modelManager.focused();
    const target =
        foc ?? [...modelManager.modelRegistry.values()].find((m) => m.kind === 'actor') ?? null;

    return [
        {
            id: 'detail:main',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    // ── 当前主动作 ──
                    addSectionTitle(inner, t('motion.currentMotion'));
                    slideRow(
                        inner,
                        motion ? 'lucide:clapperboard' : 'lucide:circle-slash',
                        motion?.vmdName || t('motion.intent.none'),
                        false,
                        () => {},
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        { wrapLabel: true }
                    );
                    // [doc:adr-167] 删除此主动作（仅删除场景库中的这一项，不影响其他主动作）
                    if (motion?.id) {
                        addPresetChip(inner, t('motion.deleteMotion'), false, () => {
                            const snap = pushUndoSnapshot();
                            removeSceneMotion(motion.id!);
                            updatePlaybackUI();
                            getMotionMenu()?.pop();
                            getMotionMenu()?.reRender();
                            triggerAutoSave();
                            setStatus(t('motion.motionRemoved', { name: motion.vmdName }), true);
                            offerSceneUndoAndRefresh(
                                t('motion.motionRemoved', { name: motion.vmdName }),
                                snap,
                                () => getMotionMenu()?.reRender()
                            );
                        });
                    }

                    // ── 该主动作内部的图层 ──
                    if (motion && motion.vmdLayers.length > 0) {
                        addSectionTitle(inner, t('motion.layerSettings'));
                        for (const layer of motion.vmdLayers) {
                            slideRow(
                                inner,
                                '',
                                layer.name,
                                false,
                                () => {
                                    const lvl = buildLayerLevel(layer.id, target?.id ?? '');
                                    getMotionMenu()?.push(lvl);
                                },
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                {
                                    wrapLabel: true,
                                    trailing: {
                                        icon: 'lucide:settings-2',
                                        title: t('library.modelTools'),
                                        onClick: () => {
                                            const lvl = buildLayerLevel(layer.id, target?.id ?? '');
                                            getMotionMenu()?.push(lvl);
                                        },
                                    },
                                }
                            );
                        }
                    }

                    // ── 动作覆盖（模块列表） ──
                    if (motion) {
                        const modelId = focusedModelId;
                        if (modelId) {
                            addSectionTitle(inner, t('motion.override.title'));

                            // 撤销/重做
                            const btnGroup = document.createElement('div');
                            btnGroup.style.cssText = 'display:flex;gap:4px;padding:0 0 4px;';

                            const undoBtn = document.createElement('button');
                            undoBtn.className = 'slide-action';
                            const undoIcon = createIconifyIcon('lucide:undo-2');
                            if (undoIcon) {
                                undoBtn.appendChild(undoIcon);
                            }
                            undoBtn.title = 'Ctrl+Z';
                            undoBtn.style.opacity = canUndo(modelId) ? '1' : '0.3';
                            undoBtn.style.pointerEvents = canUndo(modelId) ? 'auto' : 'none';
                            undoBtn.addEventListener('click', () => {
                                if (!canUndo(modelId)) {
                                    return;
                                }
                                const applier = (
                                    snap: Record<
                                        string,
                                        {
                                            enabled: boolean;
                                            params: Record<
                                                string,
                                                import('@/core/types').ParamValue
                                            >;
                                        }
                                    >
                                ) => {
                                    applyModuleSnapshot(modelId, snap);
                                };
                                undo(modelId, applier);
                                setStatus(t('motion.undoApplied'), true);
                                getMotionMenu()?.reRender();
                            });
                            btnGroup.appendChild(undoBtn);

                            const redoBtn = document.createElement('button');
                            redoBtn.className = 'slide-action';
                            const redoIcon = createIconifyIcon('lucide:redo-2');
                            if (redoIcon) {
                                redoBtn.appendChild(redoIcon);
                            }
                            redoBtn.title = 'Ctrl+Shift+Z';
                            redoBtn.style.opacity = canRedo(modelId) ? '1' : '0.3';
                            redoBtn.style.pointerEvents = canRedo(modelId) ? 'auto' : 'none';
                            redoBtn.addEventListener('click', () => {
                                if (!canRedo(modelId)) {
                                    return;
                                }
                                const applier = (
                                    snap: Record<
                                        string,
                                        {
                                            enabled: boolean;
                                            params: Record<
                                                string,
                                                import('@/core/types').ParamValue
                                            >;
                                        }
                                    >
                                ) => {
                                    applyModuleSnapshot(modelId, snap);
                                };
                                redo(modelId, applier);
                                setStatus(t('motion.override.redoApplied'), true);
                                getMotionMenu()?.reRender();
                            });
                            btnGroup.appendChild(redoBtn);

                            inner.appendChild(btnGroup);

                            // 模块列表
                            renderModuleToggleList(inner, modelId, {
                                initModules: true,
                                onEnter: (modId) =>
                                    getMotionMenu()?.push(buildModuleParamLevel(modId)),
                            });

                            // 高级骨骼覆盖入口
                            slideRow(
                                inner,
                                'tabler:bone',
                                t('motion.boneOverride.title'),
                                true,
                                () => {
                                    getMotionMenu()?.push(buildAdvancedBoneOverrideLevel());
                                }
                            );
                        }
                    }

                    // ── 播放速度 ──
                    addSectionTitle(inner, t('motion.playbackSpeed'));
                    addSliderRow(
                        inner,
                        t('motion.playbackSpeed'),
                        _playbackSpeed,
                        0.1,
                        2.0,
                        0.05,
                        (v) => {
                            _playbackSpeed = v;
                            if (mmdRuntime) {
                                mmdRuntime.timeScale = v;
                            }
                        },
                        'lucide:gauge'
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

/**
 * [doc:adr-167] 构建动作详情页 level。
 * @param sceneMotionId 主动作 id；undefined 时回退到当前默认动作
 */
export function buildMotionDetailLevel(sceneMotionId?: string): PopupLevel {
    return {
        label: t('motion.detail.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMotionDetailSchema(sceneMotionId), container);
        },
    };
}

// ═══════════════════════════════════════════════════════════
// 播放速度（VMD timeScale）
// ═══════════════════════════════════════════════════════════

let _playbackSpeed = 1.0;

/** 将记忆中的播放速度同步到新的 mmdRuntime 实例（防状态漂移）。 */
export function syncPlaybackSpeedToRuntime(runtime: { timeScale: number }): void {
    runtime.timeScale = _playbackSpeed;
}

function buildPlaybackSpeedSchema(): MenuNode[] {
    return [
        {
            id: 'playbackSpeed:slider',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSliderRow(
                        inner,
                        t('motion.playbackSpeed'),
                        _playbackSpeed,
                        0.1,
                        2.0,
                        0.05,
                        (v) => {
                            _playbackSpeed = v;
                            if (mmdRuntime) {
                                mmdRuntime.timeScale = v;
                            }
                        },
                        'lucide:gauge'
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildPlaybackSpeedLevel(): PopupLevel {
    return {
        label: t('motion.playbackSpeed'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildPlaybackSpeedSchema(), container);
        },
    };
}
