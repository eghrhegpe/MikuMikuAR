// [doc:test-strategy] Binding 契约测试
// 锁住 15 个项目自有 interface 的形状 + 122 个函数导出存在性 + 122 个 FNV-1a method ID。
// Go 端改 struct 时此处 test 会 fail，防止静默破坏 Go↔TS 边界。
// 新增 Go 方法后：在 expectedFunctions 加条目，手写绑定后用此测试验证 method ID。

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
    BuildInfo,
    CacheStats,
    Config,
    EnvPresetEntry,
    EnvState,
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
    createMockConfig,
    createMockEnvPresetEntry,
    createMockEnvState,
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
            groundType: expect.any(String),
            groundStyle: expect.any(String),
            groundColor: expect.any(Array),
            groundAlpha: expect.any(Number),
            groundSize: expect.any(Number),
            groundEdgeFade: expect.any(Number),
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

/**
 * FNV-1a 32-bit hash (Wails v3 method ID 算法).
 * 输入 "mikumikuar/internal/app.App.<MethodName>"
 * 输出 uint32 数字
 */
function fnv1a32(methodName: string): number {
    const prefix = 'mikumikuar/internal/app.App.';
    let hash = 0x811c9dc5;
    const str = prefix + methodName;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0; // >>>0 确保 uint32
    }
    return hash;
}

/**
 * 从 binding 函数源码中提取 $Call.ByID(...) 里的数字 ID.
 * 在 Vitest SSR 模式下，`$Call` 会被 Vite 转写为 `__vite_ssr_import_0__.Call`，
 * 因此匹配 `Call.ByID(N)` 或 `ByID(N)`。
 */
