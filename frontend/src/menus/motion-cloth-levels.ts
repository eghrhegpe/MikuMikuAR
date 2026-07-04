// [doc:architecture] Motion Cloth Levels — 布料参数弹窗层级
// 从 motion-popup.ts 拆分

import { envState, focusedModelId, cardContainer, setStatus } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addSliderRow, addToggleRow, addCollapsible, addPresetChip } from '../core/ui-helpers';
import {
    setEnvState, setModelWireframe, setModelBoneLinesVis, setModelBoneJointsVis, modelManager,
    getModelPosition, setModelPosition, setModelScaling, setModelRotationY, resetModelTransform, scene,
} from '../scene/scene';
import {
    getCollider, getColliderSpecs, setCapsuleRadius, setCapsuleHalfHeight,
    setColliderStiffness, setColliderFriction, setDebugParticles, setDebugConstraints,
    setDebugColliders, getDebugState, recreateCloth,
} from '../physics/cloth-manager';
import type { ClothConfig } from '../physics/xpbd-cloth';

/** 布料预设 — 物理材质手感 */
const CLOTH_PRESETS: Record<string, Partial<ClothConfig>> = {
    silk: { compliance: 0.0005, bendCompliance: 0.001, damping: 0.98, gravityScale: 0.8, totalMass: 0.3 },
    cotton: { compliance: 0.001, bendCompliance: 0.005, damping: 0.96, gravityScale: 1.0, totalMass: 0.5 },
    leather: { compliance: 0.003, bendCompliance: 0.015, damping: 0.92, gravityScale: 1.3, totalMass: 0.8 },
    stiff: { compliance: 0.008, bendCompliance: 0.04, damping: 0.88, gravityScale: 1.5, totalMass: 1.0 },
};

const CLOTH_PRESET_LABELS: Record<string, string> = {
    silk: '丝绸', cotton: '棉布', leather: '皮革', stiff: '硬质',
};

/** 布料预设 — 常见服装样式（拓扑 + 形状） */
const CLOTH_STYLE_PRESETS: Record<string, Partial<ClothConfig>> = {
    shortSkirt: { topology: 'skirt', length: 0.35, slope: 25, segmentsV: 8, innerRadius: 0.14 },
    longSkirt: { topology: 'skirt', length: 1.1, slope: 8, segmentsV: 16, innerRadius: 0.16 },
    cape: { topology: 'cape', length: 0.7, slope: 30, segmentsV: 10, innerRadius: 0.12 },
    tube: { topology: 'tube', length: 0.5, slope: 5, segmentsV: 12, innerRadius: 0.13 },
    ribbon: { topology: 'rope', length: 1.4, slope: 0, segmentsV: 20, innerRadius: 0.08 },
};

const CLOTH_STYLE_LABELS: Record<string, string> = {
    shortSkirt: '短裙', longSkirt: '长裙', cape: '披风', tube: '筒裙', ribbon: '飘带',
};

