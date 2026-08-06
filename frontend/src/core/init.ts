// [doc:adr-102] init.ts — bootstrap orchestration (P4).
// Owns app initialization: static HTML text, scene init, env/UI state
// restore, Android storage-permission handling, and the top-level bootstrap()
// that wires dev-hooks / render-loop / events modules together.
// Pure Split-layer orchestrator: imports leaf/domain modules but is never
// imported by them (no cycle).
import { dom, setStatus, initHints, UIState, EnvState, formatError, uiState } from './config';
import { getUiAction } from './ui-action-bridge';
import { t } from './i18n/t';
import { translateGoError } from './i18n/goerr';
import { registerIconBundle } from './icons-bundle';
import { initI18n } from './i18n/locale';
import { GetConfig, CheckForUpdate, GetSystemA11ySettings } from './wails-bindings';
import { events, initRuntimeBridge } from './runtime-bridge';
import type { Unsubscribe } from './runtime-bridge';
import { isAndroidPlatform, isWebPlatform } from './platform';
import { getCapabilities, resolveBackend } from './backend';
// [doc:adr-238] 主题纯函数下沉 core/theme，不再经 menus
import { generateTextColors } from './theme';
import { SETTINGS_FONT_RESTORE } from './theme';
import { initRuntimeBadge, setBackendBadge } from './runtime-mode';
import { applyHudVisibility, disposeStatusBar } from './status-bar';
import { hexToRgb, rgbToString } from './color-helpers';
import { fireAndForget, swallowError } from './async';
import { showInfoToast } from './toast';
import { safeCallAsync } from './safe-call';
import {
    installGlobalErrorCapture,
    installLoggingPatch,
    uninstallLoggingPatch,
} from './ai/error-buffer';

// [doc:adr-238] initLibrary/refreshLibrary 经 scene-action-bridge 调用
import { getSceneAction } from './scene-action-bridge';

import { initShortcutDispatcher, loadKeyBindings } from './shortcut-registry';
import { setupE2ECapture } from './dev-hooks';
import { startRenderLoop, stopRenderLoop } from './render-loop';
import {
    registerEventHandlers,
    disposeEventHandlers,
    initDropHandler,
    showUpdateToast,
} from './events';
import { registerAppShortcuts } from './shortcut-app';
import { addDisposableListener } from './dom';
import { disposeOverlay2 } from './dialog';

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
// [doc:adr-244] init() 按职责拆 4 阶段：清理 / 早期基建 / 场景与库 / 状态恢复。
// 除 _initCleanup 外均 async——阶段内含 await 步骤（initI18n→initRuntimeBridge 硬依赖、
// initScene→showApp、restoreEnvState→tryRestoreLastScene 三条串行链），非 async 会竞态。

/** [doc:adr-244] 阶段 1：HMR 幂等清理（旧监听器 / overlay / status 定时器）。同步、无 await。 */
function _initCleanup(): void {
    // [adr:audit] 幂等清理入口：HMR 重跑 init 时先销毁旧监听器，避免重复绑定
    for (const d of _initDisposables) {
        d.dispose();
    }
    _initDisposables.length = 0;
    disposeEventHandlers();
    disposeOverlay2(); // 清理 showPrompt2 创建的双字段输入 overlay（HMR 幂等）
    disposeStatusBar(); // 清理 status 定时器（HMR 幂等）
}

