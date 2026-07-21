// env-impl.ts — Environment System barrel + observer + fog
// 从 env-impl.ts 拆分而来：天空→env-sky.ts，地面→env-ground.ts，共享上下文→env-context.ts
// 本文件保留：observer、fog、barrel re-export

import { Scene } from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { getEnvKeys } from '@/core/env-state-schema';
import { col3FromTriple } from '@/core/color-helpers';
import { logWarn } from '@/core/logger';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { disposeTextureCache } from './env-texture';
import { _envSys, getScene, getPipeline, isInitialized, resolveStaticAsset } from './env-context';
import { clearSceneTickCallbacks, runSceneTickCallbacks } from './env-dispatcher';

// Re-export shared context for backward compatibility
export { _envSys, getScene, getPipeline, resolveStaticAsset, isInitialized } from './env-context';

// ======== Re-exports: Water / Clouds / MirrorDebug ========
export {
    createWater,
    disposeWater,
    refreshWaterRenderList,
    addRipple,
    clearRipples,
    addGroundRipple,
    clearGroundRipples,
    getGroundRippleTexture,
    updateGroundRipples,
    updateWaterAnimSpeed,
    isUnderwaterActive,
} from './env-water';
import {
    createWater,
    disposeWater,
    updateUnderwaterTransition,
    resetUnderwaterState,
    updateGroundRipples,
} from './env-water';
export { createClouds, disposeClouds } from './env-clouds';
import { createClouds, disposeClouds } from './env-clouds';
export {
    createMirror,
    disposeMirror,
    isMirrorActive,
    updateMirrorClearColor,
} from './mirror-debug';
import {
    createMirror,
    disposeMirror,
    isMirrorActive,
    updateMirrorClearColor,
} from './mirror-debug';

// ======== Re-exports: Sky ========
export { applySky, disposeSky } from './env-sky';
import { applySky } from './env-sky';

// ======== Re-exports: Ground ========
export {
    applyGround,
    getGroundHeightAt,
    setOnTerrainReady,
    setOnGroundChanged,
    disposeGround,
} from './env-ground';
import { applyGround, tickGround } from './env-ground';

// ======== Re-exports: Particles ========
import {
    createParticleEmitter,
    disposeParticles,
    updateParticleWind,
    updateParticleParams,
    updateParticleTexture,
    syncSplashState,
    disposeSplash,
    getCurrentParticleType,
} from './env-particles';
export { createParticleEmitter, disposeParticles, updateParticleWind, updateParticleTexture };

// ======== Scene Tick Callback Registry (re-export from env-dispatcher) ========
export {
    registerSceneTickCallback,
    clearSceneTickCallbacks,
    runSceneTickCallbacks,
} from './env-dispatcher';

// ======== initEnvImpl (re-export from env-context) ========
export { initEnvImpl } from './env-context';

// [ADR-138] 注册 env-dispatcher 回调，响应 setEnvState 变化，破除 env-bridge → env-impl 循环依赖
import { registerEnvCallback } from './env-dispatcher';

// 从 Schema 自动派生 dispatch key 列表，新增字段无需手工维护
const _SKY_KEYS = getEnvKeys('sky');
const _GROUND_KEYS = getEnvKeys('ground');
const _FOG_KEYS = getEnvKeys('fog');

registerEnvCallback((changed, state) => {
    // Sky
    if (!changed || [...changed].some((k) => _SKY_KEYS.includes(k))) {
        applySky(state);
        if (isMirrorActive() && updateMirrorClearColor) {
            updateMirrorClearColor();
        }
    }
    // Ground
    if (!changed || [...changed].some((k) => _GROUND_KEYS.includes(k))) {
        applyGround(state);
    }
    // Fog
    if (!changed || [...changed].some((k) => _FOG_KEYS.includes(k))) {
        applyFog(state);
    }
    // Mirror
    if (!changed || changed.has('mirrorEnabled')) {
        if (state.mirrorEnabled && !isMirrorActive()) {
            createMirror();
        } else if (!state.mirrorEnabled && isMirrorActive()) {
            disposeMirror();
        }
    }
});

// ======== Env Update Observer ========
let _envUpdateObserver: ObserverHandle | null = null;
let _prevParticleEnabled = true;
let _prevSplash = false;
let _prevCustomTexture = '';

export function ensureEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        return;
    }

    _envUpdateObserver = observe(scene.onBeforeRenderObservable, () => {
        const dt = scene.deltaTime / 1000;

        // P2 修复：旧版平面纹理云的漂移逻辑（_envSys.clouds.postProcess/postProcess2）
        // 已被 ShaderMaterial-on-Sphere 取代，残留代码每帧执行但不生效，删除。
        // 新版云层在 env-clouds.ts 内部 onBeforeRender 通过 windDirection uniform + time 自管理。

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

        // Ground ripples per-frame update
        updateGroundRipples(dt);

        // Underwater
        updateUnderwaterTransition(scene, pipeline);

        // Scene tick callbacks
        runSceneTickCallbacks();
    });
}

import { disposeGround as _disposeGround, clearGroundTexCache } from './env-ground';
import { clearStarsTexCache } from './env-sky';

export function disposeEnvUpdateObserver(): void {
    // 首启 / HMR 重入幂等：initScene() step0 清理在 initEnvImpl 之前调用，
    // 此时 scene 未初始化，无 observer / 资源可释放，直接 no-op 返回避免抛错（ADR-106 Phase 3）。
    if (!isInitialized()) {
        return;
    }
    const scene = getScene();
    const pipeline = getPipeline();
    _envUpdateObserver = safeDispose(_envUpdateObserver);
    // 清理所有场景 tick 回调（如 time-of-day），避免 HMR 重入时泄漏
    clearSceneTickCallbacks();
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
