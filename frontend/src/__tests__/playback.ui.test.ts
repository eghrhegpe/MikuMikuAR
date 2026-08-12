// @vitest-environment node
// [doc:adr-204] playback.test.ts 拆分：updatePlaybackUI
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- hoisted mocks（vi.mock 工厂引用，不可 export 跨文件，必须内联）-----
const mockState = vi.hoisted(() => ({
    mmdRuntime: null as any,
    isPlaying: false,
    autoLoop: true,
    seekDragging: false,
}));

const syncAudioPlayback = vi.hoisted(() => vi.fn());
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

vi.mock('@/core/audio', () => ({
    syncAudioPlayback: (...args: unknown[]) => syncAudioPlayback(...args),
    isAudioPlaying: () => isAudioPlaying(),
}));

vi.mock('../scene/camera/camera', () => ({
    animateCameraVmd: (...args: unknown[]) => animateCameraVmd(...args),
}));

import { updatePlaybackUI } from '../scene/motion/playback';
import { feetDebug } from '../scene/motion/perception-shared';
import { mockRuntime } from './playback-helpers';

describe('updatePlaybackUI', () => {
    const origSeekBar = mockDom.seekBar;

    beforeEach(() => {
        mockState.mmdRuntime = { ...mockRuntime, currentTime: 30, animationDuration: 120 };
        mockState.isPlaying = false;
        mockState.autoLoop = true;
        mockDom.playbackBar.style.display = '';
        mockDom.btnPlayPause.textContent = '';
        mockDom.btnLoopToggle.style.opacity = '';
        mockDom.timeDisplay.textContent = '';
        mockDom.seekProgress.style.width = '';
        // [ADR-248] 默认关闭告警门控；seekBar 恢复原始对象（防前置用例断言失败泄漏 null）
        feetDebug.value = false;
        mockDom.seekBar = origSeekBar;
    });

    afterEach(() => {
        feetDebug.value = false;
        mockDom.seekBar = origSeekBar;
        vi.restoreAllMocks();
    });

    it('mmdRuntime 为 null 时降级：不崩溃、DOM 不动、默认不刷告警', () => {
        mockState.mmdRuntime = null;
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        updatePlaybackUI();
        // [ADR-248] 告警经 feetDebug 门控：生产默认关闭，热路径不刷日志
        expect(spy).not.toHaveBeenCalled();
        // DOM 不应被修改
        expect(mockDom.playbackBar.style.display).toBe('');
    });

    it('dom.seekBar 为 null 时降级：不崩溃、DOM 不动、默认不刷告警', () => {
        mockDom.seekBar = null;
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        updatePlaybackUI();
        expect(spy).not.toHaveBeenCalled();
        expect(mockDom.playbackBar.style.display).toBe('');
    });

    it('shows playbackBar and sets play button when not playing', () => {
        mockState.isPlaying = false;
        updatePlaybackUI();
        expect(mockDom.playbackBar.style.display).toBe('flex');
        expect(mockDom.btnPlayPause.textContent).toBe('▶');
    });

    it('shows pause button when playing', () => {
        mockState.isPlaying = true;
        updatePlaybackUI();
        expect(mockDom.btnPlayPause.textContent).toBe('⏸');
    });

    it('sets loop toggle opacity based on autoLoop', () => {
        mockState.autoLoop = true;
        updatePlaybackUI();
        expect(mockDom.btnLoopToggle.style.opacity).toBe('1');

        mockState.autoLoop = false;
        updatePlaybackUI();
        expect(mockDom.btnLoopToggle.style.opacity).toBe('0.35');
    });

    it('updates time display with formatted time', () => {
        mockState.mmdRuntime.currentTime = 65;
        mockState.mmdRuntime.animationDuration = 120;
        updatePlaybackUI();
        expect(mockDom.timeDisplay.textContent).toBe('1:05 / 2:00');
    });

    it('sets seek progress width percentage', () => {
        mockState.mmdRuntime.currentTime = 60;
        mockState.mmdRuntime.animationDuration = 120;
        updatePlaybackUI();
        expect(mockDom.seekProgress.style.width).toBe('50%');
    });

    it('clamps seek progress at 100%', () => {
        mockState.mmdRuntime.currentTime = 200;
        mockState.mmdRuntime.animationDuration = 120;
        updatePlaybackUI();
        expect(mockDom.seekProgress.style.width).toBe('100%');
    });

    it('feetDebug 开启时 mmdRuntime 为 null 会告警一次（门控合同）', () => {
        feetDebug.value = true;
        mockState.mmdRuntime = null;
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        updatePlaybackUI();
        expect(spy).toHaveBeenCalledWith(
            '[playback] updatePlaybackUI: mmdRuntime 或 seekBar 未就绪，跳过本帧'
        );
        expect(mockDom.timeDisplay.textContent).toBe('');
    });
});
