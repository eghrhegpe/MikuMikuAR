// scene-env-impl.ts — Environment System Implementation (Phase 8)
// All functions use module-level _scene / _pipeline injected by scene.ts
// Import this file via scene-env.ts (Facade), never import directly.

import { Scene, Color3, Color4, Vector2, Vector3, Texture, BaseTexture, StandardMaterial, GPUParticleSystem, Observer, ParticleSystem, ShadowGenerator, CubeTexture, Constants, DefaultRenderingPipeline, Mesh, MeshBuilder, Effect, ShaderMaterial, PostProcess, DirectionalLight } from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { EnvState, envState } from "../core/config";

// ======== Sun angle state (moved from scene.ts) ========
let _envSunAngle = 45; // default sun elevation

export function getEnvSunAngle(): number {
    return _envSunAngle;
}

export function setEnvSunAngle(deg: number): void {
    _envSunAngle = Math.max(-15, Math.min(90, deg));
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
    if (!_scene) throw new Error("[scene-env-impl] Scene not initialized");
    return _scene;
}

export function getPipeline(): DefaultRenderingPipeline {
    if (!_pipeline) throw new Error("[scene-env-impl] Pipeline not initialized");
    return _pipeline;
}

// ======== Module-level state ========
interface EnvSkyResources {
    skyMesh: Mesh | null;
    envTexture: BaseTexture | null;
}

export { createWater, disposeWater, refreshWaterRenderList, addRipple, clearRipples, updateWaterAnimSpeed, _underwaterActive, _underwaterSavedFog, _underwaterTransitionProgress, _underwaterTarget } from "./scene-env-water";
export { createClouds, disposeClouds } from "./scene-env-clouds";
export { createParticleEmitter, disposeParticles, applyWindToParticles } from "./scene-env-particles";
import { updateUnderwaterTransition, resetUnderwaterState } from "./scene-env-water";

export const _envSys: {
    sky: EnvSkyResources;
    ground: { mesh: Mesh | null };
    particles: { emitter: GPUParticleSystem | null; followObserver: Observer<Scene> | null };
    clouds: { postProcess: Mesh | null; postProcess2: Mesh | null; material: StandardMaterial | null; texture: Texture | null };
    water: { mesh: Mesh | null; material: ShaderMaterial | null };
    shadow: { generator: ShadowGenerator | null };
} = {
    sky: { skyMesh: null, envTexture: null },
    ground: { mesh: null },
    particles: { emitter: null, followObserver: null },
    clouds: { postProcess: null, postProcess2: null, material: null, texture: null },
    water: { mesh: null, material: null },
    shadow: { generator: null },
};


// ======== Sky ========
export function disposeSky(): void {
    const scene = getScene();
    if (_envSys.sky.skyMesh) {
        _envSys.sky.skyMesh.dispose();
        _envSys.sky.skyMesh = null;
    }
    if (_envSys.sky.envTexture) {
        _envSys.sky.envTexture.dispose();
        _envSys.sky.envTexture = null;
        scene.environmentTexture = null;
    }
    disposeSunDisc();
}

function disposeSunDisc(): void {
    const scene = getScene();
    const old = scene.getMeshByName("envSunDisc");
    if (old) old.dispose();
}

