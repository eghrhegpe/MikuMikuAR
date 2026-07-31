// model-preset.apply.test.ts — applyModelPreset（拆自 model-preset.test.ts）
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import {
    mockEngine,
    mockScene,
    mockNode,
    mockLight,
    mockHemisphericLight,
    mockDirectionalLight,
    mockArcRotateCamera,
    mockCamera,
    mockMathColor,
    mockMathVector,
    mockStandardMaterial,
    mockMaterial,
    mockMesh,
    mockPostProcess,
    mockSceneLoader,
    mockDefaultRenderingPipeline,
    mockPhysicsEngineComponent,
    mockTgaTextureLoader,
    mockMmdCamera,
    mockMmdDynamic,
    mockDxBmpTextureLoader,
    mockMmdWasmInstance,
    mockSinglePhysicsRelease,
    mockMmdWasmRuntime,
    mockVmdLoader,
    mockMmdWasmAnimation,
    mockMmdWasmRuntimeModelAnimation,
    mockMmdStandardMaterialProxy,
    mockMmdRuntimeShared,
    mockMmdModelLoaderDefault,
    mockTextureAlphaCheckerVertex,
    mockTextureAlphaCheckerFragment,
    mockToast,
    mockPlayback,
} from './model-preset-mocks';
import { applyModelPreset, ModelPresetFile } from '../menus/library';
import { getMatState } from '../scene/scene';
import { modelRegistry } from '../core/config';
import { modelPresetBeforeEach, setupDomRefs, createModel } from './model-preset-helpers';

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
        if (!document.getElementById(id)) {
            const el = document.createElement('div');
            el.id = id;
            document.body.appendChild(el);
        }
    }
});

vi.mock('@babylonjs/core/Engines/engine', () => mockEngine());
vi.mock('@babylonjs/core/scene', () => mockScene());
vi.mock('@babylonjs/core/node', () => mockNode());
vi.mock('@babylonjs/core/Lights/light', () => mockLight());
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => mockHemisphericLight());
vi.mock('@babylonjs/core/Lights/directionalLight', () => mockDirectionalLight());
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => mockArcRotateCamera());
vi.mock('@babylonjs/core/Cameras/camera', () => mockCamera());
vi.mock('@babylonjs/core/Maths/math.color', () => mockMathColor());
vi.mock('@babylonjs/core/Maths/math.vector', () => mockMathVector());
vi.mock('@babylonjs/core/Materials/standardMaterial', () => mockStandardMaterial());
vi.mock('@babylonjs/core/Materials/material', () => mockMaterial());
vi.mock('@babylonjs/core/Meshes/mesh', () => mockMesh());
vi.mock('@babylonjs/core/PostProcesses/postProcess', () => mockPostProcess());
vi.mock('@babylonjs/core/Loading/sceneLoader', () => mockSceneLoader());
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () =>
    mockDefaultRenderingPipeline()
);
vi.mock('@babylonjs/core/Physics/v2/physicsEngineComponent', () => mockPhysicsEngineComponent());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () =>
    mockTgaTextureLoader()
);
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => mockMmdCamera());
vi.mock('babylon-mmd/esm/Loader/dynamic', () => mockMmdDynamic());
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => mockDxBmpTextureLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => mockMmdWasmInstance());
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () =>
    mockSinglePhysicsRelease()
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => mockMmdWasmRuntime());
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => mockVmdLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () =>
    mockMmdWasmAnimation()
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () =>
    mockMmdWasmRuntimeModelAnimation()
);
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => mockMmdStandardMaterialProxy());
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => mockMmdRuntimeShared());
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => mockMmdModelLoaderDefault());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () =>
    mockTextureAlphaCheckerVertex()
);
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () =>
    mockTextureAlphaCheckerFragment()
);
vi.mock('../core/toast', () => mockToast());
vi.mock('../scene/motion/playback', () => mockPlayback());

describe('applyModelPreset', () => {
    beforeAll(() => {
        setupDomRefs();
    });
    beforeEach(() => {
        modelPresetBeforeEach();
    });

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
            // filePath 与 createModel 默认值一致，触发同模型路径（保留 materialOverrides）
            model: { filePath: 'D:/models/test.pmx', name: 'miku', kind: 'actor' },
            transform: {},
            visibility: {},
            vmd: { path: null, name: '' },
            materialCategories: {
                皮肤: {
                    diffuseMul: 0.8,
                    specularMul: 1.2,
                    shininess: 100,
                    ambientMul: 0.9,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                },
            },
            materialOverrides: {
                0: {
                    diffuseMul: 1.5,
                    specularMul: 0.5,
                    shininess: 10,
                    ambientMul: 1.2,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                },
            },
        };

        await applyModelPreset('m1', JSON.stringify(preset));

        const state = getMatState('m1');
        expect(state).not.toBeNull();
        expect(state!.categories['皮肤'].shininess).toBe(100);
        expect(state!.overrides[0].diffuseMul).toBe(1.5);
    });

    it('skips materialOverrides when applying across different models', async () => {
        // 跨模型保护：matIndex 不通用，overrides 应被跳过，仅 categories 生效
        createModel('m1');
        const preset: ModelPresetFile = {
            version: 1,
            model: { filePath: 'D:/different/model.pmx', name: 'other', kind: 'actor' },
            transform: {},
            visibility: {},
            vmd: { path: null, name: '' },
            materialCategories: {
                皮肤: {
                    diffuseMul: 0.8,
                    specularMul: 1.2,
                    shininess: 100,
                    ambientMul: 0.9,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                },
            },
            materialOverrides: {
                0: {
                    diffuseMul: 1.5,
                    specularMul: 0.5,
                    shininess: 10,
                    ambientMul: 1.2,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                },
            },
        };

        await applyModelPreset('m1', JSON.stringify(preset));

        const state = getMatState('m1');
        expect(state).not.toBeNull();
        expect(state!.categories['皮肤'].shininess).toBe(100);
        // 跨模型时 overrides 应被跳过，不写入状态
        expect(state!.overrides[0]).toBeUndefined();
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
