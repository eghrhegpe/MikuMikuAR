// env-ground.test.ts — 地面子系统单元测试
// 纯函数测试 + 模块级状态管理验证

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

// 隔离 env-impl，避免其重型依赖（clouds/particles/sky 等）干扰；
// _envSys 通过 globalThis 共享同对象，与 env-context mock 一致。
vi.mock('../../scene/env/env-impl', () => {
    if (!(globalThis as any).__groundTestEnvSys) {
        (globalThis as any).__groundTestEnvSys = {
            ground: { mesh: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__groundTestEnvSys,
        getScene: () => (globalThis as any).__groundTestScene as Scene,
        ensureEnvUpdateObserver: () => {},
    };
});
// env-ground.ts 从 env-context 获取 getScene，故需额外 mock
vi.mock('../../scene/env/env-context', () => {
    if (!(globalThis as any).__groundTestEnvSys) {
        (globalThis as any).__groundTestEnvSys = {
            ground: { mesh: null as any },
        };
    }
    return {
        _envSys: (globalThis as any).__groundTestEnvSys,
        getScene: () => (globalThis as any).__groundTestScene as Scene,
        initEnvImpl: () => {},
        isInitialized: () => true,
        getPipeline: () => null,
    };
});
vi.mock('../../scene/env/env', () => ({
    ensureEnvUpdateObserver: () => {},
}));
// ADR-151: env-ground 从 env-reflection 导入 getPlanarQualityOverride，后者会拉入
// renderer→performance→scene 重链（模块级 new Scene()）。单测只关注纯函数，
// 此处桩掉避免测试环境收集期崩溃。
vi.mock('../../scene/env/env-reflection', () => ({
    getPlanarQualityOverride: () => null,
}));

import { _envSys } from '../../scene/env/env-impl';
import { _effectiveBumpLevel, _effectiveRoughness } from '../../scene/env/env-ground';
import {
    clearGroundTexCache,
    setOnTerrainReady,
    setOnGroundChanged,
    GROUND_PRESETS,
    buildGroundPresetEnvState,
    disposeGround,
} from '../../scene/env/env-ground';

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    (globalThis as any).__groundTestScene = scene;
    _envSys.ground.mesh = null;
});

afterEach(() => {
    _envSys.ground.mesh = null;
    (globalThis as any).__groundTestScene = null;
    scene.dispose();
    engine.dispose();
});

// ──────────────── Ground Presets — 所有字段非 undefined ────────────────
describe('Ground Presets — 字段完整性', () => {
    it('buildGroundPresetEnvState 对所有预设不产生 undefined 字段', () => {
        for (const [name, preset] of Object.entries(GROUND_PRESETS)) {
            const mapped = buildGroundPresetEnvState(preset);
            for (const [k, v] of Object.entries(mapped)) {
                expect(v, `preset "${name}": field "${k}" is undefined`).not.toBeUndefined();
            }
        }
    });

    it('每个预设含 label 且非空', () => {
        for (const [name, preset] of Object.entries(GROUND_PRESETS)) {
            expect(preset.label, `preset "${name}" missing label`).toBeTruthy();
        }
    });

    it('buildGroundPresetEnvState 返回包含基础参数', () => {
        const preset = GROUND_PRESETS[Object.keys(GROUND_PRESETS)[0]];
        const state = buildGroundPresetEnvState(preset);
        expect(state).toHaveProperty('groundStyle');
        expect(state).toHaveProperty('groundColor');
        expect(state).toHaveProperty('groundAlpha');
        expect(state).toHaveProperty('reflectionQuality');
    });
});

// ──────────────── clearGroundTexCache 幂等 ────────────────
describe('clearGroundTexCache — 幂等', () => {
    it('可重复调用不抛错', () => {
        expect(() => clearGroundTexCache()).not.toThrow();
        expect(() => clearGroundTexCache()).not.toThrow();
        expect(() => clearGroundTexCache()).not.toThrow();
    });
});

// ──────────────── 回调注册/清除 ────────────────
describe('setOnTerrainReady / setOnGroundChanged — 回调管理', () => {
    it('注册 null 回调不抛错', () => {
        expect(() => setOnTerrainReady(null)).not.toThrow();
        expect(() => setOnGroundChanged(null)).not.toThrow();
    });

    it('注册/清除可重复', () => {
        const cb = vi.fn();
        setOnTerrainReady(cb);
        setOnGroundChanged(cb);
        setOnTerrainReady(null);
        setOnGroundChanged(null);
        expect(() => setOnTerrainReady(null)).not.toThrow();
        expect(() => setOnGroundChanged(null)).not.toThrow();
    });
});

