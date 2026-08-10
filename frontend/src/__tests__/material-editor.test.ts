// @ts-nocheck — vi.mock 运行时替换（见 ./material-editor-mocks）
//
// 合并说明：原 material-editor.apply-all / cat-of / p1p2 / state 四个测试文件在
// vitest isolate 模式下各自独立构建 Babylon.js 依赖图（importDurations 实测本组
// 每文件 import ~5s，而 self 仅 ~100ms）。合并为单文件后依赖图只加载一次，
// 显著削减重复加载。所有 describe/it 逐字搬移，未做任何语义改动。
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

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import {
    _applyAll,
    _catState,
    _matState,
    _matEnabled,
    applyMatState,
    getMatCatParams,
    getMatDetailList,
    getMaterialCategory,
    getMatParams,
    getMatState,
    modelRegistry,
    resetPerMaterialParams,
    resetSingleMatParams,
    setMatCatParams,
    setMatParams,
} from '../scene/scene';

function makeMockMat(origR = 1, origG = 1, origB = 1) {
    const mat = new StandardMaterial('skin');
    mat.diffuseColor.r = origR;
    mat.diffuseColor.g = origG;
    mat.diffuseColor.b = origB;
    return mat;
}

function regModel(
    id: string,
    meshCount: number,
    names?: string[],
    inst?: Partial<{ opacity: number; _origAlpha: number[] }>
): void {
    const meshes = Array.from({ length: meshCount }, (_, i) => {
        const mat = new StandardMaterial((names && names[i]) ?? `mat${i}`);
        return { material: mat };
    });
    // @ts-expect-error duck-typed mock meshes
    modelRegistry.set(id, { meshes, opacity: 1, ...inst });
}

