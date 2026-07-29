// @ts-nocheck — vi.mock 运行时替换（见 ./material-editor-mocks）
import { describe, it, expect, vi } from 'vitest';
import {
    engineModuleFactory,
    sceneModuleFactory,
    nodeModuleFactory,
    lightModuleFactory,
    hemiLightModuleFactory,
    dirLightModuleFactory,
    arcRotCamModuleFactory,
    cameraModuleFactory,
    mathColorModuleFactory,
    mathVectorModuleFactory,
    stdMatModuleFactory,
    materialModuleFactory,
    meshModuleFactory,
    postProcessModuleFactory,
    sceneLoaderModuleFactory,
    defaultRenderingPipelineModuleFactory,
    physicsEngineModuleMock,
    tgaLoaderModuleMock,
    mmdCameraModuleFactory,
    mmdRegisterLoadersFactory,
    mmdRegisterDxBmpFactory,
    mmdGetWasmInstanceFactory,
    mmdSinglePhysicsReleaseMock,
    mmdWasmRuntimeFactory,
    mmdVmdLoaderFactory,
    mmdWasmAnimationFactory,
    mmdRuntimeModelAnimMock,
    mmdStdMaterialProxyFactory,
    mmdRuntimeSharedFactory,
    mmdModelLoaderDefaultMock,
    mmdTextureAlphaVertexMock,
    mmdTextureAlphaFragmentMock,
} from './material-editor-mocks';

vi.mock('@babylonjs/core/Engines/engine', () => engineModuleFactory());
vi.mock('@babylonjs/core/scene', () => sceneModuleFactory());
vi.mock('@babylonjs/core/node', () => nodeModuleFactory());
vi.mock('@babylonjs/core/Lights/light', () => lightModuleFactory());
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => hemiLightModuleFactory());
vi.mock('@babylonjs/core/Lights/directionalLight', () => dirLightModuleFactory());
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => arcRotCamModuleFactory());
vi.mock('@babylonjs/core/Cameras/camera', () => cameraModuleFactory());
vi.mock('@babylonjs/core/Maths/math.color', () => mathColorModuleFactory());
vi.mock('@babylonjs/core/Maths/math.vector', () => mathVectorModuleFactory());
vi.mock('@babylonjs/core/Materials/standardMaterial', () => stdMatModuleFactory());
vi.mock('@babylonjs/core/Materials/material', () => materialModuleFactory());
vi.mock('@babylonjs/core/Meshes/mesh', () => meshModuleFactory());
vi.mock('@babylonjs/core/PostProcesses/postProcess', () => postProcessModuleFactory());
vi.mock('@babylonjs/core/Loading/sceneLoader', () => sceneLoaderModuleFactory());
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () =>
    defaultRenderingPipelineModuleFactory()
);
vi.mock('@babylonjs/core/Physics/v2/physicsEngineComponent', () => physicsEngineModuleMock);
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => tgaLoaderModuleMock);
vi.mock('babylon-mmd/esm/Runtime/mmdCamera', () => mmdCameraModuleFactory());
vi.mock('babylon-mmd/esm/Loader/dynamic', () => mmdRegisterLoadersFactory());
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => mmdRegisterDxBmpFactory());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => mmdGetWasmInstanceFactory());
vi.mock(
    'babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease',
    () => mmdSinglePhysicsReleaseMock
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => mmdWasmRuntimeFactory());
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => mmdVmdLoaderFactory());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () =>
    mmdWasmAnimationFactory()
);
vi.mock(
    'babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation',
    () => mmdRuntimeModelAnimMock
);
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => mmdStdMaterialProxyFactory());
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => mmdRuntimeSharedFactory());
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => mmdModelLoaderDefaultMock);
vi.mock(
    'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex',
    () => mmdTextureAlphaVertexMock
);
vi.mock(
    'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment',
    () => mmdTextureAlphaFragmentMock
);

import { _catOf } from '../scene/scene';

describe('_catOf material classification', () => {
    it('classifies "skin" as 皮肤', () => {
        expect(_catOf('skin')).toBe('皮肤');
    });

    it('classifies "face" as 皮肤', () => {
        expect(_catOf('face')).toBe('皮肤');
    });

    it('classifies "髪" as 头发', () => {
        expect(_catOf('髪')).toBe('头发');
    });

    it('classifies "hair" as 头发', () => {
        expect(_catOf('hair')).toBe('头发');
    });

    it('classifies "eye" as 眼睛', () => {
        expect(_catOf('eye')).toBe('眼睛');
    });

    it('classifies "目" as 眼睛', () => {
        expect(_catOf('目')).toBe('眼睛');
    });

    it('classifies "pupil" as 眼睛', () => {
        expect(_catOf('pupil')).toBe('眼睛');
    });

    it('classifies unknown names as 服装', () => {
        expect(_catOf('skirt')).toBe('服装');
        expect(_catOf('shoes')).toBe('服装');
        expect(_catOf('ribbon')).toBe('服装');
    });

    it('is case insensitive', () => {
        expect(_catOf('Skin')).toBe('皮肤');
        expect(_catOf('FACE')).toBe('皮肤');
        expect(_catOf('Hair')).toBe('头发');
    });

    it('classifies "kihada" (肌) as 皮肤', () => {
        expect(_catOf('kihada')).toBe('皮肤');
    });

    it('classifies "body" as 皮肤', () => {
        expect(_catOf('body')).toBe('皮肤');
    });

    it('classifies "ahoge" as 头发', () => {
        expect(_catOf('ahoge')).toBe('头发');
    });
});
