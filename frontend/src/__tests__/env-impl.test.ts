import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnvState } from './mocks/binding-factories';

// ── Babylon 根 mock（env-impl / env-context 走根 import）──────────
vi.mock('@babylonjs/core', () => ({
    Scene: {
        FOGMODE_EXP: 1,
        FOGMODE_EXP2: 2,
        FOGMODE_LINEAR: 3,
        FOGMODE_NONE: 0,
    },
    ParticleSystem: class {},
    DefaultRenderingPipeline: class {},
    StandardMaterial: class {},
    Texture: class {},
    Mesh: class {},
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color3: class {}, Color4: class {} }));

// ── 捕获 registerEnvCallback 注册的回调 ──────────────────────────
const h = vi.hoisted(() => ({
    registeredCallback: null as ((changed: Set<string> | null, state: any) => void) | null,
}));
vi.mock('../scene/env/_bridge/env-dispatcher', () => ({
    clearSceneTickCallbacks: vi.fn(),
    runSceneTickCallbacks: vi.fn(),
    clearEnvDtTickCallbacks: vi.fn(),
    runEnvDtTickCallbacks: vi.fn(),
    registerSceneTickCallback: vi.fn(() => vi.fn()),
    registerEnvCallback: vi.fn((cb: any) => {
        h.registeredCallback = cb;
    }),
}));

// ── 子模块全 mock（仅提供 env-impl 使用的命名导出）─────────────
vi.mock('../scene/env/_shared/env-texture', () => ({ disposeTextureCache: vi.fn() }));
vi.mock('../scene/env/env-caustics', () => ({ causticsController: { dispose: vi.fn() } }));
vi.mock('../scene/env/env-underwater-fog', () => ({
    underwaterFogController: { reset: vi.fn() },
}));
vi.mock('../scene/env/env-water', () => ({
    createWater: vi.fn(),
    disposeWater: vi.fn(),
    refreshWaterRenderList: vi.fn(),
    addRipple: vi.fn(),
    clearRipples: vi.fn(),
    addGroundRipple: vi.fn(),
    clearGroundRipples: vi.fn(),
    updateWaterAnimSpeed: vi.fn(),
    updateUnderwaterTransition: vi.fn(),
    resetUnderwaterState: vi.fn(),
    updateGroundRipples: vi.fn(),
    resetCausticsSyncGuard: vi.fn(),
}));
vi.mock('../scene/env/env-clouds', () => ({
    createClouds: vi.fn(),
    disposeClouds: vi.fn(),
}));
vi.mock('../scene/env/mirror-debug', () => ({
    createMirror: vi.fn(),
    disposeMirror: vi.fn(),
    isMirrorActive: vi.fn(() => false),
    updateMirrorClearColor: vi.fn(),
}));
vi.mock('../scene/env/env-sky', () => ({
    applySky: vi.fn(),
    clearStarsTexCache: vi.fn(),
}));
vi.mock('../scene/env/env-ground', () => ({
    applyGround: vi.fn(),
    getGroundHeightAt: vi.fn(),
    setOnTerrainReady: vi.fn(),
    setOnGroundChanged: vi.fn(),
    tickGround: vi.fn(),
    disposeGround: vi.fn(),
    clearGroundTexCache: vi.fn(),
}));
vi.mock('../scene/physics/ground-collision', () => ({ applyGroundCollision: vi.fn() }));
vi.mock('../scene/env/env-particles', () => ({
    createParticleEmitter: vi.fn(),
    disposeParticles: vi.fn(),
    updateParticleWind: vi.fn(),
    updateParticleParams: vi.fn(),
    updateParticleTexture: vi.fn(),
    syncSplashState: vi.fn(),
    disposeSplash: vi.fn(),
    getCurrentParticleType: vi.fn(() => 'snow'),
}));
vi.mock('@/core/observer-handle', () => ({
    observe: vi.fn(() => ({ dispose: vi.fn() })),
    ObserverHandle: class {},
}));
vi.mock('@/core/dispose-helpers', () => ({
    safeDispose: vi.fn((x: any) => {
        if (x && typeof x.dispose === 'function') x.dispose();
        return null;
    }),
}));

import { envState } from '@/core/config';
import type { EnvState } from '@/core/types';

// bindings EnvState(skyMode: string) → core EnvState(skyMode 字面量联合)：
// 两类型字段结构相同，仅枚举字段类型不同，此处仅做类型收窄断言。
const toCoreEnvState = (s: ReturnType<typeof createMockEnvState>): EnvState => s as unknown as EnvState;
import { initEnvImpl, isInitialized, getScene } from '../scene/env/_shared/env-context';
import { applyFog, disposeEnvUpdateObserver } from '../scene/env/env-impl';
import * as mirrorDebug from '../scene/env/mirror-debug';
import * as envSky from '../scene/env/env-sky';
import * as envGround from '../scene/env/env-ground';
import * as groundCollision from '../scene/physics/ground-collision';
import * as envCtx from '../scene/env/_shared/env-context';
import * as envWater from '../scene/env/env-water';
import * as envCaustics from '../scene/env/env-caustics';

