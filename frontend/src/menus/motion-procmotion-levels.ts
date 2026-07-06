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

export function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const lipSt = getLipSyncState();
    return {
        label: '程序化动作',
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
                    '待机呼吸',
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
                    '自动舞蹈',
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
                    '关闭',
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
                    '程序化动作',
                    [
                        { value: 'off' as const, label: '关闭' },
                        { value: 'idle' as const, label: '待机呼吸' },
                        { value: 'autodance' as const, label: '自动舞蹈' },
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
                    '自动切换',
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
                    'LipSync',
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
                    '微动叠加',
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
                    '动作强度',
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
                    '速度',
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
                        '微动强度',
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
                title: '骨骼微动效果',
                icon: 'lucide:activity',
                defaultOpen: false,
                renderContent: (inner) => {
                    const cats = getProcMotionBoneCategories();
                    const labels: Record<string, string> = {
                        center: '重心弹跳',
                        upper: '上半身呼吸',
                        upper2: '上半身2扭转',
                        waist: '腰部扭胯',
                        head: '头部点头',
                        arm: '手臂摆动',
                        groove: 'Groove微晃',
                        shoulder: '肩部耸肩',
                        allParent: '全親微晃',
                        wrist: '手腕节拍',
                        footIk: '足IK踏步',
                        blink: '眨眼',
                        emotion: '表情情绪轮',
                    };
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
                    addSectionTitle(inner, '躯干');
                    for (const cat of ['center', 'allParent', 'waist', 'groove'] as const) {
                        if (cats.includes(cat)) {
                            addToggleRow(
                                inner,
                                labels[cat] ?? cat,
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
                    addSectionTitle(inner, '上半身');
                    for (const cat of ['upper', 'upper2', 'shoulder', 'arm'] as const) {
                        if (cats.includes(cat)) {
                            addToggleRow(
                                inner,
                                labels[cat] ?? cat,
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
                    addSectionTitle(inner, '头部');
                    for (const cat of ['head', 'blink', 'emotion'] as const) {
                        if (cats.includes(cat)) {
                            addToggleRow(
                                inner,
                                labels[cat] ?? cat,
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
                    addSectionTitle(inner, '末端');
                    for (const cat of ['wrist', 'footIk'] as const) {
                        if (cats.includes(cat)) {
                            addToggleRow(
                                inner,
                                labels[cat] ?? cat,
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
                title: '视线追踪',
                icon: 'lucide:eye',
                defaultOpen: false,
                renderContent: (inner) => {
                    addToggleRow(
                        inner,
                        '眼部跟随',
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
                        '头部跟随',
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
                    '运行时',
                    [
                        { value: 'wasm' as const, label: 'WASM 物理' },
                        { value: 'js' as const, label: 'JS 调试' },
                    ],
                    getMmdRuntimeType(),
                    (v) => {
                        if (v === getMmdRuntimeType()) {
                            return;
                        }
                        (async () => {
                            const ok = await showConfirm(
                                v === 'js'
                                    ? '切换到 JS 调试模式将丢失当前场景并重新加载（无物理）。继续？'
                                    : '切换到 WASM 物理模式将丢失当前场景并重新加载。继续？'
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
                    '插值曲线',
                    [
                        { value: 'auto' as const, label: '自动' },
                        { value: 'sharp' as const, label: '锐利' },
                        { value: 'ease-in-out' as const, label: '缓入缓出' },
                        { value: 'ease-out' as const, label: '缓出' },
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
        { mode: 'off', label: '关闭', icon: st.mode === 'off' ? 'check' : 'circle' },
        { mode: 'idle', label: '待机呼吸', icon: st.mode === 'idle' ? 'check' : 'circle' },
        {
            mode: 'autodance',
            label: '自动舞蹈',
            icon: st.mode === 'autodance' ? 'check' : 'circle',
        },
    ];
    return {
        label: '程序化动作模式',
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
        label: 'LipSync',
        dir: '',
        items: [
            {
                kind: 'action',
                label: '启用',
                icon: st.enabled ? 'check' : 'circle',
                target: 'lipsync:toggle',
                sublabel: st.enabled ? '开' : '关',
            },
        ],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    '灵敏度',
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
                    '强度',
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
