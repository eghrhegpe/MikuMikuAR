// [doc:architecture] Scene ProcMotion Levels — 程序化动作/LipSync 弹窗层级
// 从 scene-menu.ts 拆分

import { cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import {
    addSliderRow,
    addToggleRow,
    addModeSlider,
    addCollapsible,
    addSectionTitle,
} from '../core/ui-helpers';
import { showConfirm } from '../core/dialog';
import {
    setProcMotionMode,
    setProcMotionIntensity,
    setProcMotionSpeed,
    setProcMotionAutoSwitch,
    getProcMotionState,
    regenerateProcMotion,
    getLipSyncState,
    setLipSyncEnabled,
    setLipSyncSensitivity,
    setLipSyncIntensity,
    setProcMotionInterpOverride,
} from '../scene/scene';
import {
    setProcMotionBoneToggle,
    setProcMotionEyeTrackingEnabled,
    setProcMotionHeadTrackingEnabled,
} from '../scene/motion/proc-motion-bridge';
import { getProcMotionBoneCategories } from '../motion-algos/procedural-motion';
import type { ProcMotionMode } from '../motion-algos/procedural-motion';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// [doc:adr-059] 骨骼微动类别 → i18n key（模块级，运行时 t() 支持热切换）
const BONE_LABEL_KEYS: Record<string, string> = {
    center: 'motion.boneCenter',
    upper: 'motion.boneUpper',
    upper2: 'motion.boneUpper2',
    waist: 'motion.boneWaist',
    head: 'motion.boneHead',
    arm: 'motion.boneArm',
    groove: 'motion.boneGroove',
    shoulder: 'motion.boneShoulder',
    allParent: 'motion.boneAllParent',
    wrist: 'motion.boneWrist',
    footIk: 'motion.boneFootIk',
    blink: 'motion.boneBlink',
    emotion: 'motion.boneEmotion',
};

function buildProcMotionSchema(): MenuNode[] {
    const st = getProcMotionState();

    return [
        // 卡片 1：主开关
        {
            id: 'procmotion:main',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addModeSlider(
                        inner,
                        t('motion.procMotion'),
                        [
                            { value: 'off' as const, label: t('motion.modeOff') },
                            { value: 'idle' as const, label: t('motion.modeIdle') },
                            { value: 'autodance' as const, label: t('motion.modeAutodance') },
                        ],
                        st.mode,
                        (v) => {
                            setProcMotionMode(v);
                            regenerateProcMotion();
                        },
                        'lucide:wind',
                        undefined,
                        {
                            bind: () => getProcMotionState().mode,
                        }
                    );
                    addToggleRow(
                        inner,
                        t('motion.autoSwitch'),
                        st.autoSwitch,
                        (v) => {
                            setProcMotionAutoSwitch(v);
                        },
                        'lucide:repeat',
                        {
                            bind: () => getProcMotionState().autoSwitch,
                        }
                    );
                    addToggleRow(
                        inner,
                        t('motion.lipSync'),
                        getLipSyncState().enabled,
                        (v) => {
                            setLipSyncEnabled(v);
                            getMotionMenu()?.updateControls();
                        },
                        'lucide:mic',
                        {
                            bind: () => getLipSyncState().enabled,
                        }
                    );
                    });
            },
        },
        // 卡片 2：强度/速度
        {
            id: 'procmotion:params',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSliderRow(
                        inner,
                        t('motion.intensity'),
                        st.intensity,
                        0,
                        1,
                        0.05,
                        (v) => {
                            setProcMotionIntensity(v);
                            regenerateProcMotion();
                        },
                        'lucide:activity',
                        undefined,
                        {
                            bind: () => getProcMotionState().intensity,
                        }
                    );
                    addSliderRow(
                        inner,
                        t('motion.speed'),
                        st.speed,
                        0.5,
                        2,
                        0.05,
                        (v) => {
                            setProcMotionSpeed(v);
                            regenerateProcMotion();
                        },
                        'lucide:fast-forward',
                        undefined,
                        {
                            bind: () => getProcMotionState().speed,
                        }
                    );
                });
            },
        },
        // 卡片 3：骨骼微动（folder 折叠）
        {
            id: 'procmotion:boneMicro',
            kind: 'folder',
            label: 'motion.boneMicro',
            icon: 'lucide:activity',
            defaultOpen: false,
            children: [
                {
                    id: 'procmotion:boneMicro-content',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            const cats = getProcMotionBoneCategories();
                            const icons: Record<string, string> = {
                                center: 'lucide:move',
                                upper: 'lucide:activity',
                                upper2: 'lucide:rotate-ccw',
                                waist: 'lucide:undo-2',
                                head: 'lucide:box-select',
                                arm: 'lucide:biceps-flexed',
                                groove: 'lucide:waves',
                                shoulder: 'lucide:arrow-up-down',
                                allParent: 'lucide:dot',
                                wrist: 'lucide:hand',
                                footIk: 'lucide:footprints',
                                blink: 'lucide:eye',
                                emotion: 'lucide:smile',
                            };
                            addSectionTitle(inner, t('motion.secTorso'));
                            for (const cat of ['center', 'allParent', 'waist', 'groove'] as const) {
                                if (cats.includes(cat)) {
                                    addToggleRow(
                                        inner,
                                        t(BONE_LABEL_KEYS[cat] || cat),
                                        st.boneToggles[cat],
                                        (v) => {
                                            setProcMotionBoneToggle(cat, v);
                                            regenerateProcMotion();
                                        },
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => getProcMotionState().boneToggles[cat],
                                        }
                                    );
                                }
                            }
                            addSectionTitle(inner, t('motion.secUpper'));
                            for (const cat of ['upper', 'upper2', 'shoulder', 'arm'] as const) {
                                if (cats.includes(cat)) {
                                    addToggleRow(
                                        inner,
                                        t(BONE_LABEL_KEYS[cat] || cat),
                                        st.boneToggles[cat],
                                        (v) => {
                                            setProcMotionBoneToggle(cat, v);
                                            regenerateProcMotion();
                                        },
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => getProcMotionState().boneToggles[cat],
                                        }
                                    );
                                }
                            }
                            addSectionTitle(inner, t('motion.secHead'));
                            for (const cat of ['emotion'] as const) {
                                if (cats.includes(cat)) {
                                    addToggleRow(
                                        inner,
                                        t(BONE_LABEL_KEYS[cat] || cat),
                                        st.boneToggles[cat],
                                        (v) => {
                                            setProcMotionBoneToggle(cat, v);
                                            regenerateProcMotion();
                                        },
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => getProcMotionState().boneToggles[cat],
                                        }
                                    );
                                }
                            }
                            addSectionTitle(inner, t('motion.secEnd'));
                            for (const cat of ['wrist', 'footIk'] as const) {
                                if (cats.includes(cat)) {
                                    addToggleRow(
                                        inner,
                                        t(BONE_LABEL_KEYS[cat] || cat),
                                        st.boneToggles[cat],
                                        (v) => {
                                            setProcMotionBoneToggle(cat, v);
                                            regenerateProcMotion();
                                        },
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => getProcMotionState().boneToggles[cat],
                                        }
                                    );
                                }
                            }
                        });
                    },
                },
            ],
        },
        // 卡片 5：高级设置
        {
            id: 'procmotion:advanced',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addModeSlider(
                        inner,
                        t('motion.interpCurve'),
                        [
                            { value: 'auto' as const, label: t('motion.interpAuto') },
                            { value: 'sharp' as const, label: t('motion.interpSharp') },
                            { value: 'ease-in-out' as const, label: t('motion.interpEaseInOut') },
                            { value: 'ease-out' as const, label: t('motion.interpEaseOut') },
                        ],
                        st.interpOverride,
                        (v) => {
                            setProcMotionInterpOverride(v);
                            regenerateProcMotion();
                        },
                        'lucide:sliders',
                        undefined,
                        {
                            bind: () => getProcMotionState().interpOverride,
                        }
                    );
                });
            },
        },
    ];
}

