// [doc:mock-strategy] Binding contract mock 工厂
// 为 bindings/mikumikuar/internal/app/models.ts 中的 15 个 interface
// 各导出一个工厂函数，返回最小合法 fixture。
// 字段默认值与 Go 端零值语义对齐（空串 / 0 / false / null）。

import type {
    BuildInfo,
    CacheStats,
    Config,
    EnvPresetEntry,
    ExtractResult,
    ModelEntry,
    ModelMeta,
    ModelPresetEntry,
    OverridePaths,
    RenderPreset,
    SoftwareEntry,
    UIState,
} from '../../../bindings/mikumikuar/internal/app/models';
import type { EnvState } from '../../core/types';

export function createMockBuildInfo(overrides?: Partial<BuildInfo>): BuildInfo {
    return {
        version: '0.0.0',
        buildTime: '2026-01-01T00:00:00Z',
        commitHash: 'abc1234',
        goVersion: 'go1.22.0',
        ...overrides,
    };
}

export function createMockCacheStats(overrides?: Partial<CacheStats>): CacheStats {
    return {
        extractedBytes: 0,
        extractedCount: 0,
        thumbnailBytes: 0,
        thumbnailCount: 0,
        serveBytes: 0,
        serveCount: 0,
        resourceBytes: 0,
        resourceCount: 0,
        totalBytes: 0,
        ...overrides,
    };
}

export function createMockUIState(overrides?: Partial<UIState>): UIState {
    return {
        scale: 1.0,
        popupWidth: 280,
        accent: '#4a6cf7',
        fontFamily: 'system',
        animations: true,
        blurBg: true,
        performanceMode: 'balanced',
        screenshotFormat: 'png',
        screenshotQuality: 90,
        autoCameraEnabled: false,
        autoCameraBeatsPerSwitch: 4,
        autoUpdateEnabled: false,
        ...overrides,
    };
}

export function createMockOverridePaths(overrides?: Partial<OverridePaths>): OverridePaths {
    return {
        pmx: '',
        vmd: '',
        audio: '',
        stage: '',
        prop: '',
        environment: '',
        md_dress: '',
        setting: '',
        ...overrides,
    };
}

export function createMockSoftwareEntry(overrides?: Partial<SoftwareEntry>): SoftwareEntry {
    return {
        name: '',
        path: '',
        kind: 'other',
        args: '',
        managed: false,
        icon: '',
        ...overrides,
    };
}

export function createMockEnvPresetEntry(overrides?: Partial<EnvPresetEntry>): EnvPresetEntry {
    return {
        name: '',
        label: '',
        category: 'sky',
        createdAt: 0,
        ...overrides,
    };
}

