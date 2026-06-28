// scene-env-impl.ts — Environment System Implementation (Phase 8)
// All functions use module-level _scene / _pipeline injected by scene.ts
// Import this file via scene-env.ts (Facade), never import directly.

import { Scene, Color3, Color4, Vector2, Vector3, Texture, BaseTexture, StandardMaterial, GPUParticleSystem, Observer, ParticleSystem, ShadowGenerator, CubeTexture, DefaultRenderingPipeline, Mesh, MeshBuilder } from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { WaterMaterial } from "@babylonjs/materials/water/waterMaterial";
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

function _cacheKey(top: Color3, mid: Color3, bot: Color3, brightness: number, sunAngle: number, starsEnabled: boolean): string {
    return `${[top.r,top.g,top.b,mid.r,mid.g,mid.b,bot.r,bot.g,bot.b].map(v=>v.toFixed(3)).join(',')}|${brightness.toFixed(2)}|${sunAngle.toFixed(1)}|${starsEnabled}`;
}

const _gradientCache = new Map<string, Texture>();

function buildGradientTexture(top: Color3, mid: Color3, bot: Color3, brightness: number, sunAngle: number = 45, starsEnabled: boolean = false): Texture {
    const key = _cacheKey(top, mid, bot, brightness, sunAngle, starsEnabled);
    const cached = _gradientCache.get(key);
    if (cached) return cached;

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
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.hasAlpha = false;
    _gradientCache.set(key, tex);
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
function perlinHash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = (h ^ (h >>> 16)) | 0;
    return (h & 0x7fffffff) / 0x7fffffff;
}
function perlin2D(x: number, y: number): number {
    const xi = x | 0, yi = y | 0;
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const n00 = perlinHash(xi, yi);
    const n10 = perlinHash(xi + 1, yi);
    const n01 = perlinHash(xi, yi + 1);
    const n11 = perlinHash(xi + 1, yi + 1);
    return (1 - u) * (1 - v) * n00 + u * (1 - v) * n10 + (1 - u) * v * n01 + u * v * n11;
}
function fbmNoise(x: number, y: number, octaves: number = 5): number {
    let v = 0, amp = 1, freq = 1, total = 0;
    for (let i = 0; i < octaves; i++) {
        v += amp * perlin2D(x * freq, y * freq);
        total += amp;
        amp *= 0.5;
        freq *= 2.17;
    }
    return (v / total) * 0.5 + 0.5;
}

let _waterBumpTexture: Texture | null = null;
function makeWaterBumpTexture(): Texture {
    const scene = getScene();
    if (_waterBumpTexture) return _waterBumpTexture;
    const S = 256;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(S, S);
    const freq = 6.0;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const i = (y * S + x) * 4;
            const n = fbmNoise(x / freq, y / freq, 5);
            img.data[i] = 128 + (n - 0.5) * 128;
            img.data[i + 1] = 128 + (n - 0.5) * 128;
            img.data[i + 2] = 255;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    _waterBumpTexture = new Texture(canvas.toDataURL(), scene);
    return _waterBumpTexture;
}

export function createWater(state: EnvState): void {
    // 如果水面已经存在，直接更新参数，不重建
    if (_envSys.water.mesh && _envSys.water.material) {
        const m = _envSys.water.material;
        const pos = _envSys.water.mesh.position;
        pos.y = state.waterLevel;
        m.windForce = (state.waterAnimSpeed ?? 1) * 4;
        m.waveHeight = state.waterWaveHeight;
        m.waveLength = 0.08;
        m.waveSpeed = (state.waterAnimSpeed ?? 1) * 1.0;
        m.waterColor = new Color3(state.waterColor[0], state.waterColor[1], state.waterColor[2]);
        m.colorBlendFactor = 0.3;
        m.alpha = state.waterTransparency;
        m.windDirection = new Vector2(state.windDirection[0], state.windDirection[2]);
        const wm = _envSys.water.mesh;
        const newSize = Math.max(1, state.waterSize);
        if (wm.scaling.x !== newSize / 60) {
            // scaling ground: base width is 60
            wm.scaling.x = newSize / 60;
            wm.scaling.z = newSize / 60;
        }
        return;
    }

    const scene = getScene();
    const pipeline = getPipeline();
    disposeWater();
    if (!state.waterEnabled) return;

    const size = Math.max(1, state.waterSize);
    const waterMesh = MeshBuilder.CreateGround("envWater", {
        width: size,
        height: size,
        subdivisions: 32,
    }, scene);
    waterMesh.isPickable = false;
    waterMesh.position.y = state.waterLevel;

    const water = new WaterMaterial("envWaterMat", scene, new Vector2(size, size));
    water.bumpTexture = makeWaterBumpTexture();
    water.windForce = (state.waterAnimSpeed ?? 1) * 4;
    water.waveHeight = state.waterWaveHeight;
    water.bumpHeight = 0.15;
    water.waveLength = 0.08;
    water.waveSpeed = (state.waterAnimSpeed ?? 1) * 1.0;
    water.waterColor = new Color3(state.waterColor[0], state.waterColor[1], state.waterColor[2]);
    water.colorBlendFactor = 0.3;
    water.alpha = state.waterTransparency;
    water.windDirection = new Vector2(state.windDirection[0], state.windDirection[2]);
    waterMesh.material = water;

    for (const m of scene.meshes) {
        if (m !== waterMesh && m.isEnabled()) {
            water.addToRenderList(m);
        }
    }

    _envSys.water.mesh = waterMesh;
    _envSys.water.material = water;
}

