// [doc:architecture] Model — 模型子菜单（从 library.ts 提取）
// 职责: 模型各层级构建（外观/信息/标签/表情/材质）

import {
    escapeHtml,
    cardContainer,
    setStatus,
    PopupLevel,
    modelMetaCache,
    computeLibraryRef,
    dom,
    stackRegistry,
} from '../core/config';
import { modelManager } from '../scene/scene';
import { getModelMorphs, setModelMorphWeight, resetModelMorphs } from '../scene/manager/model-ops';
import { removeModel } from '../scene/manager/model-ops';
import { buildTransformCard, type ResourceHandle } from './resource-detail-helpers';
import { buildMatRootLevel } from './model-material';
import { createIconifyIcon, softwareKindIcon } from '../core/icons';
import {
    slideRow,
    addInfoGrid,
    addInfoCard,
    addSectionTitle,
    addPresetChip,
    addEmptyRow,
    addSliderRow,
    addToggleRow,
    addColorSliderRow,
} from '../core/ui-helpers';
import { openFullscreen } from '../core/ui-fullscreen-overlay';
import { buildOutfitLevel } from './outfit-ui';
import { savePresetToLibDialog, buildPresetListLevel } from './model-preset';
import { buildFeetLevel } from './motion-feet-levels';
import { buildVirtualSkirtLevel } from './motion-cloth-levels';
import { buildPhysicsDebugLevel } from './scene-physics-levels';
import { getPersonalLightState, setPersonalLightState } from '../scene/render/lighting-follow';
import {
    GetTagsByModel,
    AddTag,
    RemoveTag,
    GetAllTags,
    OpenWithSoftware,
    ScanSoftwareDir,
} from '../core/wails-bindings';
import type { SoftwareEntry } from '../core/wails-bindings';
import { tryCatchStatus } from '../core/utils';
import { logWarn } from '../core/logger';
import { safeCallAsync } from '../core/safe-call';
import { pushUndoSnapshot, offerSceneUndo } from '../scene/scene';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import {
    getActiveMotion,
    getMotionGen,
    getSceneMotions,
    getActiveMotionId,
} from '../scene/motion/motion-intent';
import { applyIntentToModel } from './motion-popup';
import {
    setProcMotionMode,
    regenerateProcMotion,
    isProcVmdActive,
    stopProcMotion,
} from '../scene/motion/proc-motion-bridge';
import { DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';
import { buildProcMotionLevel } from './motion-procmotion-levels';
import { loadManager } from '../core/load-manager';
import { getBrowseDir } from '../core/config';
import type { ModelInstance, ModelMotionSlots } from '@/core/types';

/** [doc:adr-167] 确保 inst.motionSlots 存在并返回（懒初始化；overlay 槽位已移除） */
function _ensureMotionSlots(inst: ModelInstance): ModelMotionSlots {
    if (!inst.motionSlots) {
        inst.motionSlots = {
            primary: { source: 'inherit', status: 'idle' },
        };
    }
    return inst.motionSlots;
}

/** [P5 per-slot] 激活程序化动作到指定模型（显式传 modelId，不依赖焦点） */
function _activateProcForModel(modelId: string, role: 'idle' | 'autodance'): void {
    // [fix:P2] 不调用全局 setProcMotionMode，仅写入 per-model 状态
    const inst = modelManager.get(modelId);
    if (inst) {
        inst.procMotion = { ...(inst.procMotion ?? DEFAULT_PROC_STATE), mode: role };
    }
    regenerateProcMotion(modelId);
}

/**
 * [fix] 切换到程序化动作时保留已加载动作引用（pinned）。
 * 否则 source 被整体替换为 'procedural' 会丢掉 pinned，导致程序化激活后
 * 「已加载动作」不可还原（必须重新从库里挑选）。保留引用后，
 * 点击「已加载动作」即可随时从程序化切回原动作（见 _applyLoadedMotion）。
 */
function _setProcForModel(id: string, inst: ModelInstance, role: 'idle' | 'autodance'): void {
    const prev = _ensureMotionSlots(inst).primary;
    // 自动保存当前动作引用：如果尚未 pinned，从 active / inst 提取并冻结
    let pinned = prev.pinned;
    if (!pinned) {
        const active = getActiveMotion();
        if (active?.vmdPath) {
            pinned = structuredClone(active);
        } else if (inst.vmdPath) {
            // 无场景级意图但模型有独立 VMD → 构造最小 pinned 快照
            pinned = {
                vmdPath: inst.vmdPath,
                vmdName: inst.vmdName,
                vmdLayers: [],
                source: 'vmd',
            };
        }
    }
    _ensureMotionSlots(inst).primary = {
        source: 'procedural',
        procRole: role,
        status: 'idle',
        pinned,
    };
    _activateProcForModel(id, role);
}

/**
 * [fix] 从程序化切回已加载动作：直接重新应用，无需单独的「取消程序化」步骤。
 * 时序保证：先同步 stopProcMotion(modelId) 停止该模型的程序化，再异步重载 pinned VMD。
 * [fix:P2] 使用 _applyingMotionId 防止 updateProcMotion 在异步间隙重启 proc。
 */
let _applyingMotionId: string | null = null;

function _applyLoadedMotion(id: string, inst: ModelInstance): void {
    const slots = _ensureMotionSlots(inst);
    const pinned = slots.primary.pinned;
    // 1) 同步停止该模型的程序化（不清全局 mode，避免污染其他模型）
    _applyingMotionId = id;
    // 清除 per-model proc 状态
    if (inst.procMotion) {
        inst.procMotion = { ...inst.procMotion, mode: 'off' };
    }
    // 如果该模型在活跃 proc 集合中，停止它
    if (isProcVmdActive()) {
        stopProcMotion();
    }
    if (pinned) {
        const gen = getMotionGen();
        loadManager
            .load({ kind: 'vmd', path: pinned.vmdPath, modelId: id, skipSceneIntent: true })
            .then((handle) => {
                _applyingMotionId = null;
                if (getMotionGen() !== gen) {
                    return;
                }
                if (handle) {
                    inst.vmdName = handle.name;
                    inst.vmdPath = pinned.vmdPath;
                    // 保留 pin 标记，使模型继续独立于场景广播
                    slots.primary = { source: 'pinned', pinned, status: 'overridden' };
                }
            })
            .catch(() => {
                _applyingMotionId = null;
                // 重载失败：回退静态，避免卡在已失效的程序化状态
                slots.primary = { source: 'inherit', status: 'idle' };
            });
    } else {
        _applyingMotionId = null;
        const active = getActiveMotion();
        if (active) {
            applyIntentToModel(id, active, getMotionGen());
        } else {
            slots.primary = { source: 'inherit', status: 'idle' };
        }
    }
}

// ======== Open With (software tools submenu) ========

function buildOpenWithSchema(id: string): MenuNode[] {
    return [
        {
            id: 'open-with:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                void (async () => {
                    let entries: SoftwareEntry[];
                    try {
                        entries = await ScanSoftwareDir();
                    } catch {
                        entries = [];
                    }

                    if (entries.length === 0) {
                        container.innerHTML =
                            '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:12px 0;">' +
                            t('model-detail.noSoftware') +
                            '</div>';
                        return;
                    }

                    cardContainer(container, (c) => {
                        for (const sw of entries) {
                            slideRow(c, softwareKindIcon(sw.kind), sw.name, false, async () => {
                                const inst = modelManager.get(id);
                                if (!inst.filePath) {
                                    setStatus(t('model-detail.noFilePath'), false);
                                    return;
                                }
                                const _r = await tryCatchStatus(
                                    () => OpenWithSoftware(inst.filePath, sw.path, sw.args || ''),
                                    t('model-detail.launchFailed')
                                );
                                if (_r !== undefined) {
                                    setStatus(t('model-detail.launched', { name: sw.name }), true);
                                }
                            });
                        }

                        slideRow(
                            c,
                            'lucide:plus',
                            t('model-detail.manageSoftware'),
                            false,
                            () => {
                                // Pop model stack first so returning from settings shows root level
                                stackRegistry.modelStack?.popTo(0);
                                import('./library-core').then((m) => {
                                    stackRegistry.modelStack?.setLevel(0, {
                                        label: t('model-detail.model'),
                                        dir: '',
                                        items: m.buildModelRootItems(),
                                    });
                                    stackRegistry.modelStack?.reRender();
                                });
                                dom.btnSettings.click();
                            },
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            {
                                variant: 'accent',
                            }
                        );
                    });
                })();
            },
        },
    ] satisfies MenuNode[];
}

