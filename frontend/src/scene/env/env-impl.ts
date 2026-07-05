// scene-env-impl.ts — Environment System Implementation (Phase 8)
// All functions use module-level _scene / _pipeline injected by scene.ts
// Import this file via scene-env.ts (Facade), never import directly.

import {
    Scene,
    Color3,
    Color4,
    Texture,
    BaseTexture,
    StandardMaterial,
    GPUParticleSystem,
    Observer,
    ShadowGenerator,
    CubeTexture,
    Constants,
    DefaultRenderingPipeline,
    Mesh,
    MeshBuilder,
    ShaderMaterial,
} from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { EnvState, envState } from '../../core/config';

// ======== Static Asset URL Resolver (Android 安全) ========
/** 将相对路径转为绝对 URL，确保 Android WebView 能正确加载嵌入资源。
 *  相对路径（如 'textures/grass.png'）在 Android 可能因 base URL 不同而 404。 */
function resolveStaticAsset(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path; // 已经是绝对 URL 或 data URL，原样返回
    }
    // 相对路径 → 绝对 URL（基于当前页面 origin）
    return new URL(path, window.location.origin).href;
}

// ======== Scene Tick Callback Registry (统一 scene observer) ========
/** 统一管理所有 scene.onBeforeRenderObservable 回调。
 *  避免多个模块各自添加 observer，导致重复 tick 或竞态。 */
const _sceneTickCallbacks = new Set<() => void>();

/** 注册一个每帧回调（回调会在 env observer 中被调用）。
 *  @returns 取消注册函数 */
export function registerSceneTickCallback(cb: () => void): () => void {
    _sceneTickCallbacks.add(cb);
    return () => _sceneTickCallbacks.delete(cb);
}

// ======== Injected dependencies (set by scene.ts on init) ========
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

// ======== Module-level state ========
interface EnvSkyResources {
    skyMesh: Mesh | null;
    envTexture: BaseTexture | null;
}

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
export { createClouds, disposeClouds } from './env-clouds';
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
import { _disposeSunDisc } from '../render/lighting';
import { updateUnderwaterTransition, resetUnderwaterState } from './env-water';

export { createParticleEmitter, disposeParticles, applyWindToParticles, updateParticleWind, updateParticleTexture };

export const _envSys: {
    sky: EnvSkyResources;
    ground: { mesh: Mesh | null };
    particles: { system: GPUParticleSystem | null; followObserver: Observer<Scene> | null };
    splash: { observer: Observer<Scene> | null };
    clouds: {
        postProcess: Mesh | null;
        postProcess2: Mesh | null;
        material: StandardMaterial | null;
        texture: Texture | null;
    };
    water: { mesh: Mesh | null; material: ShaderMaterial | null };
    shadow: { generator: ShadowGenerator | null };
} = {
    sky: { skyMesh: null, envTexture: null },
    ground: { mesh: null },
    particles: { system: null, followObserver: null },
    splash: { observer: null },
    clouds: { postProcess: null, postProcess2: null, material: null, texture: null },
    water: { mesh: null, material: null },
    shadow: { generator: null },
};

/** Cache key for procedural gradient: skip rebuild when unchanged */
let _lastProceduralSkyKey = '';

// ======== Sky ========
export function disposeSky(): void {
    const scene = getScene();
    if (_envSys.sky.skyMesh) {
        _envSys.sky.skyMesh.dispose();
        _envSys.sky.skyMesh = null;
    }
    if (_envSys.sky.envTexture) {
        scene.environmentTexture = null;
        _envSys.sky.envTexture.dispose();
        _envSys.sky.envTexture = null;
    }
    _lastProceduralSkyKey = '';
    disposeSunDisc();
}

function disposeSunDisc(): void {
    _disposeSunDisc();
}

