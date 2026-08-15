import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    deriveLighting,
    calcLuminance,
    TIME_OF_DAY_PRESETS,
    snapshotEnvPresetByCategory,
    exportCategorizedEnvPreset,
    importCategorizedEnvPreset,
    ENV_PRESET_FIELDS,
    type EnvPresetCategory,
} from '../scene/env/env-lighting';
import { ENV_STATE_SCHEMA } from '../core/env-state-schema';
import { envState } from '../core/config';
import { createMockEnvState } from './mocks/binding-factories';
import type { EnvState as FrontendEnvState } from '../core/types';
import { lightingState } from '../scene/render/lighting-state';

// ── scene-lighting-smoke: Babylon mocks ──────────────────────────
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => ({ HemisphericLight: vi.fn() }));
vi.mock('@babylonjs/core/Lights/directionalLight', () => ({ DirectionalLight: vi.fn() }));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: class {
        constructor(
            public x: number,
            public y: number,
            public z: number
        ) {}
        static Right() {
            return new this(1, 0, 0);
        }
        static Up() {
            return new this(0, 1, 0);
        }
        static Forward() {
            return new this(0, 0, 1);
        }
        static Zero() {
            return new this(0, 0, 0);
        }
    },
    Quaternion: class {
        constructor(
            public x: number,
            public y: number,
            public z: number,
            public w: number = 1
        ) {}
        static Identity() {
            return new this(0, 0, 0, 1);
        }
    },
    // babylon-mmd 的 appendTransformSolver.js 在模块求值期调用 Matrix.Identity()
    Matrix: class {
        static Identity() {
            return new this();
        }
    },
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color3: vi.fn(), Color4: vi.fn() }));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({ Mesh: vi.fn() }));
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({ MeshBuilder: { CreateSphere: vi.fn() } }));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({ StandardMaterial: vi.fn() }));
vi.mock('@babylonjs/core/Lights/Shadows/shadowGenerator', () => ({ ShadowGenerator: vi.fn() }));

// --- babylon-mmd 子模块桩（复用 material-editor 已验证集合）---
// 防止 scene.ts 引入真实 babylon-mmd 触发 mmdStandardMaterial 装饰器 / 静态初始化
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => ({}));

vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdCamera: m.MockMmdCamera };
});

vi.mock('babylon-mmd/esm/Loader/dynamic', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { RegisterMmdModelLoaders: m.MockRegisterMmdModelLoaders };
});

vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { RegisterDxBmpTextureLoader: m.MockRegisterDxBmpTextureLoader };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { GetMmdWasmInstance: m.MockGetMmdWasmInstance };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () => ({
    MmdWasmInstanceTypeSPR: class Mock {},
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdWasmRuntime: m.MockMmdWasmRuntime };
});

vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { VmdLoader: m.MockVmdLoader };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdWasmAnimation: m.MockMmdWasmAnimation };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () => ({}));

vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdStandardMaterialProxy: m.MockMmdStandardMaterialProxy };
});

vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdRuntimeShared: m.MockMmdRuntimeShared };
});

vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => ({}));

vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => ({}));

vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => ({}));

vi.mock('@babylonjs/core/scene', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Scene: m.MockScene };
});

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ArcRotateCamera: m.MockArcRotateCamera };
});

vi.mock('@babylonjs/core/Cameras/camera', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Camera: m.MockCamera };
});

// 本文件只验证 transitionLighting 守卫/即时应用路径；太阳盘与性能快照不在断言范围。
vi.mock('../scene/render/lighting-sun', () => ({
    _updateSunDisc: vi.fn(),
    _disposeSunDisc: vi.fn(),
}));
vi.mock('../scene/render/performance', () => ({
    resetPerformanceSnapshot: () => {},
    isSnapshotResetSuppressed: () => false,
}));

import * as sceneLighting from '../scene/render/lighting';