export function buildOpenWithLevel(id: string): PopupLevel {
    return {
        label: t('model-detail.openWith'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildOpenWithSchema(id), container);
        },
    };
}

// ======== Model Detail Root ========

function buildModelSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [] satisfies MenuNode[];
    }
    const handle: ResourceHandle = { id, kind: 'actor', name: inst.name };

    return [
        {
            id: 'model:main',
            kind: 'custom',
            renderCustom: (container) => {
                cardContainer(container, (c) => {
                    // ── 动作 ──
                    addSectionTitle(c, t('model-detail.motion'));
                    {
                        // [doc:adr-167] overlay 槽位已移除，仅保留 primary
                        const slots = inst.motionSlots ?? {
                            primary: { source: 'inherit' as const, status: 'idle' as const },
                        };
                        const active = getActiveMotion();
                        let subText: string;
                        if (slots.primary.source === 'pinned') {
                            subText =
                                slots.primary.pinned?.vmdName || t('model-detail.pinnedMotion');
                        } else if (slots.primary.source === 'procedural') {
                            subText =
                                slots.primary.procRole === 'autodance'
                                    ? t('motion.modeAutodance')
                                    : t('motion.modeIdle');
                        } else if (active?.vmdPath) {
                            subText = active.vmdName;
                        } else {
                            subText = t('model-detail.noMotion');
                        }
                        const row = slideRow(
                            c,
                            'lucide:music-2',
                            t('model-detail.motionPrimary'),
                            true,
                            () => {
                                stackRegistry.modelStack?.push(buildMotionSlotLevel(id, inst));
                            }
                        );
                        const subLabel = document.createElement('span');
                        subLabel.className = 'slide-sublabel';
                        subLabel.textContent = subText;
                        const labelEl = row.querySelector('.slide-label');
                        if (labelEl) {
                            labelEl.appendChild(subLabel);
                        }
                    }
                    // [doc:adr-167] per-model overlay 入口已移除（ADR-144 废弃）。
                    // 叠加图层现由场景级动作详情页内 vmdLayers 配置，随动作走。
                    slideRow(c, 'lucide:user', t('motion.poseLibrary'), true, () => {
                        const level = stackRegistry.buildLevel!(
                            getBrowseDir('vpd'),
                            t('motion.poseTo', { name: inst.name }),
                            (m) => m.format === 'vpd',
                            stackRegistry.modelStack ?? undefined
                        );
                        stackRegistry.modelStack?.push(level);
                    });

                    // ── 外观 ──
                    addSectionTitle(c, t('model-detail.appearance'));
                    slideRow(c, 'lucide:box', t('model-detail.materialAdjust'), true, () => {
                        const level = buildMatRootLevel(id, inst.name);
                        stackRegistry.modelStack.push(level);
                    });
                    slideRow(c, 'lucide:smile', t('model-detail.morphPreview'), true, () => {
                        const level = buildMorphPreviewLevel(id);
                        stackRegistry.modelStack.push(level);
                    });
                    slideRow(c, 'lucide:shirt', t('model-detail.outfitVariant'), true, () => {
                        const level = buildOutfitLevel(id);
                        stackRegistry.modelStack.push(level);
                    });

                    // ── 个人灯光（次级菜单） ──
                    {
                        const pls = getPersonalLightState(id);
                        if (pls) {
                            slideRow(
                                c,
                                'lucide:lightbulb',
                                t('model-detail.personalLight'),
                                true,
                                () => {
                                    stackRegistry.modelStack.push(buildPersonalLightLevel(id));
                                },
                                undefined,
                                undefined,
                                undefined,
                                {
                                    value: pls.enabled,
                                    onChange: (v) => setPersonalLightState(id, { enabled: v }),
                                    bind: () => getPersonalLightState(id)?.enabled ?? false,
                                }
                            );
                        }
                    }

                    // ── 模型信息 ──
                    addSectionTitle(c, t('model-detail.modelInfo'));
                    slideRow(c, 'lucide:info', t('model-detail.modelDetail'), true, () => {
                        openModelDetailFullscreen(id);
                    });

                    // ── 变换控制 ──
                    addSectionTitle(c, t('model-detail.dragControl'));
                    const transformDiv = document.createElement('div');
                    c.appendChild(transformDiv);
                    buildTransformCard(transformDiv, handle);

                    // ── 故障排除 ──
                    addSectionTitle(c, t('model-detail.troubleshoot'));
                    slideRow(c, 'lucide:footprints', t('motion.feet.title'), true, () => {
                        stackRegistry.modelStack?.push(buildFeetLevel());
                    });
                    slideRow(c, 'lucide:shirt', t('cloth.title'), true, () => {
                        stackRegistry.modelStack?.push(buildVirtualSkirtLevel());
                    });
                    slideRow(c, 'lucide:bug', t('scene.debug'), true, () => {
                        stackRegistry.modelStack?.push(buildPhysicsDebugLevel());
                    });
                });
            },
        },
    ] satisfies MenuNode[];
}

