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
    _applyAll,
} from '../scene/scene';

function makeMockMat(origR = 1, origG = 1, origB = 1) {
    const mat = new StandardMaterial('skin');
    mat.diffuseColor.r = origR;
    mat.diffuseColor.g = origG;
    mat.diffuseColor.b = origB;
    return mat;
}

class SpyColor3 {
    r = 0;
    g = 0;
    b = 0;
    set = vi.fn((r: number, g: number, b: number) => {
        this.r = r;
        this.g = g;
        this.b = b;
    });
    clone() {
        return { r: this.r, g: this.g, b: this.b, set: this.set, clone: () => this };
    }
}

function applyPerMatToBabylonMat(
    mat: {
        diffuseColor: SpyColor3;
        specularColor: SpyColor3;
        specularPower: number;
        ambientColor: SpyColor3;
    },
    origDiffuse: { r: number; g: number; b: number },
    params: { diffuseMul: number; specularMul: number; shininess: number; ambientMul: number }
): void {
    mat.diffuseColor.set(
        origDiffuse.r * params.diffuseMul,
        origDiffuse.g * params.diffuseMul,
        origDiffuse.b * params.diffuseMul
    );
    mat.specularColor.set(
        0.8 * params.specularMul,
        0.8 * params.specularMul,
        0.8 * params.specularMul
    );
    mat.specularPower = params.shininess;
    mat.ambientColor.set(0.3 * params.ambientMul, 0.3 * params.ambientMul, 0.3 * params.ambientMul);
}

describe('_applyAll ordering: per-material overrides category on re-apply', () => {
    const TEST_ID = '_applyAll_test';

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

    it('per-material diffuse overrides category after category re-apply', () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 0.5,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.5);
        setMatParams(TEST_ID, 0, { diffuseMul: 0.9, specularMul: 1, shininess: 50, ambientMul: 1 });
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 0.3,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        expect(mats[0].diffuseColor.r).toBeCloseTo(0.9);
    });

    it('per-material specular overrides category after category re-apply', () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 0.5,
            shininess: 50,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        setMatParams(TEST_ID, 0, { diffuseMul: 1, specularMul: 2, shininess: 50, ambientMul: 1 });
        expect(mats[0].specularColor.r).toBeCloseTo(1.6);
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 0.2,
            shininess: 50,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        expect(mats[0].specularColor.r).toBeCloseTo(1.6);
    });

    it('per-material shininess survives category re-apply', () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        setMatParams(TEST_ID, 0, { diffuseMul: 1, specularMul: 1, shininess: 120, ambientMul: 1 });
        expect(mats[0].specularPower).toBe(120);
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 1,
            shininess: 30,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        expect(mats[0].specularPower).toBe(120);
    });

    it('per-material ambient overrides category after category re-apply', () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 1,
            shininess: 50,
            ambientMul: 0.5,
        });
        _applyAll(TEST_ID);
        setMatParams(TEST_ID, 0, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1.5 });
        expect(mats[0].ambientColor.r).toBeCloseTo(0.45);
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1,
            specularMul: 1,
            shininess: 50,
            ambientMul: 0.1,
        });
        _applyAll(TEST_ID);
        expect(mats[0].ambientColor.r).toBeCloseTo(0.45);
    });

    it('multiple material indices are independent under re-apply', () => {
        const m1 = makeMockMat(1, 1, 1);
        const m2 = makeMockMat(1, 1, 1);
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: m1 }, { material: m2 }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 0.5,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        _applyAll(TEST_ID);
        setMatParams(TEST_ID, 0, { diffuseMul: 0.9, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID);
        expect(m1.diffuseColor.r).toBeCloseTo(0.9);
        expect(m2.diffuseColor.r).toBeCloseTo(0.5);
        _applyAll(TEST_ID);
        expect(m1.diffuseColor.r).toBeCloseTo(0.9);
        expect(m2.diffuseColor.r).toBeCloseTo(0.5);
    });

    it('applies PBR alpha = clamp01(origAlpha * opacity * alphaMul) (fix P2)', () => {
        const mats = [makeMockMat(1, 1, 1)];
        mats[0].alpha = 1;
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1,
        });
        setMatParams(TEST_ID, 0, { alphaMul: 0.5, diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 });
        _applyAll(TEST_ID, { opacity: 0.8, origAlpha: [] });
        expect(mats[0].alpha).toBeCloseTo(1 * 0.8 * 0.5);
    });

    it('reads _matState presence in early-return guard (fix stale-cache guard)', () => {
        const mats = [makeMockMat(1, 1, 1)];
        // @ts-expect-error duck-typed mock material
        modelRegistry.set(TEST_ID, { meshes: [{ material: mats[0] }] });
        setMatCatParams(TEST_ID, '皮肤', {
            diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1,
        });
        _matState.set(TEST_ID, new Map());
        expect(() => _applyAll(TEST_ID)).not.toThrow();
        _matState.clear();
    });
});

describe('per-material params write through to Babylon material properties', () => {
    it('writes diffuseMul → diffuseColor.set with correct multiplier', () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        const orig = { r: 0.8, g: 0.6, b: 0.4 };
        applyPerMatToBabylonMat(mat, orig, {
            diffuseMul: 0.5,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        expect(mat.diffuseColor.set).toHaveBeenCalledTimes(1);
        expect(mat.diffuseColor.set).toHaveBeenCalledWith(0.4, 0.3, 0.2);
    });

    it('writes specularMul → specularColor.set with correct multiplier', () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        applyPerMatToBabylonMat(
            mat,
            { r: 1, g: 1, b: 1 },
            { diffuseMul: 1, specularMul: 1.5, shininess: 50, ambientMul: 1 }
        );
        expect(mat.specularColor.set).toHaveBeenCalledTimes(1);
        expect(mat.specularColor.r).toBeCloseTo(1.2, 10);
    });

    it('writes shininess → specularPower assignment', () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        applyPerMatToBabylonMat(
            mat,
            { r: 1, g: 1, b: 1 },
            { diffuseMul: 1, specularMul: 1, shininess: 120, ambientMul: 1 }
        );
        expect(mat.specularPower).toBe(120);
    });

    it('writes ambientMul → ambientColor.set with correct multiplier', () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        applyPerMatToBabylonMat(
            mat,
            { r: 1, g: 1, b: 1 },
            { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 2 }
        );
        expect(mat.ambientColor.set).toHaveBeenCalledWith(0.6, 0.6, 0.6);
    });

    it('write-through is idempotent', () => {
        const mat = {
            diffuseColor: new SpyColor3(),
            specularColor: new SpyColor3(),
            specularPower: 50,
            ambientColor: new SpyColor3(),
        };
        const orig = { r: 1, g: 1, b: 1 };
        applyPerMatToBabylonMat(mat, orig, {
            diffuseMul: 0.5,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        applyPerMatToBabylonMat(mat, orig, {
            diffuseMul: 0.5,
            specularMul: 1,
            shininess: 50,
            ambientMul: 1,
        });
        expect(mat.diffuseColor.set).toHaveBeenCalledTimes(2);
        expect(mat.diffuseColor.r).toBeCloseTo(0.5);
    });
});
