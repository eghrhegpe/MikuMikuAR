// env-lighting.ts — 环境光照联动推算
// [doc:architecture] 环境光照统一方案
// skyColor → dirDiffuse + dirDirection + hemiIntensity + dirIntensity + exposure

import { clamp01 } from '@/core/utils';

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
    azimuthDeg: number = -45
): DerivedLighting {
    const L = calcLuminance(skyColor);

    // 渐变过渡：太阳角度 0°~10° 方向光平滑衰减，-5° 以下完全关闭
    const horizonFade = clamp01((sunAngle + 5) / 10); // -5→0, 0→0.5, 5→1
    const dirIntensity = horizonFade * Math.max(L * 1.2, 0.15);
    // 半球光：白天随方向光反向补偿，夜晚保持足够亮度
    const hemiIntensity =
        sunAngle <= 0 ? Math.min(0.8, 0.3 + L * 0.5) : Math.min(1, 0.6 + (1 - dirIntensity) * 0.4);

    // dirDiffuse: preserve sky hue, scale so brightest channel ≈ 0.9-1.0
    // (old formula: sky*0.3+0.7 → washed out to white)
    const maxCh = Math.max(skyColor[0], skyColor[1], skyColor[2]);
    const scale = maxCh > 0.01 ? Math.min(2.0, 0.95 / maxCh) : 1.0;
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
        azimuth: -45,
        ...deriveLighting([0.53, 0.71, 0.91], 75, -45),
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
        azimuth: -45,
        ...deriveLighting([0.4, 0.4, 0.45], 45, -45),
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
            azimuth: p.azimuth ?? -45,
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
        const azimuth = typeof raw.azimuth === 'number' ? raw.azimuth : -45;
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
