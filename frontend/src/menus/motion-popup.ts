// [doc:architecture] Motion Popup — 动作弹窗（核心 + barrel export）
// 拆分后保留: 动作绑定/音乐/动作菜单/入口 + barrel re-export

import {
    setStatus,
    libraryRoot,
    overridePaths,
    PopupLevel,
    PopupRow,
    getBrowseDir,
    isPlaying,
    setIsPlaying,
    mmdRuntime,
    autoLoop,
    setAutoLoop,
    layerBindingTargetId,
    setLayerBindingTargetId,
    stackRegistry,
    closeAllOverlays,
    cardContainer,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { slideRow, addToggleRow, addSliderRow, addEmptyRow } from '../core/ui-helpers';
import { loadManager } from '../core/load-manager';

import {
    loadVPDPose,
    updatePlaybackUI,
    focusModel,
    getPhysicsCategories,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
    modelManager,
} from '../scene/scene';
import {
    getVmdLayers,
    toggleVmdLayer,
    setVmdLayerWeight,
    removeVmdLayer,
    replaceVmdLayerVmd,
} from '../scene/motion/vmd-layers';
import { clearAudio, getAudioName, syncAudioPlayback } from '../outfit/audio';
import {
    loadAndRetargetAnimation,
    playRetargetedAnimation,
} from '../scene/motion/animation-retargeter';
import { triggerAutoSave, pushUndoSnapshot, offerSceneUndo } from '../scene/scene';
import { SelectImportFile } from '../core/wails-bindings';
import {
    setProcMotionMode,
    setProcMotionAutoSwitch,
    getProcMotionState,
    regenerateProcMotion,
    getLipSyncState,
    setLipSyncEnabled,
} from '../scene/scene';
import type { ProcMotionMode } from '../motion-algos/procedural-motion';
import { buildProcMotionLevel } from './motion-procmotion-levels';
import { buildGazeTrackingLevel } from './motion-gaze-levels';
import { buildCameraLevel } from './motion-camera-levels';
import { buildMotionOverrideLevel } from './motion-override-levels';
import { buildPoseStudioLevel } from './motion-pose-levels';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import {
    setActiveMotion,
    getActiveMotion,
    getMotionGen,
    resolveCompatibility,
    initMotionIntent,
} from '../scene/motion/motion-intent';
import { applyMotionModulesToModel } from '../scene/motion/motion-modules/registry';
import type { SceneMotionIntent, VmdLayer, ModelMotionSlots, ModelInstance } from '@/core/types';
import { renderMenu } from './render-menu';
import { logWarn } from '../core/utils';
import type { MenuNode } from './menu-schema';

// 模块级状态（动作绑定面板）：
//   layerBindingTargetId = 顶层「添加动作」浏览入口的目标模型 id（承接 VMD 选择）
//   _focusedLayerId      = 当前「焦点动作」：null=基础动作，string=具体叠加层 id。
//                         行 leading check-circle 写入；顶层 browse 读取，按需替换该动作。
//                         「添加动作」语义：无动作→新增基础；焦点层→替换该层；焦点基础→替换基础。
//                         进入动作绑定面板（motionOnItemClick）重置为 null（基础）。
let _focusedLayerId: string | null = null;

// [doc:adr-121] 默认双槽位（inherit + idle）
const DEFAULT_MOTION_SLOTS: ModelMotionSlots = {
    primary: { source: 'inherit', status: 'idle' },
    overlay: { source: 'inherit', status: 'idle' },
};

/** 确保 inst.motionSlots 存在并返回（懒初始化，保留已有 overlay） */
function _ensureMotionSlots(inst: ModelInstance): ModelMotionSlots {
    if (!inst.motionSlots) {
        inst.motionSlots = {
            primary: { ...DEFAULT_MOTION_SLOTS.primary },
            overlay: { ...DEFAULT_MOTION_SLOTS.overlay },
        };
    }
    return inst.motionSlots;
}

// [doc:adr-121] 向单个模型应用动作意图（复用广播与 unpin 场景）
export function applyIntentToModel(id: string, intent: SceneMotionIntent, gen: number): void {
    const inst = modelManager.get(id);
    if (!inst) {
        return;
    }
    const slots = _ensureMotionSlots(inst);
    const bones =
        inst.mmdModel?.runtimeBones?.map((b) => b.name) ??
        inst.meshes[0]?.skeleton?.bones?.map((b) => b.name) ??
        [];
    const compat = resolveCompatibility(bones, intent);
    if (!compat.compatible) {
        slots.primary = { ...slots.primary, status: 'incompatible' };
        return;
    }
    // [fix:adr-129] 动作本体未变（仅模块配置变更 / 同路径重广播）时跳过 VMD 重载：
    // 否则每次 setActiveMotion 都会重新 load + seekAnimation(0)，把动画重启到帧 0，
    // 表现为角色持续抖动 + 播放进度重置到 ~0.01s。
    if (intent.vmdPath && inst.vmdPath === intent.vmdPath) {
        applyMotionModulesToModel(id);
        return;
    }
    if (!intent.vmdPath) {
        // 仅模块配置（无动作路径）或 runtime 未就绪的 pending 状态：不重载 VMD
        return;
    }
    loadManager
        .load({ kind: 'vmd', path: intent.vmdPath, modelId: id })
        .then((handle) => {
            if (getMotionGen() !== gen) {
                return;
            }
            if (handle) {
                inst.vmdName = handle.name;
                inst.vmdPath = intent.vmdPath;
                slots.primary = { source: 'inherit', status: 'compatible' };
                // [doc:adr-129] 应用场景级模块配置
                applyMotionModulesToModel(id);
            }
        })
        .catch(() => {
            if (getMotionGen() !== gen) {
                return;
            }
            slots.primary = { source: 'inherit', status: 'incompatible' };
        });
}

// [doc:adr-121] 注册广播回调：setActiveMotion 时按 per-model assignment 策略应用动作
// 不再在模块顶层注册，改由 scene.ts initScene 通过 initMotionBroadcast() 显式调用
// 以避免 import 时即注册的副作用（HMR/测试场景下回调被覆盖）
export function initMotionBroadcast(): void {
    initMotionIntent((intent, gen, prev) => {
        for (const [id, inst] of modelManager.modelRegistry) {
            const slots = inst.motionSlots ?? DEFAULT_MOTION_SLOTS;
            // pinned/procedural 槽位1 不被场景广播覆盖
            if (slots.primary.source === 'pinned' || slots.primary.source === 'procedural') {
                continue;
            }
            if (!intent) {
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
                applyIntentToModel(id, intent, gen);
            }
        }
    });
}

// ======== 从子文件导入 ========
// ======== Barrel Re-Exports ========
// ======== 物理类别 → i18n key 映射（运行时 t()，支持热切换）========
const CAT_KEYS: Record<string, string> = {
    skirt: 'motion.catSkirt',
    chest: 'motion.catChest',
    hair: 'motion.catHair',
    accessory: 'motion.catAccessory',
};

// ======== Build action model row and binding =====
// [doc:adr-129] 角色绑定面板：仅保留 per-model 专属功能（姿势库、pin/unpin、物理开关）
// 动作覆盖模块已移至场景级（随动作走），不再在此面板显示

function buildActionBindingSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [];
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

                    // 不兼容提示
                    if (isIncompatible) {
                        const warn = document.createElement('div');
                        warn.style.cssText =
                            'color:var(--color-warn);padding:4px 0;font-size:12px;';
                        warn.textContent = t('motion.intent.incompatible');
                        inner.appendChild(warn);
                    }

                    if (hasGlobalMotion || isPinned) {
                        if (isPinned) {
                            const unpinBtn = document.createElement('button');
                            unpinBtn.className = 'preset-chip';
                            unpinBtn.textContent = t('motion.context.unpin');
                            unpinBtn.addEventListener('click', () => {
                                _ensureMotionSlots(inst).primary = { source: 'inherit', status: 'idle' };
                                if (active) {
                                    applyIntentToModel(id, active, getMotionGen());
                                }
                                getMotionMenu()?.reRender();
                                setStatus(t('motion.override.redoApplied'), true);
                            });
                            inner.appendChild(unpinBtn);
                        } else {
                            const pinBtn = document.createElement('button');
                            pinBtn.className = 'preset-chip';
                            pinBtn.textContent = t('motion.context.pinMotion');
                            pinBtn.addEventListener('click', () => {
                                if (active) {
                                    _ensureMotionSlots(inst).primary = {
                                        source: 'pinned',
                                        pinned: structuredClone(active),
                                        status: 'overridden',
                                    };
                                    getMotionMenu()?.reRender();
                                    setStatus(t('motion.override.redoApplied'), true);
                                }
                            });
                            inner.appendChild(pinBtn);
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
    ];
}

function buildActionBindingLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('motion.intent.title'), dir: '', items: [] };
    }
    return {
        label: inst.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildActionBindingSchema(id), container);
        },
    };
}

