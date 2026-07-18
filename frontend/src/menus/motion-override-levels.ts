// [doc:adr-116] Motion Override Levels — 模块化动作覆盖 UI
// 职责: 模块列表（开关+▸）+ 模块参数子页 + 高级骨骼覆盖子页
// 路由: motion-popup.ts → motionOnFolderEnter → 'motion:boneOverride'

import {
    setStatus,
    PopupLevel,
    cardContainer,
    modelRegistry,
    focusedModelId,
} from '../core/config';
import { addEmptyRow, slideRow, addSectionTitle } from '../core/ui-helpers';
import { addSliderRow } from '../core/ui-rows';
import { createTrailingBtn } from '../core/ui-slide-row';
import { createIconifyIcon } from '../core/icons';
import { getMotionMenu } from './motion-popup';
import { triggerAutoSave, pushUndoSnapshot, offerSceneUndo } from '../scene/scene';
import type { BoneOverrideEntry } from '../core/types';
import {
    setBoneOverride,
    clearBoneOverride,
    clearAllOverrides,
    getAllOverrides,
    getOverride,
} from '../scene/motion/bone-override';
import {
    initMotionModules,
    getRegisteredModules,
    createModule,
    getModuleState,
} from '../scene/motion/motion-modules/registry';
import {
    undo,
    redo,
    canUndo,
    canRedo,
    getHistoryEntries,
    getHistoryCursor,
    jumpToHistory,
} from '../scene/motion/motion-modules/motion-history';
import { applyModuleSnapshot } from '../scene/motion/motion-modules/module-base';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 模块列表层（ADR-116 主入口） ========

let _modulesInitialized = false;
function ensureModulesInit(): void {
    if (!_modulesInitialized) {
        initMotionModules();
        _modulesInitialized = true;
    }
}

// [doc:adr-116 P3-3] 表单状态（per-model）：供列表项「编辑」按钮回填
// 提升到模块级 Map 避免 reRender 时丢失
interface OverrideFormState {
    boneName: string;
    pitch: number;
    yaw: number;
    roll: number;
    weight: number;
}
const _overrideFormStates = new Map<string, OverrideFormState>();

/** 构建动作覆盖主面板：模块列表 + 高级骨骼覆盖入口 */
export function buildMotionOverrideLevel(): PopupLevel {
    ensureModulesInit();
    return {
        label: t('motion.override.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMotionOverrideSchema(), container);
        },
    };
}

