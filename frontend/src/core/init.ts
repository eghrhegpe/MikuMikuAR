// [doc:adr-102] init.ts — bootstrap orchestration (P4).
// Owns app initialization: static HTML text, scene init, env/UI state
// restore, Android storage-permission handling, and the top-level bootstrap()
// that wires dev-hooks / render-loop / events modules together.
// Pure Split-layer orchestrator: imports leaf/domain modules but is never
// imported by them (no cycle).
import {
    dom,
    setStatus,
    closeAllOverlays,
    initHints,
    UIState,
    EnvState,
    formatError,
    uiState,
} from './config';
import { t } from './i18n/t';
import { registerIconBundle } from './icons-bundle';
import { initI18n } from './i18n/locale';
import { GetConfig, Events, CheckForUpdate } from './wails-bindings';
import { isAndroidPlatform } from './platform';
import { generateTextColors } from '../menus/settings';
import { SETTINGS_FONT_RESTORE } from '../menus/settings-shared';
import { initScene, tryRestoreLastScene, setEnvState } from '../scene/scene';
import { initRuntimeBadge } from './runtime-mode';
import { hexToRgb, rgbToString } from './color-helpers';
import { logWarn, fireAndForget, swallowError } from './utils';
import { setPerformanceMode } from '../scene/render/performance';
import { initLibrary, showModelPopup, showMotionPopup, refreshLibrary } from '../menus/library';
import { showPlaza, closePlaza } from '../menus/plaza';
import { restoreAutoCameraState } from '../scene/camera/camera';
import { syncTimeOfDayFromEnv } from '../scene/env/env-bridge';
import { initShortcutDispatcher, loadKeyBindings } from './shortcut-registry';
import { setupE2ECapture } from './dev-hooks';
import { startRenderLoop } from './render-loop';
import {
    registerEventHandlers,
    disposeEventHandlers,
    buildNavMaps,
    registerAppShortcuts,
    initDropHandler,
    showUpdateToast,
    toggleOverlay,
} from './events';
import { addDisposableListener } from './dom';

// [adr:audit] init 层本地事件监听收集，配合 disposeEventHandlers 实现 HMR 幂等清理
const _initDisposables: { dispose(): void }[] = [];

function _updateStaticHtmlTexts(): void {
    // Update hardcoded HTML text with i18n translations
    const setText = (sel: string, key: string, params?: Record<string, string>) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) {
            el.textContent = t(key, params);
        }
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

