// settings-shortcuts.ts — 快捷键设置子菜单

import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { slideRow, addSectionTitle } from '../core/ui-helpers';
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
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { PopupLevel } from '../core/config';
import type { MenuNode } from './menu-schema';
import type { SettingsMenuHandle } from './settings-shared';
import { addDisposableListener, type Disposable } from '../core/dom';
import { logWarn } from '../core/utils';

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
            id: 'shortcuts:groups',
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

                            slideRow(
                                c,
                                'lucide:keyboard',
                                t(s.label),
                                false,
                                () => {
                                    if (_rebindingId) {
                                        return;
                                    }
                                    _rebindingId = s.id;
                                    const labelSpan = c.querySelector('.slide-label');
                                    const sublabelSpan = c.querySelector('.slide-sublabel');
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
                                        keyDisp?.dispose();
                                        keyDisp = null;
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
                                                        'settings-shortcuts',
                                                        'setUIState failed:',
                                                        err
                                                    )
                                                );
                                        }
                                    };
                                    keyDisp = addDisposableListener(document, 'keydown', handler, {
                                        capture: true,
                                    });
                                },
                                sublabel
                            );
                        }
                    });
                }
            },
        },
        {
            id: 'shortcuts:reset-all',
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
    ];
}

export function buildSettingsShortcutsLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('shortcuts.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildShortcutsSchema(getSettingsMenu), container);
        },
    };
}