function buildMotionOverrideSchema(): MenuNode[] {
    const modelId = focusedModelId;
    if (!modelId) {
        return [
            {
                id: 'override:empty',
                kind: 'custom',
                renderCustom: (c) => {
                    addEmptyRow(c, t('motion.boneOverride.noModel'));
                },
            },
        ];
    }

    const modules = getRegisteredModules();
    return [
        // 卡片 1：模块列表
        {
            id: 'override:modules',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    // [doc:adr-125 P2] 标题栏 + 撤销/重做按钮
                    const titleBar = document.createElement('div');
                    titleBar.style.cssText =
                        'display:flex;align-items:center;justify-content:space-between;padding:8px 14px 4px;';
                    const titleText = document.createElement('span');
                    titleText.style.cssText = 'font-size:12px;color:var(--text);font-weight:600;';
                    titleText.textContent = t('motion.override.title');
                    titleBar.appendChild(titleText);

                    const btnGroup = document.createElement('div');
                    btnGroup.style.cssText = 'display:flex;gap:4px;';

                    const undoBtn = document.createElement('button');
                    undoBtn.className = 'slide-action';
                    const undoIcon = createIconifyIcon('lucide:undo-2');
                    if (undoIcon) {
                        undoBtn.appendChild(undoIcon);
                    }
                    undoBtn.title = 'Ctrl+Z';
                    undoBtn.addEventListener('click', () => {
                        if (!modelId || !canUndo(modelId)) {
                            return;
                        }
                        const applier = (
                            snap: Record<
                                string,
                                {
                                    enabled: boolean;
                                    params: Record<string, import('@/core/types').ParamValue>;
                                }
                            >
                        ) => {
                            applyModuleSnapshot(modelId, snap);
                        };
                        undo(modelId, applier);
                        setStatus(t('motion.undoApplied'), true);
                        getMotionMenu()?.reRender();
                    });
                    const updateUndoState = () => {
                        undoBtn.style.opacity = modelId && canUndo(modelId) ? '1' : '0.3';
                        undoBtn.style.pointerEvents = modelId && canUndo(modelId) ? 'auto' : 'none';
                    };
                    updateUndoState();

                    const redoBtn = document.createElement('button');
                    redoBtn.className = 'slide-action';
                    const redoIcon = createIconifyIcon('lucide:redo-2');
                    if (redoIcon) {
                        redoBtn.appendChild(redoIcon);
                    }
                    redoBtn.title = 'Ctrl+Shift+Z';
                    redoBtn.addEventListener('click', () => {
                        if (!modelId || !canRedo(modelId)) {
                            return;
                        }
                        const applier = (
                            snap: Record<
                                string,
                                {
                                    enabled: boolean;
                                    params: Record<string, import('@/core/types').ParamValue>;
                                }
                            >
                        ) => {
                            applyModuleSnapshot(modelId, snap);
                        };
                        redo(modelId, applier);
                        setStatus(t('motion.override.redoApplied'), true);
                        getMotionMenu()?.reRender();
                    });
                    const updateRedoState = () => {
                        redoBtn.style.opacity = modelId && canRedo(modelId) ? '1' : '0.3';
                        redoBtn.style.pointerEvents = modelId && canRedo(modelId) ? 'auto' : 'none';
                    };
                    updateRedoState();

                    btnGroup.appendChild(undoBtn);
                    btnGroup.appendChild(redoBtn);

                    // [doc:adr-125 P3] 历史列表下拉按钮
                    const historyBtn = document.createElement('button');
                    historyBtn.className = 'slide-action';
                    const historyIcon = createIconifyIcon('lucide:more-vertical');
                    if (historyIcon) {
                        historyBtn.appendChild(historyIcon);
                    }
                    historyBtn.title = t('motion.override.history');
                    historyBtn.style.fontSize = '14px';
                    let historyDropdown: HTMLElement | null = null;

                    function closeHistoryDropdown(): void {
                        if (historyDropdown) {
                            historyDropdown.remove();
                            historyDropdown = null;
                        }
                        document.removeEventListener('click', _onOutsideClick);
                    }

                    let _onOutsideClick: ((ev: MouseEvent) => void) | null = null;

                    historyBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (historyDropdown) {
                            closeHistoryDropdown();
                            return;
                        }
                        if (!modelId) {
                            return;
                        }
                        const entries = getHistoryEntries(modelId);
                        if (entries.length === 0) {
                            return;
                        }
                        const cursor = getHistoryCursor(modelId);

                        historyDropdown = document.createElement('div');
                        historyDropdown.style.cssText =
                            'position:absolute;right:8px;top:100%;z-index:100;' +
                            'background:var(--bg);border:1px solid var(--border);border-radius:6px;' +
                            'box-shadow:0 4px 12px rgba(0,0,0,0.3);max-height:240px;overflow-y:auto;' +
                            'min-width:200px;padding:4px 0;';

                        // 显示最近 10 条，最新在上
                        const visible = entries.slice(-10).reverse();
                        for (const entry of visible) {
                            const realIndex = entries.indexOf(entry);
                            const item = document.createElement('div');
                            item.style.cssText =
                                'padding:6px 12px;font-size:11px;cursor:pointer;' +
                                'color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                            if (realIndex === cursor) {
                                item.style.background = 'var(--hover)';
                                item.style.fontWeight = '600';
                            }
                            item.textContent = entry.description;
                            item.addEventListener('click', () => {
                                if (!modelId) {
                                    return;
                                }
                                const applier = (
                                    snap: Record<
                                        string,
                                        {
                                            enabled: boolean;
                                            params: Record<
                                                string,
                                                import('@/core/types').ParamValue
                                            >;
                                        }
                                    >
                                ) => {
                                    applyModuleSnapshot(modelId, snap);
                                };
                                jumpToHistory(modelId, realIndex, applier);
                                closeHistoryDropdown();
                                getMotionMenu()?.reRender();
                            });
                            item.addEventListener('mouseenter', () => {
                                item.style.background = 'var(--hover)';
                            });
                            item.addEventListener('mouseleave', () => {
                                if (realIndex !== cursor) {
                                    item.style.background = '';
                                }
                            });
                            historyDropdown.appendChild(item);
                        }

                        // 点击外部关闭（同步注册，避免 setTimeout 时序问题）
                        _onOutsideClick = (ev: MouseEvent) => {
                            if (historyDropdown && !historyDropdown.contains(ev.target as Node)) {
                                closeHistoryDropdown();
                            }
                        };
                        document.addEventListener('click', _onOutsideClick);

                        // 定位到按钮下方
                        historyBtn.style.position = 'relative';
                        historyBtn.appendChild(historyDropdown);
                    });

                    btnGroup.appendChild(historyBtn);
                    titleBar.appendChild(btnGroup);
                    inner.appendChild(titleBar);

                    for (const mod of modules) {
                        const state = getModuleState(modelId, mod.id);
                        slideRow(
                            inner,
                            mod.meta.icon ?? '',
                            t(mod.meta.labelKey),
                            true, // hasArrow → 子页
                            () => {
                                const menu = getMotionMenu();
                                if (menu) {
                                    menu.push(buildModuleParamLevel(mod.id));
                                }
                            },
                            undefined,
                            undefined,
                            undefined,
                            {
                                value: state.enabled,
                                onChange: (v: boolean) => {
                                    // enable()/disable() 内部已写 state.enabled，无需重复 setModuleEnabled（P4 清理）
                                    const inst = createModule(mod.id, modelId);
                                    if (v) {
                                        inst?.enable();
                                    } else {
                                        inst?.disable();
                                    }
                                    setStatus(
                                        v
                                            ? t('motion.override.enabled')
                                            : t('motion.override.disabled'),
                                        true
                                    );
                                    getMotionMenu()?.reRender();
                                },
                                bind: () => getModuleState(modelId, mod.id).enabled,
                            }
                        );
                    }
                });
            },
        },
        // 卡片 2：高级骨骼覆盖入口
        {
            id: 'override:advanced',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(inner, 'tabler:bone', t('motion.override.advancedBone'), true, () => {
                        const menu = getMotionMenu();
                        if (menu) {
                            menu.push(buildAdvancedBoneOverrideLevel());
                        }
                    });
                });
            },
        },
    ];
}

