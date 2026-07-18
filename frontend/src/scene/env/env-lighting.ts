// env-lighting.ts — 环境光照联动推算
// [doc:architecture] 环境光照统一方案
// skyColor → dirDiffuse + dirDirection + hemiIntensity + dirIntensity + exposure

import { clamp01 } from '@/core/utils';
import type { EnvState } from '@/core/types';

// ======== deriveLighting 系数常量 ========
/** 默认太阳方位角（度），西北方向 */
const DEFAULT_AZIMUTH_DEG = -45;
/** 地平线渐变：太阳角度阈值（度）。低于 -5° 完全关闭方向光，高于 5° 完全开启 */
const HORIZON_FADE_MIN = -5;
const HORIZON_FADE_RANGE = 10;
/** 方向光强度系数：亮度缩放倍率 + 最小保底值 */
const DIR_INTENSITY_SCALE = 1.2;
const DIR_INTENSITY_MIN = 0.15;
/** 半球光强度系数：夜晚 / 白天各 6 个参数 */
const HEMI_NIGHT_MAX = 0.8;
const HEMI_NIGHT_BASE = 0.3;
const HEMI_NIGHT_LUMINANCE_SCALE = 0.5;
const HEMI_DAY_MAX = 1;
const HEMI_DAY_BASE = 0.6;
const HEMI_DAY_COMPENSATION_SCALE = 0.4;
/** dirDiffuse 颜色缩放：目标亮度 + 最大缩放倍率 + 最小通道阈值 */
const DIFFUSE_TARGET_BRIGHTNESS = 0.95;
const DIFFUSE_MAX_SCALE = 2.0;
const DIFFUSE_MIN_CHANNEL = 0.01;

export interface EnvPreset {
    label: string;
    skyColorTop: [number, number, number];
    skyColorBot: [number, number, number];
    sunAngle: number; // -15~90
    azimuth?: number; // 太阳方位角（度），默认 -45（西北）
}

export interface DerivedLighting {
    dirDiffuse: [number, number, number];
    dirDirection: [number, number, number];
    dirIntensity: number;
    hemiIntensity: number;
}

const TO_RAD = Math.PI / 180;

