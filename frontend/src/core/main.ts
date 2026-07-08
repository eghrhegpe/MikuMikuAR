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
    focusedModelId,
    stackRegistry,
    uiState,
} from './config';
import { t } from './i18n/t';
import { registerIconBundle } from './icons-bundle';
import { initI18n } from './i18n/locale'; // [doc:adr-059] 语言在菜单渲染前确定
import { GetConfig, ImportZip, ImportLocalFile, Events, CheckForUpdate } from './wails-bindings';
import { isAndroidPlatform } from './platform';
import { Browser } from '@wailsio/runtime';
import { generateTextColors } from '../menus/settings';
import { loadManager } from './load-manager';
import {
    initScene,
    engine,
    scene,
    modelManager,
    focusedMmdModel,
    focusedModel,
    updatePlaybackUI,
    seekFromEvent,
    tryRestoreLastScene,
    setEnvState,
    applyFrameControl,
} from '../scene/scene';
import { applyOutfitVariant, loadOutfits } from '../outfit/outfit';
import { focusModel } from '../scene/manager/model-ops';
import { screenshotCurrent } from '../menus/scene-menu';
import { updatePerformance, setPerformanceMode } from '../scene/render/performance';
import { initLibrary, showModelPopup, showMotionPopup, refreshLibrary } from '../menus/library';
import {
    freeflyInput,
    getCameraMode,
    restoreAutoCameraState,
    switchCameraMode,
} from '../scene/camera/camera';
import { syncTimeOfDayFromEnv } from '../scene/env/env-bridge';
import './iconify-registry';
import 'iconify-icon';
import { registerShortcuts, initShortcutDispatcher } from './shortcut-registry';

function _updateStaticHtmlTexts(): void {
    // Update hardcoded HTML text with i18n translations
    const setText = (sel: string, key: string, params?: Record<string, string>) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) el.textContent = t(key, params);
    };
    setText('.drop-text', 'main.dropToImport');
    setText('.drop-hint', 'main.dropHint');
    setText('#importToast .toast-title', 'main.newFileDetected');
    setText('#importToast .toast-import-btn', 'main.importImport');
    setText('#importToast .toast-ignore-btn', 'main.importIgnore');
    setText('#updateToast .toast-title', 'main.newVersionDetected');
    setText('#updateToast .toast-import-btn', 'main.download');
    setText('#updateToast .toast-ignore-btn', 'main.importIgnore');
}

function hexToRgb(hex: string): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return '74, 108, 247';
    }
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
            document.body.classList.remove('ui-hidden');
            el.classList.add('visible');
            // Phase 3: fade-in plays automatically via CSS transition on .visible
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

// ======== Register global shortcuts via ShortcutRegistry ========
function registerAppShortcuts(): void {
    registerShortcuts([
        {
            id: 'toggle:models',
            label: '模型库',
            defaultKey: 'Digit1',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[1]();
                setStatus(navLabels[1] || '', false);
            },
            group: '弹窗导航',
        },
        {
            id: 'toggle:motion',
            label: '动作',
            defaultKey: 'Digit2',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[2]();
                setStatus(navLabels[2] || '', false);
            },
            group: '弹窗导航',
        },
        {
            id: 'toggle:scene',
            label: '场景',
            defaultKey: 'Digit3',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[3]();
                setStatus(navLabels[3] || '', false);
            },
            group: '弹窗导航',
        },
        {
            id: 'toggle:env',
            label: '环境',
            defaultKey: 'Digit4',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[4]();
                setStatus(navLabels[4] || '', false);
            },
            group: '弹窗导航',
        },
        {
            id: 'toggle:settings',
            label: '设置',
            defaultKey: 'Digit5',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                navActions[5]();
                setStatus(navLabels[5] || '', false);
            },
            group: '弹窗导航',
        },
        {
            id: 'camera:ar',
            label: 'AR 相机',
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
            group: '相机控制',
        },
        {
            id: 'playback:toggle',
            label: '播放/暂停',
            defaultKey: 'Space',
            prevent: true,
            handler: () => {
                if (mmdRuntime && focusedMmdModel()) {
                    dom.btnPlayPause.click();
                }
            },
            group: '播放控制',
        },
        {
            id: 'global:close',
            label: '关闭弹窗',
            defaultKey: 'Escape',
            handler: () => {
                closeAllOverlays();
                document.body.classList.remove('ui-hidden');
            },
            group: '全局',
        },
        {
            id: 'playback:seek-back',
            label: '后退 5 秒',
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
            group: '播放控制',
        },
        {
            id: 'playback:seek-forward',
            label: '前进 5 秒',
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
            group: '播放控制',
        },
        {
            id: 'screenshot:current',
            label: '截图当前模型',
            defaultKey: 'F6',
            defaultCtrl: true,
            prevent: true,
            handler: () => void screenshotCurrent(),
            group: '截图',
        },
    ]);
}

