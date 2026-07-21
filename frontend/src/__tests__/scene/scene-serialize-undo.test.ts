// [doc:adr-158] 撤销 UX 层单元测试 — offerSceneUndo / offerSceneUndoAndRefresh
// 覆盖 P3 去重辅助 offerSceneUndoAndRefresh 的接线与守卫路径。
// 策略：snap 是入参，可直传字符串测 toast 接线；scene-serialize 的重依赖统一空 mock
// （仅在未触发的函数体内使用，模块加载期只执行 debounce——保留真实 utils）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 捕获 showInfoToast(message, sub, actions, duration) 调用
const toastState = vi.hoisted(() => ({
    calls: [] as Array<{
        message: string;
        actions: Array<{ label: string; onClick: () => void }>;
        duration: number | undefined;
    }>,
}));

const cfgState = vi.hoisted(() => ({
    setStatus: vi.fn(),
    showErrorToast: vi.fn(),
}));

vi.mock('../../core/toast', () => ({
    showInfoToast: vi.fn(
        (
            message: string,
            _sub: unknown,
            actions: Array<{ label: string; onClick: () => void }> | undefined,
            duration?: number
        ) => {
            toastState.calls.push({ message, actions: actions ?? [], duration });
        }
    ),
    showErrorToast: vi.fn(),
}));
vi.mock('../../core/i18n/t', () => ({ t: (k: string) => k }));
vi.mock('../../core/config', () => ({
    computeLibraryRef: () => '',
    resolveLibraryRef: () => '',
    envState: {},
    modelRegistry: new Map(),
    propRegistry: new Map(),
    showErrorToast: cfgState.showErrorToast,
    setStatus: cfgState.setStatus,
}));

// 重依赖：全部空 mock（仅在本测试不触发的函数体内使用）
vi.mock('../../core/wails-bindings', () => ({}));
vi.mock('../../core/i18n/goerr', () => ({}));
vi.mock('../../scene/motion/motion-intent', () => ({}));
vi.mock('../../scene/camera/camera', () => ({}));
vi.mock('../../scene/motion/vmd-loader', () => ({}));
vi.mock('../../scene/scene-migrate', () => ({}));
vi.mock('../../outfit/audio', () => ({}));
vi.mock('../../outfit/outfit', () => ({}));
vi.mock('../../scene/scene', () => ({}));
vi.mock('../../scene/manager/material', () => ({}));
vi.mock('../../scene/env/props', () => ({}));
vi.mock('../../scene/env/env-bridge', () => ({}));
vi.mock('../../scene/physics/ground-collision', () => ({}));
vi.mock('../../scene/motion/proc-motion-bridge', () => ({}));
vi.mock('../../scene/motion/lipsync-bridge', () => ({}));
vi.mock('../../motion-algos/procedural-motion', () => ({ DEFAULT_PROC_STATE: {} }));
vi.mock('../../motion-algos/lipsync', () => ({ DEFAULT_LIPSYNC_STATE: {} }));
vi.mock('../../scene/motion/perception', () => ({}));
// 注意：'../../core/utils'（debounce 在模块求值期使用）与 '../../core/logger' 保留真实。

import { offerSceneUndo, offerSceneUndoAndRefresh } from '../../scene/scene-serialize';
import { showInfoToast } from '../../core/toast';

const mockShowInfoToast = vi.mocked(showInfoToast);

beforeEach(() => {
    toastState.calls = [];
    cfgState.setStatus.mockClear();
    mockShowInfoToast.mockClear();
});

describe('offerSceneUndo — 守卫与 toast 接线', () => {
    it('snap 为 null 时不弹 toast（无快照可撤销）', () => {
        const onRestored = vi.fn();
        offerSceneUndo('msg', null, onRestored);
        expect(mockShowInfoToast).not.toHaveBeenCalled();
        expect(onRestored).not.toHaveBeenCalled();
    });

    it('snap 有效时弹出带「撤销」动作的 info toast（8s）', () => {
        offerSceneUndo('已清除动作', '{"version":99}', vi.fn());
        expect(mockShowInfoToast).toHaveBeenCalledTimes(1);
        expect(toastState.calls[0].message).toBe('已清除动作');
        expect(toastState.calls[0].duration).toBe(8000);
        expect(toastState.calls[0].actions).toHaveLength(1);
        expect(toastState.calls[0].actions[0].label).toBe('toast.undo');
    });

    it('点击撤销但快照版本不受支持时，恢复失败 → onRestored 不触发', async () => {
        const onRestored = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // version 99 不在 SUPPORTED_VERSIONS，restoreUndoSnapshot 提前返回 false
        offerSceneUndo('msg', '{"version":99,"models":[]}', onRestored);
        toastState.calls[0].actions[0].onClick();
        await Promise.resolve();
        await Promise.resolve();
        expect(onRestored).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('offerSceneUndoAndRefresh — 去重辅助（P3）', () => {
    it('snap 为 null 时既不弹 toast 也不执行 reRender', () => {
        const reRender = vi.fn();
        offerSceneUndoAndRefresh('msg', null, reRender);
        expect(mockShowInfoToast).not.toHaveBeenCalled();
        expect(reRender).not.toHaveBeenCalled();
    });

    it('snap 有效时委托 offerSceneUndo 弹出撤销 toast', () => {
        offerSceneUndoAndRefresh('音乐已移除', '{"version":99}', vi.fn());
        expect(mockShowInfoToast).toHaveBeenCalledTimes(1);
        expect(toastState.calls[0].message).toBe('音乐已移除');
        expect(toastState.calls[0].actions[0].label).toBe('toast.undo');
    });

    it('恢复失败时不执行 reRender、不提示 undoApplied', async () => {
        const reRender = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        offerSceneUndoAndRefresh('msg', '{"version":99,"models":[]}', reRender);
        toastState.calls[0].actions[0].onClick();
        await Promise.resolve();
        await Promise.resolve();
        expect(reRender).not.toHaveBeenCalled();
        expect(cfgState.setStatus).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
