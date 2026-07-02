// [doc:architecture] Motion Popup — 动作弹窗 + 舞蹈套装
// 从 library.ts 提取

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
    librarySortMode,
    setLibrarySortMode,
    addRecentMotion,
    getRecentMotions,
} from '../core/config';
import {
    loadVMDFromPath,
    loadVPDPose,
    updatePlaybackUI,
    focusModel,
    setGravityStrength,
    getGravityStrength,
    setEnvState,
    getPhysicsCategories,
    isPhysicsCategoryEnabled,
    setPhysicsCategory,
} from '../scene/scene';
import { SlideMenu } from './menu';
import { slideRow, addSliderRow, addToggleRow, addCollapsible } from '../core/ui-helpers';
import { createIconifyIcon } from '../core/icons';
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
    GetDanceSets,
    DeleteDanceSet,
    ImportDanceSet,
} from '../../wailsjs/go/main/App';
import { toggleCloth, recreateCloth } from '../physics/cloth-manager';
import { buildCameraLevel, buildProcMotionLevel, buildProcMotionModeLevel, buildLipSyncLevel } from './scene-menu';
import {
    setProcMotionMode,
    setProcMotionIntensity,
    setProcMotionSpeed,
    setProcMotionAutoSwitch,
    getProcMotionState,
    regenerateProcMotion,
    getLipSyncState,
    setLipSyncEnabled,
    setLipSyncSensitivity,
    setLipSyncIntensity,
} from '../scene/scene';
import type { ProcMotionMode } from '../motion/procedural-motion';

// ======== Dance Set Types & State ========

export type DanceSet = {
    name: string;
    vmd_path: string;
    audio_path: string;
    audio_offset: number;
    description: string;
    thumbnail: string;
    source: string;
};

let danceSets: DanceSet[] = [];
export const currentDanceSetId: string | null = null;

function computeDanceSetId(ds: DanceSet): string {
    return sha256Hex(ds.vmd_path + ':' + ds.audio_path).substring(0, 16);
}

function sha256Hex(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        const char = s.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return (
        Math.abs(hash).toString(16).padStart(16, '0') +
        Math.abs(hash * 7)
            .toString(16)
            .padStart(16, '0')
    );
}

export async function loadDanceSets(): Promise<void> {
    try {
        const sets = await GetDanceSets();
        danceSets = sets || [];
    } catch (err) {
        console.warn('loadDanceSets:', err);
        danceSets = [];
    }
}

async function loadDanceSetAudio(ds: DanceSet): Promise<void> {
    if (!ds.audio_path) {
        return;
    }
    try {
        await loadAudioFile(ds.audio_path);
        setAudioOffset(ds.audio_offset || 0);
    } catch (err) {
        console.warn('loadDanceSetAudio failed:', err);
        setStatus('✗ 音频加载失败', false);
    }
}

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
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        '动作库',
                        (m) => m.format === 'vmd'
                    );
                    level.label = `绑定动作 → ${inst.name}`;
                    if (motionMenu) {
                        motionMenu.push(level);
                    }
                });
                c.appendChild(row);
                slideRow(c, 'lucide:user', '加载姿势 (VPD)', false, async () => {
                    try {
                        const path = await SelectVPDPose();
                        if (!path) {
                            setStatus('✗ 未选择文件', false);
                            return;
                        }
                        await loadVPDPose(path, id);
                        motionMenu.reRender();
                    } catch (err: unknown) {
                        setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false);
                    }
                });
            });

            // Per-model physics categories
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
                                    if (motionMenu) {
                                        motionMenu.reRender();
                                    }
                                    setStatus(
                                        v
                                            ? `✓ ${CAT_LABELS[cat] || cat} 已开启`
                                            : `✕ ${CAT_LABELS[cat] || cat} 已关闭`,
                                        true
                                    );
                                },
                                'lucide:settings'
                            );
                        }
                    });
                }
            }

            // 聚焦按钮 + 清除 VMD（高频操作）
            cardContainer(container, (c) => {
                const group = document.createElement('div');
                group.className = 'preset-group';
                group.style.padding = '0';

                const focusBtn = document.createElement('button');
                focusBtn.className = 'preset-chip';
                focusBtn.innerHTML = '🎯 聚焦到模型';
                focusBtn.addEventListener('click', () => {
                    focusModel(id);
                });
                group.appendChild(focusBtn);

                const inst = modelRegistry.get(id);
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
                        if (motionMenu) {
                            motionMenu.reRender();
                        }
                        setStatus('✓ 动作已清除', true);
                    }
                });
                group.appendChild(clearBtn);

                c.appendChild(group);
            });
        },
    };
}

