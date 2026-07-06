// [doc:architecture] Motion Cloth Levels — 布料参数弹窗层级
// 从 motion-popup.ts 拆分

import { envState, cardContainer, setStatus } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addSliderRow, addCollapsible, addPresetChip } from '../core/ui-helpers';
import { setEnvState, modelManager, scene } from '../scene/scene';
import {
    getCollider,
    getColliderSpecs,
    setCapsuleRadius,
    setCapsuleHalfHeight,
    setColliderStiffness,
    setColliderFriction,
    recreateCloth,
    autoFitClothDimensions,
} from '../physics/cloth-manager';
import type { ClothConfig } from '../physics/xpbd-cloth';

/**
 * 布料预设 — 物理材质手感（重力由根页面统控，预设不含 gravityScale）
 *
 * XPBD compliance 说明：
 *   compliance=0 → 完美刚性（不拉伸），值越大约束越软（越容易拉长）
 *   bendCompliance 同理，值越大越容易弯折折叠
 *   damping：每帧速度保留比例，越大越不易停止
 */
const CLOTH_PRESETS: Record<string, Partial<ClothConfig>> = {
    silk: { compliance: 0.004, bendCompliance: 0.025, damping: 0.98, totalMass: 0.25 },
    cotton: { compliance: 0.0015, bendCompliance: 0.008, damping: 0.96, totalMass: 0.45 },
    leather: { compliance: 0.0005, bendCompliance: 0.002, damping: 0.92, totalMass: 0.7 },
    stiff: { compliance: 0.0002, bendCompliance: 0.0008, damping: 0.88, totalMass: 0.9 },
};

const CLOTH_PRESET_LABELS: Record<string, string> = {
    silk: '丝绸',
    cotton: '棉布',
    leather: '皮革',
    stiff: '硬质',
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
    shortSkirt: '短裙',
    longSkirt: '长裙',
    cape: '披风',
    tube: '筒裙',
    ribbon: '飘带',
};

