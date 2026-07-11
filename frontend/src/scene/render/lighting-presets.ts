// [doc:architecture] Lighting Presets — 灯光预设数据定义
// 4 个内置预设：角色肖像 / 道具产品 / 舞台戏剧 / 舞蹈表演

import type { StageLightType } from './lighting';

export interface LightingPresetLight {
    type: StageLightType;
    /** 部分 StageLightState — 未指定的字段用默认值填充 */
    state: Record<string, unknown>;
}

export interface LightingPreset {
    name: string;
    label: string;
    icon: string;
    lights: LightingPresetLight[];
}

export const LIGHTING_PRESETS: Record<string, LightingPreset> = {
    'character-portrait': {
        name: 'character-portrait',
        label: '角色肖像',
        icon: 'lucide:user',
        lights: [
            // 主光：45° 侧上方，暖色
            {
                type: 'spot',
                state: {
                    intensity: 1.0,
                    angle: 0.6,
                    exponent: 2,
                    orbitAzimuth: 45,
                    orbitElevation: 50,
                    orbitDistance: 15,
                    color: [1, 0.95, 0.9],
                },
            },
            // 补光：对侧低强度，冷色
            {
                type: 'spot',
                state: {
                    intensity: 0.3,
                    angle: 1.2,
                    exponent: 1,
                    orbitAzimuth: -60,
                    orbitElevation: 30,
                    orbitDistance: 18,
                    color: [0.8, 0.85, 1],
                },
            },
            // 轮廓光：背后，白色
            {
                type: 'spot',
                state: {
                    intensity: 0.5,
                    angle: 0.4,
                    exponent: 3,
                    orbitAzimuth: 180,
                    orbitElevation: 20,
                    orbitDistance: 12,
                    color: [1, 1, 1],
                },
            },
        ],
    },
    'prop-product': {
        name: 'prop-product',
        label: '道具产品',
        icon: 'lucide:box',
        lights: [
            // 顶部柔光
            {
                type: 'spot',
                state: {
                    intensity: 0.8,
                    angle: 1.5,
                    exponent: 1,
                    orbitAzimuth: 0,
                    orbitElevation: 80,
                    orbitDistance: 20,
                    color: [1, 1, 1],
                },
            },
            // 侧方补光
            {
                type: 'spot',
                state: {
                    intensity: 0.4,
                    angle: 1.0,
                    exponent: 2,
                    orbitAzimuth: 45,
                    orbitElevation: 40,
                    orbitDistance: 15,
                    color: [0.9, 0.95, 1],
                },
            },
        ],
    },
    'stage-drama': {
        name: 'stage-drama',
        label: '舞台戏剧',
        icon: 'lucide:theater',
        lights: [
            // 单盏强聚光，高对比
            {
                type: 'spot',
                state: {
                    intensity: 1.5,
                    angle: 0.3,
                    exponent: 4,
                    orbitAzimuth: 30,
                    orbitElevation: 60,
                    orbitDistance: 12,
                    color: [1, 0.9, 0.7],
                    shadowEnabled: true,
                    shadowType: 'soft',
                    shadowResolution: 2048,
                },
            },
        ],
    },
    'dance-performance': {
        name: 'dance-performance',
        label: '舞蹈表演',
        icon: 'lucide:music',
        lights: [
            // 三色聚光，120° 间隔
            {
                type: 'spot',
                state: {
                    intensity: 1.0,
                    angle: 0.5,
                    exponent: 2,
                    orbitAzimuth: 0,
                    orbitElevation: 55,
                    orbitDistance: 15,
                    color: [1, 0.8, 0.8],
                },
            },
            {
                type: 'spot',
                state: {
                    intensity: 0.7,
                    angle: 0.5,
                    exponent: 2,
                    orbitAzimuth: 120,
                    orbitElevation: 45,
                    orbitDistance: 14,
                    color: [0.8, 0.8, 1],
                },
            },
            {
                type: 'spot',
                state: {
                    intensity: 0.6,
                    angle: 0.5,
                    exponent: 2,
                    orbitAzimuth: -120,
                    orbitElevation: 45,
                    orbitDistance: 14,
                    color: [0.8, 1, 0.8],
                },
            },
        ],
    },

};

/** 预设名称列表（有序） */
export const PRESET_NAMES = Object.keys(LIGHTING_PRESETS);