/** 单图层次级菜单：将「内联权重进度条」下沉为可扩展的次级菜单项。
 *  行三区(leading eye / label / trailing trash)仅做快操，细节编辑走此菜单，
 *  与模型库「齿轮→工具菜单」范式一致，为后续大统一铺路。 */
function buildLayerLevel(layerId: string, id: string): PopupLevel {
    return {
        label: t('motion.layerSettings'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const layer = getVmdLayers(id).find((l) => l.id === layerId);
            if (!layer) {
                return;
            }
            const schema: MenuNode[] = [
                // 启用开关（原行内 eye 开关下沉至此）
                {
                    id: 'layer:enable',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            addToggleRow(
                                inner,
                                t('motion.enable'),
                                layer.enabled,
                                () => {
                                    toggleVmdLayer(layerId, id);
                                    getMotionMenu()?.reRender();
                                },
                                'lucide:eye',
                                {
                                    bind: () =>
                                        getVmdLayers(id).find((l) => l.id === layerId)?.enabled ??
                                        false,
                                }
                            );
                        });
                    },
                },
                // 权重滑块（原行内进度条的等价功能，下沉至此）
                {
                    id: 'layer:weight',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            addSliderRow(
                                inner,
                                t('motion.weight'),
                                layer.weight,
                                0,
                                1,
                                0.05,
                                (v) => setVmdLayerWeight(layerId, v, id),
                                'lucide:sliders-horizontal'
                            );
                        });
                    },
                },
                // 删除图层
                {
                    id: 'layer:delete',
                    kind: 'custom',
                    renderCustom: (c) => {
                        cardContainer(c, (inner) => {
                            slideRow(
                                inner,
                                'lucide:trash-2',
                                t('motion.deleteLayer'),
                                false,
                                () => {
                                    const snap = pushUndoSnapshot();
                                    removeVmdLayer(layerId, id);
                                    triggerAutoSave();
                                    getMotionMenu()?.pop();
                                    getMotionMenu()?.reRender();
                                    offerSceneUndo(t('motion.deleteLayer'), snap, () => {
                                        getMotionMenu()?.reRender();
                                        setStatus(t('motion.undoApplied'), true);
                                    });
                                },
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                { variant: 'danger' }
                            );
                        });
                    },
                },
            ];
            renderMenu(schema, container);
        },
    };
}

