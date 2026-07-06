// [doc:test-strategy] Binding 契约测试
// 锁住 16 个项目自有 interface 的形状 + 106 个函数导出存在性。
// Go 端改 struct 时此处 test 会 fail，防止静默破坏 Go↔TS 边界。

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
    BuildInfo,
    CacheStats,
    ClothConfig,
    Config,
    DanceSet,
    EnvPresetEntry,
    EnvState,
    ExternalPath,
    ExtractResult,
    ModelEntry,
    ModelMeta,
    ModelPresetEntry,
    OverridePaths,
    RenderPreset,
    SoftwareEntry,
    UIState,
} from '../../../bindings/mikumikuar/internal/app/models';
import * as appBinding from '../../../bindings/mikumikuar/internal/app/app';
import {
    createMockBuildInfo,
    createMockCacheStats,
    createMockClothConfig,
    createMockConfig,
    createMockDanceSet,
    createMockEnvPresetEntry,
    createMockEnvState,
    createMockExternalPath,
    createMockExtractResult,
    createMockModelEntry,
    createMockModelMeta,
    createMockModelPresetEntry,
    createMockOverridePaths,
    createMockRenderPreset,
    createMockSoftwareEntry,
    createMockUIState,
} from '../mocks/binding-factories';

// ---------- interface 形状锁 ----------

