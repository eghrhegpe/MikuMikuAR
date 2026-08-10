// audio 系列合并（player/query/sync/volume 4 文件 → 1）
// [2026-08] 同系列合并以省 isolate 单文件 import 成本（vitest.config 同款先例）。
// 4 文件结构完全同构：全 node 环境 + 相同 4 条 vi.mock（streamAudioPlayer/
// wails-bindings/state/config）+ 相同 beforeEach/afterEach + 共享 audio-helpers
// 工厂，共享样板原在 4 文件重复 4 份，现收敛为一份。各 describe 按原主题分区
// 保留，行为不变。
// @vitest-environment node
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
    getDuration,
    seekAudio,
    isAudioPlaying,
    syncAudioPlayback,
    notifyBeatDetectorReset,
    setVolume,
    getVolume,
    setAudioOffset,
    getAudioOffset,
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

// ======== 播放器生命周期（原 audio.player.test.ts） ========
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

// ======== 查询 / 跳转 / 播放态 / 名称（原 audio.query.test.ts） ========
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

// ======== 同步 / 节拍检测器（原 audio.sync.test.ts） ========
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

// ======== 音量 / 偏移 / gain（原 audio.volume.test.ts） ========
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
