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
    addPresetChip,
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
    setLifelikeEnabled,
    setLifelikeIntensity,
} from '../scene/scene';
import {
    setProcMotionBoneToggle,
    setProcMotionEyeTrackingEnabled,
    setProcMotionHeadTrackingEnabled,
} from '../scene/motion/proc-motion-bridge';
import { getProcMotionBoneCategories } from '../motion-algos/procedural-motion';
import { getMmdRuntimeType, setMmdRuntimeType } from '../core/config';
import type { ProcMotionMode } from '../motion-algos/procedural-motion';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t'; // [doc:adr-059]

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

export function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const lipSt = getLipSyncState();
    return {
        label: t('motion.procMotion'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            // ======== 快速预设 ========
            cardContainer(container, (c) => {
                const group = document.createElement('div');
                group.className = 'preset-group';
                group.style.padding = '0';
                addPresetChip(
                    group,
                    t('motion.modeIdle'),
                    st.mode === 'idle',
                    () => {
                        setProcMotionMode('idle');
                        regenerateProcMotion();
                        getMotionMenu()?.updateControls();
                    },
                    {
                        onUpdate: (btn) =>
                            btn.classList.toggle('active', getProcMotionState().mode === 'idle'),
                    }
                );
                addPresetChip(
                    group,
                    t('motion.modeAutodance'),
                    st.mode === 'autodance',
                    () => {
                        setProcMotionMode('autodance');
                        regenerateProcMotion();
                        getMotionMenu()?.updateControls();
                    },
                    {
                        onUpdate: (btn) =>
                            btn.classList.toggle(
                                'active',
                                getProcMotionState().mode === 'autodance'
                            ),
                    }
                );
                addPresetChip(
                    group,
                    t('motion.modeOff'),
                    st.mode === 'off',
                    () => {
                        setProcMotionMode('off');
                        regenerateProcMotion();
                        getMotionMenu()?.updateControls();
                    },
                    {
                        onUpdate: (btn) =>
                            btn.classList.toggle('active', getProcMotionState().mode === 'off'),
                    }
                );
                c.appendChild(group);
            });

            cardContainer(container, (c) => {
                addModeSlider(
                    c,
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
                    c,
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
                    c,
                    t('motion.lipSync'),
                    lipSt.enabled,
                    (v) => {
                        setLipSyncEnabled(v);
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:mic',
                    {
                        bind: () => getLipSyncState().enabled,
                    }
                );
                addToggleRow(
                    c,
                    t('motion.lifelike'),
                    st.lifelikeEnabled,
                    (v) => {
                        setLifelikeEnabled(v);
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:sparkles',
                    {
                        bind: () => getProcMotionState().lifelikeEnabled,
                    }
                );
            });
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
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
                    c,
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

            // ======== Lifelike 微动叠加强度 ========
            if (st.lifelikeEnabled) {
                cardContainer(container, (c) => {
                    addSliderRow(
                        c,
                        t('motion.lifelikeIntensity'),
                        st.lifelikeIntensity,
                        0,
                        1,
                        0.05,
                        (v) => {
                            setLifelikeIntensity(v);
                        },
                        'lucide:sparkles',
                        undefined,
                        {
                            bind: () => getProcMotionState().lifelikeIntensity,
                        }
                    );
                });
            }

            // ======== 骨骼微动效果（可折叠） ========
            addCollapsible(container, {
                title: t('motion.boneMicro'),
                icon: 'lucide:activity',
                defaultOpen: false,
                renderContent: (inner) => {
                    const cats = getProcMotionBoneCategories();
                    const icons: Record<string, string> = {
                        center: 'lucide:move',
                        upper: 'lucide:activity',
                        upper2: 'lucide:rotate-ccw',
                        waist: 'lucide:uturn-arrow',
                        head: 'lucide:box-select',
                        arm: 'lucide:arm-flex',
                        groove: 'lucide:waves',
                        shoulder: 'lucide:arrow-up-down',
                        allParent: 'lucide:dot',
                        wrist: 'lucide:hand',
                        footIk: 'lucide:footprints',
                        blink: 'lucide:eye',
                        emotion: 'lucide:smile',
                    };
                    // 分组：躯干
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
                    // 分组：上半身
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
                    // 分组：头部
                    addSectionTitle(inner, t('motion.secHead'));
                    for (const cat of ['head', 'blink', 'emotion'] as const) {
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
                    // 分组：末端
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
                },
            });

            // ======== 视线追踪（可折叠） ========
            addCollapsible(container, {
                title: t('motion.gazeTracking'),
                icon: 'lucide:eye',
                defaultOpen: false,
                renderContent: (inner) => {
                    addToggleRow(
                        inner,
                        t('motion.eyeFollow'),
                        st.eyeTrackingEnabled,
                        (v) => {
                            setProcMotionEyeTrackingEnabled(v);
                            getMotionMenu()?.updateControls();
                        },
                        'lucide:eye',
                        {
                            bind: () => getProcMotionState().eyeTrackingEnabled,
                        }
                    );
                    addToggleRow(
                        inner,
                        t('motion.headFollow'),
                        st.headTrackingEnabled,
                        (v) => {
                            setProcMotionHeadTrackingEnabled(v);
                            getMotionMenu()?.updateControls();
                        },
                        'lucide:mouse-pointer-2',
                        {
                            bind: () => getProcMotionState().headTrackingEnabled,
                        }
                    );
                },
            });

            // ======== 高级设置 ========
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    t('motion.runtime'),
                    [
                        { value: 'wasm' as const, label: t('motion.runtimeWasm') },
                        { value: 'js' as const, label: t('motion.runtimeJs') },
                    ],
                    getMmdRuntimeType(),
                    (v) => {
                        if (v === getMmdRuntimeType()) {
                            return;
                        }
                        (async () => {
                            const ok = await showConfirm(
                                v === 'js' ? t('motion.confirmJs') : t('motion.confirmWasm')
                            );
                            if (!ok) {
                                getMotionMenu()?.updateControls();
                                return;
                            }
                            setMmdRuntimeType(v);
                            location.reload();
                        })();
                    },
                    'lucide:cpu',
                    undefined,
                    {
                        bind: () => getMmdRuntimeType(),
                    }
                );
                addModeSlider(
                    c,
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
    };
}

export function buildProcMotionModeLevel(): PopupLevel {
    const st = getProcMotionState();
    const modes: { mode: ProcMotionMode; label: string; icon: string }[] = [
        { mode: 'off', label: t('motion.modeOff'), icon: st.mode === 'off' ? 'check' : 'circle' },
        { mode: 'idle', label: t('motion.modeIdle'), icon: st.mode === 'idle' ? 'check' : 'circle' },
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