function extractByID(fn: (...args: never[]) => unknown): number | null {
    const src = fn.toString();
    const m = src.match(/[Cc]all\.ByID\((\d+)/) ?? src.match(/ByID\((\d+)/);
    return m ? Number(m[1]) : null;
}

describe('binding contract: function exports', () => {
    const expectedFunctions = [
        'AddCustomSoftware',
        'AddRecentModel',
        'AddTag',
        'BundleScene',
        'CheckForUpdate',
        'CleanOrphanCache',
        'ClearAllCaches',
        'ClearExtractCache',
        'ClearThumbnailCache',
        'ClosePlazaWindow',
        'DeleteEnvPreset',
        'DeleteModelPreset',
        'DeletePresetScene',
        'DeleteRenderPreset',
        'DownloadFromPlaza',
        'ExtractZip',
        'FetchPlazaConfig',
        'GetAllTags',
        'GetAppVersion',
        'GetBuildInfo',
        'GetCachedPlazaConfig',
        'GetCacheStats',
        'GetConfig',
        'GetDownloadAutoImport',
        'GetDownloadWatchStatus',
        'GetDownloadWatchEnabled',
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
        'GetStorageMode',
        'GetLastBrowseDir',
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
        'NavigatePlazaWindow',
        'OpenInBlender',
        'OpenInMMD',
        'OpenScreenshotDir',
        'OpenWithSoftware',
        'PlazaGoBack',
        'ReadTextFile',
        'PlazaGoForward',
        'PlazaReload',
        'PlazaZoomIn',
        'PlazaZoomOut',
        'PlazaZoomReset',
        'RemoveCustomSoftware',
        'RemoveTag',
        'RenameModelPreset',
        'SaveEnvPreset',
        'SaveEnvPresetAuto',
        'SaveLastScene',
        'SaveModelPreset',
        'SaveModelPresetToLib',
        'SaveModelPresetToLibAuto',
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
        'SelectVMDMotion',
        'SelectVPDPose',
        'SetBlenderPath',
        'SetDisplayNamePriority',
        'SetDownloadAutoImport',
        'SetDownloadWatchDir',
        'SetDownloadWatchEnabled',
        'SetEnvState',
        'SetUIState',
        'SetMMDPath',
        'SetOverridePath',
        'SetPerformanceMode',
        'SetResourceRoot',
        'SetLastBrowseDir',
        'SetStorageMode',
        'SetUIAccent',
        'SetUIAnimations',
        'SetUIAutoUpdate',
        'SetUIBlurBg',
        'SetUIFontFamily',
        'SetUIPopupWidth',
        'SetUIScale',
        'SetWailsApp',
        'StartFileServer',
        'StartProxy',
        'StartWatchDir',
        'StopFileServer',
        'StopProxy',
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

// ---------- method ID 锁 ----------

describe('binding contract: method IDs', () => {
    const expectedFunctions = [
        'AddCustomSoftware',
        'AddRecentModel',
        'AddTag',
        'BundleScene',
        'CheckForUpdate',
        'CleanOrphanCache',
        'ClearAllCaches',
        'ClearExtractCache',
        'ClearThumbnailCache',
        'ClosePlazaWindow',
        'DeleteEnvPreset',
        'DeleteModelPreset',
        'DeletePresetScene',
        'DeleteRenderPreset',
        'DownloadFromPlaza',
        'ExtractZip',
        'FetchPlazaConfig',
        'GetAllTags',
        'GetAppVersion',
        'GetBuildInfo',
        'GetCachedPlazaConfig',
        'GetCacheStats',
        'GetConfig',
        'GetDownloadAutoImport',
        'GetDownloadWatchStatus',
        'GetDownloadWatchEnabled',
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
        'GetStorageMode',
        'GetLastBrowseDir',
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
        'NavigatePlazaWindow',
        'OpenInBlender',
        'OpenInMMD',
        'OpenScreenshotDir',
        'OpenWithSoftware',
        'PlazaGoBack',
        'ReadTextFile',
        'PlazaGoForward',
        'PlazaReload',
        'PlazaZoomIn',
        'PlazaZoomOut',
        'PlazaZoomReset',
        'RemoveCustomSoftware',
        'RemoveTag',
        'RenameModelPreset',
        'SaveEnvPreset',
        'SaveEnvPresetAuto',
        'SaveLastScene',
        'SaveModelPreset',
        'SaveModelPresetToLib',
        'SaveModelPresetToLibAuto',
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
        'SelectVMDMotion',
        'SelectVPDPose',
        'SetBlenderPath',
        'SetDisplayNamePriority',
        'SetDownloadAutoImport',
        'SetDownloadWatchDir',
        'SetDownloadWatchEnabled',
        'SetEnvState',
        'SetUIState',
        'SetMMDPath',
        'SetOverridePath',
        'SetPerformanceMode',
        'SetResourceRoot',
        'SetLastBrowseDir',
        'SetStorageMode',
        'SetUIAccent',
        'SetUIAnimations',
        'SetUIAutoUpdate',
        'SetUIBlurBg',
        'SetUIFontFamily',
        'SetUIPopupWidth',
        'SetUIScale',
        'SetWailsApp',
        'StartFileServer',
        'StartProxy',
        'StartWatchDir',
        'StopFileServer',
        'StopProxy',
        'StopWatchDir',
        'ToggleFavorite',
        'UpdateCustomSoftware',
    ];

    it('all method IDs match FNV-1a 32-bit hash', () => {
        const mod = appBinding as Record<string, (...args: never[]) => unknown>;
        const failures: Array<{ name: string; declared: number; expected: number }> = [];

        for (const name of expectedFunctions) {
            const fn = mod[name];
            const declared = extractByID(fn);
            const expected = fnv1a32(name);

            if (declared === null) {
                failures.push({ name, declared: -1, expected });
            } else if (declared !== expected) {
                failures.push({ name, declared, expected });
            }
        }

        if (failures.length > 0) {
            const _lines = failures.map(
                (f) => `  ❌ ${f.name}: declared=${f.declared}, expected=${f.expected}`
            );
            expect(failures).toEqual([]);
        }
    });

    it('each function has a valid $Call.ByID', () => {
        const mod = appBinding as Record<string, (...args: never[]) => unknown>;
        for (const name of expectedFunctions) {
            const fn = mod[name];
            const id = extractByID(fn);
            expect(id, `${name} missing $Call.ByID`).not.toBeNull();
        }
    });
});
