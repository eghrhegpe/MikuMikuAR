// menu/settings-p3.test.ts — [audit:fix 2026-10] P3 批次回归（子代理 J1）
// T4  settings-system: exportSettings 延迟 revoke（下载任务异步取 blob，立即 revoke 会中断）
// T5  settings-system: convertToCustom 成功后 ScanSoftwareDir 包 catch（logWarn，不阻断 toast/pop/reRender）
// T6  settings-media:  截图 selectDir 回调 SelectDir reject → showInfoToast（与 OpenScreenshotDir 同构）
// mock 形状参照 settings-media-mute.test.ts（per-file vi.mock + vi.hoisted hooks + 假 renderMenu 捕获 schema）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import {
    buildSettingsSystemLevel,
    buildSoftwareDetailLevel,
    scanSoftwareDir,
} from '../../menus/settings-system';
import { buildSettingsMediaLevel } from '../../menus/settings-media';
import { logWarn } from '../../core/logger';
import { showInfoToast } from '../../core/toast';
import { feedbackInfo } from '../../core/feedback';
import {
    AddCustomSoftware,
    ScanSoftwareDir,
    SelectDir,
} from '../../core/wails-bindings';

const hooks = vi.hoisted(() => ({
    schemas: [] as unknown[][],
    slideRows: [] as unknown[][],
    tCalls: [] as Array<[string, unknown]>,
}));

// ======== 共享 mock（settings-system + settings-media 导入并集） ========
vi.mock('../../core/config', () => ({
    uiState: {},
    setUIState: vi.fn(),
    cardContainer: (
        container: HTMLElement,
        fn: (c: HTMLElement) => (() => void) | void
    ): (() => void) | void => {
        const card = document.createElement('div');
        card.className = 'lcard';
        container.appendChild(card);
        return fn(card);
    },
}));
vi.mock('../../core/wails-bindings', () => ({
    GetCacheStats: vi.fn(),
    OpenCacheDir: vi.fn(),
    SetUIScale: vi.fn(),
    SetUIPopupWidth: vi.fn(),
    SetUIAccent: vi.fn(),
    SetUIFontFamily: vi.fn(),
    SetUIAnimations: vi.fn(),
    SetUIBlurBg: vi.fn(),
    SetPerformanceMode: vi.fn(),
    ScanSoftwareDir: vi.fn(),
    LaunchSoftware: vi.fn(),
    AddCustomSoftware: vi.fn(),
    RemoveCustomSoftware: vi.fn(),
    UpdateCustomSoftware: vi.fn(),
    SetBlenderPath: vi.fn(),
    SetMMDPath: vi.fn(),
    SelectExeFile: vi.fn(),
    SelectDir: vi.fn(),
    OpenScreenshotDir: vi.fn(),
}));
vi.mock('../../core/escape-html', () => ({
    escapeHtml: (s: string) => s,
}));
vi.mock('../../core/ui-helpers', () => ({
    // 记录调用参数 + 返回真实元素（settings-media 的 format 卡片会对返回值写 dataset）
    slideRow: (...args: unknown[]) => {
        hooks.slideRows.push(args);
        return document.createElement('div');
    },
    addSectionTitle: vi.fn(),
    addDangerRow: vi.fn(),
    addFieldRow: vi.fn(),
}));
vi.mock('../../core/dialog', () => ({
    showConfirm: () => Promise.resolve(false),
    showPrompt: () => Promise.resolve(''),
}));
vi.mock('../../core/dom', () => ({
    addDisposableListener: () => ({ dispose() {} }),
}));
vi.mock('../../core/icons', () => ({
    softwareKindIcon: () => 'lucide:box',
}));
vi.mock('../../core/async', () => ({
    swallowError: (p: Promise<unknown>) => p.catch(() => undefined),
}));
vi.mock('../../core/path', () => ({
    getBaseName: (p: string) => p.split(/[/\\]/).pop() ?? p,
}));
vi.mock('../../core/json-stringify', () => ({
    jsonStringify: (v: unknown) => JSON.stringify(v),
}));
vi.mock('../../core/feedback', () => ({
    feedbackError: vi.fn(),
    feedbackInfo: vi.fn(),
    feedbackStatus: vi.fn(),
}));
vi.mock('../../core/toast', () => ({
    showInfoToast: vi.fn(),
}));
vi.mock('../../core/safe-call', () => ({
    safeCallAsync: (
        _tag: string,
        _msg: string,
        fn: () => Promise<unknown>
    ): Promise<unknown> => fn().catch(() => undefined),
}));
vi.mock('../../core/i18n/t', () => ({
    // 恒等返回 key（测试按 key 定位行）+ 记录 (key, params) 供断言
    t: (key: string, params?: unknown) => {
        hooks.tCalls.push([key, params]);
        return key;
    },
}));
vi.mock('../../core/i18n/goerr', () => ({
    translateGoError: (e: unknown) => String(e),
}));
vi.mock('../../core/logger', () => ({
    logWarn: vi.fn(),
    logInfo: vi.fn(),
    logError: vi.fn(),
}));
vi.mock('../../core/status-bar', () => ({
    setStatus: vi.fn(),
}));
// status-helpers（tryCatchStatus）用真实实现：成功返回 fn 结果，失败 setStatus+logWarn+undefined
vi.mock('../../scene/env/_bridge/env-persist', () => ({
    schedulePersistUI: vi.fn(),
}));
vi.mock('../../core/ui-state', () => ({
    defaultUIState: () => ({}),
}));
vi.mock('../../scene/render/performance', () => ({
    setPerformanceMode: vi.fn(),
}));
vi.mock('../../scene/scene', () => ({
    engine: { setHardwareScalingLevel: vi.fn() },
    applyFrameControl: vi.fn(),
}));
vi.mock('../../core/render-loop', () => ({
    calcHardwareScaling: () => 1,
}));
vi.mock('../../scene/camera/camera', () => ({
    refreshCameraUserSettings: vi.fn(),
}));
vi.mock('@/core/audio', () => ({
    setVolume: vi.fn(),
    getVolume: () => 1,
    setAudioOffset: vi.fn(),
    getAudioOffset: () => 0,
    setRepeatMode: vi.fn(),
    getRepeatModeStr: () => 'loop',
}));
vi.mock('../../core/audio-bus', () => ({
    setSfxEnabled: vi.fn(),
    setSfxVolume: vi.fn(),
    setFootstepEnabled: vi.fn(),
    setFootstepVolume: vi.fn(),
}));
vi.mock('../../scene/motion/proc-motion-bridge', () => ({
    setBpmQuantizeEnabled: vi.fn(),
}));
vi.mock('../../core/action-executor', () => ({
    executeActionById: vi.fn(),
}));
vi.mock('../../menus/settings-shared', () => ({
    applyUIAppearanceDom: vi.fn(),
    formatBytes: (n: number) => `${n}B`,
    setAutoLoadCompanionAudio: vi.fn(),
    truncatePath: (p: string) => p,
}));
vi.mock('../../menus/render-menu', () => ({
    // 捕获型假 renderMenu：只记录 schema，不展开（测试手动调用目标卡的 renderCustom）
    renderMenu: (schema: unknown[], _container: unknown) => {
        hooks.schemas.push(schema);
        return () => {};
    },
}));
vi.mock('../../core/backend', () => ({
    getCachedCapabilities: () => ({ externalApps: false, systemDirOpen: false }),
}));
vi.mock('../../core/debug-log-panel', () => ({
    toggleLogPanel: vi.fn(),
}));
vi.mock('../../menus/menu', () => ({
    getCurrentRenderingMenu: () => null,
}));

