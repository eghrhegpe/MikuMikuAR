import {
    Scene,
    Color3,
    Vector3,
    Texture,
    Mesh,
    MeshBuilder,
    ShaderMaterial,
    StandardMaterial,
    Engine,
    DirectionalLight,
    RawTexture3D,
    Constants,
} from '@babylonjs/core';
import { EnvState } from '@/core/config';
import { _envSys, getScene, ensureEnvUpdateObserver } from './env-impl';

// ======== Cloud System Constants ========
/** Density scale factor applied to cloudCover (1.2 = 20% boost) */
const CLOUD_DENSITY_SCALE = 1.2;
/** Light attenuation factor for volumetric scattering */
const CLOUD_LIGHT_ATTEN = 0.15;
/** Scattering intensity multiplier */
const CLOUD_SCATTER_INTENSITY = 0.5;
/** Maximum optical depth before early termination (5.0 = thick cloud) */
const CLOUD_MAX_OPTICAL_DEPTH = 5.0;
/** Minimum density threshold for volumetric sampling */
const CLOUD_DENSITY_THRESHOLD = 0.005;
/** Debug visualization Y-offset range (±30 units from cloudHeight) */
const CLOUD_DEBUG_Y_RANGE = 30;
/** Debug visualization Y-step */
const CLOUD_DEBUG_Y_STEP = 15;

// ======== 3D Noise Texture (256³) ========
let _noiseTex3D: RawTexture3D | null = null;

/** Integer hash (Wang variant, no periodic patterns) */
function _hash3D(ix: number, iy: number, iz: number): number {
    let n = (ix * 1664525 + iy * 1013904223 + iz * 3141592653) >>> 0;
    n = (n ^ (n >>> 16)) >>> 0;
    n = Math.imul(n, 0x85ebca6b) >>> 0;
    n = (n ^ (n >>> 13)) >>> 0;
    n = Math.imul(n, 0xc2b2ae35) >>> 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return (n & 0xff) / 255.0;
}

/** Generate 256³ value-noise texture.
 *  Each texel stores a hash value [0,1] quantized to 0-255.
 *  Shader samples with trilinear filtering → smooth value noise.
 *  Texture wraps every 256 world units. */
function _generateNoise3D(): Uint8Array {
    const S = 256;
    const data = new Uint8Array(S * S * S);
    for (let z = 0; z < S; z++) {
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const v = _hash3D(x, y, z);
                data[z * S * S + y * S + x] = Math.min(255, Math.max(0, Math.floor(v * 255)));
            }
        }
    }
    return data;
}

function _ensureNoiseTexture(scene: Scene): RawTexture3D {
    // Cache: only generate once, reuse across create/dispose cycles
    if (_noiseTex3D) {
        return _noiseTex3D;
    }
    const S = 256;
    const data = _generateNoise3D();
    _noiseTex3D = new RawTexture3D(
        data,
        S,
        S,
        S,
        Engine.TEXTUREFORMAT_R,
        scene,
        false,
        false,
        Texture.BILINEAR_SAMPLINGMODE
    );
    _noiseTex3D.wrapU = Texture.WRAP_ADDRESSMODE;
    _noiseTex3D.wrapV = Texture.WRAP_ADDRESSMODE;
    _noiseTex3D.wrapR = Texture.WRAP_ADDRESSMODE;
    console.info('[VolCloud] 3D noise texture created (256³)');
    return _noiseTex3D;
}

// ======== Wind velocity helper ========

/**
 * 将 windDirection（方向向量）归一化后乘以 windSpeed，得到实际风速度向量。
 * 方向由 windDirection 决定，大小只由 windSpeed 控制。
 */
function _computeWindVelocity(state: EnvState): [number, number, number] {
    if (!state.windEnabled || !state.windSpeed) {
        return [0, 0, 0];
    }
    const dx = state.windDirection[0];
    const dz = state.windDirection[2];
    const dirLen = Math.sqrt(dx * dx + dz * dz) || 1;
    const speed = state.windSpeed * 2.0;
    return [(dx / dirLen) * speed, 0, (dz / dirLen) * speed];
}

