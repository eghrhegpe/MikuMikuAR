// [doc:adr-204] playback.test.ts 拆分：seekFromEvent
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

vi.mock('../outfit/audio', () => ({
    syncAudioPlayback: (...args: unknown[]) => syncAudioPlayback(...args),
    isAudioPlaying: () => isAudioPlaying(),
}));

vi.mock('../scene/camera/camera', () => ({
    animateCameraVmd: (...args: unknown[]) => animateCameraVmd(...args),
}));

import { seekFromEvent } from '../scene/motion/playback';
import { mockRuntime } from './playback-helpers';

describe('seekFromEvent', () => {
    const mouseEvent = { clientX: 60 } as MouseEvent;

    beforeEach(() => {
        mockState.mmdRuntime = {
            ...mockRuntime,
            currentTime: 0,
            animationDuration: 120,
        };
        mockState.isPlaying = false;
        syncAudioPlayback.mockReset();
    });

    it('no-op when mmdRuntime is null', () => {
        mockState.mmdRuntime = null;
        seekFromEvent(mouseEvent);
        expect(mockRuntime.seekAnimation).not.toHaveBeenCalled();
    });

    it('no-op when dom.seekBar is null', () => {
        const saved = mockDom.seekBar;
        mockDom.seekBar = null;
        seekFromEvent(mouseEvent);
        expect(mockRuntime.seekAnimation).not.toHaveBeenCalled();
        mockDom.seekBar = saved;
    });

    it('no-op when duration is 0', () => {
        mockState.mmdRuntime = { ...mockRuntime, animationDuration: 0 };
        seekFromEvent(mouseEvent);
        expect(mockRuntime.seekAnimation).not.toHaveBeenCalled();
    });

    it('seeks to correct position based on mouse position', () => {
        // seekBar rect: left=10, width=200 → clientX=60 → ratio=(60-10)/200=0.25
        // target = 0.25 * 120 = 30
        mockDom.seekBar.getBoundingClientRect.mockReturnValue({
            left: 10,
            width: 200,
            top: 0,
            right: 210,
            bottom: 30,
            height: 30,
        });
        seekFromEvent(mouseEvent);
        expect(mockState.mmdRuntime.seekAnimation).toHaveBeenCalledWith(30, true);
    });

    it('calls syncAudioPlayback after seek', () => {
        seekFromEvent(mouseEvent);
        expect(syncAudioPlayback).toHaveBeenCalled();
    });

    it('clamps ratio to [0, 1]', () => {
        // left=10, width=200, clientX=0 → ratio = max(0, (0-10)/200) = 0
        const eLeft = { clientX: 0 } as MouseEvent;
        seekFromEvent(eLeft);
        expect(mockState.mmdRuntime.seekAnimation).toHaveBeenCalledWith(0, true);

        // clientX=500 → ratio = min(1, (500-10)/200) = 1
        mockState.mmdRuntime.seekAnimation.mockClear();
        const eRight = { clientX: 500 } as MouseEvent;
        seekFromEvent(eRight);
        expect(mockState.mmdRuntime.seekAnimation).toHaveBeenCalledWith(120, true);
    });
});
