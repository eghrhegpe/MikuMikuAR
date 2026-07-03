import { describe, it, expect, beforeEach, vi } from 'vitest';
import { modelRegistry } from '../core/config';

vi.mock('@babylonjs/core/Engines/engine', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Engine: m.MockEngine };
});

vi.mock('@babylonjs/core/scene', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Scene: m.MockScene };
});

vi.mock('@babylonjs/core/Lights/hemisphericLight', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { HemisphericLight: m.MockHemisphericLight };
});

vi.mock('@babylonjs/core/Lights/directionalLight', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { DirectionalLight: m.MockDirectionalLight };
});

vi.mock('@babylonjs/core/Physics/v2/physicsEngineComponent', () => ({}));

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ArcRotateCamera: m.MockArcRotateCamera };
});

vi.mock('@babylonjs/core/Cameras/camera', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Camera: m.MockCamera };
});

vi.mock('@babylonjs/core/Maths/math.color', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Color3: m.MockColor3, Color4: m.MockColor4 };
});

vi.mock('@babylonjs/core/Maths/math.vector', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Vector3: m.MockVector3, Matrix: m.MockMatrix, Quaternion: m.MockQuaternion, TmpVectors: { Vector3: [] } };
});

vi.mock('@babylonjs/core/Materials/standardMaterial', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { StandardMaterial: m.MockStandardMaterial };
});

vi.mock('@babylonjs/core/Materials/material', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Material: m.MockMaterial };
});

vi.mock('@babylonjs/core/Meshes/mesh', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { AbstractMesh: m.MockAbstractMesh, Mesh: m.MockMesh };
});

vi.mock('@babylonjs/core/Lights/Shadows/shadowGenerator', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ShadowGenerator: m.MockShadowGenerator };
});

vi.mock('@babylonjs/core/Loading/sceneLoader', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ImportMeshAsync: m.MockImportMeshAsync };
});

vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { DefaultRenderingPipeline: m.MockDefaultRenderingPipeline };
});

vi.mock('@babylonjs/core/Particles/gpuParticleSystem', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { GPUParticleSystem: m.MockGPUParticleSystem };
});

vi.mock('@babylonjs/core/Particles/particleSystem', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ParticleSystem: m.MockParticleSystem };
});

vi.mock('@babylonjs/core/Particles/webgl2ParticleSystem', () => ({}));

vi.mock('@babylonjs/materials/grid/gridMaterial', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { GridMaterial: m.MockGridMaterial };
});

vi.mock('@babylonjs/core/Materials/Textures/baseTexture', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { BaseTexture: m.MockBaseTexture };
});

vi.mock('@babylonjs/core/Materials/Textures/texture', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Texture: m.MockTexture };
});

vi.mock('@babylonjs/core/Materials/Textures/cubeTexture', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { CubeTexture: m.MockCubeTexture };
});

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

vi.mock('../scene-menu', () => ({
    getSceneMenu: () => null,
}));

vi.mock('../outfit/outfit', () => ({
    loadOutfits: async () => null,
    applyOutfitVariant: () => {},
    resetOutfit: () => {},
}));

vi.mock('../motion/lipsync', () => ({
    LipSyncState: {},
    DEFAULT_LIPSYNC_STATE: { mode: 'off', intensity: 0.5, phonemeMap: {} },
    findLipMorph: () => null,
    amplitudeToWeight: () => 0,
}));

vi.mock('../motion/procedural-motion', () => ({
    ProcMotionState: {},
    ProcMotionMode: {},
    DEFAULT_PROC_STATE: { mode: 'off', intensity: 0.5, speed: 1, autoSwitch: false },
    generateIdleVmd: () => new ArrayBuffer(100),
    generateAutoDanceVmd: () => new ArrayBuffer(100),
    shouldAutoDance: () => false,
    shouldIdle: () => false,
}));

