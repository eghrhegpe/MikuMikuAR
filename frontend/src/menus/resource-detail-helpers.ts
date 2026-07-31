// [doc:architecture] Resource Detail Helpers — 资源详情面板公共区块构建器
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 抽离 actor/stage 详情面板的公共区块（变换/材质/危险）
// 现状: stage 详情面板改为薄壳调用本模块；model-detail 因结构差异大保持现状

import { cardContainer, modelRegistry, type PopupLevel } from '../core/config';
import { feedbackInfo, feedbackStatus } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import { t } from '../core/i18n/t';
import {
    slideRow,
    addSliderRow,
    addToggleRow,
    addCardTitle,
    addDangerRow,
} from '../core/ui-helpers';
import { resetModelTransform, removeModel } from '../scene/manager/model-ops';
import { pushUndoSnapshot, offerSceneUndo, modelManager } from '../scene/scene';
import { reRenderSceneMenu } from './scene-menu-state';
import {
    attachGizmoForKind,
    getTransformAdapter,
    detachGizmo,
    isGizmoActive,
    getGizmoTargetId,
    onGizmoDragObservable,
    getGizmoNode,
    getActiveGizmoTypes,
    setGizmoSnapDistance,
    getGizmoSnapConfig,
} from '../scene/transform/transform-adapter';
import { buildMatRootLevel } from './model-material';
import type { SlideMenu } from './menu';
import type { ResourceKind } from '../core/load-manager';

export interface ResourceHandle {
    id: string;
    kind: ResourceKind;
    name: string;
}

/** 当前生效的拖拽实时同步订阅（模块级，保证全局唯一，避免多卡叠加泄漏） */
let _activeDragObs: ReturnType<typeof onGizmoDragObservable.add> | null = null;

/** 局部更新滑杆显示（不触发 onChange），用于 Gizmo 拖拽中实时同步数值（ADR-126 Phase 2）。
 *  显示格式与 ui-rows.ts addSliderRow 内部 updateDisplay 保持一致。 */
function updateSliderDisplay(
    row: HTMLElement,
    v: number,
    min: number,
    max: number,
    step: number
): void {
    const range = max - min;
    const pct = range > 0 ? Math.max(0, Math.min(100, ((v - min) / range) * 100)) : 0;
    const val = row.querySelector('.cs-value');
    const fill = row.querySelector('.cs-fill');
    const thumb = row.querySelector('.cs-thumb');
    const slider = row.querySelector('[role="slider"]');
    if (val) {
        val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    }
    if (fill) {
        (fill as HTMLElement).style.width = pct + '%';
    }
    if (thumb) {
        (thumb as HTMLElement).style.left = pct + '%';
    }
    if (slider) {
        slider.setAttribute('aria-valuenow', String(v));
    }
}

export function buildSnapSettings(container: HTMLElement, onRefresh: () => void): void {
    const snap = getGizmoSnapConfig();
    addToggleRow(
        container,
        t('scene.snapEnable'),
        snap.enabled,
        (v) => {
            setGizmoSnapDistance(v, snap.step);
            onRefresh();
        },
        'lucide:grid-3x3',
        undefined,
        'transform:snap-toggle'
    );
    if (snap.enabled) {
        addSliderRow(
            container,
            t('scene.snapStep'),
            snap.step,
            0.1,
            5,
            0.1,
            (v) => setGizmoSnapDistance(true, v),
            'lucide:ruler',
            undefined,
            undefined,
            'transform:snap-step'
        );
    }
}

/** 拖拽操控卡片：Gizmo 拖拽 + 缩放倍率 + 透明度
 *  [doc:adr-049] 位置/旋转由 3D Gizmo 实时拖拽取代，不再显示滑块。
 *  按 kind 派发到 model-ops（actor/stage）、prop-ops（prop）或 lighting（light）。 */
