// Set up minimal DOM so config.ts's `dom` object gets valid element references
vi.hoisted(() => {
    const ids = [
        'renderCanvas',
        'statusBar',
        'loading',
        'btnMainAction',
        'btnMotionPopup',
        'playbackBar',
        'btnPlayPause',
        'btnLoopToggle',
        'timeDisplay',
        'seekBar',
        'seekProgress',
        'loadingText',
        'btnSettings',
        'btnScene',
        'sceneOverlay',
    ];
    for (const id of ids) {
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
});

// vi.mock must be hoisted BEFORE imports
vi.mock('@babylonjs/core/Engines/engine', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Engine: m.MockEngine };
});

vi.mock('@babylonjs/core/scene', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Scene: m.MockScene };
});

vi.mock('@babylonjs/core/node', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Node: m.MockNode };
});

vi.mock('@babylonjs/core/Lights/light', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Light: m.MockLight };
});

vi.mock('@babylonjs/core/Lights/hemisphericLight', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { HemisphericLight: m.MockHemisphericLight };
});

vi.mock('@babylonjs/core/Lights/directionalLight', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { DirectionalLight: m.MockDirectionalLight };
});

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
    return { Color3: m.MockColor3, Color4: m.MockColor4, TmpColors: { Color3: [] } };
});

vi.mock('@babylonjs/core/Maths/math.vector', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Vector3: m.MockVector3, Matrix: m.MockMatrix, TmpVectors: { Vector3: [] } };
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

vi.mock('@babylonjs/core/PostProcesses/postProcess', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { PostProcess: m.MockPostProcess };
});

vi.mock('@babylonjs/core/Loading/sceneLoader', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { ImportMeshAsync: m.MockImportMeshAsync };
});

vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { DefaultRenderingPipeline: m.MockDefaultRenderingPipeline };
});

vi.mock('@babylonjs/core/Physics/v2/physicsEngineComponent', () => ({}));

vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => ({}));

// --- babylon-mmd mocks ---
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

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { serializeModelPreset, applyModelPreset, ModelPresetFile } from '../menus/library';
import {
    stopVMD,
    getMatState,
    applyMatState,
    _catState,
    _matState,
    _matEnabled,
} from '../scene/scene';
import * as sceneModule from '../scene/scene';
import {
    modelRegistry,
    dom,
    setMmdRuntime,
    setIsPlaying,
    isPlaying,
    mmdRuntime,
} from '../core/config';
import { updatePlaybackUI } from '../scene/scene-playback';

// ======== Test setup ========

function cloneColor(c: any) {
    return {
        ...c,
        clone() {
            return cloneColor(this);
        },
    };
}

const BASE_MAT_COLOR = {
    r: 1,
    g: 1,
    b: 1,
    set() {},
    clone() {
        return cloneColor(this);
    },
};

/** Create a fake mesh with the minimal interface needed by scene.ts operations. */
function fakeMesh(name = 'mesh0'): any {
    return {
        name,
        position: {
            x: 0,
            y: 0,
            z: 0,
            set(x: number, y: number, z: number) {
                this.x = x;
                this.y = y;
                this.z = z;
            },
        },
        scaling: {
            setAll(v: number) {
                /* noop */
            },
        },
        rotation: { y: 0 },
        setEnabled(_v: boolean) {
            /* noop */
        },
        material: {
            name,
            alpha: 1,
            diffuseColor: {
                ...BASE_MAT_COLOR,
                clone() {
                    return { ...this };
                },
            },
            specularColor: {
                ...BASE_MAT_COLOR,
                clone() {
                    return { ...this };
                },
            },
            specularPower: 50,
            ambientColor: {
                ...BASE_MAT_COLOR,
                clone() {
                    return { ...this };
                },
            },
        },
    };
}

/** Create N fake meshes, each with material name `mat{idx}`. */
function fakeMeshes(count: number): any[] {
    return Array.from({ length: count }, (_, i) => {
        const m = fakeMesh(`mat${i}`);
        return m;
    });
}

