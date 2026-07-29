// [doc:adr-102] Event handlers — split from main.ts (P3).
// Aggregates DOM/window event listeners, navigation routing, shortcut
// registration, drag-drop import, and update toasts. Pure Split-layer module:
// it imports from leaf/domain layers but is never imported by them (no cycle).
import {
    dom,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    mmdRuntime,
    closeAllOverlays,
    setPopupOpen,
    focusedModelId,
    stackRegistry,
    setStatus,
    setOnCloseAllOverlays,
} from './config';
import { updatePlaybackUI, seekFromEvent, focusedMmdModel } from '../scene/scene';
import { freeflyInput } from './freefly-state';
import { orbitInput } from './orbit-state';
import { getCameraMode } from '../scene/camera/camera';
import { t } from './i18n/t';
import { openExternalURL } from './platform';
import { getCachedCapabilities } from './backend';
import { addDisposableListener } from './dom';

// [adr:audit] 统一收集 app 级事件监听，支持幂等清理（防 HMR 重复绑定）。
// 所有 register* 函数改用 _reg 注册；disposeEventHandlers() 在 init 入口统一销毁。
const _eventDisposables: { dispose(): void }[] = [];
// handler 以 any 接收：wrapper 无法复刻 DOM addEventListener 的事件名重载
// （keyof WindowEventMap），集中豁免单点，避免给 17 处调用逐一补事件类型注解。
function _reg(
    target: EventTarget,
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (evt: any) => void,
    options?: AddEventListenerOptions
): void {
    _eventDisposables.push(addDisposableListener(target, event, handler, options));
}
export function disposeEventHandlers(): void {
    for (const d of _eventDisposables) {
        d.dispose();
    }
    _eventDisposables.length = 0;
    // 清理可能残留的长按定时器
    if (_longPressTimer) {
        clearTimeout(_longPressTimer);
        _longPressTimer = null;
    }
}

import { browser } from './runtime-bridge';
import { showModelPopup, showMotionPopup } from '../menus/library';
import { showPlaza } from '../menus/plaza-browser';
import { closePlaza } from '../menus/plaza-state';
import { handleDroppedFile } from './drop-import';
import { focusModel } from '../scene/manager/model-ops';
import { getAllShortcuts, getAriaKeyshortcuts } from './shortcut-registry';

// ======== Module-level state ========
const _lastOverlayFn = new Map<string, () => void>();
// Register closeAllOverlays callback to reset toggleOverlay state.
// This ensures _lastOverlayFn is cleared when overlays are closed via
// ESC key or other non-button paths. (Split from main.ts :615.)
setOnCloseAllOverlays(() => {
    _lastOverlayFn.clear();
});
let seekWasPlaying = false;
let _pointerDownPos = { x: 0, y: 0 };
let _longPressTimer: ReturnType<typeof setTimeout> | null = null;
let _lastTapTime = 0;
export const navLabels: Record<number, string> = {};

// ======== Nav / overlay helpers ========
function syncNavAriaExpanded(): void {
    const overlay = document.getElementById('sceneOverlay');
    const activeType = overlay.classList.contains('visible') ? overlay.dataset.popupType : null;

    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        const btnType = btn.dataset.popupType;
        btn.setAttribute('aria-expanded', btnType === activeType ? 'true' : 'false');
    });
}

function waitForTransition(el: HTMLElement, propertyName?: string): Promise<void> {
    return new Promise((resolve) => {
        const dur = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
        if (dur <= 0) {
            resolve();
            return;
        }
        const disp = addDisposableListener(el, 'transitionend', (e) => {
            if (propertyName && (e as TransitionEvent).propertyName !== propertyName) {
                return;
            }
            disp.dispose();
            resolve();
        });
        const timeout = Math.max(dur * 2, 500); // D1: 安全网 ≥ 2× 时长且下限 500ms
        setTimeout(resolve, timeout);
    });
}

