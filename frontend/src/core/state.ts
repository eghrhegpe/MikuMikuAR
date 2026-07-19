/**
 * [doc:architecture] Shared mutable state barrel for MikuMikuAR.
 *
 * ADR-141: 原 state.ts 已拆分为 scene / playback / library / ui 四个独立 store，
 * 本文件仅作 barrel re-export，保持 `from '@/core/state'` 与 `from '@/core/config'`
 * 的外部 import 路径零变化。各 store 的内部结构与访问规约见对应文件头部注释。
 *
 * 状态访问规约（[fix:ghost-state] P3 防御）：
 * - 所有 `export let` 仅供读取，外部模块禁止直接赋值。
 * - 修改必须通过对应的 `setXxx()` setter（单一写入点原则）。
 * - 引用类型变量（Map/Set/数组）**内容**可被 mutate，但**引用本身**替换必须走 setter。
 */

export * from './scene-state';
export * from './playback-state';
export * from './library-state';
export * from './ui-state';

// ======== Environment State (ADR-137 single source of truth) ========

import { reactive } from './reactivity';
import type { EnvState } from './types';
import { ENV_STATE_SCHEMA } from './env-state-schema';

/** 从 schema 读取默认值构造初始 state。tuple3 字段用 slice() 创建新引用以确保 reactive 深层追踪。 */
function buildDefaultEnvState(): EnvState {
    const s = ENV_STATE_SCHEMA;
    return {
        skyMode: s.skyMode.default,
        skyColorTop: s.skyColorTop.default.slice() as [number, number, number],
        skyColorMid: s.skyColorMid.default.slice() as [number, number, number],
        skyColorBot: s.skyColorBot.default.slice() as [number, number, number],
        skyTexture: s.skyTexture.default,
        skyRotationY: s.skyRotationY.default,
        skyRotationSpeed: s.skyRotationSpeed.default,
        skyBrightness: s.skyBrightness.default,
        starsEnabled: s.starsEnabled.default,
        starsTexture: s.starsTexture.default,
        envIntensity: s.envIntensity.default,
        groundVisible: s.groundVisible.default,
        groundType: s.groundType.default,
        groundStyle: s.groundStyle.default,
        groundDecoStyle: s.groundDecoStyle.default,
        groundColor: s.groundColor.default.slice() as [number, number, number],
        groundAlpha: s.groundAlpha.default,
        groundTexture: s.groundTexture.default,
        groundTextureEnabled: s.groundTextureEnabled.default,
        groundTextureScale: s.groundTextureScale.default,
        groundTextureRotation: s.groundTextureRotation.default,
        groundGridSize: s.groundGridSize.default,
        groundLineColor: s.groundLineColor.default.slice() as [number, number, number],
        groundTerrainHeight: s.groundTerrainHeight.default,
        groundTerrainScale: s.groundTerrainScale.default,
        groundTerrainSeed: s.groundTerrainSeed.default,
        groundTerrainOctaves: s.groundTerrainOctaves.default,
        groundPitch: s.groundPitch.default,
        groundRoll: s.groundRoll.default,
        groundScrollSpeedX: s.groundScrollSpeedX.default,
        groundScrollSpeedZ: s.groundScrollSpeedZ.default,
        groundPattern: s.groundPattern.default,
        groundReflectionBlend: s.groundReflectionBlend.default,
        groundReflectionQuality: s.groundReflectionQuality.default,
        groundNormalTexture: s.groundNormalTexture.default,
        groundNormalStrength: s.groundNormalStrength.default,
        groundElevationColoring: s.groundElevationColoring.default,
        groundInfinite: s.groundInfinite.default,
        groundPbrEnabled: s.groundPbrEnabled.default,
        groundProceduralTexture: s.groundProceduralTexture.default,
        groundProceduralSeed: s.groundProceduralSeed.default,
        groundProceduralScale: s.groundProceduralScale.default,
        groundRoughness: s.groundRoughness.default,
        groundMetallic: s.groundMetallic.default,
        groundReflectionBlur: s.groundReflectionBlur.default,
        groundReflectionDistort: s.groundReflectionDistort.default,
        groundContactShadowEnabled: s.groundContactShadowEnabled.default,
        groundContactShadowIntensity: s.groundContactShadowIntensity.default,
        groundContactShadowDistance: s.groundContactShadowDistance.default,
        groundLevel: s.groundLevel.default,
        groundSize: s.groundSize.default,
        groundEdgeFade: s.groundEdgeFade.default,
        windEnabled: s.windEnabled.default,
        windDirection: s.windDirection.default.slice() as [number, number, number],
        windSpeed: s.windSpeed.default,
        particleEnabled: s.particleEnabled.default,
        particleType: s.particleType.default,
        particleEmitRate: s.particleEmitRate.default,
        particleSize: s.particleSize.default,
        particleSpeed: s.particleSpeed.default,
        particleSplash: s.particleSplash.default,
        particleCustomTexture: s.particleCustomTexture.default,
        waterEnabled: s.waterEnabled.default,
        waterLevel: s.waterLevel.default,
        waterFlip: s.waterFlip.default,
        waterColor: s.waterColor.default.slice() as [number, number, number],
        waterTransparency: s.waterTransparency.default,
        waterWaveHeight: s.waterWaveHeight.default,
        bigWaveHeight: s.bigWaveHeight.default,
        smallWaveHeight: s.smallWaveHeight.default,
        waterSize: s.waterSize.default,
        waterAnimSpeed: s.waterAnimSpeed.default,
        planarReflectBlend: s.planarReflectBlend.default,
        reflectionQuality: s.reflectionQuality.default,
        qualityProfile: s.qualityProfile.default,
        waterFogColor: s.waterFogColor.default.slice() as [number, number, number],
        waterFogDensity: s.waterFogDensity.default,
        waterFogOpacityInfluence: s.waterFogOpacityInfluence.default,
        waterHorizonFade: s.waterHorizonFade.default,
        waterSkyColorBlend: s.waterSkyColorBlend.default,
        fresnelBias: s.fresnelBias.default,
        fresnelPower: s.fresnelPower.default,
        diffuseStrength: s.diffuseStrength.default,
        ambientStrength: s.ambientStrength.default,
        rippleNormalStrength: s.rippleNormalStrength.default,
        rippleGlintStrength: s.rippleGlintStrength.default,
        waterNormalStrength: s.waterNormalStrength.default,
        waterGlintStrength: s.waterGlintStrength.default,
        causticIntensity: s.causticIntensity.default,
        causticColor1: s.causticColor1.default.slice() as [number, number, number],
        causticColor2: s.causticColor2.default.slice() as [number, number, number],
        causticScrollX: s.causticScrollX.default,
        causticScrollY: s.causticScrollY.default,
        fresnelAlphaInfluence: s.fresnelAlphaInfluence.default,
        underwaterFogDensity: s.underwaterFogDensity.default,
        underwaterChromaticAmount: s.underwaterChromaticAmount.default,
        underwaterToneIntensity: s.underwaterToneIntensity.default,
        underwaterFogMultiplier: s.underwaterFogMultiplier.default,
        underwaterTintStrength: s.underwaterTintStrength.default,
        cloudsEnabled: s.cloudsEnabled.default,
        debugClouds: s.debugClouds.default,
        cloudCover: s.cloudCover.default,
        cloudScale: s.cloudScale.default,
        cloudHeight: s.cloudHeight.default,
        cloudThickness: s.cloudThickness.default,
        cloudVisibility: s.cloudVisibility.default,
        cloudGap: s.cloudGap.default,
        cloudErosion: s.cloudErosion.default,
        cloudWeatherStrength: s.cloudWeatherStrength.default,
        cloudBacklight: s.cloudBacklight.default,
        cloudPowder: s.cloudPowder.default,
        cloudQuality: s.cloudQuality.default,
        mirrorEnabled: s.mirrorEnabled.default,
        fogEnabled: s.fogEnabled.default,
        fogMode: s.fogMode.default,
        fogColor: s.fogColor.default.slice() as [number, number, number],
        fogDensity: s.fogDensity.default,
        fogStart: s.fogStart.default,
        fogEnd: s.fogEnd.default,
        collisionEnabled: s.collisionEnabled.default,
        bodyCollisionEnabled: s.bodyCollisionEnabled.default,
        groundCollisionEnabled: s.groundCollisionEnabled.default,
        sunAngle: s.sunAngle.default,
        azimuth: s.azimuth.default,
        lightingPresetName: s.lightingPresetName.default,
        timeOfDayActive: s.timeOfDayActive.default,
        timeOfDaySpeed: s.timeOfDaySpeed.default,
    } as EnvState;
}

export const envState: EnvState = reactive<EnvState>(buildDefaultEnvState());
