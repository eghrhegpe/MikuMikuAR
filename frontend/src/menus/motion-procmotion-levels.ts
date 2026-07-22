// [doc:architecture] Scene ProcMotion Levels — 程序化动作弹窗层级
// 从 scene-menu.ts 拆分

import { cardContainer, modelRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addSliderRow, addToggleRow, addModeSlider, addSectionTitle } from '../core/ui-helpers';
import {
    setProcMotionMode,
    setProcMotionIntensity,
    setProcMotionSpeed,
    getProcMotionState,
    regenerateProcMotion,
    setProcMotionInterpOverride,
} from '../scene/scene';
import { setProcMotionBoneToggle } from '../scene/motion/proc-motion-bridge';
import { getProcMotionBoneCategories } from '../motion-algos/procedural-motion';
import type { ProcMotionMode, ProcMotionState } from '../motion-algos/procedural-motion';
import { DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';
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

/** 获取 per-model 程序化状态（有则用，无则回退全局）。
 *  [fix:state-ref] 返回拷贝而非引用，防止 UI 意外 mutate modelRegistry 内状态。 */
function _getProcState(modelId?: string): ProcMotionState {
    if (modelId) {
        const inst = modelRegistry.get(modelId);
        if (inst?.procMotion) {
            return { ...inst.procMotion }; // 拷贝，防引用泄漏
        }
    }
    return getProcMotionState();
}

/** 写入 per-model 程序化状态 */
function _setProcState(modelId: string, patch: Partial<ProcMotionState>): void {
    const inst = modelRegistry.get(modelId);
    if (inst) {
        inst.procMotion = { ...(inst.procMotion ?? DEFAULT_PROC_STATE), ...patch };
    }
}

function buildProcMotionSchema(modelId?: string): MenuNode[] {
    const st = _getProcState(modelId);

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
                            if (modelId) {
                                _setProcState(modelId, { mode: v });
                                regenerateProcMotion(modelId);
                            } else {
                                setProcMotionMode(v);
                                regenerateProcMotion();
                            }
                        },
                        'lucide:wind',
                        undefined,
                        {
                            bind: () => _getProcState(modelId).mode,
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
                            if (modelId) {
                                _setProcState(modelId, { intensity: v });
                                regenerateProcMotion(modelId);
                            } else {
                                setProcMotionIntensity(v);
                                regenerateProcMotion();
                            }
                        },
                        'lucide:activity',
                        undefined,
                        {
                            bind: () => _getProcState(modelId).intensity,
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
                            if (modelId) {
                                _setProcState(modelId, { speed: v });
                                regenerateProcMotion(modelId);
                            } else {
                                setProcMotionSpeed(v);
                                regenerateProcMotion();
                            }
                        },
                        'lucide:fast-forward',
                        undefined,
                        {
                            bind: () => _getProcState(modelId).speed,
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
                            const toggleBone = (cat: (typeof cats)[number], v: boolean) => {
                                if (modelId) {
                                    const cur = _getProcState(modelId);
                                    _setProcState(modelId, {
                                        boneToggles: { ...cur.boneToggles, [cat]: v },
                                    });
                                    regenerateProcMotion(modelId);
                                } else {
                                    setProcMotionBoneToggle(cat, v);
                                    regenerateProcMotion();
                                }
                            };
                            addSectionTitle(inner, t('motion.secTorso'));
                            for (const cat of ['center', 'allParent', 'waist', 'groove'] as const) {
                                if (cats.includes(cat)) {
                                    addToggleRow(
                                        inner,
                                        t(BONE_LABEL_KEYS[cat] || cat),
                                        st.boneToggles[cat],
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcState(modelId).boneToggles[cat],
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
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcState(modelId).boneToggles[cat],
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
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcState(modelId).boneToggles[cat],
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
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcState(modelId).boneToggles[cat],
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
                            if (modelId) {
                                _setProcState(modelId, { interpOverride: v });
                                regenerateProcMotion(modelId);
                            } else {
                                setProcMotionInterpOverride(v);
                                regenerateProcMotion();
                            }
                        },
                        'lucide:sliders',
                        undefined,
                        {
                            bind: () => _getProcState(modelId).interpOverride,
                        }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildProcMotionLevel(modelId?: string): PopupLevel {
    return {
        label: t('motion.procMotion'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildProcMotionSchema(modelId), container);
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
