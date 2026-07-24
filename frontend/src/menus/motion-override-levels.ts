// [doc:adr-116] Motion Override Levels — 模块化动作覆盖 UI
// 职责: 可复用覆盖卡片渲染器（renderOverrideCard / renderPresetCard，供动作详情页消费）
//       + 模块参数子页 + 高级骨骼覆盖子页
// 入口: motion-detail-ui.ts → buildMotionDetailSchema（原死路由 motion:boneOverride 已移除）

import {
    setStatus,
    PopupLevel,
    cardContainer,
    modelRegistry,
    focusedModelId,
} from '../core/config';
import { addEmptyRow, slideRow, addPresetChip } from '../core/ui-helpers';
import { addSliderRow, addBoneSelectRow, isIkBone } from '../core/ui-helpers';
import { createTrailingBtn } from '../core/ui-slide-row';
import { createIconifyIcon, createIconButton } from '../core/icons';
import { getMotionMenu, renderModuleToggleList } from './motion-popup';
import { addDisposableListener, type Disposable } from '../core/dom';
import { triggerAutoSave, pushUndoSnapshot, offerSceneUndoAndRefresh } from '../scene/scene';
import type { BoneOverrideEntry, MotionModuleState } from '../core/types';
import {
    setBoneOverride,
    clearBoneOverride,
    clearAllOverrides,
    getAllOverrides,
    getOverride,
} from '../scene/motion/bone-override';
import {
    getRegisteredModules,
    createModule,
    getModuleState,
    getAllConflicts,
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
import {
    applyMotionPreset,
    generatePresetId,
    modulesToPresetMap,
} from '../scene/motion/motion-modules/preset-types';
import type { MotionPreset } from '@/core/types';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { safeDispose } from '@/core/dispose-helpers';
import { showConfirm } from '../core/dialog';

// ======== 可复用卡片渲染器（供 motion-detail-ui 消费） ========

// [doc:adr-116 P3-3] 表单状态（per-model）：供列表项「编辑」按钮回填
// 提升到模块级 Map 避免 reRender 时丢失
interface OverrideFormState {
    boneName: string;
    pitch: number;
    yaw: number;
    roll: number;
    weight: number;
    /** [doc:adr-116 P3] 覆盖语义：true=绝对(直接设定角度) / false=复合(当前动作角度上叠加偏移)。编辑时回填，应用保留原值。 */
    absolute: boolean;
}
const _overrideFormStates = new Map<string, OverrideFormState>();

/**
 * [doc:adr-145] 动作预设卡片：标题栏（保存按钮）+ 预设列表 / 空状态。
 * 提取自已移除的独立覆盖页（原死路由 motion:boneOverride），供动作详情页消费。
 */
export function renderPresetCard(container: HTMLElement, modelId: string): void {
    const inst = modelRegistry.get(modelId);
    const presets = inst?.motionPresets ?? [];
    cardContainer(container, (inner) => {
        // 标题
        const titleBar = document.createElement('div');
        titleBar.className = 'card-title-bar';
        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = t('motion-preset.title');
        titleBar.appendChild(titleText);

        // 保存按钮
        const saveBtn = createIconButton('lucide:save', t('motion-preset.saveTitle'));
        const menuRefForPreset = getMotionMenu();
        saveBtn.addEventListener('click', () => {
            if (!modelId || !inst) {
                return;
            }
            // 检查数量限制
            if (presets.length >= 10) {
                setStatus(t('motion-preset.tooManyPresets'), true);
                return;
            }
            const modules = getRegisteredModules();
            const states: MotionModuleState[] = [];
            for (const m of modules) {
                const st = getModuleState(modelId, m.id);
                states.push(st);
            }
            const newPreset: MotionPreset = {
                id: generatePresetId(),
                name: `${t('motion-preset.title')} ${presets.length + 1}`,
                modules: modulesToPresetMap(states),
            };
            if (!inst.motionPresets) {
                inst.motionPresets = [];
            }
            inst.motionPresets.push(newPreset);
            setStatus(t('motion-preset.saved'), true);
            menuRefForPreset?.reRender();
        });
        titleBar.appendChild(saveBtn);
        inner.appendChild(titleBar);

        if (presets.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText =
                'font-size:12px;color:var(--text-dim);text-align:center;padding:16px;';
            empty.textContent = t('motion-preset.noPresets');
            inner.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.style.cssText = 'padding:4px 14px 8px;display:flex;flex-direction:column;gap:4px;';
            for (const preset of presets) {
                const row = document.createElement('div');
                row.style.cssText =
                    'display:flex;align-items:center;justify-content:space-between;gap:6px;' +
                    'padding:4px 8px;border-radius:4px;background:var(--bg2, rgba(255,255,255,0.05));';

                const nameSpan = document.createElement('span');
                nameSpan.style.cssText =
                    'font-size:12px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                nameSpan.textContent = preset.name;
                row.appendChild(nameSpan);

                // 应用按钮
                const applyBtn = document.createElement('button');
                applyBtn.className = 'slide-action';
                applyBtn.textContent = t('motion-preset.apply');
                applyBtn.style.cssText = 'font-size:11px;padding:2px 8px;';
                applyBtn.addEventListener('click', () => {
                    if (!modelId) {
                        return;
                    }
                    const snap = pushUndoSnapshot();
                    applyMotionPreset(modelId, preset);
                    setStatus(t('motion-preset.applied'), true);
                    if (snap) {
                        offerSceneUndoAndRefresh(
                            t('motion.undo.appliedPreset', { name: preset.name }),
                            snap,
                            () => menuRefForPreset?.reRender()
                        );
                    }
                    menuRefForPreset?.reRender();
                });
                row.appendChild(applyBtn);

                // 删除按钮
                const delBtn = createIconButton('lucide:trash-2', t('motion-preset.delete'));
                delBtn.style.cssText = 'font-size:11px;color:var(--danger);';
                delBtn.addEventListener('click', async () => {
                    if (!inst?.motionPresets) {
                        return;
                    }
                    const ok = await showConfirm(
                        t('motion-preset.confirmDelete', { name: preset.name })
                    );
                    if (!ok) {
                        return;
                    }
                    const idx = inst.motionPresets.indexOf(preset);
                    if (idx !== -1) {
                        inst.motionPresets.splice(idx, 1);
                    }
                    setStatus(t('motion-preset.deleted'), true);
                    menuRefForPreset?.reRender();
                });
                row.appendChild(delBtn);

                list.appendChild(row);
            }
            inner.appendChild(list);
        }
    });
}

/**
 * [doc:adr-116/125] 动作覆盖卡片：标题栏（撤销/重做/历史）+ 骨骼冲突 banner
 * + 模块开关列表 + 高级骨骼覆盖入口。提取自已移除的独立覆盖页（原死路由
 * motion:boneOverride），供动作详情页消费——详情页由此成为覆盖功能唯一入口，
 * 原沉没的冲突可视化 / 历史下拉随之重新可达。
 */
export function renderOverrideCard(
    container: HTMLElement,
    modelId: string,
    opts: { onEnter: (modId: string) => void }
): void {
    cardContainer(container, (inner) => {
        // [doc:adr-125 P2] 标题栏 + 撤销/重做按钮
        const titleBar = document.createElement('div');
        titleBar.className = 'card-title-bar';
        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = t('motion.override.title');
        titleBar.appendChild(titleText);

        const btnGroup = document.createElement('div');
        btnGroup.className = 'btn-group';
        btnGroup.style.padding = '0';

        const undoBtn = createIconButton('lucide:undo-2', 'Ctrl+Z');
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
            updateUndoState();
            updateRedoState();
            getMotionMenu()?.reRender();
        });
        const updateUndoState = () => {
            undoBtn.style.opacity = modelId && canUndo(modelId) ? '1' : '0.3';
            undoBtn.style.pointerEvents = modelId && canUndo(modelId) ? 'auto' : 'none';
        };
        updateUndoState();

        const redoBtn = createIconButton('lucide:redo-2', 'Ctrl+Shift+Z');
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
            updateUndoState();
            updateRedoState();
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
        const historyBtn = createIconButton('lucide:more-vertical', t('motion.override.history'));
        historyBtn.style.fontSize = '14px';
        let historyDropdown: HTMLElement | null = null;

        function closeHistoryDropdown(): void {
            if (historyDropdown) {
                historyDropdown.remove();
                historyDropdown = null;
            }
            _onOutsideClickDisp = safeDispose(_onOutsideClickDisp);
        }

        let _onOutsideClick: ((ev: MouseEvent) => void) | null = null;
        let _onOutsideClickDisp: Disposable | null = null;

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
                item.dataset.historyIndex = String(realIndex);
                item.addEventListener('click', () => {
                    if (!modelId) {
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
                    jumpToHistory(modelId, realIndex, applier);
                    // [doc:adr-125 fix] 跳转后重建 dropdown 以更新游标高亮，不关闭
                    // 让用户立即看到新游标位置，可点击外部或再次点击按钮关闭
                    const newCursor = getHistoryCursor(modelId);
                    for (const child of Array.from(historyDropdown!.children)) {
                        const idx = Number((child as HTMLElement).dataset.historyIndex ?? -1);
                        if (idx === newCursor) {
                            (child as HTMLElement).style.background = 'var(--hover)';
                            (child as HTMLElement).style.fontWeight = '600';
                        } else {
                            (child as HTMLElement).style.background = '';
                            (child as HTMLElement).style.fontWeight = '';
                        }
                    }
                    getMotionMenu()?.reRender();
                });
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'var(--hover)';
                });
                item.addEventListener('mouseleave', () => {
                    const cur = getHistoryCursor(modelId ?? '');
                    if (realIndex !== cur) {
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
            _onOutsideClickDisp?.dispose();
            _onOutsideClickDisp = addDisposableListener(document, 'click', _onOutsideClick);

            // 定位到按钮下方
            historyBtn.style.position = 'relative';
            historyBtn.appendChild(historyDropdown);
        });

        btnGroup.appendChild(historyBtn);
        titleBar.appendChild(btnGroup);
        inner.appendChild(titleBar);

        // [doc:adr-116 conflict-visibility] 骨骼冲突可视化 banner
        // 靠面板 reRender 刷新快照（模块开关 onChange 已触发 reRender）
        const conflictBanner = document.createElement('div');
        conflictBanner.className = 'conflict-banner';
        updateConflictBanner(conflictBanner, modelId);
        inner.appendChild(conflictBanner);

        // 模块开关列表
        renderModuleToggleList(inner, modelId, {
            initModules: true,
            onEnter: opts.onEnter,
        });

        // [doc:adr-116] 高级骨骼覆盖入口（附激活计数 sublabel，避免被快速滑过）
        const ovCount = modelRegistry.get(modelId)?.boneOverrides?.length ?? 0;
        slideRow(
            inner,
            'tabler:bone',
            t('motion.boneOverride.title'),
            true,
            () => {
                const menu = getMotionMenu();
                if (menu) {
                    menu.push(buildAdvancedBoneOverrideLevel());
                }
            },
            ovCount > 0 ? t('motion.override.activeBoneOverrides', { n: ovCount }) : undefined
        );
    });
}

