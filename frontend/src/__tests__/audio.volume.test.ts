// [doc:adr-204] audio.test.ts 拆分：音量 / 偏移 / gain
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
    setVolume,
    getVolume,
    setAudioOffset,
    getAudioOffset,
    playAudio,
    attachBeatDetector,
    disposeAudio,
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
        expect(m.volume).toBe(0.3);
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

describe('setVolume applies gain', () => {
    it('setVolume calls applyGain to update stream player volume', () => {
        void playAudio('test.mp3', 'test');
        setVolume(0.7);
        expect(m.volume).toBe(0.7);
        setVolume(0.3);
        expect(m.volume).toBe(0.3);
    });
});