// ======== Motion Detail (ADR-129 Phase 2) ========

/**
 * 动作详情子页 schema——场景级当前动作的统一管理入口（ADR-129 Phase 2）。
 * 整合：当前动作 + 清除 / 图层管理 / 完整播放控制（播放·循环·进度·速度）。
 * 图层以「聚焦模型 / 首个 actor」为目标，与根层 Card 1 状态行共用 playback.ts 单一数据源。
 */
function buildMotionDetailSchema(): MenuNode[] {
    const schema: MenuNode[] = [];
    const active = getActiveMotion();
    const foc = modelManager.focused();
    const target =
        foc ?? [...modelManager.modelRegistry.values()].find((m) => m.kind === 'actor') ?? null;

    // 卡片 1：当前动作名 + 清除按钮
    schema.push({
        id: 'detail:current',
        kind: 'custom',
        renderCustom: (c) => {
            cardContainer(c, (inner) => {
                slideRow(
                    inner,
                    active ? 'lucide:music-2' : 'lucide:circle-slash',
                    active?.vmdName || t('motion.intent.none'),
                    false,
                    () => {},
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    { wrapLabel: true }
                );
                if (active && target?.mmdModel && mmdRuntime) {
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'preset-chip';
                    clearBtn.textContent = t('motion.clearVmd');
                    clearBtn.addEventListener('click', () => {
                        const snap = pushUndoSnapshot();
                        setActiveMotion(null);
                        if (isPlaying) {
                            mmdRuntime.pauseAnimation();
                            setIsPlaying(false);
                        }
                        updatePlaybackUI();
                        getMotionMenu()?.reRender();
                        triggerAutoSave();
                        setStatus(t('motion.motionCleared'), true);
                        offerSceneUndo(t('motion.motionCleared'), snap, () => {
                            getMotionMenu()?.reRender();
                            setStatus(t('motion.undoApplied'), true);
                        });
                    });
                    inner.appendChild(clearBtn);
                }
            });
        },
    });

    // 卡片 2：场景级图层管理（仅在有叠加层时显示）
    if (active && active.vmdLayers.length > 0) {
        schema.push({
            id: 'detail:layers',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    for (const layer of active.vmdLayers) {
                        slideRow(inner, '', layer.name, false, () => {
                            const lvl = buildLayerLevel(layer.id, target?.id ?? '');
                            getMotionMenu()?.push(lvl);
                        }, undefined, undefined, undefined, undefined, {
                            wrapLabel: true,
                            trailing: {
                                icon: 'lucide:settings-2',
                                title: t('library.modelTools'),
                                onClick: () => {
                                    const lvl = buildLayerLevel(layer.id, target?.id ?? '');
                                    getMotionMenu()?.push(lvl);
                                },
                            },
                        });
                    }
                });
            },
        });
    }

    // 卡片 3：骨骼覆盖（跳转入口，避免二级界面挤占空间）
    if (active) {
        schema.push({
            id: 'detail:boneOverride',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(
                        inner,
                        'tabler:bone',
                        t('motion.override.title'),
                        true,
                        () => {
                            getMotionMenu()?.push(buildMotionOverrideLevel());
                        }
                    );
                });
            },
        });
    }

    // 播放速度（底部播放栏无此功能，保留）
    schema.push({
        id: 'detail:speed',
        kind: 'custom',
        renderCustom: (c) => {
            cardContainer(c, (inner) => {
                addSliderRow(
                    inner,
                    t('motion.playbackSpeed'),
                    _playbackSpeed,
                    0.1,
                    2.0,
                    0.05,
                    (v) => {
                        _playbackSpeed = v;
                        if (mmdRuntime) {
                            mmdRuntime.timeScale = v;
                        }
                    },
                    'lucide:gauge'
                );
            });
        },
    });

    return schema;
}