/**
 * 模型工具菜单——角色库根层行右齿轮 trailing 的【唯一】入口。
 * 详情面板内联「工具」折叠组已移除，工具动作统一收敛到此菜单（消除重复）。
 * 采用整体 renderCustom + cardContainer 包裹（与详情面板卡片同 lcard 范式）+ 每行 slideRow 自带 onClick，
 * 不依赖 SlideMenu 级 onItemClick。
 */
/** 构建动作1（基础）次级菜单：场景库选择 + 已加载动作 + 程序化动作 */
export function buildMotionSlotLevel(id: string, inst: ModelInstance): PopupLevel {
    return {
        dir: '',
        label: t('model-detail.motionPrimary'),
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                // ── [doc:adr-167] 从场景库选择主动作 ──
                // 角色从此处选用场景库中某个主动作；未选 = 跟随默认动作
                addSectionTitle(c, t('motion.library.title'));
                {
                    const sceneMotions = getSceneMotions();
                    const activeId = getActiveMotionId();
                    const currentPick =
                        inst.motionSlots?.primary.source === 'inherit'
                            ? (inst.motionSlots.primary.sceneMotionId ?? null)
                            : null;
                    if (sceneMotions.length === 0) {
                        addEmptyRow(c, t('motion.library.emptyHint'));
                    } else {
                        // 「跟随默认」选项 = sceneMotionId 置空
                        slideRow(
                            c,
                            'lucide:circle-slash',
                            t('motion.library.followDefault'),
                            true,
                            () => {
                                const slots = _ensureMotionSlots(inst);
                                slots.primary = { source: 'inherit', status: 'idle' };
                                applyIntentToModel(id, getActiveMotion(), getMotionGen());
                                stackRegistry.modelStack?.reRender();
                            },
                            currentPick === null ? t('motion.library.currentPick') : undefined
                        );
                        for (const motion of sceneMotions) {
                            const isCurrent = currentPick === motion.id;
                            const isDefault = motion.id === activeId;
                            // sublabel 优先级：当前选择 > 默认动作徽标
                            const sublabel = isCurrent
                                ? t('motion.library.currentPick')
                                : isDefault
                                  ? t('motion.defaultMotion')
                                  : undefined;
                            slideRow(
                                c,
                                isDefault ? 'lucide:clapperboard' : 'lucide:circle-play',
                                motion.vmdName || t('motion.intent.none'),
                                true,
                                () => {
                                    const slots = _ensureMotionSlots(inst);
                                    slots.primary = {
                                        source: 'inherit',
                                        sceneMotionId: motion.id ?? undefined,
                                        status: 'idle',
                                    };
                                    applyIntentToModel(id, motion, getMotionGen());
                                    stackRegistry.modelStack?.reRender();
                                },
                                sublabel
                            );
                        }
                    }
                }

                // ── 已加载动作（仅程序化激活时展示，作为快捷回退入口）──
                const slots0 = _ensureMotionSlots(inst);
                const active = getActiveMotion();
                const isPinned = slots0.primary.source === 'pinned';
                const isProc = slots0.primary.source === 'procedural';
                // 非程序化激活时不显示此板块（场景动作库已提供全部信息）
                if (!isProc && !isPinned) {
                    // nothing to show
                } else if (isProc) {
                    addSectionTitle(c, t('model-detail.loadedMotion'));
                    // 程序化激活时仍显示「已加载动作」本名，而非程序化模式名——
                    // 这样用户随时能点它切回原动作，无需先「取消程序化」。
                    const loadedName =
                        slots0.primary.pinned?.vmdName ||
                        active?.vmdName ||
                        inst.vmdName ||
                        t('model-detail.noMotion');

                    const loadedRow = slideRow(c, 'lucide:clapperboard', loadedName, true, () => {
                        _applyLoadedMotion(id, inst);
                        stackRegistry.modelStack?.reRender();
                    });
                    // 程序化激活时右侧显示状态徽标（仅指示，点击整行即切回已加载动作）
                    addPresetChip(
                        loadedRow,
                        slots0.primary.procRole === 'autodance'
                            ? t('motion.modeAutodance')
                            : t('motion.modeIdle'),
                        false,
                        () => {},
                        {
                            variant: 'badge',
                            marginLeft: 'auto',
                            title: t('model-detail.procActive'),
                        }
                    );
                } else {
                    // isPinned 但非程序化：显示取消固定行
                    addSectionTitle(c, t('model-detail.loadedMotion'));
                    slideRow(c, 'lucide:pin-off', t('motion.context.unpin'), false, () => {
                        _ensureMotionSlots(inst).primary = { source: 'inherit', status: 'idle' };
                        if (active) {
                            applyIntentToModel(id, active, getMotionGen());
                        }
                        setStatus(t('motion.override.redoApplied'), true);
                        stackRegistry.modelStack?.reRender();
                    });
                }

                // ── 程序化动作 ──
                addSectionTitle(c, t('model-detail.procActions'));

                // 待机呼吸
                const isIdleActive =
                    slots0.primary.source === 'procedural' && slots0.primary.procRole === 'idle';
                const idleRow = slideRow(
                    c,
                    'lucide:wand-sparkles',
                    t('motion.modeIdle'),
                    true,
                    () => {
                        _setProcForModel(id, inst, 'idle');
                        stackRegistry.modelStack?.reRender();
                    },
                    isIdleActive ? t('model-detail.procActive') : undefined
                );
                if (!isIdleActive) {
                    addPresetChip(
                        idleRow,
                        t('model-detail.procEdit'),
                        false,
                        () => {
                            _setProcForModel(id, inst, 'idle');
                            stackRegistry.modelStack?.push(buildProcMotionLevel(id));
                        },
                        { marginLeft: 'auto', stopPropagation: true }
                    );
                }

                // 自动舞蹈
                const isAutodanceActive =
                    slots0.primary.source === 'procedural' &&
                    slots0.primary.procRole === 'autodance';
                const autodanceRow = slideRow(
                    c,
                    'lucide:wand-sparkles',
                    t('motion.modeAutodance'),
                    true,
                    () => {
                        _setProcForModel(id, inst, 'autodance');
                        stackRegistry.modelStack?.reRender();
                    },
                    isAutodanceActive ? t('model-detail.procActive') : undefined
                );
                if (!isAutodanceActive) {
                    addPresetChip(
                        autodanceRow,
                        t('model-detail.procEdit'),
                        false,
                        () => {
                            _setProcForModel(id, inst, 'autodance');
                            stackRegistry.modelStack?.push(buildProcMotionLevel(id));
                        },
                        { marginLeft: 'auto', stopPropagation: true }
                    );
                }
            });
        },
    };
}

