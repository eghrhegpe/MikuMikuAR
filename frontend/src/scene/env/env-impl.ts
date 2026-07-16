// env-impl.ts — Environment System barrel + observer + fog
// 从 env-impl.ts 拆分而来：天空→env-sky.ts，地面→env-ground.ts
// 本文件保留：共享依赖注入、_envSys、observer、fog、barrel re-export

import {
    Scene,
    ParticleSystem,
    Observer,
    DefaultRenderingPipeline,
    StandardMaterial,
    Texture,
    Mesh,
} from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { col3FromTriple } from '@/core/color-helpers';
import { logWarn } from '@/core/utils';
import { disposeTextureCache } from './env-texture';

// ======== Re-exports: Water / Clouds / MirrorDebug ========
export {
    createWater,
    disposeWater,
    refreshWaterRenderList,
    addRipple,
    clearRipples,
    updateWaterAnimSpeed,
    _underwaterActive,
    _underwaterSavedFog,
    _underwaterTransitionProgress,
    _underwaterTarget,
} from './env-water';
import { updateUnderwaterTransition, resetUnderwaterState } from './env-water';
export { createClouds, disposeClouds } from './env-clouds';
export {
    createDebugMirror,
    disposeDebugMirror,
    isDebugMirrorActive,
    updateDebugMirrorClearColor,
} from './mirror-debug';

// ======== Re-exports: Sky ========
export { applySky, disposeSky } from './env-sky';

// ======== Re-exports: Ground ========
export {
    applyGround,
    getGroundHeightAt,
    setOnTerrainReady,
    setOnGroundChanged,
    disposeGround,
} from './env-ground';
import { tickGround } from './env-ground';

// ======== Re-exports: Particles ========
import {
    createParticleEmitter,
    disposeParticles,
    applyWindToParticles,
    updateParticleWind,
    updateParticleParams,
    updateParticleTexture,
    syncSplashState,
    disposeSplash,
    getCurrentParticleType,
} from './env-particles';
export {
    createParticleEmitter,
    disposeParticles,
    applyWindToParticles,
    updateParticleWind,
    updateParticleTexture,
};

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

// ======== Injected dependencies ========
let _scene: Scene | null = null;
let _pipeline: DefaultRenderingPipeline | null = null;

export function initEnvImpl(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _scene = scene;
    _pipeline = pipeline;
}

export function getScene(): Scene {
    if (!_scene) {
        throw new Error('[scene-env-impl] Scene not initialized');
    }
    return _scene;
}

