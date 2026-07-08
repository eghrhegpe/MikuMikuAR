// [doc:mock-strategy] Binding contract mock 工厂
// 为 bindings/mikumikuar/internal/app/models.ts 中的 16 个 interface
// 各导出一个工厂函数，返回最小合法 fixture。
// 字段默认值与 Go 端零值语义对齐（空串 / 0 / false / null）。

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
        totalBytes: 0,
        ...overrides,
    };
}

export function createMockClothConfig(overrides?: Partial<ClothConfig>): ClothConfig {
    return {
        anchorBone: '',
        topology: 'grid',
        innerRadius: 0.01,
        length: 0.15,
        slope: 0.8,
        segmentsH: 8,
        segmentsV: 8,
        particleRadius: 0.005,
        compliance: 0.001,
        totalMass: 0.1,
        damping: 0.01,
        gravityScale: 1.0,
        bendCompliance: 0.01,
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

export function createMockExternalPath(overrides?: Partial<ExternalPath>): ExternalPath {
    return {
        path: '',
        name: '',
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

export function createMockDanceSet(overrides?: Partial<DanceSet>): DanceSet {
    return {
        name: '',
        vmd_path: '',
        audio_path: '',
        audio_offset: 0,
        description: '',
        thumbnail: '',
        source: '',
        ...overrides,
    };
}

export function createMockEnvPresetEntry(overrides?: Partial<EnvPresetEntry>): EnvPresetEntry {
    return {
        name: '',
        label: '',
        createdAt: 0,
        ...overrides,
    };
}

export function createMockEnvState(overrides?: Partial<EnvState>): EnvState {
    return {
        skyMode: 'gradient',
        skyColorTop: [0, 0, 1],
        skyColorMid: [0, 0.5, 1],
        skyColorBot: [0.8, 0.9, 1],
        skyTexture: '',
        skyRotationY: 0,
        skyRotationSpeed: 0,
        skyBrightness: 1,
        starsEnabled: false,
        envIntensity: 1,
        groundVisible: true,
        groundMode: 'solid',
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
        groundLevel: 0,
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
        waterEnabled: false,
        waterLevel: 0,
        waterFlip: false,
        waterColor: [0, 0.3, 0.6],
        waterTransparency: 0.8,
        waterWaveHeight: 0.02,
        waterSize: 100,
        waterAnimSpeed: 1,
        foamThreshold: 0.2,
        foamIntensity: 0.4,
        foamOpacity: 0.8,
        fresnelBias: 0.02,
        fresnelPower: 5,
        diffuseStrength: 1,
        ambientStrength: 0.3,
        foamTransitionRange: 0.1,
        rippleNormalStrength: 0.5,
        rippleGlintStrength: 0,
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
        debugClouds: false,
        fogEnabled: false,
        fogMode: 'linear',
        fogColor: [0.8, 0.8, 0.8],
        fogDensity: 0.01,
        fogStart: 10,
        fogEnd: 100,
        clothEnabled: false,
        clothConfig: createMockClothConfig(),
        clothDebugParticles: false,
        clothDebugConstraints: false,
        clothDebugColliders: false,
        solverSubsteps: 4,
        solverTimeScale: 1.0,
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
        external_paths: null,
        blender_path: '',
        display_name_priority: 'name_jp',
        download_watch_dir: '',
        download_auto_import: false,
        favorites: null,
        render_presets: null,
        mmd_path: '',
        custom_software: null,
        tags: null,
        dance_sets: null,
        recent_models: null,
        env: null,
        ...overrides,
    };
}
