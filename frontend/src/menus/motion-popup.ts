// [doc:architecture] Motion Popup — 动作弹窗（核心 + barrel export）
// 拆分后保留: 动作绑定/音乐/动作菜单/入口 + barrel re-export
// 子文件: motion-cloth-levels.ts

import {
    setStatus,
    libraryRoot,
    overridePaths,
    PopupLevel,
    PopupRow,
    escapeHtml,
    isPlaying,
    setIsPlaying,
    mmdRuntime,
    autoLoop,
    setAutoLoop,
    focusedModelId,
    motionBindingTargetId,
    setMotionBindingTargetId,
    layerBindingTargetId,
    setLayerBindingTargetId,
    stackRegistry,
    closeAllOverlays,
    cardContainer,
    envState,
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
    addGazeLayer,
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
import { buildCameraLevel } from './motion-camera-levels';
import { setEnvState } from '../scene/scene';

// ======== 从子文件导入 ========
import { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Barrel Re-Exports ========
export { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Build action model row and binding ========

function buildActionBindingLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: '动作绑定', dir: '', items: [] };
    }
    return {
        label: inst.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:music',
                    '更换动作',
                    true,
                    () => {
                        setMotionBindingTargetId(id);
                        const level = stackRegistry.buildLevel!(
                            libraryRoot,
                            '动作库',
                            (m) => m.format === 'vmd'
                        );
                        level.label = `绑定动作 → ${inst.name}`;
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(level);
                        }
                    },
                    inst.vmdName || '无'
                );
                const firstRow = c.querySelector('.slide-item');
                if (firstRow) {
                    const sublabelEl = firstRow.querySelector('.slide-sublabel');
                    if (sublabelEl) {
                        getCurrentRenderingMenu()?.registerControl(() => {
                            const currentInst = modelManager.get(id);
                            if (currentInst) {
                                sublabelEl.textContent = currentInst.vmdName || '无';
                            }
                        });
                    }
                }
                slideRow(c, 'lucide:user', '姿势库', true, () => {
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        '姿势库',
                        (m) => m.format === 'vpd'
                    );
                    level.label = `姿势 → ${inst.name}`;
                    if (getMotionMenu()) {
                        getMotionMenu()?.push(level);
                    }
                });
            });

            if (inst.kind === 'actor') {
                const physCategories = getPhysicsCategories(id);
                if (physCategories.length > 0) {
                    cardContainer(container, (c) => {
                        const CAT_LABELS: Record<string, string> = {
                            skirt: '裙子物理',
                            chest: '胸部物理',
                            hair: '头发物理',
                            accessory: '配件物理',
                        };
                        for (const cat of physCategories) {
                            const enabled = isPhysicsCategoryEnabled(id, cat);
                            addToggleRow(
                                c,
                                CAT_LABELS[cat] || cat,
                                enabled,
                                (v) => {
                                    setPhysicsCategory(id, cat, v);
                                    getMotionMenu()?.updateControls();
                                    setStatus(
                                        v
                                            ? `✓ ${CAT_LABELS[cat] || cat} 已开启`
                                            : `✕ ${CAT_LABELS[cat] || cat} 已关闭`,
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

            cardContainer(container, (c) => {
                const group = document.createElement('div');
                group.className = 'preset-group';
                group.style.padding = '0';
                const focusBtn = document.createElement('button');
                focusBtn.className = 'preset-chip';
                focusBtn.innerHTML = '🎯 聚焦到模型';
                focusBtn.addEventListener('click', () => focusModel(id));
                group.appendChild(focusBtn);
                const clearBtn = document.createElement('button');
                clearBtn.className = 'preset-chip';
                clearBtn.textContent = '🗑 清除 VMD';
                clearBtn.addEventListener('click', async () => {
                    if (inst && inst.mmdModel && mmdRuntime) {
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
                        getMotionMenu()?.updateControls();
                        setStatus('✓ 动作已清除', true);
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
        label: '音乐',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:folder-open',
                    '浏览音乐库',
                    true,
                    () => {
                        const level = stackRegistry.buildLevel!(
                            libraryRoot,
                            '音乐库',
                            (m) => m.format === 'audio'
                        );
                        if (getMotionMenu()) {
                            getMotionMenu()?.push(level);
                        }
                    },
                    getAudioName() || '无音乐'
                );
                if (getAudioName()) {
                    slideRow(c, 'lucide:trash-2', '移除音乐', false, () => {
                        clearAudio();
                        setStatus('✓ 音乐已移除', true);
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

    if (row.target && row.target.startsWith('motion:layers:')) {
        const id = row.target.replace('motion:layers:', '');
        return buildLayersLevel(id);
    }

    if (row.target === 'motion:recent') {
        return buildRecentMotionsLevel();
    }
    if (row.target === 'motion:procmotion') {
        return buildProcMotionLevel();
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
    if (row.target && row.target.startsWith('action:motion:browse:')) {
        const id = row.target.replace('action:motion:browse:', '');
        setMotionBindingTargetId(id);
        const level = stackRegistry.buildLevel!(libraryRoot, '动作库', (m) => m.format === 'vmd');
        const inst = modelManager.get(id);
        level.label = `绑定动作 → ${inst ? inst.name : '模型'}`;
        return level;
    }
    return null;
}

/** motion-popup 的 onItemClick（从 makeMotionMenu 提取） */
function motionOnItemClick(row: PopupRow): void {
    if (row.model) {
        if (row.model.format === 'vmd' && motionBindingTargetId) {
            hideMotionPopup();
            loadManager
                .load({ kind: 'vmd', path: row.model.file_path, modelId: motionBindingTargetId })
                .catch((err) => {
                    setStatus('✗ 动作加载失败', false);
                    console.warn('motion-popup load vmd:', err);
                });
            setMotionBindingTargetId(null);
            return;
        }
        hideMotionPopup();
        if (row.model.format === 'vmd') {
            if (motionBindingTargetId) {
                loadManager.load({ kind: 'vmd', path: row.model.file_path });
            } else {
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
            }
            return;
        }
        if (row.model.format === 'audio') {
            loadManager.load({ kind: 'audio', path: row.model.file_path });
            setStatus(`✓ 音乐: ${getAudioName()}`, true);
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
                    setStatus('✓ 动作已重置', true);
                }
                break;
            case 'pose':
                (async () => {
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        '姿势库',
                        (m) => m.format === 'vpd'
                    );
                    level.label = `姿势 → ${inst.name}`;
                    if (getMotionMenu()) {
                        getMotionMenu()?.push(level);
                    }
                })();
                break;
            case 'loop':
                setAutoLoop(!autoLoop);
                getMotionMenu()?.reRender();
                setStatus(`循环: ${autoLoop ? '开' : '关'}`, true);
                break;
        }
        return;
    }
    if (row.target === '__music_browse__') {
        const level = stackRegistry.buildLevel!(libraryRoot, '音乐库', (m) => m.format === 'audio');
        if (getMotionMenu()) {
            getMotionMenu()?.push(level);
        }
        return;
    }
    if (row.target === '__music_clear__') {
        clearAudio();
        setStatus('✓ 音乐已移除', true);
        if (getMotionMenu()) {
            getMotionMenu()?.reRender();
        }
        return;
    }
}

function buildRecentMotionsLevel(): PopupLevel {
    const recent = getRecentMotions();
    return {
        label: '最近使用',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (recent.length === 0) {
                    addEmptyRow(c, '暂无最近使用动作');
                    return;
                }
                for (const r of recent) {
                    slideRow(c, 'lucide:music', r.name, false, () => {
                        hideMotionPopup();
                        loadManager.load({ kind: 'vmd', path: r.path }).catch((err) => {
                            setStatus('✗ 动作加载失败', false);
                            console.warn('recent motion load:', err);
                        });
                    });
                }
            });
        },
    };
}

// ======== Motion Layers (图层) ========

function buildLayersLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    return {
        label: `图层 → ${inst?.name ?? '?'}`,
        dir: '',
        items: [],
        renderCustom: (container) => {
            const layers = getVmdLayers(id);

            // 添加图层按钮
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加图层', true, () => {
                    setLayerBindingTargetId(id);
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        '动作库',
                        (m) => m.format === 'vmd'
                    );
                    level.label = `添加图层 → ${inst?.name ?? '?'}`;
                    if (getMotionMenu()) {
                        getMotionMenu()?.push(level);
                    }
                });
            });

            // 添加视线追踪图层
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:eye', '添加视线追踪', false, async () => {
                    await addGazeLayer(id);
                    getMotionMenu()?.reRender();
                });
            });

            // 图层列表
            if (layers.length === 0) {
                cardContainer(container, (c) => {
                    addEmptyRow(c, '暂无图层 — 添加第二个 VMD 开启叠加');
                });
            } else {
                cardContainer(container, (c) => {
                    for (const layer of layers) {
                        const isGaze = layer.kind === 'gaze';
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        if (isGaze) {
                            row.style.borderLeft = '3px solid rgba(78, 205, 196, 0.4)';
                            row.style.paddingLeft = 'calc(14px - 3px)';
                            row.style.background = 'rgba(128, 128, 128, 0.06)';
                        }

                        const left = document.createElement('div');
                        left.className = 'slide-left';
                        left.style.flex = '1';
                        left.style.minWidth = '0';

                        const label = document.createElement('div');
                        label.className = 'slide-label';
                        label.textContent = isGaze ? '◎ ' + layer.name : layer.name;
                        label.style.overflow = 'hidden';
                        label.style.textOverflow = 'ellipsis';
                        label.style.whiteSpace = 'nowrap';
                        left.appendChild(label);

                        // 权重滑条
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
                        slider.disabled = !layer.enabled;
                        slider.addEventListener('input', () => {
                            setVmdLayerWeight(layer.id, parseFloat(slider.value), id);
                        });

                        const weightLabel = document.createElement('span');
                        weightLabel.textContent = `${Math.round(layer.weight * 100)}%`;
                        weightLabel.style.fontSize = 'var(--font-ui-sm)';
                        weightLabel.style.opacity = '0.6';
                        weightLabel.style.minWidth = '32px';
                        weightLabel.style.textAlign = 'right';
                        // 实时更新权重显示
                        getCurrentRenderingMenu()?.registerControl(() => {
                            const cur = getVmdLayers(id).find((l) => l.id === layer.id);
                            if (cur) {
                                weightLabel.textContent = `${Math.round(cur.weight * 100)}%`;
                                slider.value = String(cur.weight);
                            }
                        });

                        sliderRow.appendChild(slider);
                        sliderRow.appendChild(weightLabel);
                        left.appendChild(sliderRow);

                        row.appendChild(left);

                        // 启用/禁用 toggle
                        const toggle = document.createElement('button');
                        toggle.className = 'slide-action';
                        toggle.textContent = layer.enabled ? '👁' : '🚫';
                        toggle.title = layer.enabled ? '点击禁用' : '点击启用';
                        toggle.style.opacity = layer.enabled ? '1' : '0.4';
                        toggle.addEventListener('click', () => {
                            toggleVmdLayer(layer.id, id);
                            getMotionMenu()?.reRender();
                        });
                        row.appendChild(toggle);

                        // 删除按钮
                        const delBtn = document.createElement('button');
                        delBtn.className = 'slide-action';
                        delBtn.textContent = '✕';
                        delBtn.title = '删除图层';
                        delBtn.style.opacity = '0.5';
                        delBtn.addEventListener('click', () => {
                            removeVmdLayer(layer.id, id);
                            getMotionMenu()?.reRender();
                        });
                        row.appendChild(delBtn);

                        c.appendChild(row);
                    }
                });
            }

            // 全部清除按钮
            if (layers.length > 0) {
                cardContainer(container, (c) => {
                    const group = document.createElement('div');
                    group.className = 'preset-group';
                    group.style.padding = '0';
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'preset-chip';
                    clearBtn.textContent = '🗑 清除所有图层';
                    clearBtn.addEventListener('click', () => {
                        clearVmdLayers(id);
                        getMotionMenu()?.reRender();
                    });
                    group.appendChild(clearBtn);
                    c.appendChild(group);
                });
            }
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
                catTag: '角色',
            });
        }
        // 图层入口（仅角色模型）
        for (const [id, inst] of modelManager.modelRegistry) {
            if (
                inst.kind === 'actor' &&
                !(propDir && inst.filePath.toLowerCase().startsWith(propDir))
            ) {
                const layerCount = inst.vmdLayers.length;
                items.push({
                    kind: 'folder',
                    label: `${inst.name} 图层`,
                    icon: 'lucide:layers',
                    target: `motion:layers:${id}`,
                    sublabel: layerCount > 0 ? `${layerCount} 层` : undefined,
                });
            }
        }
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 2: 最近使用
    if (getRecentMotions().length > 0) {
        items.push({
            kind: 'folder',
            label: '最近使用',
            icon: 'lucide:clock',
            target: 'motion:recent',
        });
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 3: 相机 + 音乐库 + 程序化动作
    items.push({ kind: 'folder', label: '相机', icon: 'lucide:video', target: 'motion:camera' });
    items.push({
        kind: 'action',
        label: getAudioName() ? '音乐库' : '浏览音乐库',
        icon: 'lucide:music',
        target: '__music_browse__',
        sublabel: getAudioName() || undefined,
    });
    if (getAudioName()) {
        items.push({
            kind: 'action',
            label: '移除音乐',
            icon: 'lucide:trash-2',
            target: '__music_clear__',
        });
    }
    items.push({
        kind: 'folder',
        label: '程序化动作',
        icon: 'lucide:wind',
        target: 'motion:procmotion',
    });
    return items;
}

function buildMotionRootLevel(): PopupLevel {
    return {
        label: '动作',
        dir: '',
        items: buildMotionRootItems(),
    };
}

export function hideMotionPopup(): void {
    closeAllOverlays();
}