const sceneMock: any = {
    fogMode: 0,
    fogDensity: 0,
    fogStart: 0,
    fogEnd: 0,
    fogColor: null,
};
const pipelineMock: any = { tag: 'pipeline' };

beforeEach(() => {
    vi.mocked(mirrorDebug.isMirrorActive).mockReturnValue(false);
    Object.assign(envState, createMockEnvState());
    // 初始化共享上下文，使 getScene 可用
    initEnvImpl(sceneMock, pipelineMock);
    // 清调用记录：registerEnvCallback 注册的回调在用例间共享，若不清，
    // 首个用例（changed=null 全分支）的调用残留会让后续 changed 集用例恒过
    // （[fix P3] changed-set 判别逻辑实际未经验证 = 假绿）
    vi.clearAllMocks();
});

describe('env-impl: registerEnvCallback 调度回调', () => {
    it('changed=null 时执行全部分支（含 [fix P3] isMirrorActive 守卫）', () => {
        expect(h.registeredCallback).toBeTruthy();
        vi.mocked(mirrorDebug.isMirrorActive).mockReturnValue(true);
        const state = { ...createMockEnvState(), mirrorEnabled: true };
        h.registeredCallback!(null, state);
        expect(mirrorDebug.updateMirrorClearColor).toHaveBeenCalled();
        expect(envSky.applySky).toHaveBeenCalledWith(state);
        expect(envGround.applyGround).toHaveBeenCalledWith(state);
        expect(groundCollision.applyGroundCollision).toHaveBeenCalled();
    });

    it('[fix P3] collision 分支用 changed.has（collisionEnabled 变更触发）', () => {
        const state = { ...createMockEnvState() };
        h.registeredCallback!(new Set(['collisionEnabled']), state);
        expect(groundCollision.applyGroundCollision).toHaveBeenCalled();
        // 负向：changed 集不含 sky/ground/fog 键 → 对应分支不应触发（判别逻辑真实生效）
        expect(envSky.applySky).not.toHaveBeenCalled();
        expect(envGround.applyGround).not.toHaveBeenCalled();
    });

    it('mirrorEnabled 开启且当前未激活 → createMirror', () => {
        const state = { ...createMockEnvState(), mirrorEnabled: true };
        vi.mocked(mirrorDebug.isMirrorActive).mockReturnValue(false);
        h.registeredCallback!(new Set(['mirrorEnabled']), state);
        expect(mirrorDebug.createMirror).toHaveBeenCalled();
        // 负向：changed 集不含 collision/fog 键 → 其余分支不应触发
        expect(groundCollision.applyGroundCollision).not.toHaveBeenCalled();
    });

    it('mirrorEnabled 关闭且当前激活 → disposeMirror', () => {
        const state = { ...createMockEnvState(), mirrorEnabled: false };
        vi.mocked(mirrorDebug.isMirrorActive).mockReturnValue(true);
        h.registeredCallback!(new Set(['mirrorEnabled']), state);
        expect(mirrorDebug.disposeMirror).toHaveBeenCalled();
        // 负向：changed 集不含 collision/fog 键 → 其余分支不应触发
        expect(groundCollision.applyGroundCollision).not.toHaveBeenCalled();
    });
});

describe('env-impl: applyFog', () => {
    it('fogEnabled=false → FOGMODE_NONE', () => {
        applyFog(toCoreEnvState({ ...createMockEnvState(), fogEnabled: false }));
        expect(sceneMock.fogMode).toBe(0);
    });
    it('exp / exp2 / linear / default 模式', () => {
        applyFog(toCoreEnvState({ ...createMockEnvState(), fogEnabled: true, fogMode: 'exp', fogDensity: 0.1 }));
        expect(sceneMock.fogMode).toBe(1);
        applyFog(toCoreEnvState({ ...createMockEnvState(), fogEnabled: true, fogMode: 'exp2', fogDensity: 0.2 }));
        expect(sceneMock.fogMode).toBe(2);
        applyFog(
            toCoreEnvState({
                ...createMockEnvState(),
                fogEnabled: true,
                fogMode: 'linear',
                fogStart: 10,
                fogEnd: 100,
            })
        );
        expect(sceneMock.fogMode).toBe(3);
        applyFog(toCoreEnvState({ ...createMockEnvState(), fogEnabled: true, fogMode: 'unknown' as any, fogDensity: 0.3 }));
        expect(sceneMock.fogMode).toBe(2); // 回退 exp2
    });
});

describe('env-impl: disposeEnvUpdateObserver（[fix P2] 复位路径）', () => {
    it('初始化后 dispose 走复位路径：resetEnvContext + resetCausticsSyncGuard + prev 复位', () => {
        expect(isInitialized()).toBe(true);

        disposeEnvUpdateObserver();

        // 关键修复行：共享上下文引用复位（防 HMR 幽灵引用）
        expect(envCtx.isInitialized()).toBe(false);
        expect(envWater.resetCausticsSyncGuard).toHaveBeenCalled();
        expect(envCaustics.causticsController.dispose).toHaveBeenCalled();
        // dispose 后 getScene 抛错
        expect(() => getScene()).toThrow('[env-context] Scene not initialized');
    });
});