function buildMotionDetailLevel(): PopupLevel {
    return {
        label: t('motion.detail.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMotionDetailSchema(), container);
        },
    };
}

// ======== Motion Stack ========

const {
    getMenu: getMotionMenu,
    refreshRoot: refreshMotionRoot,
    show: showMotionPopup,
} = registerPopupMenu({
    wrapperKey: 'motion-popup',
    popupType: 'motion',
    overlayClass: 'sceneOverlay-motion',
    buildRoot: () => buildMotionRootLevel(),
    buildRootItems: () => buildMotionRootItems(),
    handlers: {
        onItemClick: motionOnItemClick,
        onFolderEnter: motionOnFolderEnter,
    },
});

export { getMotionMenu, refreshMotionRoot, showMotionPopup };

// 当库扫描完成时，如果动作菜单已打开则 reRender，
// 使音乐库等依赖 allModels 的 renderCustom 回调拿到最新数据。
// 提取为命名函数以便 removeEventListener 配对
const _onLibraryScanned = (): void => {
    getMotionMenu()?.reRender();
};
window.addEventListener('mmar:library-scanned', _onLibraryScanned);

/** 释放 motion-popup 模块资源（HMR/清理时调用） */
export function disposeMotionPopup(): void {
    window.removeEventListener('mmar:library-scanned', _onLibraryScanned);
}

/** motion-popup 的 onFolderEnter 路由（从 makeMotionMenu 提取） */
// [doc:adr-065] 子层路由表：target → 纯 items 构建器；自动挂 itemBuilder 实现语言热刷新
const MOTION_FOLDER_ROUTES: Record<string, () => PopupLevel> = {
    'motion:camera': buildCameraLevel,
    'motion:playbackSpeed': buildPlaybackSpeedLevel,
    'motion:procmotion': buildProcMotionLevel,
    'motion:gaze': buildGazeTrackingLevel,
    'motion:boneOverride': buildMotionOverrideLevel,
    'motion:poseStudio': buildPoseStudioLevel,
    'motion:retarget': buildRetargetLevel,
};

function motionOnFolderEnter(row: PopupRow): PopupLevel | null {
    const builder = MOTION_FOLDER_ROUTES[row.target as string];
    if (builder) {
        const lvl = builder();
        lvl.itemBuilder = () => builder().items;
        return lvl;
    }
    return null;
}