// ======== Init ========
async function init(): Promise<void> {
    try {
        // [adr:audit] 幂等清理入口：HMR 重跑 init 时先销毁旧监听器，避免重复绑定
        for (const d of _initDisposables) {
            d.dispose();
        }
        _initDisposables.length = 0;
        disposeEventHandlers();
        // 注册本地图标 bundle，使 iconify 离线可用
        registerIconBundle();
        initI18n(); // [doc:adr-059] 在菜单渲染前确定语言并同步 <html lang>
        _updateStaticHtmlTexts(); // 更新 HTML 模板中的硬编码文案
        initRuntimeBadge(); // [adr-099] 立即渲染持久化的运行时模式徽标（刷新不丢）
        registerEventHandlers(); // [adr-102] P3: 全局 DOM/window 监听器迁至 events.ts
        buildNavMaps();
        // Register keyboard shortcuts via ShortcutRegistry
        registerAppShortcuts();
        initShortcutDispatcher();
        setStatus(t('main.initializing'), false);

        // [doc:e2e] 按钮监听器在 initScene 之前注册，确保纯 Vite 模式下 overlay 可打开
        // 即使 WASM 加载失败或场景初始化异常，用户仍能点击导航按钮查看菜单
        _initDisposables.push(
            addDisposableListener(dom.btnMainAction, 'click', () =>
                toggleOverlay('sceneOverlay', showModelPopup)
            )
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
            await m.preloadAutoImportState().catch((err) => logWarn('init', 'preloadAutoImportState', err)); // 静默失败，避免阻塞 UI
            await m.preloadDownloadWatchState().catch((err) => logWarn('init', 'preloadDownloadWatchState', err)); // 预加载监听开关状态
            toggleOverlay('sceneOverlay', m.showSettings);
        });
        dom.btnPlaza.addEventListener('click', () => {
            const layer = document.getElementById('webviewLayer');
            if (layer && layer.classList.contains('visible')) {
                closePlaza();
            } else {
                toggleOverlay('webviewLayer', showPlaza);
            }
        });

        initDropHandler(); // 拖拽导入处理不依赖场景初始化

        await initScene();
        // 引擎就绪 → 隐藏加载遮罩，显示主应用 UI
        dom.showApp();
        console.info('MikuMikuAR initialized');
        initLibrary().catch((err) => logWarn('init', 'Library init', err));
        // [doc:adr-008] 启动时预加载自动导入开关，供 watch:newfile 自动导入分支判定
        fireAndForget(async () => {
            const m = await import('../menus/settings');
            swallowError(m.preloadAutoImportState());
        });
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
                .catch((err) => logWarn('init', '', err));
        }
        // Sync module-level state from persisted envState
        syncTimeOfDayFromEnv();
        restoreAutoCameraState();
        // Auto-restore last scene after library + scene init (env already restored above)
        tryRestoreLastScene().catch((err) => logWarn('init', 'Auto-restore', err));
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
        // 向后兼容：旧配置缺少 groundSize 时补默认值（否则沿用前端默认 60）
        if (loaded.groundSize === undefined || loaded.groundSize <= 0) {
            loaded.groundSize = 60;
        }
        // 向后兼容：旧配置缺少 groundEdgeFade 时补默认值 0（硬边）
        if (loaded.groundEdgeFade === undefined) {
            loaded.groundEdgeFade = 0;
        }
        setEnvState(loaded as Partial<EnvState>);
    }
}

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
        root.style.setProperty('--accent-rgb', rgbToString(hexToRgb(s.accent)));
        root.style.setProperty('--accent-dim', s.accent + '33');
        const textColors = generateTextColors(s.accent);
        root.style.setProperty('--text-bright', textColors.bright);
        root.style.setProperty('--text-dim', textColors.dim);
        root.style.setProperty('--text-muted', textColors.muted);
    }
    if (s.fontFamily && SETTINGS_FONT_RESTORE[s.fontFamily]) {
        root.style.setProperty('--font', SETTINGS_FONT_RESTORE[s.fontFamily]);
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
    if (s.fpsLimit !== undefined) {
        uiState.fpsLimit = s.fpsLimit;
    }
    if (s.vsync !== undefined) {
        uiState.vsync = s.vsync;
    }
    if (s.defaultPhysicsEnabled !== undefined) {
        uiState.defaultPhysicsEnabled = s.defaultPhysicsEnabled;
    }
    if (s.renderScale !== undefined) {
        uiState.renderScale = s.renderScale;
    }
    if (s.cameraSensitivity !== undefined) {
        uiState.cameraSensitivity = s.cameraSensitivity;
    }
    if (s.invertYAxis !== undefined) {
        uiState.invertYAxis = s.invertYAxis;
    }
    if (s.autoScaleModel !== undefined) {
        uiState.autoScaleModel = s.autoScaleModel;
    }
    if (s.autoCenterModel !== undefined) {
        uiState.autoCenterModel = s.autoCenterModel;
    }
    if (s.materialCategoryMap !== undefined) {
        uiState.materialCategoryMap = s.materialCategoryMap;
    }
    // 恢复截图设置
    if (s.screenshotFormat !== undefined) {
        uiState.screenshotFormat = s.screenshotFormat as UIState['screenshotFormat'];
    }
    if (s.screenshotQuality !== undefined) {
        uiState.screenshotQuality = s.screenshotQuality;
    }
    if (s.screenshotDir !== undefined) {
        uiState.screenshotDir = s.screenshotDir;
    }
    // 恢复资源库视图模式
    if (s.resourceViewMode !== undefined) {
        uiState.resourceViewMode = s.resourceViewMode as UIState['resourceViewMode'];
    }
    // 恢复音频设置
    if (s.volume !== undefined) {
        uiState.volume = s.volume;
    }
    if (s.audioOffset !== undefined) {
        uiState.audioOffset = s.audioOffset;
    }
    if (s.bpmQuantizeEnabled !== undefined) {
        uiState.bpmQuantizeEnabled = s.bpmQuantizeEnabled;
    }
    if (s.autoLoadCompanionAudio !== undefined) {
        uiState.autoLoadCompanionAudio = s.autoLoadCompanionAudio;
    }
    if (s.sfxEnabled !== undefined) {
        uiState.sfxEnabled = s.sfxEnabled;
    }
    if (s.sfxVolume !== undefined) {
        uiState.sfxVolume = s.sfxVolume;
    }
    if (s.footstepEnabled !== undefined) {
        uiState.footstepEnabled = s.footstepEnabled;
    }
    if (s.footstepVolume !== undefined) {
        uiState.footstepVolume = s.footstepVolume;
    }
    // 恢复快捷键自定义绑定
    if (s.keyBindings !== undefined) {
        loadKeyBindings(s.keyBindings as Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }>);
        uiState.keyBindings = s.keyBindings;
    }
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
            hasCameraPermission?: () => boolean;
            requestCameraPermission?: () => void;
        };
    }
}

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

// Android back gesture → pop the MenuStack overlay stack.
Events.On('android:back', () => {
    closeAllOverlays();
});

// ======== Bootstrap ========
// Wires dev-hooks / render-loop / events modules and starts the app.
export function bootstrap(): void {
    // Initialize hover hints for static [data-hint] elements
    initHints();
    setupE2ECapture();
    startRenderLoop();

    // Boot the app, then on Android prompt for storage permission if needed.
    init()
        .then(() => {
            // Small delay so the main UI is ready before the permission dialog.
            setTimeout(checkAndroidStoragePermission, 1500);
        })
        .catch(console.error);
}
