// [doc:adr-102] App-level shortcut definitions — split from events.ts (P3).
// 纯定义层：注册快捷键绑定到 ShortcutRegistry，不涉及 DOM 事件绑定。
import { dom, mmdRuntime, setStatus } from './config';
// [doc:adr-238] UI 行为（closeAllOverlays/screenshotCurrent/navAction/navLabel）经
// ui-action-bridge 注入（navActions 已下沉 menus/nav-actions），本模块不直接 import menus。
import { getUiAction, getUiActions } from './ui-action-bridge';
import { t } from './i18n/t';
import { focusedModelId } from './state';
// [doc:adr-238] scene 操作经 scene-action-bridge（scene 侧注册）
import { getSceneAction } from './scene-action-bridge';
import { registerShortcuts } from './shortcut-registry';




// ======== Register global shortcuts via ShortcutRegistry ========
export function registerAppShortcuts(): void {
    registerShortcuts([
        {
            id: 'toggle:model',
            label: 'shortcuts.label.models',
            defaultKey: 'Digit1',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(1);
                setStatus(getUiAction('navLabel')?.(1) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'toggle:motion',
            label: 'shortcuts.label.motion',
            defaultKey: 'Digit2',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(2);
                setStatus(getUiAction('navLabel')?.(2) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'toggle:scene',
            label: 'shortcuts.label.scene',
            defaultKey: 'Digit3',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(3);
                setStatus(getUiAction('navLabel')?.(3) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'toggle:env',
            label: 'shortcuts.label.env',
            defaultKey: 'Digit4',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(4);
                setStatus(getUiAction('navLabel')?.(4) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'toggle:settings',
            label: 'shortcuts.label.settings',
            defaultKey: 'Digit5',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(5);
                setStatus(getUiAction('navLabel')?.(5) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'toggle:plaza',
            label: 'shortcuts.label.plaza',
            defaultKey: 'Digit7',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(7);
                setStatus(getUiAction('navLabel')?.(7) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'toggle:assistant',
            label: 'shortcuts.label.assistant',
            defaultKey: 'Digit8',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                getUiAction('navAction')?.(8);
                setStatus(getUiAction('navLabel')?.(8) ?? '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'playback:toggle',
            label: 'shortcuts.label.playPause',
            defaultKey: 'Space',
            prevent: true,
            handler: () => {
                if (mmdRuntime && getSceneAction('focusedMmdModel')?.()) {
                    dom.btnPlayPause.click();
                }
            },
            group: 'shortcuts.group.playbackControl',
        },
        {
            id: 'global:close',
            label: 'shortcuts.label.closePopup',
            defaultKey: 'Escape',
            handler: () => {
                getUiActions()?.closeAllOverlays();
                document.body.classList.remove('ui-hidden');
            },
            group: 'shortcuts.group.global',
        },
        {
            id: 'playback:seek-back',
            label: 'shortcuts.label.seekBack',
            defaultKey: 'ArrowLeft',
            prevent: true,
            handler: () => {
                if (!mmdRuntime) {
                    return;
                }
                const foc = getSceneAction('focusedModel')?.() as { animationDuration?: number } | undefined;
                if (!foc) {
                    return;
                }
                const dur = foc.animationDuration ?? mmdRuntime.animationDuration;
                if (dur <= 0) {
                    return;
                }
                mmdRuntime.seekAnimation(Math.max(0, mmdRuntime.currentTime - 5), true);
                getSceneAction('updatePlaybackUI')?.();
            },
            group: 'shortcuts.group.playbackControl',
        },
        {
            id: 'playback:seek-forward',
            label: 'shortcuts.label.seekForward',
            defaultKey: 'ArrowRight',
            prevent: true,
            handler: () => {
                if (!mmdRuntime) {
                    return;
                }
                const foc = getSceneAction('focusedModel')?.() as { animationDuration?: number } | undefined;
                if (!foc) {
                    return;
                }
                const dur = foc.animationDuration ?? mmdRuntime.animationDuration;
                if (dur <= 0) {
                    return;
                }
                mmdRuntime.seekAnimation(Math.min(dur, mmdRuntime.currentTime + 5), true);
                getSceneAction('updatePlaybackUI')?.();
            },
            group: 'shortcuts.group.playbackControl',
        },
        {
            id: 'screenshot:current',
            label: 'shortcuts.label.screenshot',
            defaultKey: 'F2',
            defaultCtrl: false,
            prevent: true,
            handler: () => void getUiActions()?.screenshotCurrent(),
            group: 'shortcuts.group.screenshot',
        },
        // [doc:adr-125 P2] 模块层撤销/重做
        {
            id: 'motion:undo',
            label: 'shortcuts.label.motionUndo',
            defaultKey: 'KeyZ',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                const modelId = focusedModelId;
                if (modelId && (getSceneAction('canUndo')?.(modelId) ?? false)) {
                    getSceneAction('undo')?.(modelId, (snap) => getSceneAction('applyModuleSnapshot')?.(modelId, snap)) ?? false;
                    setStatus(t('motion.undoApplied'), true);
                    return;
                }
                // 无 motion 撤销时，尝试场景级撤销（Ctrl+Z 兼顾全局）
                const snap = getSceneAction('popUndoSnapshot')?.();
                if (snap) {
                    void (getSceneAction('restoreUndoSnapshot')?.(snap) ?? Promise.resolve(false)).then((ok) => {
                        if (ok) {
                            setStatus(t('scene.undoApplied'), true);
                        }
                    });
                }
            },
            group: 'shortcuts.group.motionUndoRedo',
        },
        {
            id: 'motion:redo',
            label: 'shortcuts.label.motionRedo',
            defaultKey: 'KeyZ',
            defaultCtrl: true,
            defaultShift: true,
            prevent: true,
            handler: () => {
                const modelId = focusedModelId;
                if (!modelId || !(getSceneAction('canRedo')?.(modelId) ?? false)) {
                    return;
                }
                getSceneAction('redo')?.(modelId, (snap) => getSceneAction('applyModuleSnapshot')?.(modelId, snap)) ?? false;
                setStatus(t('motion.override.redoApplied'), true);
            },
            group: 'shortcuts.group.motionUndoRedo',
        },
    ]);
}
