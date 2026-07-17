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
import { createTrailingBtn } from '../core/ui-slide-row';
import { getMotionMenu } from './motion-popup';
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
                    addSectionTitle(inner, t('motion.override.title'));
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
                                        v ? t('motion.override.enabled') : t('motion.override.disabled'),
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

    // [doc:adr-116 P3-3] 表单 DOM 引用：供列表项「编辑」按钮回填（getOverride 接线）
    const formRefs: {
        select: HTMLSelectElement | null;
        pitch: HTMLInputElement | null;
        yaw: HTMLInputElement | null;
        roll: HTMLInputElement | null;
        weight: HTMLInputElement | null;
    } = { select: null, pitch: null, yaw: null, roll: null, weight: null };

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
                    boneSelect.style.cssText =
                        'width:100%;padding:6px 8px;margin:6px 0;border-radius:6px;' +
                        'background:var(--surface2);color:var(--text);border:1px solid var(--border);' +
                        'font-size:12px;';

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
                    inner.appendChild(boneSelect);
                    formRefs.select = boneSelect;

                    // Pitch (X)
                    const pitchRow = document.createElement('div');
                    pitchRow.className = 'flex-row';
                    pitchRow.style.padding = '3px 0';
                    const pitchLbl = document.createElement('label');
                    pitchLbl.textContent = 'Pitch (X)';
                    pitchLbl.className = 'slider-label';
                    pitchLbl.style.minWidth = '60px';
                    const pitchInput = document.createElement('input');
                    pitchInput.type = 'range';
                    pitchInput.min = '-180';
                    pitchInput.max = '180';
                    pitchInput.step = '1';
                    pitchInput.value = '0';
                    pitchInput.className = 'slider-track';
                    const pitchVal = document.createElement('span');
                    pitchVal.textContent = '0';
                    pitchVal.className = 'slider-value';
                    pitchInput.addEventListener('input', () => {
                        pitchVal.textContent = pitchInput.value;
                    });
                    formRefs.pitch = pitchInput;
                    pitchRow.appendChild(pitchLbl);
                    pitchRow.appendChild(pitchInput);
                    pitchRow.appendChild(pitchVal);
                    inner.appendChild(pitchRow);

                    // Yaw (Y)
                    const yawRow = document.createElement('div');
                    yawRow.className = 'flex-row';
                    yawRow.style.padding = '3px 0';
                    const yawLbl = document.createElement('label');
                    yawLbl.textContent = 'Yaw (Y)';
                    yawLbl.className = 'slider-label';
                    yawLbl.style.minWidth = '60px';
                    const yawInput = document.createElement('input');
                    yawInput.type = 'range';
                    yawInput.min = '-180';
                    yawInput.max = '180';
                    yawInput.step = '1';
                    yawInput.value = '0';
                    yawInput.className = 'slider-track';
                    const yawVal = document.createElement('span');
                    yawVal.textContent = '0';
                    yawVal.className = 'slider-value';
                    yawInput.addEventListener('input', () => {
                        yawVal.textContent = yawInput.value;
                    });
                    formRefs.yaw = yawInput;
                    yawRow.appendChild(yawLbl);
                    yawRow.appendChild(yawInput);
                    yawRow.appendChild(yawVal);
                    inner.appendChild(yawRow);

                    // Roll (Z)
                    const rollRow = document.createElement('div');
                    rollRow.className = 'flex-row';
                    rollRow.style.padding = '3px 0';
                    const rollLbl = document.createElement('label');
                    rollLbl.textContent = 'Roll (Z)';
                    rollLbl.className = 'slider-label';
                    rollLbl.style.minWidth = '60px';
                    const rollInput = document.createElement('input');
                    rollInput.type = 'range';
                    rollInput.min = '-180';
                    rollInput.max = '180';
                    rollInput.step = '1';
                    rollInput.value = '0';
                    rollInput.className = 'slider-track';
                    const rollVal = document.createElement('span');
                    rollVal.textContent = '0';
                    rollVal.className = 'slider-value';
                    rollInput.addEventListener('input', () => {
                        rollVal.textContent = rollInput.value;
                    });
                    formRefs.roll = rollInput;
                    rollRow.appendChild(rollLbl);
                    rollRow.appendChild(rollInput);
                    rollRow.appendChild(rollVal);
                    inner.appendChild(rollRow);

                    // Weight
                    const weightRow = document.createElement('div');
                    weightRow.className = 'flex-row';
                    weightRow.style.padding = '3px 0';
                    const weightLbl = document.createElement('label');
                    weightLbl.textContent = 'Weight';
                    weightLbl.className = 'slider-label';
                    weightLbl.style.minWidth = '60px';
                    const weightInput = document.createElement('input');
                    weightInput.type = 'range';
                    weightInput.min = '0';
                    weightInput.max = '1';
                    weightInput.step = '0.05';
                    weightInput.value = '1';
                    weightInput.className = 'slider-track';
                    const weightVal = document.createElement('span');
                    weightVal.textContent = '1';
                    weightVal.className = 'slider-value';
                    weightInput.addEventListener('input', () => {
                        weightVal.textContent = parseFloat(weightInput.value).toFixed(2);
                    });
                    formRefs.weight = weightInput;
                    weightRow.appendChild(weightLbl);
                    weightRow.appendChild(weightInput);
                    weightRow.appendChild(weightVal);
                    inner.appendChild(weightRow);

                    const applyBtn = document.createElement('button');
                    applyBtn.className = 'preset-chip';
                    applyBtn.style.marginTop = '8px';
                    applyBtn.textContent = t('motion.boneOverride.apply');
                    applyBtn.addEventListener('click', () => {
                        const boneName = boneSelect.value;
                        if (!boneName) {
                            return;
                        }

                        const pitch = parseFloat(formRefs.pitch?.value ?? '0');
                        const yaw = parseFloat(formRefs.yaw?.value ?? '0');
                        const roll = parseFloat(formRefs.roll?.value ?? '0');
                        const weight = parseFloat(formRefs.weight?.value ?? '1');

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
                        toggleBtn.textContent = ov.enabled ? '●' : '○';
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
                                    if (formRefs.select) {
                                        formRefs.select.value = live.boneName;
                                    }
                                    const setSlider = (
                                        el: HTMLInputElement | null,
                                        val: number
                                    ): void => {
                                        if (!el) {
                                            return;
                                        }
                                        el.value = String(val);
                                        el.dispatchEvent(new Event('input'));
                                    };
                                    setSlider(formRefs.pitch, live.euler[0]);
                                    setSlider(formRefs.yaw, live.euler[1]);
                                    setSlider(formRefs.roll, live.euler[2]);
                                    setSlider(formRefs.weight, live.weight);
                                    setStatus(
                                        t('motion.boneOverride.editLoaded', {
                                            bone: ov.boneName,
                                        }),
                                        true
                                    );
                                },
                            })
                        );
                        row.appendChild(
                            createTrailingBtn({
                                icon: 'lucide:trash-2',
                                title: t('motion.boneOverride.remove'),
                                danger: true,
                                onClick: () => {
                                    clearBoneOverride(ov.boneName);
                                    inst.boneOverrides = inst.boneOverrides.filter(
                                        (b) => b.boneName !== ov.boneName
                                    );
                                    setStatus(
                                        t('motion.boneOverride.removed', { bone: ov.boneName }),
                                        true
                                    );
                                    menu?.reRender();
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
                        clearAllOverrides();
                        inst.boneOverrides = [];
                        setStatus(t('motion.boneOverride.allCleared'), true);
                        menu?.reRender();
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
