// MikuMikuAR — entry point
// Initializes scene, wires up event handlers, starts render loop.

import '../app.css';

import {
    dom,
    setStatus,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    mmdRuntime,
    closeAllOverlays,
    initHints,
    setOnCloseAllOverlays,
    setPopupOpen,
    UIState,
    EnvState,
    formatError,
} from './config';
import { GetConfig, ImportZip, ImportLocalFile, Events } from './wails-bindings';
import {
    initScene,
    engine,
    scene,
    focusedMmdModel,
    focusedModel,
    updatePlaybackUI,
    seekFromEvent,
    tryRestoreLastScene,
    setEnvState,
    loadPMXFile,
    loadVMDFromPath,
} from '../scene/scene';
import {
    updatePerformance,
    setPerformanceMode,
} from '../scene/scene-performance';
import { initLibrary, showModelPopup, showMotionPopup, refreshLibrary } from '../menus/library';
import { freeflyInput, getCameraMode } from '../scene/camera';
import './iconify-registry';
import 'iconify-icon';

function hexToRgb(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return '74, 108, 247';
    return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}

// ======== Initialize hover hints for static [data-hint] elements ========
initHints();

// ======== Event Handlers ========

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
    setStatus(`循环: ${autoLoop ? '开' : '关'}`, true);
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

// ======== Declarative nav shortcut routing: Ctrl+N → toggle nav button ========
function syncNavAriaExpanded(): void {
    const overlay = document.getElementById('sceneOverlay');
    const activeType = overlay.classList.contains('visible') ? overlay.dataset.popupType : null;

    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        const btnType = btn.dataset.popupType;
        btn.setAttribute('aria-expanded', btnType === activeType ? 'true' : 'false');
    });
}
// Track which show function last opened each overlay, so toggling the same button
// closes the overlay while clicking a different button (sharing the same overlay)
// switches content with a cross-fade animation instead of wrongly closing it.
const _lastOverlayFn = new Map<string, () => void>();

/** Wait for the CSS transition on `el` to complete (with a safety timeout). */
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