vi.mock('../motion/beat-detector', () => ({
    BeatDetector: class MockBeatDetector {
        detectBeatsFromEnergies() {
            return [];
        }
        bpmFromIntervals() {
            return 120;
        }
        reset() {}
        getBPM() {
            return 120;
        }
        getBeatPhase() {
            return 0;
        }
    },
}));

vi.mock('../audio', () => ({
    syncAudioPlayback: () => {},
    loadAudioFile: async () => {},
    setVolume: () => {},
    setAudioOffset: () => {},
    getAudioPath: () => '',
    getAudioName: () => '',
    getVolume: () => 1,
    getAudioOffset: () => 0,
    isAudioPlaying: () => false,
    resumeAudio: () => {},
    pauseAudio: () => {},
    attachBeatDetector: () => {},
    loadAndPlayAudio: async () => {},
    stopAudio: () => {},
    clearAudio: () => {},
}));

// Mock babylon-mmd side-effect imports
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
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () => ({}));
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { VmdLoader: m.MockVmdLoader };
});
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdWasmAnimation: m.MockMmdWasmAnimation };
});
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () => ({}));
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => {
    const m = require('./mocks/babylon-mmd-mocks.ts');
    return { MmdRuntimeShared: m.MockMmdRuntimeShared };
});
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => ({}));
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => ({}));
vi.mock('@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader', () => ({}));
vi.mock('@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader', () => ({}));
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => ({}));
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => ({}));

import {
    buildModelDetailLevel,
    buildModelInfoLevel,
    buildTransformLevel,
    buildModelTagsLevel,
    buildMorphPreviewLevel,
} from '../menus/model-detail';
import type { PopupLevel } from '../core/config';
import { modelMetaCache } from '../core/config';

function fakeMesh(name = 'mat0'): any {
    return {
        name,
        position: { x: 0, y: 0, z: 0, set() {} },
        scaling: { setAll() {} },
        rotation: { y: 0 },
        setEnabled() {},
        getTotalVertices() {
            return 1000;
        },
        getTotalIndices() {
            return 3000;
        },
        material: {
            name,
            alpha: 1,
            diffuseColor: {
                r: 1,
                g: 1,
                b: 1,
                clone() {
                    return { ...this };
                },
            },
            specularColor: {
                r: 0.8,
                g: 0.8,
                b: 0.8,
                clone() {
                    return { ...this };
                },
            },
            specularPower: 50,
            ambientColor: {
                r: 0.3,
                g: 0.3,
                b: 0.3,
                clone() {
                    return { ...this };
                },
            },
        },
    };
}

function createModel(id: string, overrides?: Partial<any>): string {
    const defaults = {
        id,
        name: 'test-model',
        filePath: 'D:/models/test.pmx',
        port: 1234,
        modelDir: 'D:/models',
        meshes: [fakeMesh('mat0')],
        rootMesh: fakeMesh('root'),
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        kind: 'actor' as const,
        visible: true,
        opacity: 1,
        wireframe: false,
        showBoneLines: false,
        showBoneJoints: false,
        physicsEnabled: true,
        scaling: 1,
        rotationY: 0,
    };
    modelRegistry.set(id, { ...defaults, ...overrides } as any);
    return id;
}

function cleanup(): void {
    modelRegistry.clear();
}

function _getLevelLabel(level: PopupLevel): string {
    return level.label;
}

function hasRenderCustom(level: PopupLevel): boolean {
    return typeof level.renderCustom === 'function';
}

beforeEach(() => cleanup());

// ======== buildModelDetailLevel ========

