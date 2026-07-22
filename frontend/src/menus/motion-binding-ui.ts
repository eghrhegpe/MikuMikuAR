// [doc:architecture] Motion Binding UI — 动作意图/广播 + per-model 绑定面板
// 从 motion-popup.ts 拆出：renderModuleToggleList / applyIntentToModel / initMotionBroadcast /
// 动作绑定面板（姿势库·pin/unpin·物理开关）/ per-model 播放控制

import {
    setStatus,
    mmdRuntime,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setAutoLoop,
    stackRegistry,
    getBrowseDir,
    cardContainer,
} from '../core/config';
import { slideRow, addToggleRow, addEmptyRow, addPresetChip } from '../core/ui-helpers';
import { loadManager } from '../core/load-manager';
import {
    modelManager,
    updatePlaybackUI,
    getPhysicsCategories,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
} from '../scene/scene';
import {
    initMotionModules,
    getRegisteredModules,
    createModule,
    getModuleState,
    applyMotionModulesToModel,
} from '../scene/motion/motion-modules/registry';
import {
    getActiveMotion,
    getMotionGen,
    getSceneMotions,
    clearAllSceneMotions,
    resolveCompatibility,
    initMotionIntent,
} from '../scene/motion/motion-intent';
import { t } from '../core/i18n/t';
import type { SceneMotionIntent, ModelMotionSlots, ModelInstance } from '@/core/types';
import type { MenuNode } from './menu-schema';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import { logWarn } from '../core/logger';
import { showConfirm } from '../core/dialog';
// 循环依赖安全：getMotionMenu 仅在函数体内调用，不在模块求值期访问
import { getMotionMenu } from './motion-popup';

// ═══════════════════════════════════════════════════════════
// 模块开关列表（ADR-146 主题 11 收敛）
// ═══════════════════════════════════════════════════════════

/**
 * 渲染动作模块开关列表到指定容器。
 * 收敛 ADR-146 主题 11：motion-popup 与 motion-override-levels 两处模块列表渲染段同源重复。
 */
export function renderModuleToggleList(
    container: HTMLElement,
    modelId: string,
    opts: { initModules?: boolean; onEnter: (modId: string) => void }
): void {
    if (opts.initModules) {
        initMotionModules();
    }
    const modules = getRegisteredModules();
    for (const mod of modules) {
        const state = getModuleState(modelId, mod.id);
        // [P3] 非默认参数摘要：让用户一眼看到哪个模块已调过参，无需逐个点进子页
        const defaults = mod.meta.defaults ?? {};
        const tuned = Object.keys(state.params).filter((k) => state.params[k] !== defaults[k])
            .length;
        const sublabel = tuned > 0 ? t('motion.override.tunedParams', { n: tuned }) : undefined;
        slideRow(
            container,
            mod.meta.icon ?? '',
            t(mod.meta.labelKey),
            true,
            () => opts.onEnter(mod.id),
            sublabel,
            undefined,
            undefined,
            {
                value: state.enabled,
                onChange: (v: boolean) => {
                    const inst = createModule(mod.id, modelId);
                    if (v) {
                        inst?.enable();
                    } else {
                        inst?.disable();
                    }
                    setStatus(
                        v ? t('motion.override.enabled') : t('motion.override.disabled'),
                        true
                    );
                    getMotionMenu()?.reRender();
                },
                bind: () => getModuleState(modelId, mod.id).enabled,
            }
        );
    }
}

// ═══════════════════════════════════════════════════════════
// 动作意图 / 广播（ADR-121）
// ═══════════════════════════════════════════════════════════

// 模块级状态（动作绑定面板）：
//   _focusedLayerId = 当前「焦点动作」：null=基础动作，string=具体叠加层 id。
let _focusedLayerId: string | null = null;

/** 重置焦点图层 ID（进入动作绑定面板 / 场景级浏览时调用）。 */
export function resetFocusedLayerId(): void {
    _focusedLayerId = null;
}

// [doc:adr-167] 默认单槽位（inherit + idle；overlay 槽位已移除）
export const DEFAULT_MOTION_SLOTS: ModelMotionSlots = {
    primary: { source: 'inherit', status: 'idle' },
};

/** [doc:adr-167] 确保 inst.motionSlots 存在并返回（懒初始化；overlay 槽位已移除） */
export function ensureMotionSlots(inst: ModelInstance): ModelMotionSlots {
    if (!inst.motionSlots) {
        inst.motionSlots = {
            primary: { ...DEFAULT_MOTION_SLOTS.primary },
        };
    }
    return inst.motionSlots;
}