// ──────────────── disposeGround 幂等 ────────────────
describe('disposeGround — 幂等与资源释放', () => {
    it('未初始化时调用不抛错（幂等）', () => {
        expect(() => disposeGround()).not.toThrow();
        expect(() => disposeGround()).not.toThrow();
    });

    it('携带真实网格时释放并置空引用', () => {
        const mat = new StandardMaterial('envGroundMat', scene);
        const mesh = MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene);
        mesh.material = mat;
        _envSys.ground.mesh = mesh;

        disposeGround();

        // 网格引用被置空
        expect(_envSys.ground.mesh).toBeNull();
    });

    it('重复调用 disposeGround 后网格引用仍为 null', () => {
        const mat = new StandardMaterial('envGroundMat', scene);
        const mesh = MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene);
        mesh.material = mat;
        _envSys.ground.mesh = mesh;

        disposeGround();
        disposeGround();

        expect(_envSys.ground.mesh).toBeNull();
    });

    it('网格无 material 时 dispose 不抛错', () => {
        const mesh = MeshBuilder.CreateGround('envGround', { width: 10, height: 10 }, scene);
        // 不设置 material
        _envSys.ground.mesh = mesh;

        expect(() => disposeGround()).not.toThrow();
        expect(_envSys.ground.mesh).toBeNull();
    });
});

// ──────────────── _effectiveBumpLevel — 法线扭曲增强 ────────────────
describe('_effectiveBumpLevel — 法线扭曲映射', () => {
    function mockState(overrides: Record<string, unknown> = {}): any {
        return {
            groundNormalStrength: 1.0,
            groundReflectionDistort: 0.3,
            reflectionQuality: 'medium' as const,
            ...overrides,
        };
    }

    it('中等/高质量下 bumpLevel = normalStrength + distort*2.0', () => {
        expect(
            _effectiveBumpLevel(mockState({ groundNormalStrength: 1, groundReflectionDistort: 0 }))
        ).toBeCloseTo(1.0);
        expect(
            _effectiveBumpLevel(
                mockState({ groundNormalStrength: 1, groundReflectionDistort: 0.3 })
            )
        ).toBeCloseTo(1.6);
        expect(
            _effectiveBumpLevel(mockState({ groundNormalStrength: 2, groundReflectionDistort: 1 }))
        ).toBeCloseTo(4.0);
        expect(
            _effectiveBumpLevel(
                mockState({ groundNormalStrength: 0, groundReflectionDistort: 0.5 })
            )
        ).toBeCloseTo(1.0);
    });

    it('低质量/关闭时退化为 groundNormalStrength（忽略 distort）', () => {
        for (const q of ['low' as const, 'off' as const]) {
            expect(
                _effectiveBumpLevel(
                    mockState({
                        reflectionQuality: q,
                        groundNormalStrength: 1,
                        groundReflectionDistort: 0.8,
                    })
                )
            ).toBeCloseTo(1.0);
            expect(
                _effectiveBumpLevel(
                    mockState({
                        reflectionQuality: q,
                        groundNormalStrength: 0.5,
                        groundReflectionDistort: 1,
                    })
                )
            ).toBeCloseTo(0.5);
        }
    });
});

// ──────────────── _effectiveRoughness — 反射模糊映射 ────────────────
describe('_effectiveRoughness — 反射模糊映射', () => {
    function mockState(overrides: Record<string, unknown> = {}): any {
        return {
            groundRoughness: 0.6,
            groundReflectionBlur: 0.3,
            reflectionQuality: 'medium' as const,
            ...overrides,
        };
    }

    it('中等/高质量下 roughness = groundRoughness + blur * 0.4', () => {
        expect(
            _effectiveRoughness(mockState({ groundRoughness: 0.6, groundReflectionBlur: 0 }))
        ).toBeCloseTo(0.6);
        expect(
            _effectiveRoughness(mockState({ groundRoughness: 0.6, groundReflectionBlur: 0.3 }))
        ).toBeCloseTo(0.72);
        expect(
            _effectiveRoughness(mockState({ groundRoughness: 0.3, groundReflectionBlur: 1 }))
        ).toBeCloseTo(0.7);
    });

    it('模糊+粗糙度总和不超过 1', () => {
        expect(
            _effectiveRoughness(mockState({ groundRoughness: 0.9, groundReflectionBlur: 1 }))
        ).toBeCloseTo(1.0);
        expect(
            _effectiveRoughness(mockState({ groundRoughness: 1, groundReflectionBlur: 0.5 }))
        ).toBeCloseTo(1.0);
    });

    it('低质量/关闭时退化为 groundRoughness（忽略 blur）', () => {
        for (const q of ['low' as const, 'off' as const]) {
            expect(
                _effectiveRoughness(
                    mockState({
                        reflectionQuality: q,
                        groundRoughness: 0.6,
                        groundReflectionBlur: 0.8,
                    })
                )
            ).toBeCloseTo(0.6);
        }
    });
});