// ======== Shader constants, injected from TS ========

const SHADER_CLOUD_LIGHT_ATTEN = CLOUD_LIGHT_ATTEN.toFixed(2);
const SHADER_SCATTER_INTENSITY = CLOUD_SCATTER_INTENSITY.toFixed(2);
const SHADER_MAX_OPTICAL_DEPTH = CLOUD_MAX_OPTICAL_DEPTH.toFixed(1);
const SHADER_DENSITY_THRESHOLD = CLOUD_DENSITY_THRESHOLD.toFixed(3);

// ======== Volumetric Cloud (ShaderMaterial-on-Sphere) ========
let _volCloudMesh: Mesh | null = null;
let _volCloudMat: ShaderMaterial | null = null;
let _debugCloudRing: Mesh | null = null;
let _debugCloudMarkers: Mesh[] = [];
/** 云层位置可视化的半透明平面（调试用） */
let _debugCloudDeck: Mesh | null = null;

/** 清理所有调试可视化对象。 */
function _clearDebugVisuals(): void {
    const _scene = getScene();
    if (_debugCloudRing) {
        _debugCloudRing.dispose();
        _debugCloudRing = null;
    }
    for (const m of _debugCloudMarkers) {
        m.dispose();
    }
    _debugCloudMarkers = [];
    if (_debugCloudDeck) {
        _debugCloudDeck.dispose();
        _debugCloudDeck = null;
    }
}

/** 创建调试可视化对象（红色环 + 色标）。 */
function _createDebugVisuals(state: EnvState, scene: Scene): void {
    _clearDebugVisuals();
    if (!state.debugClouds) {
        return;
    }
    _debugCloudRing = MeshBuilder.CreateTorus(
        'cloudDebugRing',
        { diameter: 100, thickness: 2, tessellation: 32 },
        scene
    );
    _debugCloudRing.position.y = state.cloudHeight;
    _debugCloudRing.isPickable = false;
    const ringMat = new StandardMaterial('cloudDebugRingMat', scene);
    ringMat.diffuseColor = new Color3(1, 0, 0);
    ringMat.alpha = 0.4;
    ringMat.backFaceCulling = false;
    _debugCloudRing.material = ringMat;

    for (
        let y = state.cloudHeight - CLOUD_DEBUG_Y_RANGE;
        y <= state.cloudHeight + CLOUD_DEBUG_Y_RANGE;
        y += CLOUD_DEBUG_Y_STEP
    ) {
        const marker = MeshBuilder.CreateBox('cloudMarkY' + y, { size: 3 }, scene);
        marker.position.y = y;
        marker.position.x = 10;
        marker.isPickable = false;
        const mMat = new StandardMaterial('cloudMarkMat' + y, scene);
        mMat.diffuseColor = y === state.cloudHeight ? new Color3(0, 1, 0) : new Color3(1, 1, 0);
        mMat.alpha = 0.6;
        marker.material = mMat;
        _debugCloudMarkers.push(marker);
    }

    // 半透明云层平面：帮助定位云层在场景中的位置
    _debugCloudDeck = MeshBuilder.CreateGround(
        'cloudDebugDeck',
        { width: 2000, height: 2000, subdivisions: 1 },
        scene
    );
    _debugCloudDeck.position.y = state.cloudHeight;
    _debugCloudDeck.isPickable = false;
    const deckMat = new StandardMaterial('cloudDebugDeckMat', scene);
    deckMat.diffuseColor = new Color3(1, 1, 1);
    deckMat.alpha = 0.15;
    deckMat.backFaceCulling = false;
    deckMat.alphaMode = Constants.ALPHA_COMBINE;
    _debugCloudDeck.material = deckMat;
}

// Shader strings registered via Effect.ShadersStore
const VERT_SRC = `
#version 300 es
precision highp float;
in vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
out vec3 vWorldPos;
out float vDistFromCenter;
void main(){
    vec4 worldPos = world * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vDistFromCenter = length(worldPos.xz);
    gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAG_SRC = `