// [doc:adr-167] 向单个模型应用动作意图（复用广播与 unpin 场景）。
// 保留 slots.primary.sceneMotionId —— 由调用方（场景库选择/broadcast）设置，apply 不重置。
export function applyIntentToModel(id: string, intent: SceneMotionIntent, gen: number): void {
    const inst = modelManager.get(id);
    if (!inst) {
        return;
    }
    const slots = ensureMotionSlots(inst);
    const bones =
        inst.mmdModel?.runtimeBones?.map((b) => b.name) ??
        inst.meshes[0]?.skeleton?.bones?.map((b) => b.name) ??
        [];
    // [doc:adr-121 P4-2] 未传 vmdBoneNames → 退回标准 MMD 骨骼预筛（23 根中命中 ≥3 即通过）。
    // 宽松匹配是有意为之：广播时 VMD 尚未加载，无法提取实际引用骨骼名；
    // 且非标准模型（如简化骨骼）也应尽量获得动作，误判为 incompatible 的体验代价更高。
    const compat = resolveCompatibility(bones, intent);
    if (!compat.compatible) {
        slots.primary = { ...slots.primary, status: 'incompatible' };
        return;
    }
    // [fix:adr-129+adr-167] 动作本体未变（仅模块配置变更 / 同路径重广播）时跳过 VMD 重载
    // 但若 sceneMotionId 变了（切换到另一场景动作），vmdLayers/motionModules 可能不同，需重载
    if (
        intent.vmdPath &&
        inst.vmdPath === intent.vmdPath &&
        slots.primary.sceneMotionId === intent.id
    ) {
        applyMotionModulesToModel(id);
        return;
    }
    if (!intent.vmdPath) {
        return;
    }
    loadManager
        .load({ kind: 'vmd', path: intent.vmdPath, modelId: id, skipSceneIntent: true })
        .then((handle) => {
            if (getMotionGen() !== gen) {
                return;
            }
            if (handle) {
                inst.vmdName = handle.name;
                inst.vmdPath = intent.vmdPath;
                // [doc:adr-167] 保留 sceneMotionId（角色选用标记）
                slots.primary = {
                    source: 'inherit',
                    sceneMotionId: slots.primary.sceneMotionId,
                    status: 'compatible',
                };
                applyMotionModulesToModel(id);
            }
        })
        .catch(() => {
            if (getMotionGen() !== gen) {
                return;
            }
            slots.primary = {
                source: 'inherit',
                sceneMotionId: slots.primary.sceneMotionId,
                status: 'incompatible',
            };
        });
}

// [doc:adr-167] 注册广播回调：按角色 sceneMotionId 解析具体动作
export function initMotionBroadcast(): void {
    initMotionIntent((intent, gen, prev) => {
        for (const [id, inst] of modelManager.modelRegistry) {
            const slots = inst.motionSlots ?? DEFAULT_MOTION_SLOTS;
            if (slots.primary.source === 'pinned' || slots.primary.source === 'procedural') {
                continue;
            }
            // [doc:adr-167] 角色优先按自选 sceneMotionId 解析；
            // 未指定或失效则回退到默认动作（intent）
            let resolvedIntent = intent;
            const pickedId = slots.primary.sceneMotionId;
            if (pickedId) {
                const picked = getSceneMotions().find((m) => m.id === pickedId);
                if (picked) {
                    resolvedIntent = picked;
                } else {
                    // 失效引用：清掉，回退默认
                    slots.primary.sceneMotionId = undefined;
                }
            }
            if (!resolvedIntent) {
                if (
                    inst.mmdModel &&
                    mmdRuntime &&
                    inst.vmdPath &&
                    prev?.vmdPath &&
                    inst.vmdPath === prev.vmdPath
                ) {
                    inst.mmdModel.setRuntimeAnimation(null);
                    inst.vmdData = null;
                    inst.vmdName = '';
                    inst.vmdPath = null;
                    inst.animationDuration = 0;
                }
            } else {
                applyIntentToModel(id, resolvedIntent, gen);
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════
// Per-model 动作绑定面板
// ═══════════════════════════════════════════════════════════

// 物理类别 → i18n key 映射（运行时 t()，支持热切换）
const CAT_KEYS: Record<string, string> = {
    skirt: 'motion.catSkirt',
    chest: 'motion.catChest',
    hair: 'motion.catHair',
    accessory: 'motion.catAccessory',
};

// [doc:adr-129] 角色绑定面板：仅保留 per-model 专属功能（姿势库、pin/unpin、物理开关）
function buildActionBindingSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [] satisfies MenuNode[];
    }

    return [
        // 卡片 1：姿势库
        {
            id: 'binding:pose',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(inner, 'lucide:user', t('motion.poseLibrary'), true, () => {
                        const level = stackRegistry.buildLevel!(
                            getBrowseDir('vpd'),
                            t('motion.poseLibrary'),
                            (m) => m.format === 'vpd',
                            getMotionMenu() ?? undefined
                        );
                        level.label = t('motion.poseTo', { name: inst.name });
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(level);
                        }
                    });
                });
            },
        },
        // 卡片 2：动作分配策略（pin/unpin）
        {
            id: 'binding:assignment',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const slots = inst.motionSlots ?? DEFAULT_MOTION_SLOTS;
                    const active = getActiveMotion();
                    const isPinned = slots.primary.source === 'pinned';
                    const isIncompatible = slots.primary.status === 'incompatible';
                    const hasGlobalMotion = !!active && !!active.vmdPath;

                    if (isIncompatible) {
                        const warn = document.createElement('div');
                        warn.style.cssText =
                            'color:var(--color-warn);padding:4px 0;font-size:12px;';
                        warn.textContent = t('motion.intent.incompatible');
                        inner.appendChild(warn);
                    }

                    if (hasGlobalMotion || isPinned) {
                        if (isPinned) {
                            addPresetChip(inner, t('motion.context.unpin'), false, () => {
                                ensureMotionSlots(inst).primary = {
                                    source: 'inherit',
                                    status: 'idle',
                                };
                                if (active) {
                                    applyIntentToModel(id, active, getMotionGen());
                                }
                                getMotionMenu()?.reRender();
                                setStatus(t('motion.override.redoApplied'), true);
                            });
                        } else {
                            addPresetChip(inner, t('motion.context.pinMotion'), false, () => {
                                if (active) {
                                    ensureMotionSlots(inst).primary = {
                                        source: 'pinned',
                                        pinned: structuredClone(active),
                                        status: 'overridden',
                                    };
                                    getMotionMenu()?.reRender();
                                    setStatus(t('motion.override.redoApplied'), true);
                                }
                            });
                        }
                    } else {
                        const hint = document.createElement('div');
                        hint.className = 'cs-hint';
                        hint.textContent = t('motion.intent.noGlobalHint');
                        inner.appendChild(hint);
                    }
                });
            },
        },
        // 卡片 3：物理开关
        {
            id: 'binding:tools',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const cats = getPhysicsCategories(id);
                    if (cats.length === 0) {
                        addEmptyRow(inner, t('motion.noPhysics'));
                        return;
                    }
                    for (const cat of cats) {
                        const enabled = isPhysicsCategoryEnabled(id, cat);
                        addToggleRow(
                            inner,
                            t(CAT_KEYS[cat] || cat),
                            enabled,
                            (v) => {
                                setPhysicsCategory(id, cat, v);
                                getMotionMenu()?.updateControls();
                                const catLabel = t(CAT_KEYS[cat] || cat);
                                setStatus(
                                    v
                                        ? t('motion.catEnabled', { cat: catLabel })
                                        : t('motion.catDisabled', { cat: catLabel }),
                                    true
                                );
                            },
                            'lucide:settings',
                            {
                                bind: () => isPhysicsCategoryEnabled(id, cat),
                            }
                        );
                    }
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildActionBindingLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('motion.intent.title'), dir: '', items: [] };
    }
    return {
        label: inst.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildActionBindingSchema(id), container);
        },
    };
}

