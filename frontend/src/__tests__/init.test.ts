// init.test.ts — 应用 bootstrap 初始化模块单测（ADR-102 / ADR-244）
// 覆盖 bootstrap() 启动接线、init() 4 阶段编排（清理/早期基建/场景与库/状态恢复）、
// restoreEnvState 旧配置默认值补齐、restoreUIState 持久化恢复、Android 存储权限
// 守卫、registerRuntimeEventHandlers 运行时事件订阅（权限授予/返回键/系统事件）。
// 全部依赖模块 vi.mock（相对测试文件路径 '../core/xxx'），Babylon 引擎零实例化。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    const eventHandlers: Record<string, (...args: unknown[]) => unknown> = {};
    const sceneActions: Record<string, unknown> = {};
    const uiActions: Record<string, unknown> = {};
    return {
        eventHandlers,
        sceneActions,
        uiActions,
        dom: { showApp: vi.fn(), showError: vi.fn() },
        uiState: {} as Record<string, unknown>,
        events: {
            on: vi.fn((name: string, cb: (...args: unknown[]) => unknown) => {
                eventHandlers[name] = cb;
                return () => {};
            }),
        },
        setStatus: vi.fn(),
        initHints: vi.fn(),
        formatError: vi.fn((e: unknown) => String(e)),
        t: vi.fn((key: string) => `t:${key}`),
        translateGoError: vi.fn((e: unknown) => `translated:${String(e)}`),
        registerIconBundle: vi.fn(),
        initI18n: vi.fn(async () => {}),
        GetConfig: vi.fn(async () => ({})),
        CheckForUpdate: vi.fn(async () => null),
        GetSystemA11ySettings: vi.fn(async () => ({ isDarkMode: false, isHighContrast: false })),
        initRuntimeBridge: vi.fn(async () => {}),
        isAndroidPlatform: vi.fn(() => false),
        isWebPlatform: vi.fn(() => false),
        getCapabilities: vi.fn(async () => ({})),
        resolveBackend: vi.fn(async () => ({ kind: 'go' })),
        generateTextColors: vi.fn(() => ({
            bright: 'rgb(255,255,255)',
            dim: 'rgb(200,200,200)',
            muted: 'rgb(150,150,150)',
        })),
        SETTINGS_FONT_RESTORE: { system: "'Segoe UI', sans-serif", noto: "'Noto Sans', sans-serif" },
        initRuntimeBadge: vi.fn(),
        setBackendBadge: vi.fn(),
        applyHudVisibility: vi.fn(),
        disposeStatusBar: vi.fn(),
        hexToRgb: vi.fn(() => ({ r: 255, g: 255, b: 255 })),
        rgbToString: vi.fn(() => 'rgb(255,255,255)'),
        fireAndForget: vi.fn((fn: () => Promise<unknown>) => {
            Promise.resolve(fn()).catch(() => {});
        }),
        swallowError: vi.fn((p: Promise<unknown>) => {
            p.catch(() => {});
        }),
        showInfoToast: vi.fn(),
        safeCallAsync: vi.fn(
            async (_tag: string, _msg: string, fn: () => unknown) =>
                typeof fn === 'function' ? fn() : undefined
        ),
        installGlobalErrorCapture: vi.fn(() => () => {}),
        installLoggingPatch: vi.fn(),
        uninstallLoggingPatch: vi.fn(),
        getSceneAction: vi.fn((key: string) => sceneActions[key]),
        getUiAction: vi.fn((key: string) => uiActions[key]),
        initShortcutDispatcher: vi.fn(),
        loadKeyBindings: vi.fn(),
        setupE2ECapture: vi.fn(),
        startRenderLoop: vi.fn(),
        registerEventHandlers: vi.fn(),
        disposeEventHandlers: vi.fn(),
        initDropHandler: vi.fn(),
        showUpdateToast: vi.fn(),
        registerAppShortcuts: vi.fn(),
        addDisposableListener: vi.fn(() => ({ dispose: vi.fn() })),
        disposeOverlay2: vi.fn(),
    };
});

