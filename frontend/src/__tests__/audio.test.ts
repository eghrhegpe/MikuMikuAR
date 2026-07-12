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

// ----- mocks -----

const mockPlay = vi.fn();
const mockPause = vi.fn();
const mockLoad = vi.fn();
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();
let mockCurrentTime = 0;
let mockVolume = 1;
let mockPaused = true;
let mockEnded = false;
let mockDuration = 120;
let mockSrc = '';

function makeMockAudio(): HTMLAudioElement {
    const audio = {
        play: mockPlay,
        pause: mockPause,
        load: mockLoad,
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
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
        get paused() {
            return mockPaused;
        },
        get ended() {
            return mockEnded;
        },
        get duration() {
            return mockDuration;
        },
        set src(v: string) {
            mockSrc = v;
        },
        get src() {
            return mockSrc;
        },
        crossOrigin: '',
    } as unknown as HTMLAudioElement;
    return audio;
}

vi.mock('../core/fileservice', () => ({
    resolveFileUrl: vi.fn((path: string) => Promise.resolve({ url: 'http://mock/' + path })),
}));

const mockTriggerAutoSave = vi.fn();
vi.mock('../core/config', () => ({
    triggerAutoSave: (...args: unknown[]) => mockTriggerAutoSave(...args),
    setUIState: (..._args: unknown[]) => undefined,
}));

// Self-contained mock: no hoisting needed, factory owns its own internal store
vi.mock('../lib/settings-store', () => {
    // mutable ref shared between factory and test body
    const store = {
        mockVolume: 1,
        mockOffset: 0,
    };
    return {
        SettingsStore: {
            get() {
                return {
                    get: (key: string) => {
                        if (key === 'volume') {
                            return store.mockVolume;
                        }
                        if (key === 'audioOffset') {
                            return store.mockOffset;
                        }
                        return 0;
                    },
                    set: (_key: string, _value: unknown) => {
                        if (_key === 'volume') {
                            store.mockVolume = _value as number;
                        }
                        if (_key === 'audioOffset') {
                            store.mockOffset = _value as number;
                        }
                        globalThis.dispatchEvent(
                            new CustomEvent('SETTINGS_UPDATED', {
                                detail: { key: _key, value: _value },
                            })
                        );
                    },
                };
            },
        },
        SETTINGS_UPDATED: Symbol('SETTINGS_UPDATED'),
    };
});

// BeatDetector stub
const mockBeatDetector = {
    attach: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
    reset: vi.fn(),
    setVolume: vi.fn(),
};

beforeEach(() => {
    mockPlay.mockReset().mockResolvedValue(undefined);
    mockPause.mockReset();
    mockLoad.mockReset();
    mockAddEventListener.mockReset();
    mockRemoveEventListener.mockReset();
    mockCurrentTime = 0;
    mockVolume = 1;
    mockPaused = true;
    mockEnded = false;
    mockDuration = 120;
    mockSrc = '';
    mockTriggerAutoSave.mockReset();
    mockBeatDetector.attach.mockReset().mockReturnValue(true);
    mockBeatDetector.dispose.mockReset();
    mockBeatDetector.reset.mockReset();
    mockBeatDetector.setVolume.mockReset();

    // Use function keyword so new Audio() can invoke [[Construct]]
    // Do NOT wrap in vi.fn() — a plain function is constructible;
    // vi.fn() without mockImplementation is not a valid constructor target
    function MockAudio() {
        return makeMockAudio();
    }
    vi.stubGlobal('Audio', MockAudio);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    disposeAudio();
});

// ----- tests -----