// ═══════════════════════════════════════════════════════════
// Per-model 播放控制（从 motionOnItemClick 提取）
// ═══════════════════════════════════════════════════════════

/** 处理 per-model 动作控制指令（pause / reset / pose / loop）。 */
export async function handleModelAction(action: string, id: string): Promise<void> {
    const inst = modelManager.get(id);
    if (!inst) {
        return;
    }
    switch (action) {
        case 'pause':
            if (mmdRuntime) {
                if (isPlaying) {
                    mmdRuntime.pauseAnimation();
                    setIsPlaying(false);
                    setAutoLoop(false);
                } else {
                    setAutoLoop(true);
                    mmdRuntime
                        .playAnimation()
                        .then(() => setIsPlaying(true))
                        .catch((err) => {
                            setIsPlaying(false);
                            logWarn('motion-popup', 'playAnimation failed:', err);
                        });
                }
                updatePlaybackUI();
                getMotionMenu()?.reRender();
            }
            break;
        case 'reset':
            if (inst.mmdModel && mmdRuntime) {
                if (!(await showConfirm(t('motion.resetConfirm')))) return;
                // [doc:adr-167] 清空整个场景动作库 + 默认动作
                clearAllSceneMotions();
                if (isPlaying) {
                    mmdRuntime.pauseAnimation();
                    setIsPlaying(false);
                }
                updatePlaybackUI();
                if (getMotionMenu()) {
                    getMotionMenu()?.reRender();
                }
                setStatus(t('motion.motionReset'), true);
            }
            break;
        case 'pose':
            (async () => {
                const level = stackRegistry.buildLevel!(
                    getBrowseDir('vpd'),
                    t('motion.poseLibrary'),
                    (m) => m.format === 'vpd',
                    getMotionMenu() ?? undefined
                );
                level.label = t('motion.poseTo', { name: inst.name });
                if (getMotionMenu()) {
                    getMotionMenu()?.push(level);
                }
            })();
            break;
        case 'loop':
            setAutoLoop(!autoLoop);
            getMotionMenu()?.reRender();
            setStatus(
                t('motion.loopState', { state: autoLoop ? t('motion.on') : t('motion.off') }),
                true
            );
            break;
    }
}