vi.mock('../core/config', () => ({
    dom: shared.dom,
    uiState: shared.uiState,
    setStatus: shared.setStatus,
    initHints: shared.initHints,
    formatError: shared.formatError,
}));
vi.mock('../core/ui-action-bridge', () => ({ getUiAction: shared.getUiAction }));
vi.mock('../core/i18n/t', () => ({ t: shared.t }));
vi.mock('../core/i18n/goerr', () => ({ translateGoError: shared.translateGoError }));
vi.mock('../core/icons-bundle', () => ({ registerIconBundle: shared.registerIconBundle }));
vi.mock('../core/i18n/locale', () => ({ initI18n: shared.initI18n }));
vi.mock('../core/wails-bindings', () => ({
    GetConfig: shared.GetConfig,
    CheckForUpdate: shared.CheckForUpdate,
    GetSystemA11ySettings: shared.GetSystemA11ySettings,
}));
vi.mock('../core/runtime-bridge', () => ({
    events: shared.events,
    initRuntimeBridge: shared.initRuntimeBridge,
}));
vi.mock('../core/platform', () => ({
    isAndroidPlatform: shared.isAndroidPlatform,
    isWebPlatform: shared.isWebPlatform,
}));
vi.mock('../core/backend', () => ({
    getCapabilities: shared.getCapabilities,
    resolveBackend: shared.resolveBackend,
}));
vi.mock('../core/theme', () => ({
    generateTextColors: shared.generateTextColors,
    SETTINGS_FONT_RESTORE: shared.SETTINGS_FONT_RESTORE,
}));
vi.mock('../core/runtime-mode', () => ({
    initRuntimeBadge: shared.initRuntimeBadge,
    setBackendBadge: shared.setBackendBadge,
}));
vi.mock('../core/status-bar', () => ({
    applyHudVisibility: shared.applyHudVisibility,
    disposeStatusBar: shared.disposeStatusBar,
}));
vi.mock('../core/color-helpers', () => ({
    hexToRgb: shared.hexToRgb,
    rgbToString: shared.rgbToString,
}));
vi.mock('../core/async', () => ({
    fireAndForget: shared.fireAndForget,
    swallowError: shared.swallowError,
}));
vi.mock('../core/toast', () => ({ showInfoToast: shared.showInfoToast }));
vi.mock('../core/safe-call', () => ({ safeCallAsync: shared.safeCallAsync }));
vi.mock('../core/ai/error-buffer', () => ({
    installGlobalErrorCapture: shared.installGlobalErrorCapture,
    installLoggingPatch: shared.installLoggingPatch,
    uninstallLoggingPatch: shared.uninstallLoggingPatch,
}));
vi.mock('../core/scene-action-bridge', () => ({ getSceneAction: shared.getSceneAction }));
vi.mock('../core/shortcut-registry', () => ({
    initShortcutDispatcher: shared.initShortcutDispatcher,
    loadKeyBindings: shared.loadKeyBindings,
}));
vi.mock('../core/dev-hooks', () => ({ setupE2ECapture: shared.setupE2ECapture }));
vi.mock('../core/render-loop', () => ({
    startRenderLoop: shared.startRenderLoop,
    stopRenderLoop: vi.fn(),
}));
vi.mock('../core/events', () => ({
    registerEventHandlers: shared.registerEventHandlers,
    disposeEventHandlers: shared.disposeEventHandlers,
    initDropHandler: shared.initDropHandler,
    showUpdateToast: shared.showUpdateToast,
}));
vi.mock('../core/shortcut-app', () => ({ registerAppShortcuts: shared.registerAppShortcuts }));
vi.mock('../core/dom', () => ({
    addDisposableListener: shared.addDisposableListener,
}));
vi.mock('../core/dialog', () => ({ disposeOverlay2: shared.disposeOverlay2 }));

import { bootstrap } from '../core/init';

/** 冲刷微任务链（init → 4 阶段 → fireAndForget 回调均挂 Promise）。 */
async function flushPromises(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        await Promise.resolve();
    }
}