/** [doc:adr-167] 叠加动作次级菜单已移除（ADR-144 per-model overlay 废弃）。
 * 叠加图层现由场景级动作详情页内 vmdLayers 配置，随动作保存。 */

export function buildModelToolsLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { dir: '', label: t('model-detail.tools'), items: [], renderCustom: () => {} };
    }
    return {
        dir: '',
        label: t('model-detail.tools'),
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:tag', t('model-detail.tags'), true, () => {
                    stackRegistry.modelStack?.push(buildModelTagsLevel(id));
                });
                slideRow(c, 'lucide:save', t('model-detail.savePreset'), false, () => {
                    savePresetToLibDialog(id);
                });
                slideRow(c, 'lucide:folder-open', t('model-detail.loadPreset'), true, () => {
                    stackRegistry.modelStack?.push(buildPresetListLevel(id));
                });
                slideRow(c, 'lucide:external-link', t('model-detail.openWith'), true, () => {
                    stackRegistry.modelStack?.push(buildOpenWithLevel(id));
                });
                // 卸载模型：场景级撤销保护（pushUndoSnapshot + offerSceneUndo），
                // 材质/morph/换装等未保存调整可通过撤销恢复，无需额外确认弹窗。
                slideRow(c, 'lucide:trash-2', t('model-detail.unloadModel'), false, async () => {
                    const snap = pushUndoSnapshot();
                    removeModel(id);
                    offerSceneUndo(t('settings.unloaded', { name: inst.name }), snap, () => {
                        // 撤销恢复后刷新模型列表，使已恢复的模型可见
                        import('./library-core').then((m) => {
                            stackRegistry.modelStack?.setLevel(0, {
                                label: t('model-detail.model'),
                                dir: '',
                                items: m.buildModelRootItems(),
                            });
                            stackRegistry.modelStack?.reRender();
                        });
                        setStatus(t('motion.undoApplied'), true);
                    });
                    if (stackRegistry.modelStack) {
                        stackRegistry.modelStack.popTo(0);
                        import('./library-core').then((m) => {
                            stackRegistry.modelStack?.setLevel(0, {
                                label: t('model-detail.model'),
                                dir: '',
                                items: m.buildModelRootItems(),
                            });
                            stackRegistry.modelStack?.reRender();
                        });
                    }
                });
            });
        },
    };
}