let _toggling = false; // [audit:P2] 并发锁：防快速点击导致 DOM 状态不一致
export async function toggleOverlay(id: string, showFn: () => void): Promise<void> {
    if (_toggling) {
        return;
    }
    _toggling = true;
    try {
        const el = document.getElementById(id);
        if (!el) {
            return;
        }
        const last = _lastOverlayFn.get(id);
        if (el.classList.contains('visible')) {
            if (last === showFn) {
                // Same button clicked again → toggle close
                el.classList.remove('visible');
                el.inert = true; // 关闭时从 Tab 顺序中移除
                setPopupOpen(false);
                syncNavAriaExpanded();
                _lastOverlayFn.delete(id);
            } else {
                // Different button targeting the same overlay → cross-fade switch
                el.classList.add('overlay-fade-out');
                await waitForTransition(el, 'opacity');
                el.classList.remove('overlay-fade-out', 'visible');
                closeAllOverlays();
                showFn();
                document.body.classList.remove('ui-hidden');
                el.classList.add('visible');
                el.removeAttribute('inert');
            }
        } else {
            closeAllOverlays();
            showFn();
            document.body.classList.remove('ui-hidden');
            el.classList.remove('overlay-fade-out'); // 防御：确保残留动画类不影响显示
            el.classList.add('visible');
            el.removeAttribute('inert'); // 打开时恢复 Tab 可达
        }
        if (el.classList.contains('visible')) {
            _lastOverlayFn.set(id, showFn);
        }
        syncNavAriaExpanded();
    } finally {
        _toggling = false;
    }
}

export const navActions: Record<number, () => void | Promise<void>> = {
    1: () => toggleOverlay('sceneOverlay', showModelPopup),
    2: () => toggleOverlay('sceneOverlay', showMotionPopup),
    3: async () => {
        const m = await import('../menus/scene-menu');
        toggleOverlay('sceneOverlay', m.showSceneMenu);
    },
    4: async () => {
        const m = await import('../menus/env-menu');
        toggleOverlay('sceneOverlay', m.showEnvMenu);
    },
    5: async () => {
        const m = await import('../menus/settings');
        toggleOverlay('sceneOverlay', m.showSettings);
    },
    7: () => {
        const layer = document.getElementById('webviewLayer');
        if (layer && layer.classList.contains('visible')) {
            closePlaza();
        } else {
            toggleOverlay('webviewLayer', showPlaza);
        }
    },
    8: async () => {
        const m = await import('../menus/assistant-panel');
        toggleOverlay('sceneOverlay', m.showAssistant);
    },
};

function _toggleOverlays(): void {
    // 画布点击：唯一职责是切换「无 UI / 沉浸」模式。
    // 所有 overlay（菜单/弹窗）的显示与否由 `ui-hidden` 统一接管，
    // 不再单独关弹窗或记忆/恢复，避免「点画布把弹窗直接关掉」的诡异手感。
    document.body.classList.toggle('ui-hidden');
    syncNavAriaExpanded();
}