/** motion-popup 的 onItemClick（从 makeMotionMenu 提取） */
function motionOnItemClick(row: PopupRow): void {
    if (row.model) {
        // 顶层「添加动作」上下文敏感语义（对齐模型库「加载首个/替换已选」能力，移除叠加入口）：
        //   · 无动作            → 新增为第一个基础动作（loadManager.load 写 vmdData）
        //   · 焦点在具体叠加层  → 仅替换该层 VMD（replaceVmdLayerVmd，保留层 id/权重/启用，不清旧）
        //   · 焦点在基础动作    → 替换基础动作（loadManager.load 覆盖 vmdData，保留其余图层）
        // 基础/图层选中由行 leading check-circle 写入 _focusedLayerId；进入面板默认 null=基础。
        if (row.model.format === 'vmd') {
            // 场景级路径：layerBindingTargetId 为 null 时
            if (!layerBindingTargetId) {
                const cur = getActiveMotion();
                if (!cur) {
                    // 无动作 → 设为当前动作
                    setActiveMotion({
                        vmdPath: row.model.file_path,
                        vmdName: row.model.name_jp || row.model.name_en || '',
                        vmdLayers: [],
                        source: 'vmd',
                    });
                } else {
                    // 已有动作 → 添加为叠加层
                    const layerName = (row.model.name_jp || row.model.name_en || '').replace(/\.vmd$/i, '');
                    const newLayer: VmdLayer = {
                        id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        name: layerName,
                        kind: 'vmd',
                        data: new ArrayBuffer(0), // 运行时由广播加载
                        path: row.model.file_path,
                        weight: 1.0,
                        enabled: true,
                        boneFilter: [],
                    };
                    setActiveMotion({
                        ...cur,
                        vmdLayers: [...cur.vmdLayers, newLayer],
                    });
                }
                if (getMotionMenu()) {
                    getMotionMenu()?.pop();
                    getMotionMenu()?.reRender();
                }
                return;
            }
            // per-model 路径：从动作绑定面板进入
            const targetId = layerBindingTargetId;
            const focusedLayerId = _focusedLayerId; // 捕获当前焦点动作（null=基础）
            setLayerBindingTargetId(null);
            // 返回动作管理页（pop VMD 浏览器层）
            if (getMotionMenu()) {
                getMotionMenu()?.pop();
            }
            const after = (): void => {
                getMotionMenu()?.reRender();
            };
            const fail = (label: string, err: unknown): void => {
                setStatus(t('motion.motionLoadFailed'), false);
                logWarn('motion-popup', label, err);
                after();
            };
            const inst = modelManager.get(targetId);
            const hasActions = !!inst?.vmdData || getVmdLayers(targetId).length > 0;
            if (!hasActions) {
                // 无动作 → 新增为第一个基础动作，设场景级意图（广播已加载所有 inherit 模型）
                setActiveMotion({
                    vmdPath: row.model.file_path,
                    vmdName: row.model.name_jp || row.model.name_en || '',
                    vmdLayers: [],
                    source: 'vmd',
                });
                after();
                return;
            }
            // 有动作：优先替换焦点层（若仍存在），否则替换基础（保留其余图层）
            if (focusedLayerId && getVmdLayers(targetId).some((l) => l.id === focusedLayerId)) {
                replaceVmdLayerVmd(focusedLayerId, row.model.file_path, targetId)
                    .then(after)
                    .catch((err) => fail('motion-popup replace layer VMD:', err));
                return;
            }
            // 替换基础动作，同时设场景级意图（广播已加载所有 inherit 模型）
            setActiveMotion({
                vmdPath: row.model.file_path,
                vmdName: row.model.name_jp || row.model.name_en || '',
                vmdLayers: [],
                source: 'vmd',
            });
            after();
            return;
        }
        hideMotionPopup();
        if (row.model.format === 'vmd') {
            loadManager
                .load({ kind: 'camera-vmd', path: row.model.file_path })
                .then(() => {
                    const menu = getMotionMenu();
                    if (menu) {
                        menu.reRender();
                    }
                })
                .catch((err) => {
                    console.error('Load camera VMD failed:', err);
                    setStatus(t('motion.loadFailed'), false);
                });
            return;
        }
        if (row.model.format === 'audio') {
            loadManager.load({ kind: 'audio', path: row.model.file_path });
            setStatus(t('motion.musicLoaded', { name: getAudioName() }), true);
            if (getMotionMenu()) {
                getMotionMenu()?.reRender();
            }
            return;
        }
        if (row.model.format === 'vpd') {
            loadVPDPose(row.model.file_path);
            return;
        }
        return;
    }
    if (row.target && row.target.startsWith('action:binding:')) {
        const id = row.target.replace('action:binding:', '');
        // 进入动作绑定面板：焦点动作重置为基础（清跨模型残留焦点）
        _focusedLayerId = null;
        const lvl = buildActionBindingLevel(id);
        lvl.itemBuilder = () => buildActionBindingLevel(id).items;
        if (getMotionMenu()) {
            getMotionMenu()?.push(lvl);
        }
        return;
    }
    if (row.target && row.target.startsWith('procmotion:set-mode:')) {
        setProcMotionMode(row.target.replace('procmotion:set-mode:', '') as ProcMotionMode);
        regenerateProcMotion();
        return;
    }
    if (row.target === 'procmotion:autoswitch') {
        setProcMotionAutoSwitch(!getProcMotionState().autoSwitch);
        getMotionMenu()?.reRender();
        return;
    }
    if (row.target === 'lipsync:toggle') {
        setLipSyncEnabled(!getLipSyncState().enabled);
        getMotionMenu()?.reRender();
        return;
    }
    if (row.target && row.target.startsWith('action:motion:')) {
        const parts = row.target.split(':');
        const action = parts[2];
        const id = parts.slice(3).join(':');
        if (!id) {
            return;
        }
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
                    setActiveMotion(null);
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
        return;
    }
    if (row.target === '__music_browse__') {
        const level = stackRegistry.buildLevel!(
            getBrowseDir('audio'),
            t('motion.musicLibrary'),
            (m) => m.format === 'audio',
            getMotionMenu() ?? undefined
        );
        if (getMotionMenu()) {
            getMotionMenu()?.push(level);
        }
        return;
    }
    // [doc:adr-129] 场景级动作库浏览：选 VMD → setActiveMotion 广播到所有 inherit 模型。
    if (row.target === '__scene_motion_browse__') {
        _focusedLayerId = null;
        const foc = modelManager.focused();
        const target = foc ?? [...modelManager.modelRegistry.values()].find((m) => m.kind === 'actor') ?? null;
        if (!target) {
            setStatus(t('motion.retarget.noModel'), false);
            return;
        }
        // [doc:adr-131] 连续预览：声明 stay 契约，点选 VMD 后保持浏览器打开
        const level = stackRegistry.buildLevel!(
            getBrowseDir('vmd'),
            t('motion.browseMotionLibrary'),
            (m) => m.format === 'vmd',
            getMotionMenu() ?? undefined,
            undefined,
            { mode: 'stay', modelId: target.id }
        );
        if (getMotionMenu()) {
            getMotionMenu()?.push(level);
        }
        return;
    }
    // [doc:adr-129] 动作详情入口：当前场景级动作 → 图层管理 + 清除 + 播放控制
    if (row.target === '__motion_detail__') {
        const lvl = buildMotionDetailLevel();
        lvl.itemBuilder = () => [];
        getMotionMenu()?.push(lvl);
        return;
    }
    // 清除场景级动作
    if (row.target === '__motion_clear__') {
        const snap = pushUndoSnapshot();
        setActiveMotion(null);
        if (isPlaying && mmdRuntime) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        updatePlaybackUI();
        getMotionMenu()?.reRender();
        triggerAutoSave();
        setStatus(t('motion.motionCleared'), true);
        offerSceneUndo(t('motion.motionCleared'), snap, () => {
            getMotionMenu()?.reRender();
            setStatus(t('motion.undoApplied'), true);
        });
        return;
    }
    if (row.target === '__music_clear__') {
        clearAudio();
        setStatus(t('motion.musicRemoved'), true);
        if (getMotionMenu()) {
            getMotionMenu()?.reRender();
        }
        return;
    }
    if (row.target === '__retarget_mixamo__') {
        _importExternalAnimation('mixamo');
        return;
    }
    if (row.target === '__retarget_vrm__') {
        _importExternalAnimation('vrm');
        return;
    }
    if (row.target === '__retarget_custom__') {
        _importExternalAnimation('custom');
        return;
    }
}

