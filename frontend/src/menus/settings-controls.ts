// settings-controls.ts — 操控设置子菜单（ADR-157：相机项 + 快捷键合并）
// 相机灵敏度/Y轴反转/自动居中 来自原 settings-performance；快捷键重绑来自原 settings-shortcuts。

import { t } from '../core/i18n/t';
import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { slideRow, addSectionTitle } from '../core/ui-helpers';
import { refreshCameraUserSettings } from '../scene/camera/camera';
import {
    getAllShortcuts,
    formatKeyBinding,
    setKeyBinding,
    resetKeyBinding,
    resetAllKeyBindings,
    loadKeyBindings,
    exportKeyBindings,
} from '../core/shortcut-registry';
import { showConfirm } from '../core/dialog';
import { addDisposableListener, type Disposable } from '../core/dom';
import { logWarn } from '../core/logger';
import { safeDispose } from '../core/dispose-helpers';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 卡片 1：相机 ========
function buildCameraSchema(): MenuNode[] {
    return [
        {
            id: 'controls:camSens',
            kind: 'slider',
            label: 'settings.perf.camSens',
            control: {
                bind: 'ui.cameraSensitivity',
                min: 0.2,
                max: 3,
                step: 0.1,
                get: (v) => (v as number) ?? 1,
                set: (v) => Math.round((v as number) * 10) / 10,
                onChange: (v) => {
                    refreshCameraUserSettings();
                    setStatus(t('settings.camSens', { x: v as number }), true);
                },
            },
            icon: 'lucide:move',
        },
        {
            id: 'controls:camSensHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.camSensHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'controls:invertY',
            kind: 'toggle',
            label: 'settings.perf.invertY',
            control: {
                bind: 'ui.invertYAxis',
                get: (v) => v === true,
                set: (v) => v,
                onChange: (v) => {
                    refreshCameraUserSettings();
                    setStatus(
                        t('settings.invertY', { state: v ? t('common.on') : t('common.off') }),
                        true
                    );
                },
            },
            icon: 'lucide:flip-vertical',
        },
        {
            id: 'controls:invertYHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.invertYHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'controls:autoCenter',
            kind: 'toggle',
            label: 'settings.perf.autoCenter',
            control: {
                bind: 'ui.autoCenterModel',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    setStatus(
                        t('settings.perf.autoCenterState', {
                            state: v ? t('common.on') : t('common.off'),
                        }),
                        true
                    );
                },
            },
            icon: 'lucide:crosshair',
        },
        {
            id: 'controls:autoCenterHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.autoCenterHint');
                c.appendChild(hint);
            },
        },
    ] satisfies MenuNode[];
}

// ======== 快捷键重绑（修复：从 row 精确定位 label/sublabel，避免命中错误行） ========

function _isModifierOnly(code: string): boolean {
    return (
        code === 'ControlLeft' ||
        code === 'ControlRight' ||
        code === 'ShiftLeft' ||
        code === 'ShiftRight' ||
        code === 'AltLeft' ||
        code === 'AltRight' ||
        code === 'MetaLeft' ||
        code === 'MetaRight'
    );
}

let _rebindingId: string | null = null;

function buildShortcutsSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'controls:shortcut-groups',
            kind: 'custom',
            renderCustom: (container) => {
                _rebindingId = null;

                const persisted = (uiState as Record<string, unknown>).keyBindings as
                    | Record<
                          string,
                          { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }
                      >
                    | undefined;
                if (persisted) {
                    loadKeyBindings(persisted);
                }

                const allShortcuts = getAllShortcuts();
                const groups = new Map<string, typeof allShortcuts>();
                for (const s of allShortcuts) {
                    const list = groups.get(s.group);
                    if (list) {
                        list.push(s);
                    } else {
                        groups.set(s.group, [s]);
                    }
                }

                for (const [groupName, items] of groups) {
                    cardContainer(container, (c) => {
                        addSectionTitle(c, t(groupName));
                        for (const s of items) {
                            const combo = formatKeyBinding(
                                s.currentKey,
                                s.currentCtrl,
                                s.currentShift,
                                s.currentAlt
                            );
                            const isOverridden =
                                s.currentKey !== s.defaultKey ||
                                s.currentCtrl !== (s.defaultCtrl ?? false) ||
                                s.currentShift !== (s.defaultShift ?? false) ||
                                s.currentAlt !== (s.defaultAlt ?? false);
                            const sublabel =
                                combo + (isOverridden ? ' · ' + t('shortcuts.custom') : '');

                            // 修复：先声明 row 引用，点击时从 row（而非整个卡片容器）定位 label
                            let rowEl: HTMLElement | null = null;
                            rowEl = slideRow(
                                c,
                                'lucide:keyboard',
                                t(s.label),
                                false,
                                () => {
                                    if (_rebindingId) {
                                        return;
                                    }
                                    _rebindingId = s.id;
                                    const labelSpan = rowEl?.querySelector('.slide-label') ?? null;
                                    const sublabelSpan =
                                        rowEl?.querySelector('.slide-sublabel') ?? null;
                                    if (labelSpan) {
                                        labelSpan.textContent = t('shortcuts.pressNewCombo');
                                    }
                                    if (sublabelSpan) {
                                        sublabelSpan.textContent = '';
                                    }

                                    let keyDisp: Disposable | null = null;
                                    const handler = (e: KeyboardEvent) => {
                                        if (e.repeat) {
                                            return;
                                        }
                                        e.stopPropagation();
                                        e.preventDefault();
                                        if (_isModifierOnly(e.code)) {
                                            return;
                                        }
                                        keyDisp = safeDispose(keyDisp);
                                        if (e.code === 'Escape') {
                                            _rebindingId = null;
                                            getSettingsMenu()?.reRender();
                                            return;
                                        }
                                        const id = _rebindingId!;
                                        _rebindingId = null;
                                        const result = setKeyBinding(
                                            id,
                                            e.code,
                                            e.ctrlKey,
                                            e.shiftKey,
                                            e.altKey
                                        );
                                        if (!('conflictId' in result)) {
                                            setUIState({ keyBindings: exportKeyBindings() });
                                            getSettingsMenu()?.reRender();
                                        } else {
                                            const conflictId = result.conflictId;
                                            const conflictLabel = result.conflictLabel;
                                            showConfirm(
                                                t('shortcuts.confirmOverride', {
                                                    label: t(conflictLabel),
                                                })
                                            )
                                                .then((ok) => {
                                                    if (ok) {
                                                        resetKeyBinding(conflictId);
                                                        setKeyBinding(
                                                            id,
                                                            e.code,
                                                            e.ctrlKey,
                                                            e.shiftKey,
                                                            e.altKey
                                                        );
                                                        setUIState({
                                                            keyBindings: exportKeyBindings(),
                                                        });
                                                    }
                                                })
                                                .catch((err) =>
                                                    logWarn(
                                                        'settings-controls',
                                                        'setUIState failed:',
                                                        err
                                                    )
                                                );
                                        }
                                    };
                                    keyDisp = addDisposableListener(
                                        document,
                                        'keydown',
                                        handler,
                                        {
                                            capture: true,
                                        }
                                    );
                                },
                                sublabel
                            );
                        }
                    });
                }
            },
        },
        {
            id: 'controls:shortcut-reset-all',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(inner, 'lucide:rotate-ccw', t('shortcuts.resetAll'), false, () => {
                        resetAllKeyBindings();
                        setUIState({ keyBindings: exportKeyBindings() });
                        getSettingsMenu()?.reRender();
                        setStatus(t('settings.shortcutsReset'), true);
                    });
                });
            },
        },
    ] satisfies MenuNode[];
}

function buildControlsSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：相机
        {
            id: 'controls:camera-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.controls.camera'));
                    renderMenu(buildCameraSchema(), inner);
                });
            },
        },
        // 快捷键分组卡片 + 重置（buildShortcutsSchema 内部自带 cardContainer）
        ...buildShortcutsSchema(getSettingsMenu),
    ];
}

export function buildSettingsControlsLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.controls'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildControlsSchema(getSettingsMenu), container);
        },
    };
}