// ======== Register all DOM/window event listeners ========
export function registerEventHandlers(): void {
    // Play/Pause — only toggles play state, does NOT touch autoLoop
    _reg(dom.btnPlayPause, 'click', async () => {
        if (!mmdRuntime) {
            return;
        }
        if (isPlaying) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        } else {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
        }
        updatePlaybackUI();
    });

    // Loop toggle
    _reg(dom.btnLoopToggle, 'click', () => {
        setAutoLoop(!autoLoop);
        updatePlaybackUI();
        setStatus(t('status.loop', { state: autoLoop ? t('common.on') : t('common.off') }), true);
    });

    // ======== Ctrl shortcuts hint ========
    _reg(window, 'keydown', (e) => {
        if (e.key === 'Control' && !e.repeat) {
            document.body.classList.add('shortcuts-visible');
        }
    });
    _reg(window, 'keyup', (e) => {
        if (e.key === 'Control') {
            document.body.classList.remove('shortcuts-visible');
        }
    });
    _reg(window, 'blur', () => document.body.classList.remove('shortcuts-visible'));

    // ======== Freefly WASD (only respond in freefly mode) ========
    _reg(window, 'keydown', (e) => {
        if (getCameraMode() === 'freefly') {
            if (e.code === 'KeyW') {
                freeflyInput.forward = true;
                e.preventDefault();
            } else if (e.code === 'KeyS') {
                freeflyInput.backward = true;
                e.preventDefault();
            } else if (e.code === 'KeyA') {
                freeflyInput.left = true;
                e.preventDefault();
            } else if (e.code === 'KeyD') {
                freeflyInput.right = true;
                e.preventDefault();
            } else if (e.code === 'KeyQ') {
                freeflyInput.up = true;
                e.preventDefault();
            } else if (e.code === 'KeyE') {
                freeflyInput.down = true;
                e.preventDefault();
            }
        }
    });

    // Freefly WASD release
    _reg(window, 'keyup', (e) => {
        if (getCameraMode() !== 'freefly') {
            return;
        }
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            return;
        }
        if (e.code === 'KeyW') {
            freeflyInput.forward = false;
            e.preventDefault();
        } else if (e.code === 'KeyS') {
            freeflyInput.backward = false;
            e.preventDefault();
        } else if (e.code === 'KeyA') {
            freeflyInput.left = false;
            e.preventDefault();
        } else if (e.code === 'KeyD') {
            freeflyInput.right = false;
            e.preventDefault();
        } else if (e.code === 'KeyQ') {
            freeflyInput.up = false;
            e.preventDefault();
        } else if (e.code === 'KeyE') {
            freeflyInput.down = false;
            e.preventDefault();
        }
    });

    // ======== orbit 模式 WSAD 环绕旋转（与 freefly WSAD 统一相机键位） ========
    // W/S = 仰角 beta、A/D = 环绕 alpha、+/- = 缩放。丝滑：keydown/keyup 只置位，
    // 实际积分由 camera-behaviors.ts 的 initOrbitUpdate 渲染循环逐帧推进（同 freefly）。
    // 方向键从相机控制让出：菜单开 = 导航，菜单关 = 播放 seek。
    const _orbitKeyActive = (t: HTMLElement | null): boolean => {
        if (getCameraMode() !== 'orbit') return false;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            return false;
        }
        // 菜单打开时 WSAD 交给菜单导航（避免相机与列表导航抢键）
        if (t && (t.closest('.slide-menu') || t.closest('.menu-container'))) {
            return false;
        }
        return true;
    };
    const _orbitKeyFlag = (code: string, down: boolean): boolean => {
        switch (code) {
            case 'KeyA':
                orbitInput.left = down;
                return true;
            case 'KeyD':
                orbitInput.right = down;
                return true;
            case 'KeyW':
                orbitInput.up = down;
                return true;
            case 'KeyS':
                orbitInput.down = down;
                return true;
            case 'Equal':
            case 'NumpadAdd':
                orbitInput.zoomIn = down;
                return true;
            case 'Minus':
            case 'NumpadSubtract':
                orbitInput.zoomOut = down;
                return true;
        }
        return false;
    };
    _reg(window, 'keydown', (e) => {
        if (!_orbitKeyActive(e.target as HTMLElement)) {
            return;
        }
        if (_orbitKeyFlag(e.code, true)) {
            e.preventDefault();
        }
    });
    _reg(window, 'keyup', (e) => {
        // keyup 不受菜单守卫限制：保证松键总能清标记，避免相机“卡住”持续旋转
        if (getCameraMode() !== 'orbit') {
            return;
        }
        if (_orbitKeyFlag(e.code, false)) {
            e.preventDefault();
        }
    });

    // Seek bar
    _reg(dom.seekBar, 'pointerdown', (e) => {
        setSeekDragging(true);
        seekWasPlaying = isPlaying;
        if (isPlaying && mmdRuntime) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        seekFromEvent(e);
        dom.seekBar.setPointerCapture(e.pointerId);
    });
    _reg(window, 'pointermove', (e) => {
        if (seekDragging) {
            seekFromEvent(e);
        }
    });
    _reg(window, 'pointerup', async () => {
        if (!seekDragging) {
            return;
        }
        setSeekDragging(false);
        if (seekWasPlaying && mmdRuntime && focusedMmdModel()) {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
            updatePlaybackUI();
        }
    });

    // ======== Click canvas to toggle overlays ========
    _reg(window, 'pointerdown', (e) => {
        _pointerDownPos = { x: e.clientX, y: e.clientY };
        // 长按检测：500ms 后弹出模型面板
        _longPressTimer = setTimeout(() => {
            if (!dom.canvas.contains(e.target as Node)) {
                return;
            }
            const id = focusedModelId;
            if (!id) {
                return;
            }
            // 打开模型弹窗并 push 模型层级
            showModelPopup();
            import('../menus/model-detail').then(({ buildModelLevel }) => {
                if (stackRegistry?.modelStack) {
                    stackRegistry.modelStack.push(buildModelLevel(id));
                }
            });
            _longPressTimer = null;
        }, 500);
    });

    _reg(window, 'pointerup', (e) => {
        if (_longPressTimer) {
            clearTimeout(_longPressTimer);
            _longPressTimer = null;
        }
        const dx = e.clientX - _pointerDownPos.x;
        const dy = e.clientY - _pointerDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
            return;
        }

        // Only toggle when clicking on the 3D canvas
        if (!dom.canvas.contains(e.target as Node)) {
            return;
        }

        // 双击聚焦：300ms 内两次点击同一位置 → 自动构图聚焦模型
        const now = Date.now();
        if (now - _lastTapTime < 300 && focusedModelId) {
            focusModel(focusedModelId);
            _lastTapTime = 0;
            return;
        }
        _lastTapTime = now;

        _toggleOverlays();
    });

    _reg(window, 'pointermove', (e) => {
        if (_longPressTimer) {
            const dx = e.clientX - _pointerDownPos.x;
            const dy = e.clientY - _pointerDownPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > 10) {
                clearTimeout(_longPressTimer);
                _longPressTimer = null;
            }
        }
    });
}