/** 跑完 init 全链 + bootstrap 的 1500ms 权限延时（fake timers 下安全落定时器）。 */
async function bootAndSettle(): Promise<void> {
    bootstrap();
    await flushPromises();
    vi.advanceTimersByTime(2000);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    shared.GetConfig.mockResolvedValue({});
    shared.CheckForUpdate.mockResolvedValue(null);
    shared.GetSystemA11ySettings.mockResolvedValue({ isDarkMode: false, isHighContrast: false });
    shared.isAndroidPlatform.mockReturnValue(false);
    shared.isWebPlatform.mockReturnValue(false);
    shared.resolveBackend.mockResolvedValue({ kind: 'go' });
    shared.uiState.autoUpdateEnabled = false;
    for (const k of Object.keys(shared.sceneActions)) {
        delete shared.sceneActions[k];
    }
    for (const k of Object.keys(shared.uiActions)) {
        delete shared.uiActions[k];
    }
    for (const k of Object.keys(shared.eventHandlers)) {
        delete shared.eventHandlers[k];
    }
    const root = document.documentElement;
    delete root.dataset.theme;
    delete root.dataset.highContrast;
    root.style.cssText = '';
    window.wails = undefined;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('bootstrap（应用启动入口）', () => {
    it('正常：接线 dev-hooks / render-loop / events 并走完 init 全链', async () => {
        await bootAndSettle();
        expect(shared.initHints).toHaveBeenCalled();
        expect(shared.setupE2ECapture).toHaveBeenCalled();
        expect(shared.startRenderLoop).toHaveBeenCalled();
        expect(shared.registerEventHandlers).toHaveBeenCalled();
        expect(shared.registerAppShortcuts).toHaveBeenCalled();
        expect(shared.initShortcutDispatcher).toHaveBeenCalled();
        expect(shared.initRuntimeBadge).toHaveBeenCalled();
        expect(shared.applyHudVisibility).toHaveBeenCalled();
        expect(shared.dom.showApp).toHaveBeenCalled();
        expect(shared.setStatus).toHaveBeenCalled();
        expect(shared.setBackendBadge).toHaveBeenCalledWith('go');
        expect(shared.disposeEventHandlers).toHaveBeenCalled(); // _initCleanup
        expect(shared.disposeOverlay2).toHaveBeenCalled();
        expect(shared.disposeStatusBar).toHaveBeenCalled();
    });

    it('守卫：initI18n 抛错 → 整体降级 showError + setStatus 失败态', async () => {
        shared.initI18n.mockRejectedValueOnce(new Error('i18n boom'));
        bootstrap();
        await flushPromises();
        expect(shared.translateGoError).toHaveBeenCalled();
        expect(shared.dom.showError).toHaveBeenCalledWith('translated:Error: i18n boom');
        expect(shared.setStatus).toHaveBeenCalledWith('t:main.initFailed', false);
    });
});

describe('init 早期基建（_initEarlyInfra）', () => {
    it('正常：web 平台预热 capabilities + 系统无障碍设置应用', async () => {
        shared.isWebPlatform.mockReturnValue(true);
        shared.GetSystemA11ySettings.mockResolvedValue({ isDarkMode: true, isHighContrast: true });
        await bootAndSettle();
        expect(shared.getCapabilities).toHaveBeenCalled();
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(document.documentElement.dataset.highContrast).toBe('true');
    });

    it('正常：Android 平台 capabilities 异步预热（不阻塞首屏）', async () => {
        shared.isAndroidPlatform.mockReturnValue(true);
        window.wails = { hasStoragePermission: vi.fn(() => true) };
        await bootAndSettle();
        expect(shared.getCapabilities).toHaveBeenCalled();
    });

    it('守卫：HMR 幂等清理复用旧监听器（_initDisposables dispose 被调用）', async () => {
        const disposer = vi.fn();
        shared.installGlobalErrorCapture.mockReturnValue(disposer);
        await bootAndSettle();
        // 第二次 bootstrap → _initCleanup 触发旧 disposer
        await bootAndSettle();
        expect(disposer).toHaveBeenCalled();
        expect(shared.uninstallLoggingPatch).toHaveBeenCalled();
    });
});

describe('场景与库阶段（_initScenePhase）', () => {
    it('守卫：initScene / initLibrary 桥未注册 → console.warn 提示', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await bootAndSettle();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('initScene bridge 未注册')
        );
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('initLibrary bridge 未注册')
        );
        warn.mockRestore();
    });

    it('正常：桥已注册 → 按序执行 initScene / initLibrary / 预载自动导入', async () => {
        const initScene = vi.fn(async () => {});
        const initLibrary = vi.fn(async () => {});
        const preload = vi.fn(async () => {});
        shared.sceneActions['initScene'] = initScene;
        shared.sceneActions['initLibrary'] = initLibrary;
        shared.uiActions['preloadAutoImportState'] = preload;
        await bootAndSettle();
        expect(initScene).toHaveBeenCalled();
        expect(initLibrary).toHaveBeenCalled();
        expect(preload).toHaveBeenCalled();
    });
});