/** [doc:adr-244] 阶段 2：早期基建（i18n / runtime 桥 / 错误捕获 / a11y / 快捷键 / 徽标）。 */
async function _initEarlyInfra(): Promise<void> {
    // 注册本地图标 bundle，使 iconify 离线可用
    registerIconBundle();
    await initI18n(); // [doc:adr-059] 在菜单渲染前确定语言并同步 <html lang>；[doc:perf] 异步预加载语言包
    // 桌面/Android 侧强制加载 @wailsio/runtime 并绑定 events 实例，必须先于任何
    // events.on(...) 订阅——否则 events 回落到 no-op WebEvents，Wails 后端事件
    // （ai:chunk/ai:done/ai:error、android:* 等）全部收不到，AI 流式会永久挂起。
    await initRuntimeBridge();
    // RuntimeEvents 订阅必须在 initRuntimeBridge() 之后注册——模块顶层求值时
    // _events 仍为 null 会静默落到一次性 WebEvents，导致事件收不到。
    registerRuntimeEventHandlers();
    // [doc:adr-196] 启动早期安装 AI 诊断上下文采集：先 patch console.error 使所有
    // console.error（含 @/core/logger 的 logError）自动入环，再注册全局未捕获异常监听。
    // disposer 纳入 _initDisposables，HMR 重跑 init 时幂等清理旧监听器、重新安装。
    installLoggingPatch();
    const _aiErrDisposer = installGlobalErrorCapture();
    _initDisposables.push({
        dispose() {
            _aiErrDisposer();
            uninstallLoggingPatch();
        },
    });
    _applySystemA11y(); // [doc:adr-153] 启动时应用系统无障碍设置（暗色/高对比度）
    _updateStaticHtmlTexts(); // 更新 HTML 模板中的硬编码文案
    initRuntimeBadge(); // [adr-099] 立即渲染持久化的运行时模式徽标（刷新不丢）
    registerEventHandlers(); // [adr-102] P3: 全局 DOM/window 监听器迁至 events.ts
    // [doc:adr-238] buildNavMaps 下沉 menus/nav-actions，由 initNavActions 驱动
    // Register keyboard shortcuts via ShortcutRegistry
    registerAppShortcuts();
    initShortcutDispatcher();
    setStatus(t('main.initializing'), false);
    // [doc:adr-177] Phase 2 A5：web 入口预热 capabilities 缓存
    // web 入口短路快，await 无延迟；桌面 fallback 全 true 已正确，无需阻塞。
    // Android 必须预热：缺少真实 capabilities 时 ALL_TRUE_CAPS 的 fsSelectDir=true
    // 会误导 settings-resources 走桌面路径，隐藏私有/共享存储切换 UI。
    if (isWebPlatform()) {
        await getCapabilities();
    } else if (isAndroidPlatform()) {
        // Android 异步预热，不阻塞首屏（awaitWailsBridge 最长 3s）
        fireAndForget(async () => {
            await getCapabilities();
        });
    }
    // [doc:adr-176] 后台解析后端并把实际选中的 kind（go/browser）写进运行时徽标，
    // 不阻塞首屏渲染；消除「网页壳参杂 Go 逻辑」的歧义（9245 等 webview 场景一眼可辨）。
    fireAndForget(async () => {
        const b = await resolveBackend();
        setBackendBadge(b.kind);
    });
}

/** [doc:adr-244] 阶段 3：场景与库初始化（drop / scene / library / auto-import）。 */
async function _initScenePhase(): Promise<void> {
    // [doc:adr-238] 导航按钮接线下沉 menus/nav-actions（initNavActions 由 initLibrary
    // 启动链驱动），本层不再直接 import menus 弹窗函数或注册按钮监听。

    initDropHandler(); // 拖拽导入处理不依赖场景初始化

    // [doc:adr-238] 桥注册守卫：initScene 经 scene/scene 注册，依赖 render-loop 静态边
    // 加载（ADR-238 §2.5 结构性保留）。未注册时场景静默不初始化，此处显式校验。
    if (!getSceneAction('initScene')) {
        console.warn('[init] initScene bridge 未注册——场景可能不会初始化');
    }
    await getSceneAction('initScene')?.();
    // 引擎就绪 → 隐藏加载遮罩，显示主应用 UI
    dom.showApp();
    console.info('MikuMikuAR initialized');
    // [doc:adr-238] 桥注册守卫：initLibrary 经 menus/library-setup 动态链注册，
    // 未注册时模型库永不初始化（静默失败），此处显式校验。
    if (!getSceneAction('initLibrary')) {
        console.warn('[init] initLibrary bridge 未注册——模型库可能不会初始化');
    }
    safeCallAsync('init', 'Library init', () => getSceneAction('initLibrary')?.());
    // [doc:adr-008] 启动时预加载自动导入开关，供 watch:newfile 自动导入分支判定
    fireAndForget(async () => {
        // [doc:adr-238] preloadAutoImportState 经 ui-action-bridge 调用（settings-shared 注册）
        swallowError(getUiAction('preloadAutoImportState')?.() ?? Promise.resolve());
    });
}

/** [doc:adr-244] 阶段 4：状态恢复（env / UI / HUD / 更新检查 / 场景恢复）。 */
async function _initRestorePhase(): Promise<void> {
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
                showUpdateToast(r.latest, r.url, r.downloadUrl || undefined);
            }
        }).catch((err) => {
            console.error('[init] update toast failed:', err);
        });
    }
    // Sync module-level state from persisted envState
    getSceneAction('syncTimeOfDayFromEnv')?.();
    getSceneAction('restoreAutoCameraState')?.();
    // Auto-restore last scene after library + scene init (env already restored above)
    safeCallAsync('init', 'Auto-restore', () => getSceneAction('tryRestoreLastScene')?.());
}