// ======== Build nav shortcut maps ========
export function buildNavMaps(): void {
    const shortcuts = getAllShortcuts();
    document.querySelectorAll<HTMLElement>('[data-shortcut]').forEach((el) => {
        const key = el.dataset.shortcut || '';
        const k = parseInt(key, 10);
        if (k >= 1 && k <= 9) {
            navLabels[k] = el.title || '';
        }
        // Sync badge text from data-shortcut
        const badge = el.querySelector<HTMLElement>('.shortcut-badge');
        if (badge) {
            badge.textContent = key;
        }
        // Sync data-hint shortcut suffix from data-shortcut
        const hint = el.getAttribute('data-hint');
        if (hint) {
            const clean = hint.replace(/\s*·\s*Ctrl\+\d+$/, '');
            el.setAttribute('data-hint', `${clean} · Ctrl+${key}`);
        }
        // ADR-153: aria-keyshortcuts for screen readers
        const shortcutId = `toggle:${el.dataset.popupType || ''}`;
        const def = shortcuts.find((s) => s.id === shortcutId);
        if (def) {
            el.setAttribute('aria-keyshortcuts', getAriaKeyshortcuts(def));
        }
    });
}

// ======== Update Notification ========
export function showUpdateToast(latest: string, url: string, downloadUrl?: string): void {
    const toast = document.getElementById('updateToast');
    if (!toast) {
        return;
    }
    const fileEl = toast.querySelector<HTMLElement>('.toast-file');
    if (fileEl) {
        fileEl.textContent = t('main.versionAvailable', { version: latest });
    }
    const btn = toast.querySelector<HTMLButtonElement>('.toast-import-btn');
    if (btn) {
        // [doc:adr-179] Android + direct APK link → download & install
        const hasDirectInstall = !!downloadUrl && getCachedCapabilities().installApk;
        if (hasDirectInstall) {
            btn.textContent = t('settings.about.update.downloadInstall');
        }
        btn.onclick = async () => {
            if (!hasDirectInstall) {
                if (!openExternalURL(url)) {
                    void browser.openURL(url);
                }
            } else {
                // Download APK and launch installer
                btn.disabled = true;
                btn.textContent = t('settings.about.update.downloading');
                try {
                    const { DownloadApk } = await import('../core/wails-bindings');
                    const result = await DownloadApk();
                    if (result && result.success && result.localPath) {
                        // [doc:adr-179] Register one-shot listener for install failures.
                        // WailsBridge emits 'update:installFailed' via evalJavascript when the
                        // system installer cannot be launched (e.g. FileProvider path error,
                        // missing REQUEST_INSTALL_PACKAGES permission rejected).
                        const onInstallFailed = () => {
                            btn.textContent = t('settings.about.update.downloadFailed');
                            if (!openExternalURL(url)) {
                                void browser.openURL(url);
                            }
                        };
                        window.addEventListener('update:installFailed', onInstallFailed);
                        window.wails?.installApk?.(result.localPath);
                        btn.textContent = t('settings.about.update.installLaunched');
                        // Clean up listener after a generous window (Java→JS bridge is async).
                        setTimeout(() => {
                            window.removeEventListener('update:installFailed', onInstallFailed);
                        }, 10000);
                    } else {
                        btn.textContent = t('settings.about.update.downloadFailed');
                        if (!openExternalURL(url)) {
                            void browser.openURL(url);
                        }
                    }
                } catch {
                    btn.textContent = t('settings.about.update.downloadFailed');
                    if (!openExternalURL(url)) {
                        void browser.openURL(url);
                    }
                } finally {
                    btn.disabled = false;
                }
            }
            // Only auto-hide for the simple "open URL" path.
            // Direct-install path keeps the toast visible for feedback;
            // the ignore button or next toast invocation will dismiss it.
            if (!hasDirectInstall) {
                toast.classList.remove('visible');
                toast.setAttribute('inert', '');
                toast.setAttribute('aria-hidden', 'true');
            }
        };
    }
    const ignoreBtn = toast.querySelector<HTMLButtonElement>('.toast-ignore-btn');
    if (ignoreBtn) {
        ignoreBtn.onclick = () => {
            toast.classList.remove('visible');
            toast.setAttribute('inert', '');
            toast.setAttribute('aria-hidden', 'true');
        };
    }
    toast.classList.add('visible');
    toast.removeAttribute('inert');
    toast.setAttribute('aria-hidden', 'false');
}