describe('restoreEnvState（环境状态恢复 + 旧配置默认值补齐）', () => {
    it('正常：cfg.env 存在 → 补齐全部旧配置默认值并走 setEnvState', async () => {
        const setEnvState = vi.fn();
        const setSuppress = vi.fn();
        const cancelTimer = vi.fn();
        shared.sceneActions['setEnvState'] = setEnvState;
        shared.sceneActions['setSuppressAutoSave'] = setSuppress;
        shared.sceneActions['cancelEnvPersistTimer'] = cancelTimer;
        shared.GetConfig.mockResolvedValue({ env: { skyMode: 'sun' } });

        await bootAndSettle();

        expect(setSuppress).toHaveBeenCalledWith(true);
        expect(cancelTimer).toHaveBeenCalled();
        expect(setSuppress).toHaveBeenCalledWith(false);
        expect(setEnvState).toHaveBeenCalledTimes(1);
        const loaded = setEnvState.mock.calls[0][0] as Record<string, unknown>;
        expect(setEnvState.mock.calls[0][1]).toBe(true); // skipAutoSave
        // 水面默认值组
        expect(loaded.fresnelBias).toBe(0.02);
        expect(loaded.fresnelPower).toBe(3.0);
        expect(loaded.diffuseStrength).toBe(0.15);
        expect(loaded.rippleGlintStrength).toBe(0.25);
        expect(loaded.causticColor1).toEqual([1.0, 0.9, 0.6]);
        expect(loaded.fresnelAlphaInfluence).toBe(0.5);
        // 地面 / 反射 / 镜面 / 粒子默认值
        expect(loaded.groundSize).toBe(60);
        expect(loaded.groundEdgeFade).toBe(0);
        expect(loaded.reflectionQuality).toBe('off');
        expect(loaded.mirrorWidth).toBe(18);
        expect(loaded.mirrorHeight).toBe(21);
        expect(loaded.mirrorPosition).toEqual([0, 1.5, 8]);
        expect(loaded.mirrorRotationY).toBe(0);
        expect(loaded.particleEnabled).toBe(false);
        expect(loaded.particleType).toBe('none');
        expect(loaded.particleCustomTexture).toBe('');
    });

    it('边界：cfg.env 已含高级参数 → 不覆盖用户设定值', async () => {
        const setEnvState = vi.fn();
        shared.sceneActions['setEnvState'] = setEnvState;
        shared.GetConfig.mockResolvedValue({
            env: {
                skyMode: 'sun',
                fresnelBias: 0.5,
                groundSize: 100,
                groundEdgeFade: 0.3,
                reflectionQuality: 'high',
                mirrorWidth: 10,
                mirrorHeight: 12,
                mirrorPosition: [1, 2, 3],
                mirrorRotationY: 1,
                particleEnabled: true,
            },
        });

        await bootAndSettle();

        const loaded = setEnvState.mock.calls[0][0] as Record<string, unknown>;
        expect(loaded.fresnelBias).toBe(0.5);
        expect(loaded.groundSize).toBe(100);
        expect(loaded.groundEdgeFade).toBe(0.3);
        expect(loaded.reflectionQuality).toBe('high');
        expect(loaded.mirrorWidth).toBe(10);
        expect(loaded.mirrorPosition).toEqual([1, 2, 3]);
        expect(loaded.particleEnabled).toBe(true);
    });

    it('边界：cfg.env 为 null → 跳过环境恢复', async () => {
        const setEnvState = vi.fn();
        shared.sceneActions['setEnvState'] = setEnvState;
        shared.GetConfig.mockResolvedValue({ env: null });
        await bootAndSettle();
        expect(setEnvState).not.toHaveBeenCalled();
    });
});