/** 模块参数子页：渲染模块的 buildSchema() */
export function buildModuleParamLevel(moduleId: string): PopupLevel {
    const modelId = focusedModelId;
    const mod = modelId ? createModule(moduleId, modelId) : null;
    return {
        label: mod ? t(mod.meta.labelKey) : moduleId,
        dir: '',
        items: [],
        renderCustom: (container) => {
            if (!mod) {
                addEmptyRow(container, t('motion.boneOverride.noModel'));
                return;
            }
            renderMenu(mod.buildSchema(), container);
        },
    };
}

// ======== 高级骨骼覆盖子页（原 ADR-061 UI，下沉为 power user 通道） ========

function buildBoneOverrideSchema(): MenuNode[] {
    const modelId = focusedModelId;
    if (!modelId) {
        return [
            {
                id: 'override:empty',
                kind: 'custom',
                renderCustom: (c) => {
                    addEmptyRow(c, t('motion.boneOverride.noModel'));
                },
            },
        ];
    }

    const inst = modelRegistry.get(modelId);
    if (!inst?.mmdModel) {
        return [
            {
                id: 'override:empty',
                kind: 'custom',
                renderCustom: (c) => {
                    addEmptyRow(c, t('motion.boneOverride.noModel'));
                },
            },
        ];
    }

    const bones = inst.mmdModel.runtimeBones;
    if (bones.length === 0) {
        return [
            {
                id: 'override:empty',
                kind: 'custom',
                renderCustom: (c) => {
                    addEmptyRow(c, t('motion.boneOverride.noBones'));
                },
            },
        ];
    }

    const menu = getMotionMenu();
    const allEntries = inst.boneOverrides;

    // [doc:adr-116 P3-3] 表单状态：供列表项「编辑」按钮回填（getOverride 接线）
    // 使用声明式状态 + addSliderRow opts.bind 实现双向同步，替代手动 DOM 引用
    // 提升到模块级 _overrideFormStates Map，避免 reRender 时丢失
    let formState = _overrideFormStates.get(modelId);
    if (!formState) {
        formState = { boneName: bones[0]?.name ?? '', pitch: 0, yaw: 0, roll: 0, weight: 1 };
        _overrideFormStates.set(modelId, formState);
    }

    return [
        // 卡片 1：添加新覆盖
        {
            id: 'override:add',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.style.cssText =
                        'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                    title.textContent = t('motion.boneOverride.addOverride');
                    inner.appendChild(title);

                    const boneSelect = document.createElement('select');
                    boneSelect.className = 'setting-select';
                    boneSelect.style.width = '100%';
                    boneSelect.style.margin = '6px 0';

                    const optGroups = _buildBoneOptions(bones);
                    for (const [groupLabel, boneNames] of optGroups) {
                        const optGroup = document.createElement('optgroup');
                        optGroup.label = groupLabel;
                        for (const bn of boneNames) {
                            const opt = document.createElement('option');
                            opt.value = bn;
                            opt.textContent = bn;
                            optGroup.appendChild(opt);
                        }
                        boneSelect.appendChild(optGroup);
                    }
                    boneSelect.value = formState.boneName;
                    boneSelect.addEventListener('change', () => {
                        formState.boneName = boneSelect.value;
                    });
                    inner.appendChild(boneSelect);

                    addSliderRow(
                        inner,
                        'Pitch (X)',
                        formState.pitch,
                        -180,
                        180,
                        1,
                        (v) => {
                            formState.pitch = v;
                        },
                        undefined,
                        undefined,
                        { bind: () => formState.pitch }
                    );
                    addSliderRow(
                        inner,
                        'Yaw (Y)',
                        formState.yaw,
                        -180,
                        180,
                        1,
                        (v) => {
                            formState.yaw = v;
                        },
                        undefined,
                        undefined,
                        { bind: () => formState.yaw }
                    );
                    addSliderRow(
                        inner,
                        'Roll (Z)',
                        formState.roll,
                        -180,
                        180,
                        1,
                        (v) => {
                            formState.roll = v;
                        },
                        undefined,
                        undefined,
                        { bind: () => formState.roll }
                    );
                    addSliderRow(
                        inner,
                        'Weight',
                        formState.weight,
                        0,
                        1,
                        0.05,
                        (v) => {
                            formState.weight = v;
                        },
                        undefined,
                        undefined,
                        { bind: () => formState.weight }
                    );

                    const applyBtn = document.createElement('button');
                    applyBtn.className = 'preset-chip';
                    applyBtn.style.marginTop = '8px';
                    applyBtn.textContent = t('motion.boneOverride.apply');
                    applyBtn.addEventListener('click', () => {
                        const boneName = formState.boneName;
                        if (!boneName) {
                            return;
                        }

                        const { pitch, yaw, roll, weight } = formState;

                        setBoneOverride(boneName, [pitch, yaw, roll], weight, true);
                        _syncOverrideToInstance(modelId);

                        setStatus(t('motion.boneOverride.applied', { bone: boneName }), true);
                        menu?.reRender();
                    });
                    inner.appendChild(applyBtn);
                });
            },
        },
        // 卡片 2：已存在的覆盖列表
        {
            id: 'override:list',
            kind: 'custom',
            visibleWhen: () => allEntries.length > 0,
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.style.cssText =
                        'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                    title.textContent = t('motion.boneOverride.activeOverrides');
                    inner.appendChild(title);

                    for (const ov of allEntries) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.justifyContent = 'space-between';

                        const toggleBtn = document.createElement('button');
                        toggleBtn.className = 'slide-action';
                        const toggleIcon = createIconifyIcon(
                            ov.enabled ? 'lucide:circle-dot' : 'lucide:circle'
                        );
                        if (toggleIcon) {
                            if (toggleBtn.firstChild) {
                                toggleBtn.removeChild(toggleBtn.firstChild);
                            }
                            toggleBtn.appendChild(toggleIcon);
                        }
                        toggleBtn.title = ov.enabled ? t('motion.disable') : t('motion.enable');
                        toggleBtn.style.opacity = ov.enabled ? '1' : '0.4';
                        toggleBtn.addEventListener('click', () => {
                            const updated: BoneOverrideEntry = { ...ov, enabled: !ov.enabled };
                            inst.boneOverrides = inst.boneOverrides.map((b) =>
                                b.boneName === ov.boneName ? updated : b
                            );
                            if (updated.enabled) {
                                setBoneOverride(ov.boneName, ov.euler, ov.weight, true);
                            } else {
                                clearBoneOverride(ov.boneName);
                            }
                            setStatus(
                                updated.enabled
                                    ? t('motion.boneOverride.applied', { bone: ov.boneName })
                                    : t('motion.boneOverride.removed', { bone: ov.boneName }),
                                true
                            );
                            menu?.reRender();
                        });
                        row.appendChild(toggleBtn);

                        const info = document.createElement('span');
                        info.style.flex = '1';
                        info.style.fontSize = '11px';
                        info.style.opacity = ov.enabled ? '1' : '0.35';
                        info.textContent = `${ov.boneName}  P:${ov.euler[0].toFixed(0)} Y:${ov.euler[1].toFixed(0)} R:${ov.euler[2].toFixed(0)}  W:${ov.weight.toFixed(2)}`;

                        row.appendChild(info);
                        // [doc:adr-116 P3-3] 编辑按钮：调用 getOverride 回填表单（引擎最新值）
                        row.appendChild(
                            createTrailingBtn({
                                icon: 'lucide:pencil',
                                title: t('motion.boneOverride.edit'),
                                onClick: () => {
                                    const live = getOverride(ov.boneName, modelId) ?? ov;
                                    formState.boneName = live.boneName;
                                    formState.pitch = live.euler[0];
                                    formState.yaw = live.euler[1];
                                    formState.roll = live.euler[2];
                                    formState.weight = live.weight;
                                    setStatus(
                                        t('motion.boneOverride.editLoaded', {
                                            bone: ov.boneName,
                                        }),
                                        true
                                    );
                                    menu?.reRender();
                                },
                            })
                        );
                        row.appendChild(
                            createTrailingBtn({
                                icon: 'lucide:trash-2',
                                title: t('motion.boneOverride.remove'),
                                danger: true,
                                onClick: () => {
                                    const snap = pushUndoSnapshot();
                                    clearBoneOverride(ov.boneName);
                                    inst.boneOverrides = inst.boneOverrides.filter(
                                        (b) => b.boneName !== ov.boneName
                                    );
                                    triggerAutoSave();
                                    setStatus(
                                        t('motion.boneOverride.removed', { bone: ov.boneName }),
                                        true
                                    );
                                    menu?.reRender();
                                    offerSceneUndo(
                                        t('motion.boneOverride.removed', { bone: ov.boneName }),
                                        snap,
                                        () => {
                                            menu?.reRender();
                                            setStatus(t('motion.undoApplied'), true);
                                        }
                                    );
                                },
                            })
                        );
                        inner.appendChild(row);
                    }
                });
            },
        },
        // 卡片 3：全部清除
        {
            id: 'override:clearAll',
            kind: 'custom',
            visibleWhen: () => allEntries.length > 0,
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'preset-chip';
                    clearBtn.textContent = t('motion.boneOverride.clearAll');
                    clearBtn.style.backgroundColor = 'var(--danger)';
                    clearBtn.addEventListener('click', () => {
                        const snap = pushUndoSnapshot();
                        clearAllOverrides();
                        inst.boneOverrides = [];
                        triggerAutoSave();
                        setStatus(t('motion.boneOverride.allCleared'), true);
                        menu?.reRender();
                        offerSceneUndo(t('motion.boneOverride.allCleared'), snap, () => {
                            menu?.reRender();
                            setStatus(t('motion.undoApplied'), true);
                        });
                    });
                    inner.appendChild(clearBtn);
                });
            },
        },
    ];
}

