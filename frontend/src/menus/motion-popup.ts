// [doc:architecture] Motion Popup — 动作弹窗（核心 + barrel export）
// 拆分后保留: 动作绑定/音乐/动作菜单/入口 + barrel re-export
// 子文件: motion-dance-sets.ts, motion-cloth-levels.ts

import {
    dom,
    setStatus,
    libraryRoot,
    PopupLevel,
    PopupRow,
    escapeHtml,
    modelRegistry,
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
    getMenuWrapper,
} from '../core/config';
import { SlideMenu } from './menu';
import { slideRow, addSliderRow, addToggleRow } from '../core/ui-helpers';
import { createIconifyIcon } from '../core/icons';
import {
    loadVMDFromPath,
    loadVPDPose,
    updatePlaybackUI,
    focusModel,
    setGravityStrength,
    getGravityStrength,
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
    SelectAudioFile,
    SelectVMDMotion,
    SelectVPDPose,
} from '../core/wails-bindings';
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
import { toggleCloth } from '../physics/cloth-manager';
import { setEnvState } from '../scene/scene';

// ======== 从子文件导入 ========
import { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Barrel Re-Exports ========
export type { DanceSet } from './motion-dance-sets';
export { loadDanceSets, buildDanceSetDetailLevel } from './motion-dance-sets';
export { buildClothParamsLevel } from './motion-cloth-levels';

// ======== Build action model row and binding ========

function _buildActionModelRow(id: string): PopupRow {
    const inst = modelRegistry.get(id);
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
    const inst = modelRegistry.get(id);
    if (!inst) {
        return { label: '动作绑定', dir: '', items: [] };
    }
    return {
        label: `动作 — ${inst.name}`,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const row = document.createElement('div');
                row.className = 'slide-item';
                row.innerHTML = `
          <span class="slide-icon"><iconify-icon icon="lucide:music"></iconify-icon></span>
          <span class="slide-label">更换动作</span>
          <span class="slide-sublabel">${inst.vmdName || '无'}</span>
          <span class="slide-arrow">&gt;</span>
        `;
                row.addEventListener('click', () => {
                    setMotionBindingTargetId(id);
                    const level = stackRegistry.buildLevel!(libraryRoot, '动作库', (m) => m.format === 'vmd');
                    level.label = `绑定动作 → ${inst.name}`;
                    if (motionMenu) motionMenu.push(level);
                });
                c.appendChild(row);
                slideRow(c, 'lucide:user', '加载姿势 (VPD)', false, async () => {
                    try {
                        const path = await SelectVPDPose();
                        if (!path) { setStatus('✗ 未选择文件', false); return; }
                        await loadVPDPose(path, id);
                        motionMenu.reRender();
                    } catch (err: unknown) {
                        setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false);
                    }
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
                                if (motionMenu) motionMenu.reRender();
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
                        if (motionMenu) motionMenu.reRender();
                        setStatus('✓ 动作已清除', true);
                    }
                });
                group.appendChild(clearBtn);
                c.appendChild(group);
            });
        },
        // 物理 toggle 自管理，VMD 清除/加载需要更新子标签 → 暂时跳过，后续可加针对性 sublabel 更新
        reRenderCustom: () => {},
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
                slideRow(c, 'lucide:music', '加载音乐', true, async () => {
                    try {
                        const path = await SelectAudioFile();
                        if (!path) return;
                        await loadAudioFile(path);
                        setStatus(`✓ 音乐: ${getAudioName()}`, true);
                        motionMenu.reRender();
                    } catch (err) {
                        console.warn('Load audio failed:', err);
                        setStatus('✗ 音乐加载失败', false);
                    }
                }, getAudioName() || undefined);
                if (getAudioName()) {
                    slideRow(c, 'lucide:trash-2', '移除音乐', false, () => {
                        clearAudio();
                        setStatus('✓ 音乐已移除', true);
                        motionMenu.reRender();
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

let motionMenu: SlideMenu | null = null;
export function getMotionMenu(): SlideMenu | null {
    return motionMenu;
}

function makeMotionMenu(container: HTMLElement): SlideMenu {
    return new SlideMenu({
        container,
        onClose: closeAllOverlays,
        onFolderEnter: (row) => {
            if (row.target === 'motion:camera') { return buildCameraLevel(); }
            if (row.target === '__music__') { setMotionBindingTargetId(null); return buildActionMusicLevel(); }
            if (row.target === 'motion:recent') { return buildRecentMotionsLevel(); }
            if (row.target === 'motion:procmotion') { return buildProcMotionLevel(); }
            if (row.target === 'motion:cloth') { return buildClothParamsLevel(); }
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
                const inst = modelRegistry.get(id);
                level.label = `绑定动作 → ${inst ? inst.name : '模型'}`;
                return level;
            }
            return null;
        },
        onItemClick: (row: PopupRow) => {
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
                if (row.model.format === 'vmd') loadVMDFromPath(row.model.file_path);
                return;
            }
            if (row.target && row.target.startsWith('procmotion:set-mode:')) {
                setProcMotionMode(row.target.replace('procmotion:set-mode:', '') as ProcMotionMode);
                regenerateProcMotion();
                return;
            }
            if (row.target === 'procmotion:autoswitch') {
                setProcMotionAutoSwitch(!getProcMotionState().autoSwitch);
                motionMenu.reRender();
                return;
            }
            if (row.target === 'lipsync:toggle') {
                setLipSyncEnabled(!getLipSyncState().enabled);
                motionMenu.reRender();
                return;
            }
            if (row.target && row.target.startsWith('action:motion:')) {
                const parts = row.target.split(':');
                const action = parts[2];
                const id = parts.slice(3).join(':');
                if (!id) return;
                const inst = modelRegistry.get(id);
                if (!inst) return;
                switch (action) {
                    case 'pause':
                        if (mmdRuntime) {
                            if (isPlaying) { mmdRuntime.pauseAnimation(); setIsPlaying(false); setAutoLoop(false); }
                            else { setAutoLoop(true); mmdRuntime.playAnimation().then(() => setIsPlaying(true)); }
                            updatePlaybackUI(); motionMenu.reRender();
                        }
                        break;
                    case 'reset':
                        if (inst.mmdModel && mmdRuntime) {
                            inst.mmdModel.setRuntimeAnimation(null);
                            inst.vmdData = null; inst.vmdName = ''; inst.vmdPath = null; inst.animationDuration = 0;
                            if (isPlaying) { mmdRuntime.pauseAnimation(); setIsPlaying(false); }
                            updatePlaybackUI();
                            if (motionMenu) motionMenu.reRender();
                            setStatus('✓ 动作已重置', true);
                        }
                        break;
                    case 'pose':
                        (async () => {
                            try {
                                const path = await SelectVPDPose();
                                if (!path) { setStatus('✗ 未选择文件', false); return; }
                                await loadVPDPose(path, id);
                                motionMenu.reRender();
                            } catch (err: unknown) {
                                setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false);
                            }
                        })();
                        break;
                    case 'loop':
                        setAutoLoop(!autoLoop);
                        motionMenu.reRender();
                        setStatus(`循环: ${autoLoop ? '开' : '关'}`, true);
                        break;
                }
                return;
            }
        },
    });
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

/** 动作弹窗根级 items 构建器——动态反映 modelRegistry / recent / cloth 状态。 */
function buildMotionRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    // Card 1: 已加载模型
    if (modelRegistry.size > 0) {
        for (const [id, inst] of modelRegistry) {
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
    // Card 4: 物理重力 + 布料模拟
    items.push({
        kind: 'slider',
        label: '物理重力',
        icon: 'lucide:arrow-down',
        target: 'motion:gravity',
        sliderValue: getGravityStrength(),
        sliderMin: 0,
        sliderMax: 2,
        sliderStep: 0.05,
        onSliderChange: (v) => setGravityStrength(v),
    });
    items.push({
        kind: 'folder',
        label: '布料模拟',
        icon: 'lucide:shirt',
        target: 'motion:cloth',
        headerToggle: {
            value: envState.clothEnabled,
            onChange: (v) => {
                setEnvState({ clothEnabled: v });
                if (v) toggleCloth(true); else toggleCloth(false);
                refreshMotionRoot();
            },
        },
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

/** 重新计算根级 items 并触发 reRender（toggle/slider 状态变化后调用）。 */
export function refreshMotionRoot(): void {
    if (!motionMenu) return;
    const root = motionMenu.getLevel(0);
    if (root) {
        root.items = buildMotionRootItems();
        motionMenu.reRender();
    }
}

export function showMotionPopup(): void {
    dom.sceneOverlay.classList.remove('sceneOverlay-model', 'sceneOverlay-settings');
    dom.sceneOverlay.classList.add('sceneOverlay-motion');
    dom.sceneOverlay.dataset.popupType = 'motion';

    const wrapper = getMenuWrapper('motion-popup');
    if (motionMenu) {
        motionMenu.resetToRoot();
        motionMenu.reRender();
        return;
    }

    motionMenu = makeMotionMenu(wrapper);
    motionMenu.reset(buildMotionRootLevel());
}

export function hideMotionPopup(): void {
    closeAllOverlays();
}