async function toggleOverlay(id: string, showFn: () => void): Promise<void> {
    const el = document.getElementById(id);
    if (!el) {
        return;
    }
    const last = _lastOverlayFn.get(id);
    if (el.classList.contains('visible')) {
        if (last === showFn) {
            // Same button clicked again → toggle close
            el.classList.remove('visible');
            // 只清理当前弹窗，不调用 closeAllOverlays()（避免递归/冗余）
            setPopupOpen(false);
            syncNavAriaExpanded();
            _lastOverlayFn.delete(id);
        } else {
            // Different button targeting the same overlay → cross-fade switch
            // Phase 1: fade out current content
            el.classList.add('overlay-fade-out');
            await waitForTransition(el, 'opacity');
            // Phase 2: swap content (closeAllOverlays + showFn), then fade in
            el.classList.remove('overlay-fade-out', 'visible');
            closeAllOverlays();
            showFn();
            el.classList.add('visible');
            // Phase 3: fade-in plays automatically via CSS transition on .visible
        }
    } else {
        closeAllOverlays();
        showFn();
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
};
const navLabels: Record<number, string> = {};
function buildNavMaps(): void {
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

// Keyboard shortcuts
window.addEventListener('keydown', async (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
    }

    // Ctrl+1/2/3/4/5: toggle nav overlays
    if (e.ctrlKey && !e.repeat && /^Digit\d$/.test(e.code)) {
        e.preventDefault();
        const num = parseInt(e.code.slice(-1), 10);
        if (navActions[num]) {
            await navActions[num]();
            setStatus(navLabels[num] || '', false);
        }
        return;
    }

    // Freefly WASD (only respond in freefly mode)
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

    if (e.code === 'Space' && !e.repeat && mmdRuntime && focusedMmdModel()) {
        e.preventDefault();
        dom.btnPlayPause.click();
    } else if (e.code === 'Escape') {
        closeAllOverlays();
    } else if (e.code === 'ArrowLeft' && mmdRuntime) {
        const foc = focusedModel();
        const dur = foc.animationDuration ?? mmdRuntime.animationDuration;
        if (dur <= 0) {
            return;
        }
        e.preventDefault();
        mmdRuntime.seekAnimation(Math.max(0, mmdRuntime.currentTime - 5), true);
        updatePlaybackUI();
    } else if (e.code === 'ArrowRight' && mmdRuntime) {
        const foc = focusedModel();
        const dur = foc.animationDuration ?? mmdRuntime.animationDuration;
        if (dur <= 0) {
            return;
        }
        e.preventDefault();
        mmdRuntime.seekAnimation(Math.min(dur, mmdRuntime.currentTime + 5), true);
        updatePlaybackUI();
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
let seekWasPlaying = false;
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
// Only clicks on the 3D canvas trigger toggle — all other UI is ignored.
// Records the last visible overlay so a second canvas click can restore it.
let _pointerDownPos = { x: 0, y: 0 };
let _lastHiddenOverlay: { id: string; showFn: () => void } | null = null;

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
    } else if (_lastHiddenOverlay) {
        // Second canvas click restores the previously hidden overlay
        toggleOverlay(_lastHiddenOverlay.id, _lastHiddenOverlay.showFn);
        _lastHiddenOverlay = null;
    }
    syncNavAriaExpanded();
}

window.addEventListener('pointerdown', (e) => {
    _pointerDownPos = { x: e.clientX, y: e.clientY };
});

window.addEventListener('pointerup', (e) => {
    const dx = e.clientX - _pointerDownPos.x;
    const dy = e.clientY - _pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
        return;
    }

    // Only toggle when clicking on the 3D canvas
    if (!dom.canvas.contains(e.target as Node)) {
        return;
    }

    _toggleOverlays();
});

// Nav buttons — event listeners are registered in init() via dom.btnXxx
// (No need to reset _overlaysHiddenByClick / _lastHidden — those variables are deleted.)

// Register closeAllOverlays callback to reset toggleOverlay state.
// This ensures _lastOverlayFn is cleared when overlays are closed via
// ESC key or other non-button paths.
setOnCloseAllOverlays(() => {
    _lastOverlayFn.clear();
});

// ======== Init ========
async function init(): Promise<void> {
    try {
        buildNavMaps();
        setStatus('正在初始化...', false);
        await initScene();
        initDropHandler();
        // Register nav button event listeners (ensured DOM ready)
        dom.btnMainAction.addEventListener('click', () =>
            toggleOverlay('sceneOverlay', showModelPopup)
        );
        dom.btnMotionPopup.addEventListener('click', () =>
            toggleOverlay('sceneOverlay', showMotionPopup)
        );
        dom.btnScene.addEventListener('click', async () => {
            const m = await import('../menus/scene-menu');
            toggleOverlay('sceneOverlay', m.showSceneMenu);
        });
        dom.btnEnv.addEventListener('click', async () => {
            const m = await import('../menus/env-menu');
            toggleOverlay('sceneOverlay', m.showEnvMenu);
        });
        dom.btnSettings.addEventListener('click', async () => {
            const m = await import('../menus/settings');
            toggleOverlay('sceneOverlay', m.showSettings);
        });
        console.info('MikuMikuAR initialized');
        initLibrary().catch((err) => console.warn('Library init:', err));
        // Restore env state from config (authoritative — scene restore skips env)
        await restoreEnvState();
        // Apply persisted UI state
        await restoreUIState();
        // Auto-restore last scene after library + scene init (env already restored above)
        tryRestoreLastScene().catch((err) => console.warn('Auto-restore:', err));
    } catch (err) {
        console.error('Init failed:', err);
        setStatus('✗ 初始化失败', false);
    }
}

async function restoreEnvState(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg.env) {
        const loaded = cfg.env as unknown as Partial<EnvState>;
        // 向后兼容：旧配置缺少高级水面参数时补上默认值
        if (loaded.fresnelBias === undefined || loaded.fresnelBias === 0) {
            loaded.fresnelBias = 0.02;
            loaded.fresnelPower = 3.0;
            loaded.diffuseStrength = 0.15;
            loaded.ambientStrength = 0.15;
            loaded.foamTransitionRange = 0.15;
            loaded.rippleNormalStrength = 0.15;
            loaded.rippleGlintStrength = 0.25;
            loaded.causticColor1 = [1.0, 0.9, 0.6];
            loaded.causticColor2 = [1.0, 1.0, 0.8];
            loaded.causticScrollX = 0.1;
            loaded.causticScrollY = 0.15;
            loaded.fresnelAlphaInfluence = 0.5;
            loaded.foamAlphaInfluence = 0.2;
        }
        setEnvState(loaded as Partial<EnvState>);
    }
}

const FONT_RESTORE: Record<string, string> = {
    system: "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif",
    noto: "'Source Han Sans SC', 'Noto Sans CJK SC', system-ui, sans-serif",
    yahei: "'Microsoft YaHei', 'Microsoft YaHei UI', system-ui, sans-serif",
};

