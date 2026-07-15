// [doc:adr-102] App-level shortcut definitions — split from events.ts (P3).
// 纯定义层：注册快捷键绑定到 ShortcutRegistry，不涉及 DOM 事件绑定。
import { dom, mmdRuntime, closeAllOverlays, setStatus } from './config';
import { focusedModel, updatePlaybackUI, focusedMmdModel } from '../scene/scene';
import { getCameraMode, switchCameraMode } from '../scene/camera/camera';
import { registerShortcuts } from './shortcut-registry';
import { screenshotCurrent } from '../menus/scene-menu';

/**
 * navActions 与 navLabels 由 events.ts 管理，本模块只消费。
 * navActions: 导航按钮映射表（数字→处理函数）
 * navLabels:  导航按钮标签（数字→显示文本）
 */
import { navActions, navLabels } from './events';

// ======== Register global shortcuts via ShortcutRegistry ========
export function registerAppShortcuts(): void {
    registerShortcuts([
        {
            id: 'toggle:models',
            label: 'shortcuts.label.models',
            defaultKey: 'Digit1',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[1]();
                setStatus(navLabels[1] || '', false);
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
                navActions[2]();
                setStatus(navLabels[2] || '', false);
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
                navActions[3]();
                setStatus(navLabels[3] || '', false);
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
                navActions[4]();
                setStatus(navLabels[4] || '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'camera:ar',
            label: 'shortcuts.label.arCamera',
            defaultKey: 'Digit6',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                const currentMode = getCameraMode();
                if (currentMode === 'ar') {
                    switchCameraMode('orbit');
                } else {
                    switchCameraMode('ar');
                }
            },
            group: 'shortcuts.group.cameraControl',
        },
        {
            id: 'toggle:plaza',
            label: 'shortcuts.label.plaza',
            defaultKey: 'Digit7',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[7]();
                setStatus(navLabels[7] || '', false);
            },
            group: 'shortcuts.group.popupNav',
        },
        {
            id: 'playback:toggle',
            label: 'shortcuts.label.playPause',
            defaultKey: 'Space',
            prevent: true,
            handler: () => {
                if (mmdRuntime && focusedMmdModel()) {
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
                closeAllOverlays();
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
                const foc = focusedModel();
                const dur = foc.animationDuration ?? mmdRuntime.animationDuration;
                if (dur <= 0) {
                    return;
                }
                mmdRuntime.seekAnimation(Math.max(0, mmdRuntime.currentTime - 5), true);
                updatePlaybackUI();
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
                const foc = focusedModel();
                const dur = foc.animationDuration ?? mmdRuntime.animationDuration;
                if (dur <= 0) {
                    return;
                }
                mmdRuntime.seekAnimation(Math.min(dur, mmdRuntime.currentTime + 5), true);
                updatePlaybackUI();
            },
            group: 'shortcuts.group.playbackControl',
        },
        {
            id: 'screenshot:current',
            label: 'shortcuts.label.screenshot',
            defaultKey: 'F6',
            defaultCtrl: true,
            prevent: true,
            handler: () => void screenshotCurrent(),
            group: 'shortcuts.group.screenshot',
        },
    ]);
}