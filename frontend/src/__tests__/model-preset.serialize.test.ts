// model-preset.serialize.test.ts — serializeModelPreset（拆自 model-preset.test.ts）
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
import { serializeModelPreset } from '../menus/library';
import { applyMatState } from '../scene/scene';
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

describe('serializeModelPreset', () => {
    beforeAll(() => {
        setupDomRefs();
    });
    beforeEach(() => {
        modelPresetBeforeEach();
    });

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
        // audio 已从 preset 移除：audio 是场景级单一音轨，不属于角色级 preset
        expect('audio' in parsed).toBe(false);
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
                皮肤: {
                    diffuseMul: 1.2,
                    specularMul: 0.8,
                    shininess: 30,
                    ambientMul: 1,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                },
            },
            overrides: {
                3: {
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
