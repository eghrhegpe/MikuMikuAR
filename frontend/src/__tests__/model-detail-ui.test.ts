// [doc:adr-204] model-detail-ui 测试合并（原 3 文件：info / model / tags-morph）
// [doc:perf] 合并动机：vitest isolate 下每文件独立加载 ~40 个 babylon mock 依赖图
// （total import ~5s/文件，self 仅 ~100ms）；三文件 mock 列表完全同构，
// 合并后依赖图只付一次。perception 先例：682b1ba4。
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';

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
import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';

// [doc:perf] 语言包改为运行时加载，测试环境直接预填缓存
beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

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
vi.mock('@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline', () =>
    mockDefaultRenderingPipeline()
);
vi.mock('@babylonjs/core/Particles/gpuParticleSystem', () => mockGpuParticleSystem());
vi.mock('@babylonjs/core/Particles/particleSystem', () => mockParticleSystem());
vi.mock('@babylonjs/core/Particles/webgl2ParticleSystem', () => mockEmpty());
vi.mock('@babylonjs/materials/grid/gridMaterial', () => mockGridMaterial());
vi.mock('@babylonjs/core/Materials/Textures/baseTexture', () => mockBaseTexture());
vi.mock('@babylonjs/core/Materials/Textures/texture', () => mockTexture());
vi.mock('@babylonjs/core/Materials/Textures/cubeTexture', () => mockCubeTexture());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () =>
    mockTgaTextureLoader()
);
vi.mock('@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader', () => mockEmpty());
vi.mock('@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader', () => mockEmpty());
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => mockMmdStandardMaterialProxy());
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => mockMmdRuntimeShared());
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => mockMmdModelLoaderDefault());
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () =>
    mockTextureAlphaCheckerVertex()
);
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () =>
    mockTextureAlphaCheckerFragment()
);
vi.mock('babylon-mmd/esm/Loader/dynamic', () => mockMmdDynamic());
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => mockDxBmpTextureLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => mockMmdWasmInstance());
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () =>
    mockSinglePhysicsRelease()
);
vi.mock('babylon-mmd/esm/Loader/vmdLoader', () => mockVmdLoader());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation', () =>
    mockMmdWasmAnimation()
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () =>
    mockMmdWasmRuntimeModelAnimation()
);
vi.mock('../scene/scene', () => mockSceneScene());
vi.mock('../scene-menu', () => mockSceneMenu());
vi.mock('@/scene/manager/outfit', () => mockOutfitModule());
vi.mock('../motion/lipsync', () => mockLipsync());
vi.mock('../motion/procedural-motion', () => mockProceduralMotion());
vi.mock('../motion/beat-detector', () => mockBeatDetectorModule());
vi.mock('../audio', () => mockAudioModule());

import { fakeMesh, createModel, cleanup, hasRenderCustom } from './model-detail-ui-helpers';
import { modelMetaCache } from '../core/config';
import {
    buildModelInfoLevel,
    buildModelLevel,
    buildModelTagsLevel,
    buildMorphPreviewLevel,
} from '../menus/model-detail';

beforeEach(() => cleanup());

describe('buildModelInfoLevel', () => {
    it('returns valid PopupLevel for existing model', () => {
        createModel('m1', { name: 'test' });
        const level = buildModelInfoLevel('m1');
        expect(level.label).toBe('模型信息');
        expect(hasRenderCustom(level)).toBe(true);
    });

    it('returns fallback for non-existent model', () => {
        const level = buildModelInfoLevel('nonexistent');
        expect(level.label).toBe('模型信息');
    });

    it('renderCustom renders info fields', () => {
        createModel('m1', {
            mmdModel: {
                runtimeBones: Array(20),
                morph: { morphs: Array(10) },
            } as any,
        });
        // Pre-populate modelMetaCache so buildModelInfoLevel can read metadata
        modelMetaCache.set('D:/models/test.pmx', {
            comment: 'test model',
        });
        const level = buildModelInfoLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);
        const labels = Array.from(
            container.querySelectorAll('.info-card-label, .info-card-value')
        ).map((el) => el.textContent);
        expect(labels.some((l) => l && l.includes('1,000'))).toBe(true);
        expect(labels.some((l) => l && l.includes('20'))).toBe(true);
        expect(labels.some((l) => l && l.includes('10'))).toBe(true);
    });

    it('material count uses MmdMesh.materials, not Babylon mesh count', () => {
        // 1 个 Babylon 网格（MmdMesh），但其 materials 数组含 7 个 PMX 材质 —— 应显示 7 而非 1
        const meshWithMaterials = { ...fakeMesh('mat0'), materials: Array(7) };
        createModel('m1', {
            meshes: [meshWithMaterials],
            mmdModel: {
                runtimeBones: Array(3),
                morph: { morphs: Array(2) },
            } as any,
        });
        const level = buildModelInfoLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);
        const labels = Array.from(
            container.querySelectorAll('.info-card-label, .info-card-value')
        ).map((el) => el.textContent);
        expect(labels.some((l) => l && l.includes('7'))).toBe(true);
        expect(labels.some((l) => l && l.includes('材质数'))).toBe(true);
    });
});

describe('buildModelLevel', () => {
    it('returns correct label for existing model', () => {
        createModel('m1', { name: '初音ミク' });
        const level = buildModelLevel('m1');
        expect(level.label).toBe('初音ミク');
        expect(level.dir).toBe('');
        expect(Array.isArray(level.items)).toBe(true);
        expect(hasRenderCustom(level)).toBe(true);
    });

    it('returns fallback label for non-existent model', () => {
        const level = buildModelLevel('nonexistent');
        expect(level.label).toBe('未知模型');
    });

    it('renderCustom creates DOM structure with slide items', () => {
        createModel('m1');
        const level = buildModelLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);

        // 变换卡使用 .cs-row（拖拽卡/缩放/透明度行）
        const slideItems = container.querySelectorAll('.slide-item');
        const csRows = container.querySelectorAll('.cs-row');
        expect(slideItems.length).toBeGreaterThan(5);
        expect(csRows.length).toBeGreaterThan(0);
    });

    it('cards contain expected action labels', () => {
        createModel('m1');
        const level = buildModelLevel('m1');
        const container = document.createElement('div');
        level.renderCustom!(container);

        const text = container.textContent ?? '';
        // 关键标签以可见文本形式渲染（不依赖具体 class，避免 UI 重构导致脆弱断言）
        expect(text).toContain('模型详情');
        // [AI 菜单收纳] 独立的布尔「可见」开关已改为变换卡的「透明度」滑块
        // （与基本信息三态「可见性」预设互补），断言同步更新为可见性细调入口。
        expect(text).toContain('透明度');
        expect(text).toContain('材质调节');
        // [UI 大统一] 变换卡精简为 Gizmo + 缩放倍率 + 透明度
        expect(text).toContain('缩放倍率');
    });
});

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
