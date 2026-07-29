// audio-mocks.ts — audio.test.ts 共享的可自包含 vi.mock 工厂（不依赖被测文件局部状态）
import { vi } from 'vitest';

// 最小合法 MP3 帧头（MPEG1 Layer3），供 readFileBytes 校验
export const MOCK_AUDIO_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

export const mockWailsBindings = () => ({
    readFileBytes: vi.fn(() => Promise.resolve(MOCK_AUDIO_BYTES)),
});

export const mockState = () => {
    if (!(globalThis as any).__audioTestUiState) {
        (globalThis as any).__audioTestUiState = { volume: 1, audioOffset: 0 };
    }
    return {
        get uiState() {
            return (globalThis as any).__audioTestUiState;
        },
    };
};

export const mockConfig = () => {
    const triggerAutoSave = vi.fn();
    (globalThis as any).__audioTestTriggerAutoSave = triggerAutoSave;
    return {
        triggerAutoSave,
        setUIState: (state: Record<string, unknown>) => {
            Object.assign((globalThis as any).__audioTestUiState, state);
        },
    };
};

export const getTriggerAutoSave = () => (globalThis as any).__audioTestTriggerAutoSave;

// BeatDetector 桩（各测试文件独立模块实例，beforeEach 统一复位）
export const mockBeatDetector = {
    attach: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
    reset: vi.fn(),
    setVolume: vi.fn(),
};