describe('restoreUIState（UI 状态持久化恢复）', () => {
    it('正常：完整 ui_state → CSS 变量 + uiState 字段 + 原生窗口调用', async () => {
        shared.uiState.renderScale = 1;
        shared.GetConfig.mockResolvedValue({
            ui_state: {
                scale: 1.2,
                popupWidth: 400,
                accent: '#ff0000',
                fontFamily: 'noto',
                animations: false,
                blurBg: true,
                performanceMode: 'high',
                autoUpdateEnabled: true,
                keepAwake: false,
                screenOrientation: 'landscape',
                fpsLimit: 60,
                defaultPhysicsEnabled: true,
                renderScale: 0.8,
                cameraSensitivity: 1.5,
                invertYAxis: true,
                autoScaleModel: true,
                autoCenterModel: true,
                materialCategoryMap: { metal: 'pbr' },
                screenshotFormat: 'png',
                screenshotQuality: 90,
                thumbnailResolution: '256',
                screenshotDir: '/tmp/shots',
                resourceViewMode: 'grid',
                volume: 0.7,
                audioOffset: 0.1,
                bpmQuantizeEnabled: true,
                autoLoadCompanionAudio: true,
                sfxEnabled: true,
                sfxVolume: 0.5,
                footstepEnabled: true,
                footstepVolume: 0.3,
                keyBindings: { moveForward: { key: 'w' } },
                showFpsClock: true,
                showRuntimeBadge: true,
            },
        });
        const setKeepAwake = vi.fn();
        const setScreenOrientation = vi.fn();
        shared.sceneActions['setPerformanceMode'] = vi.fn();
        window.wails = { setKeepAwake, setScreenOrientation };

        await bootAndSettle();

        const style = document.documentElement.style;
        expect(style.getPropertyValue('--ui-scale')).toBe('1.2');
        expect(style.getPropertyValue('--popup-width')).toBe('400px');
        expect(style.getPropertyValue('--accent')).toBe('#ff0000');
        expect(style.getPropertyValue('--accent-rgb')).toBe('rgb(255,255,255)');
        expect(style.getPropertyValue('--accent-dim')).toBe('#ff000033');
        expect(style.getPropertyValue('--text-bright')).toBe('rgb(255,255,255)');
        expect(style.getPropertyValue('--font')).toBe("'Noto Sans', sans-serif");
        expect(style.getPropertyValue('--ui-animations')).toBe('0');
        expect(style.getPropertyValue('--ui-blur')).toBe('1');
        // uiState 会话字段恢复
        expect(shared.uiState.autoUpdateEnabled).toBe(true);
        expect(shared.uiState.keepAwake).toBe(false);
        expect(shared.uiState.screenOrientation).toBe('landscape');
        expect(shared.uiState.fpsLimit).toBe(60);
        expect(shared.uiState.renderScale).toBe(0.8);
        expect(shared.uiState.cameraSensitivity).toBe(1.5);
        expect(shared.uiState.invertYAxis).toBe(true);
        expect(shared.uiState.defaultPhysicsEnabled).toBe(true);
        expect(shared.uiState.screenshotFormat).toBe('png');
        expect(shared.uiState.resourceViewMode).toBe('grid');
        expect(shared.uiState.volume).toBe(0.7);
        expect(shared.uiState.sfxEnabled).toBe(true);
        expect(shared.uiState.footstepVolume).toBe(0.3);
        expect(shared.uiState.showFpsClock).toBe(true);
        expect(shared.uiState.showRuntimeBadge).toBe(true);
        expect(shared.loadKeyBindings).toHaveBeenCalledWith({ moveForward: { key: 'w' } });
        expect(shared.sceneActions['setPerformanceMode']).toHaveBeenCalledWith('high');
        // 原生窗口调用
        expect(setKeepAwake).toHaveBeenCalledWith(false);
        expect(setScreenOrientation).toHaveBeenCalledWith('landscape');
    });

    it('边界：无 ui_state → 直接返回，不动 CSS 变量', async () => {
        shared.GetConfig.mockResolvedValue({ ui_state: null });
        await bootAndSettle();
        expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('');
        expect(shared.loadKeyBindings).not.toHaveBeenCalled();
    });

    it('正常：Android 首次启动无 performanceMode → 默认 balanced', async () => {
        shared.isAndroidPlatform.mockReturnValue(true);
        shared.sceneActions['setPerformanceMode'] = vi.fn();
        window.wails = { hasStoragePermission: vi.fn(() => true) };
        shared.GetConfig.mockResolvedValue({ ui_state: { scale: 1 } });
        await bootAndSettle();
        expect(shared.sceneActions['setPerformanceMode']).toHaveBeenCalledWith('balanced');
    });
});