export function buildModelLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('model-detail.unknownModel'), dir: '', items: [] };
    }
    return {
        label: inst.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildModelSchema(id), container);
        },
    };
}

// ======== Model Detail Fullscreen ========

function openModelDetailFullscreen(id: string): void {
    const inst = modelManager.get(id);
    if (!inst) {
        return;
    }

    // 外层闭包持有当前 Tab 的 dispose，供 onBack 在全屏关闭时级联释放
    let activeDispose: (() => void) | null = null;

    openFullscreen({
        title: t('model-detail.modelDetail'),
        onBack: () => {
            if (activeDispose) {
                activeDispose();
                activeDispose = null;
            }
        },
        renderContent: (container) => {
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '12px';

            const tabs = document.createElement('div');
            tabs.className = 'model-detail-tabs';

            const content = document.createElement('div');
            content.className = 'model-detail-tab-content';
            content.style.flex = '1';
            content.style.overflowY = 'auto';
            content.style.minHeight = '0';

            const renderTab = (tab: 'info' | 'bones'): void => {
                if (activeDispose) {
                    activeDispose();
                    activeDispose = null;
                }
                content.innerHTML = '';
                const schema =
                    tab === 'info' ? buildModelInfoSchema(id) : buildBoneHierarchySchema(id);
                activeDispose = renderMenu(schema, content);
            };

            const createTabButton = (tab: 'info' | 'bones', label: string): HTMLButtonElement => {
                const btn = document.createElement('button');
                btn.className = 'model-detail-tab-btn';
                btn.type = 'button';
                btn.textContent = label;
                btn.addEventListener('click', () => {
                    const active = tabs.querySelector('.model-detail-tab-btn.active');
                    active?.classList.remove('active');
                    btn.classList.add('active');
                    renderTab(tab);
                });
                return btn;
            };

            const infoBtn = createTabButton('info', t('model-detail.basicInfo'));
            const boneBtn = createTabButton('bones', t('model-detail.boneHierarchy'));
            tabs.appendChild(infoBtn);
            tabs.appendChild(boneBtn);

            container.appendChild(tabs);
            container.appendChild(content);

            infoBtn.classList.add('active');
            renderTab('info');
        },
    });
}

// ======== Model Info ========

function buildModelInfoSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [] satisfies MenuNode[];
    }
    return [
        {
            id: 'model-info:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                // [fix:meta-key] zip 内模型 inst.filePath 为解压临时路径 ≠ 库 file_path，
                // 而 modelMetaCache 以库绝对路径为 key（library-actions.ts 写入）。
                // 改用 inst.libraryPath（库引用路径）优先，缺失时回退 filePath，对齐写侧 key。
                const meta = modelMetaCache.get(inst.libraryPath ?? inst.filePath) ?? null;
                let vertCount = 0,
                    faceCount = 0;
                for (const m of inst.meshes ?? []) {
                    vertCount += m.getTotalVertices() || 0;
                    faceCount += m.getTotalIndices() || 0;
                }
                const boneCount = inst.mmdModel?.runtimeBones?.length ?? null;
                const morphCount = inst.mmdModel?.morph?.morphs?.length ?? null;
                // [audit-fix] 材质数必须以 PMX 材质列表为准：MMD 模型通常仅 1 个 Babylon 网格，
                // 而 MmdMesh.materials 才是真实材质数组（IMmdModel 不暴露 materials 字段）。
                // 直接对网格材质计数；mesh.material 单值时按 1 计。
                const matCount = (inst.meshes ?? []).reduce((n, m) => {
                    const mm = m as unknown as { materials?: readonly unknown[] };
                    return n + (mm.materials?.length ?? (m.material ? 1 : 0));
                }, 0);
                const fileName = inst.filePath.split(/[/\\]/).pop() || inst.filePath;
                const comment = meta?.comment ? meta.comment.substring(0, 80) : '';
                const fields: Array<{ label: string; value: string; wide?: boolean; sub?: string }> = [
                    {
                        label: t('model-detail.fName'),
                        value: inst.name,
                        wide: true,
                        sub: `${t('model-detail.fFile')}: ${fileName}`,
                    },
                    {
                        label: t('model-detail.fType'),
                        value:
                            inst.kind === 'actor'
                                ? t('model-detail.actorModel')
                                : t('model-detail.stageModel'),
                    },
                    { label: t('model-detail.fMotion'), value: inst.vmdName || t('model-detail.none') },
                    { label: t('model-detail.fVerts'), value: vertCount.toLocaleString() },
                    { label: t('model-detail.fFaces'), value: (faceCount / 3).toLocaleString() },
                    { label: t('model-detail.fMaterials'), value: String(matCount) },
                    {
                        label: t('model-detail.fBones'),
                        value: boneCount !== null ? boneCount.toLocaleString() : 'N/A',
                    },
                    {
                        label: t('model-detail.fMorphs'),
                        value: morphCount !== null ? morphCount.toLocaleString() : 'N/A',
                    },
                    { label: t('model-detail.fNameJp'), value: meta?.name_jp || '—' },
                    { label: t('model-detail.fNameEn'), value: meta?.name_en || '—' },
                    ...(comment
                        ? [{ label: t('model-detail.fComment'), value: comment, wide: true }]
                        : []),
                ];
                cardContainer(container, (c) => {
                    const grid = addInfoGrid(c);
                    for (const f of fields) {
                        addInfoCard(
                            grid,
                            f.label,
                            f.value,
                            f.wide ? { wide: true, sub: f.sub } : f.sub ? { sub: f.sub } : undefined
                        );
                    }
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildModelInfoLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('model-detail.infoTitle'), dir: '', items: [] };
    }
    return {
        label: t('model-detail.infoTitle'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildModelInfoSchema(id), container);
        },
    };
}

