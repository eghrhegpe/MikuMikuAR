// [doc:architecture] Resource Detail Helpers — 资源详情面板公共区块构建器
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 抽离 actor/stage/prop 详情面板的公共区块（变换/材质/危险）
// 现状: stage/prop 详情面板改为薄壳调用本模块；model-detail 因结构差异大保持现状

import { cardContainer, setStatus, modelRegistry, propRegistry } from '../core/config';
import { t } from '../core/i18n/t';
import { slideRow, addSliderRow, addDangerRow } from '../core/ui-helpers';
import {
    setModelScaling,
    setModelVisibility,
    setModelOpacity,
    resetModelTransform,
    removeModel,
    attachModelGizmo,
    detachModelGizmo,
    isModelGizmoActive,
    getModelGizmoTargetId,
} from '../scene/manager/model-ops';
import {
    setPropTransform,
    removeProp,
    attachPropGizmo,
    detachPropGizmo,
    isPropGizmoActive,
    getPropGizmoTargetId,
} from '../scene/scene';
import {
    attachLightGizmo,
    detachLightGizmo,
    isGizmoActive as isLightGizmoActive,
    getGizmoTargetId as getLightGizmoTargetId,
    setStageLightState,
    getStageLightState,
} from '../scene/render/lighting';
import { buildMatRootLevel } from './model-material';
import type { SlideMenu } from './menu';
import type { ResourceKind } from '../core/load-manager';

export interface ResourceHandle {
    id: string;
    kind: ResourceKind;
    name: string;
}

/** 拖拽操控卡片：Gizmo 拖拽 + 缩放倍率 + 透明度
 *  [doc:adr-049] 位置/旋转由 3D Gizmo 实时拖拽取代，不再显示滑块。
 *  按 kind 派发到 model-ops（actor/stage）、prop-ops（prop）或 lighting（light）。 */
export function buildTransformCard(container: HTMLElement, handle: ResourceHandle): void {
    const { id, kind } = handle;

    const render = (): void => {
        container.innerHTML = '';

        if (kind === 'actor' || kind === 'stage' || kind === 'prop' || kind === 'light') {
            cardContainer(container, (c) => {
                // — Gizmo 3D 拖拽（按 kind 派发） —
                if (kind === 'actor' || kind === 'stage') {
                    const gizmoActive = isModelGizmoActive() && getModelGizmoTargetId() === id;
                    slideRow(c, gizmoActive ? 'lucide:x' : 'lucide:move-3d',
                        t(gizmoActive ? 'scene.exitDrag' : 'scene.dragPosition'), false, () => {
                            if (gizmoActive) {
                                detachModelGizmo();
                                setStatus(t('scene.statusExitDrag'), true);
                            } else {
                                attachModelGizmo(id);
                                setStatus(t('scene.statusDragHint'), false);
                            }
                            render();
                        });
                } else if (kind === 'prop') {
                    const gizmoActive = isPropGizmoActive() && getPropGizmoTargetId() === id;
                    slideRow(c, gizmoActive ? 'lucide:x' : 'lucide:move-3d',
                        t(gizmoActive ? 'scene.exitDrag' : 'scene.dragPosition'), false, () => {
                            if (gizmoActive) {
                                detachPropGizmo();
                                setStatus(t('scene.statusExitDrag'), true);
                            } else {
                                attachPropGizmo(id);
                                setStatus(t('scene.statusDragHint'), false);
                            }
                            render();
                        });
                } else if (kind === 'light') {
                    const gizmoActive = isLightGizmoActive() && getLightGizmoTargetId() === id;
                    slideRow(c, gizmoActive ? 'lucide:x' : 'lucide:move-3d',
                        t(gizmoActive ? 'scene.exitDrag' : 'scene.dragPosition'), false, () => {
                            if (gizmoActive) {
                                detachLightGizmo();
                                setStatus(t('scene.statusExitDrag'), true);
                            } else {
                                attachLightGizmo(id);
                                setStatus(t('scene.statusDragHint'), false);
                            }
                            render();
                        });
                }

                // — 缩放倍率（按 kind 派发） —
                if (kind === 'actor' || kind === 'stage') {
                    const inst = modelRegistry.get(id);
                    if (inst) {
                        addSliderRow(c, '缩放倍率', inst.scaling ?? 1, 0.1, 10, 0.1,
                            () => {}, 'lucide:maximize',
                            (v) => setModelScaling(id, v));
                    }
                } else if (kind === 'prop') {
                    const p = propRegistry.get(id);
                    if (p) {
                        addSliderRow(c, '缩放倍率', p.scaling, 0.1, 10, 0.1,
                            () => {}, 'lucide:maximize',
                            (v) => {
                                p.scaling = v;
                                setPropTransform(id, { scaling: v });
                            });
                    }
                } else if (kind === 'light') {
                    const st = getStageLightState(id);
                    addSliderRow(c, '缩放倍率', st.indicatorScale, 0.1, 10, 0.1,
                        () => {}, 'lucide:maximize',
                        (v) => setStageLightState({ indicatorScale: v }, id));
                }

                // — 透明度（按 kind 派发） —
                if (kind === 'actor' || kind === 'stage') {
                    const inst = modelRegistry.get(id);
                    if (inst) {
                        addSliderRow(c, '透明度', Math.round((inst.opacity ?? 1) * 100),
                            0, 100, 1, () => {}, 'lucide:eye',
                            (v) => {
                                setModelOpacity(id, v / 100);
                                if (v > 0) setModelVisibility(id, true);
                            });
                    }
                } else if (kind === 'prop') {
                    const p = propRegistry.get(id);
                    if (p) {
                        addSliderRow(c, '透明度', p.visible ? 100 : 0, 0, 100, 100,
                            () => {}, 'lucide:eye',
                            (v) => {
                                p.visible = v > 0;
                                setPropTransform(id, { visible: v > 0 });
                            });
                    }
                } else if (kind === 'light') {
                    const st = getStageLightState(id);
                    addSliderRow(c, '透明度', Math.round(st.indicatorOpacity * 100),
                        0, 100, 1, () => {}, 'lucide:eye',
                        (v) => setStageLightState({ indicatorOpacity: v / 100 }, id));
                }
            });
        }
    };

    render();
}

