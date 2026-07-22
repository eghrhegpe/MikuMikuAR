// [doc:adr-137] EnvState 单一源 Schema
// 职责: 定义 EnvState 全部字段的类型 + 默认值 + dispatch 分组，types.ts/state.ts 从此派生。
// 新增字段只需在此追加（type + default + group），各子系统通过 getEnvKeys(group) 自动获取 key 列表。
// 无需再手工维护 _SKY_KEYS / _GROUND_KEYS / _WATER_KEYS 等数组。

/** Schema 字段类型定义 */
type _FieldDef<TType extends string, TDefault> = {
    type: TType;
    default: TDefault;
    /** dispatch 分组：字段变化时触发哪些子系统回调。未指定 = 不触发任何子系统。 */
    group?: string | readonly string[];
} & (TType extends 'enum' ? { values: readonly string[] } : object);

// ======== EnvState Schema ========
// 按 sky / ground / wind / particle / water / water-shader / underwater / clouds / mirror / fog / collision / lighting 分组

export const ENV_STATE_SCHEMA = {
    // --- Sky ---
    skyMode: {
        type: 'enum',
        values: ['color', 'texture', 'procedural'] as const,
        default: 'color' as const,
        group: 'sky',
    },
    skyColorTop: {
        type: 'tuple3',
        default: [0.3, 0.5, 0.8] as [number, number, number],
        group: 'sky',
    },
    skyColorMid: {
        type: 'tuple3',
        default: [0.8, 0.8, 0.9] as [number, number, number],
        group: 'sky',
    },
    skyColorBot: {
        type: 'tuple3',
        default: [0.2, 0.2, 0.25] as [number, number, number],
        group: 'sky',
    },
    skyTexture: { type: 'string', default: '', group: 'sky' },
    skyRotationY: { type: 'number', default: 0, group: 'sky' },
    skyRotationSpeed: { type: 'number', default: 0, group: 'sky' },
    skyBrightness: { type: 'number', default: 1, group: 'sky' },
    starsEnabled: { type: 'boolean', default: false, group: 'sky' },
    starsTexture: { type: 'string', default: '', group: 'sky' },
    envIntensity: { type: 'number', default: 2, group: 'sky' },
    // [doc:adr-132] 环境亮度统一标量：作为天空/IBL/云/主光/环境光的全局明暗基准
    envBrightness: { type: 'number', default: 1, group: 'sky' },

    // --- Ground ---
    groundVisible: { type: 'boolean', default: true, group: 'ground' },
    groundType: {
        type: 'enum',
        values: ['flat', 'terrain'] as const,
        default: 'flat' as const,
        group: 'ground',
    },
    groundStyle: {
        type: 'enum',
        values: ['solid', 'grid', 'checker', 'texture'] as const,
        default: 'solid' as const,
        group: 'ground',
    },
    groundOverlay: {
        type: 'enum',
        values: ['none', 'grid', 'checker'] as const,
        default: 'none' as const,
        group: 'ground',
    },
    groundColor: {
        type: 'tuple3',
        default: [0.15, 0.15, 0.18] as [number, number, number],
        group: 'ground',
    },
    groundAlpha: { type: 'number', default: 0.6, group: 'ground' },
    groundTexture: { type: 'string', default: '', group: 'ground' },
    groundTextureEnabled: { type: 'boolean', default: false, group: 'ground' },
    groundTextureScale: { type: 'number', default: 1, group: 'ground' },
    groundTextureRotation: { type: 'number', default: 0, group: 'ground' },
    groundGridSize: { type: 'number', default: 1, group: 'ground' },
    groundLineColor: {
        type: 'tuple3',
        default: [0.5, 0.5, 0.55] as [number, number, number],
        group: 'ground',
    },
    groundTerrainHeight: { type: 'number', default: 4, group: 'ground' },
    groundTerrainScale: { type: 'number', default: 0.06, group: 'ground' },
    groundTerrainSeed: { type: 'number', default: 1337, group: 'ground' },
    groundTerrainOctaves: { type: 'number', default: 5, group: 'ground' },
    groundPitch: { type: 'number', default: 0, group: 'ground' },
    groundRoll: { type: 'number', default: 0, group: 'ground' },
    groundScrollSpeedX: { type: 'number', default: 0, group: 'ground' },
    groundScrollSpeedZ: { type: 'number', default: 0, group: 'ground' },
    groundPattern: {
        type: 'enum',
        values: ['checker', 'dots', 'stripes', 'radial'] as const,
        default: 'checker' as const,
        group: 'ground',
    },
    groundReflectionBlend: { type: 'number', default: 0.3, group: 'ground' },
    groundReflectionQuality: {
        type: 'enum',
        values: ['high', 'medium', 'low', 'off'] as const,
        default: 'medium' as const,
        group: 'ground',
    },
    groundNormalTexture: { type: 'string', default: '', group: 'ground' },
    groundNormalStrength: { type: 'number', default: 1, group: 'ground' },
    groundElevationColoring: { type: 'boolean', default: false, group: 'ground' },
    groundInfinite: { type: 'boolean', default: false, group: 'ground' },
    groundPbrEnabled: { type: 'boolean', default: false, group: 'ground' },
    groundProceduralTexture: {
        type: 'enum',
        values: ['none', 'wood', 'marble', 'concrete', 'tile', 'carpet', 'metal'] as const,
        default: 'none' as const,
        group: 'ground',
    },
    groundProceduralSeed: { type: 'number', default: 42, group: 'ground' },
    groundProceduralScale: { type: 'number', default: 1.0, group: 'ground' },
    groundRoughness: { type: 'number', default: 0.6, group: 'ground' },
    groundMetallic: { type: 'number', default: 0.0, group: 'ground' },
    groundReflectionBlur: { type: 'number', default: 0.0, group: 'ground' },
    groundReflectionDistort: { type: 'number', default: 0.3, group: 'ground' },
    // ADR-114 契合度修复：默认开启，配合 qualityOk 守卫（low/off 仍自动禁用），medium+ 即获得落地感
    groundContactShadowEnabled: { type: 'boolean', default: true, group: 'ground' },
    groundContactShadowIntensity: { type: 'number', default: 0.5, group: 'ground' },
    groundContactShadowDistance: { type: 'number', default: 0.5, group: 'ground' },
    groundLevel: { type: 'number', default: 0, group: 'ground' },
    groundSize: { type: 'number', default: 500, group: 'ground' },
    groundEdgeFade: { type: 'number', default: 0, group: 'ground' },

    // --- Wind ---
    windEnabled: { type: 'boolean', default: true, group: ['particle', 'water'] },
    windDirection: {
        type: 'tuple3',
        default: [0, 0, 1] as [number, number, number],
        group: ['particle', 'water'],
    },
    windSpeed: { type: 'number', default: 5, group: ['particle', 'water'] },

    // --- Particle ---
    particleEnabled: { type: 'boolean', default: false, group: 'particle' },
    particleType: {
        type: 'enum',
        values: ['none', 'sakura', 'rain', 'snow', 'fireworks', 'fireflies', 'leaves'] as const,
        default: 'none' as const,
        group: 'particle',
    },
    particleEmitRate: { type: 'number', default: 1, group: 'particle' },
    particleSize: { type: 'number', default: 1, group: 'particle' },
    particleSpeed: { type: 'number', default: 1, group: 'particle' },
    particleSplash: { type: 'boolean', default: false, group: 'particle' },
    particleCustomTexture: { type: 'string', default: '', group: 'particle' },
    particleQuality: {
        type: 'enum',
        values: ['high', 'medium', 'low'] as const,
        default: 'high' as const,
        group: 'particle',
    },

    // --- Water ---
    waterEnabled: { type: 'boolean', default: false, group: 'water' },
    waterLevel: { type: 'number', default: 0, group: 'water' },
    waterFlip: { type: 'boolean', default: false, group: 'water' },
    waterColor: {
        type: 'tuple3',
        default: [0.15, 0.4, 0.6] as [number, number, number],
        group: 'water',
    },
    waterTransparency: { type: 'number', default: 0.88, group: 'water' },
    waterWaveHeight: { type: 'number', default: 0.15, group: 'water' },
    bigWaveHeight: { type: 'number', default: 1.0, group: 'water' },
    smallWaveHeight: { type: 'number', default: 1.0, group: 'water' },
    waterSize: { type: 'number', default: 50, group: 'water' },
    waterAnimSpeed: { type: 'number', default: 0.2, group: 'water' },
    planarReflectBlend: { type: 'number', default: 0.5, group: 'water' },
    reflectionQuality: {
        type: 'enum',
        values: ['high', 'medium', 'low', 'off'] as const,
        default: 'low' as const,
        group: ['ground', 'water', 'reflection'],
        // 统一控制：水面 + 地面 + 镜面反射分辨率（high=2048, medium=1024, low=512）
    },
    // ADR-151: 反射模式（独立于 reflectionQuality，控制 SSR/Probe/Planar 的激活策略）
    reflectionMode: {
        type: 'enum',
        values: ['none', 'planar', 'ssr', 'probe', 'hybrid'] as const,
        default: 'planar' as const,
        group: ['ground', 'water', 'reflection'],
    },
    qualityProfile: {
        type: 'enum',
        values: ['high', 'medium', 'low'] as const,
        default: 'high' as const,
        group: ['water', 'cloud', 'particle', 'reflection'],
    },

    // --- Water shader ---
    waterFogColor: {
        type: 'tuple3',
        default: [0.5, 0.52, 0.62] as [number, number, number],
        group: 'water',
    },
    waterFogDensity: { type: 'number', default: 0.006, group: 'water' },
    waterFogOpacityInfluence: { type: 'number', default: 0, group: 'water' },
    waterHorizonFade: { type: 'number', default: 0.8, group: 'water' },
    waterSkyColorBlend: { type: 'number', default: 0.2, group: 'water' },
    fresnelBias: { type: 'number', default: 0.02, group: 'water' },
    fresnelPower: { type: 'number', default: 3.0, group: 'water' },
    diffuseStrength: { type: 'number', default: 0.15, group: 'water' },
    ambientStrength: { type: 'number', default: 0.06, group: 'water' },
    // --- Ripple ---
    waterRippleSlots: { type: 'number', default: 256, group: 'water' },
    rippleNormalStrength: { type: 'number', default: 0.35, group: 'water' },
    rippleGlintStrength: { type: 'number', default: 0.5, group: 'water' },
    waterNormalStrength: { type: 'number', default: 0.35, group: 'water' },
    waterGlintStrength: { type: 'number', default: 0.1, group: 'water' },
    // ADR-115 P5: 低频滚动法线层强度（0=关闭，默认 0.15）
    lowFreqNormalStrength: { type: 'number', default: 0.15, group: 'water' },
    causticIntensity: { type: 'number', default: 0.1, group: 'water' },
    causticColor1: {
        type: 'tuple3',
        default: [1.0, 0.9, 0.6] as [number, number, number],
        group: 'water',
    },
    causticColor2: {
        type: 'tuple3',
        default: [1.0, 1.0, 0.8] as [number, number, number],
        group: 'water',
    },
    causticScrollX: { type: 'number', default: 0.1, group: 'water' },
    causticScrollY: { type: 'number', default: 0.15, group: 'water' },
    fresnelAlphaInfluence: { type: 'number', default: 0.35, group: 'water' },

    // --- Underwater ---
    underwaterFogDensity: { type: 'number', default: 0.05, group: 'water' },
    underwaterChromaticAmount: { type: 'number', default: 20, group: 'water' },
    underwaterToneIntensity: { type: 'number', default: 0.5, group: 'water' },
    underwaterFogMultiplier: { type: 'number', default: 2, group: 'water' },
    underwaterTintStrength: { type: 'number', default: 0.5, group: 'water' },

    // --- Clouds ---
    cloudsEnabled: { type: 'boolean', default: false, group: 'cloud' },
    debugClouds: { type: 'boolean', default: false, group: 'cloud' },
    cloudCover: { type: 'number', default: 0.5, group: 'cloud' },
    cloudScale: { type: 'number', default: 0.55, group: 'cloud' },
    cloudHeight: { type: 'number', default: 300, group: 'cloud' },
    cloudThickness: { type: 'number', default: 60, group: 'cloud' },
    cloudVisibility: { type: 'number', default: 8000, group: 'cloud' },
    cloudGap: { type: 'number', default: 0.1, group: 'cloud' },
    cloudErosion: { type: 'number', default: 0.4, group: 'cloud' },
    cloudWeatherStrength: { type: 'number', default: 0.6, group: 'cloud' },
    cloudBacklight: { type: 'number', default: 0.5, group: 'cloud' },
    cloudPowder: { type: 'number', default: 0.8, group: 'cloud' },
    cloudQuality: {
        type: 'enum',
        values: ['standard', 'high'] as const,
        default: 'high' as const,
        group: 'cloud',
    },

    // --- Mirror ---
    mirrorEnabled: { type: 'boolean', default: false, group: 'mirror' },

    // --- Fog ---
    fogEnabled: { type: 'boolean', default: false, group: 'fog' },
    fogMode: {
        type: 'enum',
        values: ['exp', 'exp2', 'linear'] as const,
        default: 'exp2' as const,
        group: 'fog',
    },
    fogColor: {
        type: 'tuple3',
        default: [0.5, 0.5, 0.6] as [number, number, number],
        group: 'fog',
    },
    fogDensity: { type: 'number', default: 0.01, group: 'fog' },
    fogStart: { type: 'number', default: 10, group: 'fog' },
    fogEnd: { type: 'number', default: 100, group: 'fog' },

    // --- Collision ---
    collisionEnabled: { type: 'boolean', default: true },
    bodyCollisionEnabled: { type: 'boolean', default: true },
    groundCollisionEnabled: { type: 'boolean', default: true },

    // --- Lighting / Time ---
    sunAngle: { type: 'number', default: 45, group: 'sky' },
    azimuth: { type: 'number', default: -45, group: 'sky' },
    lightingPresetName: { type: 'optional-string', default: undefined },
    timeOfDayActive: { type: 'boolean', default: false },
    timeOfDaySpeed: { type: 'number', default: 3 },
} as const;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;

// ======== Dispatch Key 派生 ========

/** 已定义的 dispatch 分组名称 */
export type EnvDispatchGroup =
    'sky' | 'ground' | 'fog' | 'water' | 'particle' | 'cloud' | 'reflection' | 'mirror';

const _groupCache = new Map<string, string[]>();

/**
 * 从 Schema 派生指定 dispatch 分组的 key 列表。
 * 新增字段时只要在 schema 中声明 group，此处自动收录，无需手工维护 key 数组。
 *
 * @example
 *   const GROUND_KEYS = getEnvKeys('ground');
 *   // => ['groundVisible', 'groundType', ..., 'reflectionQuality', 'reflectionMode', ...]
 */
export function getEnvKeys(group: EnvDispatchGroup): string[] {
    const cached = _groupCache.get(group);
    if (cached) {
        return cached;
    }
    const keys: string[] = [];
    for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
        const g = (def as { group?: string | readonly string[] }).group;
        if (!g) {
            continue;
        }
        if (typeof g === 'string' ? g === group : g.includes(group)) {
            keys.push(key);
        }
    }
    _groupCache.set(group, keys);
    return keys;
}