// ======== Freefly WASD (only respond in freefly mode) ========
// Other shortcuts (Ctrl+1~5, Space, Escape, ArrowLeft/Right) are
// handled by the ShortcutRegistry dispatcher initialized in init().
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
let _longPressTimer: ReturnType<typeof setTimeout> | null = null;
let _lastHiddenOverlay: { id: string; showFn: () => void } | null = null;
let _lastTapTime = 0;

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
        // 注册本地图标 bundle，使 iconify 离线可用
        registerIconBundle();
        initI18n(); // [doc:adr-059] 在菜单渲染前确定语言并同步 <html lang>
        _updateStaticHtmlTexts(); // 更新 HTML 模板中的硬编码文案
        buildNavMaps();
        // Register keyboard shortcuts via ShortcutRegistry
        registerAppShortcuts();
        initShortcutDispatcher();
        setStatus(t('main.initializing'), false);

        // [doc:e2e] 按钮监听器在 initScene 之前注册，确保纯 Vite 模式下 overlay 可打开
        // 即使 WASM 加载失败或场景初始化异常，用户仍能点击导航按钮查看菜单
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
            await m.preloadAutoImportState().catch(() => {}); // 静默失败，避免阻塞 UI
            toggleOverlay('sceneOverlay', m.showSettings);
        });

        initDropHandler(); // 拖拽导入处理不依赖场景初始化

        await initScene();
        // 引擎就绪 → 隐藏加载遮罩，显示主应用 UI
        dom.showApp();
        console.info('MikuMikuAR initialized');
        initLibrary().catch((err) => console.warn('Library init:', err));
        // Restore env state from config (authoritative — scene restore skips env)
        await restoreEnvState();
        // Apply persisted UI state
        await restoreUIState();
        // 启动时自动检查更新（若用户在设置中开启）
        if (uiState.autoUpdateEnabled) {
            CheckForUpdate()
                .then((r) => {
                    if (r && r.available && r.url) {
                        showUpdateToast(r.latest, r.url);
                    }
                })
                .catch(() => {});
        }
        // Sync module-level state from persisted envState
        syncTimeOfDayFromEnv();
        restoreAutoCameraState();
        // Auto-restore last scene after library + scene init (env already restored above)
        tryRestoreLastScene().catch((err) => console.warn('Auto-restore:', err));
    } catch (err) {
        console.error('Init failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        dom.showError(msg);
        setStatus(t('main.initFailed'), false);
    }
}

async function restoreEnvState(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg.env) {
        const loaded = cfg.env as Partial<EnvState>;
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
        }
        // clothConfig 与代码默认值合并，确保新字段/新默认值生效
        if (loaded.clothConfig) {
            const { DEFAULT_CLOTH_CONFIG } = await import('../physics/xpbd-cloth');
            loaded.clothConfig = { ...DEFAULT_CLOTH_CONFIG, ...loaded.clothConfig };
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
        const textColors = generateTextColors(s.accent);
        root.style.setProperty('--text-bright', textColors.bright);
        root.style.setProperty('--text-dim', textColors.dim);
        root.style.setProperty('--text-muted', textColors.muted);
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
    if (s.autoUpdateEnabled) {
        uiState.autoUpdateEnabled = s.autoUpdateEnabled;
    }
    // 恢复原会话级字段（跨重启持久化）
    if (s.fpsLimit !== undefined) uiState.fpsLimit = s.fpsLimit;
    if (s.vsync !== undefined) uiState.vsync = s.vsync;
    if (s.defaultPhysicsEnabled !== undefined) uiState.defaultPhysicsEnabled = s.defaultPhysicsEnabled;
    if (s.renderScale !== undefined) uiState.renderScale = s.renderScale;
    if (s.cameraSensitivity !== undefined) uiState.cameraSensitivity = s.cameraSensitivity;
    if (s.invertYAxis !== undefined) uiState.invertYAxis = s.invertYAxis;
    if (s.autoScaleModel !== undefined) uiState.autoScaleModel = s.autoScaleModel;
    if (s.materialCategoryMap !== undefined) uiState.materialCategoryMap = s.materialCategoryMap;
}