async function init(): Promise<void> {
    try {
        _initCleanup();
        await _initEarlyInfra();
        await _initScenePhase();
        await _initRestorePhase();
    } catch (err) {
        console.error('Init failed:', err);
        const msg = translateGoError(err);
        dom.showError(msg);
        setStatus(t('main.initFailed'), false);
        // [audit:round13 P3] 失败回滚：bootstrap() 在 init() 之前已 startRenderLoop()，
        // 若 init 中途抛错，渲染循环/事件监听/AI 错误捕获/console 补丁/runtime 事件订阅
        // 会残留运行在未初始化完成的场景上。此处统一释放，避免半初始化状态。
        for (const d of _initDisposables) {
            try {
                d.dispose();
            } catch (e) {
                console.warn('[init] dispose on failed init:', e);
            }
        }
        _initDisposables.length = 0;
        try {
            disposeEventHandlers();
        } catch (e) {
            console.warn('[init] disposeEventHandlers on failed init:', e);
        }
        stopRenderLoop();
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
            'groundVisibleEnabled:',
            loaded.groundVisibleEnabled,
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
        // 向后兼容：旧配置缺少镜面几何参数时补默认值（与 env-state-schema.ts mirror 组一致）。
        // Go 端 EnvState 已补齐 mirrorWidth/mirrorHeight/mirrorPosition/mirrorRotationY 字段
        // （持久化收口）；此处兜底仅针对修复前的旧 config.json（字段缺失/零值）。
        // width/height 合法最小值 0.5（setMirrorSize 下限），<=0 判定零值缺省无歧义；
        // position 为指针+omitempty，缺失时 undefined，不误伤用户真正设置的 [0,0,0]。
        if (loaded.mirrorWidth === undefined || loaded.mirrorWidth <= 0) {
            loaded.mirrorWidth = 18;
        }
        if (loaded.mirrorHeight === undefined || loaded.mirrorHeight <= 0) {
            loaded.mirrorHeight = 21;
        }
        if (loaded.mirrorPosition === undefined) {
            loaded.mirrorPosition = [0, 1.5, 8];
        }
        if (loaded.mirrorRotationY === undefined) {
            loaded.mirrorRotationY = 0;
        }
        // 向后兼容：旧配置缺少粒子字段时补默认值
        if (loaded.particleEnabled === undefined) {
            loaded.particleEnabled = false;
            loaded.particleType = 'none';
            loaded.particleEmitRate = 1;
            loaded.particleSize = 1;
            loaded.particleSpeed = 1;
            loaded.particleSplashEnabled = false;
            loaded.particleCustomTexture = '';
        }
        // 用 setEnvState 替代 Object.assign + applyEnvState，确保：
        // 1. migrateEnvState 处理旧字段转换（如 groundMode → groundType+groundStyle）
        // 2. reactive 状态通过 Proxy 正确通知 UI 刷新
        // 3. _applyEnvStateFacade 精确控制各子系统应用（避免 applyEnvState 的全量无条件重建）
        // 4. 抑制 auto-save，防止恢复过程中触发级联保存
        // [audit:round13 P3] try/finally：setEnvState 抛错（如某子系统应用失败）时
        // 也必须恢复 auto-save 抑制，否则整个应用 auto-save 永久关闭（静默数据丢失）。
        try {
            getSceneAction('setSuppressAutoSave')?.(true);
            getSceneAction('setEnvState')?.(loaded, true);
        } finally {
            // 丢弃恢复阶段触发的 env 防抖写入（setEnvState 的 skipAutoSave 只跳过
            // triggerAutoSave，不跳过 _envPersistTimer）。若不取消，500ms 后会把
            // 刚恢复的值写回 config.json，在 LoadLastScene 延迟超过 500ms 的极端
            // 时序下会写入默认值，污染下次启动的恢复源。见 buglog 2026-07-16 教训3。
            getSceneAction('cancelEnvPersistTimer')?.();
            getSceneAction('setSuppressAutoSave')?.(false);
        }
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
        getSceneAction('setPerformanceMode')?.(s.performanceMode);
    } else if (isAndroidPlatform()) {
        getSceneAction('setPerformanceMode')?.('balanced');
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
    // frameCapEnabled 由 Go UnmarshalJSON 兼容旧 "vsync" key
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
            installApk?: (path: string) => void;
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

    // [audit:round13 P3] window.wails 可能未注入（Android 浏览器 dev 模式 / 后端未就绪），
    // 非空断言会抛 TypeError 中断存储权限流程；改为可选访问 + 守卫。
    const w = window.wails;
    if (w && typeof w.hasStoragePermission === 'function' && !w.hasStoragePermission()) {
        androidStoragePromptShown = true;
        if (typeof w.requestStoragePermission === 'function') {
            setStatus(t('main.needFileAccess'), true);
            w.requestStoragePermission();
        }
    }
}

// When the native side reports a fresh grant, rescan the library.
// [fix:audit] RuntimeEvents 订阅全部收敛到 registerRuntimeEventHandlers()：
// - 原模块顶层 events.on 在 initRuntimeBridge() 之前求值，_events 仍为 null，
//   会静默落到一次性 WebEvents（no-op），桌面/Android 事件全部收不到；
// - 现在由 init() 在 await initRuntimeBridge() 之后调用，并保存 unsubscribe
//   到 _initDisposables，HMR 重跑 init() 时幂等清理。
function registerRuntimeEventHandlers(): void {
    const track = (unsub: Unsubscribe): void => {
        _initDisposables.push({ dispose: unsub });
    };

    track(
        events.on('storage:permissionGranted', async () => {
            setStatus(t('main.permissionGranted'), false);
            try {
                await getSceneAction('refreshLibrary')?.();
                setStatus(t('main.libraryRefreshed'), false);
            } catch (err) {
                console.error('refreshLibrary after permission grant:', err);
                setStatus(t('main.libraryRefreshFailed') + formatError(err), true);
            }
        })
    );

    // Android back gesture → close overlays first; double-back to exit (ADR-017 A2-02).
    // Single source of truth for back handling: plaza gets dedicated cleanup
    // (stop proxy + release iframe) via closePlaza(); everything else via
    // closeAllOverlays(). The redundant handler in plaza-download.ts was removed
    // to avoid order-dependent cleanup being skipped.
    const BACK_EXIT_INTERVAL_MS = 2000;
    let _lastBackExitPress = 0;
    track(
        events.on('android:back', () => {
            // [doc:adr-238] 菜单/遮罩优先处理下沉 menus/nav-actions（经 ui-action-bridge）；
            // 本层只保留「无菜单可关 → 二次返回退出」逻辑。
            const handled = getUiAction('handleAndroidBack')?.() ?? false;
            if (handled) {
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
        })
    );

    // Android 系统事件消费（ADR-017 A3-04）
    // Java 端经 emitSystemEvent 转发 6 类事件；back/permissionGranted 已在上方消费，
    // 此处补齐剩余 4 类：ScreenLocked/NetworkChanged/BatteryChanged/ThemeChanged。
    // 仅 Android 平台注册，桌面端 Events.On 无副作用但避免无意义监听。

    // 屏幕锁定 → 立即刷盘保存场景。
    // 比 visibilitychange 更可靠：部分国产 ROM WebView 切后台 visibilityState 不变 hidden，
    // 导致 cleanupAndFlushSave() 不触发；ScreenLocked 是原生广播，信号确切。
    track(
        events.on('android:ScreenLocked', () => {
            swallowError(getSceneAction('saveSceneImmediate')?.() ?? Promise.resolve());
        })
    );

    // 网络变化 → toast 提示（plaza 等在线功能依赖网络）
    // payload: {"online":true|false}
    track(
        events.on('android:NetworkChanged', (ev: unknown) => {
            // Wails 事件对象：data 字段承载 Java 端 emitSystemEvent 的 JSON payload
            const data = (ev as { data?: { online?: boolean } } | null)?.data;
            const online = data?.online === true;
            if (online) {
                showInfoToast(t('main.networkOnline'));
            } else {
                showInfoToast(t('main.networkOffline'));
            }
        })
    );

    // 电量变化 → 仅日志，暂不消费（预留扩展点，未来可低电量降级渲染）
    // payload: {"level":int,"scale":int,"plugged":bool}
    track(
        events.on('android:BatteryChanged', (_ev: unknown) => {
            // no-op: 预留扩展点
        })
    );

    // 主题变化 → 仅日志，暂不消费（预留扩展点，未来可跟随系统暗色模式）
    // payload: {"nightMode":bool}
    track(
        events.on('android:ThemeChanged', (_ev: unknown) => {
            // no-op: 预留扩展点
        })
    );

    // [doc:adr-179] APK 安装失败回传（Java installApk → emitEvent）
    // payload: {"error":"..."}
    track(
        events.on('update:installFailed', (ev: unknown) => {
            const data = (ev as { data?: { error?: string } } | null)?.data;
            showInfoToast(data?.error || t('settings.about.update.downloadFailed'));
        })
    );
}

// ======== Bootstrap ========
// Wires dev-hooks / render-loop / events modules and starts the app.
/** 应用启动入口：接线 dev-hooks / render-loop / events 并启动渲染循环。 */
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