export function buildTransformCard(container: HTMLElement, handle: ResourceHandle): void {
    const { id, kind } = handle;
    const adapter = getTransformAdapter(kind);

    // 双模态（ADR-126 Phase 2）：拖拽进行中实时同步数值滑杆显示。
    // 清理上一卡片遗留的订阅，保证全局唯一，避免泄漏/叠加。
    if (_activeDragObs) {
        _activeDragObs.remove();
        _activeDragObs = null;
    }
    let scaleRowEl: HTMLElement | null = null;
    let opacityRowEl: HTMLElement | null = null;

    const render = (): void => {
        container.innerHTML = '';
        if (!adapter) {
            return;
        }
        cardContainer(container, (c) => {
            const gizmoActive = isGizmoActive() && getGizmoTargetId() === id;
            slideRow(
                c,
                gizmoActive ? 'lucide:x' : 'lucide:move-3d',
                t(gizmoActive ? 'scene.exitDrag' : 'scene.dragPosition'),
                false,
                () => {
                    if (gizmoActive) {
                        detachGizmo();
                        _activeDragObs?.remove();
                        _activeDragObs = null;
                        feedbackInfo('scene.statusExitDrag', undefined);
                    } else {
                        attachGizmoForKind(kind, id);
                        feedbackStatus('scene.statusDragHint', undefined, false);
                    }
                    render();
                }
            );
            slideRow(
                c,
                'lucide:rotate-ccw',
                t('settings.transformReset', { kind: t('common.model') }),
                false,
                () => {
                    resetModelTransform(id);
                    showInfoToast(t('settings.transformReset', { kind: t('common.model') }));
                }
            );

            // 网格吸附（ADR-126 Phase 3）：全局拖拽偏好，下次/当前 Gizmo 生效
            buildSnapSettings(c, render);

            if (adapter.capabilities.includes('slider-scale')) {
                addSliderRow(
                    c,
                    t('scene.scaleRatio'),
                    adapter.getScale?.(id) ?? 1,
                    0.1,
                    10,
                    0.1,
                    () => {},
                    'lucide:maximize',
                    (v) => adapter.setScale?.(id, v)
                );
                scaleRowEl = c.lastElementChild as HTMLElement;
            }
            if (adapter.capabilities.includes('slider-opacity')) {
                addSliderRow(
                    c,
                    t('scene.opacity'),
                    Math.round((adapter.getOpacity?.(id) ?? 1) * 100),
                    0,
                    100,
                    1,
                    () => {},
                    'lucide:eye',
                    (v) => adapter.setOpacity?.(id, v / 100)
                );
                opacityRowEl = c.lastElementChild as HTMLElement;
            }
        });
    };

    const syncLive = (): void => {
        if (getGizmoTargetId() !== id || !isGizmoActive()) {
            _activeDragObs?.remove();
            _activeDragObs = null;
            return;
        }
        if (adapter?.capabilities.includes('slider-scale') && scaleRowEl) {
            // 缩放 Gizmo 激活时读取 Babylon 实时改写的 node.scaling（actor/stage 节点缩放即模型缩放）
            const types = getActiveGizmoTypes();
            const node = getGizmoNode();
            const live =
                types.includes('scale') && node
                    ? (node as unknown as { scaling: { x: number } }).scaling.x
                    : null;
            const v = live != null ? live : (adapter.getScale?.(id) ?? 1);
            updateSliderDisplay(scaleRowEl, v, 0.1, 10, 0.1);
        }
        if (adapter?.capabilities.includes('slider-opacity') && opacityRowEl) {
            updateSliderDisplay(
                opacityRowEl,
                Math.round((adapter.getOpacity?.(id) ?? 1) * 100),
                0,
                100,
                1
            );
        }
    };

    _activeDragObs = onGizmoDragObservable.add(syncLive);
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
            slideRow(
                c,
                'lucide:rotate-ccw',
                t('settings.transformReset', {
                    kind: kind === 'stage' ? t('common.stage') : t('common.model'),
                }),
                false,
                () => {
                    resetModelTransform(id);
                    showInfoToast(
                        t('settings.transformReset', {
                            kind: kind === 'stage' ? t('common.stage') : t('common.model'),
                        })
                    );
                    onRemoved?.();
                }
            );
        }
        addDangerRow(
            c,
            'lucide:trash-2',
            t('model-detail.unloadThis', {
                kind: t(kind === 'stage' ? 'common.stage' : 'common.model'),
            }),
            () => {
                // [doc:adr-127] 场景级撤销保护：详情页卸载与列表路径行为一致（ADR-130 Phase 2.6 缺口 A）
                const snap = pushUndoSnapshot();
                removeModel(id);
                onRemoved?.();
                offerSceneUndo(t('settings.unloaded', { name }), snap, () => reRenderSceneMenu());
            }
        );
    });
}

