// @ts-nocheck — vi.mock 运行时替换
// model-preset.test.ts — C 组合并（applyModelPreset / PBRMaterial roundtrip / serializeModelPreset / stopVMD）
// 合并自：model-preset.apply.test.ts、model-preset.pbr.test.ts、model-preset.serialize.test.ts、model-preset.stopvmd.test.ts
// 目的：削减 vitest isolate 模式下重复依赖图加载（同类先例：model-detail-ui 3 文件合并、perception 8→5）。
// 调整说明：
//  - 4 文件 vi.mock 列表几乎相同，取并集去重为一份（pbr 独占的 @babylonjs/core/Materials/PBR/pbrMaterial 保留）。
//  - toast/playback 统一用 model-preset-mocks 的 mockToast()/mockPlayback() 工厂：
//    pbr 原内联版 ({ showInfoToast: vi.fn() }) / ({ updatePlaybackUI: vi.fn() }) 与工厂形状完全等价。
//  - 三份相同的 vi.hoisted DOM 创建块（15 个 DOM id，幂等）去重为一份；pbr 无此块。
//  - 钩子统一为顶层一份 beforeAll(setupDomRefs) + beforeEach(modelPresetBeforeEach)。
//  - 保留 pbr 的 import 顺序约束：PBRMaterial 的 import 必须位于 './model-preset-mocks' 之后。

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// 注意：mocks import 必须位于其他模块 import 之前，否则 hoist 的 vi.mock 工厂
// 引用 mock* 符号时模块尚未初始化（TDZ ReferenceError）。
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
    mockPBRMaterial,
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

// 通过 mock 路径导入，确保拿到 mock 类（而非 vi.importActual 后的真类）
// PBRMaterial 由 babylon-classes 的 MockPBRMaterial 提供（ADR-188 PBR roundtrip），
// material.ts 的 `instanceof PBRMaterial` 检查因此通过；vi.mock 声明见下方 mock 组。
// 注意：本 import 必须位于 './model-preset-mocks' 之后，否则 hoist 的 vi.mock 工厂
// 引用 `mockPBRMaterial` 时会因模块尚未初始化而报 ReferenceError。
import { PBRMaterial as PBRMatClass } from '@babylonjs/core/Materials/PBR/pbrMaterial';

import { applyModelPreset, serializeModelPreset, ModelPresetFile } from '../menus/library';
import { getMatState, applyMatState, stopVMD } from '../scene/scene';
import { modelRegistry, setMmdRuntime, setIsPlaying, isPlaying, mmdRuntime } from '../core/config';
import { modelPresetBeforeEach, setupDomRefs, createModel, fakePbrMeshes } from './model-preset-helpers';

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
vi.mock('@babylonjs/core/Materials/PBR/pbrMaterial', () => mockPBRMaterial());
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