export function createMockEnvState(overrides?: Partial<EnvState>): EnvState {
    return {
        skyMode: 'color',
        skyColorTop: [0, 0, 1],
        skyColorMid: [0, 0.5, 1],
        skyColorBot: [0.8, 0.9, 1],
        skyTexture: '',
        skyRotationY: 0,
        skyRotationSpeed: 0,
        skyBrightness: 1,
        starsEnabled: false,
        starsTexture: '',
        envIntensity: 1,
        envBrightness: 1,
        groundVisible: true,
        groundType: 'flat',
        groundStyle: 'solid',
        groundDecoStyle: 'none',
        groundColor: [0.2, 0.8, 0.2],
        groundAlpha: 1,
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.5, 0.5, 0.55],
        groundTerrainHeight: 4,
        groundTerrainScale: 0.06,
        groundTerrainSeed: 1337,
        groundTerrainOctaves: 5,
        groundPitch: 0,
        groundRoll: 0,
        groundScrollSpeedX: 0,
        groundScrollSpeedZ: 0,
        groundPattern: 'checker',
        groundReflectionBlend: 0,
        groundReflectionQuality: 'off',
        groundNormalTexture: '',
        groundNormalStrength: 1,
        groundElevationColoring: false,
        groundInfinite: false,
        groundPbrEnabled: false,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1.0,
        groundRoughness: 0.6,
        groundMetallic: 0.0,
        groundReflectionBlur: 0.0,
        groundReflectionDistort: 0.3,
        groundContactShadowEnabled: false,
        groundContactShadowIntensity: 0.5,
        groundContactShadowDistance: 0.5,
        groundLevel: 0,
        groundSize: 60,
        groundEdgeFade: 0,
        windEnabled: false,
        windDirection: [1, 0, 0],
        windSpeed: 0,
        particleEnabled: false,
        particleType: 'snow',
        particleEmitRate: 50,
        particleSize: 1,
        particleSpeed: 1,
        particleSplash: false,
        particleCustomTexture: '',
        particleQuality: 'high',
        waterEnabled: false,
        waterLevel: 0,
        waterFlip: false,
        waterColor: [0, 0.3, 0.6],
        waterTransparency: 0.8,
        waterWaveHeight: 0.02,
        bigWaveHeight: 1.0,
        smallWaveHeight: 1.0,
        waterSize: 100,
        waterAnimSpeed: 1,
        planarReflectBlend: 0,
        reflectionQuality: 'low',
        reflectionMode: 'planar',
        qualityProfile: 'high',
        fresnelBias: 0.02,
        fresnelPower: 5,
        diffuseStrength: 1,
        ambientStrength: 0.3,
        waterRippleSlots: 256,
        rippleNormalStrength: 0.5,
        rippleGlintStrength: 0,
        waterNormalStrength: 0.3,
        waterGlintStrength: 0,
        waterHorizonFade: 0,
        waterSkyColorBlend: 0,
        causticIntensity: 0.2,
        causticColor1: [1, 1, 1],
        causticColor2: [0.5, 0.8, 1],
        causticScrollX: 0.1,
        causticScrollY: 0.05,
        fresnelAlphaInfluence: 0.5,
        waterFogColor: [0.45, 0.48, 0.58],
        waterFogDensity: 0.012,
        waterFogOpacityInfluence: 0,
        underwaterFogDensity: 0.015,
        underwaterChromaticAmount: 20,
        underwaterToneIntensity: 0.5,
        underwaterFogMultiplier: 2,
        underwaterTintStrength: 0.5,
        cloudsEnabled: false,
        cloudCover: 0.5,
        cloudScale: 1,
        cloudHeight: 50,
        cloudThickness: 15,
        cloudVisibility: 3000,
        cloudGap: 0.5,
        cloudErosion: 0.4,
        cloudWeatherStrength: 0.6,
        cloudBacklight: 0.5,
        cloudPowder: 0.8,
        cloudQuality: 'high',
        mirrorEnabled: false,
        debugClouds: false,
        fogEnabled: false,
        fogMode: 'linear',
        fogColor: [0.8, 0.8, 0.8],
        fogDensity: 0.01,
        fogStart: 10,
        fogEnd: 100,
        collisionEnabled: true,
        bodyCollisionEnabled: true,
        groundCollisionEnabled: true,
        sunAngle: 45,
        azimuth: -45,
        lightingPresetName: undefined,
        timeOfDayActive: false,
        timeOfDaySpeed: 3,
        ...overrides,
    };
}

export function createMockExtractResult(overrides?: Partial<ExtractResult>): ExtractResult {
    return {
        file_path: '',
        dir: '',
        cached: false,
        ...overrides,
    };
}

export function createMockModelEntry(overrides?: Partial<ModelEntry>): ModelEntry {
    return {
        dir: '',
        file_path: '',
        name_jp: '',
        name_en: '',
        comment: '',
        has_thumb: false,
        type: 'actor',
        format: 'pmx',
        container: 'file',
        zip_inner: '',
        category: '',
        source: '',
        ...overrides,
    };
}

export function createMockModelMeta(overrides?: Partial<ModelMeta>): ModelMeta {
    return {
        name_jp: '',
        name_en: '',
        comment: '',
        ...overrides,
    };
}

export function createMockModelPresetEntry(
    overrides?: Partial<ModelPresetEntry>
): ModelPresetEntry {
    return {
        name: '',
        presetName: '',
        modelName: '',
        modelRef: '',
        updatedAt: 0,
        autoApply: false,
        ...overrides,
    };
}

export function createMockRenderPreset(overrides?: Partial<RenderPreset>): RenderPreset {
    return {
        name: '',
        params: null,
        ...overrides,
    };
}

export function createMockConfig(overrides?: Partial<Config>): Config {
    return {
        config_version: 1,
        ui_state: createMockUIState(),
        resource_root: '',
        storage_mode: 'private',
        override_paths: createMockOverridePaths(),
        blender_path: '',
        display_name_priority: 'name_jp',
        download_watch_dir: '',
        download_auto_import: false,
        favorites: null,
        render_presets: null,
        mmd_path: '',
        custom_software: null,
        tags: null,
        recent_models: null,
        env: null,
        ...overrides,
    };
}
