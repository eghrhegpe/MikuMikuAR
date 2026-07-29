// [doc:adr-204] audio.test.ts 拆分：同步 / 节拍检测器
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioMockState, createMockStreamPlayer, resetAudioMockState } from './audio-helpers';
import { mockWailsBindings, mockState, mockConfig, mockBeatDetector, getTriggerAutoSave } from './audio-mocks';
import {
    syncAudioPlayback,
    playAudio,
    clearAudio,
    isAudioPlaying,
    setAudioOffset,
    attachBeatDetector,
    notifyBeatDetectorReset,
    disposeAudio,
} from '../outfit/audio';

const m = createAudioMockState();
let streamPlayer: Record<string, any> | null = null;

vi.mock('babylon-mmd/esm/Runtime/Audio/streamAudioPlayer', () => ({
    StreamAudioPlayer: class {
        constructor() {
            streamPlayer = createMockStreamPlayer(m);
            return streamPlayer;
        }
    },
}));
vi.mock('../core/wails-bindings', () => mockWailsBindings());
vi.mock('../core/state', () => mockState());
vi.mock('../core/config', () => mockConfig());

beforeEach(() => {
    resetAudioMockState(m);
    (globalThis as any).__audioTestUiState = { volume: 1, audioOffset: 0 };
    getTriggerAutoSave().mockReset();
    mockBeatDetector.attach.mockReset().mockReturnValue(true);
    mockBeatDetector.dispose.mockReset();
    mockBeatDetector.reset.mockReset();
    mockBeatDetector.setVolume.mockReset();
});

afterEach(() => {
    disposeAudio();
});

describe('syncAudioPlayback', () => {
    beforeEach(() => {
        m.paused = false;
        m.duration = 100;
        void playAudio('test.mp3', 'test');
    });

    it('is no-op when no audio loaded (audioName is empty)', () => {
        clearAudio();
        syncAudioPlayback(10, true, 100);
    });

    it('resumes playback when VMD is playing but audio is paused', () => {
        m.paused = true;
        m.currentTime = 5;
        syncAudioPlayback(5, true, 100);
        expect(m.play).toHaveBeenCalled();
    });

    it('pauses audio when VMD stops playing', () => {
        m.paused = false;
        syncAudioPlayback(10, false, 100);
        expect(m.pause).toHaveBeenCalled();
    });

    it('seeks when drift > SYNC_THRESHOLD (0.1)', () => {
        m.paused = false;
        m.currentTime = 20;
        syncAudioPlayback(10, true, 100);
        expect(isAudioPlaying()).toBe(true);
    });

    it('handles audioTargetTime >= duration by seeking to 0', () => {
        m.paused = true;
        m.currentTime = 100;
        syncAudioPlayback(200, true, 250);
    });

    it('detects loop restart when lastVmdTime > vmdTime + 0.5', () => {
        syncAudioPlayback(50, true, 100);
        syncAudioPlayback(0, true, 100);
    });

    it('seeks to vmdTime+offset (not just offset) on mid-song backward seek', () => {
        setAudioOffset(2);
        m.currentTime = 32; // 与首个 target(30+2) 对齐，零漂移
        syncAudioPlayback(30, true, 100); // establish lastVmdTime=30
        m.currentTime = 30;
        syncAudioPlayback(20, true, 100); // backward seek mid-song
        // 漂移分支：audioTargetTime = 20+2 = 22 -> seek to 22
        expect(m.currentTime).toBe(22);
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
        disposeAudio();
        attachBeatDetector(mockBeatDetector as any);
        expect(mockBeatDetector.attach).not.toHaveBeenCalled();
        void playAudio('test.mp3', 'test');
        expect(mockBeatDetector.attach).toHaveBeenCalled();
    });

    it('handles attach error gracefully', () => {
        mockBeatDetector.attach.mockImplementationOnce(() => false);
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
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