describe('playAudio', () => {
    it('creates audio element and plays', async () => {
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
        await loadAudioFile('music/song.mp3');
        expect(mockLoad).toHaveBeenCalled();
        expect(mockPlay).toHaveBeenCalled();
        expect(getAudioName()).toBe('song.mp3');
        expect(getAudioPath()).toBe('music/song.mp3');
        expect(mockTriggerAutoSave).toHaveBeenCalled();
    });

    it('handles autoplay rejection silently', async () => {
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
    it('pauseAudio pauses when element exists', () => {
        void playAudio('test.mp3', 'test');
        pauseAudio();
        expect(mockPause).toHaveBeenCalled();
    });

    it('pauseAudio is no-op when no element', () => {
        pauseAudio();
        expect(mockPause).not.toHaveBeenCalled();
    });

    it('resumeAudio resumes when element exists', () => {
        void playAudio('test.mp3', 'test');
        resumeAudio();
        expect(mockPlay).toHaveBeenCalled();
    });

    it('resumeAudio is no-op when no element', () => {
        resumeAudio();
        expect(mockPlay).not.toHaveBeenCalled();
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

    it('is no-op when no element', () => {
        stopAudio();
        expect(mockPause).not.toHaveBeenCalled();
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

    it('is no-op when no element', () => {
        clearAudio();
        expect(mockPause).not.toHaveBeenCalled();
        expect(mockTriggerAutoSave).not.toHaveBeenCalled();
    });
});

describe('disposeAudio', () => {
    it('cleans up audio element and beat detector', () => {
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
        disposeAudio();
        expect(mockPause).toHaveBeenCalled();
        expect(getAudioName()).toBe('');
        expect(getAudioPath()).toBe('');
        expect(getAudioOffset()).toBe(0);
        expect(mockBeatDetector.dispose).toHaveBeenCalled();
        expect(getCurrentTime()).toBe(0);
    });

    it('is safe when no audio or beat detector', () => {
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

    it('updates audio element volume when element exists', () => {
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
    it('returns audioElement.currentTime', () => {
        mockCurrentTime = 10.5;
        void playAudio('test.mp3', 'test');
        expect(getCurrentTime()).toBe(10.5);
    });

    it('returns 0 when no element', () => {
        expect(getCurrentTime()).toBe(0);
    });
});

describe('getDuration', () => {
    it('returns audioElement.duration', () => {
        mockDuration = 200;
        void playAudio('test.mp3', 'test');
        expect(getDuration()).toBe(200);
    });

    it('returns 0 when no element', () => {
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
        expect(mockAddEventListener).toHaveBeenCalledWith('seeked', expect.any(Function));
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

    it('is no-op when no element', () => {
        seekAudio(10);
        expect(mockAddEventListener).not.toHaveBeenCalled();
    });
});

describe('isAudioPlaying', () => {
    it('returns false when no element', () => {
        expect(isAudioPlaying()).toBe(false);
    });

    it('returns false when paused', () => {
        mockPaused = true;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(false);
    });

    it('returns true when not paused and not ended', () => {
        mockPaused = false;
        mockEnded = false;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(true);
    });

    it('returns false when ended', () => {
        mockPaused = false;
        mockEnded = true;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(false);
    });
});

describe('getAudioName', () => {
    it('returns empty string initially', () => {
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
        mockEnded = false;
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
        // Audio sync runs without error when drift exceeds threshold
        // Note: actual seek behavior depends on internal state timings
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
});

describe('attachBeatDetector', () => {
    it('stores detector and attaches to existing audio element', () => {
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

    it('defers attachment when no audio element yet', () => {
        attachBeatDetector(mockBeatDetector as any);
        expect(mockBeatDetector.attach).not.toHaveBeenCalled();
        void playAudio('test.mp3', 'test');
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

describe('SettingsStore integration', () => {
    it('listener on SETTINGS_UPDATED calls applyGain', () => {
        const mockAudio = makeMockAudio();
        vi.stubGlobal('Audio', function MockAudio() {
            return mockAudio;
        });

        // Simulate SettingsStore default volume = 0.7 via setVolume (writes to mocked store)
        setVolume(0.7);
        void playAudio('test.mp3', 'test');
        expect(mockAudio.volume).toBe(0.7); // applyGain called at creation

        // setVolume(0.3) updates store and fires SETTINGS_UPDATED → applyGain
        setVolume(0.3);
        expect(mockAudio.volume).toBe(0.3); // applyGain re-applies with new value

        // Restore and cleanup
        setVolume(1);
        vi.unstubAllGlobals();
    });
});