function buildGradientTexture(top: Color3, mid: Color3, bot: Color3, brightness: number, sunAngle: number = 45, starsEnabled: boolean = false): Texture {
    const scene = getScene();
    const W = 256, H = 256;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const scale = (c: Color3) => `rgb(${c.r*brightness*255|0},${c.g*brightness*255|0},${c.b*brightness*255|0})`;
    grad.addColorStop(0, scale(bot));
    grad.addColorStop(0.35, scale(bot));
    grad.addColorStop(0.5, scale(mid));
    grad.addColorStop(0.65, scale(top));
    grad.addColorStop(1, scale(top));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const sunY = 128 - sunAngle * (256 / 180);
    const sunX = W / 2;

    if (sunAngle > -5) {
        const glowRadius = sunAngle > 60 ? 50 : sunAngle > 20 ? 65 : 80;
        const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowRadius);
        glow.addColorStop(0, "rgba(255,255,240,0.95)");
        glow.addColorStop(0.08, "rgba(255,255,220,0.85)");
        glow.addColorStop(0.2, "rgba(255,245,200,0.5)");
        glow.addColorStop(0.4, "rgba(255,235,170,0.18)");
        glow.addColorStop(0.7, "rgba(255,220,140,0.04)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(sunX - glowRadius, sunY - glowRadius, glowRadius * 2, glowRadius * 2);
    }

    if (starsEnabled) {
        const starAlpha = sunAngle > 10 ? 0 : sunAngle < -5 ? 1 : (10 - sunAngle) / 15;
        if (starAlpha > 0.01) {
            const starSeed = 12345;
            const hash = (i: number) => { let h = (i * 2654435761 + starSeed) | 0; h ^= h >>> 13; return (h & 0x7fffffff) / 0x7fffffff; };
            const starCount = Math.round(200 + starAlpha * 100);
            for (let i = 0; i < starCount; i++) {
                const sx = hash(i * 3) * W;
                const sy = hash(i * 3 + 1) * H * 0.55;
                const sr = 0.5 + hash(i * 3 + 2) * 2.0;
                const sa = starAlpha * (0.3 + hash(i + 1000) * 0.7);
                const twinkle = 0.7 + hash(i + 2000) * 0.3;
                const r = 220 + hash(i + 3000) * 35 | 0;
                const g = 210 + hash(i + 4000) * 45 | 0;
                const b = 200 + hash(i + 5000) * 55 | 0;
                ctx.fillStyle = `rgba(${r},${g},${b},${(sa * twinkle).toFixed(2)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    const tex = new Texture("data:" + canvas.toDataURL("image/png"), scene, false);
    tex.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    tex.hasAlpha = false;
    return tex;
}

function createProceduralSky(state: EnvState): void {
    const scene = getScene();
    const sphere = MeshBuilder.CreateSphere("envSkySphere", {
        diameter: 1000,
        segments: 24,
        sideOrientation: Mesh.BACKSIDE,
    }, scene);
    sphere.isPickable = false;

    const mat = new StandardMaterial("envSkyMat", scene);
    mat.emissiveTexture = buildGradientTexture(
        new Color3(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2]),
        new Color3(state.skyColorMid[0], state.skyColorMid[1], state.skyColorMid[2]),
        new Color3(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2]),
        state.skyBrightness,
        getEnvSunAngle(),
        state.starsEnabled,
    );
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;
    scene.clearColor = new Color4(0, 0, 0, 1);
}

function loadEnvTexture(path: string, rotationY: number, intensity: number): void {
    const scene = getScene();
    const ext = path.split(".").pop()?.toLowerCase();
    const supported = ["hdr", "dds", "exr"];
    if (!supported.includes(ext ?? "")) {
        console.warn(`[sky] unsupported format .${ext}, falling back to procedural`);
        disposeSky();
        createProceduralSky(envState);
        return;
    }

    const cubeTex = new CubeTexture(path, scene);
    cubeTex.rotationY = rotationY;
    scene.environmentTexture = cubeTex;
    scene.environmentIntensity = intensity;
    scene.clearColor = new Color4(0, 0, 0, 1);
    _envSys.sky.envTexture = cubeTex;

    const sphere = MeshBuilder.CreateSphere("envSkyDome", {
        diameter: 1000, segments: 24, sideOrientation: Mesh.BACKSIDE,
    }, scene);
    sphere.isPickable = false;
    const mat = new StandardMaterial("envSkyDomeMat", scene);
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
    if (state.skyMode === "color") {
        disposeSky();
        scene.clearColor = new Color4(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2], 1);
        return;
    }

    const mesh = _envSys.sky.skyMesh;

    if (state.skyMode === "procedural") {
        if (mesh?.material?.getClassName() === "StandardMaterial") {
            const mat = mesh.material as StandardMaterial;
            if (mat.emissiveTexture) {
                mat.emissiveTexture.dispose();
            }
            mat.emissiveTexture = buildGradientTexture(
                new Color3(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2]),
                new Color3(state.skyColorMid[0], state.skyColorMid[1], state.skyColorMid[2]),
                new Color3(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2]),
                state.skyBrightness,
                getEnvSunAngle(),
                state.starsEnabled,
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
function applyCheckerGround(ground: Mesh, state: EnvState): void {
    const scene = getScene();
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const tileSize = 16;
    for (let y = 0; y < 128; y += tileSize) {
        for (let x = 0; x < 128; x += tileSize) {
            const isWhite = ((x / tileSize) + (y / tileSize)) % 2 === 0;
            const bright = isWhite ? 1 : 0.6;
            const r = Math.round(state.groundColor[0] * bright * 255);
            const g = Math.round(state.groundColor[1] * bright * 255);
            const b = Math.round(state.groundColor[2] * bright * 255);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }
    const tex = new Texture(canvas.toDataURL(), scene);
    const mat = new StandardMaterial("envGroundChecker", scene);
    mat.diffuseTexture = tex;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;
}

export function applyGround(state: EnvState): void {
    const scene = getScene();

    // 如果地面已存在且可见，直接更新颜色/透明度，不重建网格和材质
    if (_envSys.ground.mesh && state.groundVisible) {
        const mat = _envSys.ground.mesh.material;
        if (mat) {
            if (mat instanceof StandardMaterial) {
                mat.diffuseColor = new Color3(state.groundColor[0], state.groundColor[1], state.groundColor[2]);
            }
            mat.alpha = state.groundAlpha;
        }
        return;
    }

    if (_envSys.ground.mesh) {
        _envSys.ground.mesh.dispose();
        _envSys.ground.mesh = null;
    }
    if (!state.groundVisible) return;

    const ground = MeshBuilder.CreateGround("envGround", {
        width: 60,
        height: 60,
        subdivisions: 2,
    }, scene);
    ground.isPickable = false;
    ground.position.y = -0.05;

    if (state.groundMode === "grid") {
        const mat = new GridMaterial("envGroundMat", scene);
        mat.gridRatio = 1;
        mat.mainColor = new Color3(state.groundColor[0], state.groundColor[1], state.groundColor[2]);
        mat.lineColor = new Color3(state.groundColor[0] * 1.5, state.groundColor[1] * 1.5, state.groundColor[2] * 1.5);
        mat.backFaceCulling = false;
        ground.material = mat;
    } else if (state.groundMode === "checker") {
        applyCheckerGround(ground, state);
    } else {
        const mat = new StandardMaterial("envGroundMat", scene);
        mat.diffuseColor = new Color3(state.groundColor[0], state.groundColor[1], state.groundColor[2]);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    }

    _envSys.ground.mesh = ground;
}



// ======== Env Update Observer (wind, sky rotation, underwater) ========
let _envUpdateObserver: Observer<Scene> | null = null;

export function ensureEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) return;
    _envUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.deltaTime / 16.667;
        // Cloud drift + camera follow
        if (envState.cloudsEnabled && _envSys.clouds.postProcess) {
            const cam = scene.activeCamera;
            const dx = envState.windEnabled ? envState.windDirection[0] * envState.windSpeed * 0.005 * dt : 0;
            const dz = envState.windEnabled ? envState.windDirection[2] * envState.windSpeed * 0.005 * dt : 0;
            for (const key of ["postProcess", "postProcess2"] as const) {
                const m = _envSys.clouds[key];
                if (m) {
                    const speedMul = key === "postProcess2" ? 0.7 : 1.0;
                    if (cam) {
                        m.position.x = cam.position.x;
                        m.position.z = cam.position.z;
                    }
                    const mat = m.material as StandardMaterial | null;
                    if (mat?.diffuseTexture) {
                        (mat.diffuseTexture as Texture).uOffset += dx * speedMul;
                        (mat.diffuseTexture as Texture).vOffset += dz * speedMul;
                    }
                }
            }
        }
        // Sky rotation animation
        if (envState.skyRotationSpeed > 0.001 && _envSys.sky.skyMesh) {
            _envSys.sky.skyMesh.rotation.y += envState.skyRotationSpeed * 0.01 * dt;
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
        for (const cb of _sceneTickCallbacks) cb();
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
        scene.fogMode = Scene.FOGMODE_EXP2;
        scene.fogColor = new Color3(state.fogColor[0], state.fogColor[1], state.fogColor[2]);
        scene.fogDensity = state.fogDensity;
    } else {
        scene.fogMode = Scene.FOGMODE_NONE;
    }
}