// ======== Music Level ========

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
                        if (!path) {
                            return;
                        }
                        await loadAudioFile(path);
                        setStatus(`✓ 音乐: ${getAudioName()}`, true);
                        motionMenu.reRender();
                    } catch (err) {
                        console.warn('Load audio failed:', err);
                        setStatus('✗ 音乐加载失败', false);
                    }
                }, getAudioName() || undefined);
                // 有音乐加载时显示"移除音乐"按钮
                if (getAudioName()) {
                    slideRow(c, 'lucide:trash-2', '移除音乐', false, () => {
                        clearAudio();
                        setStatus('✓ 音乐已移除', true);
                        motionMenu.reRender();
                    });
                }
            });

            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    '音量',
                    getVolume(),
                    0,
                    1,
                    0.05,
                    (v) => {
                        setVolume(v);
                    },
                    'lucide:volume-2'
                );
                addSliderRow(
                    c,
                    '音频偏移',
                    offset,
                    -5,
                    5,
                    0.1,
                    (v) => {
                        setAudioOffset(v);
                    },
                    'lucide:clock'
                );
                const hint = document.createElement('div');
                hint.style.cssText =
                    'font-size:10px;color:var(--text-dark);text-align:center;margin-top:4px;';
                hint.textContent = '正=音频先播，负=音频后播';
                c.appendChild(hint);
            });
        },
    };
}


// ======== Cloth Params Level ========

function buildClothParamsLevel(): PopupLevel {
    return {
        label: '布料参数',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const cfg = envState.clothConfig;
                // 防抖重建：滑块拖动期间不重建，松手后 100ms 触发一次
                let _recreateTimer: ReturnType<typeof setTimeout> | null = null;
                const debouncedRecreate = () => {
                    if (_recreateTimer) clearTimeout(_recreateTimer);
                    _recreateTimer = setTimeout(() => {
                        _recreateTimer = null;
                        recreateCloth();
                    }, 100);
                };

                // 形状
                addCollapsible(c, {
                    title: '形状',
                    icon: 'lucide:shirt',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            '裙长',
                            cfg.length,
                            0.2,
                            1.5,
                            0.05,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, length: v } });
                                debouncedRecreate();
                            },
                            'lucide:ruler'
                        );
                        addSliderRow(
                            cc,
                            '裙摆角度',
                            cfg.slope,
                            0,
                            45,
                            1,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, slope: v } });
                                debouncedRecreate();
                            },
                            'lucide:triangle'
                        );
                        addSliderRow(
                            cc,
                            '腰部半径',
                            cfg.innerRadius,
                            0.05,
                            0.4,
                            0.01,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, innerRadius: v } });
                                debouncedRecreate();
                            },
                            'lucide:circle'
                        );
                    },
                });

                // 物理
                addCollapsible(c, {
                    title: '物理',
                    icon: 'lucide:wind',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            '布料柔度',
                            cfg.compliance,
                            0,
                            0.01,
                            0.005,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, compliance: v } });
                                debouncedRecreate();
                            },
                            'lucide:wind'
                        );
                        addSliderRow(
                            cc,
                            '弯曲柔度',
                            cfg.bendCompliance,
                            0,
                            0.05,
                            0.01,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, bendCompliance: v } });
                                debouncedRecreate();
                            },
                            'lucide:curl'
                        );
                        addSliderRow(
                            cc,
                            '阻尼',
                            cfg.damping,
                            0.8,
                            0.999,
                            0.01,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, damping: v } });
                                debouncedRecreate();
                            },
                            'lucide:droplet'
                        );
                        addSliderRow(
                            cc,
                            '重力倍率',
                            cfg.gravityScale,
                            0.1,
                            3,
                            0.1,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, gravityScale: v } });
                                debouncedRecreate();
                            },
                            'lucide:arrow-down'
                        );
                    },
                });

                // 细分
                addCollapsible(c, {
                    title: '细分',
                    icon: 'lucide:grid',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            '水平分段',
                            cfg.segmentsH,
                            12,
                            36,
                            2,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, segmentsH: v } });
                                debouncedRecreate();
                            },
                            'lucide:grid'
                        );
                        addSliderRow(
                            cc,
                            '垂直分段',
                            cfg.segmentsV,
                            6,
                            24,
                            2,
                            (v) => {
                                setEnvState({ clothConfig: { ...cfg, segmentsV: v } });
                                debouncedRecreate();
                            },
                            'lucide:grid'
                        );
                    },
                });
            });
        },
    };
}

