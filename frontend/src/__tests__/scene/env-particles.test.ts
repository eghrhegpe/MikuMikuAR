import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

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
vi.mock('../../scene/env/_shared/env-context', () => {
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
        // ADR-217: 地水共享尺寸单源
        INFINITE_GROUND_SIZE: 2000,
        effectiveGroundSize: (groundSize: number, infiniteEnabled: boolean) =>
            infiniteEnabled ? 2000 : groundSize,
    };
});
vi.mock('../../scene/env/env', () => ({
    ensureEnvUpdateObserver: () => {},
}));

// mock wind-utils
vi.mock('../../core/wind-utils', () => ({
    getWindVector: () => ({ x: 0, y: 0, z: 0, scale: () => ({ x: 0, y: 0, z: 0 }) }),
}));

// fix P2 测试需实例化 GPUParticleSystem（splash burst 池 / firework burst）。
// NullEngine 下真实 GPUParticleSystem 不可实例化，故用最小桩替换该子模块
// （CPU ParticleSystem 仍走真实 Babylon，不影响既有 rain/snow 用例）。
vi.mock('@babylonjs/core/Particles/gpuParticleSystem', () => {
    class FakeGPUParticleSystem {
        name: string;
        capacity: number;
        scene: any;
        particleTexture: any = null;
        emitRate = 0;
        emitter: any = null;
        minLifeTime = 0;
        maxLifeTime = 0;
        minSize = 0;
        maxSize = 0;
        minEmitPower = 0;
        maxEmitPower = 0;
        gravity: any = null;
        blendMode = 0;
        direction1: any = null;
        direction2: any = null;
        updateSpeed = 0;
        constructor(name: string, options?: any, scene?: any) {
            this.name = name;
            this.capacity = options?.capacity ?? 0;
            this.scene = scene;
        }
        start() {}
        dispose() {}
        addColorGradient() {}
        addSizeGradient() {}
        createSphereEmitter() {}
    }
    return { GPUParticleSystem: FakeGPUParticleSystem };
});

import { _envSys } from '../../scene/env/env-impl';
import { envState } from '../../core/config';
import { modelRegistry } from '../../core/scene-state';
import {
    createParticleEmitter,
    disposeParticles,
    getCurrentParticleType,
    updateParticleParams,
    applyWindToParticles,
    isWetnessActive,
    applyWetnessToInst,
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

    describe('湿身效果（wetness effect）', () => {
        /** 重置 _currentParticleType = 'none' + 清理湿身，防止跨测试污染 */
        function _resetParticleState(): void {
            createParticleEmitter('none', false);
        }

        beforeEach(() => {
            _resetParticleState();
            modelRegistry.set('testModel', {
                id: 'testModel',
                name: 'test',
                filePath: 'test.pmx',
                modelDir: '',
                meshes: [
                    { material: new PBRMaterial('pbr', scene) },
                    { material: new StandardMaterial('std', scene) },
                    { material: new StandardMaterial('dup', scene) },
                ],
                rootMesh: { material: null } as any,
                vmdData: null,
                vmdName: '',
                vmdPath: null,
                animationDuration: 0,
                vmdLayers: [],
                kind: 'pmx' as any,
                visible: true,
                opacity: 1,
                wireframe: false,
                showBoneLines: false,
                showBoneJoints: false,
                physicsEnabled: false,
                scaling: 1,
                rotationY: 0,
                rotation: [0, 0, 0],
            } as any);
        });

        afterEach(() => {
            modelRegistry.clear();
        });

        it('不在雨天时不激活', () => {
            expect(isWetnessActive()).toBe(false);
            createParticleEmitter('sakura', false);
            expect(isWetnessActive()).toBe(false);
        });

        it('创建 rain 粒子时激活湿身', () => {
            const pbr = modelRegistry.get('testModel')!.meshes[0].material as PBRMaterial;
            pbr.roughness = 0.8;

            createParticleEmitter('rain', false);

            expect(isWetnessActive()).toBe(true);
            expect(pbr.roughness).toBeCloseTo(0.4); // 0.8 * 0.5
        });

        it('PBRMaterial roughness 减半且不低于 0.1', () => {
            const pbr = modelRegistry.get('testModel')!.meshes[0].material as PBRMaterial;
            pbr.roughness = 0.05;

            createParticleEmitter('rain', false);

            expect(pbr.roughness).toBeCloseTo(0.1);
        });

        it('StandardMaterial specularPower 加倍', () => {
            const std = modelRegistry.get('testModel')!.meshes[1].material as StandardMaterial;
            std.specularPower = 30;
            std.specularColor.set(0.4, 0.4, 0.4);

            createParticleEmitter('rain', false);

            expect(std.specularPower).toBe(60);
            expect(std.specularColor.r).toBeCloseTo(0.52);
            expect(std.diffuseColor.r).toBeCloseTo(0.85);
        });

        it('dispose 后恢复所有材质原始值', () => {
            const pbr = modelRegistry.get('testModel')!.meshes[0].material as PBRMaterial;
            pbr.roughness = 0.6;
            const std = modelRegistry.get('testModel')!.meshes[1].material as StandardMaterial;
            std.specularPower = 20;
            std.specularColor.set(0.5, 0.5, 0.5);
            const origRoughness = pbr.roughness;
            const origSpecPower = std.specularPower;
            const origSpecR = std.specularColor.r;

            createParticleEmitter('rain', false);
            disposeParticles();

            expect(isWetnessActive()).toBe(false);
            expect(pbr.roughness).toBe(origRoughness);
            expect(std.specularPower).toBe(origSpecPower);
            expect(std.specularColor.r).toBe(origSpecR);
        });

        it('applyWetnessToInst 对后加载模型生效', () => {
            createParticleEmitter('rain', false);
            expect(isWetnessActive()).toBe(true);

            const newStd = new StandardMaterial('newStd', scene);
            newStd.specularPower = 40;
            newStd.specularColor.set(1, 1, 1);
            const lateInst = {
                id: 'lateModel',
                meshes: [{ material: newStd }],
            } as any;

            applyWetnessToInst(lateInst);

            expect(newStd.specularPower).toBe(80);
            expect(newStd.diffuseColor.r).toBeCloseTo(0.85);
        });

        it('共享材质去重：同一材质只处理一次', () => {
            const sharedMat = new PBRMaterial('shared', scene);
            sharedMat.roughness = 0.8;
            modelRegistry.set('modelA', {
                id: 'modelA',
                meshes: [{ material: sharedMat }, { material: sharedMat }],
            } as any);
            modelRegistry.set('modelB', {
                id: 'modelB',
                meshes: [{ material: sharedMat }],
            } as any);

            createParticleEmitter('rain', false);

            expect(sharedMat.roughness).toBeCloseTo(0.4);
            disposeParticles();
            expect(sharedMat.roughness).toBeCloseTo(0.8);
        });
    });
});

