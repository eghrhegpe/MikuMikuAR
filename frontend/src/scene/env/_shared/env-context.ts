// env-context.ts — 环境系统共享上下文
// 从 env-impl.ts 拆分而来：提供 _envSys、getScene、getPipeline 等共享依赖，
// 供所有 env-* 子模块使用，避免 env-impl ↔ env-water 循环依赖。

import {
    Scene,
    ParticleSystem,
    DefaultRenderingPipeline,
    StandardMaterial,
    Texture,
    Mesh,
} from '@babylonjs/core';
import { type ObserverHandle } from '@/core/observer-handle';

// ======== Injected dependencies ========
let _scene: Scene | null = null;
let _pipeline: DefaultRenderingPipeline | null = null;

export function initEnvImpl(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _scene = scene;
    _pipeline = pipeline;
}

/** 取当前 Babylon 场景；未初始化时抛错（env 子系统内部使用）。 */
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

// ======== 地水共享尺寸单源 ========
// 无限地面/水面的固定 mesh 尺寸（匹配碰撞体范围，ADR-134）。
// 放在 env-context（零循环依赖共享层）使 env-ground 与 env-water 共用同一个值，
// 避免 env-water→env-ground 反向 import 造成循环依赖（env-ground 已 import env-water）。
export const INFINITE_GROUND_SIZE = 2000;

/**
 * 当前生效的地面尺寸：开启无限地面时为固定大尺寸，否则为 groundSize。
 * 地面 mesh、水面 mesh 缩放、水面地平线淡出距离均据此派生，保证地水延伸范围一致。
 */
export function effectiveGroundSize(groundSize: number, infiniteEnabled: boolean): number {
    return infiniteEnabled ? INFINITE_GROUND_SIZE : groundSize;
}

// ======== Static Asset URL Resolver (Android 安全) ========
export function resolveStaticAsset(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
    }
    return new URL(path, window.location.origin).href;
}

// ======== Scene Tick Callback Registry (re-export from env-dispatcher) ========
// 迁入 env-dispatcher 使 env-bridge 无需 import env-impl。
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