// ======== [doc:adr-215] 模型附属关系卡片 ========

/** 构建父模型选择子菜单：列出所有有 mmdModel 的其他模型（不含自身）。 */
function buildAttachmentSelectLevel(
    childId: string,
    onDone: () => void,
    targetStack: SlideMenu | null
): PopupLevel {
    // 收集所有可作为父模型的候选（有 mmdModel 且非自身）
    const candidates: Array<{ id: string; name: string }> = [];
    for (const [id, inst] of modelRegistry) {
        if (id !== childId && inst.mmdModel) {
            candidates.push({ id, name: inst.name });
        }
    }

    return {
        dir: '',
        label: t('model-detail.attachmentSelectParent'),
        items: [],
        renderCustom: (container) => {
            container.innerHTML = '';
            if (candidates.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'menu-empty';
                empty.textContent = t('model-detail.attachmentNoParent');
                container.appendChild(empty);
                return;
            }
            for (const c of candidates) {
                slideRow(container, 'lucide:user', c.name, true, () => {
                    // 选择骨骼
                    const boneLevel = buildBoneSelectLevel(
                        childId,
                        c.id,
                        c.name,
                        onDone,
                        targetStack
                    );
                    targetStack?.push(boneLevel);
                });
            }
        },
    };
}

/** 构建骨骼选择子菜单：列出父模型所有 runtimeBones。 */
function buildBoneSelectLevel(
    childId: string,
    parentId: string,
    parentName: string,
    onDone: () => void,
    targetStack: SlideMenu | null
): PopupLevel {
    const parentInst = modelRegistry.get(parentId);
    const bones = parentInst?.mmdModel?.runtimeBones ?? [];

    return {
        dir: '',
        label: t('model-detail.attachmentSelectBone', { parent: parentName }),
        items: [],
        renderCustom: (container) => {
            container.innerHTML = '';
            if (bones.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'menu-empty';
                empty.textContent = t('model-detail.attachmentNoBone');
                container.appendChild(empty);
                return;
            }
            for (const bone of bones) {
                slideRow(container, 'lucide:bone', bone.name, false, () => {
                    const ok = modelManager.attachModelToBone(childId, parentId, bone.name);
                    if (ok) {
                        onDone();
                        // 返回上一级（骨骼选择 → 父模型选择）
                        targetStack?.pop();
                    } else {
                        showInfoToast(t('scene.accessory.attachFailed'));
                    }
                });
            }
        },
    };
}

/**
 * [doc:adr-215] 模型附属关系卡片。
 * 将当前模型附属到其他模型（父模型选择 + 骨骼选择）。
 * 取代原 buildBoneAttachCard（prop 专用）。
 */
export function buildAttachmentCard(
    container: HTMLElement,
    handle: ResourceHandle,
    targetStack: SlideMenu | null,
    onRefresh: () => void
): void {
    const { id } = handle;

    const render = (): void => {
        container.innerHTML = '';
        const inst = modelRegistry.get(id);
        if (!inst) {
            return;
        }

        cardContainer(container, (c) => {
            addCardTitle(c, t('model-detail.attachment'));

            if (inst.parentId && inst.attachedBone) {
                // 已附属：显示信息 + 解除按钮
                const parentInst = modelRegistry.get(inst.parentId);
                const parentName = parentInst?.name ?? inst.parentId;
                slideRow(
                    c,
                    'lucide:link',
                    t('model-detail.attachmentAttached', {
                        parent: parentName,
                        bone: inst.attachedBone,
                    }),
                    false,
                    () => {}
                );
                slideRow(c, 'lucide:unlink', t('model-detail.attachmentDetach'), false, () => {
                    modelManager.detachModelFromBone(id);
                    render();
                    onRefresh();
                });
            } else {
                // 未附属：显示附属入口
                slideRow(c, 'lucide:link', t('model-detail.attachmentAttach'), true, () => {
                    const level = buildAttachmentSelectLevel(
                        id,
                        () => {
                            render();
                            onRefresh();
                        },
                        targetStack
                    );
                    targetStack?.push(level);
                });
            }
        });
    };

    render();
}
