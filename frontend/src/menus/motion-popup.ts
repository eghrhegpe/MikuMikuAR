// [doc:architecture] Motion Popup — 动作弹窗（核心 + barrel export）
// 拆分后保留: 动作绑定/音乐/动作菜单/入口 + barrel re-export
// 子文件: motion-cloth-levels.ts

import {
    setStatus,
    libraryRoot,
    overridePaths,
    PopupLevel,
    PopupRow,
    isPlaying,
    setIsPlaying,
    mmdRuntime,
    autoLoop,
    setAutoLoop,
    motionBindingTargetId,
    setMotionBindingTargetId,
    layerBindingTargetId,
    setLayerBindingTargetId,
    stackRegistry,
    closeAllOverlays,
    cardContainer,
    getRecentMotions,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { slideRow, addToggleRow, addEmptyRow } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { createIconifyIcon } from '../core/icons';
import { loadManager } from '../core/load-manager';

import {
    loadVPDPose,
    updatePlaybackUI,
    focusModel,
    getPhysicsCategories,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
    setModelWireframe,
    setModelBoneLinesVis,
    setModelBoneJointsVis,
    modelManager,
} from '../scene/scene';
import {
    getVmdLayers,
    toggleVmdLayer,
    setVmdLayerWeight,
    removeVmdLayer,
    addVmdLayerFromPath,
    clearVmdLayers,
} from '../scene/motion/vmd-layers';
import { clearAudio, getAudioName } from '../outfit/audio';
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
import { setEnvState } from '../scene/scene';
import { t } from '../core/i18n/t'; // [doc:adr-059]

// ======== 从子文件导入 ========
import { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Barrel Re-Exports ========
export { buildClothParamsLevel } from './motion-cloth-levels';

// ======== 物理类别 → i18n key 映射（运行时 t()，支持热切换）========
const CAT_KEYS: Record<string, string> = {
    skirt: 'motion.catSkirt',
    chest: 'motion.catChest',
    hair: 'motion.catHair',
    accessory: 'motion.catAccessory',
};

// ======== Build action model row and binding =====

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
            // === Card: 更换动作（替换 Layer 0）===
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:music',
                    t('motion.changeMotion'),
                    true,
                    () => {
                        setMotionBindingTargetId(id);
                        const level = stackRegistry.buildLevel!(
                            libraryRoot,
                            t('motion.motionLibrary'),
                            (m) => m.format === 'vmd'
                        );
                        level.label = t('motion.bindMotionTo', { name: inst.name });
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(level);
                        }
                    },
                    inst.vmdName || t('motion.none')
                );
                const firstRow = c.querySelector('.slide-item');
                if (firstRow) {
                    const sublabelEl = firstRow.querySelector('.slide-sublabel');
                    if (sublabelEl) {
                        getCurrentRenderingMenu()?.registerControl(() => {
                            const currentInst = modelManager.get(id);
                            if (currentInst) {
                                sublabelEl.textContent = currentInst.vmdName || t('motion.none');
                            }
                        });
                    }
                }
                slideRow(c, 'lucide:user', t('motion.poseLibrary'), true, () => {
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        t('motion.poseLibrary'),
                        (m) => m.format === 'vpd'
                    );
                    level.label = t('motion.poseTo', { name: inst.name });
                    if (getMotionMenu()) {
                        getMotionMenu()?.push(level);
                    }
                });
            });

            // === Card: 物理分类 toggles（仅角色）===
            if (inst.kind === 'actor') {
                const physCategories = getPhysicsCategories(id);
                if (physCategories.length > 0) {
                    cardContainer(container, (c) => {
                        for (const cat of physCategories) {
                            const enabled = isPhysicsCategoryEnabled(id, cat);
                            addToggleRow(
                                c,
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
                }
            }

            // === Card: 添加额外动作 ===
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', t('motion.addLayer'), true, () => {
                    setLayerBindingTargetId(id);
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        t('motion.motionLibrary'),
                        (m) => m.format === 'vmd'
                    );
                    level.label = t('motion.addLayerTo', { name: inst?.name ?? '?' });
                    if (getMotionMenu()) {
                        getMotionMenu()?.push(level);
                    }
                });
            });

            // === Card: 图层列表 ===
            const layers = getVmdLayers(id);
            if (layers.length > 0) {
                cardContainer(container, (c) => {
                    for (let i = 0; i < layers.length; i++) {
                        const layer = layers[i];
                        const isBase = i === 0;
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        if (isBase) {
                            row.style.borderLeft = '3px solid rgba(128, 128, 128, 0.3)';
                            row.style.paddingLeft = 'calc(14px - 3px)';
                        }

                        const left = document.createElement('div');
                        left.className = 'slide-left';
                        left.style.flex = '1';
                        left.style.minWidth = '0';

                        const label = document.createElement('div');
                        label.className = 'slide-label';
                        label.textContent = isBase
                            ? '◆ ' + layer.name + ' (' + t('motion.baseAction') + ')'
                            : layer.name;
                        label.style.overflow = 'hidden';
                        label.style.textOverflow = 'ellipsis';
                        label.style.whiteSpace = 'nowrap';
                        left.appendChild(label);

                        // 权重滑条（Base 层固定 100%）
                        const sliderRow = document.createElement('div');
                        sliderRow.style.display = 'flex';
                        sliderRow.style.alignItems = 'center';
                        sliderRow.style.gap = '6px';
                        sliderRow.style.marginTop = '4px';

                        const slider = document.createElement('input');
                        slider.type = 'range';
                        slider.min = '0';
                        slider.max = '1';
                        slider.step = '0.05';
                        slider.value = String(layer.weight);
                        slider.style.flex = '1';
                        slider.style.height = '3px';
                        if (isBase) {
                            slider.disabled = true;
                            slider.value = '1';
                        } else {
                            slider.disabled = !layer.enabled;
                            slider.addEventListener('input', () => {
                                setVmdLayerWeight(layer.id, parseFloat(slider.value), id);
                            });
                        }

                        const weightLabel = document.createElement('span');
                        weightLabel.textContent = isBase ? '100%' : `${Math.round(layer.weight * 100)}%`;
                        weightLabel.style.fontSize = 'var(--font-ui-sm)';
                        weightLabel.style.opacity = '0.6';
                        weightLabel.style.minWidth = '32px';
                        weightLabel.style.textAlign = 'right';
                        if (!isBase) {
                            getCurrentRenderingMenu()?.registerControl(() => {
                                const cur = getVmdLayers(id).find((l) => l.id === layer.id);
                                if (cur) {
                                    weightLabel.textContent = `${Math.round(cur.weight * 100)}%`;
                                    slider.value = String(cur.weight);
                                }
                            });
                        }

                        sliderRow.appendChild(slider);
                        sliderRow.appendChild(weightLabel);
                        left.appendChild(sliderRow);

                        row.appendChild(left);

                        // 启用/禁用 toggle（Base 层不显示）
                        if (!isBase) {
                            const toggle = document.createElement('button');
                            toggle.className = 'slide-action';
                            toggle.textContent = layer.enabled ? '👁' : '🚫';
                            toggle.title = layer.enabled ? t('motion.disable') : t('motion.enable');
                            toggle.style.opacity = layer.enabled ? '1' : '0.4';
                            toggle.addEventListener('click', () => {
                                toggleVmdLayer(layer.id, id);
                                getMotionMenu()?.reRender();
                            });
                            row.appendChild(toggle);
                        }

                        // 删除按钮（Base 层不显示）
                        if (!isBase) {
                            const delBtn = document.createElement('button');
                            delBtn.className = 'slide-action';
                            delBtn.textContent = '✕';
                            delBtn.title = t('motion.deleteLayer');
                            delBtn.style.opacity = '0.5';
                            delBtn.addEventListener('click', () => {
                                removeVmdLayer(layer.id, id);
                                getMotionMenu()?.reRender();
                            });
                            row.appendChild(delBtn);
                        }

                        c.appendChild(row);
                    }
                });
            }

            // === Card: 聚焦模型 + 清除 VMD ===
            cardContainer(container, (c) => {
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
                c.appendChild(group);
            });
        },
    };
}

