// [doc:adr-102] Event handlers — split from main.ts (P3).
// Aggregates DOM/window event listeners, navigation routing, shortcut
// registration, drag-drop import, and update toasts. Pure Split-layer module:
// it imports from leaf/domain layers but is never imported by them (no cycle).
import { dom, isPlaying, setIsPlaying, autoLoop, setAutoLoop, seekDragging, setSeekDragging, mmdRuntime, closeAllOverlays, setPopupOpen, focusedModelId, stackRegistry, formatError, setStatus, setOnCloseAllOverlays } from './config';
import { focusedModel, updatePlaybackUI, seekFromEvent, focusedMmdModel } from '../scene/scene';
import { freeflyInput } from './freefly-state';
import { getCameraMode, switchCameraMode } from '../scene/camera/camera';
import { t } from './i18n/t';
import { openExternalURL } from './platform';
import { Browser } from '@wailsio/runtime';
import { showModelPopup, showMotionPopup, refreshLibrary } from '../menus/library';
import { showPlaza, closePlaza } from '../menus/plaza';
import { screenshotCurrent } from '../menus/scene-menu';
import { registerShortcuts } from './shortcut-registry';
import { loadManager } from './load-manager';
import { ImportZip, ImportLocalFile, Events } from './wails-bindings';
import { getAutoImportCached } from '../menus/settings-shared';
import { focusModel } from '../scene/manager/model-ops';

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
let _lastHiddenOverlay: { id: string; showFn: () => void } | null = null;
let _lastTapTime = 0;
const navLabels: Record<number, string> = {};

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
        const done = (e: TransitionEvent) => {
            if (propertyName && e.propertyName !== propertyName) {
                return;
            }
            el.removeEventListener('transitionend', done);
            resolve();
        };
        el.addEventListener('transitionend', done);
        setTimeout(resolve, dur + 50);
    });
}

export async function toggleOverlay(id: string, showFn: () => void): Promise<void> {
    const el = document.getElementById(id);
    if (!el) {
        return;
    }
    const last = _lastOverlayFn.get(id);
    if (el.classList.contains('visible')) {
        if (last === showFn) {
            // Same button clicked again → toggle close
            el.classList.remove('visible');
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
        }
    } else {
        closeAllOverlays();
        showFn();
        document.body.classList.remove('ui-hidden');
        el.classList.remove('overlay-fade-out'); // 防御：确保残留动画类不影响显示
        el.classList.add('visible');
    }
    if (el.classList.contains('visible')) {
        _lastOverlayFn.set(id, showFn);
    }
    syncNavAriaExpanded();
}

const navActions: Record<number, () => void | Promise<void>> = {
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
};

function _getAllOverlays(): HTMLElement[] {
    const seen = new Set<string>();
    const overlays: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        const id = btn.getAttribute('aria-controls');
        if (id && !seen.has(id)) {
            seen.add(id);
            const el = document.getElementById(id);
            if (el) {
                overlays.push(el);
            }
        }
    });
    return overlays;
}

function _toggleOverlays(): void {
    const all = _getAllOverlays();
    const visible = all.find((el) => el.classList.contains('visible'));

    if (visible) {
        // Canvas click hides the visible overlay and remembers it for restore
        const showFn = _lastOverlayFn.get(visible.id);
        if (showFn) {
            _lastHiddenOverlay = { id: visible.id, showFn };
        }
        all.forEach((el) => el.classList.remove('visible'));
        setPopupOpen(false);
        // 无 UI 模式：隐藏菜单后连导航栏一起隐藏
        document.body.classList.add('ui-hidden');
    } else {
        // 无菜单时点击 canvas：如果有上次记住的菜单则恢复，否则切换无 UI 模式
        if (_lastHiddenOverlay) {
            // Second canvas click restores the previously hidden overlay
            toggleOverlay(_lastHiddenOverlay.id, _lastHiddenOverlay.showFn);
            _lastHiddenOverlay = null;
        } else {
            // 没有记住的菜单 → 切换无 UI 模式
            document.body.classList.toggle('ui-hidden');
        }
    }
    syncNavAriaExpanded();
}