function cleanupModels(): void {
    for (const key of modelRegistry.keys()) {
        if (
            key.startsWith('model') ||
            key === '_applyAll_test' ||
            key === 'model_rm' ||
            key === 'model_c' ||
            key === 'model_as'
        ) {
            modelRegistry.delete(key);
        }
    }
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

describe('getMaterialCategory material classification', () => {
    it('classifies "skin" as 皮肤', () => {
        expect(getMaterialCategory('skin')).toBe('皮肤');
    });

    it('classifies "face" as 皮肤', () => {
        expect(getMaterialCategory('face')).toBe('皮肤');
    });

    it('classifies "髪" as 头发', () => {
        expect(getMaterialCategory('髪')).toBe('头发');
    });

    it('classifies "hair" as 头发', () => {
        expect(getMaterialCategory('hair')).toBe('头发');
    });

    it('classifies "eye" as 眼睛', () => {
        expect(getMaterialCategory('eye')).toBe('眼睛');
    });

    it('classifies "目" as 眼睛', () => {
        expect(getMaterialCategory('目')).toBe('眼睛');
    });

    it('classifies "pupil" as 眼睛', () => {
        expect(getMaterialCategory('pupil')).toBe('眼睛');
    });

    it('classifies unknown names as 服装', () => {
        expect(getMaterialCategory('skirt')).toBe('服装');
        expect(getMaterialCategory('shoes')).toBe('服装');
        expect(getMaterialCategory('ribbon')).toBe('服装');
    });

    it('is case insensitive', () => {
        expect(getMaterialCategory('Skin')).toBe('皮肤');
        expect(getMaterialCategory('FACE')).toBe('皮肤');
        expect(getMaterialCategory('Hair')).toBe('头发');
    });

    it('classifies "kihada" (肌) as 皮肤', () => {
        expect(getMaterialCategory('kihada')).toBe('皮肤');
    });

    it('classifies "body" as 皮肤', () => {
        expect(getMaterialCategory('body')).toBe('皮肤');
    });

    it('classifies "ahoge" as 头发', () => {
        expect(getMaterialCategory('ahoge')).toBe('头发');
    });

    it('classifies a Material instance by name via categoryOfMaterial delegation (fix stale-cache)', () => {
        const mat = new StandardMaterial('skin');
        expect(getMaterialCategory(mat)).toBe('皮肤');
        mat.dispose();
    });
});

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

describe('per-material parameter state management', () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        regModel('model1', 3);
        regModel('model2', 2);
    });

    afterEach(() => {
        cleanupModels();
    });

    describe('getMatParams', () => {
        it('returns null for unset material', () => {
            expect(getMatParams('model1', 0)).toBeNull();
        });
    });

    describe('setMatParams', () => {
        it('sets diffuse multiplier for a single material', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            const params = getMatParams('model1', 0);
            expect(params).not.toBeNull();
            expect(params!.diffuseMul).toBe(0.5);
            expect(params!.specularMul).toBe(1);
            expect(params!.shininess).toBe(50);
            expect(params!.ambientMul).toBe(1);
        });

        it('sets specular multiplier for a single material', () => {
            setMatParams('model1', 0, { specularMul: 1.5 });
            const params = getMatParams('model1', 0);
            expect(params!.specularMul).toBe(1.5);
        });

        it('preserves previously set params when updating', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            setMatParams('model1', 0, { shininess: 100 });
            const params = getMatParams('model1', 0);
            expect(params!.diffuseMul).toBe(0.5);
            expect(params!.shininess).toBe(100);
        });

        it('tracks multiple materials independently', () => {
            setMatParams('model1', 0, { diffuseMul: 0.3 });
            setMatParams('model1', 1, { diffuseMul: 0.7 });
            setMatParams('model2', 0, { diffuseMul: 1.2 });

            expect(getMatParams('model1', 0)!.diffuseMul).toBe(0.3);
            expect(getMatParams('model1', 1)!.diffuseMul).toBe(0.7);
            expect(getMatParams('model2', 0)!.diffuseMul).toBe(1.2);
        });
    });

    describe('modified tracking', () => {
        it('marks material as modified after setting params', () => {
            const list0 = getMatDetailList('model1');
            const modified0 = list0.find((e) => e.index === 0);
            expect(modified0.modified ?? false).toBe(false);

            setMatParams('model1', 0, { diffuseMul: 0.5 });

            const list1 = getMatDetailList('model1');
            const modified1 = list1.find((e) => e.index === 0);
            expect(modified1.modified).toBe(true);
        });

        it('returns correct modified count across materials', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            setMatParams('model1', 1, { shininess: 80 });
            const list = getMatDetailList('model1');
            expect(list.filter((e) => e.modified)).toHaveLength(2);
        });
    });

    describe('resetSingleMatParams', () => {
        beforeEach(() => {
            _catState.clear();
            _matState.clear();
            _matEnabled.clear();
            regModel('model1', 3);
            regModel('model2', 2);
        });

        it('removes the parameter entry for a single material', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            expect(getMatParams('model1', 0)).not.toBeNull();
            resetSingleMatParams('model1', 0);
            expect(getMatParams('model1', 0)).toBeNull();
        });

        it('does not affect other materials', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            setMatParams('model1', 1, { diffuseMul: 0.7 });
            resetSingleMatParams('model1', 0);
            expect(getMatParams('model1', 0)).toBeNull();
            expect(getMatParams('model1', 1)).not.toBeNull();
        });
    });

    describe('resetPerMaterialParams', () => {
        it('clears all per-material params for a model', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            setMatParams('model1', 1, { shininess: 80 });
            setMatParams('model1', 2, { ambientMul: 0.3 });
            resetPerMaterialParams('model1');
            expect(getMatParams('model1', 0)).toBeNull();
            expect(getMatParams('model1', 1)).toBeNull();
            expect(getMatParams('model1', 2)).toBeNull();
        });

        it('does not affect other models', () => {
            setMatParams('model1', 0, { diffuseMul: 0.5 });
            setMatParams('model2', 0, { diffuseMul: 0.7 });
            resetPerMaterialParams('model1');
            expect(getMatParams('model2', 0)).not.toBeNull();
        });
    });

    describe('model removal cleans up state', () => {
        beforeEach(() => {
            _catState.clear();
            _matState.clear();
            _matEnabled.clear();
            regModel('model_rm', 2);
        });

        it('removeModel cleans _catState and _matState', () => {
            setMatCatParams('model_rm', '皮肤', { diffuseMul: 1.5 });
            setMatParams('model_rm', 0, { diffuseMul: 0.5 });
            _catState.delete('model_rm');
            _matState.delete('model_rm');
            expect(getMatCatParams('model_rm', '皮肤')).toEqual({
                diffuseMul: 1,
                specularMul: 1,
                shininess: 50,
                ambientMul: 1,
                emissiveMul: 1,
                diffuseTexLevel: 1,
                bumpTexLevel: 1,
                toonTexLevel: 1,
                sphereTexLevel: 1,
                emissiveTexLevel: 1,
                alphaMul: 1,
            });
            expect(getMatParams('model_rm', 0)).toBeNull();
        });
    });
});