describe('calcLuminance', () => {
    it('white is 1.0', () => {
        expect(calcLuminance([1, 1, 1])).toBeCloseTo(1, 3);
    });
    it('black is 0', () => {
        expect(calcLuminance([0, 0, 0])).toBe(0);
    });
    it('mid gray ~0.5', () => {
        expect(calcLuminance([0.5, 0.5, 0.5])).toBeCloseTo(0.5, 3);
    });
});

describe('deriveLighting', () => {
    it('noon: bright warm-white light', () => {
        const l = deriveLighting([0.53, 0.71, 0.91], 75);
        expect(l.dirIntensity).toBeGreaterThan(0.8);
        expect(l.hemiIntensity).toBeLessThan(0.7);
        // 新算法保留色相：最亮通道 ≈ 0.95，各通道比例与 skyColor 一致
        expect(Math.max(...l.dirDiffuse)).toBeCloseTo(0.95, 1);
        const ratio = l.dirDiffuse[0] / l.dirDiffuse[2];
        expect(ratio).toBeCloseTo(0.53 / 0.91, 1);
    });

    it('night: dirIntensity=0 below horizon fade lower bound', () => {
        const l = deriveLighting([0.05, 0.05, 0.15], -15);
        expect(l.dirIntensity).toBe(0);
        expect(l.hemiIntensity).toBeCloseTo(0.3, 1);
        // 夜间方向无意义，但函数仍返回平面方向（y=0）
        expect(l.dirDirection[1]).toBe(0);
    });

    it('sunset: warm light, low angle', () => {
        const l = deriveLighting([0.9, 0.45, 0.2], 15);
        expect(l.dirDiffuse[0]).toBeGreaterThan(l.dirDiffuse[2]);
        expect(l.dirDirection[1]).toBeGreaterThan(0);
        expect(l.dirDirection[1]).toBeLessThan(0.5);
    });

    it('horizon lower bound: dirIntensity 为 0 at -5°', () => {
        const l = deriveLighting([0.5, 0.5, 0.5], -5);
        expect(l.dirIntensity).toBe(0);
        expect(l.hemiIntensity).toBeGreaterThan(0);
    });

    it('azimuth 控制方向光水平朝向', () => {
        const east = deriveLighting([1, 1, 1], 30, 0);
        const south = deriveLighting([1, 1, 1], 30, 90);
        expect(east.dirDirection[2]).toBeCloseTo(0, 6);
        expect(east.dirDirection[0]).toBeGreaterThan(0);
        expect(south.dirDirection[0]).toBeCloseTo(0, 6);
        expect(south.dirDirection[2]).toBeGreaterThan(0);
    });
});

describe('TIME_OF_DAY_PRESETS', () => {
    it('has all 6 presets', () => {
        expect(Object.keys(TIME_OF_DAY_PRESETS)).toEqual([
            'dawn',
            'noon',
            'sunset',
            'night',
            'overcast',
            'neon',
        ]);
    });

    it('each preset has all required fields', () => {
        for (const [_key, p] of Object.entries(TIME_OF_DAY_PRESETS)) {
            expect(p.label).toBeTruthy();
            expect(p.dirDiffuse).toHaveLength(3);
            expect(p.dirDirection).toHaveLength(3);
            expect(p.hemiIntensity).toBeGreaterThanOrEqual(0);
        }
    });

    it('preset derived fields 与 deriveLighting 实时推导一致', () => {
        for (const p of Object.values(TIME_OF_DAY_PRESETS)) {
            const d = deriveLighting(p.skyColorTop, p.sunAngle, p.azimuth ?? -45);
            for (let i = 0; i < 3; i++) {
                expect(p.dirDiffuse[i]).toBeCloseTo(d.dirDiffuse[i], 6);
                expect(p.dirDirection[i]).toBeCloseTo(d.dirDirection[i], 6);
            }
            expect(p.dirIntensity).toBeCloseTo(d.dirIntensity, 6);
            expect(p.hemiIntensity).toBeCloseTo(d.hemiIntensity, 6);
        }
    });
});

// ====================================================================
// scene-lighting 烟雾测试（合并自 scene-lighting-smoke.test.ts）
// ====================================================================

