// scene-env.ts — Environment Facade (Phase 8)
// Delegates all environment calls to scene-env-impl.ts
// External modules should ONLY import from this file.
import * as impl from './scene-env-impl';
import { EnvState, envState } from '../core/config';

// Re-export _envSys for backward compatibility (used by scene.ts)
export { _envSys } from './scene-env-impl';
// Re-export callback registry for bridge module (time-of-day)
export { registerSceneTickCallback } from './scene-env-impl';
// Re-export observer init for bridge module
export { ensureEnvUpdateObserver } from './scene-env-impl';

// Time-of-Day 使用 bridge.ts 的实现（统一的 scene observer）
import {
    startTimeOfDay as bridgeStartTimeOfDay,
    stopTimeOfDay as bridgeStopTimeOfDay,
    isTimeOfDayActive as bridgeIsTimeOfDayActive,
    getTimeOfDaySpeed as bridgeGetTimeOfDaySpeed,
    setTimeOfDaySpeed as bridgeSetTimeOfDaySpeed,
} from './scene-env-bridge';
import { Scene } from '@babylonjs/core/scene';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ======== Init (called once by scene.ts) ========

export function initEnvFacade(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    impl.initEnvImpl(scene, pipeline);
}

// ======== Sky ========

export function applySky(state?: EnvState): void {
    impl.applySky(state ?? envState);
}

// ======== Ground ========

export function applyGround(state?: EnvState): void {
    impl.applyGround(state ?? envState);
}

// ======== Water ========

export function createWater(state?: EnvState): void {
    impl.createWater(state ?? envState);
}

export function disposeWater(): void {
    impl.disposeWater();
}

export function refreshWaterRenderList(): void {
    impl.refreshWaterRenderList();
}

export function updateWaterAnimSpeed(speed: number): void {
    impl.updateWaterAnimSpeed(speed);
}

// ======== Interaction Ripples ========

export function addRipple(
    pos: Vector3,
    radius?: number,
    strength?: number,
    speed?: number,
    maxLife?: number
): void {
    impl.addRipple(pos, radius, strength, speed, maxLife);
}

export function clearRipples(): void {
    impl.clearRipples();
}

// ======== Particles ========

export function createParticleEmitter(state?: EnvState): void {
    const s = state ?? envState;
    impl.createParticleEmitter(s.particleType, s.windEnabled);
}

export function disposeParticles(): void {
    impl.disposeParticles();
}

export function applyWindToParticles(wind: { x: number; y: number; z: number }): void {
    // wind is applied inside createParticleEmitter via envState.windEnabled
}

// ======== Clouds ========

export function createClouds(state?: EnvState): void {
    impl.createClouds(state ?? envState);
}

export function disposeClouds(): void {
    impl.disposeClouds();
}

// ======== Time-of-Day (delegated to bridge for unified scene observer) ========

export function startTimeOfDay(): void {
    bridgeStartTimeOfDay();
}

export function stopTimeOfDay(): void {
    bridgeStopTimeOfDay();
}

export function isTimeOfDayActive(): boolean {
    return bridgeIsTimeOfDayActive();
}

export function getTimeOfDaySpeed(): number {
    return bridgeGetTimeOfDaySpeed();
}

export function setTimeOfDaySpeed(s: number): void {
    bridgeSetTimeOfDaySpeed(s);
}

// ======== Full apply (called by setEnvState in scene.ts) ========

export function applyEnvState(state: EnvState): void {
    try { impl.applySky(state); } catch (e) { console.warn('[env] sky fail:', e); }
    try { impl.applyGround(state); } catch (e) { console.warn('[env] ground fail:', e); }
    try { impl.applyFog(state); } catch (e) { console.warn('[env] fog fail:', e); }

    // Water
    try {
        if (state.waterEnabled) {
            impl.createWater(state);
        } else {
            impl.disposeWater();
        }
    } catch (e) { console.warn('[env] water fail:', e); }

    // Particles
    try {
        if (state.particleEnabled && state.particleType && state.particleType !== 'none') {
            // createParticleEmitter expects (particleType, windEnabled)
            impl.createParticleEmitter(state.particleType, state.windEnabled);
        } else {
            impl.disposeParticles();
        }
    } catch (e) { console.warn('[env] particle fail:', e); }

    // Clouds
    try {
        if (state.cloudsEnabled) {
            impl.createClouds(state);
        } else {
            impl.disposeClouds();
        }
    } catch (e) { console.warn('[env] cloud fail:', e); }
}