// ======== Playback Speed (VMD timeScale) ========
// 仅影响 VMD 骨骼动画时间推进（mmdRuntime.timeScale），不联动音频/节拍/物理/相机 VMD。
// 模块级变量：mmdRuntime 为 null 时仍记忆用户选择，等 runtime 就绪后应用。
let _playbackSpeed = 1.0;

/** 将记忆中的播放速度同步到新的 mmdRuntime 实例（防状态漂移）。 */
export function syncPlaybackSpeedToRuntime(runtime: { timeScale: number }): void {
    runtime.timeScale = _playbackSpeed;
}

function buildPlaybackSpeedSchema(): MenuNode[] {
    return [
        {
            id: 'playbackSpeed:slider',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSliderRow(
                        inner,
                        t('motion.playbackSpeed'),
                        _playbackSpeed,
                        0.1,
                        2.0,
                        0.05,
                        (v) => {
                            _playbackSpeed = v;
                            if (mmdRuntime) {
                                mmdRuntime.timeScale = v;
                            }
                        },
                        'lucide:gauge'
                    );
                });
            },
        },
    ];
}

function buildPlaybackSpeedLevel(): PopupLevel {
    return {
        label: t('motion.playbackSpeed'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildPlaybackSpeedSchema(), container);
        },
    };
}