export function buildAdvancedBoneOverrideLevel(): PopupLevel {
    return {
        label: t('motion.boneOverride.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildBoneOverrideSchema(), container);
        },
    };
}

// ======== 内部工具 ========

/** 按类别分组骨骼选项 */
function _buildBoneOptions(
    bones: readonly { name: string; parentBone?: { name?: string } }[]
): [string, string[]][] {
    // 常见 MMD 骨骼分组
    const knownGroups: Record<string, string[]> = {
        'センター/腰部': ['センター', 'グルーブ', '腰'],
        '上半身': ['上半身', '上半身2', '胸', '首', '頭'],
        '下半身': [
            '下半身',
            '左足',
            '右足',
            '左ひざ',
            '右ひざ',
            '左足首',
            '右足首',
            '左足IK',
            '右足IK',
        ],
        '左腕': ['左肩', '左腕', '左ひじ', '左手首'],
        '右腕': ['右肩', '右腕', '右ひじ', '右手首'],
        '左手': ['左親指', '左人指', '左中指', '左薬指', '左小指'],
        '右手': ['右親指', '右人指', '右中指', '右薬指', '右小指'],
        'その他': [],
    };

    const groups: Map<string, string[]> = new Map();
    for (const [key] of Object.entries(knownGroups)) {
        groups.set(key, []);
    }
    groups.set('その他', []);
    const allBoneNames = bones.map((b) => b.name);

    for (const name of allBoneNames) {
        let placed = false;
        for (const [groupName, prefixes] of Object.entries(knownGroups)) {
            if (groupName === 'その他') {
                continue;
            }
            if (prefixes.some((p) => name === p || name.startsWith(p))) {
                groups.get(groupName)!.push(name);
                placed = true;
                break;
            }
        }
        if (!placed) {
            groups.get('その他')!.push(name);
        }
    }

    const result: [string, string[]][] = [];
    for (const [groupName, boneList] of groups) {
        if (boneList.length > 0) {
            boneList.sort();
            result.push([groupName, boneList]);
        }
    }
    return result;
}

/** 将 bone-override.ts 的运行时状态同步回 ModelInstance.boneOverrides 用于持久化 */
export function _syncOverrideToInstance(modelId: string): void {
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        return;
    }
    inst.boneOverrides = getAllOverrides();
}