// ======== Motion Stack ========

let motionMenu: SlideMenu | null = null;

function makeMotionMenu(): SlideMenu {
    return new SlideMenu({
        container: dom.sceneOverlay,
        onClose: closeAllOverlays,
        onFolderEnter: (row) => {
            if (row.target === '__music__') {
                setMotionBindingTargetId(null);
                return buildActionMusicLevel();
            }
            if (row.target === 'procmotion:mode') {
                return buildProcMotionModeLevel();
            }
            if (row.target === 'lipsync:menu') {
                return buildLipSyncLevel();
            }
            if (row.target && row.target.startsWith('action:binding:')) {
                setMotionBindingTargetId(null);
                const id = row.target.replace('action:binding:', '');
                return buildActionBindingLevel(id);
            }
            if (row.target && row.target.startsWith('action:motion:browse:')) {
                const id = row.target.replace('action:motion:browse:', '');
                setMotionBindingTargetId(id);
                const level = stackRegistry.buildLevel!(
                    libraryRoot,
                    '动作库',
                    (m) => m.format === 'vmd'
                );
                const inst = modelRegistry.get(id);
                level.label = `绑定动作 → ${inst.name || '模型'}`;
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
                if (row.model.format === 'vmd') {
                    loadVMDFromPath(row.model.file_path);
                }
                return;
            }
            if (row.target && row.target.startsWith('procmotion:set-mode:')) {
                const mode = row.target.replace('procmotion:set-mode:', '') as ProcMotionMode;
                setProcMotionMode(mode);
                regenerateProcMotion();
                return;
            }
            if (row.target === 'procmotion:autoswitch') {
                setProcMotionAutoSwitch(!getProcMotionState().autoSwitch);
                motionMenu.reRender();
                return;
            }
            if (row.target === 'lipsync:toggle') {
                const lipSt = getLipSyncState();
                setLipSyncEnabled(!lipSt.enabled);
                motionMenu.reRender();
                return;
            }
            if (row.target && row.target.startsWith('action:motion:')) {
                const parts = row.target.split(':');
                const action = parts[2];
                const id = parts.slice(3).join(':');
                if (!id) {
                    return;
                }
                const inst = modelRegistry.get(id);
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
                            motionMenu.reRender();
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
                            if (motionMenu) {
                                motionMenu.reRender();
                            }
                            setStatus('✓ 动作已重置', true);
                        }
                        break;
                    case 'pose':
                        (async () => {
                            try {
                                const path = await SelectVPDPose();
                                if (!path) {
                                    setStatus('✗ 未选择文件', false);
                                    return;
                                }
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

// ======== Popup Show / Hide ========

/** 最近使用动作列表层级 */
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

export function showMotionPopup(): void {
    // 不再自管理生命周期，由 toggleOverlay 统一管理
    // 清空旧内容，避免与其他弹窗 DOM 混在一起
    dom.sceneOverlay.innerHTML = '';
    dom.sceneOverlay.classList.remove('sceneOverlay-model', 'sceneOverlay-settings');
    dom.sceneOverlay.classList.add('sceneOverlay-motion'); // 宽度 320px
    dom.sceneOverlay.dataset.popupType = 'motion';

    motionMenu?.dispose();
    motionMenu = makeMotionMenu();

    motionMenu.reset({
        label: '动作',
        dir: '',
        items: [],
        renderCustom: (container) => {
            if (modelRegistry.size > 0) {
                cardContainer(container, (c) => {
                    for (const [id, inst] of modelRegistry) {
                        slideRow(c, 'tabler:cube-3d-sphere', inst.name, true, () => {
                            motionMenu.push(buildActionBindingLevel(id));
                        });
                    }
                });
            }

            // 最近使用动作
            const recent = getRecentMotions();
            if (recent.length > 0) {
                cardContainer(container, (c) => {
                    slideRow(c, 'lucide:clock', '最近使用', true, () => {
                        motionMenu.push(buildRecentMotionsLevel());
                    });
                });
            }

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:music', '音乐', true, () => {
                    if (motionMenu) {
                        motionMenu.push(buildActionMusicLevel());
                    }
                });
                slideRow(c, 'lucide:camera', '相机模式', true, () => {
                    motionMenu.push(buildCameraLevel());
                });
                slideRow(c, 'lucide:wind', '程序化动作', true, () => {
                    motionMenu.push(buildProcMotionLevel());
                });
            });

            // 排序切换
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:arrow-up-down',
                    librarySortMode === 'name' ? '排序：名称' : '排序：默认',
                    true,
                    () => {
                        setLibrarySortMode(librarySortMode === 'name' ? 'default' : 'name');
                        motionMenu.reRender();
                    }
                );
            });

            // Physics card
            cardContainer(container, (c) => {
                const gravity = getGravityStrength();
                addSliderRow(
                    c,
                    '物理重力',
                    gravity,
                    0,
                    2,
                    0.05,
                    (v) => {
                        setGravityStrength(v);
                    },
                    'lucide:arrow-down'
                );
                slideRow(c, 'lucide:shirt', '布料模拟', true, () => {
                    motionMenu.push(buildClothParamsLevel());
                }, undefined, undefined, {
                    value: envState.clothEnabled,
                    onChange: (v) => {
                        setEnvState({ clothEnabled: v });
                        if (v) {
                            toggleCloth(true);
                        } else {
                            toggleCloth(false);
                        }
                        motionMenu.reRender();
                    },
                });
            });
        },
    });
}