/** Create a fake ModelInstance, register it in modelRegistry, and return the id. */
function createModel(id: string, meshCount = 1, overrides?: Partial<any>): string {
    const defaults = {
        id,
        name: 'test-model',
        filePath: 'D:/models/test.pmx',
        port: 1234,
        modelDir: 'D:/models',
        meshes: fakeMeshes(meshCount),
        rootMesh: fakeMeshes(1)[0],
        vmdData: null,
        vmdName: '',
        vmdPath: null,
        animationDuration: 0,
        kind: 'actor',
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
    _catState.clear();
    _matState.clear();
    _matEnabled.clear();
    setMmdRuntime(null);
    setIsPlaying(false);
}

function applySpies(): void {
    vi.restoreAllMocks();
    vi.spyOn(sceneModule, 'setModelPosition').mockImplementation((id, x, y, z) => {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (inst.rootMesh.position.set) {
            inst.rootMesh.position.set(x, y, z);
        }
        const mesh = inst.meshes[0];
        if (mesh.position.set) {
            mesh.position.set(x, y, z);
        }
    });
    vi.spyOn(sceneModule, 'setModelScaling').mockImplementation((id, scaling) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.scaling = scaling;
        }
    });
    vi.spyOn(sceneModule, 'setModelRotationY').mockImplementation((id, rotationY) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.rotationY = rotationY;
        }
    });
    vi.spyOn(sceneModule, 'setModelVisibility').mockImplementation((id, visible) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.visible = visible;
        }
    });
    vi.spyOn(sceneModule, 'setModelOpacity').mockImplementation((id, opacity) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.opacity = opacity;
        }
    });
    vi.spyOn(sceneModule, 'setModelWireframe').mockImplementation((id, wireframe) => {
        const inst = modelRegistry.get(id);
        if (inst) {
            inst.wireframe = wireframe;
        }
    });
    vi.spyOn(sceneModule, 'stopVMD').mockImplementation((id) => {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return;
        }
        if (inst.mmdModel && mmdRuntime) {
            inst.mmdModel.setRuntimeAnimation(null);
        }
        inst.vmdData = null;
        inst.vmdName = '';
        inst.vmdPath = null;
        inst.animationDuration = 0;
        if (isPlaying) {
            mmdRuntime.pauseAnimation();
            setIsPlaying(false);
        }
        updatePlaybackUI();
    });
}

beforeEach(() => {
    cleanup();
    applySpies();
});

beforeAll(() => {
    dom.statusBar = document.createElement('div') as HTMLDivElement;
    dom.playbackBar = document.createElement('div') as HTMLDivElement;
    dom.btnPlayPause = document.createElement('button') as HTMLButtonElement;
    dom.btnLoopToggle = document.createElement('button') as HTMLButtonElement;
    dom.timeDisplay = document.createElement('span') as HTMLSpanElement;
    dom.seekProgress = document.createElement('div') as HTMLDivElement;
});

// ======== serializeModelPreset — basic shape ========

