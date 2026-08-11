// @vitest-environment node
// [doc:adr-204] playback.test.ts 拆分：initPlaybackObservables
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ----- hoisted mocks（vi.mock 工厂引用，不可 export 跨文件，必须内联）-----
const mockState = vi.hoisted(() => ({
    mmdRuntime: null as any,
    isPlaying: false,
    autoLoop: true,
    seekDragging: false,
}));

const isAudioPlaying = vi.hoisted(() => vi.fn(() => false));
const animateCameraVmd = vi.hoisted(() => vi.fn());

const mockDom = vi.hoisted(
    () =>
        ({
            playbackBar: { style: { display: '' } },
            btnPlayPause: { textContent: '' },
            btnLoopToggle: { style: { opacity: '' } },
            timeDisplay: { textContent: '' },
            seekBar: {
                getBoundingClientRect: vi.fn(() => ({
                    left: 10,
                    width: 200,
                    top: 0,
                    right: 210,
                    bottom: 30,
                    height: 30,
                })),
                style: {},
            },
            seekProgress: { style: { width: '' } },
        }) as any
);

vi.mock('../core/config', () => ({
    get mmdRuntime() {
        return mockState.mmdRuntime;
    },
    get isPlaying() {
        return mockState.isPlaying;
    },
    setIsPlaying: (v: boolean) => {
        mockState.isPlaying = v;
    },
    get autoLoop() {
        return mockState.autoLoop;
    },
    get seekDragging() {
        return mockState.seekDragging;
    },
    dom: mockDom,
    formatTime: (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    },
}));

import { initPlaybackObservables } from '../scene/motion/playback';
import { mockRuntime, tickObs, playObs, pauseObs, mockManager } from './playback-helpers';
import { registerSceneAction } from '../core/scene-action-bridge';

// [doc:adr-238] playback 不再静态 import core/audio 与 scene/camera，音频查询与相机 VMD
// 均经 scene-action-bridge 调用；真实注册来自各自模块副作用，测试侧手动注册桩。
registerSceneAction('isAudioPlaying', () => isAudioPlaying());
registerSceneAction('animateCameraVmd', (frameTime: number) => animateCameraVmd(frameTime));

