// [doc:architecture] Resource Detail Helpers — 资源详情面板公共区块构建器
// 规范文档: docs/adr/adr-045-unified-loading-and-resource.md
// 职责: 抽离 actor/stage/prop 详情面板的公共区块（变换/材质/危险）
// 现状: stage/prop 详情面板改为薄壳调用本模块；model-detail 因结构差异大保持现状

import { cardContainer, setStatus, modelRegistry, propRegistry } from '../core/config';
import { t } from '../core/i18n/t';
import { slideRow, addSliderRow, addToggleRow, addDangerRow, addVector3SliderRow } from '../core/ui-helpers';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import {
    resetModelTransform,
    removeModel,
} from '../scene/manager/model-ops';
import {
    removeProp,
} from '../scene/scene';
import { attachPropToBone, detachPropFromBone } from '../scene/env/accessory';
import {
    getStageLightState,
} from '../scene/render/lighting';
import { attachGizmoForKind, getTransformAdapter, detachGizmo, isGizmoActive, getGizmoTargetId, onGizmoDragObservable, getGizmoNode, getActiveGizmoTypes, setGizmoSnapDistance, getGizmoSnapConfig } from '../scene/transform/transform-adapter';
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
function updateSliderDisplay(row: HTMLElement, v: number, min: number, max: number, step: number): void {
    const range = max - min;
    const pct = range > 0 ? Math.max(0, Math.min(100, ((v - min) / range) * 100)) : 0;
    const val = row.querySelector('.cs-value');
    const fill = row.querySelector('.cs-fill');
    const thumb = row.querySelector('.cs-thumb');
    const slider = row.querySelector('[role="slider"]');
    if (val) val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    if (fill) (fill as HTMLElement).style.width = pct + '%';
    if (thumb) (thumb as HTMLElement).style.left = pct + '%';
    if (slider) slider.setAttribute('aria-valuenow', String(v));
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
		if (!adapter) return;
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
						setStatus(t('scene.statusExitDrag'), true);
					} else {
						attachGizmoForKind(kind, id);
						setStatus(t('scene.statusDragHint'), false);
					}
					render();
				}
			);

			// 网格吸附（ADR-126 Phase 3）：全局拖拽偏好，下次/当前 Gizmo 生效
			const snap = getGizmoSnapConfig();
			addToggleRow(
				c,
				t('scene.snapEnable'),
				snap.enabled,
				(v) => {
					setGizmoSnapDistance(v, snap.step);
					render();
				},
				'lucide:grid-3x3',
				undefined,
				'transform:snap-toggle'
			);
			if (snap.enabled) {
				addSliderRow(
					c,
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

			if (adapter.capabilities.includes('slider-scale')) {
				addSliderRow(
					c,
					'缩放倍率',
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
					'透明度',
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
			const live = types.includes('scale') && node
				? (node as unknown as { scaling: { x: number } }).scaling.x
				: null;
			const v = live != null ? live : (adapter.getScale?.(id) ?? 1);
			updateSliderDisplay(scaleRowEl, v, 0.1, 10, 0.1);
		}
		if (adapter?.capabilities.includes('slider-opacity') && opacityRowEl) {
			updateSliderDisplay(opacityRowEl, Math.round((adapter.getOpacity?.(id) ?? 1) * 100), 0, 100, 1);
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
                    setStatus(
                        t('settings.transformReset', {
                            kind: kind === 'stage' ? t('common.stage') : t('common.model'),
                        }),
                        true
                    );
                    onRemoved?.();
                }
            );
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

/** 骨骼挂载卡片：将道具挂载到指定模型骨骼上，支持偏移/旋转微调
 *  仅 prop 类型有效；actor/stage/light 返回空。
 *  [doc:adr-049] 位置/旋转由 Gizmo 承担粗调，骨骼偏移用于锚定后的精细对位。 */
export function buildBoneAttachCard(
    container: HTMLElement,
    handle: ResourceHandle,
    onStateChange?: () => void
): void {
    const { id, kind } = handle;
    if (kind !== 'prop') {
        return;
    }

    const p = propRegistry.get(id);
    if (!p) {
        return;
    }

    cardContainer(container, (c) => {
        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = t('scene.accessory.attachToBone');
        c.appendChild(title);

        const render = (): void => {
            c.innerHTML = '';
            const titleEl = document.createElement('div');
            titleEl.className = 'card-title';
            titleEl.textContent = t('scene.accessory.attachToBone');
            c.appendChild(titleEl);

            if (p.boneName && p.targetModelId) {
                // —— 已挂载状态 ——
                const info = document.createElement('div');
                info.style.cssText = 'font-size:11px;padding:4px 0 8px;color:var(--text-dim);';
                info.textContent = `${p.boneName} @ ${p.targetModelId.slice(0, 12)}...`;
                c.appendChild(info);

                // 骨骼偏移
                addVector3SliderRow(
                    c,
                    t('scene.accessory.boneOffset'),
                    p.boneOffset ?? [0, 0, 0],
                    -5,
                    5,
                    0.05,
                    (v) => {
                        const target = p.container ?? p.rootMesh;
                        if (target) {
                            target.position.set(v[0], v[1], v[2]);
                        }
                    },
                    undefined,
                    'lucide:move-horizontal',
                    (v) => {
                        p.boneOffset = v;
                        attachPropToBone(
                            id,
                            p.boneName!,
                            p.targetModelId!,
                            v,
                            p.boneRotation ?? [0, 0, 0]
                        );
                        onStateChange?.();
                    }
                );

                // 骨骼旋转
                addVector3SliderRow(
                    c,
                    t('scene.accessory.boneRotation'),
                    p.boneRotation ?? [0, 0, 0],
                    -180,
                    180,
                    1,
                    (v) => {
                        const target = p.container ?? p.rootMesh;
                        if (target) {
                            target.rotationQuaternion = Quaternion.FromEulerAngles(
                                (v[0] * Math.PI) / 180,
                                (v[1] * Math.PI) / 180,
                                (v[2] * Math.PI) / 180
                            );
                        }
                    },
                    ['Rx', 'Ry', 'Rz'],
                    'lucide:rotate-3d',
                    (v) => {
                        p.boneRotation = v;
                        attachPropToBone(
                            id,
                            p.boneName!,
                            p.targetModelId!,
                            p.boneOffset ?? [0, 0, 0],
                            v
                        );
                        onStateChange?.();
                    }
                );

                // 解除按钮
                const detachBtn = document.createElement('button');
                detachBtn.className = 'preset-chip';
                detachBtn.textContent = t('scene.accessory.detachFromBone');
                detachBtn.style.marginTop = '4px';
                detachBtn.addEventListener('click', () => {
                    detachPropFromBone(id);
                    onStateChange?.();
                    render();
                });
                c.appendChild(detachBtn);
            } else {
                // —— 未挂载状态：选择模型 + 骨骼 ——
                const modelSelect = document.createElement('select');
                modelSelect.style.cssText =
                    'width:100%;padding:6px 8px;margin:4px 0;border-radius:6px;' +
                    'background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:12px;';
                modelSelect.innerHTML =
                    '<option value="">-- ' + t('scene.accessory.selectModel') + ' --</option>';
                for (const [mid, inst] of modelRegistry) {
                    if (inst.kind === 'actor') {
                        const opt = document.createElement('option');
                        opt.value = mid;
                        opt.textContent = inst.name;
                        modelSelect.appendChild(opt);
                    }
                }
                c.appendChild(modelSelect);

                const boneSelect = document.createElement('select');
                boneSelect.style.cssText =
                    'width:100%;padding:6px 8px;margin:4px 0;border-radius:6px;' +
                    'background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:12px;';
                boneSelect.innerHTML =
                    '<option value="">-- ' + t('scene.accessory.selectBone') + ' --</option>';
                modelSelect.addEventListener('change', () => {
                    const mid = modelSelect.value;
                    boneSelect.innerHTML =
                        '<option value="">-- ' + t('scene.accessory.selectBone') + ' --</option>';
                    if (!mid) {
                        return;
                    }
                    const inst = modelRegistry.get(mid);
                    if (inst?.mmdModel) {
                        for (const b of inst.mmdModel.runtimeBones) {
                            const opt = document.createElement('option');
                            opt.value = b.name;
                            opt.textContent = b.name;
                            boneSelect.appendChild(opt);
                        }
                    }
                });
                c.appendChild(boneSelect);

                const attachBtn = document.createElement('button');
                attachBtn.className = 'preset-chip';
                attachBtn.textContent = t('scene.accessory.attachToBone');
                attachBtn.style.marginTop = '4px';
                attachBtn.addEventListener('click', () => {
                    const targetModelId = modelSelect.value;
                    const boneName = boneSelect.value;
                    if (!targetModelId || !boneName) {
                        return;
                    }
                    const ok = attachPropToBone(id, boneName, targetModelId, [0, 0, 0], [0, 0, 0]);
                    if (ok) {
                        onStateChange?.();
                        render();
                    }
                });
                c.appendChild(attachBtn);
            }
        };

        render();
    });
}
