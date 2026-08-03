// [doc:architecture] Scene ProcMotion Levels — 程序化动作弹窗层级
// 从 scene-menu.ts 拆分

import { cardContainer, modelRegistry } from '../core/config';
import type { PopupLevel, PopupRow } from '../core/config';
import { addSliderRow, addToggleRow, addModeSlider, addSectionTitle, buildPresetChipGroup } from '../core/ui-helpers';
import {
    setProcMotionMode,
    setProcMotionIntensity,
    setProcMotionSpeed,
    getProcMotionState,
    regenerateProcMotion,
    setProcMotionInterpOverride,
    triggerAutoSave,
} from '../scene/scene';
import { setProcMotionBoneToggles } from '../scene/motion/proc-motion-bridge';
import { getProcMotionBoneCategories } from '../motion-algos/procedural-motion';
import { getProcPresetSet, getProcParamsPreset } from '../motion-algos/proc-motion-presets';
import type {
    ProcMotionState,
    ProcModeKey,
    ProcMotionParams,
    ProcMotionBoneCategory,
} from '../motion-algos/procedural-motion';
import { DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import type { MenuNode } from './menu-schema';
import {
    getAllLoadableProcMotions,
    getLoadedProceduralMotions,
    loadProceduralMotion,
    unloadProceduralMotion,
} from '../scene/motion/motion-intent';
import type { LoadableProcId } from '../scene/motion/motion-intent';
import { getMotionMenu, refreshMotionRoot } from './motion-popup';

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

/** [audit] per-mode：读取指定程序化模式的参数（无则回退默认）。 */
function _getProcParams(modelId: string | undefined, mode: ProcModeKey): ProcMotionParams {
    const st = _getProcState(modelId);
    const src = st.params?.[mode] ?? DEFAULT_PROC_STATE.params[mode];
    // [fix:P4] boneToggles 同步深拷贝：浅拷贝会与 modelRegistry 内真值 / 模块级默认常量
    // 共引用，调用方原地写入将穿透污染 per-model 状态或全局默认。
    return { ...src, boneToggles: { ...src.boneToggles } };
}

/** per-mode 参数补丁：boneToggles 允许部分键（骨骼微动逐键 toggle 场景）。 */
type ProcParamsPatch = Partial<Omit<ProcMotionParams, 'boneToggles'>> & {
    boneToggles?: Partial<Record<ProcMotionBoneCategory, boolean>>;
};

/** [audit] per-mode：写入 per-model 指定模式的参数（modelId 路径；全局路径由 bridge setter 处理）。 */
function _setProcParams(
    modelId: string | undefined,
    mode: ProcModeKey,
    patch: ProcParamsPatch
): void {
    if (modelId) {
        const inst = modelRegistry.get(modelId);
        if (inst) {
            const cur = inst.procMotion ?? DEFAULT_PROC_STATE;
            inst.procMotion = {
                ...cur,
                params: {
                    ...cur.params,
                    [mode]: { ...(cur.params?.[mode] ?? DEFAULT_PROC_STATE.params[mode]), ...patch },
                },
            };
        }
    }
}

/**
 * [audit] per-mode 参数统一写入入口：收口 intensity / speed / boneToggles / interpOverride
 * 四处重复的 `if (modelId) {...} else {...}` 双分支。
 * - modelId 路径：直写 per-model 状态 + 按模型重生成；
 * - 全局路径：委托 bridge setter（内部自带 triggerAutoSave + regenerateProcMotion，勿重复调用）。
 */
function _applyProcParam(
    modelId: string | undefined,
    mode: ProcModeKey,
    patch: ProcParamsPatch
): void {
    if (modelId) {
        // boneToggles 需与现有值逐键合并：_setProcParams 是浅合并，直接覆盖会整体替换
        const full: ProcParamsPatch = { ...patch };
        if (patch.boneToggles) {
            const cur = _getProcParams(modelId, mode).boneToggles;
            full.boneToggles = { ...cur, ...patch.boneToggles };
        }
        _setProcParams(modelId, mode, full);
        // [fix:persist] 与全局路径（bridge setter 内部 triggerAutoSave）对齐：
        // per-model 参数直写 modelRegistry 不触发 autosave，需显式触发落盘
        triggerAutoSave();
        regenerateProcMotion(modelId);
        return;
    }
    if (patch.intensity !== undefined) setProcMotionIntensity(mode, patch.intensity);
    if (patch.speed !== undefined) setProcMotionSpeed(mode, patch.speed);
    if (patch.boneToggles !== undefined) setProcMotionBoneToggles(mode, patch.boneToggles);
    if (patch.interpOverride !== undefined) setProcMotionInterpOverride(mode, patch.interpOverride);
}

export function buildProcMotionSchema(modelId?: string, mode: ProcModeKey = 'idle'): MenuNode[] {
    const st = _getProcState(modelId);
    const prm = _getProcParams(modelId, mode);

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
                                const inst = modelRegistry.get(modelId);
                                if (inst) {
                                    inst.procMotion = {
                                        ...(inst.procMotion ?? DEFAULT_PROC_STATE),
                                        mode: v,
                                    };
                                }
                                // [fix:persist] per-model 直写不触发 autosave，与全局分支
                                // （setProcMotionMode 内部 triggerAutoSave）对齐后显式落盘
                                triggerAutoSave();
                                regenerateProcMotion(modelId);
                            } else {
                                setProcMotionMode(v);
                                regenerateProcMotion();
                            }
                            // [audit] 模式切换后刷新详情页「当前动作」标签（proc 名跟随 mode）
                            getMotionMenu()?.reRender();
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
        // 卡片 2：参数预设（当前 mode 的参数快照，一键应用）
        {
            id: 'procmotion:presets',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('motion.procPresets'));
                    buildPresetChipGroup(
                        inner,
                        Object.entries(getProcPresetSet(mode)).map(([id, preset]) => {
                            const current = _getProcParams(modelId, mode);
                            const presetParams = getProcParamsPreset(mode, id)?.params;
                            const isActive = !!presetParams &&
                                Math.abs(current.intensity - presetParams.intensity) < 1e-6 &&
                                Math.abs(current.speed - presetParams.speed) < 1e-6 &&
                                current.interpOverride === presetParams.interpOverride;
                            return {
                                label: t(preset.label),
                                isActive: () => isActive,
                                onClick: () => {
                                    _applyProcParam(modelId, mode, preset.params);
                                    regenerateProcMotion(modelId);
                                    getMotionMenu()?.reRender();
                                },
                            };
                        })
                    );
                });
            },
        },
        // 卡片 3：强度/速度（per-mode：绑定 mode 专属参数）
        {
            id: 'procmotion:params',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSliderRow(
                        inner,
                        t('motion.intensity'),
                        prm.intensity,
                        0,
                        1,
                        0.05,
                        (v) => _applyProcParam(modelId, mode, { intensity: v }),
                        'lucide:activity',
                        undefined,
                        {
                            bind: () => _getProcParams(modelId, mode).intensity,
                        }
                    );
                    addSliderRow(
                        inner,
                        t('motion.speed'),
                        prm.speed,
                        0.5,
                        2,
                        0.05,
                        (v) => _applyProcParam(modelId, mode, { speed: v }),
                        'lucide:fast-forward',
                        undefined,
                        {
                            bind: () => _getProcParams(modelId, mode).speed,
                        }
                    );
                });
            },
        },
        // 卡片 3：骨骼微动（folder 折叠）
        {
            id: 'procmotion:bone-micro',
            kind: 'folder',
            label: 'motion.boneMicro',
            icon: 'lucide:activity',
            defaultOpen: false,
            children: [
                {
                    id: 'procmotion:bone-micro-content',
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
                                _applyProcParam(modelId, mode, { boneToggles: { [cat]: v } });
                            };
                            addSectionTitle(inner, t('motion.secTorso'));
                            for (const cat of ['center', 'allParent', 'waist', 'groove'] as const) {
                                if (cats.includes(cat)) {
                                    addToggleRow(
                                        inner,
                                        t(BONE_LABEL_KEYS[cat] || cat),
                                        prm.boneToggles[cat],
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcParams(modelId, mode).boneToggles[cat],
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
                                        prm.boneToggles[cat],
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcParams(modelId, mode).boneToggles[cat],
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
                                        prm.boneToggles[cat],
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcParams(modelId, mode).boneToggles[cat],
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
                                        prm.boneToggles[cat],
                                        (v) => toggleBone(cat, v),
                                        icons[cat] ?? 'lucide:circle',
                                        {
                                            bind: () => _getProcParams(modelId, mode).boneToggles[cat],
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
                        prm.interpOverride,
                        (v) => _applyProcParam(modelId, mode, { interpOverride: v }),
                        'lucide:sliders',
                        undefined,
                        {
                            bind: () => _getProcParams(modelId, mode).interpOverride,
                        }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

// [doc:adr-207] 程序化动作库子页（加载/卸载）
// ═══════════════════════════════════════════════════════════

const PROC_LABELS: Record<LoadableProcId, () => string> = {
    none: () => t('motion.proc.none'),
    idle: () => t('motion.modeIdle'),
    autodance: () => t('motion.modeAutodance'),
};

/** [doc:adr-207] 程序化动作 ID → 显示名（跨模块复用，避免标签逻辑重复）。 */
export function procLabel(id: LoadableProcId): string {
    return PROC_LABELS[id]();
}

export function buildProcLibraryLevel(): PopupLevel {
    return {
        label: t('motion.procMotion'),
        dir: '',
        // items 初值不可留空：motion-popup 的通用路由适配器 (motionOnFolderEnter)
        // 以 `() => builder().items` 读取行，若仅挂 itemBuilder 则渲染为「暂无内容」。
        items: _buildProcLibraryItems(),
        itemBuilder: () => _buildProcLibraryItems(),
    };
}

function _buildProcLibraryItems(): PopupRow[] {
    const items: PopupRow[] = [];
    const loaded = getLoadedProceduralMotions();
    for (const procId of getAllLoadableProcMotions()) {
        const isLoaded = loaded.has(procId);
        const isNone = procId === 'none';
        items.push({
            kind: 'action',
            label: PROC_LABELS[procId](),
            icon: isNone ? 'lucide:circle-slash' : 'lucide:wand-sparkles',
            target: '',
            sublabel: isLoaded ? (isNone ? t('motion.proc.alwaysLoaded') : undefined) : undefined,
            rowKey: `proc-lib:${procId}:${isLoaded ? 'on' : 'off'}`,
            trailing: isLoaded
                ? isNone
                    ? undefined // 'none' 不可卸载
                    : {
                          icon: 'lucide:minus-circle',
                          title: t('motion.proc.unload'),
                          danger: true,
                          onClick: () => {
                              unloadProceduralMotion(procId);
                              // [fix:proc-refresh] 刷新根层：reRender 只重建当前层（库页），
                              // 返回根层时「已加载程序化动作」区仍读旧 items 快照
                              refreshMotionRoot();
                          },
                      }
                : {
                      icon: 'lucide:plus-circle',
                      title: t('motion.proc.load'),
                      onClick: () => {
                          loadProceduralMotion(procId);
                          // [fix:proc-refresh] 刷新根层：reRender 只重建当前层（库页），
                          // 返回根层时「已加载程序化动作」区仍读旧 items 快照
                          refreshMotionRoot();
                      },
                  },
        });
    }
    return items;
}