describe('buildModelDetailLevel', () => {
    it('returns correct label for existing model', () => {
        createModel('m1', { name: '初音ミク' });
        const level = buildModelDetailLevel('m1');
        expect(level.label).toBe('初音ミク');
        expect(level.dir).toBe('');
        expect(Array.isArray(level.items)).toBe(true);
        expect(hasRenderCustom(level)).toBe(true);
    });

    it('returns fallback label for non-existent model', () => {
        const level = buildModelDetailLevel('nonexistent');
        expect(level.label).toBe('未知模型');
    });

    it('renderCustom creates DOM structure with slide items', () => {
        createModel('m1');
        const level = buildModelDetailLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);

        // At least one slide-item should be rendered per card
        const slideItems = container.querySelectorAll('.slide-item');
        expect(slideItems.length).toBeGreaterThan(5);
    });

    it('cards contain expected action labels', () => {
        createModel('m1');
        const level = buildModelDetailLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);

        const labels = Array.from(container.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        // Cards rendered in buildModelDetailLevel (labels may change with UI)
        expect(labels.length).toBeGreaterThan(5);
        expect(labels.some((l) => l && l.includes('模型信息'))).toBe(true);
        expect(labels.some((l) => l && l.includes('材质调节'))).toBe(true);
        expect(labels.some((l) => l && l.includes('服装变体'))).toBe(true);
    });
});

// ======== buildModelInfoLevel ========

describe('buildModelInfoLevel', () => {
    it('returns valid PopupLevel for existing model', () => {
        createModel('m1', { name: 'test' });
        const level = buildModelInfoLevel('m1');
        expect(level.label).toBe('模型信息');
        expect(hasRenderCustom(level)).toBe(true);
    });

    it('returns fallback for non-existent model', () => {
        const level = buildModelInfoLevel('nonexistent');
        expect(level.label).toBe('模型信息');
    });

    it('renderCustom renders info fields', () => {
        createModel('m1', {
            mmdModel: {
                runtimeBones: Array(20),
                morph: { morphs: Array(10) },
            } as any,
        });
        // Pre-populate modelMetaCache so buildModelInfoLevel can read metadata
        modelMetaCache.set('D:/models/test.pmx', {
            name_jp: '初音ミク',
            name_en: 'Hatsune Miku',
            comment: 'test model',
        });
        const level = buildModelInfoLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);
        const labels = Array.from(container.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        expect(labels.some((l) => l && l.includes('1,000'))).toBe(true);
        expect(labels.some((l) => l && l.includes('20'))).toBe(true);
        expect(labels.some((l) => l && l.includes('10'))).toBe(true);
    });
});

// ======== buildTransformLevel ========

describe('buildTransformLevel', () => {
    it('returns valid PopupLevel', () => {
        createModel('m1');
        const level = buildTransformLevel('m1');
        expect(level.label).toBe('变换');
        expect(hasRenderCustom(level)).toBe(true);
    });

    it('renderCustom does not throw', () => {
        createModel('m1');
        const level = buildTransformLevel('m1');
        const container = document.createElement('div');
        expect(() => level.renderCustom!(container)).not.toThrow();
    });
});

// ======== buildVisibilityLevel ========

// ======== buildModelTagsLevel ========

describe('buildModelTagsLevel', () => {
    it('returns valid PopupLevel', () => {
        createModel('m1');
        const level = buildModelTagsLevel('m1');
        expect(level.label).toBe('模型标签');
        expect(hasRenderCustom(level)).toBe(true);
        expect(level.items).toEqual([]);
    });

    it('returns fallback for non-existent model', () => {
        const level = buildModelTagsLevel('nonexistent');
        expect(level.label).toBe('标签');
    });
});

// ======== buildMorphPreviewLevel ========

describe('buildMorphPreviewLevel', () => {
    it('returns valid PopupLevel', () => {
        createModel('m1');
        const level = buildMorphPreviewLevel('m1');
        expect(level.label).toBe('表情预览');
        expect(hasRenderCustom(level)).toBe(true);
    });

    it('renderCustom does not throw', () => {
        createModel('m1');
        const level = buildMorphPreviewLevel('m1');
        const container = document.createElement('div');
        expect(() => level.renderCustom!(container)).not.toThrow();
    });

    it('renderCustom shows empty state for model with no morphs', () => {
        createModel('m1');
        const level = buildMorphPreviewLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);
        const morphList = container.querySelector('.morph-list');
        expect(morphList).toBeTruthy();
    });
});