// ======== Tags Management ========

function buildModelTagsSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [] satisfies MenuNode[];
    }
    const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
    return [
        {
            id: 'model-tags:fav',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                cardContainer(container, (c) => {
                    const favRow = document.createElement('div');
                    favRow.className = 'slide-item';
                    favRow.setAttribute('data-hint', t('model-detail.favHint'));
                    const refreshFav = async () => {
                        if (!libRef) {
                            return;
                        }
                        const tags = await GetTagsByModel(libRef);
                        if (!container.isConnected) {
                            return;
                        }
                        const isFav = tags && tags.includes('收藏');
                        favRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:star" style="color:${isFav ? 'var(--accent)' : 'var(--text-muted)'};"></iconify-icon></span><span class="slide-label" style="color:${isFav ? 'var(--accent)' : 'var(--text)'};">${isFav ? t('model-detail.faved') : t('model-detail.addFav')}</span>`;
                        favRow.onclick = async () => {
                            if (!libRef || !container.isConnected) {
                                return;
                            }
                            await tryCatchStatus(async () => {
                                if (isFav) {
                                    await RemoveTag(libRef, '收藏');
                                    setStatus(t('model-detail.unfaved'), true);
                                } else {
                                    await AddTag(libRef, '收藏');
                                    setStatus(t('model-detail.favedStatus'), true);
                                }
                                refreshFav();
                            }, t('model-detail.favFailed'));
                        };
                    };
                    refreshFav();
                    c.appendChild(favRow);
                });
            },
        },
        {
            id: 'model-tags:picker',
            kind: 'custom',
            renderCustom: (container) => {
                cardContainer(container, (c) => {
                    const tagContainer = document.createElement('div');
                    tagContainer.className = 'tag-container';
                    c.appendChild(tagContainer);

                    function refreshTags(): void {
                        if (!libRef) {
                            tagContainer.innerHTML =
                                '<span class="tag-empty">' + t('model-detail.noPath') + '</span>';
                            return;
                        }
                        GetTagsByModel(libRef)
                            .then((tags) => {
                                if (!container.isConnected) {
                                    return;
                                }
                                tagContainer.innerHTML = '';
                                if (!tags || tags.length === 0) {
                                    return;
                                }
                                for (const tag of tags) {
                                    const chip = document.createElement('span');
                                    chip.className = 'tag-chip';
                                    chip.innerHTML = `${escapeHtml(tag)} <span class="tag-del">✕</span>`;
                                    chip.title = t('model-detail.removeTagTitle');
                                    chip.addEventListener('click', async () => {
                                        if (!container.isConnected) {
                                            return;
                                        }
                                        const r = await tryCatchStatus(async () => {
                                            await RemoveTag(libRef, tag);
                                            return true;
                                        }, t('model-detail.favFailed'));
                                        if (r) {
                                            refreshTags();
                                            setStatus(t('model-detail.tagRemoved', { tag }), true);
                                        }
                                    });
                                    tagContainer.appendChild(chip);
                                }
                            })
                            .catch(() => {
                                tagContainer.textContent = t('model-detail.loadTagsFailed');
                            });
                    }
                    refreshTags();

                    const pickerLabel = document.createElement('div');
                    pickerLabel.style.cssText =
                        'font-size:11px;color:var(--text-dim);margin:8px 0 4px;';
                    pickerLabel.textContent = t('model-detail.addExistingTag');
                    c.appendChild(pickerLabel);

                    const picker = document.createElement('div');
                    picker.className = 'tag-container';
                    safeCallAsync('model-detail', 'tag load failed:', () =>
                        GetAllTags().then((allTags) => {
                            if (!container.isConnected) {
                                return;
                            }
                            const assigned = new Set<string>();
                            safeCallAsync('model-detail', 'tag load failed:', () =>
                                GetTagsByModel(libRef!).then((modelTags) => {
                                    if (!container.isConnected) {
                                        return;
                                    }
                                    (modelTags || []).forEach((tm) => assigned.add(tm));
                                    (allTags || []).forEach((tag) => {
                                        if (tag === '收藏') {
                                            return;
                                        }
                                        const chip = document.createElement('span');
                                        chip.className =
                                            'tag-chip' + (assigned.has(tag) ? ' active' : '');
                                        chip.style.cssText = assigned.has(tag)
                                            ? 'border:1px solid var(--accent);color:var(--accent);background:var(--accent-dim);'
                                            : 'border:1px solid var(--white-08);color:var(--text-dim);background:transparent;cursor:pointer;';
                                        chip.textContent = assigned.has(tag)
                                            ? `✓ ${tag}`
                                            : `+ ${tag}`;
                                        chip.title = assigned.has(tag)
                                            ? t('model-detail.tagAddedRemove')
                                            : t('model-detail.tagAdd');
                                        chip.addEventListener('click', () => {
                                            if (!libRef || !container.isConnected) {
                                                return;
                                            }
                                            if (assigned.has(tag)) {
                                                RemoveTag(libRef, tag)
                                                    .then(() => {
                                                        refreshTags();
                                                    })
                                                    .catch((e) =>
                                                        logWarn(
                                                            'model-detail',
                                                            'remove tag failed:',
                                                            e
                                                        )
                                                    );
                                            } else {
                                                AddTag(libRef, tag)
                                                    .then(() => {
                                                        refreshTags();
                                                    })
                                                    .catch((e) =>
                                                        logWarn(
                                                            'model-detail',
                                                            'add tag failed:',
                                                            e
                                                        )
                                                    );
                                            }
                                        });
                                        picker.appendChild(chip);
                                    });
                                    if (
                                        !allTags ||
                                        allTags.filter((tg) => tg !== '收藏').length === 0
                                    ) {
                                        picker.innerHTML =
                                            '<span style="color:var(--text-muted);font-size:11px;">' +
                                            t('model-detail.noGlobalTags') +
                                            '</span>';
                                    }
                                })
                            );
                        })
                    );
                    c.appendChild(picker);
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildModelTagsLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('model-detail.tagsFallback'), dir: '', items: [] };
    }
    return {
        label: t('model-detail.tagsTitle'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildModelTagsSchema(id), container);
        },
    };
}