// [doc:adr-116 conflict-visibility] 渲染骨骼冲突 banner（实时快照）
// 列出被其他（更高优先级）模块抢占的骨骼，格式：⚠ 模块名: 骨A←抢占者、骨B←抢占者
function updateConflictBanner(el: HTMLElement, modelId: string | null): void {
    if (!modelId) {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }
    const all = getAllConflicts(modelId).filter((a) => a.conflicts.length > 0);
    if (all.length === 0) {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }
    const total = all.reduce((s, a) => s + a.conflicts.length, 0);
    // [doc:adr-116 P3 conflict-visibility] 用户语言化：用「当前生效 / 被让位」表达抢占关系，
    // 替代旧的技术化 "骨A←模块B"。loser(a.moduleId)=被让位模块，winner(c.byModule)=当前生效模块。
    const lines = all.flatMap((a) => {
        const loserMeta = getRegisteredModules().find((m) => m.id === a.moduleId)?.meta;
        const loserName = loserMeta ? t(loserMeta.labelKey) : a.moduleId;
        return a.conflicts.map((c) => {
            const winnerMeta = getRegisteredModules().find((m) => m.id === c.byModule)?.meta;
            const winnerName = winnerMeta ? t(winnerMeta.labelKey) : c.byModule;
            return t('motion.boneConflict.line', { bone: c.bone, winner: winnerName, loser: loserName });
        });
    });
    el.style.display = '';
    el.style.color = 'var(--warn)';
    el.style.whiteSpace = 'pre-line';
    el.textContent = `${t('motion.boneConflictCount', { total })}\n` + lines.join('\n');
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
            return renderMenu(mod.buildSchema(), container);
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
        ] satisfies MenuNode[];
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
        ] satisfies MenuNode[];
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
        ] satisfies MenuNode[];
    }

    const menu = getMotionMenu();
    // [doc:adr-116 P4] 统一动作收尾：写运行时→同步实例→自动保存→状态提示→重渲染。
    // 收敛 apply / toggle 两路径的重复尾部，保证持久化行为一致。
    const finalizeOverride = (boneName: string, enabled: boolean): void => {
        syncOverrideToInstance(modelId);
        triggerAutoSave();
        setStatus(
            enabled
                ? t('motion.boneOverride.applied', { bone: boneName })
                : t('motion.boneOverride.removed', { bone: boneName }),
            true
        );
        menu?.reRender();
    };
    const allEntries = inst.boneOverrides;

    // [doc:adr-116 P3-3] 表单状态：供列表项「编辑」按钮回填（getOverride 接线）
    // 使用声明式状态 + addSliderRow opts.bind 实现双向同步，替代手动 DOM 引用
    // 提升到模块级 _overrideFormStates Map，避免 reRender 时丢失
    let formState = _overrideFormStates.get(modelId);
    if (!formState) {
        formState = { boneName: bones[0]?.name ?? '', pitch: 0, yaw: 0, roll: 0, weight: 1, absolute: true };
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
                    title.className = 'card-title';
                    title.textContent = t('motion.boneOverride.addOverride');
                    inner.appendChild(title);

                    // [doc:adr-122 P3] 骨骼选择复用 addBoneSelectRow（分组+搜索+IK标记），
                    // 替代内联 select+search 重复实现
                    addBoneSelectRow(
                        inner,
                        '',
                        bones.map((b) => b.name),
                        formState.boneName,
                        (name) => {
                            formState.boneName = name;
                        }
                    );

                    addSliderRow(
                        inner,
                        t('motion.boneOverride.pitch'),
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
                        t('motion.boneOverride.yaw'),
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
                        t('motion.boneOverride.roll'),
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
                        t('motion.boneOverride.weight'),
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

                    addPresetChip(
                        inner,
                        t('motion.boneOverride.apply'),
                        false,
                        () => {
                            const boneName = formState.boneName;
                            if (!boneName) {
                                return;
                            }

                            const { pitch, yaw, roll, weight, absolute } = formState;

                            setBoneOverride(
                                boneName,
                                [pitch, yaw, roll],
                                weight,
                                true,
                                undefined,
                                absolute
                            );
                            // [doc:adr-116 P4] 收尾（同步实例+自动保存+提示+重渲染）统一由 finalizeOverride 处理
                            finalizeOverride(boneName, true);
                        },
                        { marginTop: 8 }
                    );
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
                    title.className = 'card-title';
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
                                setBoneOverride(
                                    ov.boneName,
                                    ov.euler,
                                    ov.weight,
                                    true,
                                    undefined,
                                    ov.absolute
                                );
                            } else {
                                clearBoneOverride(ov.boneName);
                            }
                            // [doc:adr-116 P4] 收尾统一由 finalizeOverride 处理（与 apply 行为一致）
                            finalizeOverride(ov.boneName, updated.enabled);
                        });
                        row.appendChild(toggleBtn);

                        const info = document.createElement('span');
                        info.style.flex = '1';
                        info.style.fontSize = '11px';
                        info.style.opacity = ov.enabled ? '1' : '0.35';
                        // [doc:adr-122 P3] IK 骨骼附加标记
                        const ikTag = isIkBone(ov.boneName) ? ` ${t('motion.ikTag')}` : '';
                        info.textContent = `${ov.boneName}${ikTag}  P:${ov.euler[0].toFixed(0)} Y:${ov.euler[1].toFixed(0)} R:${ov.euler[2].toFixed(0)}  W:${ov.weight.toFixed(2)}`;
                        // [doc:adr-116 P4] P/Y/R/W 缩写对非专业用户不语义化，补充 tooltip 解释
                        info.title = t('motion.boneOverride.axisHint');

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
                                    // [doc:adr-116 P3] 回填绝对/复合语义，避免编辑复合覆盖时被静默翻转为绝对
                                    formState.absolute = live.absolute ?? true;
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
                                    offerSceneUndoAndRefresh(
                                        t('motion.boneOverride.removed', { bone: ov.boneName }),
                                        snap,
                                        () => {
                                            menu?.reRender();
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
                    addPresetChip(
                        inner,
                        t('motion.boneOverride.clearAll'),
                        false,
                        () => {
                            // [doc:adr-116 P3] 破坏性操作：先确认（仍可事后撤销）
                            void (async () => {
                                if (!(await showConfirm(t('motion.boneOverride.clearAllConfirm')))) {
                                    return;
                                }
                                const snap = pushUndoSnapshot();
                                clearAllOverrides();
                                inst.boneOverrides = [];
                                triggerAutoSave();
                                setStatus(t('motion.boneOverride.allCleared'), true);
                                menu?.reRender();
                                offerSceneUndoAndRefresh(
                                    t('motion.boneOverride.allCleared'),
                                    snap,
                                    () => {
                                        menu?.reRender();
                                    }
                                );
                            })();
                        },
                        { variant: 'danger' }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildAdvancedBoneOverrideLevel(): PopupLevel {
    return {
        label: t('motion.boneOverride.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildBoneOverrideSchema(), container);
        },
    };
}

// ======== 内部工具 ========

/** 将 bone-override.ts 的运行时状态同步回 ModelInstance.boneOverrides 用于持久化 */
export function syncOverrideToInstance(modelId: string): void {
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        return;
    }
    inst.boneOverrides = getAllOverrides();
}