function buildGradientTexture(
    top: Color3,
    mid: Color3,
    bot: Color3,
    brightness: number,
    sunAngle: number,
    starsEnabled: boolean
): Texture {
    const scene = getScene();
    const W = 256,
        H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const scale = (c: Color3) =>
        `rgb(${(c.r * brightness * 255) | 0},${(c.g * brightness * 255) | 0},${(c.b * brightness * 255) | 0})`;
    grad.addColorStop(0, scale(bot));
    grad.addColorStop(0.35, scale(bot));
    grad.addColorStop(0.5, scale(mid));
    grad.addColorStop(0.65, scale(top));
    grad.addColorStop(1, scale(top));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (starsEnabled) {
        const starAlpha = sunAngle > 10 ? 0 : sunAngle < -5 ? 1 : (10 - sunAngle) / 15;
        if (starAlpha > 0.01) {
            const starSeed = 12345;
            const hash = (i: number) => {
                let h = (i * 2654435761 + starSeed) | 0;
                h ^= h >>> 13;
                return (h & 0x7fffffff) / 0x7fffffff;
            };
            const starCount = Math.round(200 + starAlpha * 100);
            for (let i = 0; i < starCount; i++) {
                const sx = hash(i * 3) * W;
                const sy = hash(i * 3 + 1) * H * 0.55;
                const sr = 0.5 + hash(i * 3 + 2) * 2.0;
                const sa = starAlpha * (0.3 + hash(i + 1000) * 0.7);
                const twinkle = 0.7 + hash(i + 2000) * 0.3;
                const r = (220 + hash(i + 3000) * 35) | 0;
                const g = (210 + hash(i + 4000) * 45) | 0;
                const b = (200 + hash(i + 5000) * 55) | 0;
                ctx.fillStyle = `rgba(${r},${g},${b},${(sa * twinkle).toFixed(2)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    const tex = new Texture('data:' + canvas.toDataURL('image/png'), scene, false);
    tex.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    tex.hasAlpha = false;
    return tex;
}

function createProceduralSky(state: EnvState): void {
    const scene = getScene();
    const sphere = MeshBuilder.CreateSphere(
        'envSkySphere',
        {
            diameter: 1000,
            segments: 24,
            sideOrientation: Mesh.BACKSIDE,
        },
        scene
    );
    sphere.isPickable = false;

    const mat = new StandardMaterial('envSkyMat', scene);
    mat.emissiveTexture = buildGradientTexture(
        new Color3(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2]),
        new Color3(state.skyColorMid[0], state.skyColorMid[1], state.skyColorMid[2]),
        new Color3(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2]),
        state.skyBrightness,
        state.sunAngle,
        state.starsEnabled
    );
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;
    scene.clearColor = new Color4(0, 0, 0, 1);
    _lastProceduralSkyKey = `${state.skyColorTop}|${state.skyColorMid}|${state.skyColorBot}|${state.skyBrightness}|${state.sunAngle}|${state.starsEnabled}`;
}

function loadEnvTexture(path: string, rotationY: number, intensity: number): void {
    const scene = getScene();
    const ext = path.split('.').pop().toLowerCase();
    const supported = ['hdr', 'dds', 'exr'];
    if (!supported.includes(ext ?? '')) {
        console.warn(`[sky] unsupported format .${ext}, falling back to procedural`);
        disposeSky();
        createProceduralSky(envState);
        return;
    }

    const cubeTex = new CubeTexture(
        path,
        scene,
        null,  // extensionsOrOptions
        false, // noMipmap
        null,  // files
        null,  // onLoad
        (message?: string, exception?: any) => {
            // Texture load failed — fall back to procedural sky (Fix E)
            console.warn(`[sky] loadEnvTexture failed: ${message}`, exception);
            disposeSky();
            createProceduralSky(envState);
        }
    );
    cubeTex.rotationY = rotationY;
    scene.environmentTexture = cubeTex;
    scene.environmentIntensity = intensity;
    scene.clearColor = new Color4(0, 0, 0, 1);
    _envSys.sky.envTexture = cubeTex;

    const sphere = MeshBuilder.CreateSphere(
        'envSkyDome',
        {
            diameter: 1000,
            segments: 24,
            sideOrientation: Mesh.BACKSIDE,
        },
        scene
    );
    sphere.isPickable = false;
    const mat = new StandardMaterial('envSkyDomeMat', scene);
    mat.reflectionTexture = cubeTex;
    mat.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;
}

export function applySky(state: EnvState): void {
    const scene = getScene();
    if (state.skyMode === 'color') {
        disposeSky();
        scene.clearColor = new Color4(
            state.skyColorTop[0],
            state.skyColorTop[1],
            state.skyColorTop[2],
            1
        );
        return;
    }

    const mesh = _envSys.sky.skyMesh;

    if (state.skyMode === 'procedural') {
        // Guard: mesh or material may be null after dispose/recreate
        if (!mesh || !mesh.material) {
            disposeSky();
            createProceduralSky(state);
            return;
        }
        if (mesh.material && mesh.material.getClassName() === 'StandardMaterial') {
            const mat = mesh.material as StandardMaterial;

            // Early-out: skip rebuild when gradient inputs haven't changed (Fix J)
            const skyKey = `${state.skyColorTop}|${state.skyColorMid}|${state.skyColorBot}|${state.skyBrightness}|${state.sunAngle}|${state.starsEnabled}`;
            if (skyKey === _lastProceduralSkyKey && mat.emissiveTexture) {
                return;
            }
            _lastProceduralSkyKey = skyKey;

            // Clean up CubeTexture / reflectionTexture when transitioning texture→procedural
            // Prevents A) visual corruption from dual reflection+emissive, and H) stale scene.environmentTexture
            if (_envSys.sky.envTexture || mat.reflectionTexture) {
                if (_envSys.sky.envTexture) {
                    scene.environmentTexture = null;
                    _envSys.sky.envTexture.dispose();
                    _envSys.sky.envTexture = null;
                }
                mat.reflectionTexture = null;
            }

            if (mat.emissiveTexture) {
                mat.emissiveTexture.dispose();
            }
            mat.emissiveTexture = buildGradientTexture(
                new Color3(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2]),
                new Color3(state.skyColorMid[0], state.skyColorMid[1], state.skyColorMid[2]),
                new Color3(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2]),
                state.skyBrightness,
                state.sunAngle,
                state.starsEnabled
            );
            return;
        }
        disposeSky();
        createProceduralSky(state);
        return;
    }

    disposeSky();
    if (state.skyTexture) {
        loadEnvTexture(state.skyTexture, state.skyRotationY, state.envIntensity);
    }
}

// ======== Ground ========
let _currentGroundKey: string = '';

function applyCheckerGround(ground: Mesh, state: EnvState): void {
    const scene = getScene();
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const tileSize = 16;
    for (let y = 0; y < 128; y += tileSize) {
        for (let x = 0; x < 128; x += tileSize) {
            const isWhite = (x / tileSize + y / tileSize) % 2 === 0;
            const bright = isWhite ? 1 : 0.6;
            const r = Math.round(state.groundColor[0] * bright * 255);
            const g = Math.round(state.groundColor[1] * bright * 255);
            const b = Math.round(state.groundColor[2] * bright * 255);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }
    const tex = new Texture(canvas.toDataURL(), scene);
    const mat = new StandardMaterial('envGroundChecker', scene);
    mat.diffuseTexture = tex;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;
}

export function applyGround(state: EnvState): void {
	const scene = getScene();

	const typeKey = state.groundTextureEnabled && state.groundTexture
		? `texture:${state.groundTexture}`
		: `mode:${state.groundMode}`;
	const keyChanged = typeKey !== _currentGroundKey;

	// 地面已存在、可见、类型未变 → 原地更新颜色/透明度/纹理缩放
	if (_envSys.ground.mesh && state.groundVisible && !keyChanged) {
        const mat = _envSys.ground.mesh.material;
        if (mat) {
            if (mat instanceof GridMaterial) {
                mat.mainColor = new Color3(
                    state.groundColor[0],
                    state.groundColor[1],
                    state.groundColor[2]
                );
                mat.lineColor = new Color3(
                    state.groundColor[0] * 1.5,
                    state.groundColor[1] * 1.5,
                    state.groundColor[2] * 1.5
                );
            } else if (mat instanceof StandardMaterial) {
                mat.diffuseColor = new Color3(
                    state.groundColor[0],
                    state.groundColor[1],
                    state.groundColor[2]
                );
                mat.alpha = state.groundAlpha;
                if (mat.diffuseTexture && mat.diffuseTexture instanceof Texture) {
                    (mat.diffuseTexture as Texture).uScale = (mat.diffuseTexture as Texture).vScale = 1 / Math.max(0.1, state.groundTextureScale);
                }
            }
        }
        return;
    }

    _currentGroundKey = typeKey;
    if (_envSys.ground.mesh) {
        _envSys.ground.mesh.dispose();
        _envSys.ground.mesh = null;
    }
    if (!state.groundVisible) {
        return;
    }

    const ground = MeshBuilder.CreateGround(
        'envGround',
        {
            width: 60,
            height: 60,
            subdivisions: 2,
        },
        scene
    );
    ground.isPickable = false;
    ground.position.y = -0.05;

    if (state.groundMode === 'grid') {
        const mat = new GridMaterial('envGroundMat', scene);
        mat.gridRatio = 1;
        mat.mainColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2]
        );
        mat.lineColor = new Color3(
            state.groundColor[0] * 1.5,
            state.groundColor[1] * 1.5,
            state.groundColor[2] * 1.5
        );
        mat.backFaceCulling = false;
        ground.material = mat;
    } else if (state.groundMode === 'checker') {
        applyCheckerGround(ground, state);
    } else if (state.groundTextureEnabled && state.groundTexture) {
        // 纹理地面：subdivisions 保持 2（性能），纹理重复由 uScale/vScale 控制
        const tex = new Texture(resolveStaticAsset(state.groundTexture), scene);
        tex.uScale = tex.vScale = 1 / Math.max(0.1, state.groundTextureScale);
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseTexture = tex;
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    } else {
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2]
        );
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    }

    _envSys.ground.mesh = ground;
}

// ======== Env Update Observer (wind, sky rotation, underwater) ========
let _envUpdateObserver: Observer<Scene> | null = null;
let _prevParticleEnabled = true; // 用于检测 particleEnabled 变化
let _prevSplash = false; // 用于检测 particleSplash 变化
let _prevCustomTexture = ''; // 用于检测 particleCustomTexture 变化

export function ensureEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        return;
    }
    _envUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        // dt 以秒为单位，确保不同帧率下动画速度一致
        const dt = scene.deltaTime / 1000;
        // Cloud drift + camera follow
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
                        // 对偏移取模 1.0，防止长时间运行后浮点精度退化
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
        // 动态更新粒子风力（响应运行时参数变化）
        updateParticleWind();
        // 动态更新粒子参数（密度/大小/速度滑条）
        updateParticleParams();

        // 自动启停粒子系统（检测 particleEnabled 状态变化）
        if (_prevParticleEnabled !== envState.particleEnabled) {
            _prevParticleEnabled = envState.particleEnabled;
            if (!envState.particleEnabled && _envSys.particles.system) {
                disposeParticles();
                disposeSplash(); // 粒子关闭时也关闭溅射
            } else if (
                envState.particleEnabled &&
                !_envSys.particles.system &&
                getCurrentParticleType() !== 'none'
            ) {
                createParticleEmitter(getCurrentParticleType(), envState.windEnabled);
            }
        }

        // 同步溅射状态（检测 particleSplash 或粒子类型变化）
        if (_prevSplash !== envState.particleSplash) {
            _prevSplash = envState.particleSplash;
            syncSplashState();
        }

        // 自定义粒子纹理变化检测
        if (_prevCustomTexture !== envState.particleCustomTexture) {
            _prevCustomTexture = envState.particleCustomTexture ?? '';
            if (_envSys.particles.system) {
                updateParticleTexture();
            }
        }

        // Sky rotation animation
        if (envState.skyRotationSpeed > 0.001 && _envSys.sky.skyMesh) {
            _envSys.sky.skyMesh.rotation.y += envState.skyRotationSpeed * 0.6 * dt;
            if (_envSys.sky.skyMesh.rotation.y > Math.PI * 2) {
                _envSys.sky.skyMesh.rotation.y -= Math.PI * 2;
            } else if (_envSys.sky.skyMesh.rotation.y < -Math.PI * 2) {
                _envSys.sky.skyMesh.rotation.y += Math.PI * 2;
            }
        }
        // Water wave direction is embedded in Gerstner wave shader — no per-frame wind update needed
        // Underwater post-processing (delegated to water module)
        updateUnderwaterTransition(scene, pipeline);
        // Call all registered scene tick callbacks (e.g., time-of-day from bridge module)
        for (const cb of _sceneTickCallbacks) {
            cb();
        }
    });
}

export function disposeEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        scene.onBeforeRenderObservable.remove(_envUpdateObserver);
        _envUpdateObserver = null;
    }
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
                console.warn(`[env] unknown fogMode "${fogMode}", falling back to exp2`);
                scene.fogMode = Scene.FOGMODE_EXP2;
                scene.fogDensity = state.fogDensity;
                break;
        }
        scene.fogColor = new Color3(state.fogColor[0], state.fogColor[1], state.fogColor[2]);
    } else {
        scene.fogMode = Scene.FOGMODE_NONE;
    }
}
