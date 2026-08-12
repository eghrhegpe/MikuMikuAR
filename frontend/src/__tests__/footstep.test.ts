// @vitest-environment node
// footstep.test.ts — 脚步声控制器单测（ADR-088 Phase A + B）
// 覆盖 P2#10 缺口：resolveGroundSfxKind 地面映射、startFootstep/stopFootstep 生命周期、
// 落地回调的合成音色触发（音量归一化 / 左右声像 / 开关门控）、合成缓存惰性生成。
// 完全 mock audio-bus / state / feet-adjustment / footstep-detect-fallback，隔离业务逻辑。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => {
    const getAudioContext = vi.fn();
    const getSfxEnabled = vi.fn(() => true);
    const getFootstepVolume = vi.fn(() => 0.8);
    const playSfx = vi.fn();
    const setOnFootLand = vi.fn();
    const isFeetAdjustmentRunning = vi.fn(() => true);
    const startFallbackDetection = vi.fn();
    const stopFallbackDetection = vi.fn();
    const uiState = { footstepEnabled: true };
    const envState = {
        waterEnabled: false,
        groundType: 'flat',
        groundStyle: 'color',
        groundTexture: '',
    };
    return {
        getAudioContext,
        getSfxEnabled,
        getFootstepVolume,
        playSfx,
        setOnFootLand,
        isFeetAdjustmentRunning,
        startFallbackDetection,
        stopFallbackDetection,
        uiState,
        envState,
    };
});

vi.mock('@/core/audio-bus', () => ({
    getAudioContext: shared.getAudioContext,
    getSfxEnabled: shared.getSfxEnabled,
    getFootstepVolume: shared.getFootstepVolume,
    playSfx: shared.playSfx,
}));
vi.mock('@/core/state', () => ({
    uiState: shared.uiState,
    envState: shared.envState,
}));
vi.mock('../scene/motion/feet-adjustment', () => ({
    setOnFootLand: shared.setOnFootLand,
    isFeetAdjustmentRunning: shared.isFeetAdjustmentRunning,
}));
vi.mock('../scene/motion/footstep-detect-fallback', () => ({
    startFallbackDetection: shared.startFallbackDetection,
    stopFallbackDetection: shared.stopFallbackDetection,
}));

import {
    resolveGroundSfxKind,
    startFootstep,
    stopFootstep,
} from '../scene/motion/footstep';
import type { FootLandEvent } from '../motion-algos/feet-event';

/** 构造一个可用的假 AudioContext（createBuffer 返回可写 Float32Array buffer）。 */
function installAudioContext(sampleRate = 48000): void {
    shared.getAudioContext.mockReturnValue({
        sampleRate,
        createBuffer: vi.fn((_ch: number, len: number, sr: number) => ({
            numberOfChannels: 1,
            length: len,
            sampleRate: sr,
            getChannelData: vi.fn(() => new Float32Array(len)),
        })),
    });
}

/** 捕获 startFootstep 注册的落地回调（取最近一次注册）。 */
function captureCallback(scene: unknown): (e: FootLandEvent) => void {
    startFootstep(scene as never);
    const calls = shared.setOnFootLand.mock.calls;
    return calls[calls.length - 1][0] as (e: FootLandEvent) => void;
}

const scene = { activeCamera: { position: { x: 0 } } };

function makeEvent(over: Partial<FootLandEvent> = {}): FootLandEvent {
    return {
        modelId: 'm1',
        foot: 'R',
        groundY: 0,
        impactSpeed: 3,
        worldX: 0,
        worldZ: 0,
        ...over,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    installAudioContext();
    shared.uiState.footstepEnabled = true;
    shared.getSfxEnabled.mockReturnValue(true);
    shared.getFootstepVolume.mockReturnValue(0.8);
    shared.isFeetAdjustmentRunning.mockReturnValue(true);
    shared.envState.waterEnabled = false;
    shared.envState.groundType = 'flat';
    shared.envState.groundStyle = 'color';
    shared.envState.groundTexture = '';
    stopFootstep(); // 清空模块级 _synthCache + 注销回调，保证跨用例隔离
});