async function restoreUIState(): Promise<void> {
    const cfg = await GetConfig();
    const s = cfg.ui_state as UIState | undefined;
    if (!s) {
        return;
    }
    const root = document.documentElement;
    if (s.scale) {
        root.style.setProperty('--ui-scale', String(s.scale));
    }
    if (s.popupWidth) {
        root.style.setProperty('--popup-width', s.popupWidth + 'px');
    }
    if (s.accent) {
        root.style.setProperty('--accent', s.accent);
        root.style.setProperty('--accent-rgb', hexToRgb(s.accent));
        root.style.setProperty('--accent-dim', s.accent + '33');
    }
    if (s.fontFamily && FONT_RESTORE[s.fontFamily]) {
        root.style.setProperty('--font', FONT_RESTORE[s.fontFamily]);
    }
    root.style.setProperty('--ui-animations', s.animations === false ? '0' : '1');
    root.style.setProperty('--ui-blur', s.blurBg ? '1' : '0');
    document
        .querySelectorAll<HTMLElement>('.overlay')
        .forEach((el) => el.classList.toggle('blur-bg', !!s.blurBg));
    if (s.performanceMode) {
        setPerformanceMode(s.performanceMode);
    }
}

// ======== Drag & Drop Import ========

function initDropHandler(): void {
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

function hideDropOverlay(): void {
    document.getElementById('dropOverlay')!.classList.remove('visible');
}

async function handleDropFile(path: string): Promise<void> {
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) {
        setStatus('⏳ 导入压缩包...', false);
        try {
            await ImportZip(path);
            setStatus('✓ 压缩包已导入', true);
            await refreshLibrary().catch((err) => console.warn('refresh after drop:', err));
        } catch (err) {
            setStatus('✗ 导入失败: ' + formatError(err), false);
            console.error('ImportZip failed:', err);
        }
    } else if (lower.endsWith('.pmx')) {
        setStatus('⏳ 加载模型...', false);
        try {
            await loadPMXFile(path);
        } catch (err) {
            setStatus('✗ 模型加载失败: ' + formatError(err), false);
            console.error('loadPMXFile failed:', err);
        }
    } else if (lower.endsWith('.vmd')) {
        setStatus('⏳ 加载动作...', false);
        try {
            await loadVMDFromPath(path);
        } catch (err) {
            setStatus('✗ VMD 加载失败: ' + formatError(err), false);
            console.error('loadVMDFromPath failed:', err);
        }
    }
}

engine.runRenderLoop(() => {
    scene.render();
    updatePerformance();
});
window.addEventListener('resize', () => {
    engine.resize();
});

// ======== FPS + Clock ========
let _fpsClockId: ReturnType<typeof setInterval> | null = null;
function startFpsClock(): void {
    if (_fpsClockId) {
        return;
    }
    _fpsClockId = setInterval(() => {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        dom.fpsClock.textContent = `${Math.round(engine.getFps())} FPS | ${h}:${m}`;
    }, 500);
}
startFpsClock();

// ======== Download Watch Notification ========
let importToastTimer: ReturnType<typeof setTimeout> | null = null;

Events.On('watch:newfile', (ev) => {
    const payload = ev.data as { path: string; name: string; type: string };
    if (importToastTimer) {
        clearTimeout(importToastTimer);
    }
    const toast = document.getElementById('importToast');
    if (!toast) {
        return;
    }
    const nameEl = toast.querySelector('.toast-file');
    if (nameEl) {
        nameEl.textContent = payload.name || payload.path;
    }
    toast.classList.add('visible');

    // Wire up import button
    const importBtn = toast.querySelector('.toast-import-btn') as HTMLButtonElement | null;
    if (importBtn) {
        importBtn.onclick = async () => {
            importBtn.disabled = true;
            importBtn.textContent = '导入中...';
            try {
                await ImportLocalFile(payload.path);
                setStatus('✓ 已导入: ' + (payload.name || payload.path), true);
                refreshLibrary().catch(console.warn);
            } catch (err: unknown) {
                setStatus('✗ 导入失败: ' + formatError(err), false);
            }
            toast.classList.remove('visible');
            importBtn.disabled = false;
            importBtn.textContent = '导入';
        };
    }

    // Wire up ignore button
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

init().catch(console.error);

// ======== E2E Capture Helper (exposed for Playwright tests, DEV only) ========
if (import.meta.env.DEV) {
    window.__capture = async (): Promise<string> => {
        const { CreateScreenshotAsync } = await import('@babylonjs/core/Misc/screenshotTools');
        // Force a render frame so Babylon writes to the backbuffer
        scene.render();
        return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
    };
}
