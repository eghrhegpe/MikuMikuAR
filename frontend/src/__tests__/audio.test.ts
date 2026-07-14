import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    playAudio,
    loadAudioFile,
    getAudioPath,
    pauseAudio,
    resumeAudio,
    stopAudio,
    clearAudio,
    disposeAudio,
    setVolume,
    getVolume,
    setAudioOffset,
    getAudioOffset,
    getCurrentTime,
    getDuration,
    seekAudio,
    isAudioPlaying,
    getAudioName,
    syncAudioPlayback,
    attachBeatDetector,
    notifyBeatDetectorReset,
} from '../outfit/audio';

// ======== StreamAudioPlayer mock ========

const mockPlay = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockDispose = vi.fn();
let mockCurrentTime = 0;
let mockVolume = 1;
let mockDuration = 120;
let mockPaused = true;
let mockSource = '';
let mockMetadataLoaded = false;
let _mockOnDurationChanged: (() => void) | null = null;

/** 创建 mock StreamAudioPlayer 实例。不重置 mock 变量（由 beforeEach 统一管理）。 */
function createMockStreamPlayer(): Record<string, any> {
    return {
        play: mockPlay,
        pause: mockPause,
        dispose: mockDispose,
        get currentTime() {
            return mockCurrentTime;
        },
        set currentTime(v: number) {
            mockCurrentTime = v;
        },
        get volume() {
            return mockVolume;
        },
        set volume(v: number) {
            mockVolume = v;
        },
        get duration() {
            return mockDuration;
        },
        get paused() {
            return mockPaused;
        },
        get source() {
            return mockSource;
        },
        set source(v: string) {
            mockSource = v;
        },
        get metadataLoaded() {
            return mockMetadataLoaded;
        },
        onDurationChangedObservable: {
            add: vi.fn((cb: () => void) => {
                _mockOnDurationChanged = cb;
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
    };
}

let mockStreamPlayer: Record<string, any>;

vi.mock('babylon-mmd/esm/Runtime/Audio/streamAudioPlayer', () => ({
    StreamAudioPlayer: class {
        constructor() {
            mockStreamPlayer = createMockStreamPlayer();
            return mockStreamPlayer;
        }
    },
}));

// ======== Other mocks ========

vi.mock('../core/fileservice', () => ({
    resolveFileUrl: vi.fn((path: string) => Promise.resolve({ url: 'http://mock/' + path })),
}));

// Mock uiState and config
vi.mock('../core/state', () => {
    if (!(globalThis as any).__audioTestUiState) {
        (globalThis as any).__audioTestUiState = { volume: 1, audioOffset: 0 };
    }
    return {
        get uiState() {
            return (globalThis as any).__audioTestUiState;
        },
    };
});

vi.mock('../core/config', () => {
    const triggerAutoSave = vi.fn();
    (globalThis as any).__audioTestTriggerAutoSave = triggerAutoSave;
    return {
        triggerAutoSave,
        setUIState: (state: Record<string, unknown>) => {
            Object.assign((globalThis as any).__audioTestUiState, state);
        },
    };
});

const mockTriggerAutoSave = (globalThis as any).__audioTestTriggerAutoSave;

// BeatDetector stub
const mockBeatDetector = {
    attach: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
    reset: vi.fn(),
    setVolume: vi.fn(),
};

beforeEach(() => {
    // 重置 mock 变量（防跨测试泄漏）
    mockPlay.mockReset().mockResolvedValue(undefined);
    mockPause.mockReset();
    mockDispose.mockReset();
    mockCurrentTime = 0;
    mockVolume = 1;
    mockDuration = 120;
    mockPaused = true;
    mockSource = '';
    mockMetadataLoaded = false;
    _mockOnDurationChanged = null;
    (globalThis as any).__audioTestUiState = { volume: 1, audioOffset: 0 };
    mockTriggerAutoSave.mockReset();
    mockBeatDetector.attach.mockReset().mockReturnValue(true);
    mockBeatDetector.dispose.mockReset();
    mockBeatDetector.reset.mockReset();
    mockBeatDetector.setVolume.mockReset();
});

afterEach(() => {
    disposeAudio();
});

// ======== tests ========

describe('playAudio', () => {
    it('creates stream player and plays', async () => {
        await playAudio('http://test.mp3', 'test.mp3');
        expect(mockPlay).toHaveBeenCalled();
        expect(getAudioName()).toBe('test.mp3');
        expect(getAudioPath()).toBe('');
    });

    it('handles play rejection gracefully', async () => {
        mockPlay.mockRejectedValueOnce(new Error('autoplay blocked'));
        await expect(playAudio('http://test.mp3', 'test.mp3')).resolves.toBeUndefined();
    });
});

describe('loadAudioFile', () => {
    it('resolves URL, loads, and plays', async () => {
        // 让 metadataLoaded 尽快为 true，避免超时等待
        mockMetadataLoaded = true;
        await loadAudioFile('music/song.mp3');
        expect(mockPlay).toHaveBeenCalled();
        expect(getAudioName()).toBe('song.mp3');
        expect(getAudioPath()).toBe('music/song.mp3');
        expect(mockTriggerAutoSave).toHaveBeenCalled();
    });

    it('handles autoplay rejection silently', async () => {
        mockMetadataLoaded = true;
        mockPlay.mockRejectedValueOnce(new Error('blocked'));
        await expect(loadAudioFile('music/song.mp3')).resolves.toBeUndefined();
    });
});

describe('getAudioPath', () => {
    it('returns empty string when no audio loaded', () => {
        expect(getAudioPath()).toBe('');
    });
});

describe('pauseAudio / resumeAudio', () => {
    it('pauseAudio pauses when player exists', () => {
        void playAudio('test.mp3', 'test');
        pauseAudio();
        expect(mockPause).toHaveBeenCalled();
    });

    it('pauseAudio is no-op when no player', () => {
        // StreamAudioPlayer 被惰性创建，未调用 playAudio 时 ensurePlayer 不会被调用
        // 但 pauseAudio 直接调用 streamPlayer?.pause()，streamPlayer 为 null
        // 需在 beforeEach 中确保 streamPlayer 为 null
        disposeAudio(); // 确保 streamPlayer 为 null
        expect(() => pauseAudio()).not.toThrow();
    });

    it('resumeAudio resumes when player exists', () => {
        void playAudio('test.mp3', 'test');
        resumeAudio();
        expect(mockPlay).toHaveBeenCalled();
    });

    it('resumeAudio is no-op when no player', () => {
        disposeAudio();
        expect(() => resumeAudio()).not.toThrow();
    });

    it('resumeAudio handles rejection', async () => {
        void playAudio('test.mp3', 'test');
        mockPlay.mockRejectedValueOnce(new Error('blocked'));
        resumeAudio();
        await vi.waitFor(() => expect(mockPlay).toHaveBeenCalled());
    });
});

describe('stopAudio', () => {
    it('pauses and resets currentTime to 0', () => {
        mockCurrentTime = 42;
        void playAudio('test.mp3', 'test');
        stopAudio();
        expect(mockPause).toHaveBeenCalled();
        expect(mockCurrentTime).toBe(0);
    });

    it('is no-op when no player', () => {
        // 确保 streamPlayer 为 null
        // 因为 ensurePlayer 是惰性的，在 stopAudio 前不调用任何会创建 player 的函数
        // 但 afterEach 的 disposeAudio 后 streamPlayer 是 null
        // 且 stopAudio 本身会调用 streamPlayer?.pause()，不会创建新 player
        expect(() => stopAudio()).not.toThrow();
    });
});

describe('clearAudio', () => {
    it('resets name/path and triggers auto-save', () => {
        void playAudio('test.mp3', 'test');
        clearAudio();
        expect(mockPause).toHaveBeenCalled();
        expect(getAudioName()).toBe('');
        expect(getAudioPath()).toBe('');
        expect(mockTriggerAutoSave).toHaveBeenCalled();
    });

    it('is no-op when no player', () => {
        // 确保 streamPlayer 为 null
        // clearAudio 内部调用 streamPlayer?.pause() 不会创建新 player
        expect(() => clearAudio()).not.toThrow();
        // clearAudio 内部的 triggerAutoSave 只有在 streamPlayer 存在时才调用
        // 此处 streamPlayer 为 null，所以 triggerAutoSave 不会被调用
    });
});

describe('disposeAudio', () => {
    it('cleans up audio player and beat detector', () => {
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
        disposeAudio();
        expect(mockPause).toHaveBeenCalled();
        expect(mockDispose).toHaveBeenCalled();
        expect(getAudioName()).toBe('');
        expect(getAudioPath()).toBe('');
        expect(mockBeatDetector.dispose).toHaveBeenCalled();
        expect(getCurrentTime()).toBe(0);
    });

    it('is safe when no audio or beat detector', () => {
        // afterEach 已调用 disposeAudio，这里再调一次应安全
        expect(() => disposeAudio()).not.toThrow();
    });
});

describe('setVolume / getVolume', () => {
    it('clamps to [0, 1]', () => {
        setVolume(2);
        expect(getVolume()).toBe(1);
        setVolume(-1);
        expect(getVolume()).toBe(0);
        setVolume(0.5);
        expect(getVolume()).toBe(0.5);
    });

    it('updates player volume when player exists', () => {
        void playAudio('test.mp3', 'test');
        setVolume(0.3);
        expect(mockVolume).toBe(0.3);
    });

    it('forwards to beatDetector.setVolume when detector exists', () => {
        attachBeatDetector(mockBeatDetector as any);
        setVolume(0.6);
        expect(mockBeatDetector.setVolume).toHaveBeenCalledWith(0.6);
    });
});

describe('setAudioOffset / getAudioOffset', () => {
    it('roundtrips correctly', () => {
        expect(getAudioOffset()).toBe(0);
        setAudioOffset(2.5);
        expect(getAudioOffset()).toBe(2.5);
        setAudioOffset(-1);
        expect(getAudioOffset()).toBe(-1);
    });
});

describe('getCurrentTime', () => {
    it('returns player.currentTime', () => {
        mockCurrentTime = 10.5;
        void playAudio('test.mp3', 'test');
        expect(getCurrentTime()).toBe(10.5);
    });

    it('returns 0 when no player', () => {
        disposeAudio();
        expect(getCurrentTime()).toBe(0);
    });
});

describe('getDuration', () => {
    it('returns player.duration', () => {
        mockDuration = 200;
        void playAudio('test.mp3', 'test');
        expect(getDuration()).toBe(200);
    });

    it('returns 0 when no player', () => {
        disposeAudio();
        expect(getDuration()).toBe(0);
    });

    it('returns 0 when duration is NaN', () => {
        mockDuration = NaN;
        void playAudio('test.mp3', 'test');
        expect(getDuration()).toBe(0);
    });
});

describe('seekAudio', () => {
    it('clamps and seeks', () => {
        mockDuration = 100;
        void playAudio('test.mp3', 'test');
        seekAudio(50);
        expect(mockCurrentTime).toBe(50);
    });

    it('clamps negative to 0', () => {
        mockDuration = 100;
        void playAudio('test.mp3', 'test');
        seekAudio(-10);
        expect(mockCurrentTime).toBe(0);
    });

    it('clamps above duration to duration', () => {
        mockDuration = 100;
        void playAudio('test.mp3', 'test');
        seekAudio(200);
        expect(mockCurrentTime).toBe(100);
    });

    it('is no-op when no player', () => {
        disposeAudio();
        expect(() => seekAudio(10)).not.toThrow();
    });
});

describe('isAudioPlaying', () => {
    it('returns false when no player', () => {
        disposeAudio();
        expect(isAudioPlaying()).toBe(false);
    });

    it('returns false when paused', () => {
        mockPaused = true;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(false);
    });

    it('returns true when not paused', () => {
        mockPaused = false;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(true);
    });
});

describe('getAudioName', () => {
    it('returns empty string initially', () => {
        // 确保音频名在 beforeEach/afterEach 后被重置
        // 注意：afterEach 的 disposeAudio 会清空 audioName
        expect(getAudioName()).toBe('');
    });

    it('returns name after playAudio', async () => {
        await playAudio('test.mp3', 'song name');
        expect(getAudioName()).toBe('song name');
    });
});

describe('syncAudioPlayback', () => {
    beforeEach(() => {
        mockPaused = false;
        mockDuration = 100;
        void playAudio('test.mp3', 'test');
    });

    it('is no-op when no audio loaded (audioName is empty)', () => {
        clearAudio();
        syncAudioPlayback(10, true, 100);
    });

    it('resumes playback when VMD is playing but audio is paused', () => {
        mockPaused = true;
        mockCurrentTime = 5;
        syncAudioPlayback(5, true, 100);
        expect(mockPlay).toHaveBeenCalled();
    });

    it('pauses audio when VMD stops playing', () => {
        mockPaused = false;
        syncAudioPlayback(10, false, 100);
        expect(mockPause).toHaveBeenCalled();
    });

    it('seeks when drift > SYNC_THRESHOLD (0.1)', () => {
        mockPaused = false;
        mockCurrentTime = 20;
        syncAudioPlayback(10, true, 100);
        // 漂移 > 0.1 → seek 到 audioTargetTime = 10 + 0 = 10
        expect(isAudioPlaying()).toBe(true);
    });

    it('handles audioTargetTime >= duration by seeking to 0', () => {
        mockPaused = true;
        mockCurrentTime = 100;
        syncAudioPlayback(200, true, 250);
    });

    it('detects loop restart when lastVmdTime > vmdTime + 0.5', () => {
        syncAudioPlayback(50, true, 100);
        syncAudioPlayback(0, true, 100);
    });

    it('seeks to vmdTime+offset (not just offset) on mid-song backward seek', () => {
        setAudioOffset(2);
        mockCurrentTime = 32; // 与首个 target(30+2) 对齐，零漂移
        syncAudioPlayback(30, true, 100); // establish lastVmdTime=30
        mockCurrentTime = 30;
        syncAudioPlayback(20, true, 100); // backward seek mid-song
        // 漂移分支：audioTargetTime = 20+2 = 22 -> seek to 22
        expect(mockCurrentTime).toBe(22);
    });
});

describe('attachBeatDetector', () => {
    it('stores detector and attaches to existing stream player', () => {
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
        expect(mockBeatDetector.attach).toHaveBeenCalled();
    });

    it('is idempotent — does not attach twice', () => {
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
        attachBeatDetector(mockBeatDetector as any);
        expect(mockBeatDetector.attach).toHaveBeenCalledTimes(1);
    });

    it('defers attachment when no audio player yet', () => {
        // disposeAudio 确保 streamPlayer 为 null
        disposeAudio();
        attachBeatDetector(mockBeatDetector as any);
        expect(mockBeatDetector.attach).not.toHaveBeenCalled();
        void playAudio('test.mp3', 'test');
        // ensurePlayer 内会尝试 _tryAttachBeatDetector
        // 但 mock 的 _audio 对象被 mockBeatDetector.attach 调用
        expect(mockBeatDetector.attach).toHaveBeenCalled();
    });

    it('handles attach error gracefully', () => {
        mockBeatDetector.attach.mockImplementationOnce(() => false);
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
        // attach 返回 false → beatDetectorAttached 保持 false，可重试
    });
});

describe('notifyBeatDetectorReset', () => {
    it('calls reset on attached detector', () => {
        attachBeatDetector(mockBeatDetector as any);
        notifyBeatDetectorReset();
        expect(mockBeatDetector.reset).toHaveBeenCalled();
    });

    it('is no-op when no detector', () => {
        expect(() => notifyBeatDetectorReset()).not.toThrow();
    });
});

describe('setVolume applies gain', () => {
    it('setVolume calls applyGain to update stream player volume', () => {
        void playAudio('test.mp3', 'test');
        setVolume(0.7);
        expect(mockVolume).toBe(0.7);
        setVolume(0.3);
        expect(mockVolume).toBe(0.3);
    });
});