export function disposeWater(): void {
    if (_envSys.water.mesh) {
        _envSys.water.mesh.dispose();
        _envSys.water.mesh = null;
    }
    if (_envSys.water.material) {
        _envSys.water.material.dispose();
        _envSys.water.material = null;
    }
}

export function refreshWaterRenderList(): void {
    const state = envState;
    if (!state.waterEnabled || !_envSys.water.mesh) return;
    createWater(state);
}

// ======== Particle System ========
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
    // 如果粒子系统已经存在，跳过重建
    if (_envSys.particles.emitter) return;

    const scene = getScene();
    disposeParticles();
    if (type === "none") return;

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

export function createClouds(state: EnvState): void {
    const scene = getScene();
    // 如果云已经存在且状态没变，跳过纹理再生（噪声生成很慢）
    if (_envSys.clouds.material && _envSys.clouds.texture && _envSys.clouds.postProcess) {
        // 只更新位置/缩放，不重新生成纹理
        _envSys.clouds.postProcess.position.y = state.cloudHeight;
        _envSys.clouds.postProcess2.position.y = state.cloudHeight - 15;
        const s = state.cloudScale;
        _envSys.clouds.postProcess.scaling.x = s; _envSys.clouds.postProcess.scaling.z = s;
        _envSys.clouds.postProcess2.scaling.x = s * 1.2; _envSys.clouds.postProcess2.scaling.z = s * 1.2;
        return;
    }

    disposeClouds();
    if (!state.cloudsEnabled) return;

    const SIZE = 512;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const x = (i / 4) % SIZE;
        const y = Math.floor((i / 4) / SIZE);
        const n = cloudNoise(x, y, state.cloudCover);
        const a = Math.floor(n * 255 * 0.6);
        imgData.data[i] = 255;
        imgData.data[i + 1] = 255;
        imgData.data[i + 2] = 255;
        imgData.data[i + 3] = a;
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new Texture(canvas.toDataURL(), scene);
    const mat = new StandardMaterial("envCloudMat", scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.5;

    function makePlane(name: string, yOffset: number, scaleMul: number, alphaMul: number): Mesh {
        const plane = MeshBuilder.CreatePlane(name, { width: 200, height: 200 }, scene);
        plane.isPickable = false;
        plane.position = new Vector3(0, state.cloudHeight + yOffset, 0);
        plane.rotation.x = Math.PI / 2;
        plane.material = mat;
        plane.scaling.x = state.cloudScale * scaleMul;
        plane.scaling.z = state.cloudScale * scaleMul;
        return plane;
    }

    const p1 = makePlane("envClouds", 0, 1.0, 1.0);
    const p2 = makePlane("envCloudsBack", -15, 1.2, 0.85);

    _envSys.clouds.postProcess = p1;
    _envSys.clouds.postProcess2 = p2;
    _envSys.clouds.material = mat;
    _envSys.clouds.texture = tex;

    ensureEnvUpdateObserver();
}

export function disposeClouds(): void {
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
    disposeEnvUpdateObserver();
}

// ======== Env Update Observer (wind, sky rotation, underwater) ========
let _envUpdateObserver: Observer<Scene> | null = null;
let _underwaterActive = false;
let _underwaterSavedFog: { mode: number; color: Color3; density: number } | null = null;

export function ensureEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) return;
    _envUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.deltaTime / 16.667;
        // Cloud drift (wind driven)
        if (envState.cloudsEnabled && envState.windEnabled) {
            const dx = envState.windDirection[0] * envState.windSpeed * 0.01 * dt;
            const dz = envState.windDirection[2] * envState.windSpeed * 0.01 * dt;
            for (const key of ["postProcess", "postProcess2"] as const) {
                const m = _envSys.clouds[key];
                if (m) {
                    const speedMul = key === "postProcess2" ? 0.85 : 1.0;
                    m.position.x += dx * speedMul;
                    m.position.z += dz * speedMul;
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
        // Water wave direction follows wind (horizontal XZ plane)
        if (envState.waterEnabled && _envSys.water.material) {
            const wd = new Vector2(envState.windDirection[0], envState.windDirection[2]);
            const len = wd.length();
            if (len > 0.001) {
                wd.normalize();
            }
            _envSys.water.material.windDirection = wd;
        }
        // Underwater post-processing
        if (envState.waterEnabled && scene.activeCamera) {
            const camY = scene.activeCamera.globalPosition.y;
            const underwater = camY < envState.waterLevel;
            if (underwater !== _underwaterActive) {
                _underwaterActive = underwater;
                pipeline.chromaticAberrationEnabled = underwater;
                if (pipeline.chromaticAberration) {
                    pipeline.chromaticAberration.aberrationAmount = underwater ? 20 : 0;
                }
                if (underwater && !_underwaterSavedFog) {
                    _underwaterSavedFog = {
                        mode: scene.fogMode,
                        color: scene.fogColor.clone(),
                        density: scene.fogDensity,
                    };
                    scene.fogMode = Scene.FOGMODE_EXP2;
                    scene.fogColor = new Color3(0.08, 0.2, 0.45);
                    scene.fogDensity = 0.015;
                } else if (!underwater && _underwaterSavedFog) {
                    scene.fogMode = _underwaterSavedFog.mode;
                    scene.fogColor = _underwaterSavedFog.color;
                    scene.fogDensity = _underwaterSavedFog.density;
                    _underwaterSavedFog = null;
                }
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
        mat.windForce = speed * 4;
        mat.waveSpeed = speed * 1.0;
    }
}
