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
    // ⚠ skyColorTop/Mid/Bot 虽名为"天空色"，实际通过 deriveLighting() 同时控制：
    //   - dirDiffuse（方向光颜色）/ dirIntensity（方向光强度）
    //   - hemiIntensity（半球光强度）/ scene.ambientColor（环境光色）
    //   修改天空色会触发全场景光照重烘焙。
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
    // IBL 环境反射强度：写入 scene.environmentIntensity，控制环境贴图对物体的反射贡献（金属反光/PBR 环境光）。
    // 注意：与 water shader 的同名 uniform 'envIntensity' 无关（那是水面 cubemap 反射强度，见 water.frag.glsl）。
    // ⚠ 实际还参与 scene.ambientColor 推导（间接光），命名"IBL"窄于实际功能。
    iblIntensity: { type: 'number', default: 2, group: 'sky' },
    // [doc:adr-132] 全局明暗基准标量：作为天空/IBL/云/主光/环境光的全局明暗总倍数
    // ⚠ 被归入 'sky' dispatch 组；修改 skyColor 时触发重烘焙，但命名"全局"暗示跨子系统。
    globalBrightness: { type: 'number', default: 1, group: 'sky' },

    // --- Ground ---
    groundVisibleEnabled: { type: 'boolean', default: true, group: 'ground' },
    // 当前生效的地面预设 key（顶部 chips 高亮判据）；用户手动微调任一 ground 字段时重置为 'custom'。
    // 无 group：纯 UI 标记，不得进 _GROUND_KEYS 驱动 applyGround 重渲染（参照 _WATER_KEYS 教训）。
    groundPreset: {
        type: 'enum',
        values: [
            'custom',
            'cleanGray',
            'mirrorStage',
            'grass',
            'stoneTile',
            'woodStage',
            'cyberGrid',
            'metalStage',
        ] as const,
        default: 'custom' as const,
    },
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
    groundElevationColoringEnabled: { type: 'boolean', default: false, group: 'ground' },
    groundInfiniteEnabled: { type: 'boolean', default: false, group: 'ground' },
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
    particleSplashEnabled: { type: 'boolean', default: false, group: 'particle' },
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
    waterFlipEnabled: { type: 'boolean', default: false, group: 'water' },
    waterColor: {
        type: 'tuple3',
        default: [0.15, 0.4, 0.6] as [number, number, number],
        group: 'water',
    },
    waterTransparency: { type: 'number', default: 0.88, group: 'water' },
    waterWaveHeight: { type: 'number', default: 0.15, group: 'water' },
    bigWaveHeight: { type: 'number', default: 1.0, group: 'water' },
    bigWaveEnabled: { type: 'boolean', default: true, group: 'water' },
    smallWaveHeight: { type: 'number', default: 1.0, group: 'water' },
    smallWaveEnabled: { type: 'boolean', default: true, group: 'water' },
    waterAnimSpeed: { type: 'number', default: 0.2, group: 'water' },
    planarReflectionBlend: { type: 'number', default: 0.5, group: 'water' },
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
    waterFogStart: { type: 'number', default: 150, group: 'water' },
    waterFogEnd: { type: 'number', default: 800, group: 'water' },
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
    waterGlintStrength: { type: 'number', default: 0.4, group: 'water' }, // ADR-115 P5
    // ADR-115 P5: 低频滚动法线层强度（0=关闭，默认 0.15）
    lowFreqNormalStrength: { type: 'number', default: 0.15, group: 'water' },
    causticIntensity: { type: 'number', default: 0.1, group: 'water' },
    causticEnabled: { type: 'boolean', default: true, group: 'water' },
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
    underwaterEnabled: { type: 'boolean', default: true, group: 'water' },
    underwaterFogDensity: { type: 'number', default: 0.05, group: 'water' },
    underwaterChromaticAmount: { type: 'number', default: 20, group: 'water' },
    underwaterToneIntensity: { type: 'number', default: 0.5, group: 'water' },
    underwaterFogMultiplier: { type: 'number', default: 2, group: 'water' },
    underwaterTintStrength: { type: 'number', default: 0.5, group: 'water' },

    // --- Clouds ---
    cloudEnabled: { type: 'boolean', default: false, group: 'cloud' },
    debugCloudsEnabled: { type: 'boolean', default: false, group: 'cloud' },
    cloudCover: { type: 'number', default: 0.5, group: 'cloud' },
    cloudScale: { type: 'number', default: 0.55, group: 'cloud' },
    cloudHeight: { type: 'number', default: 300, group: 'cloud' },
    cloudThickness: { type: 'number', default: 30, group: 'cloud' },
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
    collisionEnabled: { type: 'boolean', default: true, group: 'collision' },
    bodyCollisionEnabled: { type: 'boolean', default: true, group: 'collision' },
    groundCollisionEnabled: { type: 'boolean', default: true, group: 'collision' },

    // --- Lighting / Time ---
    // ⚠ sunAngle（-15~90）虽名为"太阳角度"，实际通过 deriveLighting() 同时决定：
    //   方向光强度、方向光颜色、半球光补偿。一个浮点数控制了全场景光照。
    sunAngle: { type: 'number', default: 45, group: 'sky' },
    // azimuth 决定方向光入射方向（dirDirection: [x,y,z]）→ 阴影落点。
    azimuth: { type: 'number', default: -45, group: 'sky' },
    lightingPresetName: { type: 'optional-string', default: undefined },
    timeOfDayActive: { type: 'boolean', default: false, group: 'sky' },
    timeOfDaySpeed: { type: 'number', default: 3, group: 'sky' },
} as const;

export type EnvStateSchema = typeof ENV_STATE_SCHEMA;

// ======== Dispatch Key 派生 ========

/** 已定义的 dispatch 分组名称 */
export type EnvDispatchGroup =
    'sky' | 'ground' | 'fog' | 'water' | 'particle' | 'cloud' | 'reflection' | 'mirror' | 'collision';

const _groupCache = new Map<string, string[]>();

/**
 * 从 Schema 派生指定 dispatch 分组的 key 列表。
 * 新增字段时只要在 schema 中声明 group，此处自动收录，无需手工维护 key 数组。
 *
 * @example
 *   const GROUND_KEYS = getEnvKeys('ground');
 *   // => ['groundVisibleEnabled', 'groundType', ..., 'reflectionQuality', 'reflectionMode', ...]
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