type CapturedNode = { id?: string; kind?: string; renderCustom?: (c: unknown) => unknown };

function lastSchema(): CapturedNode[] {
    return hooks.schemas[hooks.schemas.length - 1] as CapturedNode[];
}

beforeEach(() => {
    hooks.schemas.length = 0;
    hooks.slideRows.length = 0;
    hooks.tCalls.length = 0;
    vi.mocked(showInfoToast).mockClear();
    vi.mocked(logWarn).mockClear();
    vi.mocked(feedbackInfo).mockClear();
    vi.mocked(SelectDir).mockReset();
    vi.mocked(ScanSoftwareDir).mockReset();
    vi.mocked(AddCustomSoftware).mockReset();
});

// ======== T4：exportSettings 延迟 revoke ========
describe('settings-system · T4 exportSettings 延迟 revoke [audit:fix 2026-10]', () => {
    it('revokeObjectURL 在 a.click() 后 1s 才执行（修复前是同步 revoke）', async () => {
        const container = document.createElement('div');
        const blobUrl = 'blob:mikumikuar/settings-export.json';
        const createSpy = vi.fn(() => blobUrl);
        const revokeSpy = vi.fn();
        URL.createObjectURL = createSpy;
        URL.revokeObjectURL = revokeSpy;
        vi.useFakeTimers();
        try {
            const level = buildSettingsSystemLevel(() => null);
            // PopupLevel.renderCustom 为可选成员（src/core/types.ts:412）；此 level 必然带 renderCustom，用函数断言替代 !
            const render = level.renderCustom as (c: HTMLElement) => unknown;
            expect(render).toBeTypeOf('function');
            render(container);
            const mgmt = lastSchema().find((n) => n.id === 'system:settings-mgmt');
            expect(mgmt?.renderCustom).toBeTypeOf('function');
            mgmt!.renderCustom!(container);

            const row = hooks.slideRows.find(
                (a) => a[2] === 'settings.about.settingsMgmt.export'
            );
            expect(row).toBeDefined();
            expect(revokeSpy).not.toHaveBeenCalled();

            (row![4] as () => void)();

            expect(createSpy).toHaveBeenCalledTimes(1);
            // 修复前：revoke 紧贴 a.click() 同步执行；修复后：此刻仍悬挂
            expect(revokeSpy).not.toHaveBeenCalled();
            expect(feedbackInfo).toHaveBeenCalledWith('settings.exported', undefined);

            vi.advanceTimersByTime(1000);
            expect(revokeSpy).toHaveBeenCalledTimes(1);
            expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ======== T5：convertToCustom 成功后 ScanSoftwareDir catch ========
describe('settings-system · T5 convert 后扫描失败不阻断 [audit:fix 2026-10]', () => {
    it('ScanSoftwareDir reject → logWarn + showInfoToast + pop/reRender 照旧执行', async () => {
        // 先填充模块级 cachedSoftwareEntries（scanSoftwareDir 内部 catch 兜底，此处 resolve）
        vi.mocked(ScanSoftwareDir).mockResolvedValueOnce([
            {
                path: '/sw/app.exe',
                name: 'app.exe',
                kind: 'game',
                args: '',
                managed: false,
                icon: 'lucide:box',
            },
        ]);
        await scanSoftwareDir();
        // 转化分支里的第二次扫描 → reject，验证 catch 路径
        vi.mocked(ScanSoftwareDir).mockRejectedValueOnce(new Error('scan boom'));
        vi.mocked(AddCustomSoftware).mockResolvedValue(undefined);

        const pops = vi.fn();
        const reRenders = vi.fn();
        const menu = {
            guardedRun: (body: (stale: () => boolean) => Promise<void>) =>
                body(() => false),
            pop: pops,
            reRender: reRenders,
        } as unknown as SlideMenu;

        const container = document.createElement('div');
        const level = buildSoftwareDetailLevel('/sw/app.exe', () => menu);
        const render = level.renderCustom as (c: HTMLElement) => unknown;
        expect(render).toBeTypeOf('function');
        render(container);
        const actions = lastSchema().find((n) => n.id === 'software-detail:actions');
        expect(actions?.renderCustom).toBeTypeOf('function');
        actions!.renderCustom!(container);

        const row = hooks.slideRows.find(
            (a) => a[2] === 'settings.software.convertToCustom'
        );
        expect(row).toBeDefined();
        await (row![4] as () => Promise<void>)();

        // catch 内 logWarn（不阻断后续流程）
        expect(logWarn).toHaveBeenCalledWith(
            'settings-system',
            'ScanSoftwareDir failed after convert',
            expect.any(Error)
        );
        // catch 后照旧：toast + pop + reRender（用户下次进软件卡见旧列表而非崩页）
        expect(showInfoToast).toHaveBeenCalledWith('settings.softwareToCustom');
        expect(pops).toHaveBeenCalledTimes(1);
        expect(reRenders).toHaveBeenCalledTimes(1);
    });
});

// ======== T6：截图 selectDir 回调 SelectDir reject → toast ========
describe('settings-media · T6 SelectDir reject → toast [audit:fix 2026-10]', () => {
    it('SelectDir 异常时 showInfoToast(t(\'settings.error\', {message}))，无裸 reject', async () => {
        vi.mocked(SelectDir).mockRejectedValueOnce(new Error('selectdir boom'));

        const container = document.createElement('div');
        const level = buildSettingsMediaLevel(() => null as never);
        const render = level.renderCustom as (c: HTMLElement) => unknown;
        expect(render).toBeTypeOf('function');
        render(container);
        const shotDir = lastSchema().find((n) => n.id === 'media:shot-dir');
        expect(shotDir?.renderCustom).toBeTypeOf('function');
        shotDir!.renderCustom!(container);

        const row = hooks.slideRows.find(
            (a) => a[2] === 'settings.screenshot.selectDir'
        );
        expect(row).toBeDefined();
        await (row![4] as () => Promise<void>)();

        // 与 :469-472 OpenScreenshotDir 分支同构的断言：t(key, {message: String(err)})
        expect(hooks.tCalls).toContainEqual([
            'settings.error',
            { message: 'Error: selectdir boom' },
        ]);
        expect(showInfoToast).toHaveBeenCalledWith('settings.error');
    });
});
