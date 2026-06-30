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

// ======== Injected dependencies (set by scene.ts on init) ========
let _scene: Scene | null = null;
let _pipeline: DefaultRenderingPipeline | null = null;

export function initEnvImpl(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _scene = scene;
    _pipeline = pipeline;
}

function getScene(): Scene {
    if (!_scene) throw new Error("[scene-env-impl] Scene not initialized");
    return _scene;
}

function getPipeline(): DefaultRenderingPipeline {
    if (!_pipeline) throw new Error("[scene-env-impl] Pipeline not initialized");
    return _pipeline;
}

// ======== Module-level state ========
interface EnvSkyResources {
    skyMesh: Mesh | null;
    envTexture: BaseTexture | null;
}

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

// === LOD 水面：记录所有 LOD 子网格，用于同步缩放和位置 ===
let _waterLODs: Mesh[] = [];

// === 每帧更新水面的 observer ===
let _waterUpdateObserver: Observer<Scene> | null = null;

// ======== 涟漪系统（Interaction Ripples）========
const MAX_RIPPLES = 8;
interface RippleSource {
    position: Vector3;
    radius: number;
    strength: number;
    speed: number;
    life: number;      // 剩余秒数
    maxLife: number;
}
let _ripples: RippleSource[] = [];
let _rippleDirty = true;

export function addRipple(pos: Vector3, radius = 5, strength = 0.5, speed = 2, maxLife = 3): void {
    let idx = -1;
    let oldestLife = Infinity;
    for (let i = 0; i < _ripples.length; i++) {
        if (_ripples[i].life <= 0) { idx = i; break; }
        if (_ripples[i].life < oldestLife) { oldestLife = _ripples[i].life; idx = i; }
    }
    if (idx === -1 && _ripples.length < MAX_RIPPLES) {
        idx = _ripples.length;
        _ripples.push({ position: new Vector3(0, 0, 0), radius: 0, strength: 0, speed: 0, life: 0, maxLife: 0 });
    }
    if (idx === -1) return;
    const r = _ripples[idx];
    r.position.copyFrom(pos);
    r.radius = Math.max(0.1, radius);
    r.strength = Math.max(0, Math.min(1, strength));
    r.speed = Math.max(0.1, speed);
    r.life = maxLife > 0 ? maxLife : 9999;
    r.maxLife = maxLife;
    _rippleDirty = true;
}

export function clearRipples(): void {
    _ripples = [];
    _rippleDirty = true;
}

// ======== 焦散系统（静态纹理 + UV 滚动）========
let _causticTexture: Texture | null = null;
const CAUSTIC_TEX_SIZE = 128;

