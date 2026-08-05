// [doc:adr-204] audio.test.ts 拆分：播放器生命周期（play/load/pause/resume/stop/clear/dispose）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioMockState, createMockStreamPlayer, resetAudioMockState } from './audio-helpers';
import {
    mockWailsBindings,
    mockState,
    mockConfig,
    mockBeatDetector,
    getTriggerAutoSave,
} from './audio-mocks';
import {
    playAudio,
    loadAudioFile,
    getAudioPath,
    getAudioName,
    pauseAudio,
    resumeAudio,
    stopAudio,
    clearAudio,
    disposeAudio,
    attachBeatDetector,
    getCurrentTime,
} from '@/core/audio';

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

describe('playAudio', () => {
    it('creates stream player and plays', async () => {
        await playAudio('http://test.mp3', 'test.mp3');
        expect(m.play).toHaveBeenCalled();
        expect(getAudioName()).toBe('test.mp3');
        expect(getAudioPath()).toBe('');
    });

    it('handles play rejection gracefully', async () => {
        m.play.mockRejectedValueOnce(new Error('autoplay blocked'));
        await expect(playAudio('http://test.mp3', 'test.mp3')).resolves.toBeUndefined();
    });
});

describe('loadAudioFile', () => {
    it('resolves URL, loads, and plays', async () => {
        m.metadataLoaded = true;
        await loadAudioFile('music/song.mp3');
        expect(m.play).toHaveBeenCalled();
        expect(getAudioName()).toBe('song.mp3');
        expect(getAudioPath()).toBe('music/song.mp3');
        expect(getTriggerAutoSave()).toHaveBeenCalled();
    });

    it('handles autoplay rejection silently', async () => {
        m.metadataLoaded = true;
        m.play.mockRejectedValueOnce(new Error('blocked'));
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
        expect(m.pause).toHaveBeenCalled();
    });

    it('pauseAudio is no-op when no player', () => {
        disposeAudio();
        expect(() => pauseAudio()).not.toThrow();
    });

    it('resumeAudio resumes when player exists', () => {
        void playAudio('test.mp3', 'test');
        resumeAudio();
        expect(m.play).toHaveBeenCalled();
    });

    it('resumeAudio is no-op when no player', () => {
        disposeAudio();
        expect(() => resumeAudio()).not.toThrow();
    });

    it('resumeAudio handles rejection', async () => {
        void playAudio('test.mp3', 'test');
        m.play.mockRejectedValueOnce(new Error('blocked'));
        resumeAudio();
        await vi.waitFor(() => expect(m.play).toHaveBeenCalled());
    });
});

describe('stopAudio', () => {
    it('pauses and resets currentTime to 0', () => {
        m.currentTime = 42;
        void playAudio('test.mp3', 'test');
        stopAudio();
        expect(m.pause).toHaveBeenCalled();
        expect(m.currentTime).toBe(0);
    });

    it('is no-op when no player', () => {
        expect(() => stopAudio()).not.toThrow();
    });
});

describe('clearAudio', () => {
    it('resets name/path and triggers auto-save', () => {
        void playAudio('test.mp3', 'test');
        clearAudio();
        expect(m.pause).toHaveBeenCalled();
        expect(getAudioName()).toBe('');
        expect(getAudioPath()).toBe('');
        expect(getTriggerAutoSave()).toHaveBeenCalled();
    });

    it('is no-op when no player', () => {
        expect(() => clearAudio()).not.toThrow();
    });
});

describe('disposeAudio', () => {
    it('cleans up audio player and beat detector', () => {
        void playAudio('test.mp3', 'test');
        attachBeatDetector(mockBeatDetector as any);
        disposeAudio();
        expect(m.pause).toHaveBeenCalled();
        expect(m.dispose).toHaveBeenCalled();
        expect(getAudioName()).toBe('');
        expect(getAudioPath()).toBe('');
        expect(mockBeatDetector.dispose).toHaveBeenCalled();
        expect(getCurrentTime()).toBe(0);
    });

    it('is safe when no audio or beat detector', () => {
        expect(() => disposeAudio()).not.toThrow();
    });
});
