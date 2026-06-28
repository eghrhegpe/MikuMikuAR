// scene-env.ts — Environment Facade (Phase 8)
// Delegates all environment calls to scene-env-impl.ts
// External modules should ONLY import from this file.
import * as impl from "./scene-env-impl";
import { EnvState, envState } from "../core/config";

// Re-export _envSys for backward compatibility (used by scene.ts)
export { _envSys } from "./scene-env-impl";
import { Scene } from "@babylonjs/core/scene";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

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

// ======== Time-of-Day ========

export function startTimeOfDay(): void {
    impl.startTimeOfDay();
}

export function stopTimeOfDay(): void {
    impl.stopTimeOfDay();
}

export function isTimeOfDayActive(): boolean {
    return impl.isTimeOfDayActive();
}

export function getTimeOfDaySpeed(): number {
    return impl.getTimeOfDaySpeed();
}

export function setTimeOfDaySpeed(s: number): void {
    impl.setTimeOfDaySpeed(s);
}

// ======== Full apply (called by setEnvState in scene.ts) ========

export function applyEnvState(state: EnvState): void {
    impl.applySky(state);
    impl.applyGround(state);
    impl.applyFog(state);

    // Water
    if (state.waterEnabled) {
        impl.createWater(state);
    } else {
        impl.disposeWater();
    }

    // Particles
    if (state.particleEnabled && state.particleType && state.particleType !== "none") {
        // createParticleEmitter expects (particleType, windEnabled)
        impl.createParticleEmitter(state.particleType, state.windEnabled);
    } else {
        impl.disposeParticles();
    }

    // Clouds
    if (state.cloudsEnabled) {
        impl.createClouds(state);
    } else {
        impl.disposeClouds();
    }
}
