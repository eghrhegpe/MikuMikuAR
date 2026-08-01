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
import { Material } from '@babylonjs/core/Materials/material';
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
    getMatParams,
    setMatParams,
    resetSingleMatParams,
    resetPerMaterialParams,
    getMatCatParams,
    setMatCatParams,
    getMatDetailList,
    getMatState,
    applyMatState,
} from '../scene/scene';

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