function buildActionMusicLevel(): PopupLevel {
    return {
        label: t('motion.music'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:folder-open',
                    t('motion.browseMusic'),
                    true,
                    () => {
                        const level = stackRegistry.buildLevel!(
                            libraryRoot,
                            t('motion.musicLibrary'),
                            (m) => m.format === 'audio'
                        );
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(level);
                        }
                    },
                    getAudioName() || t('motion.noMusic')
                );
                if (getAudioName()) {
                    slideRow(c, 'lucide:trash-2', t('motion.removeMusic'), false, () => {
                        clearAudio();
                        setStatus(t('motion.musicRemoved'), true);
                        getMotionMenu()?.reRender();
                    });
                }
            });
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
function motionOnFolderEnter(row: PopupRow): PopupLevel | null {
    if (row.target === 'motion:camera') {
        return buildCameraLevel();
    }

    if (row.target === 'motion:recent') {
        return buildRecentMotionsLevel();
    }
    if (row.target === 'motion:procmotion') {
        return buildProcMotionLevel();
    }
    if (row.target === 'motion:gaze') {
        return buildGazeTrackingLevel();
    }
    if (row.target === 'procmotion:mode') {
        return buildProcMotionModeLevel();
    }
    if (row.target === 'lipsync:menu') {
        return buildLipSyncLevel();
    }
    if (row.target && row.target.startsWith('action:binding:')) {
        setMotionBindingTargetId(null);
        return buildActionBindingLevel(row.target.replace('action:binding:', ''));
    }
    return null;
}

