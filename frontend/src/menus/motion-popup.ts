// [doc:architecture] Motion Popup — 动作弹窗（核心 + barrel export）
// 拆分后保留: 动作绑定/音乐/动作菜单/入口 + barrel re-export
// 子文件: motion-cloth-levels.ts

import {
    setStatus,
    libraryRoot,
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
    stackRegistry,
    closeAllOverlays,
    cardContainer,
    envState,
    getRecentMotions,
} from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { slideRow, addSliderRow, addToggleRow } from '../core/ui-helpers';
import { createIconifyIcon } from '../core/icons';
import {
    loadVMDFromPath,
    loadVPDPose,
    loadCameraVmdFromPath,
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
    loadAudioFile,
    clearAudio,
    setAudioOffset,
    getAudioName,
    getAudioOffset,
    setVolume,
    getVolume,
} from '../outfit/audio';
import {
    setProcMotionMode,
    setProcMotionAutoSwitch,
    getProcMotionState,
    regenerateProcMotion,
    getLipSyncState,
    setLipSyncEnabled,
} from '../scene/scene';
import type { ProcMotionMode } from '../motion/procedural-motion';
import {
    buildProcMotionLevel, buildProcMotionModeLevel, buildLipSyncLevel,
} from './motion-procmotion-levels';
import { buildCameraLevel } from './motion-camera-levels';
import { setEnvState } from '../scene/scene';

// ======== 从子文件导入 ========
import { buildClothParamsLevel } from './motion-cloth-levels';
import { buildPhysicsLevel } from './motion-physics-levels';

// ======== Barrel Re-Exports ========
export { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Build action model row and binding ========

function _buildActionModelRow(id: string): PopupRow {
    const inst = modelManager.get(id);
    if (!inst) {
        return { kind: 'action', label: '?', icon: 'help-circle', target: '' };
    }
    return {
        kind: 'folder',
        label: inst.name,
        icon: 'tabler:cube-3d-sphere',
        target: `action:binding:${id}`,
        sublabel: inst.vmdName || undefined,
        catTag: inst.kind === 'actor' ? '角色' : '舞台',
    };
}

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
                slideRow(c, 'lucide:music', '更换动作', true, () => {
                    setMotionBindingTargetId(id);
                    const level = stackRegistry.buildLevel!(libraryRoot, '动作库', (m) => m.format === 'vmd');
                    level.label = `绑定动作 → ${inst.name}`;
                    if (getMotionMenu()) getMotionMenu()?.push(level);
                }, inst.vmdName || '无');
                slideRow(c, 'lucide:user', '姿势库', true, () => {
                    const level = stackRegistry.buildLevel!(libraryRoot, '姿势库', (m) => m.format === 'vpd');
                    level.label = `姿势 → ${inst.name}`;
                    if (getMotionMenu()) getMotionMenu()?.push(level);
                });
            });

            if (inst.kind === 'actor') {
                const physCategories = getPhysicsCategories(id);
                if (physCategories.length > 0) {
                    cardContainer(container, (c) => {
                        const CAT_LABELS: Record<string, string> = {
                            skirt: '裙子物理', chest: '胸部物理', hair: '头发物理', accessory: '配件物理',
                        };
                        for (const cat of physCategories) {
                            const enabled = isPhysicsCategoryEnabled(id, cat);
                            addToggleRow(c, CAT_LABELS[cat] || cat, enabled, (v) => {
                                setPhysicsCategory(id, cat, v);
                                if (getMotionMenu()) getMotionMenu()?.reRender();
                                setStatus(v ? `✓ ${CAT_LABELS[cat] || cat} 已开启` : `✕ ${CAT_LABELS[cat] || cat} 已关闭`, true);
                            }, 'lucide:settings');
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
                        inst.vmdData = null; inst.vmdName = ''; inst.vmdPath = null; inst.animationDuration = 0;
                        if (isPlaying) { mmdRuntime.pauseAnimation(); setIsPlaying(false); }
                        updatePlaybackUI();
                        if (getMotionMenu()) getMotionMenu()?.reRender();
                        setStatus('✓ 动作已清除', true);
                    }
                });
                group.appendChild(clearBtn);
                c.appendChild(group);
            });
        },
        reRenderCustom: (container) => {
            const currentInst = modelManager.get(id);
            if (!currentInst) return;
            const firstCard = container.querySelector('.card-container');
            if (!firstCard) return;
            const firstRow = firstCard.querySelector('.slide-item');
            if (!firstRow) return;
            const sublabelEl = firstRow.querySelector('.slide-sublabel');
            if (sublabelEl) {
                sublabelEl.textContent = currentInst.vmdName || '无';
            }
        },
    };
}