export function buildClothParamsLevel(): PopupLevel {
    return {
        label: '布料参数',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const cfg = envState.clothConfig;
                let _recreateTimer: ReturnType<typeof setTimeout> | null = null;
                const debouncedRecreate = () => {
                    if (_recreateTimer) clearTimeout(_recreateTimer);
                    _recreateTimer = setTimeout(() => {
                        _recreateTimer = null;
                        recreateCloth();
                    }, 100);
                };

                // 常见样式预设
                const styleLabel = document.createElement('div');
                styleLabel.className = 'cs-top';
                styleLabel.innerHTML = '<span class="cs-label" style="font-size:12px;color:var(--text-muted);">常见样式</span>';
                styleLabel.style.marginBottom = '4px';
                c.appendChild(styleLabel);

                const styleGroup = document.createElement('div');
                styleGroup.className = 'preset-group';
                styleGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(CLOTH_STYLE_PRESETS)) {
                    addPresetChip(styleGroup, CLOTH_STYLE_LABELS[key] || key, false, () => {
                        const preset = CLOTH_STYLE_PRESETS[key];
                        if (preset) {
                            setEnvState({ clothConfig: { ...cfg, ...preset } });
                            recreateCloth();
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                        }
                    });
                }
                c.appendChild(styleGroup);

                // 材质手感预设
                const feelLabel = document.createElement('div');
                feelLabel.className = 'cs-top';
                feelLabel.innerHTML = '<span class="cs-label" style="font-size:12px;color:var(--text-muted);">材质手感</span>';
                feelLabel.style.marginBottom = '4px';
                c.appendChild(feelLabel);

                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(CLOTH_PRESETS)) {
                    addPresetChip(chipGroup, CLOTH_PRESET_LABELS[key] || key, false, () => {
                        const preset = CLOTH_PRESETS[key];
                        if (preset) {
                            setEnvState({ clothConfig: { ...cfg, ...preset } });
                            recreateCloth();
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                        }
                    });
                }
                c.appendChild(chipGroup);

                addCollapsible(c, {
                    title: '形状', icon: 'lucide:shirt', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '裙长', cfg.length, 0.2, 1.5, 0.05, (v) => { setEnvState({ clothConfig: { ...cfg, length: v } }); debouncedRecreate(); }, 'lucide:ruler');
                        addSliderRow(cc, '裙摆角度', cfg.slope, 0, 45, 1, (v) => { setEnvState({ clothConfig: { ...cfg, slope: v } }); debouncedRecreate(); }, 'lucide:triangle');
                        addSliderRow(cc, '腰部半径', cfg.innerRadius, 0.05, 0.4, 0.01, (v) => { setEnvState({ clothConfig: { ...cfg, innerRadius: v } }); debouncedRecreate(); }, 'lucide:circle');
                    },
                });

                addCollapsible(c, {
                    title: '物理', icon: 'lucide:wind', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '布料柔度', cfg.compliance, 0, 0.01, 0.005, (v) => { setEnvState({ clothConfig: { ...cfg, compliance: v } }); debouncedRecreate(); }, 'lucide:wind');
                        addSliderRow(cc, '弯曲柔度', cfg.bendCompliance, 0, 0.05, 0.01, (v) => { setEnvState({ clothConfig: { ...cfg, bendCompliance: v } }); debouncedRecreate(); }, 'lucide:curl');
                        addSliderRow(cc, '阻尼', cfg.damping, 0.8, 0.999, 0.01, (v) => { setEnvState({ clothConfig: { ...cfg, damping: v } }); debouncedRecreate(); }, 'lucide:droplet');
                        addSliderRow(cc, '重力倍率', cfg.gravityScale, 0.1, 3, 0.1, (v) => { setEnvState({ clothConfig: { ...cfg, gravityScale: v } }); debouncedRecreate(); }, 'lucide:arrow-down');
                    },
                });

                addCollapsible(c, {
                    title: '细分', icon: 'lucide:grid', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '水平分段', cfg.segmentsH, 12, 36, 2, (v) => { setEnvState({ clothConfig: { ...cfg, segmentsH: v } }); debouncedRecreate(); }, 'lucide:grid');
                        addSliderRow(cc, '垂直分段', cfg.segmentsV, 6, 24, 2, (v) => { setEnvState({ clothConfig: { ...cfg, segmentsV: v } }); debouncedRecreate(); }, 'lucide:grid');
                    },
                });

                addCollapsible(c, {
                    title: '碰撞体', icon: 'lucide:shield', defaultOpen: false,
                    renderContent: (cc) => {
                        const specs = getColliderSpecs();
                        if (specs.length === 0) {
                            const hint = document.createElement('div');
                            hint.style.cssText = 'padding:12px;color:var(--text-muted);font-size:12px;';
                            hint.textContent = '请先启用布料模拟';
                            cc.appendChild(hint);
                            return;
                        }

                        const collider = getCollider();
                        if (collider) {
                            addSliderRow(cc, '碰撞刚度', collider.stiffness, 0, 1, 0.05, (v) => setColliderStiffness(v), 'lucide:zap');
                            addSliderRow(cc, '摩擦系数', collider.friction, 0, 1, 0.05, (v) => setColliderFriction(v), 'lucide:hand');
                        }

                        const groups = [
                            { label: '躯干', items: ['chest', 'waist', 'hip'] },
                            { label: '腿部', items: ['upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR'] },
                            { label: '手臂', items: ['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'] },
                        ];

                        const CAPSULE_LABELS: Record<string, string> = {
                            head: '头部', neck: '颈部', chest: '胸部', waist: '腰部', hip: '臀部',
                            upperArmL: '左上臂', upperArmR: '右上臂', lowerArmL: '左前臂', lowerArmR: '右前臂',
                            upperLegL: '左大腿', upperLegR: '右大腿', lowerLegL: '左小腿', lowerLegR: '右小腿',
                        };

                        for (const group of groups) {
                            addCollapsible(cc, {
                                title: group.label, icon: 'lucide:box', defaultOpen: false,
                                renderContent: (gc) => {
                                    for (const name of group.items) {
                                        const spec = specs.find((s) => s.name === name);
                                        if (!spec) continue;
                                        const label = CAPSULE_LABELS[name] || name;
                                        addSliderRow(gc, `${label} 半径`, spec.radius, 0.02, 0.3, 0.01, (v) => setCapsuleRadius(name, v), 'lucide:circle');
                                        addSliderRow(gc, `${label} 半高`, spec.halfHeight, 0.02, 0.3, 0.01, (v) => setCapsuleHalfHeight(name, v), 'lucide:move-vertical');
                                    }
                                },
                            });
                        }
                    },
                });

                addCollapsible(c, {
                    title: '变换', icon: 'lucide:move', defaultOpen: false,
                    renderContent: (cc) => {
                        const id = focusedModelId;
                        if (!id || !modelManager) {
                            const hint = document.createElement('div');
                            hint.style.cssText = 'padding:12px;color:var(--text-muted);font-size:12px;';
                            hint.textContent = '请先加载模型';
                            cc.appendChild(hint);
                            return;
                        }
                        const inst = modelManager.get(id);
                        if (!inst) return;

                        addSliderRow(cc, '位置 X', getModelPosition(id)[0], -20, 20, 0.1, (v) => {
                            const p = getModelPosition(id);
                            setModelPosition(id, v, p[1], p[2]);
                        }, 'lucide:move', undefined, {
                            bind: () => getModelPosition(id)[0],
                        });
                        addSliderRow(cc, '位置 Y', getModelPosition(id)[1], -20, 20, 0.1, (v) => {
                            const p = getModelPosition(id);
                            setModelPosition(id, p[0], v, p[2]);
                        }, 'lucide:move', undefined, {
                            bind: () => getModelPosition(id)[1],
                        });
                        addSliderRow(cc, '位置 Z', getModelPosition(id)[2], -20, 20, 0.1, (v) => {
                            const p = getModelPosition(id);
                            setModelPosition(id, p[0], p[1], v);
                        }, 'lucide:move', undefined, {
                            bind: () => getModelPosition(id)[2],
                        });
                        addSliderRow(cc, '缩放', inst.scaling, 0.01, 5, 0.05, (v) => {
                            setModelScaling(id, v);
                        }, 'lucide:maximize', undefined, {
                            bind: () => modelManager.get(id)?.scaling ?? 1,
                        });
                        addSliderRow(cc, '旋转 Y', (inst.rotationY * 180) / Math.PI, -180, 180, 1, (v) => {
                            setModelRotationY(id, (v * Math.PI) / 180);
                        }, 'lucide:rotate-cw', undefined, {
                            bind: () => ((modelManager.get(id)?.rotationY ?? 0) * 180) / Math.PI,
                        });

                        const resetBtn = document.createElement('div');
                        resetBtn.className = 'slide-item';
                        resetBtn.setAttribute('data-hint', '重置所有变换参数');
                        resetBtn.innerHTML =
                            '<span class="slide-icon"><iconify-icon icon="lucide:rotate-ccw"></iconify-icon></span><span class="slide-label">重置变换</span>';
                        resetBtn.addEventListener('click', () => {
                            resetModelTransform(id);
                            setStatus('✓ 变换已重置', true);
                        });
                        cc.appendChild(resetBtn);

                        const observer = scene.onBeforeRenderObservable.add(() => {
                            if (!document.body.contains(cc)) {
                                scene.onBeforeRenderObservable.remove(observer);
                                return;
                            }
                            import('./motion-popup').then(m => m.getMotionMenu()?.updateControls());
                        });
                    },
                });

                addCollapsible(c, {
                    title: '调试', icon: 'lucide:bug', defaultOpen: false,
                    renderContent: (cc) => {
                        const id = focusedModelId;
                        if (!id || !modelManager) {
                            const hint = document.createElement('div');
                            hint.style.cssText = 'padding:12px;color:var(--text-muted);font-size:12px;';
                            hint.textContent = '请先加载模型';
                            cc.appendChild(hint);
                            return;
                        }
                        const inst = modelManager.get(id);
                        if (!inst) return;

                        addToggleRow(cc, '材质线框', inst.wireframe, (v) => {
                            setModelWireframe(id, v);
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                            setStatus(v ? '材质线框: 开' : '材质线框: 关', true);
                        }, 'lucide:square');
                        addToggleRow(cc, '骨骼线', inst.showBoneLines, (v) => {
                            setModelBoneLinesVis(id, v);
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                            setStatus(v ? '骨骼线: 开' : '骨骼线: 关', true);
                        }, 'lucide:git-branch');
                        addToggleRow(cc, '骨骼关节球', inst.showBoneJoints, (v) => {
                            setModelBoneJointsVis(id, v);
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                            setStatus(v ? '骨骼关节球: 开' : '骨骼关节球: 关', true);
                        }, 'lucide:circle-dot');

                        const debugState = getDebugState();
                        addToggleRow(cc, '粒子球', debugState.particles, (v) => {
                            setDebugParticles(v);
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                            setStatus(v ? '粒子球: 开' : '粒子球: 关', true);
                        }, 'lucide:circle');
                        addToggleRow(cc, '约束线', debugState.constraints, (v) => {
                            setDebugConstraints(v);
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                            setStatus(v ? '约束线: 开' : '约束线: 关', true);
                        }, 'lucide:minus');
                        addToggleRow(cc, '碰撞体线框', debugState.colliders, (v) => {
                            setDebugColliders(v);
                            import('./motion-popup').then(m => m.getMotionMenu()?.reRender());
                            setStatus(v ? '碰撞体线框: 开' : '碰撞体线框: 关', true);
                        }, 'lucide:box');
                    },
                });
            });
        },
        // reRender 均为调试 toggle 触发，toggle 自管理状态，跳过全量重建
        reRenderCustom: () => {},
    };
}