// ======== Drag & Drop Import ========
// handleDropFile / handleDroppedFile 抽至 ./drop-import（纯逻辑，便于单测）。
// 此处仅保留 DOM 事件注册 + overlay 视觉控制。
function hideDropOverlay(): void {
    document.getElementById('dropOverlay')!.classList.remove('visible');
}

export function initDropHandler(): void {
    let dragCounter = 0;
    let docDragOverCount = 0;
    let winDragOverCount = 0;
    let dragOverLogged = 0;
    console.info('[drop-diag] initDropHandler registered on window');
    // 同时在 document 和 window 上注册 dragover，对比哪个先收到 / 是否被拦截
    document.addEventListener(
        'dragover',
        (e) => {
            docDragOverCount++;
            if (dragOverLogged < 2) {
                dragOverLogged++;
                console.info(
                    '[drop-diag] doc dragover #' + docDragOverCount,
                    'target:',
                    (e.target as HTMLElement)?.tagName,
                    'dropEffect:',
                    e.dataTransfer?.dropEffect,
                    'effectAllowed:',
                    e.dataTransfer?.effectAllowed,
                    'defaultPrevented:',
                    e.defaultPrevented
                );
            }
        },
        true
    ); // capture 阶段，最早收到
    _reg(window, 'dragenter', (e) => {
        e.preventDefault();
        // 显式设置 dropEffect，避免浏览器默认 'none' 导致禁止图标
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        dragCounter++;
        const loading = document.getElementById('loading');
        console.info(
            '[drop-diag] dragenter',
            dragCounter,
            'target:',
            e.target?.tagName,
            'loading.display:',
            loading?.style.display,
            'loading.pe:',
            loading ? window.getComputedStyle(loading).pointerEvents : 'N/A',
            'dropEffect:',
            e.dataTransfer?.dropEffect
        );
        if (dragCounter === 1) {
            document.getElementById('dropOverlay')!.classList.add('visible');
        }
    });
    _reg(window, 'dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        console.info(
            '[drop-diag] dragleave',
            dragCounter,
            'docDragOver:',
            docDragOverCount,
            'winDragOver:',
            winDragOverCount
        );
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideDropOverlay();
        }
    });
    _reg(window, 'dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        winDragOverCount++;
        if (winDragOverCount <= 2) {
            console.info(
                '[drop-diag] win dragover #' + winDragOverCount,
                'preventDefault+dropEffect=copy OK, target:',
                e.target?.tagName
            );
        }
    });
    _reg(window, 'drop', async (e) => {
        console.info(
            '[drop-diag] drop fired! files:',
            e.dataTransfer?.files?.length ?? 0,
            'docDragOver:',
            docDragOverCount,
            'winDragOver:',
            winDragOverCount
        );
        e.preventDefault();
        hideDropOverlay();
        if (!e.dataTransfer?.files) {
            console.warn('[drop-diag] no dataTransfer.files — drop intercepted by browser?');
            return;
        }
        for (const file of Array.from(e.dataTransfer.files) as File[]) {
            console.info('[drop-diag] handling file:', file.name, file.size, 'bytes');
            await handleDroppedFile(file);
        }
    });
}

// ======== Update Notification ========