// 创建 PBRMaterial 模型：meshes 的 material 是 PBRMatClass 实例，
// 名称匹配材质分类（_applyCategory 按名称匹配分类）
function createPbrModel(id: string, meshCount: number = 1): { id: string; meshes: any[] } {
    const meshes = fakePbrMeshes(meshCount);
    const categoryNames = ['皮肤', '头发', '服装', '眼睛', '口腔', '未知'];
    for (let i = 0; i < meshes.length; i++) {
        meshes[i].material = new PBRMatClass(categoryNames[i % categoryNames.length]);
    }
    const rootMesh = meshes[0];
    const inst = {
        id,
        name: 'test-pbr-model',
        filePath: 'D:/models/pbr-test.pmx',
        port: 1234,
        modelDir: 'D:/models',
        meshes,
        rootMesh,
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
    modelRegistry.set(id, inst);
    return { id, meshes };
}

// 统一钩子（原 4 文件各 describe 内重复，合并为顶层一份）
beforeAll(() => {
    setupDomRefs();
});
beforeEach(() => {
    modelPresetBeforeEach();
});

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
                    alphaMul: 1,
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
                    alphaMul: 1,
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
                    alphaMul: 1,
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
                    alphaMul: 1,
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

describe('PBRMaterial getMatState / applyMatState', () => {
    it('PBRMaterial roundtrip: categories diffuseMul/shininess/specularMul → getMatState 返回原始 params', () => {
        const { meshes } = createPbrModel('pbr1', 2);

        applyMatState('pbr1', {
            categories: {
                皮肤: {
                    diffuseMul: 1.5,
                    specularMul: 0.6,
                    shininess: 80,
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
                    diffuseMul: 0.8,
                    specularMul: 1.5,
                    shininess: 30,
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

        const state = getMatState('pbr1');
        expect(state).not.toBeNull();
        // getMatState 返回原始 MaterialCategoryParams（非 PBR 属性），与 StandardMaterial 一致
        expect(state!.categories['皮肤'].diffuseMul).toBe(1.5);
        expect(state!.categories['皮肤'].shininess).toBe(80);
        expect(state!.categories['皮肤'].specularMul).toBe(0.6);
        expect(state!.categories['头发'].specularMul).toBe(1.5);
    });

    it('PBRMaterial applyMatState 后 material.albedoColor 被 _applyPbrMatParams 修改', () => {
        const { meshes } = createPbrModel('pbr2', 1);
        const mat = meshes[0].material;
        // 初始 albedoColor
        expect(mat.albedoColor.r).toBe(1);

        applyMatState('pbr2', {
            categories: {
                皮肤: {
                    diffuseMul: 2,
                    specularMul: 0.5,
                    shininess: 100,
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

        // albedoColor = orig.albedo.scale(diffuseMul) → r = 1 * 2 = 2
        expect(mat.albedoColor.r).toBe(2);
        // reflectionColor = orig.reflection.scale(specularMul) → r = 1 * 0.5 = 0.5
        expect(mat.reflectionColor.r).toBe(0.5);
        // roughness = (200 - shininess) / 200 = (200 - 100) / 200 = 0.5
        expect(mat.roughness).toBe(0.5);
    });

    it('PBRMaterial overrides roundtrip: per-matIndex params 正确存储', () => {
        const { meshes } = createPbrModel('pbr3', 3);

        applyMatState('pbr3', {
            overrides: {
                0: {
                    diffuseMul: 1.2,
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
                },
                2: {
                    diffuseMul: 0.5,
                    specularMul: 2,
                    shininess: 200,
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

        const state = getMatState('pbr3');
        expect(state).not.toBeNull();
        expect(state!.overrides[0].diffuseMul).toBe(1.2);
        expect(state!.overrides[2].diffuseMul).toBe(0.5);
        // 未设置的 matIndex 1 不出现
        expect(state!.overrides[1]).toBeUndefined();
    });

    it('PBRMaterial empty state → getMatState 返回 null', () => {
        createPbrModel('pbr4');
        applyMatState('pbr4', {});
        expect(getMatState('pbr4')).toBeNull();
    });

    it('PBRMaterial string-keyed overrides (Object.entries cast)', () => {
        const overrides: Record<string, any> = {
            '1': {
                diffuseMul: 1.8,
                specularMul: 0.3,
                shininess: 150,
                ambientMul: 1.2,
                emissiveMul: 1,
                diffuseTexLevel: 1,
                bumpTexLevel: 1,
                toonTexLevel: 1,
                sphereTexLevel: 1,
                emissiveTexLevel: 1,
                alphaMul: 1,
            },
        };
        createPbrModel('pbr5', 2);
        applyMatState('pbr5', { overrides });
        const state = getMatState('pbr5');
        expect(state!.overrides[1].diffuseMul).toBe(1.8);
    });

    it('PBRMaterial category 参数 shininess→roughness 反比映射正确', () => {
        const { meshes } = createPbrModel('pbr6', 1);
        const mat = meshes[0].material;

        // shininess=0 → roughness=1 (极粗糙)
        applyMatState('pbr6', {
            categories: { 皮肤: { diffuseMul: 1, specularMul: 1, shininess: 0, ambientMul: 1, emissiveMul: 1, diffuseTexLevel: 1, bumpTexLevel: 1, toonTexLevel: 1, sphereTexLevel: 1, emissiveTexLevel: 1, alphaMul: 1 } },
        });
        expect(mat.roughness).toBe(1);

        // shininess=200 → roughness=0 (极光滑)
        applyMatState('pbr6', {
            categories: { 皮肤: { diffuseMul: 1, specularMul: 1, shininess: 200, ambientMul: 1, emissiveMul: 1, diffuseTexLevel: 1, bumpTexLevel: 1, toonTexLevel: 1, sphereTexLevel: 1, emissiveTexLevel: 1, alphaMul: 1 } },
        });
        expect(mat.roughness).toBe(0);
    });

    it('PBRMaterial 旧 preset 加载后再次保存 → roundtrip 不丢数据', () => {
        // 模拟：旧 StandardMaterial preset 写入 → PBRMaterial 模型加载 → 再次保存
        const { meshes } = createPbrModel('pbr7', 2);

        const oldPreset = {
            categories: {
                皮肤: {
                    diffuseMul: 1.3,
                    specularMul: 0.7,
                    shininess: 60,
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
        };
        applyMatState('pbr7', oldPreset);

        // 模拟再次保存（旧 preset 数据在 PBR 模型上被重新序列化）
        const resaved = getMatState('pbr7');
        expect(resaved).not.toBeNull();
        expect(resaved!.categories['皮肤'].diffuseMul).toBe(1.3);
        expect(resaved!.categories['皮肤'].shininess).toBe(60);

        // 模拟再次加载到另一个 PBR 模型
        createPbrModel('pbr8', 2);
        applyMatState('pbr8', resaved!);
        const final = getMatState('pbr8');
        expect(final!.categories['皮肤'].diffuseMul).toBe(1.3);
    });
});

describe('PBRMaterial + SSS 状态 roundtrip', () => {
    it('PBRMaterial 模型的 SSS 状态可被 getMatState 捕获并 roundtrip', () => {
        createPbrModel('pbr-sss', 2);

        // 设置 SSS 状态（applyMatSssState → setMatSssParams → _sssState）
        applyMatState('pbr-sss', {
            sssCategories: {
                皮肤: {
                    sssPower: 0.8,
                    sssColor: { r: 1, g: 0.6, b: 0.4 },
                    sssDistance: 0.3,
                    sssMinThickness: 0,
                    sssMaxThickness: 1,
                },
            },
        });

        const state = getMatState('pbr-sss');
        expect(state).not.toBeNull();
        expect(state!.sssCategories).toBeDefined();
        expect(state!.sssCategories!['皮肤'].sssPower).toBe(0.8);
        expect(state!.sssCategories!['皮肤'].sssColor.r).toBe(1);
    });

    it('PBRMaterial 模型 + 普通 categories + SSS 一起 roundtrip', () => {
        createPbrModel('pbr-sss2', 2);

        applyMatState('pbr-sss2', {
            categories: {
                皮肤: {
                    diffuseMul: 1.4,
                    specularMul: 0.9,
                    shininess: 120,
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
            sssCategories: {
                皮肤: {
                    sssPower: 0.5,
                    sssColor: { r: 0.9, g: 0.7, b: 0.6 },
                    sssDistance: 0.6,
                    sssMinThickness: 0,
                    sssMaxThickness: 0.8,
                },
            },
        });

        const state = getMatState('pbr-sss2');
        expect(state).not.toBeNull();
        expect(state!.categories['皮肤'].diffuseMul).toBe(1.4);
        expect(state!.sssCategories!['皮肤'].sssPower).toBe(0.5);

        // 再次应用到另一个模型，验证完整 roundtrip
        createPbrModel('pbr-sss3', 2);
        applyMatState('pbr-sss3', state!);
        const final = getMatState('pbr-sss3');
        expect(final!.categories['皮肤'].diffuseMul).toBe(1.4);
        expect(final!.sssCategories!['皮肤'].sssPower).toBe(0.5);
    });
});

describe('PBRMaterial serializeModelPreset JSON 结构', () => {
    it('PBRMaterial 模型 + categories 的 serializeModelPreset JSON 包含 materialCategories', () => {
        createPbrModel('pbr-ser', 2);
        applyMatState('pbr-ser', {
            categories: {
                皮肤: {
                    diffuseMul: 1.2,
                    specularMul: 0.8,
                    shininess: 60,
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

        const json = serializeModelPreset('pbr-ser');
        const parsed = JSON.parse(json);

        expect(parsed.materialCategories).toBeDefined();
        expect(parsed.materialCategories['皮肤'].diffuseMul).toBe(1.2);
        expect(parsed.materialCategories['皮肤'].shininess).toBe(60);
        // materialOverrides 和 materialEnabled 应为空对象
        expect(parsed.materialOverrides).toEqual({});
        expect(parsed.materialEnabled).toEqual({});
        // materialSssCategories 不应存在（无 SSS 设置）
        expect(parsed.materialSssCategories).toBeUndefined();
    });

    it('PBRMaterial 模型 + SSS 的 serializeModelPreset JSON 包含 materialSssCategories', () => {
        createPbrModel('pbr-ser2', 2);
        applyMatState('pbr-ser2', {
            sssCategories: {
                皮肤: {
                    sssPower: 0.7,
                    sssColor: { r: 0.8, g: 0.5, b: 0.3 },
                    sssDistance: 0.4,
                    sssMinThickness: 0,
                    sssMaxThickness: 1,
                },
            },
        });

        const json = serializeModelPreset('pbr-ser2');
        const parsed = JSON.parse(json);

        expect(parsed.materialSssCategories).toBeDefined();
        expect(parsed.materialSssCategories['皮肤'].sssPower).toBe(0.7);
        expect(parsed.materialSssCategories['皮肤'].sssColor.r).toBe(0.8);
        // materialCategories 应为空对象（无 categories 设置）
        expect(parsed.materialCategories).toEqual({});
    });
});

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
                    alphaMul: 1,
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
                    alphaMul: 1,
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

// 保留 isPlaying / mmdRuntime 的引用以满足未使用导入检查（applySpies 内部使用）
void isPlaying;
void mmdRuntime;

// =====================================================================
// getMatState / applyMatState（原 model-preset.material.test.ts 并入；
// import/mock 与上方完全重叠，钩子顶层已有，describe 内部不再重复注册）
// =====================================================================
describe('getMatState / applyMatState', () => {
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