// 亮度系数采用 sRGB 感知权重（0.299/0.587/0.114）：本函数输入 skyColor 为 UI 直供的 sRGB 显示值（0..1），
// 故 sRGB 系数恰当。若改用线性空间系数（0.2126/0.7152/0.0722），须先对输入做 sRGB→线性解码，否则结果偏暗。
export function calcLuminance(rgb: [number, number, number]): number {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/** 从天空色和太阳角度推算光照参数。
 *  @param azimuthDeg 太阳方位角（度），默认 -45（西北）。
 *                       sunset/dawn/dusk 等预设会传入更准确的值。
 */
export function deriveLighting(
    skyColor: [number, number, number],
    sunAngle: number,
    azimuthDeg: number = DEFAULT_AZIMUTH_DEG
): DerivedLighting {
    const L = calcLuminance(skyColor);

    // 渐变过渡：太阳角度在 [MIN, MIN+RANGE] 间平滑衰减
    const horizonFade = clamp01((sunAngle - HORIZON_FADE_MIN) / HORIZON_FADE_RANGE);
    const dirIntensity = horizonFade * Math.max(L * DIR_INTENSITY_SCALE, DIR_INTENSITY_MIN);
    // 半球光：夜晚随亮度补偿，白天随方向光反向补偿
    const hemiIntensity =
        sunAngle <= 0
            ? Math.min(HEMI_NIGHT_MAX, HEMI_NIGHT_BASE + L * HEMI_NIGHT_LUMINANCE_SCALE)
            : Math.min(
                  HEMI_DAY_MAX,
                  HEMI_DAY_BASE + (1 - dirIntensity) * HEMI_DAY_COMPENSATION_SCALE
              );

    // dirDiffuse: preserve sky hue, scale so brightest channel ≈ DIFFUSE_TARGET_BRIGHTNESS
    const maxCh = Math.max(skyColor[0], skyColor[1], skyColor[2]);
    const scale =
        maxCh > DIFFUSE_MIN_CHANNEL
            ? Math.min(DIFFUSE_MAX_SCALE, DIFFUSE_TARGET_BRIGHTNESS / maxCh)
            : 1.0;
    const dirDiffuse: [number, number, number] = [
        Math.min(skyColor[0] * scale, 1.0),
        Math.min(skyColor[1] * scale, 1.0),
        Math.min(skyColor[2] * scale, 1.0),
    ];

    const theta = sunAngle * TO_RAD;
    // Night: flat direction (y=0) — intensity is 0 so direction is irrelevant
    const az = sunAngle <= 0 ? 0 : azimuthDeg * TO_RAD;
    const dirY = sunAngle <= 0 ? 0 : Math.sin(theta);
    const dirDirection: [number, number, number] = [
        Math.cos(az) * Math.cos(theta),
        dirY,
        Math.sin(az) * Math.cos(theta),
    ];

    return { dirDiffuse, dirDirection, dirIntensity, hemiIntensity };
}

/** 预设数据表。按时间线排列：黎明 → 正午 → 夕阳 → 夜景 → 阴天 → 霓虹夜 */
export const TIME_OF_DAY_PRESETS: Record<string, EnvPreset & DerivedLighting> = {
    dawn: {
        label: '黎明',
        skyColorTop: [0.85, 0.55, 0.35],
        skyColorBot: [0.2, 0.15, 0.35],
        sunAngle: 5,
        azimuth: -90,
        ...deriveLighting([0.85, 0.55, 0.35], 5, -90),
    },
    noon: {
        label: '正午',
        skyColorTop: [0.53, 0.71, 0.91],
        skyColorBot: [0.3, 0.5, 0.8],
        sunAngle: 75,
        azimuth: DEFAULT_AZIMUTH_DEG,
        ...deriveLighting([0.53, 0.71, 0.91], 75, DEFAULT_AZIMUTH_DEG),
    },
    sunset: {
        label: '夕阳',
        skyColorTop: [0.9, 0.45, 0.2],
        skyColorBot: [0.6, 0.2, 0.1],
        sunAngle: 15,
        azimuth: 90,
        ...deriveLighting([0.9, 0.45, 0.2], 15, 90),
    },
    night: {
        label: '夜景',
        skyColorTop: [0.05, 0.05, 0.15],
        skyColorBot: [0.02, 0.02, 0.08],
        sunAngle: -6,
        azimuth: 0,
        ...deriveLighting([0.05, 0.05, 0.15], -6, 0),
    },
    overcast: {
        label: '阴天',
        skyColorTop: [0.4, 0.4, 0.45],
        skyColorBot: [0.25, 0.25, 0.3],
        sunAngle: 45,
        azimuth: DEFAULT_AZIMUTH_DEG,
        ...deriveLighting([0.4, 0.4, 0.45], 45, DEFAULT_AZIMUTH_DEG),
    },
    neon: {
        label: '霓虹夜',
        skyColorTop: [0.05, 0.02, 0.1],
        skyColorBot: [0.1, 0.02, 0.15],
        sunAngle: -5,
        azimuth: 0,
        ...deriveLighting([0.05, 0.02, 0.1], -5, 0),
    },
};

/** 将当前 EnvPreset 序列化为 JSON 字符串（.env 格式）。 */
export function exportEnvPreset(p: EnvPreset): string {
    return JSON.stringify(
        {
            version: 2,
            label: p.label,
            skyColorTop: p.skyColorTop,
            skyColorBot: p.skyColorBot,
            sunAngle: p.sunAngle,
            azimuth: p.azimuth ?? DEFAULT_AZIMUTH_DEG,
        },
        null,
        2
    );
}

/** 从 .env JSON 字符串反序列化 EnvPreset，失败返回 null。 */
export function importEnvPreset(json: string): (EnvPreset & DerivedLighting) | null {
    try {
        const raw = JSON.parse(json);
        if (
            !raw.label ||
            !raw.skyColorTop ||
            !raw.skyColorBot ||
            typeof raw.sunAngle !== 'number'
        ) {
            return null;
        }
        const azimuth = typeof raw.azimuth === 'number' ? raw.azimuth : DEFAULT_AZIMUTH_DEG;
        return {
            label: raw.label,
            skyColorTop: raw.skyColorTop,
            skyColorBot: raw.skyColorBot,
            sunAngle: raw.sunAngle,
            azimuth,
            ...deriveLighting(raw.skyColorTop, raw.sunAngle, azimuth),
        };
    } catch {
        return null;
    }
}

// ======== 分类预设（ADR-120） ========
// 旧版 EnvPreset（version 2）只存天空 5 字段；新版（version 3）按 4 类保存字段子集。
// 旧版 API（EnvPreset / exportEnvPreset / importEnvPreset）保留供 TIME_OF_DAY_PRESETS 使用。

/** 环境预设分类：天空/地面/水面/大气。 */
export type EnvPresetCategory = 'sky' | 'ground' | 'water' | 'atmosphere';

/** 各类别包含的 EnvState 字段白名单。未列入的字段（如 collision*）不参与任何预设。 */
export const ENV_PRESET_FIELDS: Record<EnvPresetCategory, (keyof EnvState)[]> = {
    sky: [
        'skyMode',
        'skyColorTop',
        'skyColorMid',
        'skyColorBot',
        'skyTexture',
        'skyRotationY',
        'skyRotationSpeed',
        'skyBrightness',
        'starsEnabled',
        'starsTexture',
        'envIntensity',
        'sunAngle',
        'azimuth',
        'lightingPresetName',
        'timeOfDayActive',
        'timeOfDaySpeed',
    ],
    ground: [
        'groundVisible',
        'groundType',
        'groundStyle',
        'groundDecoStyle',
        'groundColor',
        'groundAlpha',
        'groundTexture',
        'groundTextureEnabled',
        'groundTextureScale',
        'groundTextureRotation',
        'groundGridSize',
        'groundLineColor',
        'groundTerrainHeight',
        'groundTerrainScale',
        'groundTerrainSeed',
        'groundTerrainOctaves',
        'groundPitch',
        'groundRoll',
        'groundScrollSpeedX',
        'groundScrollSpeedZ',
        'groundPattern',
        'groundReflectionBlend',
        'groundReflectionQuality',
        'groundNormalTexture',
        'groundNormalStrength',
        'groundElevationColoring',
        'groundFollowCamera',
        'groundPbrEnabled',
        'groundProceduralTexture',
        'groundProceduralSeed',
        'groundProceduralScale',
        'groundRoughness',
        'groundMetallic',
        'groundReflectionBlur',
        'groundReflectionDistort',
        'groundContactShadowEnabled',
        'groundContactShadowIntensity',
        'groundContactShadowDistance',
        'groundLevel',
        'groundSize',
        'groundEdgeFade',
    ],
    water: [
        'waterEnabled',
        'waterLevel',
        'waterFlip',
        'waterColor',
        'waterTransparency',
        'waterWaveHeight',
        'waterSize',
        'waterAnimSpeed',
        'planarReflectBlend',
        'reflectionQuality',
        'waterFogColor',
        'waterFogDensity',
        'waterFogOpacityInfluence',
        'fresnelBias',
        'fresnelPower',
        'diffuseStrength',
        'ambientStrength',
        'rippleNormalStrength',
        'rippleGlintStrength',
        'causticColor1',
        'causticColor2',
        'causticScrollX',
        'causticScrollY',
        'fresnelAlphaInfluence',
        'underwaterFogDensity',
        'underwaterChromaticAmount',
        'underwaterToneIntensity',
        'underwaterFogMultiplier',
        'underwaterTintStrength',
    ],
    atmosphere: [
        'windEnabled',
        'windDirection',
        'windSpeed',
        'particleEnabled',
        'particleType',
        'particleEmitRate',
        'particleSize',
        'particleSpeed',
        'particleSplash',
        'particleCustomTexture',
        'cloudsEnabled',
        'debugClouds',
        'cloudCover',
        'cloudScale',
        'cloudHeight',
        'cloudThickness',
        'cloudVisibility',
        'cloudGap',
        'fogEnabled',
        'fogMode',
        'fogColor',
        'fogDensity',
        'fogStart',
        'fogEnd',
        'mirrorEnabled',
    ],
};

/** 分类预设（version 3 格式）。 */
export interface CategorizedEnvPreset {
    version: 3;
    category: EnvPresetCategory;
    label: string;
    fields: Partial<EnvState>;
}

/** 从当前 envState 快照指定类别的字段。数组字段做浅拷贝避免别名。 */
export function snapshotEnvPresetByCategory(
    label: string,
    category: EnvPresetCategory,
    state: EnvState
): CategorizedEnvPreset {
    const keys = ENV_PRESET_FIELDS[category];
    const fields: Record<string, unknown> = {};
    for (const k of keys) {
        const v = state[k];
        // 颜色/方向等 [number,number,number] 数组浅拷贝，避免预设引用 reactive state
        if (Array.isArray(v)) {
            fields[k as string] = (v as number[]).slice();
        } else {
            fields[k as string] = v;
        }
    }
    return { version: 3, category, label, fields: fields as Partial<EnvState> };
}

/** 序列化分类预设为 JSON 字符串。 */
export function exportCategorizedEnvPreset(p: CategorizedEnvPreset): string {
    return JSON.stringify(
        {
            version: 3,
            category: p.category,
            label: p.label,
            fields: p.fields,
        },
        null,
        2
    );
}

/**
 * 从 JSON 字符串反序列化分类预设，失败返回 null。
 * 兼容 version 2（旧天空预设）：无 category/fields，顶层有 skyColorTop/Bot/sunAngle/azimuth → 归 sky 类。
 */
export function importCategorizedEnvPreset(json: string): CategorizedEnvPreset | null {
    try {
        const raw = JSON.parse(json);
        if (!raw.label || typeof raw.label !== 'string') {
            return null;
        }
        // version 3：有 fields + category
        if (raw.version === 3 && raw.fields && typeof raw.category === 'string') {
            const cat = raw.category as EnvPresetCategory;
            if (!['sky', 'ground', 'water', 'atmosphere'].includes(cat)) {
                return null;
            }
            return {
                version: 3,
                category: cat,
                label: raw.label,
                fields: raw.fields as Partial<EnvState>,
            };
        }
        // version 2（旧）：顶层 skyColorTop/Bot/sunAngle/azimuth → 归 sky 类
        if (
            Array.isArray(raw.skyColorTop) &&
            Array.isArray(raw.skyColorBot) &&
            typeof raw.sunAngle === 'number'
        ) {
            const azimuth = typeof raw.azimuth === 'number' ? raw.azimuth : DEFAULT_AZIMUTH_DEG;
            return {
                version: 3,
                category: 'sky',
                label: raw.label,
                fields: {
                    skyColorTop: [...raw.skyColorTop] as [number, number, number],
                    skyColorBot: [...raw.skyColorBot] as [number, number, number],
                    sunAngle: raw.sunAngle,
                    azimuth,
                },
            };
        }
        return null;
    } catch {
        return null;
    }
}