#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 vWorldPos;
in float vDistFromCenter;
uniform vec3 cameraPosition;
uniform float time;
uniform float cloudDensity;
uniform vec3 windDirection;
uniform float cloudBaseY;
uniform float cloudTopY;
uniform float cloudScale;
uniform float cloudVisibility;
uniform float cloudGap;
uniform float brightness;
uniform vec3 sceneLightDir;
uniform vec3 sceneLightColor;
uniform sampler3D noiseTex;
out vec4 fragColor;

// ===== Volumetric raymarch constants (from TS) =====
#define CLOUD_LIGHT_ATTEN ${SHADER_CLOUD_LIGHT_ATTEN}
#define CLOUD_PHASE_G 0.8
#define CLOUD_SCATTER_INTENSITY ${SHADER_SCATTER_INTENSITY}
#define CLOUD_MAX_OPTICAL_DEPTH ${SHADER_MAX_OPTICAL_DEPTH}
#define CLOUD_DENSITY_THRESHOLD ${SHADER_DENSITY_THRESHOLD}
#define CLOUD_LIGHT_STEPS 2
#define CLOUD_MAX_STEPS 200
#define CLOUD_FIXED_STEP 8.0
#define CLOUD_FBM_OCTAVES 3
#define NOISE_PERIOD 256.0

// Pseudo-random hash (per-fragment jitter)
float hash13(vec3 p) {
    float h = dot(p, vec3(127.1, 311.7, 74.7));
    return fract(sin(h) * 43758.5453);
}