function ensureCausticTexture(scene: Scene): Texture {
    if (_causticTexture) return _causticTexture;
    const S = CAUSTIC_TEX_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(S, S);
    const data = imgData.data;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const u = x / S, v = y / S;
            // 3-octave sinusoidal noise — light concentration pattern
            let n = 0, total = 0, amp = 1, freq = 4;
            for (let o = 0; o < 3; o++) {
                n += amp * (Math.sin(u * freq * Math.PI) * Math.cos(v * freq * Math.PI));
                total += amp;
                amp *= 0.5;
                freq *= 2;
            }
            n = n / total * 0.5 + 0.5;
            const i = (y * S + x) * 4;
            const val = Math.floor(128 + (n - 0.5) * 128);
            data[i] = val; data[i + 1] = val; data[i + 2] = val; data[i + 3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    const tex = new Texture(canvas.toDataURL(), scene, false, false);
    tex.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
    tex.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE;
    _causticTexture = tex;
    return tex;
}

// ======== Custom Water Shader — Gerstner Waves + Foam ========
const WATER_VERT_SRC = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform float waveHeight;
uniform float waveSpeed;

varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

void main() {
    vUV = uv;
    vec3 worldPos = (world * vec4(position, 1.0)).xyz;
    vec3 p = worldPos;
    vec3 n = vec3(0.0, 1.0, 0.0);

    // 4 Gerstner waves with hardcoded directions
    { // Wave 1
        vec2 dir = normalize(vec2(0.8, 0.6));
        float f = 0.15, a = 0.3 * waveHeight;
        float th = f * dot(dir, p.xz) + 0.7 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }
    { // Wave 2
        vec2 dir = normalize(vec2(-0.3, 0.9));
        float f = 0.2, a = 0.25 * waveHeight;
        float th = f * dot(dir, p.xz) + 0.9 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }
    { // Wave 3
        vec2 dir = normalize(vec2(-0.7, -0.5));
        float f = 0.25, a = 0.2 * waveHeight;
        float th = f * dot(dir, p.xz) + 0.5 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }
    { // Wave 4
        vec2 dir = normalize(vec2(0.5, -0.8));
        float f = 0.3, a = 0.15 * waveHeight;
        float th = f * dot(dir, p.xz) + 1.2 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }

    vWorldPos = p;
    vNormal = normalize(n);
    vHeight = p.y;
    gl_Position = viewProjection * vec4(p, 1.0);
}`;

const WATER_FRAG_SRC = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

uniform vec3 cameraPosition;
uniform vec3 waterColor;
uniform float waterTransparency;
uniform float waterLevel;
uniform float time;
uniform float envIntensity;
uniform vec3 foamColor;
uniform float foamThreshold;
uniform float foamIntensity;
uniform vec3 fogColor;
uniform float fogDensity;
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform float ambientIntensity;

uniform sampler2D uCausticTex;
uniform float uCausticIntensity;
uniform float uCausticSpeed;
uniform float uCausticScale;

uniform vec4 uRipplePosRad[8];
uniform vec4 uRippleStrSpdLife[8];
uniform int uRippleCount;

float calcRipple(vec3 worldPos, vec3 center, float radius, float strength, float speed, float life) {
    vec2 delta = worldPos.xz - center.xz;
    float dist = length(delta);
    if (dist > radius || life <= 0.0) return 0.0;
    float phase = life * speed;
    float ripple = sin(dist * 3.0 - phase) * exp(-dist / (radius * 0.5));
    ripple *= strength * (1.0 - dist / radius);
    float lifeFactor = min(1.0, life / 1.0);
    ripple *= lifeFactor;
    return max(0.0, ripple);
}

#ifdef ENV_TEXTURE
uniform samplerCube envTexture;
#endif

void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 normal = normalize(vNormal);
    vec3 reflectDir = reflect(-viewDir, normal);

    // Reflection from environment cube map
    vec3 reflection = vec3(0.0);
    #ifdef ENV_TEXTURE
    reflection = textureCube(envTexture, reflectDir).rgb * envIntensity;
    #endif

    // Fresnel (Schlick)
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

    // Base water color
    vec3 base = waterColor;
    vec3 color = mix(base, reflection, fresnel);

    // Simple diffuse lighting
    float diff = max(dot(normal, normalize(lightDir)), 0.0);
    color += diff * lightColor * 0.15;
    color += ambientIntensity * waterColor * 0.15;

    // Foam at wave crests
    float foamH = vHeight - waterLevel;
    float foam = smoothstep(foamThreshold, foamThreshold + 0.15, foamH);
    foam = clamp(foam, 0.0, 1.0);
    color = mix(color, foamColor, foam * foamIntensity);

    // Interaction ripples: stack all active ripple sources
    float rippleSum = 0.0;
    for (int i = 0; i < 8; i++) {
        if (i >= uRippleCount) break;
        vec4 pr = uRipplePosRad[i];
        vec4 ssl = uRippleStrSpdLife[i];
        if (pr.w <= 0.0 || ssl.z <= 0.0) continue;
        float r = calcRipple(vWorldPos, pr.xyz, pr.w, ssl.x, ssl.y, ssl.z);
        rippleSum += r;
    }
    // Perturb normal for ripple lighting, and add a brightness glint
    vec3 rippleN = vec3(rippleSum * 0.15, 0.0, rippleSum * 0.15);
    normal = normalize(normal + rippleN);
    float rippleGlint = max(0.0, rippleSum * 0.25);
    color += vec3(rippleGlint);

    // Caustics — UV-scrolling noise texture
    vec2 causticUV = vWorldPos.xz * uCausticScale + vec2(time * uCausticSpeed * 0.10, time * uCausticSpeed * 0.15);
    float caustic = texture2D(uCausticTex, causticUV).r;
    vec3 causticCol = mix(vec3(1.0, 0.9, 0.6), vec3(1.0, 1.0, 0.8), caustic);
    color += causticCol * caustic * uCausticIntensity;

    // Exponential fog
    float depth = length(vWorldPos - cameraPosition);
    float fog = 1.0 - exp(-fogDensity * depth);
    color = mix(color, fogColor, fog);

    // Alpha
    float alpha = mix(waterTransparency, 1.0, fresnel * 0.5 + foam * 0.2);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
}`;

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

// ======== Water System ========

export function createWater(state: EnvState): void {
    // 确保水下检测 observer 已注册（不再依赖云层）
    ensureEnvUpdateObserver();

    // early-return: update existing water params, don't rebuild
    if (_envSys.water.mesh && _envSys.water.material) {
        const mat = _envSys.water.material as ShaderMaterial;
        const wm = _envSys.water.mesh;
        wm.position.y = state.waterLevel;
        for (const lod of _waterLODs) {
            lod.position.y = state.waterLevel;
        }
        mat.setFloat("waveHeight", state.waterWaveHeight);
        mat.setFloat("waveSpeed", (state.waterAnimSpeed ?? 1) * 1.0);
        mat.setColor3("waterColor", new Color3(state.waterColor[0], state.waterColor[1], state.waterColor[2]));
        mat.setFloat("waterTransparency", state.waterTransparency);
        mat.setFloat("waterLevel", state.waterLevel);
        mat.setFloat("foamThreshold", state.foamThreshold);
        mat.setFloat("foamIntensity", state.foamIntensity);
        const newSize = Math.max(1, state.waterSize);
        const scale = newSize / 60;
        if (wm.scaling.x !== scale) {
            wm.scaling.x = scale; wm.scaling.z = scale;
            for (const lod of _waterLODs) {
                lod.scaling.x = scale; lod.scaling.z = scale;
            }
        }
        return;
    }

    const scene = getScene();
    disposeWater();
    if (!state.waterEnabled) return;

    _waterLODs = [];
    const size = Math.max(1, state.waterSize);

    // --- 3 级 LOD 水面网格 ---
    const meshHigh = MeshBuilder.CreateGround("envWater", { width: size, height: size, subdivisions: 48 }, scene);
    meshHigh.isPickable = false;
    meshHigh.position.y = state.waterLevel;

    const meshMid = MeshBuilder.CreateGround("envWater_LOD1", { width: size, height: size, subdivisions: 16 }, scene);
    meshMid.isPickable = false;
    meshMid.position.y = state.waterLevel;

    const meshLow = MeshBuilder.CreateGround("envWater_LOD2", { width: size, height: size, subdivisions: 6 }, scene);
    meshLow.isPickable = false;
    meshLow.position.y = state.waterLevel;

    meshHigh.addLODLevel(30, meshMid);
    meshHigh.addLODLevel(80, meshLow);
    _waterLODs = [meshMid, meshLow];

    // --- 自定义 ShaderMaterial：Gerstner 波 + 泡沫 + 菲涅尔 ---
    const hasEnv = !!scene.environmentTexture;
    const mat = new ShaderMaterial("customWaterMat", scene, {
        vertexSource: WATER_VERT_SRC,
        fragmentSource: WATER_FRAG_SRC,
    }, {
        attributes: ["position", "uv", "normal"],
        uniforms: [
            "world", "viewProjection", "time", "waveHeight", "waveSpeed",
            "cameraPosition", "waterColor", "waterTransparency", "waterLevel",
            "envIntensity", "foamColor", "foamThreshold", "foamIntensity",
            "fogColor", "fogDensity", "lightDir", "lightColor", "ambientIntensity",
            "uRipplePosRad", "uRippleStrSpdLife", "uRippleCount",
            "uCausticIntensity", "uCausticSpeed", "uCausticScale",
        ],
        uniformBuffers: [],
        samplers: ["uCausticTex"].concat(hasEnv ? ["envTexture"] : []),
        defines: hasEnv ? ["ENV_TEXTURE"] : [],
        needAlphaBlending: true,
    });

    mat.setFloat("waveHeight", state.waterWaveHeight);
    mat.setFloat("waveSpeed", (state.waterAnimSpeed ?? 1) * 1.0);
    mat.setColor3("waterColor", new Color3(state.waterColor[0], state.waterColor[1], state.waterColor[2]));
    mat.setFloat("waterTransparency", state.waterTransparency);
    mat.setFloat("waterLevel", state.waterLevel);
    mat.setFloat("envIntensity", hasEnv ? (scene.environmentIntensity ?? 0.8) : 0);

    if (hasEnv && scene.environmentTexture) {
        mat.setTexture("envTexture", scene.environmentTexture);
    }

    // Foam
    mat.setColor3("foamColor", new Color3(1, 1, 1));
    mat.setFloat("foamThreshold", state.foamThreshold);
    mat.setFloat("foamIntensity", state.foamIntensity);

    // Lighting
    const dirLight = scene.getLightByName("dir") as DirectionalLight | null;
    if (dirLight) {
        mat.setVector3("lightDir", dirLight.direction);
        mat.setColor3("lightColor", dirLight.diffuse);
    } else {
        mat.setVector3("lightDir", new Vector3(-0.5, -1, -0.5));
        mat.setColor3("lightColor", new Color3(1, 1, 1));
    }
    mat.setFloat("ambientIntensity", 0.3);

    // Ripple uniforms (initialised empty)
    mat.setArray4("uRipplePosRad", new Array(MAX_RIPPLES * 4).fill(0));
    mat.setArray4("uRippleStrSpdLife", new Array(MAX_RIPPLES * 4).fill(0));
    mat.setInt("uRippleCount", 0);

    // Caustics
    const causticTex = ensureCausticTexture(scene);
    mat.setTexture("uCausticTex", causticTex);
    mat.setFloat("uCausticIntensity", 0.15);
    mat.setFloat("uCausticSpeed", 0.5);
    mat.setFloat("uCausticScale", 0.04);

    // Fog
    mat.setColor3("fogColor", scene.fogColor);
    mat.setFloat("fogDensity", scene.fogDensity);

    // Assign to all LOD meshes
    meshHigh.material = mat;
    meshMid.material = mat;
    meshLow.material = mat;

    _envSys.water.mesh = meshHigh;
    _envSys.water.material = mat;

    // Per-frame observer: time, camera position, fog/light sync, ripples
    if (!_waterUpdateObserver) {
        _waterUpdateObserver = scene.onBeforeRenderObservable.add(() => {
            if (!_envSys.water.material) return;
            const m = _envSys.water.material as ShaderMaterial;
            const now = performance.now() / 1000;
            m.setFloat("time", now);
            const cam = scene.activeCamera;
            if (cam) m.setVector3("cameraPosition", cam.position);
            // Sync fog & light changes
            m.setColor3("fogColor", scene.fogColor);
            m.setFloat("fogDensity", scene.fogDensity);
            const dl = scene.getLightByName("dir") as DirectionalLight | null;
            if (dl) {
                m.setVector3("lightDir", dl.direction);
                m.setColor3("lightColor", dl.diffuse);
            }

            // --- Ripple lifecycle ---
            const dt = scene.deltaTime / 1000;
            if (dt > 0) {
                let anyAlive = false;
                for (const r of _ripples) {
                    if (r.life > 0) {
                        r.life -= dt;
                        if (r.life < 0) r.life = 0;
                        if (r.life > 0) anyAlive = true;
                    }
                }
                if (!anyAlive && _ripples.length > 0) {
                    _ripples = [];
                    _rippleDirty = true;
                }
            }
            if (_rippleDirty) {
                _rippleDirty = false;
                const posRad: number[] = new Array(MAX_RIPPLES * 4).fill(0);
                const strSpdLife: number[] = new Array(MAX_RIPPLES * 4).fill(0);
                const count = Math.min(_ripples.length, MAX_RIPPLES);
                for (let i = 0; i < count; i++) {
                    const r = _ripples[i];
                    if (r.life <= 0) continue;
                    posRad[i * 4 + 0] = r.position.x;
                    posRad[i * 4 + 1] = r.position.y;
                    posRad[i * 4 + 2] = r.position.z;
                    posRad[i * 4 + 3] = r.radius;
                    strSpdLife[i * 4 + 0] = r.strength;
                    strSpdLife[i * 4 + 1] = r.speed;
                    strSpdLife[i * 4 + 2] = r.life;
                    strSpdLife[i * 4 + 3] = 0;
                }
                m.setArray4("uRipplePosRad", posRad);
                m.setArray4("uRippleStrSpdLife", strSpdLife);
                m.setInt("uRippleCount", count);
            }
        });
    }
}

export function disposeWater(): void {
    if (_envSys.water.mesh) {
        _envSys.water.mesh.dispose(true);
        _envSys.water.mesh = null;
    }
    _waterLODs = [];
    if (_envSys.water.material) {
        _envSys.water.material.dispose();
        _envSys.water.material = null;
    }
    if (_waterUpdateObserver) {
        getScene().onBeforeRenderObservable.remove(_waterUpdateObserver);
        _waterUpdateObserver = null;
    }
    // 重置水下过渡状态，避免关水再开后 stale state 导致动画倒放
    _underwaterActive = false;
    _underwaterSavedFog = null;
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
}

export function refreshWaterRenderList(): void {
    // ShaderMaterial does not use RTT render list — no-op
}

// ======== Particle System ========
let _currentParticleType: EnvState["particleType"] = "none";
const _particleTextures = new Map<string, Texture>();

function makeParticleTexture(kind: string): Texture {
    const scene = getScene();
    const cached = _particleTextures.get(kind);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    drawParticleShape(ctx, kind);
    const tex = new Texture(canvas.toDataURL(), scene, false, false);
    tex.hasAlpha = true;
    _particleTextures.set(kind, tex);
    return tex;
}

function drawParticleShape(ctx: CanvasRenderingContext2D, kind: string): void {
    ctx.clearRect(0, 0, 64, 64);
    const cx = 32, cy = 32;
    switch (kind) {
        case "sakura": {
            ctx.fillStyle = "#ffb7c5";
            for (let i = 0; i < 5; i++) {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((i * Math.PI * 2) / 5);
                ctx.beginPath();
                ctx.ellipse(0, -15, 7, 13, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            ctx.fillStyle = "#ffe080";
            ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case "rain": {
            const grad = ctx.createLinearGradient(32, 6, 32, 58);
            grad.addColorStop(0, "rgba(180,210,255,0)");
            grad.addColorStop(0.5, "rgba(200,225,255,0.95)");
            grad.addColorStop(1, "rgba(220,235,255,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(30, 6, 4, 52);
            break;
        }
        case "snow": {
            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            for (let i = 0; i < 6; i++) {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((i * Math.PI) / 3);
                ctx.beginPath();
                ctx.moveTo(0, 0); ctx.lineTo(0, -24);
                ctx.moveTo(0, -15); ctx.lineTo(-5, -21);
                ctx.moveTo(0, -15); ctx.lineTo(5, -21);
                ctx.stroke();
                ctx.restore();
            }
            break;
        }
        case "fireworks": {
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30);
            grad.addColorStop(0, "rgba(255,240,180,1)");
            grad.addColorStop(0.3, "rgba(255,200,100,0.6)");
            grad.addColorStop(1, "rgba(255,150,50,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            ctx.strokeStyle = "rgba(255,255,220,0.9)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, 4); ctx.lineTo(cx, 60);
            ctx.moveTo(4, cy); ctx.lineTo(60, cy);
            ctx.stroke();
            break;
        }
        case "fireflies": {
            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 28);
            grad.addColorStop(0, "rgba(210,255,130,1)");
            grad.addColorStop(0.4, "rgba(150,255,80,0.6)");
            grad.addColorStop(1, "rgba(100,200,50,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            break;
        }
        case "leaves": {
            ctx.fillStyle = "#c9742a";
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-0.3);
            ctx.beginPath();
            ctx.ellipse(0, 0, 9, 21, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#8a4a18";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -19); ctx.lineTo(0, 19);
            ctx.stroke();
            ctx.restore();
            break;
        }
    }
}

export function createParticleEmitter(type: EnvState["particleType"], windEnabled: boolean): void {
    if (_envSys.particles.emitter && _currentParticleType === type) return;

    if (_envSys.particles.emitter) {
        disposeParticles();
    }
    _currentParticleType = type;
    if (type === "none") return;

    const scene = getScene();

    const ps = new GPUParticleSystem("envParticles", { capacity: 5000 }, scene);
    ps.particleTexture = makeParticleTexture(type);
    ps.updateSpeed = 0.01;
    ps.emitter = new Vector3(0, 10, 0);

    switch (type) {
        case "sakura": {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 40;
            ps.gravity = new Vector3(0, -0.8, 0);
            ps.minLifeTime = 8; ps.maxLifeTime = 15;
            ps.minEmitPower = 0.5; ps.maxEmitPower = 1.5;
            ps.minAngularSpeed = -1; ps.maxAngularSpeed = 1;
            ps.minSize = 0.15; ps.maxSize = 0.35;
            ps.createBoxEmitter(
                new Vector3(-0.5, -0.2, -0.5), new Vector3(0.5, 0.2, 0.5),
                new Vector3(-12, 8, -12), new Vector3(12, 12, 12),
            );
            ps.addColorGradient(0, new Color4(1, 0.72, 0.78, 1), new Color4(1, 0.8, 0.85, 1));
            ps.addColorGradient(0.8, new Color4(1, 0.72, 0.78, 1), new Color4(1, 0.8, 0.85, 1));
            ps.addColorGradient(1, new Color4(1, 0.72, 0.78, 0), new Color4(1, 0.8, 0.85, 0));
            break;
        }
        case "rain": {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 1000;
            ps.gravity = new Vector3(0, -25, 0);
            ps.minLifeTime = 1; ps.maxLifeTime = 2;
            ps.minEmitPower = 15; ps.maxEmitPower = 20;
            ps.minSize = 0.1; ps.maxSize = 0.2;
            ps.createBoxEmitter(
                new Vector3(-0.1, -1, -0.1), new Vector3(0.1, -1, 0.1),
                new Vector3(-15, 12, -15), new Vector3(15, 15, 15),
            );
            ps.addColorGradient(0, new Color4(0.7, 0.8, 1, 0.6), new Color4(0.8, 0.9, 1, 0.8));
            ps.addColorGradient(1, new Color4(0.7, 0.8, 1, 0), new Color4(0.8, 0.9, 1, 0));
            break;
        }
        case "snow": {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 250;
            ps.gravity = new Vector3(0, -1.5, 0);
            ps.minLifeTime = 6; ps.maxLifeTime = 12;
            ps.minEmitPower = 0.3; ps.maxEmitPower = 0.8;
            ps.minAngularSpeed = -0.5; ps.maxAngularSpeed = 0.5;
            ps.minSize = 0.1; ps.maxSize = 0.25;
            ps.createBoxEmitter(
                new Vector3(-0.5, -0.3, -0.5), new Vector3(0.5, -0.3, 0.5),
                new Vector3(-15, 10, -15), new Vector3(15, 14, 15),
            );
            ps.addColorGradient(0, new Color4(1, 1, 1, 0.9), new Color4(1, 1, 1, 1));
            ps.addColorGradient(1, new Color4(1, 1, 1, 0), new Color4(1, 1, 1, 0));
            break;
        }
        case "fireworks": {
            ps.blendMode = ParticleSystem.BLENDMODE_ADD;
            ps.emitRate = 80;
            ps.gravity = new Vector3(0, -4, 0);
            ps.minLifeTime = 1.2; ps.maxLifeTime = 2.2;
            ps.minEmitPower = 6; ps.maxEmitPower = 10;
            ps.minSize = 0.15; ps.maxSize = 0.35;
            ps.createSphereEmitter(0.1);
            ps.addColorGradient(0, new Color4(1, 1, 0.6, 1), new Color4(1, 0.9, 0.4, 1));
            ps.addColorGradient(0.5, new Color4(1, 0.6, 0.2, 1), new Color4(1, 0.4, 0.1, 1));
            ps.addColorGradient(1, new Color4(1, 0.3, 0.1, 0), new Color4(0.8, 0.2, 0, 0));
            ps.addSizeGradient(0, 0.1, 0.2);
            ps.addSizeGradient(0.3, 0.3, 0.4);
            ps.addSizeGradient(1, 0.05, 0.1);
            break;
        }
        case "fireflies": {
            ps.blendMode = ParticleSystem.BLENDMODE_ADD;
            ps.emitRate = 15;
            ps.gravity = new Vector3(0, 0, 0);
            ps.minLifeTime = 4; ps.maxLifeTime = 8;
            ps.minEmitPower = 0.2; ps.maxEmitPower = 0.5;
            ps.minSize = 0.1; ps.maxSize = 0.2;
            ps.createSphereEmitter(8);
            ps.addColorGradient(0, new Color4(0.6, 1, 0.3, 0), new Color4(0.8, 1, 0.4, 0));
            ps.addColorGradient(0.3, new Color4(0.6, 1, 0.3, 1), new Color4(0.8, 1, 0.4, 1));
            ps.addColorGradient(0.6, new Color4(0.6, 1, 0.3, 0.2), new Color4(0.8, 1, 0.4, 0.2));
            ps.addColorGradient(1, new Color4(0.6, 1, 0.3, 1), new Color4(0.8, 1, 0.4, 1));
            break;
        }
        case "leaves": {
            ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
            ps.emitRate = 30;
            ps.gravity = new Vector3(0, -1, 0);
            ps.minLifeTime = 8; ps.maxLifeTime = 14;
            ps.minEmitPower = 0.5; ps.maxEmitPower = 1.5;
            ps.minAngularSpeed = -2; ps.maxAngularSpeed = 2;
            ps.minSize = 0.2; ps.maxSize = 0.4;
            ps.createBoxEmitter(
                new Vector3(-0.8, -0.3, -0.8), new Vector3(0.8, 0.3, 0.8),
                new Vector3(-12, 8, -12), new Vector3(12, 12, 12),
            );
            ps.addColorGradient(0, new Color4(0.9, 0.5, 0.2, 1), new Color4(0.8, 0.6, 0.1, 1));
            ps.addColorGradient(1, new Color4(0.9, 0.5, 0.2, 0), new Color4(0.8, 0.6, 0.1, 0));
            break;
        }
    }

    const er = envState.particleEmitRate;
    if (er !== 1) ps.emitRate = Math.max(0, ps.emitRate * er);

    const sz = envState.particleSize;
    if (sz !== 1) {
        ps.minSize *= sz;
        ps.maxSize *= sz;
    }

    const sp = envState.particleSpeed;
    if (sp !== 1) {
        ps.minEmitPower *= sp;
        ps.maxEmitPower *= sp;
    }

    if (windEnabled) {
        applyWindToParticles(ps);
    }

    _envSys.particles.followObserver = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (!cam) return;
        const e = ps.emitter as Vector3;
        if (!e) return;
        e.x = cam.position.x;
        e.z = cam.position.z;
        e.y = type === "fireflies" ? 2 : 11;
    });

    _envSys.particles.emitter = ps;
}

export function disposeParticles(): void {
    const scene = getScene();
    if (_envSys.particles.followObserver) {
        scene.onBeforeRenderObservable.remove(_envSys.particles.followObserver);
        _envSys.particles.followObserver = null;
    }
    if (_envSys.particles.emitter) {
        _envSys.particles.emitter.dispose();
        _envSys.particles.emitter = null;
    }
    _currentParticleType = "none";
}

// ======== Wind System ========
export function applyWindToParticles(ps: GPUParticleSystem): void {
    const dir = envState.windDirection;
    const speed = envState.windSpeed;
    const wind = new Vector3(dir[0] * speed * 0.1, dir[1] * speed * 0.1, dir[2] * speed * 0.1);
    ps.direction1 = ps.direction1.add(wind);
    ps.direction2 = ps.direction2.add(wind);
}

// ======== Clouds (Phase 8) ========
// Perlin noise permutation table — 模块级常量，只需创建一次
const _perlinPerm: number[] = (() => {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    return p.concat(p);
})();

function _perlinFade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function _perlinLerp(a: number, b: number, t: number): number { return a + t * (b - a); }
function _perlinGrad(hash: number, dx: number, dy: number): number {
    const h = hash & 3;
    return (h & 1 ? -dx : dx) + (h & 2 ? -dy : dy);
}

function perlin2(x: number, y: number): number {
    const perm = _perlinPerm;
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = _perlinFade(xf);
    const v = _perlinFade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    return _perlinLerp(
        _perlinLerp(_perlinGrad(aa, xf, yf), _perlinGrad(ba, xf - 1, yf), u),
        _perlinLerp(_perlinGrad(ab, xf, yf - 1), _perlinGrad(bb, xf - 1, yf - 1), u),
        v
    ) * 0.5 + 0.5;
}

function cloudNoise(x: number, y: number, cover: number): number {
    const v1 = perlin2(x * 0.02, y * 0.02);
    const v2 = perlin2(x * 0.04 + 10, y * 0.04 + 10) * 0.5;
    const n = v1 + v2;
    const threshold = cover * 0.8;
    const t = (n - threshold) / (1.0 - threshold);
    return Math.max(0, Math.min(1, t * t * (3 - 2 * t)));
}

// ======== Volumetric Cloud (ShaderMaterial-on-Sphere) ========
let _volCloudMesh: Mesh | null = null;
let _volCloudMat: ShaderMaterial | null = null;
let _volCloudObs: Observer<Scene> | null = null;

const VERT_SRC = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vWorldPos;
void main(){
    vec4 worldPos = world * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAG_SRC = `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 cameraPosition;
uniform float time;
uniform float cloudDensity;
uniform vec3 windDirection;
uniform float cloudBaseY;
uniform float cloudTopY;
uniform float cloudScale;
uniform float cloudVisibility;
uniform float brightness;
uniform vec3 sceneLightDir;
uniform vec3 sceneLightColor;

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
            mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
            mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
        f.z
    );
}

float fbm(vec3 p) {
    float v = 0.0, a = 0.5, f = 1.0;
    for (int i = 0; i < 4; i++) {
        v += a * noise3D(p * f);
        a *= 0.5; f *= 2.0;
    }
    return v;
}

float getDensity(vec3 pos, float dScale, vec3 wind, float distFactor) {
    float h = pos.y;
    if (h < cloudBaseY || h > cloudTopY) return 0.0;
    float hf = smoothstep(cloudBaseY, cloudBaseY + 15.0, h) * (1.0 - smoothstep(cloudTopY - 15.0, cloudTopY, h));

    vec3 p = pos + wind * time * 0.3;
    float n = fbm(p * 0.04 * cloudScale) * 0.6 + fbm(p * 0.08 * cloudScale + 50.0) * 0.4;

    // 细节噪声层 — 在远处补充高频细节
    float detail = fbm(p * 0.24 * cloudScale + 100.0) * 0.15;
    n += detail;

    // 柔和密度映射 — 云量阈值直接映射，cloudCover=0 几乎无云，=1 满云
    float threshold = 1.0 - dScale * 0.65;
    threshold = clamp(threshold, 0.15, 0.95);
    float t = (n - threshold) / (1.0 - threshold);
    n = clamp(t * t, 0.0, 1.0);

    // 整体密度缩放
    n *= 1.5 * hf * distFactor;
    return max(0.0, n);
}

float phase(float ct) {
    float g = 0.8;
    float gg = g * g;
    return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * ct, 1.5));
}

void main(){
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);

    int steps = 96;
    // 自适应步数：近处精细（96步），远处减少到1/3
    float distToCloud = abs(cloudBaseY - cameraPosition.y);
    float stepMultiplier = clamp(distToCloud / 400.0, 0.33, 1.0);
    steps = int(float(steps) * stepMultiplier);
    if (steps < 16) steps = 16;

    float maxDist = cloudVisibility;
    float stepSize = maxDist / float(steps);
    vec3 stepVec = rd * stepSize;
    vec3 rp = ro;

    // Dither 抖动
    float seed = dot(gl_FragCoord.xy, vec2(12.9898, 78.233));
    float dither = fract(sin(seed) * 43758.5453) * stepSize;
    rp += rd * dither;

    float opticalDepth = 0.0;
    float T = 1.0;
    vec3 scatter = vec3(0.0);
    float dist = 0.0;
    vec3 wind = windDirection;
    vec3 lightDir = normalize(sceneLightDir);

    for (int i = 0; i < 200; i++) {
        if (i >= steps) break;
        if (dist > maxDist) break;

        // 双步长：近处精细，远处粗略
        float distRatio = clamp(dist / (maxDist * 0.3), 0.0, 1.0);
        float dynamicStep = mix(stepSize * 0.5, stepSize * 1.5, distRatio * distRatio);
        dynamicStep = clamp(dynamicStep, 2.0, 20.0);

        rp += rd * dynamicStep;
        dist += dynamicStep;

        // 距离衰减因子：远处密度降低
        float distFactor = 1.0 - smoothstep(0.0, maxDist, dist * 0.8);

        float d = getDensity(rp, cloudDensity, wind, distFactor);
        if (d > 0.005) {
            // 累积光学深度（Beer-Lambert）
            opticalDepth += d * dynamicStep * 0.12;
            T = exp(-opticalDepth);

            // ---- 光照方向透射采样 ----
            float lightSteps = 4.0;
            float lightStepSize = 4.0;
            float lightDensitySum = 0.0;
            for (int j = 0; j < 8; j++) {
                if (float(j) >= lightSteps) break;
                vec3 lightPos = rp + lightDir * lightStepSize * float(j);
                float ld = getDensity(lightPos, cloudDensity * 0.6, wind, distFactor);
                lightDensitySum += ld * lightStepSize;
            }
            float transmittance = exp(-lightDensitySum * 0.15);

            float ct = dot(rd, -lightDir);
            float ph = phase(ct);

            vec3 sc = sceneLightColor * transmittance * ph * 0.5 * brightness;

            // 散射光贡献
            float sigma_s = d * 0.08;
            scatter += sc * T * (1.0 - exp(-sigma_s * dynamicStep));
        }
        // 如果光学深度足够大，提前终止
        if (opticalDepth > 5.0) break;
    }

    float hg = clamp((rd.y + 0.4) / 0.9, 0.0, 1.0);
    vec3 sky = mix(vec3(0.5, 0.65, 0.85), vec3(0.25, 0.45, 0.75), hg);
    vec3 color = sky * T + scatter;

    // 如果云密度高，增加白色（smoothstep 控制：T>0.7 稀薄处不混白，T<0.2 厚实处全白）
    color = mix(color, vec3(1.0, 0.98, 0.95), smoothstep(0.7, 0.2, T));

    // ========== 边缘辉光 (Silver Lining) ==========
    float edgeIntensity = T * (1.0 - T) * 4.0;
    edgeIntensity = clamp(edgeIntensity, 0.0, 1.0);
    float backScatter = max(0.0, -dot(rd, normalize(sceneLightDir)));
    float angleFactor = pow(backScatter, 1.5) * 1.5;
    vec3 glowColor = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.95, 0.8), edgeIntensity);
    color += glowColor * edgeIntensity * angleFactor * 0.6;

    gl_FragColor = vec4(color, clamp(1.0 - T, 0.0, 0.95));

    // 丢弃低密度片段，球体本身不可见
    if (gl_FragColor.a < 0.05 || T > 0.95) discard;
}`;

export function createClouds(state: EnvState): void {
    const scene = getScene();

    if (_volCloudMesh) {
        // 更新参数
        const halfThick = (state.cloudThickness ?? 40) / 2;
        _volCloudMat?.setFloat("cloudDensity", state.cloudCover * 1.2);
        const windSpeed = state.windEnabled ? state.windSpeed : 0;
        _volCloudMat?.setVector3("windDirection", new Vector3(
            state.windDirection[0] * windSpeed * 2.0,
            0,
            state.windDirection[2] * windSpeed * 2.0
        ));
        _volCloudMat?.setFloat("cloudBaseY", state.cloudHeight - halfThick);
        _volCloudMat?.setFloat("cloudTopY", state.cloudHeight + halfThick);
        _volCloudMat?.setFloat("cloudScale", state.cloudScale);
        _volCloudMat?.setFloat("cloudVisibility", state.cloudVisibility ?? 2000);
        // brightness/sceneLightDir/sceneLightColor 由每帧观察者统一更新
        return;
        _volCloudMat?.setFloat("cloudTopY", state.cloudHeight + halfThick);
        return;
    }

    disposeClouds();
    if (!state.cloudsEnabled) return;

    // ========== 调试标志：在云层位置画一个红色半透明环 ==========
    const debugRing = MeshBuilder.CreateTorus("cloudDebugRing", { diameter: 100, thickness: 2, tessellation: 32 }, scene);
    debugRing.position.y = state.cloudHeight;
    debugRing.isPickable = false;
    const ringMat = new StandardMaterial("cloudDebugRingMat", scene);
    ringMat.diffuseColor = new Color3(1, 0, 0);
    ringMat.alpha = 0.4;
    ringMat.backFaceCulling = false;
    debugRing.material = ringMat;
    console.log("[VolCloud] DEBUG: red ring at Y=", state.cloudHeight);

    // 每隔 50 单位画一个小标记
    const markers: Mesh[] = [];
    for (let y = state.cloudHeight - 30; y <= state.cloudHeight + 30; y += 15) {
        const marker = MeshBuilder.CreateBox("cloudMarkY" + y, { size: 3 }, scene);
        marker.position.y = y;
        marker.position.x = 10;
        marker.isPickable = false;
        const mMat = new StandardMaterial("cloudMarkMat" + y, scene);
        mMat.diffuseColor = y === state.cloudHeight ? new Color3(0, 1, 0) : new Color3(1, 1, 0);
        mMat.alpha = 0.6;
        marker.material = mMat;
        markers.push(marker);
    }
    // ========== 调试标志结束 ==========

    // 球体不设置 infiniteDistance，让它跟随摄像机位置
    const mesh = MeshBuilder.CreateSphere("volCloud", { diameter: 400, segments: 24, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.isPickable = false;
    mesh.position.y = 0;

    // 每帧跟随摄像机
    const followObs = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (cam) {
            mesh.position.x = cam.position.x;
            mesh.position.z = cam.position.z;
        }
    });

    const mat = new ShaderMaterial("volCloudMat", scene, {
        vertexSource: VERT_SRC,
        fragmentSource: FRAG_SRC,
    }, {
        attributes: ["position"],
        uniforms: ["world", "worldViewProjection", "cameraPosition", "time", "cloudDensity", "windDirection", "cloudBaseY", "cloudTopY", "cloudScale", "cloudVisibility", "brightness", "sceneLightDir", "sceneLightColor"],
        needAlphaBlending: true,
    });

    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alpha = 1.0;
    // 强制使用 Alpha 混合模式，让着色器输出的 alpha 正确混合背景
    mat.transparencyMode = 2; // BABYLON.ETransparencyMode.ALPHA_BLEND

    const halfThick = (state.cloudThickness ?? 40) / 2;
    mat.setFloat("cloudDensity", state.cloudCover * 1.2);
    mat.setFloat("cloudBaseY", state.cloudHeight - halfThick);
    mat.setFloat("cloudTopY", state.cloudHeight + halfThick);
    mat.setFloat("cloudScale", state.cloudScale);
    mat.setFloat("cloudVisibility", state.cloudVisibility ?? 2000);
    mat.setVector3("sceneLightDir", new Vector3(-0.4, -1, -0.3));
    mat.setColor3("sceneLightColor", new Color3(1, 0.98, 0.92));
    mat.setFloat("brightness", 1.0);
    mat.setVector3("windDirection", new Vector3(
        state.windDirection[0] * (state.windEnabled ? state.windSpeed : 0) * 2.0,
        0,
        state.windDirection[2] * (state.windEnabled ? state.windSpeed : 0) * 2.0
    ));

    const startTime = performance.now();
    const obs = scene.onBeforeRenderObservable.add(() => {
        mat.setFloat("time", (performance.now() - startTime) / 1000);
        mat.setVector3("cameraPosition", scene.activeCamera?.position ?? Vector3.Zero());
        // 从场景方向光同步：方向、颜色、亮度
        const dl = scene.getLightByName("dir") as any;
        if (dl) {
            mat.setVector3("sceneLightDir", dl.direction);
            mat.setColor3("sceneLightColor", dl.diffuse);
            const lightIntensity = dl.intensity * 2.0;
            const brightness = Math.max(0.1, Math.min(1.5, lightIntensity));
            mat.setFloat("brightness", brightness);
        } else {
            mat.setVector3("sceneLightDir", new Vector3(-0.4, -1, -0.3));
            mat.setColor3("sceneLightColor", new Color3(1, 0.98, 0.92));
            mat.setFloat("brightness", 1.0);
        }
    });
    mesh.metadata = { obs, followObs };

    mesh.material = mat;
    _volCloudMesh = mesh;
    _volCloudMat = mat;
    _volCloudObs = obs;

    // 重新注册环境更新 observer（被 disposeClouds 移除了）
    ensureEnvUpdateObserver();

    scene.executeWhenReady(() => {
        const ready = mat.isReady(mesh);
        console.log("[VolCloud] ShaderMaterial isReady:", ready);
        if (!ready) console.warn("[VolCloud] Shader not ready");
    });
}

export function disposeClouds(): void {
    // 清理跟随 observer
    if (_volCloudMesh && _volCloudMesh.metadata?.followObs) {
        getScene().onBeforeRenderObservable.remove(_volCloudMesh.metadata.followObs);
    }
    // 清理体积云
    if (_volCloudObs) {
        getScene().onBeforeRenderObservable.remove(_volCloudObs);
        _volCloudObs = null;
    }
    if (_volCloudMat) {
        _volCloudMat.dispose();
        _volCloudMat = null;
    }
    if (_volCloudMesh) {
        _volCloudMesh.dispose();
        _volCloudMesh = null;
    }
    // 清理旧平面云残留
    if (_envSys.clouds.material) {
        _envSys.clouds.material.dispose(false, true);
        _envSys.clouds.material = null;
    }
    if (_envSys.clouds.texture) {
        _envSys.clouds.texture.dispose();
        _envSys.clouds.texture = null;
    }
    for (const key of ["postProcess", "postProcess2"] as const) {
        const m = _envSys.clouds[key];
        if (m) { m.dispose(); _envSys.clouds[key] = null; }
    }
    // 注意：不再调用 disposeEnvUpdateObserver()，
    // 环境 observer 应在整个环境系统销毁时再清理，
    // 否则关云层会影响天空旋转、水下检测等其他功能。
}

// ======== Env Update Observer (wind, sky rotation, underwater) ========
let _envUpdateObserver: Observer<Scene> | null = null;
let _underwaterActive = false;
let _underwaterSavedFog: { mode: number; color: Color3; density: number } | null = null;
let _underwaterTransitionProgress = 0;
let _underwaterTarget = false;

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
        // Underwater post-processing (smooth transition)
        if (envState.waterEnabled && scene.activeCamera) {
            const camY = scene.activeCamera.globalPosition.y;
            _underwaterTarget = camY < envState.waterLevel;

            // Save / restore fog on state change
            if (_underwaterTarget && !_underwaterActive) {
                _underwaterActive = true;
                _underwaterSavedFog = {
                    mode: scene.fogMode,
                    color: scene.fogColor.clone(),
                    density: scene.fogDensity,
                };
            } else if (!_underwaterTarget && _underwaterActive && _underwaterTransitionProgress < 0.001) {
                _underwaterActive = false;
                if (_underwaterSavedFog) {
                    scene.fogMode = _underwaterSavedFog.mode;
                    scene.fogColor = _underwaterSavedFog.color;
                    scene.fogDensity = _underwaterSavedFog.density;
                    _underwaterSavedFog = null;
                }
            }

            // Lerp transition progress
            const dt = scene.deltaTime / 1000;
            const speed = 0.5;
            if (_underwaterTarget && _underwaterTransitionProgress < 1) {
                _underwaterTransitionProgress = Math.min(1, _underwaterTransitionProgress + dt / speed);
            } else if (!_underwaterTarget && _underwaterTransitionProgress > 0) {
                _underwaterTransitionProgress = Math.max(0, _underwaterTransitionProgress - dt / speed);
            }

            if (_underwaterTransitionProgress > 0) {
                const t = _underwaterTransitionProgress;
                // Chromatic aberration — always lerps 0 → amount on entry
                pipeline.chromaticAberrationEnabled = true;
                if (pipeline.chromaticAberration) {
                    pipeline.chromaticAberration.aberrationAmount = envState.underwaterChromaticAmount * t;
                }
                // Fog: color set once, density always lerps 0 → target
                scene.fogMode = Scene.FOGMODE_EXP2;
                scene.fogColor = new Color3(
                    envState.underwaterFogColor[0],
                    envState.underwaterFogColor[1],
                    envState.underwaterFogColor[2],
                );
                scene.fogDensity = envState.underwaterFogDensity * t;
            } else if (!_underwaterActive) {
                pipeline.chromaticAberrationEnabled = false;
            }
        }
    });
}

