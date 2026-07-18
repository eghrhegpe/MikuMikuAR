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
    focusedModelId,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { slideRow, addToggleRow, addSliderRow, addEmptyRow } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
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
    clearVmdLayers,
    replaceVmdLayerVmd,
} from '../scene/motion/vmd-layers';
import { clearAudio, getAudioName } from '../outfit/audio';
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
import {
    buildProcMotionLevel,
} from './motion-procmotion-levels';
import { buildGazeTrackingLevel } from './motion-gaze-levels';
import { buildCameraLevel } from './motion-camera-levels';
import { buildMotionOverrideLevel } from './motion-override-levels';
import { buildFeetLevel } from './motion-feet-levels'; // [doc:adr-085]
import { buildPoseStudioLevel } from './motion-pose-levels';
import { buildVirtualSkirtLevel } from './motion-cloth-levels'; // [doc:adr-084]
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { setActiveMotion, setBroadcastCallback, getActiveMotion, getMotionGen, resolveCompatibility, initMotionIntent } from '../scene/motion/motion-intent';
import { renderMenu } from './render-menu';
import { isUnderRoot, logWarn } from '../core/utils';
import type { MenuNode } from './menu-schema';

// 模块级状态（动作绑定面板）：
//   layerBindingTargetId = 顶层「添加动作」浏览入口的目标模型 id（承接 VMD 选择）
//   _focusedLayerId      = 当前「焦点动作」：null=基础动作，string=具体叠加层 id。
//                         行 leading check-circle 写入；顶层 browse 读取，按需替换该动作。
//                         「添加动作」语义：无动作→新增基础；焦点层→替换该层；焦点基础→替换基础。
//                         进入动作绑定面板（motionOnItemClick）重置为 null（基础）。
let _focusedLayerId: string | null = null;