float noise3D(vec3 p) {
    vec3 uvw = fract(p / NOISE_PERIOD);
    return texture(noiseTex, uvw).r;
}
float fbm(vec3 p) {
    float v = 0.0, a = 0.5, f = 1.0;
    for (int i = 0; i < CLOUD_FBM_OCTAVES; i++) {
        v += a * noise3D(p * f);
        a *= 0.5; f *= 2.0;
    }
    return v;
}
float getDensity(vec3 pos, float dScale, vec3 wind) {
    float h = pos.y;
    float thickness = cloudTopY - cloudBaseY;
    float fadeZone = max(thickness * 0.3, 4.0);
    float hf = smoothstep(cloudBaseY, cloudBaseY + fadeZone, h) *
               (1.0 - smoothstep(cloudTopY - fadeZone, cloudTopY, h));
    vec3 p = pos + wind * time;
    float n1 = fbm(p * 0.005 * cloudScale);
    float n2 = fbm(p * 0.015 * cloudScale + 33.0);
    float n3 = fbm(p * 0.05 * cloudScale + 66.0);
    float n = n1 * 0.65 + n2 * 0.25 + n3 * 0.08;
    // Contrast stretch: cloudGap > 0 pushes n toward 0 and 1,
    // increasing gaps without changing spatial frequency (cloud size unchanged).
    float contrast = 1.0 + cloudGap * 3.0;
    n = pow(n, contrast);
    // Intuitive threshold: cloudCover=0 → few wisps, cloudCover=1 → dense clouds.
    float threshold = 1.0 - dScale;
    threshold = clamp(threshold, 0.05, 0.85);
    float density = smoothstep(threshold, threshold + 0.35, n);
    density = pow(density, 0.9);
    density *= hf;
    density = clamp(density, 0.0, 1.0);
    return density;
}
void main(){
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);
    float maxT = cloudVisibility;
    float dt = CLOUD_FIXED_STEP;

    // Early exit: 相机在云层外且射线远离云层 → 永远碰不到云，直接跳过
    if ((ro.y < cloudBaseY && rd.y <= 0.0) || (ro.y > cloudTopY && rd.y >= 0.0)) {
        discard;
        return;
    }
    // Early exit: 相机在云层下方但仰角太小，200 步内到不了云层
    if (ro.y < cloudBaseY && rd.y > 0.0) {
        float stepsNeeded = (cloudBaseY - ro.y) / (rd.y * dt);
        if (stepsNeeded > float(CLOUD_MAX_STEPS)) {
            discard;
            return;
        }
    }

    float T = 1.0;
    vec3 L = vec3(0.0);
    vec3 cloudCol = vec3(0.78, 0.82, 0.92);
    vec3 Ldir = normalize(-sceneLightDir);

    // Screen-space jitter with fixed seed (no temporal flicker).
    float jitter = hash13(vec3(gl_FragCoord.xy, 1.0));
    float startT = jitter * dt;

    for (int i = 0; i < CLOUD_MAX_STEPS; i++) {
        float t = startT + dt * float(i);
        if (t > maxT) break;
        vec3 p = ro + rd * t;

        // 射线已穿过云层范围 → 后续不会再遇到云，提前跳出
        if ((rd.y > 0.0 && p.y > cloudTopY) || (rd.y < 0.0 && p.y < cloudBaseY)) {
            break;
        }

        float d = getDensity(p, cloudDensity, windDirection);
        if (d > CLOUD_DENSITY_THRESHOLD) {
            float ct = max(dot(Ldir, rd), 0.0);
            float g = CLOUD_PHASE_G;
            float phase = (1.0 - g*g) / (4.0 * 3.14159 * pow(1.0 + g*g - 2.0*g*ct, 1.5));
            float od = d * dt;
            vec3 S = cloudCol * sceneLightColor * brightness * d * phase * dt * CLOUD_SCATTER_INTENSITY;
            L += T * S;
            T *= max(0.0, 1.0 - od * CLOUD_LIGHT_ATTEN);
            if (T < 0.02) break;
        }
    }
    vec3 ambient = cloudCol * 0.25 * (1.0 - T);
    vec3 color = L + ambient;
    float alpha = 1.0 - T;
    if (alpha < 0.008) discard;
    fragColor = vec4(color, alpha);
}`;

export function createClouds(state: EnvState): void {
    // Issue #7: 先清理旧的调试对象，确保 toggle off 时自动移除
    _clearDebugVisuals();

    if (!state.cloudsEnabled) {
        disposeClouds();
        return;
    }
    const scene = getScene();
    // 球体直径 = min(20000, camera.maxZ * 1.8)，确保顶点不被远平面裁剪
    const cam = scene.activeCamera;
    const farZ = cam?.maxZ ?? 10000;
    const SPHERE_DIAMETER = Math.min(20000, farZ * 1.8);

    // Compute wind velocity once
    const windVel = _computeWindVelocity(state);

    // Update existing material uniforms without rebuilding mesh
    if (_volCloudMesh && _volCloudMat) {
        const halfThick = (state.cloudThickness ?? 40) / 2;
        _volCloudMat.setFloat('cloudDensity', state.cloudCover * CLOUD_DENSITY_SCALE);
        _volCloudMat.setVector3('windDirection', new Vector3(windVel[0], windVel[1], windVel[2]));
        _volCloudMat.setFloat('cloudBaseY', state.cloudHeight - halfThick);
        _volCloudMat.setFloat('cloudTopY', state.cloudHeight + halfThick);
        _volCloudMat.setFloat('cloudScale', state.cloudScale);
        _volCloudMat.setFloat('cloudVisibility', state.cloudVisibility ?? 2000);
        _volCloudMat.setFloat('cloudGap', state.cloudGap ?? 0.5);

        // Sync debug visualization
        _createDebugVisuals(state, scene);
        return;
    }

    disposeClouds();

    // Debug visualization
    _createDebugVisuals(state, scene);

    const mesh = MeshBuilder.CreateSphere(
        'volCloud',
        { diameter: SPHERE_DIAMETER, segments: 24, sideOrientation: Mesh.BACKSIDE },
        scene
    );
    // 强制在透明队列最后渲染（避免被天空盒覆盖）
    mesh.renderingGroupId = 1;
    mesh.isPickable = false;
    mesh.position.y = 0;

    const followObs = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        mesh.position.x = cam.position.x;
        mesh.position.z = cam.position.z;
    });

    const mat = new ShaderMaterial(
        'volCloudMat',
        scene,
        { vertexSource: VERT_SRC, fragmentSource: FRAG_SRC },
        {
            attributes: ['position'],
            uniforms: [
                'world',
                'worldViewProjection',
                'cameraPosition',
                'time',
                'cloudDensity',
                'windDirection',
                'cloudBaseY',
                'cloudTopY',
                'cloudScale',
                'cloudVisibility',
                'cloudGap',
                'brightness',
                'sceneLightDir',
                'sceneLightColor',
            ],
            samplers: ['noiseTex'],
            needAlphaBlending: true,
        }
    );

    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.depthFunction = Constants.ALWAYS;
    mat.alpha = 1.0;
    mat.transparencyMode = 2;
    // Bind 3D noise texture (must be after mat is created)
    const noiseTex = _ensureNoiseTexture(scene);
    mat.setTexture('noiseTex', noiseTex);

    const halfThick = (state.cloudThickness ?? 40) / 2;
    mat.setFloat('cloudDensity', state.cloudCover * CLOUD_DENSITY_SCALE);
    mat.setFloat('cloudBaseY', state.cloudHeight - halfThick);
    mat.setFloat('cloudTopY', state.cloudHeight + halfThick);
    mat.setFloat('cloudScale', state.cloudScale);
    mat.setFloat('cloudVisibility', state.cloudVisibility ?? 2000);
    mat.setFloat('cloudGap', state.cloudGap ?? 0.5);
    mat.setVector3('sceneLightDir', new Vector3(-0.4, -1.0, -0.3));
    mat.setColor3('sceneLightColor', new Color3(1, 0.98, 0.92));
    mat.setFloat('brightness', 1.0);
    mat.setVector3('windDirection', new Vector3(windVel[0], windVel[1], windVel[2]));

    const startTime = performance.now();
    const obs = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        mat.setFloat('time', (performance.now() - startTime) / 1000);
        mat.setVector3('cameraPosition', cam.position);
        const dl = scene.getLightByName('dir');
        if (dl instanceof DirectionalLight) {
            mat.setVector3('sceneLightDir', dl.direction);
            mat.setColor3('sceneLightColor', dl.diffuse);
            const lightIntensity = dl.intensity * 2.0;
            const brightness = Math.max(0.1, Math.min(1.5, lightIntensity));
            mat.setFloat('brightness', brightness);
        } else {
            mat.setVector3('sceneLightDir', new Vector3(-0.4, -1.0, -0.3));
            mat.setColor3('sceneLightColor', new Color3(1, 0.98, 0.92));
            mat.setFloat('brightness', 1.0);
        }
    });
    mesh.metadata = { obs, followObs };

    mesh.material = mat;
    _volCloudMesh = mesh;
    _volCloudMat = mat;

    ensureEnvUpdateObserver();

    console.info('[VolCloud] Cloud system created successfully');
}

export function disposeClouds(): void {
    // Clean up debug visualization objects
    _clearDebugVisuals();

    const scene = getScene();

    // Remove observers first (before disposing mesh/material)
    if (_volCloudMesh?.metadata?.obs) {
        scene.onBeforeRenderObservable.remove(_volCloudMesh.metadata.obs);
        _volCloudMesh.metadata.obs = null;
    }
    if (_volCloudMesh?.metadata?.followObs) {
        scene.onBeforeRenderObservable.remove(_volCloudMesh.metadata.followObs);
        _volCloudMesh.metadata.followObs = null;
    }

    // Dispose material before mesh (material may reference mesh)
    if (_volCloudMat) {
        _volCloudMat.dispose();
        _volCloudMat = null;
    }
    if (_volCloudMesh) {
        _volCloudMesh.dispose();
        _volCloudMesh = null;
    }

    // Clean up _envSys.clouds resources (legacy, kept for safety)
    if (_envSys.clouds.material) {
        _envSys.clouds.material.dispose(false, true);
        _envSys.clouds.material = null;
    }
    if (_envSys.clouds.texture) {
        _envSys.clouds.texture.dispose();
        _envSys.clouds.texture = null;
    }
    for (const key of ['postProcess', 'postProcess2'] as const) {
        const m = _envSys.clouds[key];
        if (m) {
            m.dispose();
            _envSys.clouds[key] = null;
        }
    }

    // Issue #6: 释放 3D 噪声纹理，避免禁用云时显存泄漏
    if (_noiseTex3D) {
        _noiseTex3D.dispose();
        _noiseTex3D = null;
    }
}
