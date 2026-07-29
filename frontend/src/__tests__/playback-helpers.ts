// playback-helpers.ts — 纯 fixture / observable 桩助手（无 vi.hoisted 依赖）
// 注意：vi.hoisted 持有的 mockState / mockDom / syncAudioPlayback 等因 hoist 约束
// 不能 export 跨文件，必须内联在各 playback.*.test.ts 中。
import { vi } from 'vitest';

export function makeObsMock() {
    const handlers: Array<() => void> = [];
    const observers: Array<object> = [];
    return {
        add: vi.fn((h: () => void) => {
            handlers.push(h);
            const obs = {};
            observers.push(obs);
            return obs;
        }),
        remove: vi.fn((obs: object) => {
            const idx = observers.indexOf(obs);
            if (idx >= 0) {
                handlers.splice(idx, 1);
                observers.splice(idx, 1);
            }
        }),
        removeCallback: vi.fn((h: () => void) => {
            const idx = handlers.indexOf(h);
            if (idx >= 0) {
                handlers.splice(idx, 1);
                observers.splice(idx, 1);
            }
        }),
        _fire: () => {
            handlers.forEach((h) => h());
        },
    };
}

export function _createMockRuntime() {
    return {
        onAnimationTickObservable: makeObsMock(),
        onPlayAnimationObservable: makeObsMock(),
        onPauseAnimationObservable: makeObsMock(),
        animationDuration: 120,
        currentTime: 0,
        seekAnimation: vi.fn().mockResolvedValue(undefined),
        playAnimation: vi.fn().mockResolvedValue(undefined),
    };
}

export const tickObs = makeObsMock();
export const playObs = makeObsMock();
export const pauseObs = makeObsMock();

export const mockRuntime = {
    onAnimationTickObservable: tickObs,
    onPlayAnimationObservable: playObs,
    onPauseAnimationObservable: pauseObs,
    animationDuration: 120,
    currentTime: 0,
    seekAnimation: vi.fn().mockResolvedValue(undefined),
    playAnimation: vi.fn().mockResolvedValue(undefined),
};

export const mockManager = { focused: vi.fn() };