describe('serializeModelPreset', () => {
    it('serializes a full model into valid JSON with all fields', () => {
        createModel('m1', 1, {
            filePath: 'D:/models/miku.pmx',
            name: '初音ミク',
            kind: 'actor',
            scaling: 1.2,
            rotationY: 0.5,
            visible: true,
            opacity: 1,
            wireframe: false,
            vmdPath: 'D:/motions/dance.vmd',
            vmdName: 'ダンス',
        });
        // Set rootMesh position
        const inst = modelRegistry.get('m1')!;
        inst.rootMesh.position.x = 1.5;
        inst.rootMesh.position.y = 0;
        inst.rootMesh.position.z = -2;

        const json = serializeModelPreset('m1');
        const parsed = JSON.parse(json);

        expect(parsed.version).toBe(1);
        expect(parsed.model.filePath).toBe('D:/models/miku.pmx');
        expect(parsed.model.name).toBe('初音ミク');
        expect(parsed.model.kind).toBe('actor');
        expect(parsed.transform.positionX).toBe(1.5);
        expect(parsed.transform.positionY).toBe(0);
        expect(parsed.transform.positionZ).toBe(-2);
        expect(parsed.transform.scaling).toBe(1.2);
        expect(parsed.transform.rotationY).toBe(0.5);
        expect(parsed.visibility.visible).toBe(true);
        expect(parsed.visibility.opacity).toBe(1);
        expect(parsed.visibility.wireframe).toBe(false);
        expect(parsed.vmd.name).toBe('ダンス');
        expect(parsed.vmd.path).toBe('D:/motions/dance.vmd');
        expect(parsed.audio).toBeUndefined();
    });

    it('returns empty string for non-existent model', () => {
        expect(serializeModelPreset('nonexistent')).toBe('');
    });

    it('defaults position to 0 when rootMesh is null', () => {
        createModel('m1', 1, { rootMesh: null });
        const json = serializeModelPreset('m1');
        const parsed = JSON.parse(json);
        expect(parsed.transform.positionX).toBe(0);
        expect(parsed.transform.positionY).toBe(0);
        expect(parsed.transform.positionZ).toBe(0);
    });

    it('returns null vmd path and name when no VMD loaded', () => {
        createModel('m1', 1, { vmdPath: null, vmdName: '' });
        const json = serializeModelPreset('m1');
        const parsed = JSON.parse(json);
        expect(parsed.vmd.path).toBeNull();
        expect(parsed.vmd.name).toBe('');
    });

    it('includes material state when categories/overrides are set', () => {
        createModel('m1', 4);
        applyMatState('m1', {
            categories: {
                皮肤: { diffuseMul: 1.2, specularMul: 0.8, shininess: 30, ambientMul: 1 },
            },
            overrides: {
                3: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
            },
        });

        const json = serializeModelPreset('m1');
        const parsed = JSON.parse(json);

        expect(parsed.materialCategories['皮肤'].diffuseMul).toBe(1.2);
        expect(parsed.materialOverrides['3'].shininess).toBe(10);
    });

    it('preserves numeric precision for transform values', () => {
        createModel('m1');
        const inst = modelRegistry.get('m1')!;
        inst.rootMesh.position.x = 0.123456789;
        inst.rootMesh.position.y = -3.14;
        inst.rootMesh.position.z = 42;
        inst.scaling = 0.75;
        inst.rotationY = 1.570796;

        const json = serializeModelPreset('m1');
        const parsed = JSON.parse(json);

        expect(parsed.transform.positionX).toBeCloseTo(0.123456789, 5);
        expect(parsed.transform.positionY).toBe(-3.14);
        expect(parsed.transform.scaling).toBe(0.75);
        expect(parsed.transform.rotationY).toBeCloseTo(1.570796, 5);
    });
});

// ======== applyModelPreset — transform application ========

describe('applyModelPreset', () => {
    it('applies transform values (position, scaling, rotationY) to model instance', async () => {
        createModel('m1');
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: 'D:/miku.pmx', name: 'miku', kind: 'actor' },
            transform: { positionX: 2, positionY: 1, positionZ: -3, scaling: 1.5, rotationY: 1.57 },
            visibility: {},
            vmd: { path: null, name: '' },
        };

        await applyModelPreset('m1', JSON.stringify(preset));

        const inst = modelRegistry.get('m1')!;
        expect(inst.meshes[0].position.x).toBe(2);
        expect(inst.meshes[0].position.y).toBe(1);
        expect(inst.meshes[0].position.z).toBe(-3);
        expect(inst.scaling).toBe(1.5);
        expect(inst.rotationY).toBe(1.57);
    });

    it('applies visibility settings', async () => {
        createModel('m1');
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: 'D:/miku.pmx', name: 'miku', kind: 'actor' },
            transform: {},
            visibility: { visible: false, opacity: 0.5, wireframe: true },
            vmd: { path: null, name: '' },
        };

        await applyModelPreset('m1', JSON.stringify(preset));

        const inst = modelRegistry.get('m1')!;
        expect(inst.visible).toBe(false);
        expect(inst.opacity).toBe(0.5);
        expect(inst.wireframe).toBe(true);
    });

    it('stops VMD and clears VMD state when preset has no VMD path', async () => {
        createModel('m1', 1, {
            vmdData: new ArrayBuffer(10),
            vmdName: 'dance',
            vmdPath: 'dance.vmd',
            animationDuration: 30,
        });

        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: 'D:/miku.pmx', name: 'miku', kind: 'actor' },
            transform: {},
            visibility: {},
            vmd: { path: null, name: '' },
        };

        await applyModelPreset('m1', JSON.stringify(preset));

        const inst = modelRegistry.get('m1')!;
        expect(inst.vmdData).toBeNull();
        expect(inst.vmdName).toBe('');
        expect(inst.vmdPath).toBeNull();
        expect(inst.animationDuration).toBe(0);
    });

    it('applies material state (categories and overrides)', async () => {
        createModel('m1');
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: 'D:/miku.pmx', name: 'miku', kind: 'actor' },
            transform: {},
            visibility: {},
            vmd: { path: null, name: '' },
            materialCategories: {
                皮肤: { diffuseMul: 0.8, specularMul: 1.2, shininess: 100, ambientMul: 0.9 },
            },
            materialOverrides: {
                0: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
            },
        };

        await applyModelPreset('m1', JSON.stringify(preset));

        const state = getMatState('m1');
        expect(state).not.toBeNull();
        expect(state!.categories['皮肤'].shininess).toBe(100);
        expect(state!.overrides[0].diffuseMul).toBe(1.5);
    });

    it('handles model not in registry without throwing', async () => {
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: 'D:/miku.pmx', name: 'miku', kind: 'actor' },
            transform: {},
            visibility: {},
            vmd: { path: null, name: '' },
        };
        // No model registered — should call setStatus but not throw
        await expect(
            applyModelPreset('nonexistent', JSON.stringify(preset))
        ).resolves.toBeUndefined();
    });
});