export function hideMotionPopup(): void {
    closeAllOverlays();
}

// ======== Dance Sets ========

function buildDanceSetsOverviewLevel(): PopupLevel {
    return {
        label: '舞蹈套装',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            const loading = document.createElement('div');
            loading.style.cssText =
                'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
            loading.textContent = '加载中…';
            container.appendChild(loading);
            try {
                await loadDanceSets();
                container.innerHTML = '';
                if (!danceSets || danceSets.length === 0) {
                    cardContainer(container, (c) => {
                        const empty = document.createElement('div');
                        empty.style.cssText =
                            'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                        empty.innerHTML =
                            '<div>暂无舞蹈套装</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">点击下方按钮创建新套装</div>';
                        c.appendChild(empty);
                    });
                } else {
                    cardContainer(container, (c) => {
                        for (const ds of danceSets) {
                            const setId = computeDanceSetId(ds);
                            const row = document.createElement('div');
                            row.className = 'slide-item';
                            const vmdName = ds.vmd_path.split('/').pop() || ds.vmd_path;
                            const is = document.createElement('span');
                            is.className = 'slide-icon';
                            const ie = createIconifyIcon('lucide:music');
                            if (ie) {
                                is.appendChild(ie);
                            }
                            row.appendChild(is);
                            const ls = document.createElement('span');
                            ls.className = 'slide-label';
                            ls.textContent = ds.name;
                            row.appendChild(ls);
                            const ar = document.createElement('span');
                            ar.className = 'slide-arrow';
                            ar.textContent = '>';
                            row.appendChild(ar);
                            row.dataset.hint = ds.description || vmdName;
                            row.addEventListener('click', () => {
                                const level = buildDanceSetDetailLevel(setId);
                                if (stackRegistry.modelStack) {
                                    stackRegistry.modelStack.push(level);
                                } else if (motionMenu) {
                                    motionMenu.push(level);
                                }
                            });
                            c.appendChild(row);
                        }
                    });
                }

                cardContainer(container, (c) => {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const is = document.createElement('span');
                    is.className = 'slide-icon';
                    const ie = createIconifyIcon('lucide:plus');
                    if (ie) {
                        is.appendChild(ie);
                    }
                    row.appendChild(is);
                    const ls = document.createElement('span');
                    ls.className = 'slide-label';
                    ls.textContent = '新建套装';
                    row.appendChild(ls);
                    row.addEventListener('click', () => createNewDanceSet());
                    c.appendChild(row);
                });
            } catch (err) {
                console.warn('buildDanceSetsOverviewLevel:', err);
                container.textContent = '加载失败';
            }
        },
    };
}