export function disposeEnvUpdateObserver(): void {
    const scene = getScene();
    if (_envUpdateObserver) {
        scene.onBeforeRenderObservable.remove(_envUpdateObserver);
        _envUpdateObserver = null;
    }
    _underwaterActive = false;
    _underwaterSavedFog = null;
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
}

// ======== Time-of-Day ========
let _timeOfDayHandle: number | null = null;
let _timeOfDayRunning = false;
let _timeOfDaySpeed = 1;

export function startTimeOfDay(): void {
    const scene = getScene();
    if (_timeOfDayRunning) return;
    _timeOfDayRunning = true;
    const tick = () => {
        if (!_timeOfDayRunning) return;
        setEnvSunAngle((getEnvSunAngle() + _timeOfDaySpeed * 0.05 + 360) % 360);
        _timeOfDayHandle = window.setTimeout(tick, 50);
    };
    tick();
}

export function stopTimeOfDay(): void {
    _timeOfDayRunning = false;
    if (_timeOfDayHandle !== null) {
        window.clearTimeout(_timeOfDayHandle);
        _timeOfDayHandle = null;
    }
}

export function isTimeOfDayActive(): boolean {
    return _timeOfDayRunning;
}

export function getTimeOfDaySpeed(): number {
    return _timeOfDaySpeed;
}

export function setTimeOfDaySpeed(s: number): void {
    _timeOfDaySpeed = s;
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

// ======== Water Animation Speed ========
export function updateWaterAnimSpeed(speed: number): void {
    const mat = _envSys.water.material;
    if (mat) {
        mat.setFloat("waveSpeed", speed * 1.0);
    }
}