export function getPipeline(): DefaultRenderingPipeline {
    if (!_pipeline) {
        throw new Error('[scene-env-impl] Pipeline not initialized');
    }
    return _pipeline;
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
    particles: { system: ParticleSystem | null; followObserver: Observer<Scene> | null };
    splash: { observer: Observer<Scene> | null };
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

// ======== Env Update Observer ========
let _envUpdateObserver: Observer<Scene> | null = null;
let _prevParticleEnabled = true;
let _prevSplash = false;
let _prevCustomTexture = '';

export function ensureEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        return;
    }

    _envUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.deltaTime / 1000;

        // Cloud drift
        if (envState.cloudsEnabled && _envSys.clouds.postProcess) {
            const cam = scene.activeCamera;
            const dx = envState.windEnabled
                ? envState.windDirection[0] * envState.windSpeed * 0.3 * dt
                : 0;
            const dz = envState.windEnabled
                ? envState.windDirection[2] * envState.windSpeed * 0.3 * dt
                : 0;
            for (const key of ['postProcess', 'postProcess2'] as const) {
                const m = _envSys.clouds[key];
                if (m) {
                    const speedMul = key === 'postProcess2' ? 0.7 : 1.0;
                    if (cam) {
                        m.position.x = cam.position.x;
                        m.position.z = cam.position.z;
                    }
                    const mat = m.material as StandardMaterial | null;
                    if (mat.diffuseTexture) {
                        const tex = mat.diffuseTexture as Texture;
                        tex.uOffset = (tex.uOffset + dx * speedMul) % 1;
                        if (tex.uOffset < 0) {
                            tex.uOffset += 1;
                        }
                        tex.vOffset = (tex.vOffset + dz * speedMul) % 1;
                        if (tex.vOffset < 0) {
                            tex.vOffset += 1;
                        }
                    }
                }
            }
        }

        // Particles
        updateParticleWind();
        updateParticleParams();

        if (_prevParticleEnabled !== envState.particleEnabled) {
            _prevParticleEnabled = envState.particleEnabled;
            if (!envState.particleEnabled && _envSys.particles.system) {
                disposeParticles();
                disposeSplash();
            } else if (
                envState.particleEnabled &&
                !_envSys.particles.system &&
                getCurrentParticleType() !== 'none'
            ) {
                createParticleEmitter(getCurrentParticleType(), envState.windEnabled);
            }
        }
        if (_prevSplash !== envState.particleSplash) {
            _prevSplash = envState.particleSplash;
            syncSplashState();
        }
        if (_prevCustomTexture !== envState.particleCustomTexture) {
            _prevCustomTexture = envState.particleCustomTexture ?? '';
            if (_envSys.particles.system) {
                updateParticleTexture();
            }
        }

        // Sky rotation
        if (envState.skyRotationSpeed > 0.001 && _envSys.sky.skyMesh) {
            _envSys.sky.skyMesh.rotation.y += envState.skyRotationSpeed * 0.6 * dt;
            if (_envSys.sky.skyMesh.rotation.y > Math.PI * 2) {
                _envSys.sky.skyMesh.rotation.y -= Math.PI * 2;
            } else if (_envSys.sky.skyMesh.rotation.y < -Math.PI * 2) {
                _envSys.sky.skyMesh.rotation.y += Math.PI * 2;
            }
        }

        // Ground per-frame updates (scroll, reflection, follow-camera)
        tickGround(dt);

        // Underwater
        updateUnderwaterTransition(scene, pipeline);

        // Scene tick callbacks
        for (const cb of _sceneTickCallbacks) {
            cb();
        }
    });
}

import { disposeGround as _disposeGround, clearGroundTexCache } from './env-ground';
import { clearStarsTexCache } from './env-sky';

export function disposeEnvUpdateObserver(): void {
    // 首启 / HMR 重入幂等：initScene() step0 清理在 initEnvImpl 之前调用，
    // 此时 _scene 仍为 null，无 observer / 资源可释放，直接 no-op 返回避免抛错（ADR-106 Phase 3）。
    if (!_scene) {
        return;
    }
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        scene.onBeforeRenderObservable.remove(_envUpdateObserver);
        _envUpdateObserver = null;
    }
    // 清理所有场景 tick 回调（如 time-of-day），避免 HMR 重入时泄漏
    _sceneTickCallbacks.clear();
    disposeTextureCache();
    _disposeGround();
    clearGroundTexCache();
    clearStarsTexCache();
    resetUnderwaterState(scene, pipeline);
}

// ======== Fog ========
export function applyFog(state: EnvState): void {
    const scene = getScene();
    if (state.fogEnabled) {
        const fogMode = state.fogMode || 'exp2';
        switch (fogMode) {
            case 'exp':
                scene.fogMode = Scene.FOGMODE_EXP;
                scene.fogDensity = state.fogDensity;
                break;
            case 'exp2':
                scene.fogMode = Scene.FOGMODE_EXP2;
                scene.fogDensity = state.fogDensity;
                break;
            case 'linear':
                scene.fogMode = Scene.FOGMODE_LINEAR;
                scene.fogStart = state.fogStart;
                scene.fogEnd = state.fogEnd;
                break;
            default:
                logWarn('env', `unknown fogMode "${fogMode}", falling back to exp2`);
                scene.fogMode = Scene.FOGMODE_EXP2;
                scene.fogDensity = state.fogDensity;
                break;
        }
        scene.fogColor = col3FromTriple(state.fogColor);
    } else {
        scene.fogMode = Scene.FOGMODE_NONE;
    }
}