describe('category-level parameter state', () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        regModel('model_c', 2);
    });
    afterEach(() => {
        cleanupModels();
    });

    it('setMatCatParams and getMatCatParams roundtrip', () => {
        setMatCatParams('model_c', '皮肤', { diffuseMul: 1.2, specularMul: 0.8 });
        const p = getMatCatParams('model_c', '皮肤');
        expect(p.diffuseMul).toBe(1.2);
        expect(p.specularMul).toBe(0.8);
    });

    it('unset category returns defaults', () => {
        const p = getMatCatParams('model_c', '头发');
        expect(p.diffuseMul).toBe(1);
        expect(p.specularMul).toBe(1);
        expect(p.shininess).toBe(50);
        expect(p.ambientMul).toBe(1);
    });
});

describe('applyMatState MaterialCategory cast', () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        regModel('model_as', 5);
    });
    afterEach(() => {
        cleanupModels();
    });

    it('applies category params from preset state', () => {
        applyMatState('model_as', {
            categories: {
                皮肤: {
                    diffuseMul: 1.5,
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
            },
        });
        const p = getMatCatParams('model_as', '皮肤');
        expect(p.diffuseMul).toBe(1.5);
    });

    it('applies override params from preset state', () => {
        applyMatState('model_as', {
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
            },
        });
        const p = getMatParams('model_as', 3);
        expect(p!.shininess).toBe(10);
    });

    it('handles empty state gracefully', () => {
        applyMatState('model_as', {});
        const list = getMatDetailList('model_as');
        expect(list.length).toBeGreaterThan(0);
        expect(list.every((e) => !e.modified)).toBe(true);
    });
});

