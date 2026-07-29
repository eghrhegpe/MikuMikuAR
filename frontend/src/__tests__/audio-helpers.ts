// audio-helpers.ts — 纯 fixture / StreamAudioPlayer 桩构建（接收共享状态对象，避免 72 行重复）
import { vi } from 'vitest';

export interface AudioMockState {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    currentTime: number;
    volume: number;
    duration: number;
    paused: boolean;
    source: string;
    metadataLoaded: boolean;
    onDurationChanged: (() => void) | null;
}

export function createAudioMockState(): AudioMockState {
    return {
        play: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        pause: vi.fn(),
        dispose: vi.fn(),
        currentTime: 0,
        volume: 1,
        duration: 120,
        paused: true,
        source: '',
        metadataLoaded: false,
        onDurationChanged: null,
    };
}

// 构建 StreamAudioPlayer 实例，闭包读写同一份 AudioMockState（测试断言与 SUT 调用共享引用）
export function createMockStreamPlayer(m: AudioMockState): Record<string, any> {
    return {
        play: m.play,
        pause: m.pause,
        dispose: m.dispose,
        get currentTime() {
            return m.currentTime;
        },
        set currentTime(v: number) {
            m.currentTime = v;
        },
        get volume() {
            return m.volume;
        },
        set volume(v: number) {
            m.volume = v;
        },
        get duration() {
            return m.duration;
        },
        get paused() {
            return m.paused;
        },
        get source() {
            return m.source;
        },
        set source(v: string) {
            m.source = v;
        },
        get metadataLoaded() {
            return m.metadataLoaded;
        },
        onDurationChangedObservable: {
            add: vi.fn((cb: () => void) => {
                m.onDurationChanged = cb;
                return { remove: vi.fn() };
            }),
            removeCallback: vi.fn(),
            clear: vi.fn(),
        },
        onLoadErrorObservable: { clear: vi.fn() },
        onPlayObservable: { add: vi.fn(), clear: vi.fn() },
        onPauseObservable: { add: vi.fn(), clear: vi.fn() },
        onSeekObservable: { add: vi.fn(), clear: vi.fn() },
        onMuteStateChangedObservable: { clear: vi.fn() },
        onPlaybackRateChangedObservable: { clear: vi.fn() },
        mute: vi.fn(),
        unmute: vi.fn().mockResolvedValue(true),
        get muted() {
            return false;
        },
        get playbackRate() {
            return 1;
        },
        set playbackRate(_v: number) {},
        get preservesPitch() {
            return true;
        },
        set preservesPitch(_v: boolean) {},
        _setCurrentTimeWithoutNotify: vi.fn(),
        _setPlaybackRateWithoutNotify: vi.fn(),
        _audio: {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        } as unknown as HTMLAudioElement,
        // ADR-202 P2: fork 在 _audio 基础上加了公开 get audio()，mock 镜像此行为
        get audio() {
            return this._audio;
        },
    };
}

export function resetAudioMockState(m: AudioMockState) {
    m.play.mockReset().mockResolvedValue(undefined);
    m.pause.mockReset();
    m.dispose.mockReset();
    m.currentTime = 0;
    m.volume = 1;
    m.duration = 120;
    m.paused = true;
    m.source = '';
    m.metadataLoaded = false;
    m.onDurationChanged = null;
}