// ======== getMatState / applyMatState — real scene.ts functions ========

describe('getMatState / applyMatState', () => {
    it('returns null when no material adjustments have been made', () => {
        createModel('m1');
        expect(getMatState('m1')).toBeNull();
    });

    it('roundtrips material categories through getMatState after applyMatState', () => {
        createModel('m1');
        applyMatState('m1', {
            categories: {
                皮肤: { diffuseMul: 1.2, specularMul: 0.8, shininess: 30, ambientMul: 1 },
                头发: { diffuseMul: 1, specularMul: 1.5, shininess: 80, ambientMul: 0.9 },
            },
        });

        const state = getMatState('m1');
        expect(state).not.toBeNull();
        expect(state!.categories['皮肤'].diffuseMul).toBe(1.2);
        expect(state!.categories['头发'].specularMul).toBe(1.5);
    });

    it('roundtrips per-material overrides', () => {
        createModel('m1', 8);
        applyMatState('m1', {
            overrides: {
                3: { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
                7: { diffuseMul: 0.8, specularMul: 1.2, shininess: 100, ambientMul: 0.9 },
            },
        });

        const state = getMatState('m1');
        expect(state).not.toBeNull();
        expect(state!.overrides[3].shininess).toBe(10);
        expect(state!.overrides[7].diffuseMul).toBe(0.8);
    });

    it('empty state makes no changes', () => {
        createModel('m1');
        applyMatState('m1', {});
        expect(getMatState('m1')).toBeNull();
    });

    it('applies state with string-keyed overrides (Object.entries cast)', () => {
        createModel('m1', 4);
        // Simulate what JSON.parse produces: overrides as Record<string, T>
        const overrides: Record<
            string,
            { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }
        > = {
            '3': { diffuseMul: 1.5, specularMul: 0.5, shininess: 10, ambientMul: 1.2 },
        };
        applyMatState('m1', { overrides: overrides as any });

        const state = getMatState('m1');
        expect(state!.overrides[3].diffuseMul).toBe(1.5);
    });
});

// ======== stopVMD — real scene.ts function ========

describe('stopVMD', () => {
    it('clears all VMD state fields on the instance', () => {
        createModel('m1', 1, {
            vmdData: new ArrayBuffer(10),
            vmdName: 'dance',
            vmdPath: 'dance.vmd',
            animationDuration: 30,
        });

        stopVMD('m1');

        const inst = modelRegistry.get('m1')!;
        expect(inst.vmdData).toBeNull();
        expect(inst.vmdName).toBe('');
        expect(inst.vmdPath).toBeNull();
        expect(inst.animationDuration).toBe(0);
    });

    it('calls mmdModel.setRuntimeAnimation when model has mmdModel', () => {
        const setRuntimeAnim = vi.fn();

        createModel('m1', 1, {
            mmdModel: { setRuntimeAnimation: setRuntimeAnim },
        });
        setMmdRuntime({ pauseAnimation: vi.fn() } as any);

        stopVMD('m1');

        expect(setRuntimeAnim).toHaveBeenCalledWith(null);
    });

    it('pauses animation and sets isPlaying to false when was playing', () => {
        const pauseAnim = vi.fn();
        createModel('m1');
        setIsPlaying(true);
        setMmdRuntime({ stopAnimation: vi.fn(), pauseAnimation: pauseAnim } as any);

        stopVMD('m1');

        expect(pauseAnim).toHaveBeenCalled();
        expect(modelRegistry.get('m1')!.vmdData).toBeNull();
    });

    it('handles non-existent model without throwing', () => {
        expect(() => stopVMD('nonexistent')).not.toThrow();
    });
});