describe('更新检查（_initRestorePhase）', () => {
    it('正常：autoUpdateEnabled → 检测到新版本显示更新 toast', async () => {
        shared.uiState.autoUpdateEnabled = true;
        shared.CheckForUpdate.mockResolvedValue({
            available: true,
            url: 'https://example.com/dl',
            latest: '2.0.0',
            downloadUrl: 'https://example.com/pkg',
        });
        await bootAndSettle();
        expect(shared.CheckForUpdate).toHaveBeenCalled();
        expect(shared.showUpdateToast).toHaveBeenCalledWith(
            '2.0.0',
            'https://example.com/dl',
            'https://example.com/pkg'
        );
    });

    it('守卫：检测到无更新 → 不弹 toast', async () => {
        shared.uiState.autoUpdateEnabled = true;
        shared.CheckForUpdate.mockResolvedValue({ available: false, url: '', latest: '2.0.0' });
        await bootAndSettle();
        expect(shared.showUpdateToast).not.toHaveBeenCalled();
    });

    it('守卫：CheckForUpdate 抛错 → 走 .catch 记 console.error', async () => {
        shared.uiState.autoUpdateEnabled = true;
        shared.CheckForUpdate.mockRejectedValue(new Error('network down'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await bootAndSettle();
        expect(error).toHaveBeenCalledWith('[init] update toast failed:', expect.any(Error));
        error.mockRestore();
    });
});

describe('checkAndroidStoragePermission（Android 存储权限）', () => {
    it('守卫：非 Android 平台直接返回', async () => {
        const request = vi.fn();
        window.wails = { hasStoragePermission: vi.fn(() => false), requestStoragePermission: request };
        shared.isAndroidPlatform.mockReturnValue(false);
        await bootAndSettle();
        expect(request).not.toHaveBeenCalled();
    });

    it('正常：无权限 → 提示并请求；已提示过不重复请求', async () => {
        const request = vi.fn();
        window.wails = {
            hasStoragePermission: vi.fn(() => false),
            requestStoragePermission: request,
        };
        shared.isAndroidPlatform.mockReturnValue(true);

        await bootAndSettle();
        expect(request).toHaveBeenCalledTimes(1);
        expect(shared.setStatus).toHaveBeenCalledWith('t:main.needFileAccess', true);

        // 第二次 bootstrap：androidStoragePromptShown 已置位 → 守卫跳过
        request.mockClear();
        shared.setStatus.mockClear();
        await bootAndSettle();
        expect(request).not.toHaveBeenCalled();
    });

    it('正常：已有权限 → 不请求', async () => {
        const request = vi.fn();
        window.wails = {
            hasStoragePermission: vi.fn(() => true),
            requestStoragePermission: request,
        };
        shared.isAndroidPlatform.mockReturnValue(true);
        await bootAndSettle();
        expect(request).not.toHaveBeenCalled();
    });
});

describe('registerRuntimeEventHandlers（运行时事件订阅）', () => {
    async function bootstrapWithHandlers(): Promise<void> {
        bootstrap();
        await flushPromises();
    }

    it('正常：storage:permissionGranted → 刷新库成功', async () => {
        const refreshLibrary = vi.fn(async () => {});
        shared.sceneActions['refreshLibrary'] = refreshLibrary;
        await bootstrapWithHandlers();
        await shared.eventHandlers['storage:permissionGranted']();
        expect(shared.setStatus).toHaveBeenCalledWith('t:main.permissionGranted', false);
        expect(shared.setStatus).toHaveBeenCalledWith('t:main.libraryRefreshed', false);
    });

    it('守卫：storage:permissionGranted 刷新库失败 → 错误状态', async () => {
        const refreshLibrary = vi.fn(async () => {
            throw new Error('rescan failed');
        });
        shared.sceneActions['refreshLibrary'] = refreshLibrary;
        await bootstrapWithHandlers();
        await shared.eventHandlers['storage:permissionGranted']();
        expect(shared.setStatus).toHaveBeenCalledWith(
            't:main.libraryRefreshFailed' + 'Error: rescan failed',
            true
        );
    });

    it('正常：android:back 有面板可关 → 重置退出窗口且不提示', async () => {
        shared.uiActions['handleAndroidBack'] = vi.fn(() => true);
        const exitApp = vi.fn();
        window.wails = { exitApp };
        await bootstrapWithHandlers();
        await shared.eventHandlers['android:back']();
        expect(exitApp).not.toHaveBeenCalled();
        expect(shared.showInfoToast).not.toHaveBeenCalled();
    });

    it('正常：android:back 无面板 → 首次提示，再次返回 exitApp', async () => {
        shared.uiActions['handleAndroidBack'] = vi.fn(() => false);
        const exitApp = vi.fn();
        window.wails = { exitApp };
        await bootstrapWithHandlers();
        await shared.eventHandlers['android:back']();
        expect(shared.showInfoToast).toHaveBeenCalledWith(
            't:main.pressAgainToExit',
            undefined,
            undefined,
            2000
        );
        await shared.eventHandlers['android:back']();
        expect(exitApp).toHaveBeenCalledTimes(1);
    });

    it('正常：android:ScreenLocked → 立即刷盘保存场景', async () => {
        const saveSceneImmediate = vi.fn(async () => {});
        shared.sceneActions['saveSceneImmediate'] = saveSceneImmediate;
        await bootstrapWithHandlers();
        await shared.eventHandlers['android:ScreenLocked']();
        expect(saveSceneImmediate).toHaveBeenCalled();
    });

    it('正常：android:NetworkChanged 在线/离线 toast', async () => {
        await bootstrapWithHandlers();
        await shared.eventHandlers['android:NetworkChanged']({ data: { online: true } });
        expect(shared.showInfoToast).toHaveBeenCalledWith('t:main.networkOnline');
        shared.showInfoToast.mockClear();
        await shared.eventHandlers['android:NetworkChanged']({ data: { online: false } });
        expect(shared.showInfoToast).toHaveBeenCalledWith('t:main.networkOffline');
    });

    it('正常：update:installFailed → 错误 toast（无 payload 用兜底文案）', async () => {
        await bootstrapWithHandlers();
        await shared.eventHandlers['update:installFailed']({ data: { error: 'apk corrupt' } });
        expect(shared.showInfoToast).toHaveBeenCalledWith('apk corrupt');
        shared.showInfoToast.mockClear();
        await shared.eventHandlers['update:installFailed']({ data: {} });
        expect(shared.showInfoToast).toHaveBeenCalledWith('t:settings.about.update.downloadFailed');
    });

    it('守卫：android:BatteryChanged / android:ThemeChanged 为预留 no-op 不崩', async () => {
        await bootstrapWithHandlers();
        expect(() => {
            shared.eventHandlers['android:BatteryChanged']({ data: { level: 50 } });
            shared.eventHandlers['android:ThemeChanged']({ data: { nightMode: true } });
        }).not.toThrow();
    });
});