// ──────────────── fix P2 — 湿身状态泄漏修复（rain→snow 显式离开 rain 即移除）────────────────
// 变更行：createParticleEmitter 内
//   `} else if (prevType === 'rain' && type !== 'rain') { removeWetnessFromAllModels(); }`
// 旧逻辑 `isWeatherType(prevType) && !isWeatherType(type)` 在 rain→snow 时两者皆 weather 不移除。
describe('env-particles fix P2 — 湿身状态泄漏（rain→snow）', () => {
    beforeEach(() => {
        modelRegistry.clear();
        modelRegistry.set('m1', {
            id: 'm1',
            meshes: [{ material: new StandardMaterial('std', scene) }],
        } as any);
    });
    afterEach(() => {
        modelRegistry.clear();
        disposeParticles();
    });

    it('rain→snow 切换移除湿身（显式判断离开 rain）', () => {
        createParticleEmitter('none', false);
        expect(isWetnessActive()).toBe(false);

        createParticleEmitter('rain', false);
        expect(isWetnessActive()).toBe(true);

        // 关键修复路径：prevType='rain' → snow 必须移除湿身
        createParticleEmitter('snow', false);
        expect(isWetnessActive()).toBe(false);
    });
});

// ──────────────── fix P2 — splash burst 池初始化含 emitStopTimer 字段 ────────────────
// 变更行：initSplashBurstPool 的 push 新增 `emitStopTimer: null`。
describe('env-particles fix P2 — splash 池 emitStopTimer 字段', () => {
    let savedSplash: boolean;
    let savedEnabled: boolean;
    beforeEach(() => {
        savedSplash = envState.particleSplashEnabled;
        savedEnabled = envState.particleEnabled;
        envState.particleEnabled = true;
        envState.particleSplashEnabled = true;
    });
    afterEach(() => {
        envState.particleSplashEnabled = savedSplash;
        envState.particleEnabled = savedEnabled;
        disposeParticles();
    });

    it('rain + splash 启用 → syncSplashState 初始化 splash 池（变更行 emitStopTimer:null）', () => {
        createParticleEmitter('rain', false); // → syncSplashState → initSplashBurstPool
        expect(() => disposeParticles()).not.toThrow();
    });
});

// ──────────────── fix P2 — firework burst 50ms emitStop timer 与 dispose 清理 ────────────────
// 变更行：spawnFireworkBurst 内 `const emitStopTimer = setTimeout(...)` 与 push 含 emitStopTimer；
// stopFireworkBursts 内 `clearTimeout(b.emitStopTimer)` 一并清除。
describe('env-particles fix P2 — firework emitStop timer 清理', () => {
    let savedEnabled: boolean;
    beforeEach(() => {
        vi.useFakeTimers();
        savedEnabled = envState.particleEnabled;
        envState.particleEnabled = true;
        // spawnFireworkBurst 需要 scene.activeCamera（真实相机，避免 dispose 异常）
        if ((globalThis as any).__particlesTestScene) {
            const cam = new FreeCamera('fwcam', new Vector3(0, 5, 10), (globalThis as any).__particlesTestScene);
            (globalThis as any).__particlesTestScene.activeCamera = cam;
        }
    });
    afterEach(() => {
        envState.particleEnabled = savedEnabled;
        vi.useRealTimers();
        disposeParticles();
    });

    it('fireworks 调度 burst → 设置 emitStop timer，dispose 一并清除', () => {
        createParticleEmitter('fireworks', false); // 注册调度器（1.2~3s 后 spawn）
        vi.advanceTimersByTime(3000); // 触发首个 spawnFireworkBurst（含 emitStop timer + push）
        vi.advanceTimersByTime(200); // 让 50ms emitStop 回调执行
        // disposeParticles → stopFireworkBursts 清除 emitStop timer（变更行）
        expect(() => disposeParticles()).not.toThrow();
    });
});
