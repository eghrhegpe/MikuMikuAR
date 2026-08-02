// [doc:architecture] Motion Detail UI — 动作详情页 + 图层管理 + 播放速度
// 从 motion-popup.ts 拆出：buildLayerLevel / buildMotionDetailSchema /
// buildMotionDetailLevel / 播放速度 / buildPlaybackSpeedLevel

import { mmdRuntime, cardContainer, focusedModelId, stackRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addToggleRow, addSliderRow, addSectionTitle } from '../core/ui-helpers';
import {
    modelManager,
    updatePlaybackUI,
    triggerAutoSave,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
    getProcMotionState,
} from '../scene/scene';
import {
    getVmdLayers,
    toggleVmdLayer,
    setVmdLayerWeight,
    removeVmdLayer,
} from '../scene/motion/vmd-layers';
import {
    getActiveMotion,
    getSceneMotions,
    removeSceneMotion,
} from '../scene/motion/motion-intent';
import type { LoadableProcId } from '../scene/motion/motion-intent';
import { showInfoToast } from '../core/toast';
import { t } from '../core/i18n/t';
import type { MenuNode } from './menu-schema';
import { renderMenu } from './render-menu';
import {
    buildModuleParamLevel,
    renderOverrideCard,
    renderPresetCard,
} from './motion-override-levels';
import { buildProcMotionSchema, procLabel } from './motion-procmotion-levels';
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
            return renderMenu(schema, container);
        },
    };
}

// ═══════════════════════════════════════════════════════════
// 动作详情页（ADR-129 Phase 2）
// ═══════════════════════════════════════════════════════════

/**
 * [doc:adr-167] 动作详情子页 schema——某个主动作的统一管理入口。
 * 拆分为多卡片：动作信息 / 播放速度 / 图层 / 动作覆盖（核心）/ 动作预设。
 * [doc:adr-116/125/145] 覆盖卡复用 renderOverrideCard（撤销/重做/历史/冲突 banner），
 * 预设卡复用 renderPresetCard——原死路由 motion:boneOverride 的沉没功能由此重新可达。
 * @param sceneMotionId 指定主动作 id；undefined 时回退到当前默认动作（兼容旧调用）
 * @param modelIdOverride 覆盖/预设按该模型存储（供模型面板 per-model 编辑）
 * @param procId 指定查看的程序化动作 id；即使该 proc 未激活也强制展示程序化卡片（行体点击查看）
 */
function buildMotionDetailSchema(
    sceneMotionId?: string,
    modelIdOverride?: string,
    procId?: LoadableProcId
): MenuNode[] {
    // [doc:adr-167] 按 id 解析指定主动作；未传或找不到则回退到默认动作
    const sceneMotions = getSceneMotions();
    const active = getActiveMotion();
    const motion = sceneMotionId
        ? (sceneMotions.find((m) => m.id === sceneMotionId) ?? active)
        : active;
    const foc = modelManager.focused();
    const target =
        foc ?? [...modelManager.modelRegistry.values()].find((m) => m.kind === 'actor') ?? null;
    const modelId = modelIdOverride ?? focusedModelId;
    // [doc:adr-207] 程序化动作与 VMD 互斥：proc mode 非 off 即视为程序化当前生效，
    // 统一详情页据此显示程序化名 + 追加参数卡（覆盖/预设本就 model-scoped，始终可达）。
    const procState = getProcMotionState();
    const procActive = procState.mode !== 'off';
    const procLabelId: LoadableProcId =
        procState.mode === 'off' ? 'none' : (procState.mode as LoadableProcId);
    // [audit-fix] 行体点击仅查看：procId 指定「查看哪个程序化动作」，未激活时也强制展示程序化卡片，
    // 但不改变选中态、不打断当前播放。
    const viewingProc = procId != null;
    const viewingInactiveProc = viewingProc && !procActive;
    const currentIcon =
        procActive || viewingProc ? 'lucide:wand-sparkles' : motion ? 'lucide:clapperboard' : 'lucide:circle-slash';
    const currentLabel = viewingInactiveProc
        ? procLabel(procId!)
        : procActive
          ? procLabel(procLabelId)
          : motion?.vmdName || t('motion.intent.none');
    const currentSublabel = viewingInactiveProc ? t('motion.procNotActive') : undefined;

    // [audit] 覆盖/预设按模型存储，运行时仅对聚焦模型生效；经模型面板编辑非聚焦模型时提示，
    // 避免「UI 显示已设置但运行时静默无效」的误导。
    const editingNonFocused = modelIdOverride != null && modelId !== focusedModelId;

    const nodes: MenuNode[] = [
        ...(editingNonFocused
            ? [
                  {
                      id: 'detail:nonfocused-hint',
                      kind: 'custom' as const,
                      renderCustom: (c: HTMLElement) => {
                          cardContainer(c, (inner) => {
                              const hint = document.createElement('div');
                              hint.style.cssText =
                                  'font-size:12px;color:var(--warn);padding:2px 14px;line-height:1.5;';
                              hint.textContent = t('motion.override.nonFocusedHint');
                              inner.appendChild(hint);
                          });
                      },
                  },
              ]
            : []),
        // ── 卡片 1：当前主动作 ──
        {
            id: 'detail:info',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('motion.currentMotion'));
                    slideRow(
                        inner,
                        currentIcon,
                        currentLabel,
                        false,
                        () => {},
                        currentSublabel,
                        undefined,
                        undefined,
                        undefined,
                        { wrapLabel: true }
                    );
                });
            },
        },
        // ── 卡片 2：播放速度 ──
        {
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
        },
    ];

    // ── 卡片 3：该主动作内部的图层 ──
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

    // ── 卡片 4：动作覆盖（核心）+ 卡片 5：动作预设 ──
    // [doc:pose-debug] 无 VMD 时仍显示覆盖/预设面板，用于姿势调整和骨骼调试
    if (modelId) {
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

    // [doc:adr-207] 程序化激活时，把参数卡并入统一详情页：模式切换/强度/速度/骨骼微动/插值。
    // 覆盖/预设本就 model-scoped 始终可达，至此程序化动作与 VMD 共享全部动作功能。
    // [audit-fix] 行体点击查看某 proc（viewingProc）时即使未激活也显示参数卡（仅查看/预配置）。
    if (procActive || viewingProc) {
        nodes.push(...buildProcMotionSchema(modelId));
    }

    return nodes;
}

/**
 * [doc:adr-167] 构建动作详情页 level。
 * @param sceneMotionId 主动作 id；undefined 时回退到当前默认动作
 */
export function buildMotionDetailLevel(
    sceneMotionId?: string,
    modelId?: string,
    procId?: LoadableProcId
): PopupLevel {
    return {
        label: t('motion.detail.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildMotionDetailSchema(sceneMotionId, modelId, procId), container);
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
                        // [fix] 重绘模型详情栈：使「动作根」卡片翻成「无动作」（数据已清空，仅缺 UI 刷新）
                        stackRegistry.modelStack?.reRender();
                        updatePlaybackUI();
                        getMotionMenu()?.pop();
                        getMotionMenu()?.reRender();
                        triggerAutoSave();
                        showInfoToast(t('motion.motionRemoved', { name: removedName }));
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
            id: 'playback-speed:slider',
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
            return renderMenu(buildPlaybackSpeedSchema(), container);
        },
    };
}