describe('binding contract: interface shapes', () => {
    it('BuildInfo', () => {
        const f = createMockBuildInfo();
        expect(f).toMatchObject({
            version: expect.any(String),
            buildTime: expect.any(String),
            commitHash: expect.any(String),
            goVersion: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<BuildInfo>();
    });

    it('CacheStats', () => {
        const f = createMockCacheStats();
        expect(f).toMatchObject({
            extractedBytes: expect.any(Number),
            extractedCount: expect.any(Number),
            thumbnailBytes: expect.any(Number),
            thumbnailCount: expect.any(Number),
            serveBytes: expect.any(Number),
            serveCount: expect.any(Number),
            totalBytes: expect.any(Number),
        });
        expectTypeOf(f).toMatchTypeOf<CacheStats>();
    });

    it('ClothConfig', () => {
        const f = createMockClothConfig();
        expect(f).toMatchObject({
            anchorBone: expect.any(String),
            topology: expect.any(String),
            innerRadius: expect.any(Number),
            length: expect.any(Number),
            slope: expect.any(Number),
            segmentsH: expect.any(Number),
            segmentsV: expect.any(Number),
            particleRadius: expect.any(Number),
            compliance: expect.any(Number),
            totalMass: expect.any(Number),
            damping: expect.any(Number),
            gravityScale: expect.any(Number),
            bendCompliance: expect.any(Number),
        });
        expectTypeOf(f).toMatchTypeOf<ClothConfig>();
    });

    it('UIState', () => {
        const f = createMockUIState();
        expect(f).toMatchObject({
            scale: expect.any(Number),
            popupWidth: expect.any(Number),
            accent: expect.any(String),
            fontFamily: expect.any(String),
            animations: expect.any(Boolean),
            blurBg: expect.any(Boolean),
            performanceMode: expect.any(String),
            screenshotFormat: expect.any(String),
            screenshotQuality: expect.any(Number),
        });
        expectTypeOf(f).toMatchTypeOf<UIState>();
    });

    it('OverridePaths', () => {
        const f = createMockOverridePaths();
        expect(f).toMatchObject({
            pmx: expect.any(String),
            vmd: expect.any(String),
            stage: expect.any(String),
            environment: expect.any(String),
            md_dress: expect.any(String),
            setting: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<OverridePaths>();
    });

    it('ExternalPath', () => {
        const f = createMockExternalPath();
        expect(f).toMatchObject({
            path: expect.any(String),
            name: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<ExternalPath>();
    });

    it('SoftwareEntry', () => {
        const f = createMockSoftwareEntry();
        expect(f).toMatchObject({
            name: expect.any(String),
            path: expect.any(String),
            kind: expect.any(String),
            args: expect.any(String),
            managed: expect.any(Boolean),
            icon: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<SoftwareEntry>();
    });

    it('DanceSet', () => {
        const f = createMockDanceSet();
        expect(f).toMatchObject({
            name: expect.any(String),
            vmd_path: expect.any(String),
            audio_path: expect.any(String),
            audio_offset: expect.any(Number),
            description: expect.any(String),
            thumbnail: expect.any(String),
            source: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<DanceSet>();
    });

    it('EnvPresetEntry', () => {
        const f = createMockEnvPresetEntry();
        expect(f).toMatchObject({
            name: expect.any(String),
            label: expect.any(String),
            createdAt: expect.any(Number),
        });
        expectTypeOf(f).toMatchTypeOf<EnvPresetEntry>();
    });

    it('EnvState', () => {
        const f = createMockEnvState();
        expect(f).toMatchObject({
            skyMode: expect.any(String),
            skyColorTop: expect.any(Array),
            skyColorMid: expect.any(Array),
            skyColorBot: expect.any(Array),
            skyTexture: expect.any(String),
            skyRotationY: expect.any(Number),
            skyRotationSpeed: expect.any(Number),
            skyBrightness: expect.any(Number),
            starsEnabled: expect.any(Boolean),
            envIntensity: expect.any(Number),
            groundVisible: expect.any(Boolean),
            groundMode: expect.any(String),
            groundColor: expect.any(Array),
            groundAlpha: expect.any(Number),
            windEnabled: expect.any(Boolean),
            windDirection: expect.any(Array),
            windSpeed: expect.any(Number),
            particleEnabled: expect.any(Boolean),
            particleType: expect.any(String),
            particleEmitRate: expect.any(Number),
            particleSize: expect.any(Number),
            particleSpeed: expect.any(Number),
            waterEnabled: expect.any(Boolean),
            waterLevel: expect.any(Number),
            waterColor: expect.any(Array),
            waterTransparency: expect.any(Number),
            waterWaveHeight: expect.any(Number),
            waterSize: expect.any(Number),
            waterAnimSpeed: expect.any(Number),
            fresnelBias: expect.any(Number),
            fresnelPower: expect.any(Number),
            diffuseStrength: expect.any(Number),
            ambientStrength: expect.any(Number),
            foamTransitionRange: expect.any(Number),
            rippleNormalStrength: expect.any(Number),
            rippleGlintStrength: expect.any(Number),
            causticColor1: expect.any(Array),
            causticColor2: expect.any(Array),
            causticScrollX: expect.any(Number),
            causticScrollY: expect.any(Number),
            fresnelAlphaInfluence: expect.any(Number),
            foamAlphaInfluence: expect.any(Number),
            cloudsEnabled: expect.any(Boolean),
            cloudCover: expect.any(Number),
            cloudScale: expect.any(Number),
            cloudHeight: expect.any(Number),
            fogEnabled: expect.any(Boolean),
            fogMode: expect.any(String),
            fogColor: expect.any(Array),
            fogDensity: expect.any(Number),
            fogStart: expect.any(Number),
            fogEnd: expect.any(Number),
            clothEnabled: expect.any(Boolean),
            clothConfig: expect.any(Object),
        });
        expectTypeOf(f).toMatchTypeOf<EnvState>();
    });

    it('ExtractResult', () => {
        const f = createMockExtractResult();
        expect(f).toMatchObject({
            file_path: expect.any(String),
            dir: expect.any(String),
            cached: expect.any(Boolean),
        });
        expectTypeOf(f).toMatchTypeOf<ExtractResult>();
    });

    it('ModelEntry', () => {
        const f = createMockModelEntry();
        expect(f).toMatchObject({
            dir: expect.any(String),
            file_path: expect.any(String),
            name_jp: expect.any(String),
            name_en: expect.any(String),
            comment: expect.any(String),
            has_thumb: expect.any(Boolean),
            type: expect.any(String),
            format: expect.any(String),
            container: expect.any(String),
            zip_inner: expect.any(String),
            category: expect.any(String),
            source: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<ModelEntry>();
    });

    it('ModelMeta', () => {
        const f = createMockModelMeta();
        expect(f).toMatchObject({
            name_jp: expect.any(String),
            name_en: expect.any(String),
            comment: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<ModelMeta>();
    });

    it('ModelPresetEntry', () => {
        const f = createMockModelPresetEntry();
        expect(f).toMatchObject({
            name: expect.any(String),
            presetName: expect.any(String),
            modelName: expect.any(String),
            modelRef: expect.any(String),
            updatedAt: expect.any(Number),
            autoApply: expect.any(Boolean),
        });
        expectTypeOf(f).toMatchTypeOf<ModelPresetEntry>();
    });

    it('RenderPreset', () => {
        const f = createMockRenderPreset();
        expect(f).toMatchObject({
            name: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<RenderPreset>();
    });

    it('Config', () => {
        const f = createMockConfig();
        expect(f).toMatchObject({
            config_version: expect.any(Number),
            ui_state: expect.any(Object),
            resource_root: expect.any(String),
            override_paths: expect.any(Object),
            blender_path: expect.any(String),
            display_name_priority: expect.any(String),
            download_watch_dir: expect.any(String),
            download_auto_import: expect.any(Boolean),
            mmd_path: expect.any(String),
        });
        expectTypeOf(f).toMatchTypeOf<Config>();
    });
});

// ---------- 函数存在性锁 ----------

describe('binding contract: function exports', () => {
    const expectedFunctions = [
        'AddCustomSoftware',
        'AddExternalPath',
        'AddRecentModel',
        'AddTag',
        'AutoDetectMMD',
        'BundleScene',
        'CleanOrphanCache',
        'ClearAllCaches',
        'ClearExtractCache',
        'ClearThumbnailCache',
        'DeleteDanceSet',
        'DeleteEnvPreset',
        'DeleteModelPreset',
        'DeletePresetScene',
        'DeleteRenderPreset',
        'ExtractZip',
        'GetAllTags',
        'GetAppVersion',
        'GetBuildInfo',
        'GetCacheStats',
        'GetConfig',
        'GetDanceSets',
        'GetDownloadAutoImport',
        'GetDownloadWatchStatus',
        'GetFavorites',
        'GetLibraryIndex',
        'GetModelMeta',
        'GetModelMetaBatch',
        'GetModelPresets',
        'GetModelsByTag',
        'GetPath',
        'GetPresetScenes',
        'GetPresetScenesDir',
        'GetRecentModels',
        'GetRenderPresets',
        'GetTagsByModel',
        'GetThumbnail',
        'GetThumbnailBatch',
        'ImportDanceSet',
        'ImportLocalFile',
        'ImportZip',
        'IsolateModelDir',
        'LaunchSoftware',
        'ListEnvPresets',
        'ListSubDirs',
        'LoadEnvPreset',
        'LoadLastScene',
        'LoadModelPreset',
        'LoadModelPresetFromLib',
        'LoadOutfitFile',
        'LoadSceneFile',
        'OpenInBlender',
        'OpenInMMD',
        'OpenSoftwareDir',
        'OpenWithSoftware',
        'RemoveCustomSoftware',
        'RemoveExternalPath',
        'RemoveTag',
        'RenameExternalPath',
        'RenameModelPreset',
        'SaveDanceSet',
        'SaveEnvPreset',
        'SaveLastScene',
        'SaveModelPreset',
        'SaveModelPresetToLib',
        'SaveRenderPreset',
        'SaveSceneFile',
        'SaveScenePreset',
        'SaveScreenshot',
        'SaveThumbnail',
        'ScanModelDir',
        'ScanSoftwareDir',
        'SelectAudioFile',
        'SelectBundleSaveFile',
        'SelectDir',
        'SelectEnvTextureFile',
        'SelectExeFile',
        'SelectImportFile',
        'SelectPMXFile',
        'SelectPresetOpenFile',
        'SelectPresetSaveFile',
        'SelectSceneOpenFile',
        'SelectSceneSaveFile',
        'SelectVMDMotion',
        'SelectVPDPose',
        'SetBlenderPath',
        'SetDisplayNamePriority',
        'SetDownloadAutoImport',
        'SetDownloadWatchDir',
        'SetEnvState',
        'SetMMDPath',
        'SetOverridePath',
        'SetPerformanceMode',
        'SetResourceRoot',
        'SetUIAccent',
        'SetUIAnimations',
        'SetUIBlurBg',
        'SetUIFontFamily',
        'SetUIPopupWidth',
        'SetUIScale',
        'SetWailsApp',
        'StartFileServer',
        'StartWatchDir',
        'StopFileServer',
        'StopWatchDir',
        'ToggleFavorite',
        'UpdateCustomSoftware',
    ];

    it(`exports ${expectedFunctions.length} functions`, () => {
        const mod = appBinding as Record<string, unknown>;
        for (const name of expectedFunctions) {
            expect(typeof mod[name]).toBe('function');
        }
    });

    it('no unexpected new exports', () => {
        const actual = Object.keys(appBinding).filter(
            (k) => typeof (appBinding as Record<string, unknown>)[k] === 'function'
        );
        const expectedSet = new Set(expectedFunctions);
        const unexpected = actual.filter((k) => !expectedSet.has(k));
        expect(unexpected).toEqual([]);
    });
});