describe('scene-lighting — deriveLighting', () => {
    it('模块可导入', () => {
        expect(sceneLighting.transitionLighting).toBeTypeOf('function');
        expect(sceneLighting.initLighting).toBeTypeOf('function');
    });
});

describe('scene-lighting — transitionLighting smoke', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('transitionLighting 在缺少 Babylon 对象时提前返回（守卫拦截返回 false）', () => {
        // [audit:round6] 原 smoke 仅 not.toThrow()——实现体删空也绿（恒真级弱断言）。
        // 补返回值断言：守卫拦截明确返回 false（lighting.ts:442/449），删空实现
        // 返回 undefined ≠ false 会红，恢复回归拦截能力。
        const result = sceneLighting.transitionLighting({ dirIntensity: 0.5 }, 2000);
        expect(result).toBe(false);
    });

    it('transitionLighting 非正/非有限 duration 立即应用且不注册动画 observer', () => {
        const hemiLight = {
            intensity: 0.8,
            diffuse: { r: 1, g: 1, b: 1 },
            groundColor: { r: 0.3, g: 0.3, b: 0.4 },
        };
        const dirLight = {
            intensity: 0.4,
            direction: { x: 0, y: -1, z: 0 },
            diffuse: { r: 1, g: 1, b: 1 },
        };
        const save = vi.fn();
        const previous = {
            hemiLight: lightingState.hemiLight,
            dirLight: lightingState.dirLight,
            triggerAutoSave: lightingState.triggerAutoSave,
            scene: lightingState.scene,
            envSysShadow: lightingState.envSysShadow,
            activeTransitionObs: lightingState.activeTransitionObs,
        };
        lightingState.hemiLight = hemiLight as never;
        lightingState.dirLight = dirLight as never;
        lightingState.triggerAutoSave = save;
        lightingState.scene = {} as never;
        lightingState.envSysShadow = null;
        lightingState.activeTransitionObs = null;
        try {
            const result = sceneLighting.transitionLighting({ dirIntensity: 0.9 }, 0);
            expect(result).toBe(true);
            const brightness = Math.max(0.01, envState.globalBrightness ?? 1);
            expect(dirLight.intensity).toBeCloseTo(0.9 * brightness, 6);
            expect(lightingState.activeTransitionObs).toBeNull();
            expect(save).toHaveBeenCalled();

            expect(sceneLighting.transitionLighting({ dirIntensity: 0.8 }, -1)).toBe(true);
            expect(sceneLighting.transitionLighting({ dirIntensity: 0.7 }, Number.NaN)).toBe(true);
            expect(lightingState.activeTransitionObs).toBeNull();
        } finally {
            lightingState.hemiLight = previous.hemiLight;
            lightingState.dirLight = previous.dirLight;
            lightingState.triggerAutoSave = previous.triggerAutoSave;
            lightingState.scene = previous.scene;
            lightingState.envSysShadow = previous.envSysShadow;
            lightingState.activeTransitionObs = previous.activeTransitionObs;
        }
    });
});

// ====================================================================
// 分类预设（ADR-120）
// ====================================================================