// [doc:adr-121] 注册广播回调：setActiveMotion 时按 per-model assignment 策略应用动作
// 不再在模块顶层注册，改由 scene.ts initScene 通过 initMotionBroadcast() 显式调用
// 以避免 import 时即注册的副作用（HMR/测试场景下回调被覆盖）
export function initMotionBroadcast(): void {
    initMotionIntent((intent, gen, prev) => {
    for (const [id, inst] of modelManager.modelRegistry) {
        const assignment = inst.motionAssignment ?? { mode: 'inherit' as const, status: 'idle' as const };
        if (assignment.mode === 'pinned') continue; // pinned 模型不受全局影响
        if (!intent) {
            // 清除：仅当模型当前 vmdPath 来自前一个全局意图时才清除
            // prev 由 setActiveMotion 在更新 _activeMotion 之前捕获，确保不为 null
            if (inst.mmdModel && mmdRuntime && inst.vmdPath && prev?.vmdPath && inst.vmdPath === prev.vmdPath) {
                inst.mmdModel.setRuntimeAnimation(null);
                inst.vmdData = null;
                inst.vmdName = '';
                inst.vmdPath = null;
                inst.animationDuration = 0;
            }
        } else {
            // 兼容性检查：模型骨骼是否支持该 VMD
            const bones = inst.mmdModel?.runtimeBones?.map((b) => b.name) ?? [];
            const compat = resolveCompatibility(bones, intent);
            if (!compat.compatible) {
                inst.motionAssignment = { ...assignment, status: 'incompatible' };
                continue; // 跳过加载，UI 显示 incompatible 提示
            }
            // 加载 VMD 到模型（异步，loadManager 处理队列）
            // gen 捕获当前 generation，.then 时检查是否仍是最新广播
            loadManager.load({ kind: 'vmd', path: intent.vmdPath!, modelId: id })
                .then((handle) => {
                    if (getMotionGen() !== gen) return; // 已过期，丢弃
                    if (handle) {
                        inst.vmdName = handle.name;
                        inst.vmdPath = intent.vmdPath;
                        inst.motionAssignment = { mode: 'inherit', status: 'compatible' };
                    }
                })
                .catch(() => {
                    if (getMotionGen() !== gen) return; // 已过期，丢弃
                    inst.motionAssignment = { mode: 'inherit', status: 'incompatible' };
                });
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

function buildActionBindingSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [];
    }

    return [
        // 卡片 1：动作图层（核心功能前置——已加载动作 + 添加动作）
        {
            id: 'binding:layers',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    // 统一动作行渲染器：复用模型栏 actor 行三栏结构
                    const renderActionRow = (
                        name: string,
                        layerId?: string,
                        onClick?: () => void
                    ) => {
                        const isFocused =
                            layerId === undefined
                                ? _focusedLayerId === null
                                : _focusedLayerId === layerId;
                        slideRow(
                            inner,
                            '',
                            name,
                            false,
                            onClick ?? (() => {}),
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            {
                                leading: {
                                    icon: isFocused ? 'lucide:check-circle' : 'lucide:circle',
                                    title: t('library.focusModel'),
                                    onClick: () => {
                                        _focusedLayerId = layerId ?? null;
                                        focusModel(id);
                                        getMotionMenu()?.reRender();
                                    },
                                },
                                wrapLabel: true,
                                ...(layerId !== undefined
                                    ? {
                                          trailing: {
                                              icon: 'lucide:settings-2',
                                              title: t('library.modelTools'),
                                              onClick: () => {
                                                  const lvl = buildLayerLevel(layerId, id);
                                                  if (getMotionMenu()) {
                                                      getMotionMenu()?.push(lvl);
                                                  }
                                              },
                                          },
                                      }
                                    : {}),
                            }
                        );
                    };
                    if (inst.vmdData && inst.vmdName) {
                        const baseName = inst.vmdName.split(' + ')[0];
                        const hasLayers = getVmdLayers(id).length > 0;
                        renderActionRow(
                            hasLayers ? `${baseName} (基础)` : baseName,
                            undefined,
                            undefined
                        );
                    }
                    const curLayers = getVmdLayers(id);
                    for (let i = 0; i < curLayers.length; i++) {
                        const layer = curLayers[i];
                        renderActionRow(layer.name, layer.id, () => {
                            const lvl = buildLayerLevel(layer.id, id);
                            if (getMotionMenu()) {
                                getMotionMenu()?.push(lvl);
                            }
                        });
                    }
                    slideRow(inner, 'lucide:folder', t('motion.addLayer'), true, () => {
                        setLayerBindingTargetId(id);
                        const level = stackRegistry.buildLevel!(
                            getBrowseDir('vmd'),
                            t('motion.motionLibrary'),
                            (m) => m.format === 'vmd',
                            getMotionMenu() ?? undefined
                        );
                        level.label = t('motion.addLayerTo', { name: inst?.name ?? '?' });
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(level);
                        }
                    });
                });
            },
        },
        // 卡片 2：姿势库
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
        // 卡片 3：清除 VMD
        {
            id: 'binding:actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'preset-chip';
                    clearBtn.textContent = t('motion.clearVmd');
                    clearBtn.addEventListener('click', async () => {
                        if (inst && inst.mmdModel && mmdRuntime) {
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
                        }
                    });
                    inner.appendChild(clearBtn);
                });
            },
        },
        // 卡片 4：动作分配策略（pin/unpin）
        {
            id: 'binding:assignment',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const assignment = inst.motionAssignment ?? { mode: 'inherit' as const, status: 'idle' as const };
                    const active = getActiveMotion();
                    const isPinned = assignment.mode === 'pinned';
                    const isIncompatible = assignment.status === 'incompatible';
                    const hasGlobalMotion = !!active && !!active.vmdPath;

                    // 不兼容提示
                    if (isIncompatible) {
                        const warn = document.createElement('div');
                        warn.style.cssText = 'color:var(--color-warn);padding:4px 0;font-size:12px;';
                        warn.textContent = t('motion.intent.incompatible');
                        inner.appendChild(warn);
                    }

                    if (hasGlobalMotion || isPinned) {
                        if (isPinned) {
                            // 已 pin → 显示「跟随全局」按钮
                            const unpinBtn = document.createElement('button');
                            unpinBtn.className = 'preset-chip';
                            unpinBtn.textContent = t('motion.context.unpin');
                            unpinBtn.addEventListener('click', () => {
                                inst.motionAssignment = { mode: 'inherit', status: 'idle' };
                                // 重新应用全局动作
                                if (active) {
                                    setActiveMotion(active);
                                }
                                getMotionMenu()?.reRender();
                                setStatus(t('motion.override.redoApplied'), true);
                            });
                            inner.appendChild(unpinBtn);
                        } else {
                            // 未 pin → 显示「固定此动作」按钮
                            const pinBtn = document.createElement('button');
                            pinBtn.className = 'preset-chip';
                            pinBtn.textContent = t('motion.context.pinMotion');
                            pinBtn.addEventListener('click', () => {
                                if (active) {
                                    inst.motionAssignment = {
                                        mode: 'pinned',
                                        pinned: structuredClone(active),
                                        status: 'overridden',
                                    };
                                    getMotionMenu()?.reRender();
                                    setStatus(t('motion.override.redoApplied'), true);
                                }
                            });
                            inner.appendChild(pinBtn);
                        }
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

/**
 * 动作工具菜单——动作弹窗根层行右齿轮 trailing 的【唯一】入口（对齐模型库 buildModelToolsLevel 范式）。
 * 承载该模型物理类别开关；无物理类别时显示空状态。
 */
function buildActionToolsLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('motion.tools'), dir: '', items: [], renderCustom: () => {} };
    }
    return {
        label: t('motion.tools'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (inner) => {
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
    'motion:feet': buildFeetLevel,
    'motion:poseStudio': buildPoseStudioLevel,
    'motion:virtualSkirt': buildVirtualSkirtLevel,
    'motion:advanced': buildAdvancedLevel,
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
        if (row.model.format === 'vmd' && layerBindingTargetId) {
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

/** 高级菜单 items：收纳骨骼覆盖 / 脚部调整 / 虚拟裙骨。 */
function buildAdvancedItems(): PopupRow[] {
    const items: PopupRow[] = [];
    items.push({
        kind: 'folder',
        label: t('motion.boneOverride.title'),
        icon: 'tabler:bone',
        target: 'motion:boneOverride',
    });
    items.push({
        kind: 'folder',
        label: t('motion.feet.title'),
        icon: 'lucide:footprints',
        target: 'motion:feet',
    });
    items.push({
        kind: 'folder',
        label: t('cloth.title'),
        icon: 'lucide:shirt',
        target: 'motion:virtualSkirt',
    });
    return items;
}

function buildAdvancedLevel(): PopupLevel {
    return {
        label: t('motion.advanced'),
        dir: '',
        items: buildAdvancedItems(),
    };
}

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

/** 动作弹窗根级 items 构建器——动态反映 modelManager / recent / cloth 状态。 */
function buildMotionRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    // Card 1: 已加载模型
    if (modelManager.size > 0) {
        const propDir = (
            overridePaths.prop || (libraryRoot ? libraryRoot + '/prop' : '')
        ).toLowerCase();
        for (const [id, inst] of modelManager.modelRegistry) {
            if (inst.kind !== 'actor') {
                continue;
            }
            // 路径在 prop 目录下的视为道具，不参与动作绑定（[doc:adr-090] 须路径边界判定，禁裸前缀）
            if (isUnderRoot(propDir, inst.filePath)) {
                continue;
            }
            const isFocused = focusedModelId === id;
            const radioIcon = isFocused ? 'lucide:check-circle' : 'lucide:circle';
            items.push({
                kind: 'action',
                label: inst.name,
                icon: radioIcon,
                target: `action:binding:${id}`,
                sublabel: inst.vmdName || undefined,
                wrapLabel: true,
                focused: isFocused,
                // rowKey 编码焦点态：焦点切换时 key 变化 → patchPanel 整行替换 → 图标同步刷新
                rowKey: 'actor:' + id + (isFocused ? ':on' : ':off'),
                // 左侧 radio 指示 = 点击切焦点（与整行 onClick=开动作绑定 解耦，stopPropagation）
                leading: {
                    icon: radioIcon,
                    title: t('motion.focusModel'),
                    onClick: () => {
                        focusModel(id);
                        getMotionMenu()?.reRender();
                    },
                },
                // 右齿轮 = 工具设置（物理开关等）
                trailing: {
                    icon: 'lucide:settings-2',
                    title: t('motion.modelTools'),
                    onClick: () => {
                        const lvl = buildActionToolsLevel(id);
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(lvl);
                        }
                    },
                },
            });
        }
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 2: 相机 + 音乐库 + 姿势工作室
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
        label: t('motion.playbackSpeed'),
        icon: 'lucide:gauge',
        target: 'motion:playbackSpeed',
        sublabel: `${_playbackSpeed.toFixed(2)}x`,
    });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({
        kind: 'folder',
        label: t('motion.procMotion'),
        icon: 'lucide:wind',
        target: 'motion:procmotion',
    });
    items.push({
        kind: 'folder',
        label: t('motion.gazeTracking'),
        icon: 'lucide:eye',
        target: 'motion:gaze',
    });
    items.push({
        kind: 'folder',
        label: t('motion.advanced'),
        icon: 'lucide:settings-2',
        target: 'motion:advanced',
    });
    // Card 4: 外部动作导入
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

function buildMotionRootLevel(): PopupLevel {
    return {
        label: t('motion.title'),
        dir: '',
        items: buildMotionRootItems(),
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
