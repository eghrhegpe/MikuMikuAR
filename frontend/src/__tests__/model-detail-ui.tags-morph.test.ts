// [doc:adr-204] model-detail-ui.test.ts 拆分：buildModelTagsLevel + buildMorphPreviewLevel
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    mockEngine,
    mockScene,
    mockHemisphericLight,
    mockDirectionalLight,
    mockArcRotateCamera,
    mockCamera,
    mockMathColor,
    mockMathVector,
    mockStandardMaterial,
    mockMaterial,
    mockMesh,
    mockSceneLoader,
    mockDefaultRenderingPipeline,
    mockPhysicsEngineComponent,
    mockMmdDynamic,
    mockDxBmpTextureLoader,
    mockMmdWasmInstance,
    mockSinglePhysicsRelease,
    mockVmdLoader,
    mockMmdWasmAnimation,
    mockMmdWasmRuntimeModelAnimation,
    mockMmdStandardMaterialProxy,
    mockMmdRuntimeShared,
    mockMmdModelLoaderDefault,
    mockTextureAlphaCheckerVertex,
    mockTextureAlphaCheckerFragment,
    mockTgaTextureLoader,
} from './model-preset-mocks';
import {
    mockShadowGenerator,
    mockGpuParticleSystem,
    mockParticleSystem,
    mockGridMaterial,
    mockBaseTexture,
    mockTexture,
    mockCubeTexture,
    mockEmpty,
    mockSceneScene,
    mockSceneMenu,
    mockOutfitModule,
    mockLipsync,
    mockProceduralMotion,
    mockBeatDetectorModule,
    mockAudioModule,
} from './model-detail-ui-mocks';

vi.mock('@babylonjs/core/Engines/engine', () => mockEngine());
vi.mock('@babylonjs/core/scene', () => mockScene());
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => mockHemisphericLight());
vi.mock('@babylonjs/core/Lights/directionalLight', () => mockDirectionalLight());
vi.mock('@babylonjs/core/Physics/v2/physicsEngineComponent', () => mockPhysicsEngineComponent());
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => mockArcRotateCamera());
vi.mock('@babylonjs/core/Cameras/camera', () => mockCamera());
vi.mock('@babylonjs/core/Maths/math.color', () => mockMathColor());
vi.mock('@babylonjs/core/Maths/math.vector', () => mockMathVector());
vi.mock('@babylonjs/core/Materials/standardMaterial', () => mockStandardMaterial());
vi.mock('@babylonjs/core/Materials/material', () => mockMaterial());
vi.mock('@babylonjs/core/Meshes/mesh', () => mockMesh());
vi.mock('@babylonjs/core/Lights/Shadows/shadowGenerator', () => mockShadowGenerator());
vi.mock('@babylonjs/core/Loading/sceneLoader', () => mockSceneLoader());
vi.mock(
    '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline',
    () => mockDefaultRenderingPipeline()
);
vi.mock('@babylonjs/core/Particles/gpuParticleSystem', () => mockGpuParticleSystem());
vi.mock('@babylonjs/core/Particles/particleSystem', () => mockParticleSystem());
vi.mock('@babylonjs/core/Particles/webgl2ParticleSystem', () => mockEmpty());
vi.mock('@babylonjs/materials/grid/gridMaterial', () => mockGridMaterial());
vi.mock('@babylonjs/core/Materials/Textures/baseTexture', () => mockBaseTexture());
vi.mock('@babylonjs/core/Materials/Textures/texture', () => mockTexture());
vi.mock('@babylonjs/core/Materials/Textures/cubeTexture', () => mockCubeTexture());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => mockTgaTextureLoader());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader', () => mockEmpty());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader', () => mockEmpty());
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => mockMmdStandardMaterialProxy());
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => mockMmdRuntimeShared());
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => mockMmdModelLoaderDefault());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => mockTextureAlphaCheckerVertex());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => mockTextureAlphaCheckerFragment());
vi.mock('babylon-mmd/esm/Loader/dynamic', () => mockMmdDynamic());
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => mockDxBmpTextureLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => mockMmdWasmInstance());
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () => mockSinglePhysicsRelease());
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => mockVmdLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () => mockMmdWasmAnimation());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () => mockMmdWasmRuntimeModelAnimation());
vi.mock('../scene/scene', () => mockSceneScene());
vi.mock('../scene-menu', () => mockSceneMenu());
vi.mock('../outfit/outfit', () => mockOutfitModule());
vi.mock('../motion/lipsync', () => mockLipsync());
vi.mock('../motion/procedural-motion', () => mockProceduralMotion());
vi.mock('../motion/beat-detector', () => mockBeatDetectorModule());
vi.mock('../audio', () => mockAudioModule());

import { createModel, cleanup, hasRenderCustom } from './model-detail-ui-helpers';
import { buildModelTagsLevel, buildMorphPreviewLevel } from '../menus/model-detail';

beforeEach(() => cleanup());

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