describe('resolveGroundSfxKind（地面 → 音色映射）', () => {
    it('waterEnabled → water（最高优先级）', () => {
        shared.envState.waterEnabled = true;
        shared.envState.groundStyle = 'texture';
        shared.envState.groundTexture = 'grass';
        expect(resolveGroundSfxKind()).toBe('water');
    });

    it('groundType=terrain → concrete', () => {
        shared.envState.groundType = 'terrain';
        expect(resolveGroundSfxKind()).toBe('concrete');
    });

    it('terrain 优先级高于 texture 纹理（terrain+grass 纹理 → concrete）', () => {
        shared.envState.groundType = 'terrain';
        shared.envState.groundStyle = 'texture';
        shared.envState.groundTexture = 'grass_01';
        expect(resolveGroundSfxKind()).toBe('concrete');
    });

    it('water 优先级高于 terrain（water+terrain → water）', () => {
        shared.envState.waterEnabled = true;
        shared.envState.groundType = 'terrain';
        expect(resolveGroundSfxKind()).toBe('water');
    });

    it('texture 含 grass/草 → grass', () => {
        shared.envState.groundStyle = 'texture';
        shared.envState.groundTexture = 'grass_01';
        expect(resolveGroundSfxKind()).toBe('grass');
        shared.envState.groundTexture = '草地';
        expect(resolveGroundSfxKind()).toBe('grass');
    });

    it('texture 含 wood/木 → wood', () => {
        shared.envState.groundStyle = 'texture';
        shared.envState.groundTexture = 'wood_floor';
        expect(resolveGroundSfxKind()).toBe('wood');
        shared.envState.groundTexture = '木地板';
        expect(resolveGroundSfxKind()).toBe('wood');
    });

    it('texture 其他 → default', () => {
        shared.envState.groundStyle = 'texture';
        shared.envState.groundTexture = 'marble';
        expect(resolveGroundSfxKind()).toBe('default');
    });

    it('非 texture 样式 → default', () => {
        shared.envState.groundStyle = 'color';
        expect(resolveGroundSfxKind()).toBe('default');
    });

    it('groundTexture 为空/null/undefined 时不抛错 → default', () => {
        shared.envState.groundStyle = 'texture';
        shared.envState.groundTexture = '';
        expect(resolveGroundSfxKind()).toBe('default');
        shared.envState.groundTexture = undefined as unknown as string;
        expect(resolveGroundSfxKind()).toBe('default');
        shared.envState.groundTexture = null as unknown as string;
        expect(resolveGroundSfxKind()).toBe('default');
    });
});

describe('startFootstep / stopFootstep（生命周期）', () => {
    it('startFootstep 注册落地回调', () => {
        startFootstep(scene as never);
        const calls = shared.setOnFootLand.mock.calls;
        expect(typeof calls[calls.length - 1][0]).toBe('function');
    });

    it('脚部跟随未开启时启动降级检测（传同一回调）', () => {
        shared.isFeetAdjustmentRunning.mockReturnValue(false);
        startFootstep(scene as never);
        const calls = shared.setOnFootLand.mock.calls;
        const cb = calls[calls.length - 1][0];
        expect(shared.startFallbackDetection).toHaveBeenCalledTimes(1);
        expect(shared.startFallbackDetection.mock.calls[0][1]).toBe(cb);
    });

    it('脚部跟随已开启时不启动降级检测', () => {
        shared.isFeetAdjustmentRunning.mockReturnValue(true);
        startFootstep(scene as never);
        expect(shared.startFallbackDetection).not.toHaveBeenCalled();
    });

    it('stopFootstep 注销回调 + 停降级检测 + 清空合成缓存', () => {
        startFootstep(scene as never);
        stopFootstep();
        expect(shared.setOnFootLand).toHaveBeenLastCalledWith(null);
        expect(shared.stopFallbackDetection).toHaveBeenCalled();
    });
});

