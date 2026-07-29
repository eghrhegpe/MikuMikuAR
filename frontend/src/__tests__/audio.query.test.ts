// [doc:adr-204] audio.test.ts 拆分：查询 / 跳转 / 播放态 / 名称
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAudioMockState, createMockStreamPlayer, resetAudioMockState } from './audio-helpers';
import { mockWailsBindings, mockState, mockConfig, mockBeatDetector, getTriggerAutoSave } from './audio-mocks';
import {
    getCurrentTime,
    getDuration,
    seekAudio,
    isAudioPlaying,
    getAudioName,
    playAudio,
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

describe('getCurrentTime', () => {
    it('returns player.currentTime', () => {
        m.currentTime = 10.5;
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
        m.duration = 200;
        void playAudio('test.mp3', 'test');
        expect(getDuration()).toBe(200);
    });

    it('returns 0 when no player', () => {
        disposeAudio();
        expect(getDuration()).toBe(0);
    });

    it('returns 0 when duration is NaN', () => {
        m.duration = NaN;
        void playAudio('test.mp3', 'test');
        expect(getDuration()).toBe(0);
    });
});

describe('seekAudio', () => {
    it('clamps and seeks', () => {
        m.duration = 100;
        void playAudio('test.mp3', 'test');
        seekAudio(50);
        expect(m.currentTime).toBe(50);
    });

    it('clamps negative to 0', () => {
        m.duration = 100;
        void playAudio('test.mp3', 'test');
        seekAudio(-10);
        expect(m.currentTime).toBe(0);
    });

    it('clamps above duration to duration', () => {
        m.duration = 100;
        void playAudio('test.mp3', 'test');
        seekAudio(200);
        expect(m.currentTime).toBe(100);
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
        m.paused = true;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(false);
    });

    it('returns true when not paused', () => {
        m.paused = false;
        void playAudio('test.mp3', 'test');
        expect(isAudioPlaying()).toBe(true);
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