export function buildProcMotionLevel(): PopupLevel {
    return {
        label: t('motion.procMotion'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildProcMotionSchema(), container);
        },
    };
}

export function buildProcMotionModeLevel(): PopupLevel {
    const st = getProcMotionState();
    const modes: { mode: ProcMotionMode; label: string; icon: string }[] = [
        { mode: 'off', label: t('motion.modeOff'), icon: st.mode === 'off' ? 'check' : 'circle' },
        {
            mode: 'idle',
            label: t('motion.modeIdle'),
            icon: st.mode === 'idle' ? 'check' : 'circle',
        },
        {
            mode: 'autodance',
            label: t('motion.modeAutodance'),
            icon: st.mode === 'autodance' ? 'check' : 'circle',
        },
    ];
    return {
        label: t('motion.procMotionMode'),
        dir: '',
        items: modes.map((m) => ({
            kind: 'action' as const,
            label: m.label,
            icon: m.icon,
            target: `procmotion:set-mode:${m.mode}`,
        })),
    };
}

export function buildLipSyncLevel(): PopupLevel {
    const st = getLipSyncState();
    return {
        label: t('motion.lipSync'),
        dir: '',
        items: [
            {
                kind: 'action',
                label: t('motion.enable'),
                icon: st.enabled ? 'check' : 'circle',
                target: 'lipsync:toggle',
                sublabel: st.enabled ? t('motion.on') : t('motion.off'),
            },
        ],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    t('motion.sensitivity'),
                    1 - st.sensitivity,
                    0,
                    1,
                    0.05,
                    (v) => {
                        setLipSyncSensitivity(1 - v);
                    },
                    'lucide:volume-2',
                    undefined,
                    {
                        bind: () => 1 - getLipSyncState().sensitivity,
                    }
                );
                addSliderRow(
                    c,
                    t('motion.intensity'),
                    st.intensity,
                    0,
                    1,
                    0.05,
                    (v) => {
                        setLipSyncIntensity(v);
                    },
                    'lucide:activity',
                    undefined,
                    {
                        bind: () => getLipSyncState().intensity,
                    }
                );
            });
        },
    };
}