function buildActionMusicLevel(): PopupLevel {
    const offset = getAudioOffset();
    return {
        label: '音乐',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const browseAudioRow = document.createElement('div');
                browseAudioRow.className = 'slide-item';
                browseAudioRow.innerHTML = `
                    <span class="slide-icon"><iconify-icon icon="lucide:folder-open"></iconify-icon></span>
                    <span class="slide-label">浏览音乐库</span>
                    <span class="slide-sublabel">${getAudioName() || '无音乐'}</span>
                    <span class="slide-arrow">></span>
                `;
                browseAudioRow.addEventListener('click', () => {
                    const level = stackRegistry.buildLevel!(libraryRoot, '音乐库', (m) => m.format === 'audio');
                    if (getMotionMenu()) getMotionMenu()?.push(level);
                });
                c.appendChild(browseAudioRow);
                if (getAudioName()) {
                    slideRow(c, 'lucide:trash-2', '移除音乐', false, () => {
                        clearAudio();
                        setStatus('✓ 音乐已移除', true);
                        getMotionMenu()?.reRender();
                    });
                }
            });
            cardContainer(container, (c) => {
                addSliderRow(c, '音量', getVolume(), 0, 1, 0.05, (v) => setVolume(v), 'lucide:volume-2');
                addSliderRow(c, '音频偏移', offset, -5, 5, 0.1, (v) => setAudioOffset(v), 'lucide:clock');
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-dark);text-align:center;margin-top:4px;';
                hint.textContent = '正=音频先播，负=音频后播';
                c.appendChild(hint);
            });
        },
    };
}

// ======== Motion Stack ========

const { getMenu: getMotionMenu, refreshRoot: refreshMotionRoot, show: showMotionPopup } = registerPopupMenu({
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
    if (row.target === 'motion:camera') { return buildCameraLevel(); }
    if (row.target === '__music__') { setMotionBindingTargetId(null); return buildActionMusicLevel(); }
    if (row.target === 'motion:recent') { return buildRecentMotionsLevel(); }
    if (row.target === 'motion:procmotion') { return buildProcMotionLevel(); }
    if (row.target === 'motion:cloth') { return buildClothParamsLevel(); }
    if (row.target === 'motion:physics') { return buildPhysicsLevel(); }
    if (row.target === 'procmotion:mode') { return buildProcMotionModeLevel(); }
    if (row.target === 'lipsync:menu') { return buildLipSyncLevel(); }
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
            loadVMDFromPath(row.model.file_path, motionBindingTargetId).catch((err) => {
                setStatus('✗ 动作加载失败', false);
                console.warn('motion-popup loadVMDFromPath:', err);
            });
            setMotionBindingTargetId(null);
            return;
        }
        hideMotionPopup();
        if (row.model.format === 'vmd') {
            if (motionBindingTargetId) {
                loadVMDFromPath(row.model.file_path);
            } else {
                loadCameraVmdFromPath(row.model.file_path).then(() => {
                    const menu = getMotionMenu();
                    if (menu) menu.reRender();
                }).catch((err) => {
                    console.error('Load camera VMD failed:', err);
                });
            }
            return;
        }
        if (row.model.format === 'audio') {
            loadAudioFile(row.model.file_path);
            setStatus(`✓ 音乐: ${getAudioName()}`, true);
            if (getMotionMenu()) getMotionMenu()?.reRender();
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
        if (!id) return;
        const inst = modelManager.get(id);
        if (!inst) return;
        switch (action) {
            case 'pause':
                if (mmdRuntime) {
                    if (isPlaying) { mmdRuntime.pauseAnimation(); setIsPlaying(false); setAutoLoop(false); }
                    else { setAutoLoop(true); mmdRuntime.playAnimation().then(() => setIsPlaying(true)); }
                    updatePlaybackUI(); getMotionMenu()?.reRender();
                }
                break;
            case 'reset':
                if (inst.mmdModel && mmdRuntime) {
                    inst.mmdModel.setRuntimeAnimation(null);
                    inst.vmdData = null; inst.vmdName = ''; inst.vmdPath = null; inst.animationDuration = 0;
                    if (isPlaying) { mmdRuntime.pauseAnimation(); setIsPlaying(false); }
                    updatePlaybackUI();
                    if (getMotionMenu()) getMotionMenu()?.reRender();
                    setStatus('✓ 动作已重置', true);
                }
                break;
            case 'pose':
                (async () => {
                    const level = stackRegistry.buildLevel!(libraryRoot, '姿势库', (m) => m.format === 'vpd');
                    level.label = `姿势 → ${inst.name}`;
                    if (getMotionMenu()) getMotionMenu()?.push(level);
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
                    const empty = document.createElement('div');
                    empty.className = 'slide-item';
                    empty.style.opacity = '0.5';
                    empty.textContent = '暂无最近使用动作';
                    c.appendChild(empty);
                    return;
                }
                for (const r of recent) {
                    slideRow(c, 'lucide:music', r.name, false, () => {
                        hideMotionPopup();
                        loadVMDFromPath(r.path).catch((err) => {
                            setStatus('✗ 动作加载失败', false);
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
        for (const [id, inst] of modelManager.modelRegistry) {
            items.push({
                kind: 'folder',
                label: inst.name,
                icon: 'tabler:cube-3d-sphere',
                target: `action:binding:${id}`,
                sublabel: inst.vmdName || undefined,
                catTag: inst.kind === 'actor' ? '角色' : '舞台',
            });
        }
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 2: 最近使用
    if (getRecentMotions().length > 0) {
        items.push({
            kind: 'folder', label: '最近使用', icon: 'lucide:clock', target: 'motion:recent',
        });
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    // Card 3: 相机 + 音乐 + 程序化动作
    items.push({ kind: 'folder', label: '相机', icon: 'lucide:video', target: 'motion:camera' });
    items.push({ kind: 'folder', label: '音乐', icon: 'lucide:music', target: '__music__' });
    items.push({ kind: 'folder', label: '程序化动作', icon: 'lucide:wind', target: 'motion:procmotion' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    // Card 4: 物理
    items.push({
        kind: 'folder',
        label: '物理',
        icon: 'lucide:atom',
        target: 'motion:physics',
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
