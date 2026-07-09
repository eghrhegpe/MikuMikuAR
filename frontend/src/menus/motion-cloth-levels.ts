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
import { t } from '../core/i18n/t'; // [doc:adr-059]

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

// [doc:adr-059] 预设名 → i18n key（模块级，运行时 t() 以支持热切换）
const CLOTH_PRESET_KEYS: Record<string, string> = {
    silk: 'motion.clothSilk',
    cotton: 'motion.clothCotton',
    leather: 'motion.clothLeather',
    stiff: 'motion.clothStiff',
};

/** 布料预设 — 常见服装样式（拓扑 + 形状） */
const CLOTH_STYLE_PRESETS: Record<string, Partial<ClothConfig>> = {
    shortSkirt: { topology: 'skirt', length: 0.35, slope: 25, segmentsV: 8, innerRadius: 0.14 },
    longSkirt: { topology: 'skirt', length: 1.1, slope: 8, segmentsV: 16, innerRadius: 0.16 },
    cape: { topology: 'cape', length: 0.7, slope: 30, segmentsV: 10, innerRadius: 0.12 },
    tube: { topology: 'tube', length: 0.5, slope: 5, segmentsV: 12, innerRadius: 0.13 },
    ribbon: { topology: 'rope', length: 1.4, slope: 0, segmentsV: 20, innerRadius: 0.08 },
};

// [doc:adr-059] 样式名 → i18n key（模块级，运行时 t()）
const CLOTH_STYLE_KEYS: Record<string, string> = {
    shortSkirt: 'motion.styleShortSkirt',
    longSkirt: 'motion.styleLongSkirt',
    cape: 'motion.styleCape',
    tube: 'motion.styleTube',
    ribbon: 'motion.styleRibbon',
};

export function buildClothParamsLevel(): PopupLevel {
    return {
        label: t('motion.clothTitle'),
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
                    '<span class="cs-label" style="font-size:12px;color:var(--text-muted);">' +
                    t('motion.commonStyles') +
                    '</span>';
                styleLabel.style.marginBottom = '4px';
                c.appendChild(styleLabel);

                const styleGroup = document.createElement('div');
                styleGroup.className = 'preset-group';
                styleGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(CLOTH_STYLE_PRESETS)) {
                    addPresetChip(styleGroup, t(CLOTH_STYLE_KEYS[key] || key), false, () => {
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
                    '<span class="cs-label" style="font-size:12px;color:var(--text-muted);">' +
                    t('motion.materialFeel') +
                    '</span>';
                feelLabel.style.marginBottom = '4px';
                c.appendChild(feelLabel);

                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(CLOTH_PRESETS)) {
                    addPresetChip(chipGroup, t(CLOTH_PRESET_KEYS[key] || key), false, () => {
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
                slideRow(c, 'lucide:scan', t('motion.autoFit'), false, () => {
                    const mmd = modelManager?.focusedMmdModel();
                    if (!mmd) {
                        setStatus(t('motion.loadModelFirst'), false);
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
                        t('motion.fitted', {
                            r: fitted.innerRadius.toFixed(3),
                            l: fitted.length.toFixed(2),
                        }),
                        true
                    );
                });

                addCollapsible(c, {
                    title: t('motion.shape'),
                    icon: 'lucide:shirt',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const c2 = envState.clothConfig;
                        addSliderRow(
                            cc,
                            t('motion.skirtLength'),
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
                            t('motion.skirtSlope'),
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
                            t('motion.waistRadius'),
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
                    title: t('motion.physics'),
                    icon: 'lucide:wind',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const c3 = envState.clothConfig;
                        addSliderRow(
                            cc,
                            t('motion.clothCompliance'),
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
                            t('motion.bendCompliance'),
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
                            'lucide:wind'
                        );
                        addSliderRow(
                            cc,
                            t('motion.damping'),
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
                            t('motion.gravityScale'),
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
                    title: t('motion.subdiv'),
                    icon: 'lucide:grid',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const c4 = envState.clothConfig;
                        addSliderRow(
                            cc,
                            t('motion.segH'),
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
                            t('motion.segV'),
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
                    title: t('motion.collider'),
                    icon: 'lucide:shield',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        const specs = getColliderSpecs();
                        if (specs.length === 0) {
                            const hint = document.createElement('div');
                            hint.style.cssText =
                                'padding:12px;color:var(--text-muted);font-size:12px;';
                            hint.textContent = t('motion.enableClothFirst');
                            cc.appendChild(hint);
                            return;
                        }

                        const collider = getCollider();
                        if (collider) {
                            addSliderRow(
                                cc,
                                t('motion.colliderStiffness'),
                                collider.stiffness,
                                0,
                                1,
                                0.05,
                                (v) => setColliderStiffness(v),
                                'lucide:zap'
                            );
                            addSliderRow(
                                cc,
                                t('motion.friction'),
                                collider.friction,
                                0,
                                1,
                                0.05,
                                (v) => setColliderFriction(v),
                                'lucide:hand'
                            );
                        }

                        const groups = [
                            { label: t('motion.torso'), items: ['chest', 'waist', 'hip'] },
                            {
                                label: t('motion.legs'),
                                items: ['upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR'],
                            },
                            {
                                label: t('motion.arms'),
                                items: ['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'],
                            },
                        ];

                        const CAPSULE_LABELS: Record<string, string> = {
                            head: t('motion.capsuleHead'),
                            neck: t('motion.capsuleNeck'),
                            chest: t('motion.capsuleChest'),
                            waist: t('motion.capsuleWaist'),
                            hip: t('motion.capsuleHip'),
                            upperArmL: t('motion.capsuleUpperArmL'),
                            upperArmR: t('motion.capsuleUpperArmR'),
                            lowerArmL: t('motion.capsuleLowerArmL'),
                            lowerArmR: t('motion.capsuleLowerArmR'),
                            upperLegL: t('motion.capsuleUpperLegL'),
                            upperLegR: t('motion.capsuleUpperLegR'),
                            lowerLegL: t('motion.capsuleLowerLegL'),
                            lowerLegR: t('motion.capsuleLowerLegR'),
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
                                            t('motion.radiusOf', { label }),
                                            spec.radius,
                                            0.02,
                                            0.3,
                                            0.01,
                                            (v) => setCapsuleRadius(name, v),
                                            'lucide:circle'
                                        );
                                        addSliderRow(
                                            gc,
                                            t('motion.halfHeightOf', { label }),
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
