// env-context.ts — 环境系统共享上下文
// 从 env-impl.ts 拆分而来：提供 _envSys、getScene、getPipeline 等共享依赖，
// 供所有 env-* 子模块使用，避免 env-impl ↔ env-water 循环依赖。

import { Scene, ParticleSystem, DefaultRenderingPipeline, StandardMaterial, Texture, Mesh } from '@babylonjs/core';
import { type ObserverHandle } from '@/core/observer-handle';

// ======== Injected dependencies ========
let _scene: Scene | null = null;
let _pipeline: DefaultRenderingPipeline | null = null;

export function initEnvImpl(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _scene = scene;
    _pipeline = pipeline;
}

export function getScene(): Scene {
    if (!_scene) {
        throw new Error('[env-context] Scene not initialized');
    }
    return _scene;
}

export function isInitialized(): boolean {
    return _scene !== null;
}

export function getPipeline(): DefaultRenderingPipeline {
    if (!_pipeline) {
        throw new Error('[env-context] Pipeline not initialized');
    }
    return _pipeline;
}

// ======== Static Asset URL Resolver (Android 安全) ========
export function resolveStaticAsset(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
    }
    return new URL(path, window.location.origin).href;
}

// ======== Scene Tick Callback Registry ========
const _sceneTickCallbacks = new Set<() => void>();

export function registerSceneTickCallback(cb: () => void): () => void {
    _sceneTickCallbacks.add(cb);
    return () => _sceneTickCallbacks.delete(cb);
}

export function clearSceneTickCallbacks(): void {
    _sceneTickCallbacks.clear();
}

export function runSceneTickCallbacks(): void {
    for (const cb of _sceneTickCallbacks) {
        cb();
    }
}

// ======== _envSys ========
interface EnvSkyResources {
    skyMesh: Mesh | null;
    skyCubeTexture: import('@babylonjs/core').BaseTexture | null;
    skyDynamicTex: import('@babylonjs/core').DynamicTexture | null;
}

export const _envSys: {
    sky: EnvSkyResources;
    ground: { mesh: Mesh | null };
    particles: { system: ParticleSystem | null; followObserver: ObserverHandle | null };
    splash: { observer: ObserverHandle | null };
    clouds: {
        postProcess: Mesh | null;
        postProcess2: Mesh | null;
        material: StandardMaterial | null;
        texture: Texture | null;
    };
    water: { mesh: Mesh | null; material: import('@babylonjs/core').ShaderMaterial | null };
    shadow: { generator: import('@babylonjs/core').ShadowGenerator | null };
} = {
    sky: { skyMesh: null, skyCubeTexture: null, skyDynamicTex: null },
    ground: { mesh: null },
    particles: { system: null, followObserver: null },
    splash: { observer: null },
    clouds: { postProcess: null, postProcess2: null, material: null, texture: null },
    water: { mesh: null, material: null },
    shadow: { generator: null },
};