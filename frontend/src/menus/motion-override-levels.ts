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

                    // [audit-fix P3] pitch/yaw/roll/weight 四行同构,抽取 _buildRangeRow 消除重复
                    formRefs.pitch = _buildRangeRow(
                        inner,
                        'Pitch (X)',
                        '-180',
                        '180',
                        '1',
                        '0',
                        (v) => String(v)
                    );
                    formRefs.yaw = _buildRangeRow(inner, 'Yaw (Y)', '-180', '180', '1', '0', (v) =>
                        String(v)
                    );
                    formRefs.roll = _buildRangeRow(
                        inner,
                        'Roll (Z)',
                        '-180',
                        '180',
                        '1',
                        '0',
                        (v) => String(v)
                    );
                    formRefs.weight = _buildRangeRow(inner, 'Weight', '0', '1', '0.05', '1', (v) =>
                        v.toFixed(2)
                    );

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

/**
 * 构建范围滑块行(label + input[type=range] + 实时数值显示)。
 *
 * 不复用 ui-rows.addSliderRow 的原因:本表单的「编辑」按钮需要通过
 * `el.value = val; el.dispatchEvent(new Event('input'))` 精确回填,
 * 而 addSliderRow 内部用 `div.cs-bar`(非原生 input),不暴露 setValue 句柄。
 * 本 helper 返回 HTMLInputElement 供 formRefs 持有,保留回填链路。
 */
function _buildRangeRow(
    parent: HTMLElement,
    label: string,
    min: string,
    max: string,
    step: string,
    initial: string,
    format: (v: number) => string
): HTMLInputElement {
    const row = document.createElement('div');
    row.className = 'flex-row';
    row.style.padding = '3px 0';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.className = 'slider-label';
    lbl.style.minWidth = '60px';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = initial;
    input.className = 'slider-track';
    const val = document.createElement('span');
    val.textContent = format(parseFloat(initial));
    val.className = 'slider-value';
    input.addEventListener('input', () => {
        val.textContent = format(parseFloat(input.value));
    });
    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(val);
    parent.appendChild(row);
    return input;
}

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