describe('落地回调（合成音色触发）', () => {
    it('footstepEnabled=false → 不发声', () => {
        shared.uiState.footstepEnabled = false;
        const cb = captureCallback(scene);
        cb(makeEvent());
        expect(shared.playSfx).not.toHaveBeenCalled();
    });

    it('SFX 总开关关闭 → 不发声', () => {
        shared.getSfxEnabled.mockReturnValue(false);
        const cb = captureCallback(scene);
        cb(makeEvent());
        expect(shared.playSfx).not.toHaveBeenCalled();
    });

    it('正常落地 → 播放合成 buffer，音量=impactVol×footstepVol', () => {
        installAudioContext();
        shared.getFootstepVolume.mockReturnValue(0.5);
        const cb = captureCallback(scene);
        cb(makeEvent({ impactSpeed: 3 })); // 3/6=0.5 → vol=0.25

        expect(shared.playSfx).toHaveBeenCalledTimes(1);
        const [buf, opts] = shared.playSfx.mock.calls[0];
        expect(buf).toBeTruthy();
        expect(opts.volume).toBeCloseTo(0.25, 5);
        expect(opts.detune).toBeGreaterThanOrEqual(-80);
        expect(opts.detune).toBeLessThanOrEqual(80);
    });

    it('impactSpeed 归一化：超速钳制到 1，低速钳制到 0.2', () => {
        installAudioContext();
        const cb = captureCallback(scene);
        cb(makeEvent({ impactSpeed: 100 })); // 100/6 → clamp 1
        expect(shared.playSfx.mock.calls[0][1].volume).toBeCloseTo(0.8, 5);
        cb(makeEvent({ impactSpeed: 0 })); // 0/6 → clamp 0.2
        expect(shared.playSfx.mock.calls[1][1].volume).toBeCloseTo(0.16, 5);
    });

    it('impactSpeed 为 NaN/Infinity 时按 0 处理钳制到下限，不产生 NaN 音量', () => {
        installAudioContext();
        const cb = captureCallback(scene);
        cb(makeEvent({ impactSpeed: NaN })); // NaN → 0 → clamp 0.2 → 0.2×0.8
        expect(shared.playSfx.mock.calls[0][1].volume).toBeCloseTo(0.16, 5);
        expect(shared.playSfx.mock.calls[0][1].volume).not.toBeNaN();
        cb(makeEvent({ impactSpeed: Infinity })); // Infinity → 0
        expect(shared.playSfx.mock.calls[1][1].volume).toBeCloseTo(0.16, 5);
    });

    it('playSfx 抛错时回调静默降级（不冒泡到落地事件）', () => {
        installAudioContext();
        shared.playSfx.mockImplementation(() => {
            throw new Error('AudioContext closed');
        });
        const cb = captureCallback(scene);
        expect(() => cb(makeEvent())).not.toThrow();
    });

    it('左右声像：落点相对相机 x 偏移映射到 [-1,1]', () => {
        installAudioContext();
        const camScene = { activeCamera: { position: { x: 0 } } };
        const cb = captureCallback(camScene);
        cb(makeEvent({ worldX: 5 })); // 5/5=1
        expect(shared.playSfx.mock.calls[0][1].pan).toBe(1);
        cb(makeEvent({ worldX: 10 })); // clamp 1
        expect(shared.playSfx.mock.calls[1][1].pan).toBe(1);
        cb(makeEvent({ worldX: -5 })); // -1
        expect(shared.playSfx.mock.calls[2][1].pan).toBe(-1);
    });

    it('无相机时 pan 回退 0', () => {
        installAudioContext();
        const cb = captureCallback({ activeCamera: null });
        cb(makeEvent({ worldX: 100 }));
        expect(shared.playSfx.mock.calls[0][1].pan).toBe(0);
    });

    it('AudioContext 不可用时静默降级（variants 为空不抛错）', () => {
        shared.getAudioContext.mockReturnValue(null);
        const cb = captureCallback(scene);
        expect(() => cb(makeEvent())).not.toThrow();
        expect(shared.playSfx).not.toHaveBeenCalled();
    });
});

describe('合成缓存（惰性生成 + 复用）', () => {
    it('同音色多次落地只生成一次变体（缓存复用）', () => {
        installAudioContext();
        const cb = captureCallback(scene);
        cb(makeEvent());
        cb(makeEvent());
        // 3 个变体各生成一次，第二次落地复用缓存
        expect(shared.getAudioContext).toHaveBeenCalledTimes(3);
        expect(shared.playSfx).toHaveBeenCalledTimes(2);
    });

    it('stopFootstep 清空缓存后重新生成', () => {
        installAudioContext();
        const cb = captureCallback(scene);
        cb(makeEvent());
        const firstCalls = shared.getAudioContext.mock.calls.length;
        stopFootstep();
        const cb2 = captureCallback(scene);
        cb2(makeEvent());
        expect(shared.getAudioContext.mock.calls.length).toBeGreaterThan(firstCalls);
    });
});