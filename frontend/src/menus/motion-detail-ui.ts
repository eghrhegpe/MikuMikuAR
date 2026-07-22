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
import {
    buildModuleParamLevel,
    renderOverrideCard,
    renderPresetCard,
} from './motion-override-levels';
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
 * 拆分为多卡片：动作信息 / 图层 / 动作覆盖（核心）/ 动作预设 / 播放速度。
 * [doc:adr-116/125/145] 覆盖卡复用 renderOverrideCard（撤销/重做/历史/冲突 banner），
 * 预设卡复用 renderPresetCard——原死路由 motion:boneOverride 的沉没功能由此重新可达。
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
    const modelId = focusedModelId;

    const nodes: MenuNode[] = [
        // ── 卡片 1：当前主动作 ──
        {
            id: 'detail:info',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
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
                });
            },
        },
    ];

    // ── 卡片 2：该主动作内部的图层 ──
    // [doc:adr-170] 删除动作已移入动作工具页（buildMotionToolsLevel），
    // 详情页只保留图层与覆盖模块——对齐模型「详情 vs 工具」分层
    if (motion && motion.vmdLayers.length > 0) {
        nodes.push({
            id: 'detail:layers',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
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
                });
            },
        });
    }

    // ── 卡片 3：动作覆盖（核心）+ 卡片 4：动作预设 ──
    if (motion && modelId) {
        nodes.push({
            id: 'detail:override',
            kind: 'custom',
            renderCustom: (c) => {
                renderOverrideCard(c, modelId, {
                    onEnter: (modId) => getMotionMenu()?.push(buildModuleParamLevel(modId)),
                });
            },
        });
        nodes.push({
            id: 'detail:presets',
            kind: 'custom',
            renderCustom: (c) => {
                renderPresetCard(c, modelId);
            },
        });
    }

    // ── 卡片 5：播放速度 ──
    nodes.push({
        id: 'detail:speed',
        kind: 'custom',
        renderCustom: (c) => {
            cardContainer(c, (inner) => {
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
    });

    return nodes;
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

/**
 * [doc:adr-170] 动作工具页 level——对齐 buildModelToolsLevel 的「详情 vs 工具」分层：
 * 行点击进详情（图层/覆盖），行尾 settings-2 进工具页（低频破坏性操作）。
 * 删除动作带场景级撤销保护（pushUndoSnapshot + offerSceneUndoAndRefresh），无需确认弹窗。
 */
export function buildMotionToolsLevel(sceneMotionId: string): PopupLevel {
    const motion = getSceneMotions().find((m) => m.id === sceneMotionId);
    return {
        label: t('motion.motionTools'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (!motion) {
                    slideRow(c, 'lucide:circle-slash', t('motion.intent.none'), false, () => {});
                    return;
                }
                slideRow(
                    c,
                    'lucide:trash-2',
                    t('motion.deleteMotion'),
                    false,
                    () => {
                        const snap = pushUndoSnapshot();
                        const removedName = motion.vmdName;
                        removeSceneMotion(motion.id!);
                        updatePlaybackUI();
                        getMotionMenu()?.pop();
                        getMotionMenu()?.reRender();
                        triggerAutoSave();
                        setStatus(t('motion.motionRemoved', { name: removedName }), true);
                        offerSceneUndoAndRefresh(
                            t('motion.motionRemoved', { name: removedName }),
                            snap,
                            () => getMotionMenu()?.reRender()
                        );
                    },
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    { wrapLabel: true }
                );
            });
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
