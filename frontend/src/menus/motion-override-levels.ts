// [doc:architecture] Motion Override Levels — 逐骨骼覆盖 UI
// 职责: 骨骼选择器 + 欧拉角编辑 + 权重滑块 + 已设覆盖管理
// 路由: motion-popup.ts → motionOnFolderEnter → 'motion:boneOverride'

import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import {
    setStatus,
    PopupLevel,
    cardContainer,
    modelRegistry,
    focusedModelId,
} from '../core/config';
import { slideRow, addToggleRow, addSliderRow, addEmptyRow } from '../core/ui-helpers';
import { getMotionMenu } from './motion-popup';
import { modelManager } from '../scene/scene';
import type { BoneOverrideEntry } from '../core/types';
import {
    setBoneOverride,
    clearBoneOverride,
    clearAllOverrides,
    getAllOverrides,
} from '../scene/motion/bone-override';
import { t } from '../core/i18n/t';

// ======== 根级入口 ========

export function buildBoneOverrideLevel(): PopupLevel {
    return {
        label: t('motion.boneOverride.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const modelId = focusedModelId;
            if (!modelId) {
                addEmptyRow(container, t('motion.boneOverride.noModel'));
                return;
            }

            const inst = modelRegistry.get(modelId);
            if (!inst?.mmdModel) {
                addEmptyRow(container, t('motion.boneOverride.noModel'));
                return;
            }

            const bones = inst.mmdModel.runtimeBones;
            if (bones.length === 0) {
                addEmptyRow(container, t('motion.boneOverride.noBones'));
                return;
            }

            const menu = getMotionMenu();

            // —— 卡片 1：添加新覆盖 ——
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText = 'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = t('motion.boneOverride.addOverride');
                c.appendChild(title);

                // 骨骼选择器（下拉）
                const boneSelect = document.createElement('select');
                boneSelect.style.cssText =
                    'width:100%;padding:6px 8px;margin:6px 0;border-radius:6px;' +
                    'background:var(--surface2);color:var(--text);border:1px solid var(--border);' +
                    'font-size:12px;';
                
                // 构建骨骼选项（分组：按父级/区域分组）
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
                c.appendChild(boneSelect);

                // 欧拉角滑块
                const pitchSlider = _createSlider('Pitch (X)', -180, 180, 0, 1);
                const yawSlider = _createSlider('Yaw (Y)', -180, 180, 0, 1);
                const rollSlider = _createSlider('Roll (Z)', -180, 180, 0, 1);
                c.appendChild(pitchSlider);
                c.appendChild(yawSlider);
                c.appendChild(rollSlider);

                // 权重滑块
                const weightSlider = _createSlider('Weight', 0, 1, 1, 0.05);
                c.appendChild(weightSlider);

                // 应用按钮
                const applyBtn = document.createElement('button');
                applyBtn.className = 'preset-chip';
                applyBtn.style.marginTop = '8px';
                applyBtn.textContent = t('motion.boneOverride.apply');
                applyBtn.addEventListener('click', () => {
                    const boneName = boneSelect.value;
                    if (!boneName) return;
                    
                    const pitch = parseFloat((pitchSlider.querySelector('input[type="range"]') as HTMLInputElement).value);
                    const yaw = parseFloat((yawSlider.querySelector('input[type="range"]') as HTMLInputElement).value);
                    const roll = parseFloat((rollSlider.querySelector('input[type="range"]') as HTMLInputElement).value);
                    const weight = parseFloat((weightSlider.querySelector('input[type="range"]') as HTMLInputElement).value);

                    setBoneOverride(boneName, [pitch, yaw, roll], weight, true);
                    
                    // 持久化到 ModelInstance
                    _syncOverrideToInstance(modelId);

                    setStatus(t('motion.boneOverride.applied', { bone: boneName }), true);
                    menu?.reRender();
                });
                c.appendChild(applyBtn);
            });

            // —— 卡片 2：已存在的覆盖列表 ——
            const overrides = inst.boneOverrides.filter((b) => b.enabled);
            if (overrides.length > 0) {
                cardContainer(container, (c) => {
                    const title = document.createElement('div');
                    title.style.cssText = 'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                    title.textContent = t('motion.boneOverride.activeOverrides');
                    c.appendChild(title);

                    for (const ov of overrides) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.justifyContent = 'space-between';

                        const info = document.createElement('span');
                        info.style.flex = '1';
                        info.style.fontSize = '11px';
                        info.textContent = `${ov.boneName}  P:${ov.euler[0].toFixed(0)} Y:${ov.euler[1].toFixed(0)} R:${ov.euler[2].toFixed(0)}  W:${ov.weight.toFixed(2)}`;

                        const delBtn = document.createElement('button');
                        delBtn.className = 'slide-action';
                        delBtn.textContent = '✕';
                        delBtn.style.opacity = '0.5';
                        delBtn.title = t('motion.boneOverride.remove');
                        delBtn.addEventListener('click', () => {
                            clearBoneOverride(ov.boneName);
                            inst.boneOverrides = inst.boneOverrides.filter((b) => b.boneName !== ov.boneName);
                            setStatus(t('motion.boneOverride.removed', { bone: ov.boneName }), true);
                            menu?.reRender();
                        });

                        row.appendChild(info);
                        row.appendChild(delBtn);
                        c.appendChild(row);
                    }
                });
            }

            // —— 卡片 3：全部清除 ——
            if (overrides.length > 0) {
                cardContainer(container, (c) => {
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
                    c.appendChild(clearBtn);
                });
            }
        },
    };
}

// ======== 内部工具 ========

/** 按类别分组骨骼选项 */
function _buildBoneOptions(bones: readonly { name: string; parentBone?: { name?: string } }[]): [string, string[]][] {
    // 常见 MMD 骨骼分组
    const knownGroups: Record<string, string[]> = {
        'センター/腰部': ['センター', 'グルーブ', '腰'],
        '上半身': ['上半身', '上半身2', '胸', '首', '頭'],
        '下半身': ['下半身', '左足', '右足', '左ひざ', '右ひざ', '左足首', '右足首', '左足IK', '右足IK'],
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
            if (groupName === 'その他') continue;
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

function _createSlider(label: string, min: number, max: number, defaultValue: number, step = 1): HTMLElement {
    const container = document.createElement('div');
    container.style.cssText =
        'display:flex;align-items:center;gap:6px;padding:3px 0;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:11px;min-width:60px;color:var(--text-dim);';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(defaultValue);
    slider.style.cssText = 'flex:1;height:3px;';

    const valueLabel = document.createElement('span');
    valueLabel.textContent = String(defaultValue);
    valueLabel.style.cssText = 'font-size:11px;min-width:32px;text-align:right;opacity:0.6;';

    slider.addEventListener('input', () => {
        valueLabel.textContent = parseFloat(slider.value).toFixed(step < 1 ? 2 : 0);
    });

    container.appendChild(lbl);
    container.appendChild(slider);
    container.appendChild(valueLabel);
    return container;
}

/** 将 bone-override.ts 的运行时状态同步回 ModelInstance.boneOverrides 用于持久化 */
export function _syncOverrideToInstance(modelId: string): void {
    const inst = modelRegistry.get(modelId);
    if (!inst) return;
    inst.boneOverrides = getAllOverrides();
}