export function buildClothParamsLevel(): PopupLevel {
    return {
        label: '布料参数',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                let _recreateTimer: ReturnType<typeof setTimeout> | null = null;
                const debouncedRecreate = () => {
                    if (_recreateTimer) {
                        clearTimeout(_recreateTimer);
                    }
                    _recreateTimer = setTimeout(() => {
                        _recreateTimer = null;
                        recreateCloth();
                    }, 100);
                };

                // 常见样式预设
                const styleLabel = document.createElement('div');
                styleLabel.className = 'cs-top';
                styleLabel.innerHTML =
                    '<span class="cs-label" style="font-size:12px;color:var(--text-muted);">常见样式</span>';
                styleLabel.style.marginBottom = '4px';
                c.appendChild(styleLabel);

                const styleGroup = document.createElement('div');
                styleGroup.className = 'preset-group';
                styleGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(CLOTH_STYLE_PRESETS)) {
                    addPresetChip(styleGroup, CLOTH_STYLE_LABELS[key] || key, false, () => {
                        const preset = CLOTH_STYLE_PRESETS[key];
                        if (preset) {
                            setEnvState({ clothConfig: { ...envState.clothConfig, ...preset } });
                            recreateCloth();
                            import('./scene-menu').then((m) => m.getSceneMenu()?.reRender());
                        }
                    });
                }
                c.appendChild(styleGroup);

                // 材质手感预设
                const feelLabel = document.createElement('div');
                feelLabel.className = 'cs-top';
                feelLabel.innerHTML =
                    '<span class="cs-label" style="font-size:12px;color:var(--text-muted);">材质手感</span>';
                feelLabel.style.marginBottom = '4px';
                c.appendChild(feelLabel);

                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(CLOTH_PRESETS)) {
                    addPresetChip(chipGroup, CLOTH_PRESET_LABELS[key] || key, false, () => {
                        const preset = CLOTH_PRESETS[key];
                        if (preset) {
                            setEnvState({ clothConfig: { ...envState.clothConfig, ...preset } });
                            recreateCloth();
                            import('./scene-menu').then((m) => m.getSceneMenu()?.reRender());
                        }
                    });
                }
                c.appendChild(chipGroup);

                // 自动推算按钮
                slideRow(c, 'lucide:scan', '自动推算尺寸', false, () => {
                    const mmd = modelManager?.focusedMmdModel();
                    if (!mmd) {
                        setStatus('⚠ 请先加载模型', false);
                        return;
                    }
                    const getMat = (name: string) => modelManager?.getBoneWorldMatrix(name) ?? null;
                    const fitted = autoFitClothDimensions(
                        envState.clothConfig.anchorBone || '腰',
                        getMat,
                        mmd.runtimeBones
                    );
                    setEnvState({ clothConfig: { ...envState.clothConfig, ...fitted } });
                    recreateCloth();
                    import('./scene-menu').then((m) => m.getSceneMenu()?.reRender());
                    setStatus(
                        `✓ 已推算: 半径 ${fitted.innerRadius.toFixed(3)}, 长度 ${fitted.length.toFixed(2)}`,
                        true
                    );
                });

                addCollapsible(c, {
                    title: '形状',
                    icon: 'lucide:shirt',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const c2 = envState.clothConfig;
                        addSliderRow(
                            cc,
                            '裙长',
                            c2.length,
                            0.1,
                            2.5,
                            0.05,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, length: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:ruler'
                        );
                        addSliderRow(
                            cc,
                            '裙摆角度',
                            c2.slope,
                            0,
                            45,
                            1,
                            (v) => {
                                setEnvState({ clothConfig: { ...envState.clothConfig, slope: v } });
                                debouncedRecreate();
                            },
                            'lucide:triangle'
                        );
                        addSliderRow(
                            cc,
                            '腰部半径',
                            c2.innerRadius,
                            0.03,
                            1.0,
                            0.01,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, innerRadius: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:circle'
                        );
                    },
                });

                addCollapsible(c, {
                    title: '物理',
                    icon: 'lucide:wind',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const c3 = envState.clothConfig;
                        addSliderRow(
                            cc,
                            '布料柔度',
                            c3.compliance,
                            0,
                            0.01,
                            0.0005,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, compliance: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:wind'
                        );
                        addSliderRow(
                            cc,
                            '弯曲柔度',
                            c3.bendCompliance,
                            0,
                            0.05,
                            0.002,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, bendCompliance: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:curl'
                        );
                        addSliderRow(
                            cc,
                            '阻尼',
                            c3.damping,
                            0.8,
                            0.999,
                            0.01,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, damping: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:droplet'
                        );
                        addSliderRow(
                            cc,
                            '重力倍率',
                            c3.gravityScale,
                            0.1,
                            3,
                            0.1,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, gravityScale: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:arrow-down'
                        );
                    },
                });

                addCollapsible(c, {
                    title: '细分',
                    icon: 'lucide:grid',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const c4 = envState.clothConfig;
                        addSliderRow(
                            cc,
                            '水平分段',
                            c4.segmentsH,
                            12,
                            36,
                            2,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, segmentsH: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:grid'
                        );
                        addSliderRow(
                            cc,
                            '垂直分段',
                            c4.segmentsV,
                            6,
                            24,
                            2,
                            (v) => {
                                setEnvState({
                                    clothConfig: { ...envState.clothConfig, segmentsV: v },
                                });
                                debouncedRecreate();
                            },
                            'lucide:grid'
                        );
                    },
                });

                addCollapsible(c, {
                    title: '碰撞体',
                    icon: 'lucide:shield',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const specs = getColliderSpecs();
                        if (specs.length === 0) {
                            const hint = document.createElement('div');
                            hint.style.cssText =
                                'padding:12px;color:var(--text-muted);font-size:12px;';
                            hint.textContent = '请先启用布料模拟';
                            cc.appendChild(hint);
                            return;
                        }

                        const collider = getCollider();
                        if (collider) {
                            addSliderRow(
                                cc,
                                '碰撞刚度',
                                collider.stiffness,
                                0,
                                1,
                                0.05,
                                (v) => setColliderStiffness(v),
                                'lucide:zap'
                            );
                            addSliderRow(
                                cc,
                                '摩擦系数',
                                collider.friction,
                                0,
                                1,
                                0.05,
                                (v) => setColliderFriction(v),
                                'lucide:hand'
                            );
                        }

                        const groups = [
                            { label: '躯干', items: ['chest', 'waist', 'hip'] },
                            {
                                label: '腿部',
                                items: ['upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR'],
                            },
                            {
                                label: '手臂',
                                items: ['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'],
                            },
                        ];

                        const CAPSULE_LABELS: Record<string, string> = {
                            head: '头部',
                            neck: '颈部',
                            chest: '胸部',
                            waist: '腰部',
                            hip: '臀部',
                            upperArmL: '左上臂',
                            upperArmR: '右上臂',
                            lowerArmL: '左前臂',
                            lowerArmR: '右前臂',
                            upperLegL: '左大腿',
                            upperLegR: '右大腿',
                            lowerLegL: '左小腿',
                            lowerLegR: '右小腿',
                        };

                        for (const group of groups) {
                            addCollapsible(cc, {
                                title: group.label,
                                icon: 'lucide:box',
                                defaultOpen: false,
                                renderContent: (gc) => {
                                    for (const name of group.items) {
                                        const spec = specs.find((s) => s.name === name);
                                        if (!spec) {
                                            continue;
                                        }
                                        const label = CAPSULE_LABELS[name] || name;
                                        addSliderRow(
                                            gc,
                                            `${label} 半径`,
                                            spec.radius,
                                            0.02,
                                            0.3,
                                            0.01,
                                            (v) => setCapsuleRadius(name, v),
                                            'lucide:circle'
                                        );
                                        addSliderRow(
                                            gc,
                                            `${label} 半高`,
                                            spec.halfHeight,
                                            0.02,
                                            0.3,
                                            0.01,
                                            (v) => setCapsuleHalfHeight(name, v),
                                            'lucide:move-vertical'
                                        );
                                    }
                                },
                            });
                        }
                    },
                });
            });
        },
    };
}
