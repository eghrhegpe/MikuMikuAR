// env-lighting.ts — 环境光照联动推算
// [doc:architecture] 环境光照统一方案
// skyColor → dirDiffuse + dirDirection + hemiIntensity + dirIntensity + exposure

export interface EnvPreset {
    label: string;
    skyColorTop: [number, number, number];
    skyColorBot: [number, number, number];
    sunAngle: number;        // -15~90
    exposure: number;
    toneMapping: number;     // 0=OFF 1=ACES 2=Reinhard 3=Cineon 4=Neutral
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

/** 从天空色和太阳角度推算光照参数。 */
export function deriveLighting(
    skyColor: [number, number, number],
    sunAngle: number,
): DerivedLighting {
    const L = calcLuminance(skyColor);
    const dirIntensity = Math.max(L * 1.2, 0.15);
    const hemiIntensity = Math.min(1, 1.0 - dirIntensity * 0.5);

    const dirDiffuse: [number, number, number] = [
        Math.max(skyColor[0] * 0.3 + 0.7, 0.2),
        Math.max(skyColor[1] * 0.3 + 0.7, 0.2),
        Math.max(skyColor[2] * 0.3 + 0.5, 0.2),
    ];

    const theta = sunAngle * TO_RAD;
    const azimuth = -45 * TO_RAD;
    const dirDirection: [number, number, number] = [
        Math.cos(azimuth) * Math.cos(theta),
        Math.sin(theta),
        Math.sin(azimuth) * Math.cos(theta),
    ];

    return { dirDiffuse, dirDirection, dirIntensity, hemiIntensity };
}

/** 预设数据表。*/
export const ENV_PRESETS: Record<string, EnvPreset & DerivedLighting> = {
    noon: {
        label: "正午",
        skyColorTop: [0.53, 0.71, 0.91],
        skyColorBot: [0.3, 0.5, 0.8],
        sunAngle: 75,
        exposure: 1.0,
        toneMapping: 1,
        ...deriveLighting([0.53, 0.71, 0.91], 75),
    },
    sunset: {
        label: "夕阳",
        skyColorTop: [0.9, 0.45, 0.2],
        skyColorBot: [0.6, 0.2, 0.1],
        sunAngle: 15,
        exposure: 0.7,
        toneMapping: 2,
        ...deriveLighting([0.9, 0.45, 0.2], 15),
    },
    night: {
        label: "夜景",
        skyColorTop: [0.05, 0.05, 0.15],
        skyColorBot: [0.02, 0.02, 0.08],
        sunAngle: -15,
        exposure: 0.4,
        toneMapping: 4,
        ...deriveLighting([0.05, 0.05, 0.15], -15),
    },
    overcast: {
        label: "阴天",
        skyColorTop: [0.4, 0.4, 0.45],
        skyColorBot: [0.25, 0.25, 0.3],
        sunAngle: 45,
        exposure: 0.8,
        toneMapping: 1,
        ...deriveLighting([0.4, 0.4, 0.45], 45),
    },
};