export function buildDanceSetDetailLevel(setId: string): PopupLevel {
    const ds = danceSets.find((d) => computeDanceSetId(d) === setId);
    if (!ds) {
        return { label: '未知套装', dir: '', items: [] };
    }

    const vmdName = ds.vmd_path.split('/').pop() || ds.vmd_path;
    const audioName = ds.audio_path ? ds.audio_path.split('/').pop() : '无';

    return {
        label: ds.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const fields: Array<{ label: string; value: string }> = [
                    { label: '套装名称', value: ds.name },
                    { label: 'VMD 文件', value: vmdName },
                    { label: '音频文件', value: audioName },
                    { label: '音频偏移', value: `${ds.audio_offset.toFixed(2)} 秒` },
                    { label: '描述', value: ds.description || '—' },
                ];
                for (const f of fields) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.style.cssText =
                        'display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;';
                    row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.value)}</span>`;
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                const loadBtn = document.createElement('div');
                loadBtn.className = 'slide-item';
                loadBtn.innerHTML =
                    '<span class="slide-icon"><iconify-icon icon="lucide:play"></iconify-icon></span><span class="slide-label">一键加载</span>';
                loadBtn.addEventListener('click', () => loadDanceSet(ds));
                c.appendChild(loadBtn);

                const deleteBtn = document.createElement('div');
                deleteBtn.className = 'slide-item';
                deleteBtn.innerHTML =
                    '<span class="slide-icon"><iconify-icon icon="lucide:trash-2"></iconify-icon></span><span class="slide-label" style="color:var(--danger,#ff6b6b);">删除套装</span>';
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`确定要删除舞蹈套装「${ds.name}」吗？`)) {
                        DeleteDanceSet(setId)
                            .then(() => {
                                setStatus('✓ 已删除舞蹈套装', true);
                                loadDanceSets().then(() => {
                                    stackRegistry.modelStack.pop(); // 回到概览层
                                    stackRegistry.modelStack.reRender();
                                });
                            })
                            .catch((err) => {
                                console.warn('DeleteDanceSet failed:', err);
                                setStatus('✗ 删除失败', false);
                            });
                    }
                });
                c.appendChild(deleteBtn);
            });
        },
    };
}

async function loadDanceSet(ds: DanceSet): Promise<void> {
    if (!focusedModelId) {
        setStatus('✗ 请先加载并聚焦一个模型', false);
        return;
    }
    hideMotionPopup();
    await Promise.all([loadVMDFromPath(ds.vmd_path, focusedModelId), loadDanceSetAudio(ds)]);
    setStatus(`✓ 已加载舞蹈套装: ${ds.name}`, true);
}

async function createNewDanceSet(): Promise<void> {
    try {
        const vmdPath = await SelectVMDMotion();
        if (!vmdPath) {
            return;
        }

        const audioPath = await SelectAudioFile().catch(() => '');

        const defaultName =
            vmdPath
                .split(/[\\/]/)
                .pop()
                .replace(/\.vmd$/i, '') || '';
        const name = prompt('请输入舞蹈套装名称：', defaultName);
        if (!name) {
            return;
        }

        const setId = await ImportDanceSet(vmdPath, audioPath, name);
        if (setId) {
            setStatus('✓ 已创建舞蹈套装', true);
            await loadDanceSets();
            if (stackRegistry.modelStack) {
                stackRegistry.modelStack.reRender();
            }
        }
    } catch (err) {
        console.warn('createNewDanceSet failed:', err);
        setStatus('✗ 创建失败', false);
    }
}
