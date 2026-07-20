// [doc:adr-137] EnvState 单一源 Schema
// 职责: 定义 EnvState 全部字段的类型 + 默认值，types.ts/state.ts 从此派生。
// 新增字段只需在此追加 + 在 buildDefaultEnvState 中加一行（两处而非三处）。

/** Schema 字段类型定义 */
type FieldDef<TType extends string, TDefault> = {
    type: TType;
    default: TDefault;
} & (TType extends 'enum' ? { values: readonly string[] } : object);

// ======== EnvState Schema ========
// 按 sky / ground / wind / particle / water / water-shader / underwater / clouds / mirror / fog / collision / lighting 分组

export const ENV_STATE_SCHEMA = {
    // --- Sky ---
    skyMode: {
        type: 'enum',
        values: ['color', 'texture', 'procedural'] as const,
        default: 'color' as const,
    },
    skyColorTop: { type: 'tuple3', default: [0.3, 0.5, 0.8] as [number, number, number] },
    skyColorMid: { type: 'tuple3', default: [0.8, 0.8, 0.9] as [number, number, number] },
    skyColorBot: { type: 'tuple3', default: [0.2, 0.2, 0.25] as [number, number, number] },
    skyTexture: { type: 'string', default: '' },
    skyRotationY: { type: 'number', default: 0 },
    skyRotationSpeed: { type: 'number', default: 0 },
    skyBrightness: { type: 'number', default: 1 },
    starsEnabled: { type: 'boolean', default: false },
    starsTexture: { type: 'string', default: '' },
    envIntensity: { type: 'number', default: 2 },

    // --- Ground ---
    groundVisible: { type: 'boolean', default: true },
    groundType: { type: 'enum', values: ['flat', 'terrain'] as const, default: 'flat' as const },
    groundStyle: {
        type: 'enum',
        values: ['solid', 'grid', 'checker', 'texture'] as const,
        default: 'solid' as const,
    },
    groundDecoStyle: {
        type: 'enum',
        values: ['none', 'grid', 'checker'] as const,
        default: 'none' as const,
    },
    groundColor: { type: 'tuple3', default: [0.15, 0.15, 0.18] as [number, number, number] },
    groundAlpha: { type: 'number', default: 0.6 },
    groundTexture: { type: 'string', default: '' },
    groundTextureEnabled: { type: 'boolean', default: false },
    groundTextureScale: { type: 'number', default: 1 },
    groundTextureRotation: { type: 'number', default: 0 },
    groundGridSize: { type: 'number', default: 1 },
    groundLineColor: { type: 'tuple3', default: [0.5, 0.5, 0.55] as [number, number, number] },
    groundTerrainHeight: { type: 'number', default: 4 },
    groundTerrainScale: { type: 'number', default: 0.06 },
    groundTerrainSeed: { type: 'number', default: 1337 },
    groundTerrainOctaves: { type: 'number', default: 5 },
    groundPitch: { type: 'number', default: 0 },
    groundRoll: { type: 'number', default: 0 },
    groundScrollSpeedX: { type: 'number', default: 0 },
    groundScrollSpeedZ: { type: 'number', default: 0 },
    groundPattern: {
        type: 'enum',
        values: ['checker', 'dots', 'stripes', 'radial'] as const,
        default: 'checker' as const,
    },
    groundReflectionBlend: { type: 'number', default: 0.3 },
    groundReflectionQuality: {
        type: 'enum',
        values: ['high', 'medium', 'low', 'off'] as const,
        default: 'medium' as const,
    },
    groundNormalTexture: { type: 'string', default: '' },
    groundNormalStrength: { type: 'number', default: 1 },
    groundElevationColoring: { type: 'boolean', default: false },
    groundInfinite: { type: 'boolean', default: false },
    groundPbrEnabled: { type: 'boolean', default: false },
    groundProceduralTexture: {
        type: 'enum',
        values: ['none', 'wood', 'marble', 'concrete'] as const,
        default: 'none' as const,
    },
    groundProceduralSeed: { type: 'number', default: 42 },
    groundProceduralScale: { type: 'number', default: 1.0 },
    groundRoughness: { type: 'number', default: 0.6 },
    groundMetallic: { type: 'number', default: 0.0 },
    groundReflectionBlur: { type: 'number', default: 0.0 },
    groundReflectionDistort: { type: 'number', default: 0.3 },
    groundContactShadowEnabled: { type: 'boolean', default: false },
    groundContactShadowIntensity: { type: 'number', default: 0.5 },
    groundContactShadowDistance: { type: 'number', default: 0.5 },
    groundLevel: { type: 'number', default: 0 },
    groundSize: { type: 'number', default: 500 },
    groundEdgeFade: { type: 'number', default: 0 },

    // --- Wind ---
    windEnabled: { type: 'boolean', default: true },
    windDirection: { type: 'tuple3', default: [0, 0, 1] as [number, number, number] },
    windSpeed: { type: 'number', default: 5 },

    // --- Particle ---
    particleEnabled: { type: 'boolean', default: false },
    particleType: {
        type: 'enum',
        values: ['none', 'sakura', 'rain', 'snow', 'fireworks', 'fireflies', 'leaves'] as const,
        default: 'none' as const,
    },
    particleEmitRate: { type: 'number', default: 1 },
    particleSize: { type: 'number', default: 1 },
    particleSpeed: { type: 'number', default: 1 },
    particleSplash: { type: 'boolean', default: false },
    particleCustomTexture: { type: 'string', default: '' },

    // --- Water ---
    waterEnabled: { type: 'boolean', default: false },
    waterLevel: { type: 'number', default: 0 },
    waterFlip: { type: 'boolean', default: false },
    waterColor: { type: 'tuple3', default: [0.15, 0.4, 0.6] as [number, number, number] },
    waterTransparency: { type: 'number', default: 0.88 },
    waterWaveHeight: { type: 'number', default: 0.15 },
    bigWaveHeight: { type: 'number', default: 1.0 },
    smallWaveHeight: { type: 'number', default: 1.0 },
    waterSize: { type: 'number', default: 50 },
    waterAnimSpeed: { type: 'number', default: 0.2 },
    planarReflectBlend: { type: 'number', default: 0.5 },
    reflectionQuality: {
        type: 'enum',
        values: ['high', 'medium', 'low', 'off'] as const,
        default: 'off' as const,
        // 统一控制：水面 + 地面 + 镜面反射分辨率（high=2048, medium=1024, low=512）
    },
    // ADR-151: 反射模式（独立于 reflectionQuality，控制 SSR/Probe/Planar 的激活策略）
    reflectionMode: {
        type: 'enum',
        values: ['auto', 'none', 'probe', 'ssr', 'planar', 'hybrid'] as const,
        default: 'auto' as const,
    },
    qualityProfile: {
        type: 'enum',
        values: ['high', 'medium', 'low'] as const,
        default: 'high' as const,
    },

    // --- Water shader ---
    waterFogColor: { type: 'tuple3', default: [0.5, 0.52, 0.62] as [number, number, number] },
    waterFogDensity: { type: 'number', default: 0.006 },
    waterFogOpacityInfluence: { type: 'number', default: 0 },
    waterHorizonFade: { type: 'number', default: 0.8 },
    waterSkyColorBlend: { type: 'number', default: 0.2 },
    fresnelBias: { type: 'number', default: 0.02 },
    fresnelPower: { type: 'number', default: 3.0 },
    diffuseStrength: { type: 'number', default: 0.15 },
    ambientStrength: { type: 'number', default: 0.06 },
    rippleNormalStrength: { type: 'number', default: 0.35 },
    rippleGlintStrength: { type: 'number', default: 0.5 },
    waterNormalStrength: { type: 'number', default: 0.35 },
    waterGlintStrength: { type: 'number', default: 0.1 },
    causticIntensity: { type: 'number', default: 0.1 },
    causticColor1: { type: 'tuple3', default: [1.0, 0.9, 0.6] as [number, number, number] },
    causticColor2: { type: 'tuple3', default: [1.0, 1.0, 0.8] as [number, number, number] },
    causticScrollX: { type: 'number', default: 0.1 },
    causticScrollY: { type: 'number', default: 0.15 },
    fresnelAlphaInfluence: { type: 'number', default: 0.35 },

    // --- Underwater ---
    underwaterFogDensity: { type: 'number', default: 0.05 },
    underwaterChromaticAmount: { type: 'number', default: 20 },
    underwaterToneIntensity: { type: 'number', default: 0.5 },
    underwaterFogMultiplier: { type: 'number', default: 2 },
    underwaterTintStrength: { type: 'number', default: 0.5 },

    // --- Clouds ---
    cloudsEnabled: { type: 'boolean', default: false },
    debugClouds: { type: 'boolean', default: false },
    cloudCover: { type: 'number', default: 0.5 },
    cloudScale: { type: 'number', default: 0.55 },
    cloudHeight: { type: 'number', default: 300 },
    cloudThickness: { type: 'number', default: 60 },
    cloudVisibility: { type: 'number', default: 8000 },
    cloudGap: { type: 'number', default: 0.1 },
    cloudErosion: { type: 'number', default: 0.4 },
    cloudWeatherStrength: { type: 'number', default: 0.6 },
    cloudBacklight: { type: 'number', default: 0.5 },
    cloudPowder: { type: 'number', default: 0.8 },
    cloudQuality: { type: 'enum', values: ['standard', 'high'] as const, default: 'high' as const },

    // --- Mirror ---
    mirrorEnabled: { type: 'boolean', default: false },

    // --- Fog ---
    fogEnabled: { type: 'boolean', default: false },
    fogMode: { type: 'enum', values: ['exp', 'exp2', 'linear'] as const, default: 'exp2' as const },
    fogColor: { type: 'tuple3', default: [0.5, 0.5, 0.6] as [number, number, number] },
    fogDensity: { type: 'number', default: 0.01 },
    fogStart: { type: 'number', default: 10 },
    fogEnd: { type: 'number', default: 100 },

    // --- Collision ---
    collisionEnabled: { type: 'boolean', default: true },
    bodyCollisionEnabled: { type: 'boolean', default: true },
    groundCollisionEnabled: { type: 'boolean', default: true },

    // --- Lighting / Time ---
    sunAngle: { type: 'number', default: 45 },
    azimuth: { type: 'number', default: -45 },
    lightingPresetName: { type: 'optional-string', default: undefined },
    timeOfDayActive: { type: 'boolean', default: false },
    timeOfDaySpeed: { type: 'number', default: 3 },
} as const;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;
