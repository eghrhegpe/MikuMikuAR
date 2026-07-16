import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    deriveLighting,
    calcLuminance,
    TIME_OF_DAY_PRESETS,
    snapshotEnvPresetByCategory,
    exportCategorizedEnvPreset,
    importCategorizedEnvPreset,
    ENV_PRESET_FIELDS,
} from '../scene/env/env-lighting';
import { createMockEnvState } from './mocks/binding-factories';

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

    it('night: dirIntensity=0 when sunAngle <= 0', () => {
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

    it('transitionLighting 在缺少 Babylon 对象时提前返回（不抛异常）', () => {
        expect(() => {
            sceneLighting.transitionLighting({ dirIntensity: 0.5 }, 2000);
        }).not.toThrow();
    });
});

// ====================================================================
// 分类预设（ADR-120）
// ====================================================================

describe('ADR-120 分类预设', () => {
    describe('ENV_PRESET_FIELDS 白名单', () => {
        it('4 个类别', () => {
            expect(Object.keys(ENV_PRESET_FIELDS).sort()).toEqual([
                'atmosphere',
                'ground',
                'sky',
                'water',
            ]);
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
            const state = createMockEnvState();
            const preset = snapshotEnvPresetByCategory('测试天空', 'sky', state);
            expect(preset.version).toBe(3);
            expect(preset.category).toBe('sky');
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
            const state = createMockEnvState();
            const preset = snapshotEnvPresetByCategory('草地', 'ground', state);
            expect(preset.category).toBe('ground');
            const keys = Object.keys(preset.fields);
            expect(keys).toContain('groundColor');
            expect(keys).toContain('groundType');
            expect(keys).not.toContain('skyMode');
            expect(keys).not.toContain('waterColor');
        });

        it('数组字段是拷贝（修改原 state 不影响 preset）', () => {
            const state = createMockEnvState({ skyColorTop: [1, 0, 0] });
            const preset = snapshotEnvPresetByCategory('红天', 'sky', state);
            expect(preset.fields.skyColorTop).toEqual([1, 0, 0]);
            // 修改原 state
            state.skyColorTop[0] = 0;
            // preset 不受影响
            expect(preset.fields.skyColorTop).toEqual([1, 0, 0]);
        });
    });

    describe('exportCategorizedEnvPreset / importCategorizedEnvPreset 往返', () => {
        it('v3 序列化 → 反序列化一致', () => {
            const state = createMockEnvState();
            const preset = snapshotEnvPresetByCategory('水面预设', 'water', state);
            const json = exportCategorizedEnvPreset(preset);
            const restored = importCategorizedEnvPreset(json);
            expect(restored).not.toBeNull();
            expect(restored!.version).toBe(3);
            expect(restored!.category).toBe('water');
            expect(restored!.label).toBe('水面预设');
            expect(restored!.fields.waterColor).toEqual(state.waterColor);
            expect(restored!.fields.fogColor).toBeUndefined(); // fog 属于 atmosphere
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
            expect(preset!.category).toBe('sky');
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
                importCategorizedEnvPreset(JSON.stringify({ version: 3, category: 'sky' }))
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
    });
});
