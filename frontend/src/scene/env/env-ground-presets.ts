// env-ground-presets.ts — 地面预设数据（独立于渲染逻辑）
// 从 env-ground.ts 拆分而来，减少渲染模块文件体积。

import type { EnvState } from '@/core/config';

/** 程序化地面纹理类型 */
export type GroundProceduralKind = EnvState['groundProceduralTexture'];

export interface GroundPreset {
    label: string;
    // Style
    groundStyle: 'solid' | 'grid' | 'checker' | 'texture';
    groundOverlay: 'none' | 'grid' | 'checker';
    groundColor: [number, number, number];
    groundAlpha: number;
    groundPattern: 'checker' | 'dots' | 'stripes' | 'radial';
    // Texture
    groundTexture: string;
    groundTextureEnabled: boolean;
    groundTextureScale: number;
    groundTextureRotation: number;
    // Decoration
    groundGridSize: number;
    groundLineColor: [number, number, number];
    // PBR
    groundPbrEnabled: boolean;
    groundMetallic: number;
    groundRoughness: number;
    // Procedural
    groundProceduralTexture: GroundProceduralKind;
    groundProceduralSeed: number;
    groundProceduralScale: number;
    // Reflection
    reflectionQuality: 'off' | 'low' | 'medium' | 'high';
    groundReflectionBlend: number;
    groundNormalStrength: number;
    groundReflectionBlur: number;
    groundReflectionDistort: number;
    // Terrain
    groundElevationColoring: boolean;
    // Enhancement
    groundEdgeFade: number;
    groundPitch: number;
    groundRoll: number;
}

export const GROUND_PRESETS: Record<string, GroundPreset> = {
    cleanGray: {
        label: '素净灰',
        groundStyle: 'solid',
        groundOverlay: 'none',
        groundColor: [0.2, 0.2, 0.22],
        groundAlpha: 0.85,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.5, 0.5, 0.55],
        groundPbrEnabled: false,
        groundMetallic: 0,
        groundRoughness: 0.6,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'low',
        groundReflectionBlend: 0.3,
        groundNormalStrength: 1,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.3,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    mirrorStage: {
        label: '镜面舞台',
        groundStyle: 'solid',
        groundOverlay: 'none',
        groundColor: [0.05, 0.05, 0.08],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.3, 0.3, 0.35],
        groundPbrEnabled: true,
        groundMetallic: 1,
        groundRoughness: 0.1,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'high',
        groundReflectionBlend: 0.8,
        groundNormalStrength: 1.2,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.2,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    grass: {
        label: '草地',
        groundStyle: 'texture',
        groundOverlay: 'none',
        groundColor: [0.3, 0.5, 0.25],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: 'textures/grass.png',
        groundTextureEnabled: true,
        groundTextureScale: 0.8,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.4, 0.5, 0.35],
        groundPbrEnabled: false,
        groundMetallic: 0,
        groundRoughness: 0.6,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'low',
        groundReflectionBlend: 0.2,
        groundNormalStrength: 0.8,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.3,
        groundElevationColoring: false,
        groundEdgeFade: 0.3,
        groundPitch: 0,
        groundRoll: 0,
    },
    stoneTile: {
        label: '石板',
        groundStyle: 'texture',
        groundOverlay: 'none',
        groundColor: [0.35, 0.33, 0.3],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: 'textures/stone.png',
        groundTextureEnabled: true,
        groundTextureScale: 1.5,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.5, 0.5, 0.5],
        groundPbrEnabled: true,
        groundMetallic: 0.1,
        groundRoughness: 0.8,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'medium',
        groundReflectionBlend: 0.4,
        groundNormalStrength: 0.6,
        groundReflectionBlur: 0.1,
        groundReflectionDistort: 0.3,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    woodStage: {
        label: '木纹舞台',
        groundStyle: 'solid',
        groundOverlay: 'none',
        groundColor: [0.55, 0.4, 0.25],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.4, 0.3, 0.2],
        groundPbrEnabled: true,
        groundMetallic: 0,
        groundRoughness: 0.8,
        groundProceduralTexture: 'wood',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'medium',
        groundReflectionBlend: 0.35,
        groundNormalStrength: 0.7,
        groundReflectionBlur: 0.1,
        groundReflectionDistort: 0.25,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    cyberGrid: {
        label: '赛博网格',
        groundStyle: 'grid',
        groundOverlay: 'grid',
        groundColor: [0.02, 0.02, 0.06],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 0.5,
        groundLineColor: [0.2, 0.8, 1],
        groundPbrEnabled: true,
        groundMetallic: 1,
        groundRoughness: 0.2,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'off',
        groundReflectionBlend: 0,
        groundNormalStrength: 1,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    metalStage: {
        label: '金属舞台',
        groundStyle: 'solid',
        groundOverlay: 'none',
        groundColor: [0.55, 0.55, 0.57],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.5, 0.5, 0.55],
        groundPbrEnabled: true,
        groundMetallic: 0.9,
        groundRoughness: 0.15,
        groundProceduralTexture: 'metal',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'medium',
        groundReflectionBlend: 0.5,
        groundNormalStrength: 1.5,
        groundReflectionBlur: 0.1,
        groundReflectionDistort: 0.3,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
};

/** 预设 → EnvState 字段映射，供 UI chip handler 调用并持久化。 */
export function buildGroundPresetEnvState(preset: GroundPreset): Partial<EnvState> {
    return {
        groundStyle: preset.groundStyle,
        groundOverlay: preset.groundOverlay,
        groundColor: preset.groundColor,
        groundAlpha: preset.groundAlpha,
        groundPattern: preset.groundPattern,
        groundTexture: preset.groundTexture,
        groundTextureEnabled: preset.groundTextureEnabled,
        groundTextureScale: preset.groundTextureScale,
        groundTextureRotation: preset.groundTextureRotation,
        groundGridSize: preset.groundGridSize,
        groundLineColor: preset.groundLineColor,
        groundPbrEnabled: preset.groundPbrEnabled,
        groundMetallic: preset.groundMetallic,
        groundRoughness: preset.groundRoughness,
        groundProceduralTexture: preset.groundProceduralTexture,
        groundProceduralSeed: preset.groundProceduralSeed,
        groundProceduralScale: preset.groundProceduralScale,
        reflectionQuality: preset.reflectionQuality,
        groundReflectionBlend: preset.groundReflectionBlend,
        groundNormalStrength: preset.groundNormalStrength,
        groundReflectionBlur: preset.groundReflectionBlur,
        groundReflectionDistort: preset.groundReflectionDistort,
        groundElevationColoring: preset.groundElevationColoring,
        groundEdgeFade: preset.groundEdgeFade,
        groundPitch: preset.groundPitch,
        groundRoll: preset.groundRoll,
    };
}