// ======== Update Notification ========
function showUpdateToast(latest: string, url: string): void {
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
            Browser.OpenURL(url);
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

// ======== Render Loop (with optional FPS limit / vsync via engine.maxFPS) ========
applyFrameControl();
engine.setHardwareScalingLevel(1 / (uiState.renderScale ?? 1));
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
            importBtn.textContent = t('main.importing');
            try {
                await ImportLocalFile(payload.path);
                setStatus(t('main.imported', { name: payload.name || payload.path }), true);
                refreshLibrary().catch(console.warn);
            } catch (err: unknown) {
                setStatus(t('main.importFailed') + ': ' + formatError(err), false);
            }
            toast.classList.remove('visible');
            importBtn.disabled = false;
            importBtn.textContent = t('main.importImport');
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

// ======== E2E Capture Helper (exposed for Playwright tests, DEV only) ========
if (import.meta.env.DEV) {
    window.__capture = async (): Promise<string> => {
        const { CreateScreenshotAsync } = await import('@babylonjs/core/Misc/screenshotTools');
        // Force a render frame so Babylon writes to the backbuffer
        scene.render();
        return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
    };

    // ======== E2E Scene Inspection Hook (DEV only) ========
    // Exposes live Babylon.js / XPBD state for Playwright numeric assertions.
    // Avoids fragile pixel-screenshot comparison for 3D correctness.
    (window as any).__scene = {
        get fps(): number {
            return engine.getFps();
        },
        get meshCount(): number {
            // Babylon keeps a flat meshes array (incl. system meshes like
            // ground/helpers). Assert a threshold, not an exact number.
            return scene.meshes.length;
        },
        get particleCount(): number {
            let n = 0;
            for (const cloth of modelManager.clothInstances.values()) {
                n += cloth.solver?.particles.length ?? 0;
            }
            return n;
        },
        get constraintCount(): number {
            let n = 0;
            for (const cloth of modelManager.clothInstances.values()) {
                n += cloth.solver?.constraints.length ?? 0;
            }
            return n;
        },
        get currentAnimation(): string {
            // Use focusedModel().vmdName instead of mmdRuntime.runtimeAnimation
            // which doesn't exist in babylon-mmd's public API.
            const inst = focusedModel();
            return inst?.vmdName ?? 'idle';
        },
        // --- Outfit (换装) behavior hook (DEV only, on-strategy per ADR-060) ---
        // Drives the REAL applyOutfitVariant path so E2E can assert a 3D change
        // without fragile 3-4 level menu navigation. Returns {variants, error}
        // so the test can distinguish "no outfits" from "loadOutfits failed" —
        // a .catch(->[]) would silently mask real regressions.
        outfitVariants: async (): Promise<{ variants: string[]; error: string | null }> => {
            const inst = focusedModel();
            if (!inst) return { variants: [], error: null };
            try {
                const o = await loadOutfits(inst.id);
                return { variants: (o?.variants ?? []).map((v) => v.name), error: null };
            } catch (e) {
                return { variants: [], error: String(e) };
            }
        },
        applyOutfit: (variantName: string): Promise<boolean> => {
            const inst = focusedModel();
            if (!inst) return Promise.resolve(false);
            return applyOutfitVariant(inst.id, variantName)
                .then(() => true)
                .catch(() => false);
        },
        // Coarse 16x16 luminance fingerprint of the current frame. Stable enough
        // for "did the picture change" assertions without decoding the PNG.
        // (Do NOT read a '2d' context from the WebGL canvas — getContext returns null.)
        fingerprint: async (): Promise<string> => {
            if (!window.__capture) return '';
    const url = await window.__capture!();
            const img = new Image();
            img.src = url;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = c.height = 16;
            const ctx = c.getContext('2d');
            if (!ctx) return '';
            ctx.drawImage(img, 0, 0, 16, 16);
            const d = ctx.getImageData(0, 0, 16, 16).data;
            const LUM_THRESHOLD = 384; // ≈ half-brightness: (255×3)/2 = 382.5
            let s = '';
            for (let i = 0; i < d.length; i += 4) {
                s += d[i] + d[i + 1] + d[i + 2] > LUM_THRESHOLD ? '1' : '0';
            }
            return s;
        },
        // Delegate to the existing screenshot helper. NOTE: do NOT read a
        // '2d' context from the WebGL canvas — getContext('2d') returns null.
        capture: (): Promise<string> => window.__capture!(),

        // CI seed model — creates a programmatic Babylon mesh so @webgl E2E tests
        // can assert a real 3D scene without a PMX file on disk.
        createTestMesh: async (): Promise<void> => {
            const { MeshBuilder } = await import('@babylonjs/core/Meshes/meshBuilder');
            const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
            const { Color3 } = await import('@babylonjs/core/Maths/math.color');
            // Dispose any previous test meshes first
            for (const m of [...scene.meshes]) {
                if (m.name.startsWith('e2e-test-')) m.dispose();
            }
            const box = MeshBuilder.CreateBox('e2e-test-mesh', { size: 0.5 }, scene);
            const mat = new StandardMaterial('e2e-test-mat', scene);
            mat.diffuseColor = new Color3(1, 0, 0);
            box.material = mat;
        },
        clearTestMeshes: (): void => {
            for (const m of [...scene.meshes]) {
                if (m.name.startsWith('e2e-test-')) m.dispose();
            }
        },
    };
}

// ======== Android storage permission (MANAGE_EXTERNAL_STORAGE) ========
// On Android 11+, reading /sdcard/MMD requires "All files access" permission.
// The native side fires a "storage:permissionGranted" event when the user
// grants it in Settings. We listen for that and rescan the model library.
//
// The native bridge also exposes window.wails.hasStoragePermission() and
// window.wails.requestStoragePermission() for the JS side to query/prompt.

declare global {
    interface Window {
        wails?: {
            platform?: () => string;
            hasStoragePermission?: () => boolean;
            requestStoragePermission?: () => void;
        };
    }
}

// Platform detection moved to ./core/platform (side-effect-free) so importing
// it does not pull in this module's bootstrap side effects. Re-exported here
// to keep the public API stable for any legacy importer.
export { isAndroidPlatform } from './platform';

// On first launch on Android, if permission isn't granted, prompt the user.
// We delay this so the scene/UI is ready before the dialog appears.
let androidStoragePromptShown = false;
function checkAndroidStoragePermission(): void {
    if (!isAndroidPlatform()) {
        return;
    }
    if (androidStoragePromptShown) {
        return;
    }

    const w = window.wails!;
    if (typeof w.hasStoragePermission === 'function' && !w.hasStoragePermission()) {
        androidStoragePromptShown = true;
        if (typeof w.requestStoragePermission === 'function') {
            setStatus(t('main.needFileAccess'), true);
            w.requestStoragePermission();
        }
    }
}

// When the native side reports a fresh grant, rescan the library.
Events.On('storage:permissionGranted', async () => {
    setStatus(t('main.permissionGranted'), false);
    try {
        await refreshLibrary();
        setStatus(t('main.libraryRefreshed'), false);
    } catch (err) {
        console.error('refreshLibrary after permission grant:', err);
        setStatus(t('main.libraryRefreshFailed') + formatError(err), true);
    }
});

// Boot the app, then on Android prompt for storage permission if needed.
init()
    .then(() => {
        // Small delay so the main UI is ready before the permission dialog.
        setTimeout(checkAndroidStoragePermission, 1500);
    })
    .catch(console.error);
