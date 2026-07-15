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
    buildProcMotionModeLevel,
    buildLipSyncLevel,
} from './motion-procmotion-levels';
import { buildGazeTrackingLevel } from './motion-gaze-levels';
import { buildCameraLevel } from './motion-camera-levels';
import { buildBoneOverrideLevel } from './motion-override-levels';
import { buildFeetLevel } from './motion-feet-levels'; // [doc:adr-085]
import { buildPoseStudioLevel } from './motion-pose-levels';
import { buildVirtualSkirtLevel } from './motion-cloth-levels'; // [doc:adr-084]
import { t } from '../core/i18n/t'; // [doc:adr-059]
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
        // 卡片 1：姿势库（「更换动作」已移除——基础动作改由卡片 4 的「添加图层」统一承接：
        //   无基础时载入即基底座，已有基础时叠加为图层，基础行点击 = 更换）
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
        // 卡片 3：动作图层（统一为模型库 actor 行同款三栏样式）
        //  · 已加载动作（基础 inst.vmdData + 各叠加层 inst.vmdLayers）统一渲染，
        //    复用模型栏选中范式：leading(check-circle=设为焦点→focusModel) | label(wrap-2) | trailing(settings-2=图层工具)
        //  · 移除独立「基础行」：基础动作不再特殊渲染，与叠加层同列——
        //    既消除「同名动作出现两次」的视觉冲突（别纠结基础动作），也贴合模型栏一贯标准
        //  · 已加载动作在前（置顶），「添加图层」folder 浏览行在后（第二），不再抢风头
        //  · 行 onClick / trailing 均 → 次级菜单 buildLayerLevel（权重·启用·删除，原行内进度条与 eye 开关下沉至此）
        {
            id: 'binding:layers',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    // 统一动作行渲染器：复用模型栏 actor 行三栏结构
                    //   · leading check-circle(选中焦点) | label(wrap-2) | trailing settings-2(图层工具，仅图层行)
                    //   · 基础行无 trailing（移除「添加叠加图层」后无次级设置），仅通过 leading 选中→「添加动作」替换
                    const renderActionRow = (
                        name: string,
                        layerId?: string,
                        onClick?: () => void
                    ) => {
                        const isFocused = layerId === undefined
                            ? _focusedLayerId === null  // 基础动作：焦点在 base 时
                            : _focusedLayerId === layerId; // 图层：焦点在该层时
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
                                        // 写入焦点动作：基础行 layerId=undefined→null，图层行=layer.id
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
                    // 基础动作（inst.vmdData）—— 仅作已加载动作之一，无特殊标记
                    // 标签只取第一个 VMD 名（inst.vmdName 可能被旧版 composite 写入 "A + B + C"，
                    // 现已不再覆盖，但内存中已有值的仍需处理）
                    if (inst.vmdData && inst.vmdName) {
                        const baseName = inst.vmdName.split(' + ')[0];
                        // 有叠加层时在 base 名后加「(基础)」标签，避免与同名图层混淆
                        const hasLayers = getVmdLayers(id).length > 0;
                        // 基础行：仅通过 leading 选中（_focusedLayerId=null），交由顶层「添加动作」替换
                        renderActionRow(hasLayers ? `${baseName} (基础)` : baseName, undefined, undefined);
                    }
                    // 叠加层（inst.vmdLayers）
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
                    // 「添加动作」：folder + > 浏览行（模型库「加载模型」同款），置于已加载动作之后
                    //   上下文敏感：无动作→新增基础；焦点层→替换该层；焦点基础→替换基础（见 motionOnItemClick）
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
        // 卡片 5：聚焦模型 + 清除 VMD
        {
            id: 'binding:actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const group = document.createElement('div');
                    group.className = 'preset-group';
                    group.style.padding = '0';
                    const focusBtn = document.createElement('button');
                    focusBtn.className = 'preset-chip';
                    focusBtn.innerHTML = t('motion.focusModel');
                    focusBtn.addEventListener('click', () => focusModel(id));
                    group.appendChild(focusBtn);
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'preset-chip';
                    clearBtn.textContent = t('motion.clearVmd');
                    clearBtn.addEventListener('click', async () => {
                        if (inst && inst.mmdModel && mmdRuntime) {
                            inst.mmdModel.setRuntimeAnimation(null);
                            inst.vmdData = null;
                            inst.vmdName = '';
                            inst.vmdPath = null;
                            inst.animationDuration = 0;
                            await clearVmdLayers(id);
                            if (isPlaying) {
                                mmdRuntime.pauseAnimation();
                                setIsPlaying(false);
                            }
                            updatePlaybackUI();
                            getMotionMenu()?.reRender();
                            setStatus(t('motion.motionCleared'), true);
                        }
                    });
                    group.appendChild(clearBtn);
                    inner.appendChild(group);
                });
            },
        },
    ];
}

function buildActionBindingLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('motion.bindingTitle'), dir: '', items: [] };
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
                                        getVmdLayers(id).find((l) => l.id === layerId)?.enabled ?? false,
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
                                    removeVmdLayer(layerId, id);
                                    getMotionMenu()?.pop();
                                    getMotionMenu()?.reRender();
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

/** motion-popup 的 onFolderEnter 路由（从 makeMotionMenu 提取） */
// [doc:adr-065] 子层路由表：target → 纯 items 构建器；自动挂 itemBuilder 实现语言热刷新
const MOTION_FOLDER_ROUTES: Record<string, () => PopupLevel> = {
    'motion:camera': buildCameraLevel,

    'motion:playbackSpeed': buildPlaybackSpeedLevel,
    'motion:procmotion': buildProcMotionLevel,
    'motion:gaze': buildGazeTrackingLevel,
    'motion:boneOverride': buildBoneOverrideLevel,
    'motion:feet': buildFeetLevel,
    'motion:poseStudio': buildPoseStudioLevel,
    'motion:virtualSkirt': buildVirtualSkirtLevel,
    'motion:advanced': buildAdvancedLevel,
    'motion:retarget': buildRetargetLevel,
    'procmotion:mode': buildProcMotionModeLevel,
    'lipsync:menu': buildLipSyncLevel,
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
                // 无动作 → 新增为第一个基础动作
                loadManager
                    .load({ kind: 'vmd', path: row.model.file_path, modelId: targetId })
                    .then(after)
                    .catch((err) => fail('motion-popup add base VMD:', err));
                return;
            }
            // 有动作：优先替换焦点层（若仍存在），否则替换基础（保留其余图层）
            if (
                focusedLayerId &&
                getVmdLayers(targetId).some((l) => l.id === focusedLayerId)
            ) {
                replaceVmdLayerVmd(focusedLayerId, row.model.file_path, targetId)
                    .then(after)
                    .catch((err) => fail('motion-popup replace layer VMD:', err));
                return;
            }
            loadManager
                .load({ kind: 'vmd', path: row.model.file_path, modelId: targetId })
                .then(after)
                .catch((err) => fail('motion-popup replace base VMD:', err));
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
                        mmdRuntime.playAnimation().then(() => setIsPlaying(true));
                    }
                    updatePlaybackUI();
                    getMotionMenu()?.reRender();
                }
                break;
            case 'reset':
                if (inst.mmdModel && mmdRuntime) {
                    inst.mmdModel.setRuntimeAnimation(null);
                    inst.vmdData = null;
                    inst.vmdName = '';
                    inst.vmdPath = null;
                    inst.animationDuration = 0;
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

/** 高级菜单 items：收纳程序化动作 / 视线追踪 / 骨骼覆盖 / 脚部调整 / 虚拟裙骨。 */
function buildAdvancedItems(): PopupRow[] {
    const items: PopupRow[] = [];
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
    // Card 2: 相机 + 音乐库 + 程序化动作
    items.push({
        kind: 'folder',
        label: t('motion.playbackSpeed'),
        icon: 'lucide:gauge',
        target: 'motion:playbackSpeed',
        sublabel: `${_playbackSpeed.toFixed(2)}x`,
    });
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
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
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
            label: '外部动作导入',
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
        setStatus('请先选择一个模型', false);
        return;
    }

    // 3. 获取模型骨骼
    const mesh = foc.mmdModel.mesh;
    if (!mesh || !mesh.skeleton) {
        setStatus('模型无骨骼数据', false);
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
    setStatus('外部动作已加载（' + preset + '）', true);
}
