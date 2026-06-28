// scene-env.ts — Environment System (Phase 8)
// Extracted from scene.ts to reduce complexity
// Manages: sky, ground, water, particles, clouds, wind, time-of-day

import { Mesh, Scene, Color3, Color4, Vector2, Vector3, Texture, BaseTexture, StandardMaterial, GridMaterial, WaterMaterial, GPUParticleSystem, Observer, ParticleSystem, ShadowGenerator, CubeTexture } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { EnvState } from "../core/config";

// ======== Module-level references (injected by scene.ts) ========

let _scene: Scene | null = null;
let _pipeline: DefaultRenderingPipeline | null = null;

export function initEnvironmentSystem(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _scene = scene;
    _pipeline = pipeline;
    console.log("[scene-env] Environment system initialized");
}

function getScene(): Scene {
    if (!_scene) throw new Error("[scene-env] Scene not initialized. Call initEnvironmentSystem() first.");
    return _scene;
}

function getPipeline(): DefaultRenderingPipeline {
    if (!_pipeline) throw new Error("[scene-env] Pipeline not initialized. Call initEnvironmentSystem() first.");
    return _pipeline;
}

// ======== Environment State ========

export let envSunAngle = 45; // default sun angle
export let envTimeOfDayRunning = false;
export let envTimeOfDayHandle: number | null = null;

// ======== Environment Resources ========

export interface EnvSkyResources {
    skyMesh: Mesh | null;
    envTexture: BaseTexture | null;
}

export const _envSys: {
    sky: EnvSkyResources;
    ground: { mesh: Mesh | null };
    particles: { emitter: GPUParticleSystem | null; followObserver: Observer<Scene> | null };
    clouds: { postProcess: Mesh | null; postProcess2: Mesh | null; material: StandardMaterial | null; texture: Texture | null };
    water: { mesh: Mesh | null; material: WaterMaterial | null };
    shadow: { generator: ShadowGenerator | null };
} = {
    sky: { skyMesh: null, envTexture: null },
    ground: { mesh: null },
    particles: { emitter: null, followObserver: null },
    clouds: { postProcess: null, postProcess2: null, material: null, texture: null },
    water: { mesh: null, material: null },
    shadow: { generator: null },
};

// ======== Apply Interface (Phase 1: Stub) ========

/** Apply environment state. Phase 1: stub that logs, Phase 2+: actual implementation. */
export function apply(state: EnvState): void {
    console.log("[scene-env] apply() called (Phase 1 stub)", state);
    // TODO Phase 2: Move environment implementation from scene.ts to here
    // - _applySky(state)
    // - _applyGround(state)
    // - _createWater(state)
    // - _createParticleEmitter(state)
    // - _createClouds(state)
}

/** Dispose environment resources. Call on cleanup. */
export function disposeEnvironmentSystem(): void {
    // TODO Phase 2: Dispose all environment resources
    console.log("[scene-env] dispose() called (Phase 1 stub)");
}

