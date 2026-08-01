// model-preset.material.test.ts — getMatState / applyMatState（拆自 model-preset.test.ts）
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
import { getMatState, applyMatState } from '../scene/scene';
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

describe('getMatState / applyMatState', () => {
    beforeAll(() => {
        setupDomRefs();
    });
    beforeEach(() => {
        modelPresetBeforeEach();
    });

    it('returns null when no material adjustments have been made', () => {
        createModel('m1');
        expect(getMatState('m1')).toBeNull();
    });

    it('roundtrips material categories through getMatState after applyMatState', () => {
        createModel('m1');
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
                    alphaMul: 1,
                },
                头发: {
                    diffuseMul: 1,
                    specularMul: 1.5,
                    shininess: 80,
                    ambientMul: 0.9,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                    alphaMul: 1,
                },
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
                    alphaMul: 1,
                },
                7: {
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
                    alphaMul: 1,
                },
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
