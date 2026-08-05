// @ts-nocheck — vi.mock 运行时替换（见 ./material-editor-mocks）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { modelRegistry } from '../core/config';

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

import {
    _catState,
    _matState,
    _matEnabled,
    setMatCatParams,
    setMatParams,
    resetSingleMatParams,
} from '../scene/scene';

describe('P2 emissiveMul parameter', () => {
    const TEST_ID = 'emissive_test';

    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        const old = modelRegistry.get(TEST_ID);
        if (old) {
            modelRegistry.delete(TEST_ID);
        }
    });

    afterEach(() => {
        if (modelRegistry.get(TEST_ID)) {
            modelRegistry.delete(TEST_ID);
        }
    });

    it('setMatCatParams applies emissiveMul to emissiveColor', () => {
        const mat = new StandardMaterial('skin');
        mat.emissiveColor.set(0.2, 0.3, 0.4);
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
            emissiveMul: 2,
        });
        expect(mat.emissiveColor.r).toBeCloseTo(0.4);
        expect(mat.emissiveColor.g).toBeCloseTo(0.6);
        expect(mat.emissiveColor.b).toBeCloseTo(0.8);
    });

    it('per-material emissiveMul overrides category', () => {
        const mat = new StandardMaterial('skin');
        mat.emissiveColor.set(0.5, 0.5, 0.5);
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { emissiveMul: 0.5 });
        setMatParams(TEST_ID, 0, { emissiveMul: 1.5 });
        expect(mat.emissiveColor.r).toBeCloseTo(0.75);
    });

    it('[fix P2] per-mat 未显式设置的字段继承 category（alphaMul 不被 DEFAULT 重置）', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }], opacity: 1, _origAlpha: [0.9] });
        // category：alphaMul 0.5（半透明调整）
        setMatCatParams(TEST_ID, '皮肤', { alphaMul: 0.5 });
        // per-mat 只显式设置 emissiveMul：alphaMul 应继承 category 的 0.5
        // 修复前：per-mat 以 DEFAULT(alphaMul=1) 全量覆盖 → mat.alpha 回到 0.9（遮蔽分类调整）
        setMatParams(TEST_ID, 0, { emissiveMul: 1.5 });
        expect(mat.alpha).toBeCloseTo(0.9 * 0.5);
    });
});

describe('P1 texture level parameters', () => {
    const TEST_ID = 'texture_test';

    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        const old = modelRegistry.get(TEST_ID);
        if (old) {
            modelRegistry.delete(TEST_ID);
        }
    });

    afterEach(() => {
        if (modelRegistry.get(TEST_ID)) {
            modelRegistry.delete(TEST_ID);
        }
    });

    it('setMatCatParams applies diffuseTexLevel to diffuseTexture', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error mock texture
        mat.diffuseTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { diffuseTexLevel: 2 });
        expect((mat.diffuseTexture as any)?.level).toBeCloseTo(2);
    });

    it('setMatCatParams applies bumpTexLevel to bumpTexture', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error mock texture
        mat.bumpTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { bumpTexLevel: 0.5 });
        expect((mat.bumpTexture as any)?.level).toBeCloseTo(0.5);
    });

    it('setMatCatParams applies toonTexLevel to toonTexture', () => {
        const mat = new StandardMaterial('skin');
        (mat as any).toonTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { toonTexLevel: 1.5 });
        expect((mat as any).toonTexture?.level).toBeCloseTo(1.5);
    });

    it('setMatCatParams applies sphereTexLevel to sphereTexture', () => {
        const mat = new StandardMaterial('skin');
        (mat as any).sphereTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { sphereTexLevel: 3 });
        expect((mat as any).sphereTexture?.level).toBeCloseTo(3);
    });

    it('setMatCatParams applies emissiveTexLevel to emissiveTexture', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error mock texture
        mat.emissiveTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { emissiveTexLevel: 0.3 });
        expect((mat.emissiveTexture as any)?.level).toBeCloseTo(0.3);
    });

    it('per-material texture level overrides category', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error mock texture
        mat.diffuseTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { diffuseTexLevel: 0.5 });
        setMatParams(TEST_ID, 0, { diffuseTexLevel: 2 });
        expect((mat.diffuseTexture as any)?.level).toBeCloseTo(2);
    });

    it('null texture is handled safely (no crash)', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        expect(() => {
            setMatCatParams(TEST_ID, '皮肤', { diffuseTexLevel: 2 });
        }).not.toThrow();
    });
});

describe('resetMatCatParams restores P1+P2 values', () => {
    const TEST_ID = 'reset_test';

    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        const old = modelRegistry.get(TEST_ID);
        if (old) {
            modelRegistry.delete(TEST_ID);
        }
    });

    afterEach(() => {
        if (modelRegistry.get(TEST_ID)) {
            modelRegistry.delete(TEST_ID);
        }
    });

    it('restores emissiveColor to original', () => {
        const mat = new StandardMaterial('skin');
        mat.emissiveColor.set(0.2, 0.3, 0.4);
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { emissiveMul: 2 });
        expect(mat.emissiveColor.r).toBeCloseTo(0.4);
        resetSingleMatParams(TEST_ID, 0);
        setMatCatParams(TEST_ID, '皮肤', { emissiveMul: 1 });
        expect(mat.emissiveColor.r).toBeCloseTo(0.2);
    });

    it('restores texture levels to original', () => {
        const mat = new StandardMaterial('skin');
        // @ts-expect-error mock texture
        mat.diffuseTexture = { level: 1 };
        // @ts-expect-error duck-typed mock
        modelRegistry.set(TEST_ID, { meshes: [{ material: mat }] });
        setMatCatParams(TEST_ID, '皮肤', { diffuseTexLevel: 2 });
        expect((mat.diffuseTexture as any)?.level).toBeCloseTo(2);
        resetSingleMatParams(TEST_ID, 0);
        setMatCatParams(TEST_ID, '皮肤', { diffuseTexLevel: 1 });
        expect((mat.diffuseTexture as any)?.level).toBeCloseTo(1);
    });
});