/** 材质区块：进入材质调节子层级 */
export function buildMaterialCard(
    container: HTMLElement,
    handle: ResourceHandle,
    targetStack: SlideMenu | null
): void {
    cardContainer(container, (c) => {
        slideRow(c, 'lucide:palette', '材质调节', true, () => {
            const level = buildMatRootLevel(handle.id, handle.name, targetStack);
            targetStack?.push(level);
        });
    });
}

/** 危险区块：卸载资源（带确认对话框）
 *  onRemoved 可选回调，用于卸载后弹窗导航（如 pop 到上一级） */
export function buildDangerCard(
    container: HTMLElement,
    handle: ResourceHandle,
    onRemoved?: () => void
): void {
    const { id, kind, name } = handle;
    cardContainer(container, (c) => {
        // stage/actor 提供"重置变换"
        if (kind === 'actor' || kind === 'stage') {
            slideRow(c, 'lucide:rotate-ccw', t('settings.transformReset'), false, () => {
                resetModelTransform(id);
                setStatus(
                    t('settings.transformReset', {
                        kind: kind === 'stage' ? t('common.stage') : t('common.model'),
                    }),
                    true
                );
                onRemoved?.();
            });
        }
        addDangerRow(
            c,
            'lucide:trash-2',
            `卸载此${kind === 'prop' ? '道具' : kind === 'stage' ? '舞台' : '模型'}`,
            () => {
                if (kind === 'prop') {
                    removeProp(id);
                } else {
                    removeModel(id);
                }
                onRemoved?.();
                setStatus(t('settings.unloaded', { name }), true);
            }
        );
    });
}

/** 派发到对应 registry 查 ResourceHandle（供 UI 层从 id+kind 构造 handle） */
export function getResourceHandle(id: string, kind: ResourceKind): ResourceHandle | null {
    if (kind === 'actor' || kind === 'stage') {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return null;
        }
        return { id, kind, name: inst.name };
    }
    if (kind === 'prop') {
        const p = propRegistry.get(id);
        if (!p) {
            return null;
        }
        return { id, kind, name: p.name };
    }
    // light 不在 registry 中，走 lighting.ts 查询
    if (kind === 'light') {
        const st = getStageLightState(id);
        return { id, kind, name: st?.name ?? id };
    }
    return null;
}
