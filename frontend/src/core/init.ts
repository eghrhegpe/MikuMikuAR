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
    envState,
} from './config';
import { t } from './i18n/t';
import { translateGoError } from './i18n/goerr';
import { registerIconBundle } from './icons-bundle';
import { initI18n } from './i18n/locale';
import { GetConfig, Events, CheckForUpdate, GetSystemA11ySettings } from './wails-bindings';
import { isAndroidPlatform } from './platform';
import { generateTextColors } from '../menus/settings';
import { SETTINGS_FONT_RESTORE } from '../menus/settings-shared';
import {
    initScene,
    tryRestoreLastScene,
    setEnvState,
    applyEnvState,
    setSuppressAutoSave,
    cancelEnvPersistTimer,
} from '../scene/scene';
import { initRuntimeBadge } from './runtime-mode';
import { applyHudVisibility, disposeStatusBar } from './status-bar';
import { hexToRgb, rgbToString } from './color-helpers';
import { fireAndForget, swallowError } from './utils';
import { showInfoToast } from './toast';
import { safeCallAsync } from './safe-call';
import { setPerformanceMode } from '../scene/render/performance';
import { initLibrary, showModelPopup, showMotionPopup, refreshLibrary } from '../menus/library';
import { showPlaza } from '../menus/plaza-browser';
import { closePlaza } from '../menus/plaza-state';
import { restoreAutoCameraState } from '../scene/camera/camera';
import { syncTimeOfDayFromEnv } from '../scene/env/env-bridge';
import { initShortcutDispatcher, loadKeyBindings } from './shortcut-registry';
import { setupE2ECapture } from './dev-hooks';
import { startRenderLoop } from './render-loop';
import {
    registerEventHandlers,
    disposeEventHandlers,
    buildNavMaps,
    initDropHandler,
    showUpdateToast,
    toggleOverlay,
} from './events';
import { registerAppShortcuts } from './shortcut-app';
import { addDisposableListener } from './dom';
import { disposeOverlay2 } from './dialog';
import { saveSceneImmediate } from '../scene/scene-serialize';

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

// [doc:adr-153] 启动时主动读取系统无障碍设置（暗色/高对比度）。
// 主路径：CSS @media prefers-color-scheme / prefers-contrast 由浏览器自动匹配。
// 备用路径：data-theme / data-high-contrast 属性，给 WebView2 媒体查询异常时兜底。
// 纯 Vite 模式下 Go 绑定不可用，由 fireAndForget → swallowError 静默吞错。
function _applySystemA11y(): void {
    fireAndForget(async () => {
        const settings = await GetSystemA11ySettings();
        const root = document.documentElement;
        if (settings.isDarkMode) {
            root.dataset.theme = 'dark';
        }
        if (settings.isHighContrast) {
            root.dataset.highContrast = 'true';
        }
    });
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
        disposeOverlay2(); // 清理 showPrompt2 创建的双字段输入 overlay（HMR 幂等）
        disposeStatusBar(); // 清理 status 定时器（HMR 幂等）
        // 注册本地图标 bundle，使 iconify 离线可用
        registerIconBundle();
        initI18n(); // [doc:adr-059] 在菜单渲染前确定语言并同步 <html lang>
        _applySystemA11y(); // [doc:adr-153] 启动时应用系统无障碍设置（暗色/高对比度）
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
        _initDisposables.push(
            addDisposableListener(dom.btnMotionPopup, 'click', () =>
                toggleOverlay('sceneOverlay', showMotionPopup)
            )
        );
        _initDisposables.push(
            addDisposableListener(dom.btnScene, 'click', async () => {
                const m = await import('../menus/scene-menu');
                toggleOverlay('sceneOverlay', m.showSceneMenu);
            })
        );
        _initDisposables.push(
            addDisposableListener(dom.btnEnv, 'click', async () => {
                const m = await import('../menus/env-menu');
                toggleOverlay('sceneOverlay', m.showEnvMenu);
            })
        );
        _initDisposables.push(
            addDisposableListener(dom.btnSettings, 'click', async () => {
                const m = await import('../menus/settings');
                await safeCallAsync('init', 'preloadAutoImportState', () =>
                    m.preloadAutoImportState()
                ); // 静默失败，避免阻塞 UI
                await safeCallAsync('init', 'preloadDownloadWatchState', () =>
                    m.preloadDownloadWatchState()
                ); // 预加载监听开关状态
                toggleOverlay('sceneOverlay', m.showSettings);
            })
        );
        _initDisposables.push(
            addDisposableListener(dom.btnPlaza, 'click', () => {
                const layer = document.getElementById('webviewLayer');
                if (layer && layer.classList.contains('visible')) {
                    closePlaza();
                } else {
                    toggleOverlay('webviewLayer', showPlaza);
                }
            })
        );

        initDropHandler(); // 拖拽导入处理不依赖场景初始化

        await initScene();
        // 引擎就绪 → 隐藏加载遮罩，显示主应用 UI
        dom.showApp();
        console.info('MikuMikuAR initialized');
        safeCallAsync('init', 'Library init', () => initLibrary());
        // [doc:adr-008] 启动时预加载自动导入开关，供 watch:newfile 自动导入分支判定
        fireAndForget(async () => {
            const m = await import('../menus/settings');
            swallowError(m.preloadAutoImportState());
        });
        // Restore env state from config (authoritative — scene restore skips env)
        await restoreEnvState();
        // Apply persisted UI state
        await restoreUIState();
        // 应用顶部 HUD 显隐开关（在 restoreUIState 之后，确保读到持久化值）
        applyHudVisibility();
        // 启动时自动检查更新（若用户在设置中开启）
        if (uiState.autoUpdateEnabled) {
            safeCallAsync('init', '', () => CheckForUpdate()).then((r) => {
                if (r && r.available && r.url) {
                    showUpdateToast(r.latest, r.url);
                }
            });
        }
        // Sync module-level state from persisted envState
        syncTimeOfDayFromEnv();
        restoreAutoCameraState();
        // Auto-restore last scene after library + scene init (env already restored above)
        safeCallAsync('init', 'Auto-restore', () => tryRestoreLastScene());
    } catch (err) {
        console.error('Init failed:', err);
        const msg = translateGoError(err);
        dom.showError(msg);
        setStatus(t('main.initFailed'), false);
    }
}