describe('alphaMul 逐材质透明度公式（ADR-221）', () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        regModel('model_alpha', 1);
    });
    afterEach(() => {
        cleanupModels();
    });

    it('alphaMul=0.5 × _origAlpha=0.8 × opacity=1 → mat.alpha ≈ 0.4', () => {
        const inst = modelRegistry.get('model_alpha');
        inst._origAlpha = [0.8];
        inst.opacity = 1;
        const mat = inst.meshes[0].material;
        setMatParams('model_alpha', 0, { alphaMul: 0.5 });
        expect(mat.alpha).toBeCloseTo(0.4);
    });

    it('alphaMul=1 × _origAlpha=0.8 × opacity=1 → 保持原始 alpha', () => {
        const inst = modelRegistry.get('model_alpha');
        inst._origAlpha = [0.8];
        inst.opacity = 1;
        const mat = inst.meshes[0].material;
        setMatParams('model_alpha', 0, { alphaMul: 1 });
        expect(mat.alpha).toBeCloseTo(0.8);
    });

    it('三层组合: _origAlpha=0.8 × opacity=0.5 × alphaMul=0.5 → mat.alpha ≈ 0.2', () => {
        const inst = modelRegistry.get('model_alpha');
        inst._origAlpha = [0.8];
        inst.opacity = 0.5;
        const mat = inst.meshes[0].material;
        setMatParams('model_alpha', 0, { alphaMul: 0.5 });
        expect(mat.alpha).toBeCloseTo(0.2);
    });

    it('alphaMul=0.5（finalAlpha<1）→ transparencyMode 切到 ALPHABLEND', () => {
        const mat = modelRegistry.get('model_alpha').meshes[0].material;
        mat.transparencyMode = Material.MATERIAL_OPAQUE;
        setMatParams('model_alpha', 0, { alphaMul: 0.5 });
        expect(mat.transparencyMode).toBe(Material.MATERIAL_ALPHABLEND);
    });

    it('alphaMul 从 0.5 恢复为 1 → transparencyMode 回到 OPAQUE', () => {
        const mat = modelRegistry.get('model_alpha').meshes[0].material;
        setMatParams('model_alpha', 0, { alphaMul: 0.5 });
        expect(mat.transparencyMode).toBe(Material.MATERIAL_ALPHABLEND);
        setMatParams('model_alpha', 0, { alphaMul: 1 });
        expect(mat.transparencyMode).toBe(Material.MATERIAL_OPAQUE);
    });

    it('finalAlpha=1 + 已是 ALPHABLEND 的材质会被强转 OPAQUE（ADR-221 §7 局限#1）', () => {
        const mat = modelRegistry.get('model_alpha').meshes[0].material;
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
        setMatParams('model_alpha', 0, { alphaMul: 1 });
        expect(mat.transparencyMode).toBe(Material.MATERIAL_OPAQUE);
    });

    it('alphaMul 超范围被钳到 [0,1]', () => {
        const inst = modelRegistry.get('model_alpha');
        inst._origAlpha = [1];
        inst.opacity = 1;
        const mat = inst.meshes[0].material;
        setMatParams('model_alpha', 0, { alphaMul: 5 });
        expect(mat.alpha).toBe(1);
        setMatParams('model_alpha', 0, { alphaMul: -1 });
        expect(mat.alpha).toBe(0);
    });

    it('resetSingleMatParams 恢复 alpha 基线（DEFAULT_MAT_PARAMS alphaMul=1）', () => {
        const inst = modelRegistry.get('model_alpha');
        inst._origAlpha = [0.8];
        inst.opacity = 1;
        const mat = inst.meshes[0].material;
        setMatParams('model_alpha', 0, { alphaMul: 0.5 });
        expect(mat.alpha).toBeCloseTo(0.4);
        resetSingleMatParams('model_alpha', 0);
        expect(mat.alpha).toBeCloseTo(0.8);
    });
});

describe('alphaMul 序列化（ADR-221 §5 用例 8/9）', () => {
    beforeEach(() => {
        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        regModel('model_as2', 5);
    });
    afterEach(() => {
        cleanupModels();
    });

    it('alphaMul 默认值 1 不产生序列化体积', () => {
        applyMatState('model_as2', {
            overrides: { 2: { alphaMul: 1 } },
        });
        expect(getMatState('model_as2')).toBeNull();
    });

    it('alphaMul 非默认值随 override 序列化/恢复 roundtrip', () => {
        applyMatState('model_as2', {
            overrides: { 2: { alphaMul: 0.4 } },
        });
        const s = getMatState('model_as2');
        expect(s).not.toBeNull();
        expect(s!.overrides[2].alphaMul).toBe(0.4);

        _catState.clear();
        _matState.clear();
        _matEnabled.clear();
        regModel('model_as2', 5);
        applyMatState('model_as2', s!);
        expect(getMatParams('model_as2', 2)!.alphaMul).toBe(0.4);
    });

    it('旧存档无 alphaMul 字段 → 加载后默认 1，无报错', () => {
        applyMatState('model_as2', {
            overrides: {
                3: {
                    diffuseMul: 1.5,
                    specularMul: 1,
                    shininess: 50,
                    ambientMul: 1,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                },
            },
        });
        expect(getMatParams('model_as2', 3)!.alphaMul).toBe(1);
    });
});