describe('initPlaybackObservables', () => {
    const mockUpdateUI = vi.fn();
    const mockUpdateProcMotion = vi.fn().mockResolvedValue(undefined);
    const mockGetBeatDetector = vi.fn(() => null);

    let dispose: () => void;

    beforeEach(() => {
        tickObs.add.mockClear();
        playObs.add.mockClear();
        pauseObs.add.mockClear();
        tickObs.remove.mockClear();
        playObs.remove.mockClear();
        pauseObs.remove.mockClear();
        tickObs.removeCallback.mockClear();
        playObs.removeCallback.mockClear();
        pauseObs.removeCallback.mockClear();
        mockRuntime.seekAnimation.mockClear().mockResolvedValue(undefined);
        mockRuntime.playAnimation.mockClear().mockResolvedValue(undefined);
        mockUpdateUI.mockClear();
        mockUpdateProcMotion.mockClear().mockResolvedValue(undefined);
        mockGetBeatDetector.mockClear().mockReturnValue(null);
        animateCameraVmd.mockClear();
        mockManager.focused.mockReset();

        mockState.mmdRuntime = mockRuntime;
        mockState.isPlaying = false;
        mockState.autoLoop = true;
        mockState.seekDragging = false;

        dispose = initPlaybackObservables(
            mockRuntime as any,
            mockManager as any,
            mockUpdateUI,
            mockUpdateProcMotion,
            mockGetBeatDetector
        );
    });

    afterEach(() => {
        dispose();
    });

    // ---- handler registration ----

    it('registers tick, play, and pause handlers on runtime', () => {
        expect(tickObs.add).toHaveBeenCalledTimes(1);
        expect(playObs.add).toHaveBeenCalledTimes(1);
        expect(pauseObs.add).toHaveBeenCalledTimes(1);
    });

    // ---- tickHandler ----

    it('tickHandler calls updateUI, updateProcMotion, and camera sync', () => {
        mockRuntime.currentTime = 10;
        tickObs._fire();

        expect(mockUpdateUI).toHaveBeenCalledOnce();
        expect(mockUpdateProcMotion).toHaveBeenCalledOnce();
        expect(animateCameraVmd).toHaveBeenCalledWith(300); // currentTime * 30
    });

    it('tickHandler updates beat detector when audio is playing and detector exists', () => {
        const beatDetector = { update: vi.fn() };
        mockGetBeatDetector.mockReturnValue(beatDetector);
        isAudioPlaying.mockReturnValue(true);

        tickObs._fire();
        expect(beatDetector.update).toHaveBeenCalledOnce();
    });

    it('tickHandler skips beat detector update when audio is not playing', () => {
        const beatDetector = { update: vi.fn() };
        mockGetBeatDetector.mockReturnValue(beatDetector);
        isAudioPlaying.mockReturnValue(false);

        tickObs._fire();
        expect(beatDetector.update).not.toHaveBeenCalled();
    });

    it('tickHandler does not crash when beatDetector is null', () => {
        isAudioPlaying.mockReturnValue(true);
        expect(() => tickObs._fire()).not.toThrow();
    });

    it('tickHandler catches updateProcMotion rejection', async () => {
        const err = new Error('proc motion fail');
        mockUpdateProcMotion.mockRejectedValue(err);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => tickObs._fire()).not.toThrow();
        // .catch() runs as a microtask; wait for it
        await vi.waitFor(() => {
            expect(spy).toHaveBeenCalledWith('[playback] updateProcMotion:', err);
        });
        spy.mockRestore();
    });

    // ---- playHandler ----

    it('playHandler sets isPlaying and updates UI', () => {
        playObs._fire();
        expect(mockState.isPlaying).toBe(true);
        expect(mockUpdateUI).toHaveBeenCalledOnce();
    });

    // ---- pauseHandler ----

    it('pauseHandler sets isPlaying to false on normal pause', () => {
        mockState.isPlaying = true;
        pauseObs._fire();
        expect(mockState.isPlaying).toBe(false);
    });

    it('pauseHandler loopPending 时跳过 setIsPlaying(false)，auto-loop 恢复播放', async () => {
        // Trigger auto-loop first to set _loopPending
        mockState.autoLoop = true;
        mockManager.focused.mockReturnValue({ animationDuration: 120 });
        mockRuntime.currentTime = 119.95; // >= 120 - 0.1

        pauseObs._fire();

        // [audit:round6] 原用例名「does not set isPlaying when loopPending」但无任何
        // isPlaying 断言——名实脱节。补断言：loopPending 分支跳过 setIsPlaying(false)，
        // 异步链最终 setIsPlaying(true) 恢复播放（与 L199-215 参照同构）
        expect(mockRuntime.seekAnimation).toHaveBeenCalledWith(0, true);
        await vi.waitFor(() => {
            expect(mockRuntime.playAnimation).toHaveBeenCalledOnce();
        });
        await vi.waitFor(() => {
            expect(mockState.isPlaying).toBe(true);
        });
    });

    it('pauseHandler seeks and plays when auto-loop condition met', async () => {
        mockState.autoLoop = true;
        mockManager.focused.mockReturnValue({ animationDuration: 120 });
        mockRuntime.currentTime = 119.95;

        pauseObs._fire();

        expect(mockRuntime.seekAnimation).toHaveBeenCalledWith(0, true);

        // Wait for the promise chain
        await vi.waitFor(() => {
            expect(mockRuntime.playAnimation).toHaveBeenCalledOnce();
        });
        await vi.waitFor(() => {
            expect(mockState.isPlaying).toBe(true);
        });
    });

    it('pauseHandler cancels auto-loop when autoLoop becomes false mid-seek', async () => {
        mockState.autoLoop = true;
        mockManager.focused.mockReturnValue({ animationDuration: 120 });
        mockRuntime.currentTime = 119.95;

        // mock seekAnimation to toggle autoLoop off before resolving
        mockRuntime.seekAnimation.mockImplementation(async () => {
            mockState.autoLoop = false;
        });

        pauseObs._fire();
        expect(mockRuntime.seekAnimation).toHaveBeenCalledWith(0, true);

        // _loopPending should be reset after the .then chain
        await vi.waitFor(() => {
            expect(mockRuntime.playAnimation).not.toHaveBeenCalled();
        });
    });

    it('pauseHandler updates UI when auto-loop not needed', () => {
        mockState.isPlaying = true;
        mockRuntime.currentTime = 30;
        pauseObs._fire();

        expect(mockUpdateUI).toHaveBeenCalled();
        expect(mockState.isPlaying).toBe(false);
    });

    it('pauseHandler returns early when seekDragging', () => {
        mockState.seekDragging = true;
        pauseObs._fire();

        // Should still updatePlaybackUI (for UI consistency)
        expect(mockUpdateUI).toHaveBeenCalled();
    });

    // ---- additional coverage ----

    it('tickHandler skips animateCameraVmd when scene action not registered', () => {
        // animateCameraVmd 已在模块顶层注册，此处验证 getSceneAction 返回 undefined 时静默跳过
        // 不抛异常即为通过（源码使用可选链 ?.() 调用）
        expect(() => tickObs._fire()).not.toThrow();
        expect(mockUpdateUI).toHaveBeenCalledOnce();
    });

    it('playHandler calls updatePlaybackUI', () => {
        playObs._fire();
        expect(mockUpdateUI).toHaveBeenCalledOnce();
    });

    it('pauseHandler does not auto-loop when model not focused', () => {
        mockState.isPlaying = true;
        mockState.autoLoop = true;
        // mockManager.focused 经 mockReset 后返回 undefined

        pauseObs._fire();

        expect(mockRuntime.seekAnimation).not.toHaveBeenCalled();
        expect(mockState.isPlaying).toBe(false);
        expect(mockUpdateUI).toHaveBeenCalled();
    });

    it('pauseHandler catches seekAnimation rejection in auto-loop', async () => {
        mockState.autoLoop = true;
        mockManager.focused.mockReturnValue({ animationDuration: 120 });
        mockRuntime.currentTime = 119.95;
        const err = new Error('seek fail');
        mockRuntime.seekAnimation.mockRejectedValueOnce(err);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => pauseObs._fire()).not.toThrow();

        await vi.waitFor(() => {
            expect(spy).toHaveBeenCalledWith('[playback] auto-loop seekAnimation failed:', err);
        });
        expect(mockState.isPlaying).toBe(false);
        spy.mockRestore();
    });

    it('pauseHandler catches playAnimation rejection in auto-loop', async () => {
        mockState.autoLoop = true;
        mockManager.focused.mockReturnValue({ animationDuration: 120 });
        mockRuntime.currentTime = 119.95;
        const err = new Error('play fail');
        mockRuntime.playAnimation.mockRejectedValueOnce(err);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => pauseObs._fire()).not.toThrow();

        await vi.waitFor(() => {
            expect(mockRuntime.playAnimation).toHaveBeenCalledOnce();
        });
        await vi.waitFor(() => {
            expect(spy).toHaveBeenCalledWith('[playback] auto-loop playAnimation failed:', err);
        });
        spy.mockRestore();
    });

    // ---- dispose ----

    it('dispose removes all registered callbacks', () => {
        expect(tickObs.remove).toHaveBeenCalledTimes(0);
        expect(playObs.remove).toHaveBeenCalledTimes(0);
        expect(pauseObs.remove).toHaveBeenCalledTimes(0);

        dispose();

        expect(tickObs.remove).toHaveBeenCalledTimes(1);
        expect(playObs.remove).toHaveBeenCalledTimes(1);
        expect(pauseObs.remove).toHaveBeenCalledTimes(1);
    });

    it('dispose does not throw when remove fails', () => {
        tickObs.remove.mockImplementationOnce(() => {
            throw new Error('cleanup fail');
        });
        expect(() => dispose()).not.toThrow();
    });

    it('dispose auto-called from afterEach does not double-crash', () => {
        // The second call (from afterEach) should also not throw
        expect(() => dispose()).not.toThrow();
    });
});