async function restoreEnvState(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg.env) {
        console.info('[env-restore] restoreEnvState: cfg.env 存在，开始恢复环境状态');
        const loaded = cfg.env as unknown as Partial<EnvState>;
        console.info(
            '[env-restore]',
            'skyMode:',
            loaded.skyMode,
            'groundVisible:',
            loaded.groundVisible,
            'waterEnabled:',
            loaded.waterEnabled,
            'sunAngle:',
            loaded.sunAngle
        );
        // 向后兼容：旧配置缺少高级水面参数时补上默认值
        if (loaded.fresnelBias === undefined || loaded.fresnelBias === 0) {
            loaded.fresnelBias = 0.02;
            loaded.fresnelPower = 3.0;
            loaded.diffuseStrength = 0.15;
            loaded.ambientStrength = 0.15;
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
        // 向后兼容：旧配置缺少 reflectionQuality 时补默认值 'off'
        if (loaded.reflectionQuality === undefined) {
            loaded.reflectionQuality = 'off';
        }
        // 向后兼容：旧配置缺少粒子字段时补默认值
        if (loaded.particleEnabled === undefined) {
            loaded.particleEnabled = false;
            loaded.particleType = 'none';
            loaded.particleEmitRate = 1;
            loaded.particleSize = 1;
            loaded.particleSpeed = 1;
            loaded.particleSplash = false;
            loaded.particleCustomTexture = '';
        }
        // 用 setEnvState 替代 Object.assign + applyEnvState，确保：
        // 1. migrateEnvState 处理旧字段转换（如 groundMode → groundType+groundStyle）
        // 2. reactive 状态通过 Proxy 正确通知 UI 刷新
        // 3. _applyEnvStateFacade 精确控制各子系统应用（避免 applyEnvState 的全量无条件重建）
        // 4. 抑制 auto-save，防止恢复过程中触发级联保存
        setSuppressAutoSave(true);
        setEnvState(loaded, true);
        // 丢弃恢复阶段触发的 env 防抖写入（setEnvState 的 skipAutoSave 只跳过
        // triggerAutoSave，不跳过 _envPersistTimer）。若不取消，500ms 后会把
        // 刚恢复的值写回 config.json，在 LoadLastScene 延迟超过 500ms 的极端
        // 时序下会写入默认值，污染下次启动的恢复源。见 buglog 2026-07-16 教训3。
        cancelEnvPersistTimer();
        setSuppressAutoSave(false);
        console.info('[env-restore] 环境状态恢复完成');
    } else {
        console.info('[env-restore] restoreEnvState: cfg.env 为 null/undefined，跳过环境恢复');
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
    // 首次启动（无持久化 performanceMode）时，移动端默认 balanced 降一档，
    // 桌面端走 auto 自适应。已有持久化值的老用户不受影响。
    if (s.performanceMode) {
        setPerformanceMode(s.performanceMode);
    } else if (isAndroidPlatform()) {
        setPerformanceMode('balanced');
    }
    if (s.autoUpdateEnabled) {
        uiState.autoUpdateEnabled = s.autoUpdateEnabled;
    }
    // Android 屏幕常亮（ADR-017 A1-04）：undefined 视为 true（默认开启）。
    // 桌面端无 setKeepAwake 桥，可选链自动 no-op；Android 端同步原生窗口标志。
    if (s.keepAwake !== undefined) {
        uiState.keepAwake = s.keepAwake;
    }
    window.wails?.setKeepAwake?.(s.keepAwake !== false);
    // Android 屏幕方向（ADR-017 A1-05）：undefined 视为 'auto'（跟随系统）。
    if (s.screenOrientation !== undefined) {
        uiState.screenOrientation = s.screenOrientation;
    }
    window.wails?.setScreenOrientation?.(s.screenOrientation ?? 'auto');
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
    if (s.thumbnailResolution !== undefined) {
        uiState.thumbnailResolution = s.thumbnailResolution;
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
        loadKeyBindings(
            s.keyBindings as Record<
                string,
                { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }
            >
        );
        uiState.keyBindings = s.keyBindings;
    }
    // 恢复顶部 HUD 显隐开关（nil/undefined=显示）
    if (s.showFpsClock !== undefined) {
        uiState.showFpsClock = s.showFpsClock;
    }
    if (s.showRuntimeBadge !== undefined) {
        uiState.showRuntimeBadge = s.showRuntimeBadge;
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
            probeWebXRSupport?: () => void;
            launchARCoreProbe?: () => void;
            launchVuforiaProbe?: () => void;
            exitApp?: () => void;
            setKeepAwake?: (on: boolean) => void;
            setScreenOrientation?: (mode: string) => void;
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

// Android back gesture → close overlays first; double-back to exit (ADR-017 A2-02).
// Single source of truth for back handling: plaza gets dedicated cleanup
// (stop proxy + release iframe) via closePlaza(); everything else via
// closeAllOverlays(). The redundant handler in plaza-download.ts was removed
// to avoid order-dependent cleanup being skipped.
const BACK_EXIT_INTERVAL_MS = 2000;
let _lastBackExitPress = 0;
Events.On('android:back', () => {
    // Was anything actually open? Must check BEFORE closing anything.
    const anyOverlayOpen =
        document.querySelector('[data-overlay].visible') !== null ||
        document.querySelector('.mmd-dialog-visible') !== null;

    if (anyOverlayOpen) {
        // Plaza needs dedicated cleanup (stop proxy + release iframe);
        // closePlaza() internally calls closeAllOverlays().
        const plazaLayer = document.getElementById('webviewLayer');
        if (plazaLayer && plazaLayer.classList.contains('visible')) {
            closePlaza();
        } else {
            closeAllOverlays();
        }
        _lastBackExitPress = 0; // closing a panel resets the exit window
        return;
    }

    // Nothing open → double-back-to-exit
    const now = Date.now();
    if (now - _lastBackExitPress < BACK_EXIT_INTERVAL_MS) {
        window.wails?.exitApp?.();
        return;
    }
    _lastBackExitPress = now;
    showInfoToast(t('main.pressAgainToExit'), undefined, undefined, BACK_EXIT_INTERVAL_MS);
});

// Android 系统事件消费（ADR-017 A3-04）
// Java 端经 emitSystemEvent 转发 6 类事件；back/permissionGranted 已在上方消费，
// 此处补齐剩余 4 类：ScreenLocked/NetworkChanged/BatteryChanged/ThemeChanged。
// 仅 Android 平台注册，桌面端 Events.On 无副作用但避免无意义监听。

// 屏幕锁定 → 立即刷盘保存场景。
// 比 visibilitychange 更可靠：部分国产 ROM WebView 切后台 visibilityState 不变 hidden，
// 导致 cleanupAndFlushSave() 不触发；ScreenLocked 是原生广播，信号确切。
Events.On('android:ScreenLocked', () => {
    swallowError(saveSceneImmediate(true));
});

// 网络变化 → toast 提示（plaza 等在线功能依赖网络）
// payload: {"online":true|false}
Events.On('android:NetworkChanged', (ev: unknown) => {
    // Wails 事件对象：data 字段承载 Java 端 emitSystemEvent 的 JSON payload
    const data = (ev as { data?: { online?: boolean } } | null)?.data;
    const online = data?.online === true;
    if (online) {
        showInfoToast(t('main.networkOnline'));
    } else {
        showInfoToast(t('main.networkOffline'));
    }
});

// 电量变化 → 仅日志，暂不消费（预留扩展点，未来可低电量降级渲染）
// payload: {"level":int,"scale":int,"plugged":bool}
Events.On('android:BatteryChanged', (_ev: unknown) => {
    // no-op: 预留扩展点
});

// 主题变化 → 仅日志，暂不消费（预留扩展点，未来可跟随系统暗色模式）
// payload: {"nightMode":bool}
Events.On('android:ThemeChanged', (_ev: unknown) => {
    // no-op: 预留扩展点
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