// ======== Advanced (收纳高级/技术向功能) ========
// 注：脚步调整 / 虚拟裙骨已迁移至模型详情页「故障排除」折叠组（per-model）。
// 骨骼覆盖已移至动作详情页。本「高级」菜单已清空，相关入口已从根菜单移除。

// ======== 外部动作导入 — 骨骼映射预设选择 ========

function buildRetargetLevel(): PopupLevel {
    return {
        label: '外部动作导入',
        dir: '',
        items: [
            {
                kind: 'action',
                label: 'Mixamo → MMD',
                icon: 'lucide:user',
                target: '__retarget_mixamo__',
                sublabel: 'mixamorig:XXX 骨骼',
            },
            {
                kind: 'action',
                label: 'VRM → MMD',
                icon: 'lucide:user',
                target: '__retarget_vrm__',
                sublabel: 'VRM 标准骨骼',
            },
            {
                kind: 'action',
                label: '自定义映射',
                icon: 'lucide:edit',
                target: '__retarget_custom__',
                sublabel: '手动配置骨骼对应',
            },
        ],
    };
}

// ======== Motion Root (items-based) ========

/** 构建当前动作源显示标签（VMD 或程序化动作） */
function _buildCurrentMotionLabel(): { label: string; icon: string } {
    const active = getActiveMotion();
    if (active?.vmdName) {
        return { label: active.vmdName, icon: 'lucide:music-2' };
    }
    const procState = getProcMotionState();
    if (procState.mode !== 'off') {
        const modeLabel = procState.mode === 'idle' ? t('motion.modeIdle') : t('motion.modeAutodance');
        return { label: modeLabel, icon: 'lucide:wind' };
    }
    return { label: t('motion.noMotionHint'), icon: 'lucide:circle-slash' };
}

function buildMotionRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    const { label: motionLabel, icon: motionIcon } = _buildCurrentMotionLabel();

    // ===== Card 1: 当前动作（场景级）+ 图层管理 =====
    const active = getActiveMotion();
    const procState = getProcMotionState();
    const hasMotion = !!active?.vmdName || procState.mode !== 'off';

    if (hasMotion && active) {
        // 当前动作名 → 点击进入详情页（包含覆盖、速度等设置）
        items.push({
            kind: 'action',
            label: motionLabel,
            icon: motionIcon,
            target: '__motion_detail__',
            sublabel: t('motion.currentMotion'),
            wrapLabel: true,
            trailing: {
                icon: 'lucide:trash-2',
                title: t('motion.clearVmd'),
                danger: true,
                onClick: () => {
                    const snap = pushUndoSnapshot();
                    setActiveMotion(null);
                    if (isPlaying && mmdRuntime) {
                        mmdRuntime.pauseAnimation();
                        setIsPlaying(false);
                    }
                    updatePlaybackUI();
                    getMotionMenu()?.reRender();
                    triggerAutoSave();
                    setStatus(t('motion.motionCleared'), true);
                    offerSceneUndo(t('motion.motionCleared'), snap, () => {
                        getMotionMenu()?.reRender();
                        setStatus(t('motion.undoApplied'), true);
                    });
                },
            },
        });
        // 场景级图层列表（内联显示）
        for (const layer of active.vmdLayers) {
            items.push({
                kind: 'action',
                label: layer.name,
                icon: 'lucide:layers',
                target: '',
                sublabel: `${(layer.weight * 100).toFixed(0)}%`,
                trailing: {
                    icon: 'lucide:settings-2',
                    title: t('library.modelTools'),
                    onClick: () => {
                        const foc = modelManager.focused();
                        const targetId = foc?.id ?? [...modelManager.modelRegistry.values()].find((m) => m.kind === 'actor')?.id ?? '';
                        const lvl = buildLayerLevel(layer.id, targetId);
                        getMotionMenu()?.push(lvl);
                    },
                },
            });
        }
    } else {
        // 无动作时显示提示
        items.push({
            kind: 'action',
            label: motionLabel,
            icon: motionIcon,
            target: '',
            sublabel: t('motion.noMotionHint'),
            wrapLabel: true,
        });
    }
    items.push({
        kind: 'action',
        label: t('motion.browseMotionLibrary'),
        icon: 'lucide:folder-search',
        target: '__scene_motion_browse__',
    });
    items.push({
        kind: 'folder',
        label: t('motion.procMotion'),
        icon: 'lucide:wind',
        target: 'motion:procmotion',
    });

    // ===== Card 2: 场景工具 =====
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'folder',
        label: t('motion.camera'),
        icon: 'lucide:video',
        target: 'motion:camera',
    });
    items.push({
        kind: 'action',
        label: getAudioName() ? t('motion.musicLibrary') : t('motion.browseMusic'),
        icon: 'lucide:music',
        target: '__music_browse__',
        sublabel: getAudioName() || undefined,
    });
    if (getAudioName()) {
        items.push({
            kind: 'action',
            label: t('motion.removeMusic'),
            icon: 'lucide:trash-2',
            target: '__music_clear__',
        });
    }
    items.push({
        kind: 'folder',
        label: t('motion.poseStudio.title'),
        icon: 'lucide:camera',
        target: 'motion:poseStudio',
    });
    items.push({
        kind: 'folder',
        label: t('motion.gazeTracking'),
        icon: 'lucide:eye',
        target: 'motion:gaze',
    });
    if (modelManager.size > 0) {
        items.push({
            kind: 'folder',
            label: t('motion.externalImport'),
            icon: 'lucide:upload',
            target: 'motion:retarget',
        });
    }
    return items;
}

/** 构建 per-model 角色状态子标签 */
function _buildActorSublabel(inst: { vmdName?: string; motionSlots?: ModelMotionSlots }): string | undefined {
    const slots = inst.motionSlots ?? DEFAULT_MOTION_SLOTS;
    if (slots.primary.status === 'incompatible') {
        return t('motion.intent.incompatible');
    }
    if (slots.primary.source === 'pinned') {
        const name = inst.vmdName || slots.primary.pinned?.vmdName || '?';
        return t('motion.pinnedFmt', { name });
    }
    const active = getActiveMotion();
    if (active && active.vmdPath) {
        return t('motion.followGlobal');
    }
    return inst.vmdName || undefined;
}

function buildMotionRootLevel(): PopupLevel {
    return {
        label: t('motion.title'),
        dir: '',
        items: buildMotionRootItems(),
        itemBuilder: () => buildMotionRootItems(),
    };
}

export function hideMotionPopup(): void {
    closeAllOverlays();
}

// ======== 外部动作导入 ========

/** 外部动作导入：选文件 → 重定向骨骼 → 播放。 */
async function _importExternalAnimation(
    preset: 'mixamo' | 'vrm' | 'custom' = 'mixamo'
): Promise<void> {
    // 1. 选文件
    let path: string;
    try {
        path = await SelectImportFile();
    } catch {
        return; // 用户取消
    }
    if (!path) {
        return;
    }

    // 2. 找聚焦模型
    const foc = modelManager.focused();
    if (!foc || !foc.mmdModel) {
        setStatus(t('motion.retarget.noModel'), false);
        return;
    }

    // 3. 获取模型骨骼
    const mesh = foc.mmdModel.mesh;
    if (!mesh || !mesh.skeleton) {
        setStatus(t('motion.retarget.noBones'), false);
        return;
    }

    // 4. 加载并重定向
    const scene = mesh.getScene();
    const result = await loadAndRetargetAnimation(scene, path, mesh.skeleton, preset);
    if (!result) {
        // 错误已在 loadAndRetargetAnimation 中通过 setStatus 报告
        return;
    }

    // 5. 播放
    hideMotionPopup();
    playRetargetedAnimation(scene, result);
    setStatus(t('motion.retarget.loaded', { preset }), true);
}