// ======== Register all DOM/window event listeners ========
export function registerEventHandlers(): void {
    // Play/Pause — only toggles play state, does NOT touch autoLoop
    dom.btnPlayPause.addEventListener('click', async () => {
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
    dom.btnLoopToggle.addEventListener('click', () => {
        setAutoLoop(!autoLoop);
        updatePlaybackUI();
        setStatus(t('status.loop', { state: autoLoop ? t('common.on') : t('common.off') }), true);
    });

    // ======== Ctrl shortcuts hint ========
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Control' && !e.repeat) {
            document.body.classList.add('shortcuts-visible');
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
            document.body.classList.remove('shortcuts-visible');
        }
    });
    window.addEventListener('blur', () => document.body.classList.remove('shortcuts-visible'));

    // ======== Freefly WASD (only respond in freefly mode) ========
    window.addEventListener('keydown', (e) => {
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
    window.addEventListener('keyup', (e) => {
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

    // Seek bar
    dom.seekBar.addEventListener('pointerdown', (e) => {
        setSeekDragging(true);
        seekWasPlaying = isPlaying;
        if (isPlaying && mmdRuntime) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        seekFromEvent(e);
        dom.seekBar.setPointerCapture(e.pointerId);
    });
    window.addEventListener('pointermove', (e) => {
        if (seekDragging) {
            seekFromEvent(e);
        }
    });
    window.addEventListener('pointerup', async () => {
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
    window.addEventListener('pointerdown', (e) => {
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

    window.addEventListener('pointerup', (e) => {
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

    window.addEventListener('pointermove', (e) => {
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
    });
}

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

// ======== Update Notification ========
export function showUpdateToast(latest: string, url: string): void {
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
        btn.onclick = () => {
            if (!openExternalURL(url)) {
                Browser.OpenURL(url);
            }
            toast.classList.remove('visible');
        };
    }
    const ignoreBtn = toast.querySelector<HTMLButtonElement>('.toast-ignore-btn');
    if (ignoreBtn) {
        ignoreBtn.onclick = () => toast.classList.remove('visible');
    }
    toast.classList.add('visible');
}

// ======== Drag & Drop Import ========
function hideDropOverlay(): void {
    document.getElementById('dropOverlay')!.classList.remove('visible');
}

async function handleDropFile(path: string): Promise<void> {
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) {
        setStatus(t('main.importingZip'), false);
        try {
            await ImportZip(path);
            setStatus(t('main.zipImported'), true);
            await refreshLibrary().catch((err) => console.warn('refresh after drop:', err));
        } catch (err) {
            setStatus(t('main.importFailedDetail') + formatError(err), false);
            console.error('ImportZip failed:', err);
        }
    } else if (lower.endsWith('.pmx')) {
        setStatus(t('main.loadingModel'), false);
        try {
            await loadManager.load({ kind: 'actor', path });
        } catch (err) {
            setStatus(t('main.modelLoadFailed') + formatError(err), false);
            console.error('loadManager actor failed:', err);
        }
    } else if (lower.endsWith('.vmd')) {
        setStatus(t('main.loadingMotion'), false);
        try {
            await loadManager.load({ kind: 'vmd', path });
        } catch (err) {
            setStatus(t('main.vmdLoadFailed') + formatError(err), false);
            console.error('loadManager vmd failed:', err);
        }
    }
}

export function initDropHandler(): void {
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) {
            document.getElementById('dropOverlay')!.classList.add('visible');
        }
    });
    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideDropOverlay();
        }
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        hideDropOverlay();
        // Wails v2 used to provide file.path on dropped files
        // Wails v3 may need different handling - check documentation
        // For now, log the files to see what's available
        if (e.dataTransfer?.files) {
            for (const file of Array.from(e.dataTransfer.files)) {
                // @ts-ignore - Wails v2 provided path property, may need v3-specific handling
                const path = file.path || file.name;
                await handleDropFile(path);
            }
        }
    });
}

// ======== Download Watch Notification ========
let importToastTimer: ReturnType<typeof setTimeout> | null = null;

export async function importToLibrary(path: string, displayName: string): Promise<void> {
    setStatus(t('main.importing') + ': ' + displayName, false);
    try {
        await ImportLocalFile(path);
        setStatus(t('main.imported', { name: displayName }), true);
        refreshLibrary().catch(console.warn);
    } catch (err: unknown) {
        setStatus(t('main.importFailed') + ': ' + formatError(err), false);
        console.error('[watch] import failed:', err);
    }
}

Events.On('watch:newfile', (ev) => {
    const payload = ev.data as { path: string; name: string; type: string };
    const displayName = payload.name || payload.path;

    // 自动导入模式：跳过 toast，直接入库（不加载到场景）
    if (getAutoImportCached()) {
        void importToLibrary(payload.path, displayName);
        return;
    }

    // 手动导入模式：显示 toast，用户点击导入按钮触发入库
    if (importToastTimer) {
        clearTimeout(importToastTimer);
    }
    const toast = document.getElementById('importToast');
    if (!toast) {
        return;
    }
    const nameEl = toast.querySelector('.toast-file');
    if (nameEl) {
        nameEl.textContent = displayName;
    }
    toast.classList.add('visible');

    const importBtn = toast.querySelector('.toast-import-btn') as HTMLButtonElement | null;
    if (importBtn) {
        importBtn.onclick = async () => {
            importBtn.disabled = true;
            importBtn.textContent = t('main.importing');
            toast.classList.remove('visible');
            await importToLibrary(payload.path, displayName);
            importBtn.disabled = false;
            importBtn.textContent = t('main.importImport');
        };
    }

    const ignoreBtn = toast.querySelector('.toast-ignore-btn') as HTMLButtonElement | null;
    if (ignoreBtn) {
        ignoreBtn.onclick = () => {
            toast.classList.remove('visible');
        };
    }

    // Auto-hide after 10 seconds
    importToastTimer = setTimeout(() => {
        toast.classList.remove('visible');
    }, 10000);
});
