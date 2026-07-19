import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';

// 隔离 env-impl 重型依赖
vi.mock('../../scene/env/env-impl', () => {
    if (!(globalThis as any).__particlesTestEnvSys) {
        (globalThis as any).__particlesTestEnvSys = {
            particles: { system: null as any, followObserver: null as any },
            splash: { observer: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__particlesTestEnvSys,
        getScene: () => (globalThis as any).__particlesTestScene as Scene,
        ensureEnvUpdateObserver: () => {},
        addRipple: () => {},
        getGroundHeightAt: () => 0,
    };
});
// env-particles.ts 从 env-context 而非 env-impl 获取 getScene，故需额外 mock
vi.mock('../../scene/env/env-context', () => {
    if (!(globalThis as any).__particlesTestEnvSys) {
        (globalThis as any).__particlesTestEnvSys = {
            particles: { system: null as any, followObserver: null as any },
            splash: { observer: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__particlesTestEnvSys,
        getScene: () => (globalThis as any).__particlesTestScene as Scene,
        initEnvImpl: () => {},
        isInitialized: () => true,
        getPipeline: () => null,
    };
});

// mock wind-utils
vi.mock('../../core/wind-utils', () => ({
    getWindVector: () => ({ x: 0, y: 0, z: 0, scale: () => ({ x: 0, y: 0, z: 0 }) }),
}));

import { _envSys } from '../../scene/env/env-impl';
import { envState } from '../../core/config';
import {
    createParticleEmitter,
    disposeParticles,
    getCurrentParticleType,
    updateParticleParams,
    updateParticleTexture,
    applyWindToParticles,
} from '../../scene/env/env-particles';

let engine: NullEngine;
let scene: Scene;

// happy-dom 无真实 2D canvas
beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    (globalThis as any).__particlesTestScene = scene;

    const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            createImageData: (w: number, h: number) => ({
                data: new Uint8ClampedArray(w * h * 4),
                width: w,
                height: h,
            }),
            putImageData: () => {},
            clearRect: () => {},
            fillRect: () => {},
            beginPath: () => {},
            arc: () => {},
            fill: () => {},
            save: () => {},
            restore: () => {},
            translate: () => {},
            rotate: () => {},
            drawImage: () => {},
            createLinearGradient: () => ({
                addColorStop: () => {},
            }),
            createRadialGradient: () => ({
                addColorStop: () => {},
            }),
            set strokeStyle(v: string) {},
            set fillStyle(v: string) {},
            set lineWidth(v: number) {},
            set lineCap(v: string) {},
            set globalAlpha(v: number) {},
            stroke: () => {},
            moveTo: () => {},
            lineTo: () => {},
            closePath: () => {},
        }),
        toDataURL: () => 'data:image/png;base64,',
    };
    const origCreate = document.createElement.bind(document);
    (document as any).createElement = (tag: string) =>
        tag === 'canvas' ? (fakeCanvas as any) : origCreate(tag);

    // 重置状态
    _envSys.particles.system = null;
    _envSys.particles.followObserver = null;
});

afterEach(() => {
    disposeParticles();
    _envSys.particles.system = null;
    _envSys.particles.followObserver = null;
    scene.dispose();
    engine.dispose();
});

describe('env-particles', () => {
    describe('createParticleEmitter / disposeParticles', () => {
        it('type=none 时不会创建粒子系统', () => {
            createParticleEmitter('none', false);
            expect(_envSys.particles.system).toBeNull();
        });

        it('创建樱花粒子后 system 被赋值', () => {
            createParticleEmitter('sakura', false);
            expect(_envSys.particles.system).not.toBeNull();
            expect(getCurrentParticleType()).toBe('sakura');
        });

        it('创建雨粒子后 system 被赋值', () => {
            createParticleEmitter('rain', false);
            expect(_envSys.particles.system).not.toBeNull();
            expect(getCurrentParticleType()).toBe('rain');
        });

        it('创建雪粒子后 system 被赋值', () => {
            createParticleEmitter('snow', false);
            expect(_envSys.particles.system).not.toBeNull();
            expect(getCurrentParticleType()).toBe('snow');
        });

        it('创建烟花粒子后 system 被赋值', () => {
            createParticleEmitter('fireworks', false);
            expect(_envSys.particles.system).not.toBeNull();
            expect(getCurrentParticleType()).toBe('fireworks');
        });

        it('创建萤火虫粒子后 system 被赋值', () => {
            createParticleEmitter('fireflies', false);
            expect(_envSys.particles.system).not.toBeNull();
            expect(getCurrentParticleType()).toBe('fireflies');
        });

        it('创建落叶粒子后 system 被赋值', () => {
            createParticleEmitter('leaves', false);
            expect(_envSys.particles.system).not.toBeNull();
            expect(getCurrentParticleType()).toBe('leaves');
        });

        it('重复创建同类型不重建', () => {
            createParticleEmitter('sakura', false);
            const first = _envSys.particles.system;
            createParticleEmitter('sakura', false);
            expect(_envSys.particles.system).toBe(first);
        });

        it('切换类型先 dispose 旧系统', () => {
            createParticleEmitter('sakura', false);
            const first = _envSys.particles.system;
            createParticleEmitter('rain', false);
            expect(_envSys.particles.system).not.toBe(first);
            expect(getCurrentParticleType()).toBe('rain');
        });

        it('dispose 清理所有资源', () => {
            createParticleEmitter('rain', false);
            expect(_envSys.particles.system).not.toBeNull();
            disposeParticles();
            expect(_envSys.particles.system).toBeNull();
            expect(_envSys.particles.followObserver).toBeNull();
        });

        it('dispose 可重复调用（幂等）', () => {
            createParticleEmitter('sakura', false);
            disposeParticles();
            disposeParticles(); // 不抛错
            expect(_envSys.particles.system).toBeNull();
        });
    });

    describe('getCurrentParticleType', () => {
        it('创建后返回当前类型', () => {
            createParticleEmitter('fireflies', false);
            expect(getCurrentParticleType()).toBe('fireflies');
        });

        it('dispose 后仍保留上次类型（用于自动恢复）', () => {
            createParticleEmitter('rain', false);
            disposeParticles();
            expect(getCurrentParticleType()).toBe('rain');
        });

        it('切换类型后返回新类型', () => {
            createParticleEmitter('sakura', false);
            createParticleEmitter('leaves', false);
            expect(getCurrentParticleType()).toBe('leaves');
        });
    });

    describe('updateParticleParams', () => {
        it('无 system 时不抛错', () => {
            expect(() => updateParticleParams()).not.toThrow();
        });

        it('有 system 时正常更新', () => {
            createParticleEmitter('sakura', false);
            envState.particleEmitRate = 2;
            envState.particleSize = 0.5;
            envState.particleSpeed = 1.5;
            expect(() => updateParticleParams()).not.toThrow();
            // 恢复默认值
            envState.particleEmitRate = 1;
            envState.particleSize = 1;
            envState.particleSpeed = 1;
        });
    });

    describe('applyWindToParticles', () => {
        it('无初始方向时不抛错', () => {
            const ps = {
                direction1: { clone: () => ({ add: () => ({}) }) },
                direction2: { clone: () => ({ add: () => ({}) }) },
            } as any;
            expect(() => applyWindToParticles(ps)).not.toThrow();
        });
    });
});