// ======== Morph Preview ========

function buildMorphPreviewSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    const morphs = inst ? (getModelMorphs(id) ?? []) : [];
    const typeLabels: Record<number, string> = {
        0: t('model-detail.morphTypeGroup'),
        1: t('model-detail.morphTypeVertex'),
        2: t('model-detail.morphTypeBone'),
        3: t('model-detail.morphTypeUV'),
        8: t('model-detail.morphTypeMaterial'),
    };
    return [
        {
            id: 'morph-preview:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                cardContainer(container, (c) => {
                    const resetBtn = document.createElement('button');
                    resetBtn.className = 'btn btn-sm full-btn';
                    resetBtn.textContent = t('model-detail.resetAll');
                    resetBtn.addEventListener('click', () => {
                        resetModelMorphs(id);
                        c.querySelectorAll('.morph-slider').forEach((el) => {
                            (el as HTMLInputElement).value = '0';
                            const valLabel = (el as HTMLElement).parentElement.querySelector(
                                '.morph-val'
                            );
                            if (valLabel) {
                                valLabel.textContent = '0.00';
                            }
                        });
                        setStatus(t('model-detail.morphsReset'), true);
                    });
                    c.appendChild(resetBtn);

                    const list = document.createElement('div');
                    list.className = 'morph-list';
                    for (const m of morphs) {
                        const row = document.createElement('div');
                        row.className = 'morph-row';

                        const header = document.createElement('div');
                        header.className = 'morph-header';
                        const name = document.createElement('span');
                        name.className = 'morph-name';
                        name.textContent = m.name;
                        name.title = m.name;
                        const typeTag = document.createElement('span');
                        typeTag.className = 'morph-type';
                        typeTag.textContent =
                            typeLabels[m.type] ||
                            t('model-detail.morphTypeUnknown', { type: m.type });
                        const valLabel = document.createElement('span');
                        valLabel.className = 'morph-val';
                        valLabel.textContent = '0.00';
                        header.appendChild(name);
                        header.appendChild(typeTag);
                        header.appendChild(valLabel);

                        const slider = document.createElement('input');
                        slider.type = 'range';
                        slider.min = '0';
                        slider.max = '1';
                        slider.step = '0.01';
                        slider.value = '0';
                        slider.className = 'morph-slider rng-input';
                        slider.addEventListener('input', () => {
                            const v = parseFloat(slider.value);
                            setModelMorphWeight(id, m.name, v);
                            valLabel.textContent = v.toFixed(2);
                        });

                        row.appendChild(header);
                        row.appendChild(slider);
                        list.appendChild(row);
                    }

                    if (morphs.length === 0) {
                        const empty = document.createElement('div');
                        empty.className = 'morph-empty';
                        empty.innerHTML =
                            `<div>${t('model-detail.noMorph')}</div>` +
                            `<div style="font-size:11px;opacity:0.7;margin-top:4px;">${t('model-detail.noMorphHint')}</div>`;
                        list.appendChild(empty);
                    }

                    c.appendChild(list);
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildMorphPreviewLevel(id: string): PopupLevel {
    return {
        label: t('model-detail.morphPreview'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildMorphPreviewSchema(id), container);
        },
    };
}

// ======== Personal Light ========

export function buildPersonalLightLevel(id: string): PopupLevel {
    return {
        label: t('model-detail.personalLight'),
        dir: '',
        items: [],
        renderCustom: (c) => {
            const pls = getPersonalLightState(id);
            if (!pls) {
                return;
            }
            addSliderRow(
                c,
                t('model-detail.personalLightIntensity'),
                pls.intensity,
                0,
                3,
                0.05,
                (v) => setPersonalLightState(id, { intensity: v }),
                'lucide:sun'
            );
            addColorSliderRow(
                c,
                t('model-detail.personalLightColor'),
                pls.color,
                (v) => setPersonalLightState(id, { color: v }),
                undefined,
                'personal-light-color'
            );
            addSliderRow(
                c,
                t('model-detail.personalLightAngle'),
                pls.angle,
                0.3,
                1.5,
                0.05,
                (v) => setPersonalLightState(id, { angle: v }),
                'lucide:flashlight'
            );
            addSliderRow(
                c,
                t('model-detail.personalLightHeight'),
                pls.height,
                5,
                50,
                0.5,
                (v) => setPersonalLightState(id, { height: v }),
                'lucide:move-vertical'
            );
            addToggleRow(
                c,
                t('model-detail.personalLightCone'),
                pls.coneEnabled,
                (v) => setPersonalLightState(id, { coneEnabled: v }),
                'lucide:cone'
            );
            if (pls.coneEnabled) {
                addSliderRow(
                    c,
                    t('model-detail.personalLightConeIntensity'),
                    pls.coneIntensity,
                    0,
                    2,
                    0.05,
                    (v) => setPersonalLightState(id, { coneIntensity: v }),
                    'lucide:sun-medium'
                );
                addSliderRow(
                    c,
                    t('model-detail.personalLightConeLength'),
                    pls.coneLength,
                    1,
                    50,
                    0.5,
                    (v) => setPersonalLightState(id, { coneLength: v }),
                    'lucide:move-down'
                );
                addSliderRow(
                    c,
                    t('model-detail.personalLightConeSoftness'),
                    pls.coneSoftness,
                    0,
                    1,
                    0.05,
                    (v) => setPersonalLightState(id, { coneSoftness: v }),
                    'lucide:blur'
                );
            }
        },
    };
}

// ======== Bone Hierarchy ========

function buildBoneHierarchySchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst?.mmdModel) {
        return [] satisfies MenuNode[];
    }
    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) {
        return [] satisfies MenuNode[];
    }

    // Build parent→children map
    const childrenMap = new Map<number, number[]>();
    const rootIndices: number[] = [];
    const physicsSet = new Set<number>();
    // [audit-fix] 预建 骨骼→索引 映射，避免循环内 bones.indexOf 的 O(n²) 冗余查找
    const boneIndex = new Map<(typeof bones)[number], number>();
    for (let i = 0; i < bones.length; i++) {
        boneIndex.set(bones[i], i);
    }
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (bone.rigidBodyIndices.length > 0) {
            physicsSet.add(i);
        }
        const parentBone = bone.parentBone;
        if (parentBone) {
            const parentIdx = boneIndex.get(parentBone) ?? -1;
            if (parentIdx >= 0) {
                const list = childrenMap.get(parentIdx) ?? [];
                list.push(i);
                childrenMap.set(parentIdx, list);
                continue;
            }
        }
        rootIndices.push(i);
    }

    return [
        {
            id: 'bone-hierarchy:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                // AbortController 统一管理所有骨骼树节点 listener，
                // dispose 时一次 abort 即移除全部（配合 activeDispose 链路）
                const ac = new AbortController();
                cardContainer(container, (c) => {
                    const header = document.createElement('div');
                    header.style.cssText =
                        'font-size:var(--font-ui-sm);color:var(--text-bright);padding:4px 14px 8px;';
                    header.textContent = t('model-detail.boneCount', { n: bones.length });
                    c.appendChild(header);

                    function renderBoneTree(parent: HTMLElement, idx: number, depth: number): void {
                        const bone = bones[idx];
                        const row = document.createElement('div');
                        row.style.cssText = `display:flex;align-items:center;padding:2px 14px 2px ${14 + depth * 16}px;font-size:var(--font-ui);color:var(--text);gap:6px;`;

                        // Collapse/expand for non-leaf
                        const hasChildren = (childrenMap.get(idx)?.length ?? 0) > 0;
                        let expanded = depth < 2; // auto-expand top 2 levels
                        if (hasChildren) {
                            const toggle = document.createElement('span');
                            toggle.textContent = expanded ? '▾' : '▸';
                            toggle.style.cssText =
                                'cursor:pointer;flex:none;width:14px;text-align:center;color:var(--text-dim);font-size:var(--font-ui-sm);';
                            row.appendChild(toggle);

                            // Name label (click expands/collapses)
                            const label = document.createElement('span');
                            label.textContent = bone.name;
                            label.style.cssText =
                                'cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                            row.appendChild(label);

                            const childContainer = document.createElement('div');
                            let childrenRendered = false;

                            toggle.addEventListener(
                                'click',
                                (e) => {
                                    e.stopPropagation();
                                    expanded = !expanded;
                                    toggle.textContent = expanded ? '▾' : '▸';
                                    childContainer.style.display = expanded ? '' : 'none';
                                    if (expanded && !childrenRendered) {
                                        childrenRendered = true;
                                        const childIndices = childrenMap.get(idx) ?? [];
                                        for (const ci of childIndices) {
                                            renderBoneTree(childContainer, ci, depth + 1);
                                        }
                                    }
                                },
                                { signal: ac.signal }
                            );
                            label.addEventListener('click', () => toggle.click(), {
                                signal: ac.signal,
                            });

                            parent.appendChild(row);
                            childContainer.style.display = expanded ? '' : 'none';
                            parent.appendChild(childContainer);

                            if (expanded) {
                                childrenRendered = true;
                                const childIndices = childrenMap.get(idx) ?? [];
                                for (const ci of childIndices) {
                                    renderBoneTree(childContainer, ci, depth + 1);
                                }
                            }
                        } else {
                            // Leaf node
                            row.innerHTML = `<span style="flex:none;width:14px;"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);">${escapeHtml(bone.name)}</span>`;
                            parent.appendChild(row);
                        }

                        // Physics badge
                        if (physicsSet.has(idx)) {
                            const badge = document.createElement('span');
                            const iconEl = createIconifyIcon('lucide:zap');
                            if (iconEl) {
                                badge.appendChild(iconEl);
                            }
                            badge.title = t('model-detail.hasPhysics');
                            badge.style.cssText =
                                'font-size:11px;flex:none;color:var(--accent);display:inline-flex;';
                            row.appendChild(badge);
                        }
                    }

                    for (const ri of rootIndices) {
                        renderBoneTree(c, ri, 0);
                    }
                });
                // 返回 dispose：abort 一次性移除所有骨骼树 listener
                return () => ac.abort();
            },
        },
    ] satisfies MenuNode[];
}

export function buildBoneHierarchyLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst?.mmdModel) {
        return { label: t('model-detail.boneHierarchy'), dir: '', items: [] };
    }
    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) {
        return { label: t('model-detail.boneHierarchy'), dir: '', items: [] };
    }
    return {
        label: t('model-detail.boneHierarchy'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildBoneHierarchySchema(id), container);
        },
    };
}
