import { Scene, Color3, Vector3, Texture, Constants, Mesh, MeshBuilder, ShaderMaterial, Observer, DirectionalLight, DefaultRenderingPipeline } from "@babylonjs/core";
import { EnvState, envState } from "../core/config";
import { _envSys, getScene, getPipeline, ensureEnvUpdateObserver } from "./scene-env-impl";

// ======== 水下状态（供 Env Update Observer 和 disposeWater 使用）========
export let _underwaterActive = false;
export let _underwaterSavedFog: { mode: number; color: Color3; density: number } | null = null;
export let _underwaterTransitionProgress = 0;
export let _underwaterTarget = false;

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
    life: number;
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

    {
        vec2 dir = normalize(vec2(0.8, 0.6));
        float f = 0.15, a = 0.3 * waveHeight;
        float th = f * dot(dir, p.xz) + 0.7 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }
    {
        vec2 dir = normalize(vec2(-0.3, 0.9));
        float f = 0.2, a = 0.25 * waveHeight;
        float th = f * dot(dir, p.xz) + 0.9 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }
    {
        vec2 dir = normalize(vec2(-0.7, -0.5));
        float f = 0.25, a = 0.2 * waveHeight;
        float th = f * dot(dir, p.xz) + 0.5 * time * waveSpeed;
        float c = cos(th), s = sin(th);
        p.x += a * dir.x * c; p.z += a * dir.y * c; p.y += a * s;
        n.x -= dir.x * f * a * c; n.z -= dir.y * f * a * c;
    }
    {
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

    vec3 reflection = vec3(0.0);
    #ifdef ENV_TEXTURE
    reflection = textureCube(envTexture, reflectDir).rgb * envIntensity;
    #endif

    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

    vec3 base = waterColor;
    vec3 color = mix(base, reflection, fresnel);

    float diff = max(dot(normal, normalize(lightDir)), 0.0);
    color += diff * lightColor * 0.15;
    color += ambientIntensity * waterColor * 0.15;

    float foamH = vHeight - waterLevel;
    float foam = smoothstep(foamThreshold, foamThreshold + 0.15, foamH);
    foam = clamp(foam, 0.0, 1.0);
    color = mix(color, foamColor, foam * foamIntensity);

    float rippleSum = 0.0;
    for (int i = 0; i < 8; i++) {
        if (i >= uRippleCount) break;
        vec4 pr = uRipplePosRad[i];
        vec4 ssl = uRippleStrSpdLife[i];
        if (pr.w <= 0.0 || ssl.z <= 0.0) continue;
        float r = calcRipple(vWorldPos, pr.xyz, pr.w, ssl.x, ssl.y, ssl.z);
        rippleSum += r;
    }
    vec3 rippleN = vec3(rippleSum * 0.15, 0.0, rippleSum * 0.15);
    normal = normalize(normal + rippleN);
    float rippleGlint = max(0.0, rippleSum * 0.25);
    color += vec3(rippleGlint);

    vec2 causticUV = vWorldPos.xz * uCausticScale + vec2(time * uCausticSpeed * 0.10, time * uCausticSpeed * 0.15);
    float caustic = texture2D(uCausticTex, causticUV).r;
    vec3 causticCol = mix(vec3(1.0, 0.9, 0.6), vec3(1.0, 1.0, 0.8), caustic);
    color += causticCol * caustic * uCausticIntensity;

    float depth = length(vWorldPos - cameraPosition);
    float fog = 1.0 - exp(-fogDensity * depth);
    color = mix(color, fogColor, fog);

    float alpha = mix(waterTransparency, 1.0, fresnel * 0.5 + foam * 0.2);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
}`;

// ======== Water System ========

export function createWater(state: EnvState): void {
    ensureEnvUpdateObserver();

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

    mat.setColor3("foamColor", new Color3(1, 1, 1));
    mat.setFloat("foamThreshold", state.foamThreshold);
    mat.setFloat("foamIntensity", state.foamIntensity);

    const dirLight = scene.getLightByName("dir") as DirectionalLight | null;
    if (dirLight) {
        mat.setVector3("lightDir", dirLight.direction);
        mat.setColor3("lightColor", dirLight.diffuse);
    } else {
        mat.setVector3("lightDir", new Vector3(-0.5, -1, -0.5));
        mat.setColor3("lightColor", new Color3(1, 1, 1));
    }
    mat.setFloat("ambientIntensity", 0.3);

    mat.setArray4("uRipplePosRad", new Array(MAX_RIPPLES * 4).fill(0));
    mat.setArray4("uRippleStrSpdLife", new Array(MAX_RIPPLES * 4).fill(0));
    mat.setInt("uRippleCount", 0);

    const causticTex = ensureCausticTexture(scene);
    mat.setTexture("uCausticTex", causticTex);
    mat.setFloat("uCausticIntensity", 0.15);
    mat.setFloat("uCausticSpeed", 0.5);
    mat.setFloat("uCausticScale", 0.04);

    mat.setColor3("fogColor", scene.fogColor);
    mat.setFloat("fogDensity", scene.fogDensity);

    meshHigh.material = mat;
    meshMid.material = mat;
    meshLow.material = mat;

    _envSys.water.mesh = meshHigh;
    _envSys.water.material = mat;

    if (!_waterUpdateObserver) {
        _waterUpdateObserver = scene.onBeforeRenderObservable.add(() => {
            if (!_envSys.water.material) return;
            const m = _envSys.water.material as ShaderMaterial;
            const now = performance.now() / 1000;
            m.setFloat("time", now);
            const cam = scene.activeCamera;
            if (cam) m.setVector3("cameraPosition", cam.position);
            m.setColor3("fogColor", scene.fogColor);
            m.setFloat("fogDensity", scene.fogDensity);
            const dl = scene.getLightByName("dir") as DirectionalLight | null;
            if (dl) {
                m.setVector3("lightDir", dl.direction);
                m.setColor3("lightColor", dl.diffuse);
            }

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
    clearRipples(); // 清理残留涟漪，避免 dispose 后再次 createWater 时显示旧数据
    if (_envSys.water.material) {
        _envSys.water.material.dispose();
        _envSys.water.material = null;
    }
    if (_waterUpdateObserver) {
        getScene().onBeforeRenderObservable.remove(_waterUpdateObserver);
        _waterUpdateObserver = null;
    }
    _underwaterActive = false;
    _underwaterSavedFog = null;
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
}

export function refreshWaterRenderList(): void {
}

// ======== Water Animation Speed ========
export function updateWaterAnimSpeed(speed: number): void {
    const mat = _envSys.water.material;
    if (mat) {
        mat.setFloat("waveSpeed", speed * 1.0);
    }
}

// ======== Underwater Transition (called by Env Update Observer) ========
export function updateUnderwaterTransition(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    if (!envState.waterEnabled || !scene.activeCamera) {
        if (_underwaterTransitionProgress > 0 || _underwaterActive) {
            resetUnderwaterState(scene, pipeline);
        }
        return;
    }

    const camY = scene.activeCamera.globalPosition.y;
    _underwaterTarget = camY < envState.waterLevel;

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

    const dt = scene.deltaTime / 1000;
    const speed = 0.5;
    if (_underwaterTarget && _underwaterTransitionProgress < 1) {
        _underwaterTransitionProgress = Math.min(1, _underwaterTransitionProgress + dt / speed);
    } else if (!_underwaterTarget && _underwaterTransitionProgress > 0) {
        _underwaterTransitionProgress = Math.max(0, _underwaterTransitionProgress - dt / speed);
    }

    if (_underwaterTransitionProgress > 0) {
        const t = _underwaterTransitionProgress;
        pipeline.chromaticAberrationEnabled = true;
        if (pipeline.chromaticAberration) {
            pipeline.chromaticAberration.aberrationAmount = envState.underwaterChromaticAmount * t;
        }
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

export function resetUnderwaterState(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _underwaterActive = false;
    if (_underwaterSavedFog) {
        scene.fogMode = _underwaterSavedFog.mode;
        scene.fogColor = _underwaterSavedFog.color;
        scene.fogDensity = _underwaterSavedFog.density;
        _underwaterSavedFog = null;
    }
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
    pipeline.chromaticAberrationEnabled = false;
}