/** motion-popup 的 onItemClick（从 makeMotionMenu 提取） */
function motionOnItemClick(row: PopupRow): void {
    if (row.model) {
        // 图层添加优先：从模型选择 VMD → 添加为图层而非替换基础动作
        if (row.model.format === 'vmd' && layerBindingTargetId) {
            const targetId = layerBindingTargetId;
            setLayerBindingTargetId(null);
            // 返回图层管理页（pop VMD 浏览器层）
            if (getMotionMenu()) {
                getMotionMenu()?.pop();
            }
            // 等待图层添加完成后再刷新 UI，避免竞态导致图层列表为空
            addVmdLayerFromPath(row.model.file_path, targetId)
                .then(() => {
                    getMotionMenu()?.reRender();
                })
                .catch((err) => {
                    setStatus(t('motion.motionLoadFailed'), false);
                    console.warn('motion-popup addVmdLayerFromPath:', err);
                    getMotionMenu()?.reRender();
                });
            return;
        }
        if (row.model.format === 'vmd' && motionBindingTargetId) {
            const targetId = motionBindingTargetId;
            setMotionBindingTargetId(null);
            // 返回动作详情页（pop VMD 浏览器层）
            if (getMotionMenu()) {
                getMotionMenu()?.pop();
            }
            // 先清除所有旧图层，再将新动作作为 Layer 0 添加
            clearVmdLayers(targetId)
                .then(() => addVmdLayerFromPath(row.model.file_path, targetId))
                .then(() => {
                    getMotionMenu()?.reRender();
                })
                .catch((err) => {
                    setStatus(t('motion.motionLoadFailed'), false);
                    console.warn('motion-popup replace base VMD:', err);
                    getMotionMenu()?.reRender();
                });
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
                        libraryRoot,
                        t('motion.poseLibrary'),
                        (m) => m.format === 'vpd'
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
        const level = stackRegistry.buildLevel!(libraryRoot, t('motion.musicLibrary'), (m) => m.format === 'audio');
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
}

function buildRecentMotionsLevel(): PopupLevel {
    const recent = getRecentMotions();
    return {
        label: t('motion.recent'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (recent.length === 0) {
                    addEmptyRow(c, t('motion.noRecent'));
                    return;
                }
                for (const r of recent) {
                    slideRow(c, 'lucide:music', r.name, false, () => {
                        hideMotionPopup();
                        loadManager.load({ kind: 'vmd', path: r.path }).catch((err) => {
                            setStatus(t('motion.motionLoadFailed'), false);
                            console.warn('recent motion load:', err);
                        });
                    });
                }
            });
        },
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
            // 路径在 prop 目录下的视为道具，不参与动作绑定
            if (propDir && inst.filePath.toLowerCase().startsWith(propDir)) {
                continue;
            }
            items.push({
                kind: 'folder',
                label: inst.name,
                icon: 'tabler:cube-3d-sphere',
                target: `action:binding:${id}`,
                sublabel: inst.vmdName || undefined,
                catTag: t('motion.actor'),
            });
        }
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 2: 最近使用
    if (getRecentMotions().length > 0) {
        items.push({
            kind: 'folder',
            label: t('motion.recent'),
            icon: 'lucide:clock',
            target: 'motion:recent',
        });
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 3: 相机 + 音乐库 + 程序化动作
    items.push({ kind: 'folder', label: t('motion.camera'), icon: 'lucide:video', target: 'motion:camera' });
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