describe('ADR-120 分类预设', () => {
    describe('ENV_PRESET_FIELDS 白名单', () => {
        it('4 个类别', () => {
            expect(Object.keys(ENV_PRESET_FIELDS).sort()).toEqual([
                'env:atmosphere',
                'env:ground',
                'env:sky',
                'env:water',
            ]);
        });

        it('白名单覆盖 ADR-120 分类族（含 schema 后增字段）', () => {
            const schemaKeys = Object.keys(ENV_STATE_SCHEMA);
            const collisionKeys = new Set([
                'collisionEnabled',
                'bodyCollisionEnabled',
                'groundCollisionEnabled',
            ]);
            const byFamily = (prefixes: string[], exact: string[] = []) =>
                schemaKeys.filter(
                    (k) =>
                        !collisionKeys.has(k) &&
                        (prefixes.some((p) => k.startsWith(p)) || exact.includes(k))
                );
            const expected: Record<EnvPresetCategory, string[]> = {
                'env:sky': byFamily(
                    ['sky', 'stars', 'timeOfDay'],
                    ['iblIntensity', 'globalBrightness', 'sunAngle', 'azimuth', 'lightingPresetName']
                ),
                'env:ground': byFamily(['ground']),
                'env:water': byFamily(
                    ['water', 'bigWave', 'smallWave', 'foam', 'fresnel', 'ripple', 'caustic', 'underwater'],
                    [
                        'planarReflectionBlend',
                        'reflectionQuality',
                        'diffuseStrength',
                        'ambientStrength',
                        'lowFreqNormalStrength',
                    ]
                ),
                'env:atmosphere': byFamily(
                    ['wind', 'particle', 'cloud', 'fog', 'mirror'],
                    ['debugCloudsEnabled']
                ),
            };
            for (const [cat, keys] of Object.entries(expected)) {
                const actual = ENV_PRESET_FIELDS[cat as EnvPresetCategory];
                expect([...actual].sort()).toEqual([...keys].sort());
            }
        });

        it('各类字段无重叠', () => {
            const all: string[] = [];
            for (const keys of Object.values(ENV_PRESET_FIELDS)) {
                all.push(...(keys as string[]));
            }
            const unique = new Set(all);
            expect(all.length).toBe(unique.size); // 无重复
        });

        it('排除 collision* 物理字段', () => {
            const all: string[] = [];
            for (const keys of Object.values(ENV_PRESET_FIELDS)) {
                all.push(...(keys as string[]));
            }
            expect(all).not.toContain('collisionEnabled');
            expect(all).not.toContain('bodyCollisionEnabled');
            expect(all).not.toContain('groundCollisionEnabled');
        });
    });

    describe('snapshotEnvPresetByCategory', () => {
        it('sky 类只含 sky 字段', () => {
            const state = createMockEnvState() as unknown as FrontendEnvState;
            const preset = snapshotEnvPresetByCategory('测试天空', 'env:sky', state);
            expect(preset.version).toBe(3);
            expect(preset.category).toBe('env:sky');
            expect(preset.label).toBe('测试天空');
            const keys = Object.keys(preset.fields);
            // 不含 ground/water/atmosphere 字段
            expect(keys).not.toContain('groundColor');
            expect(keys).not.toContain('waterColor');
            expect(keys).not.toContain('particleType');
            // 含 sky 字段
            expect(keys).toContain('skyMode');
            expect(keys).toContain('sunAngle');
        });

        it('ground 类只含 ground 字段', () => {
            const state = createMockEnvState() as unknown as FrontendEnvState;
            const preset = snapshotEnvPresetByCategory('草地', 'env:ground', state);
            expect(preset.category).toBe('env:ground');
            const keys = Object.keys(preset.fields);
            expect(keys).toContain('groundColor');
            expect(keys).toContain('groundType');
            expect(keys).not.toContain('skyMode');
            expect(keys).not.toContain('waterColor');
        });

        it('数组字段是拷贝（修改原 state 不影响 preset）', () => {
            const state = createMockEnvState({
                skyColorTop: [1, 0, 0],
            }) as unknown as FrontendEnvState;
            const preset = snapshotEnvPresetByCategory('红天', 'env:sky', state);
            expect(preset.fields.skyColorTop).toEqual([1, 0, 0]);
            // 修改原 state
            state.skyColorTop[0] = 0;
            // preset 不受影响
            expect(preset.fields.skyColorTop).toEqual([1, 0, 0]);
        });
    });

    describe('exportCategorizedEnvPreset / importCategorizedEnvPreset 往返', () => {
        it('v3 序列化 → 反序列化一致', () => {
            const state = createMockEnvState() as unknown as FrontendEnvState;
            const preset = snapshotEnvPresetByCategory('水面预设', 'env:water', state);
            const json = exportCategorizedEnvPreset(preset);
            const restored = importCategorizedEnvPreset(json);
            expect(restored).not.toBeNull();
            expect(restored!.version).toBe(3);
            expect(restored!.category).toBe('env:water');
            expect(restored!.label).toBe('水面预设');
            expect(restored!.fields.waterColor).toEqual(state.waterColor);
            expect(restored!.fields.fogColor).toBeUndefined(); // fog 属于 atmosphere
        });

        it('每个类别往返保留全部白名单字段', () => {
            for (const cat of Object.keys(ENV_PRESET_FIELDS) as EnvPresetCategory[]) {
                const state = createMockEnvState() as unknown as FrontendEnvState;
                const preset = snapshotEnvPresetByCategory(`往返-${cat}`, cat, state);
                const restored = importCategorizedEnvPreset(exportCategorizedEnvPreset(preset));
                expect(restored).not.toBeNull();
                expect(restored!.category).toBe(cat);
                for (const key of ENV_PRESET_FIELDS[cat]) {
                    expect(restored!.fields[key]).toEqual(state[key]);
                }
            }
        });
    });

    describe('importCategorizedEnvPreset v2 兼容', () => {
        it('旧 v2 格式（顶层 skyColorTop/Bot/sunAngle）归 sky 类', () => {
            const v2Json = JSON.stringify({
                version: 2,
                label: '旧天空预设',
                skyColorTop: [0.5, 0.5, 1],
                skyColorBot: [0.8, 0.8, 1],
                sunAngle: 30,
                azimuth: -45,
            });
            const preset = importCategorizedEnvPreset(v2Json);
            expect(preset).not.toBeNull();
            expect(preset!.category).toBe('env:sky');
            expect(preset!.label).toBe('旧天空预设');
            expect(preset!.fields.skyColorTop).toEqual([0.5, 0.5, 1]);
            expect(preset!.fields.sunAngle).toBe(30);
        });

        it('无 azimuth 时用默认值', () => {
            const v2Json = JSON.stringify({
                version: 2,
                label: '无方位',
                skyColorTop: [0, 0, 0],
                skyColorBot: [1, 1, 1],
                sunAngle: 0,
            });
            const preset = importCategorizedEnvPreset(v2Json);
            expect(preset).not.toBeNull();
            expect(preset!.fields.azimuth).toBe(-45);
        });
    });

    describe('importCategorizedEnvPreset 异常', () => {
        it('无效 JSON 返回 null', () => {
            expect(importCategorizedEnvPreset('{not json')).toBeNull();
        });

        it('缺 label 返回 null', () => {
            expect(
                importCategorizedEnvPreset(JSON.stringify({ version: 3, category: 'env:sky' }))
            ).toBeNull();
        });

        it('非法 category 返回 null', () => {
            expect(
                importCategorizedEnvPreset(
                    JSON.stringify({
                        version: 3,
                        category: 'invalid',
                        label: 'x',
                        fields: {},
                    })
                )
            ).toBeNull();
        });

        it('v3 fields 不是普通对象返回 null', () => {
            expect(
                importCategorizedEnvPreset(
                    JSON.stringify({
                        version: 3,
                        category: 'env:sky',
                        label: 'x',
                        fields: ['skyColorTop'],
                    })
                )
            ).toBeNull();
            expect(
                importCategorizedEnvPreset(
                    JSON.stringify({
                        version: 3,
                        category: 'env:sky',
                        label: 'x',
                        fields: 'skyColorTop',
                    })
                )
            ).toBeNull();
        });

        it('v2 颜色数组长度非 3 返回 null', () => {
            expect(
                importCategorizedEnvPreset(
                    JSON.stringify({
                        version: 2,
                        label: 'x',
                        skyColorTop: [1, 2],
                        skyColorBot: [1, 2, 3],
                        sunAngle: 30,
                    })
                )
            ).toBeNull();
        });

        it('旧版零级 category 值自动迁移为 domain 前缀', () => {
            const result = importCategorizedEnvPreset(
                JSON.stringify({
                    version: 3,
                    category: 'sky',
                    label: '旧天空',
                    fields: { skyColorTop: [0, 0, 0] },
                })
            );
            expect(result).not.toBeNull();
            expect(result!.category).toBe('env:sky');
        });
    });
});
