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
    RawTexture,
    Constants,
} from '@babylonjs/core';
import { EnvState } from '@/core/config';
import { _envSys, getScene, ensureEnvUpdateObserver } from './env-impl';

// ======== Cloud System Constants ========
/** Density scale factor applied to cloudCover (1.2 = 20% boost) */
const CLOUD_DENSITY_SCALE = 1.2;
/** Light attenuation factor for volumetric scattering.
 *  0.15 = 之前锁定值，导致厚云内部透射过高、整体灰白缺乏体积感；
 *  提升到 0.4 让厚云中心更快衰减到不透明，拉开明暗对比（ADR-115 暂停后首次视觉调优）。 */
const CLOUD_LIGHT_ATTEN = 0.4;
/** Scattering intensity multiplier */
const CLOUD_SCATTER_INTENSITY = 0.5;
/** Minimum density threshold for volumetric sampling */
const CLOUD_DENSITY_THRESHOLD = 0.005;
/** Debug visualization Y-offset range (±30 units from cloudHeight) */
const CLOUD_DEBUG_Y_RANGE = 30;
/** Debug visualization Y-step */
const CLOUD_DEBUG_Y_STEP = 15;
/** Blue-noise texture size (square). TS and shader share this constant via template injection. */
const BLUE_NOISE_SIZE = 64;

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
    // P1 修复：场景重建时（旧 mesh/material 仍属旧 scene），缓存的纹理不能复用
    if (_noiseTex3D && _noiseTex3D.getScene() === scene) {
        return _noiseTex3D;
    }
    if (_noiseTex3D) {
        _noiseTex3D.dispose();
        _noiseTex3D = null;
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

// ======== 2D Blue-Noise Texture (64x64 R8) ========
let _blueNoiseTex: Texture | null = null;

/** Generate a 64x64 blue-noise texture using relaxed white-noise (Lloyd-style relaxation).
 *  Fast approximation: start with white noise, then iteratively push pixels toward
 *  local averages to flatten the frequency spectrum → blue-ish noise characteristics.
 *  64×64 at 20 iterations is <1ms and visually sufficient for raymarch dithering. */
function _generateBlueNoise(size: number, iterations: number): Uint8Array {
    const n = size * size;
    const data = new Uint8Array(n);

    // Step 1: initialize with white noise
    for (let i = 0; i < n; i++) {
        data[i] = Math.floor(Math.random() * 256);
    }

    // Step 2: iterative relaxation — blur and remix to push spectrum toward blue
    // Each iteration: compute 3x3 box-blurred version, then mix original + blurred
    // with a strength that decreases over iterations. This approximates blue noise
    // by reducing low-frequency correlation while preserving high-frequency detail.
    const tmp = new Uint8ClampedArray(n);
    let strength = 0.5;
    for (let iter = 0; iter < iterations; iter++) {
        // 3x3 box blur with wrap (toroidal boundary)
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let sum = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = (y + dy + size) % size;
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = (x + dx + size) % size;
                        sum += data[yy * size + xx];
                    }
                }
                const blur = sum / 9;
                const orig = data[y * size + x];
                // Mix: move toward blurred value (reduces low-freq, preserves high-freq)
                tmp[y * size + x] = Math.round(orig * (1 - strength) + blur * strength);
            }
        }
        // Copy back and decrease strength
        for (let i = 0; i < n; i++) {
            data[i] = tmp[i];
        }
        strength *= 0.85;
    }

    // Step 3: histogram equalization — ensure full 0-255 range (blue noise should have flat histogram)
    const histogram = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
        histogram[data[i]]++;
    }
    const cdf = new Float32Array(256);
    let cum = 0;
    for (let v = 0; v < 256; v++) {
        cum += histogram[v];
        cdf[v] = cum / n;
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        out[i] = Math.floor(cdf[data[i]] * 255);
    }

    return out;
}

function _ensureBlueNoiseTexture(scene: Scene): Texture {
    if (_blueNoiseTex) {
        return _blueNoiseTex;
    }
    const size = BLUE_NOISE_SIZE;
    const data = _generateBlueNoise(size, 20);
    _blueNoiseTex = new RawTexture(
        data,
        size,
        size,
        Engine.TEXTUREFORMAT_R,
        scene,
        false,
        false,
        Texture.BILINEAR_SAMPLINGMODE
    );
    _blueNoiseTex.wrapU = Texture.WRAP_ADDRESSMODE;
    _blueNoiseTex.wrapV = Texture.WRAP_ADDRESSMODE;
    console.info(`[VolCloud] Blue-noise texture created (${size}x${size})`);
    return _blueNoiseTex;
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
    // 风速放大系数 2.0：将 UI 风速（用户感知强度）映射到 shader 噪声位移速度。
    // UI 风速 1.0 对应 shader 中 2.0 单位/秒的云团漂移速度，是噪声 FBM 频率下的肉眼可辨速度。
    const speed = state.windSpeed * 2.0;
    return [(dx / dirLen) * speed, 0, (dz / dirLen) * speed];
}

// ======== Shader constants, injected from TS ========

const SHADER_CLOUD_LIGHT_ATTEN = CLOUD_LIGHT_ATTEN.toFixed(2);
const SHADER_SCATTER_INTENSITY = CLOUD_SCATTER_INTENSITY.toFixed(2);
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
uniform float groundLevel;
uniform vec3 sceneFogColor;
uniform float cloudErosion;
uniform float cloudWeatherStrength;
uniform float cloudBacklight; // Phase C: 双瓣 HG 后向瓣混合比 (0=纯前向, 1=纯后向)
uniform float cloudPowder;     // Phase C: powder 糖粉效应强度 (0=关闭, 2=强)
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform sampler3D noiseTex;
uniform sampler2D blueNoiseTex;
out vec4 fragColor;

// ===== Volumetric raymarch constants (from TS) =====
#define CLOUD_LIGHT_ATTEN ${SHADER_CLOUD_LIGHT_ATTEN}
#define CLOUD_PHASE_G 0.8
#define CLOUD_SCATTER_INTENSITY ${SHADER_SCATTER_INTENSITY}
#define CLOUD_DENSITY_THRESHOLD ${SHADER_DENSITY_THRESHOLD}
#define CLOUD_LIGHT_STEPS 2
#define CLOUD_MAX_STEPS 200
#define CLOUD_STEP_MIN 8.0
#define CLOUD_FBM_OCTAVES 3
#define NOISE_PERIOD 256.0

// Pseudo-random hash (per-fragment jitter)
float hash13(vec3 p) {
    float h = dot(p, vec3(127.1, 311.7, 74.7));
    return fract(sin(h) * 43758.5453);
}

// Dual-lobe Henyey-Greenstein phase function (front + back scatter)
float henyeyGreenstein(float cosTheta, float g) {
    return (1.0 - g*g) / (4.0 * 3.14159 * pow(1.0 + g*g - 2.0*g*cosTheta, 1.5));
}
float dualPhase(float cosTheta) {
    // Forward lobe (g=0.8) + back lobe (g=-0.2) for realistic cloud scattering
    return mix(henyeyGreenstein(cosTheta, 0.8), henyeyGreenstein(cosTheta, -0.2), cloudBacklight);
}

// Powder effect: darkens dense regions viewed against light direction
float powder(float od) {
    return 1.0 - exp(-od * 2.0 * cloudPowder);
}

// Sunset tint: blend warm orange near horizon, cool blue high up
vec3 applySunsetTint(vec3 col, vec3 lightDir) {
    // sunHeight: 1=overhead, 0=horizon, -1=below
    float sunHeight = lightDir.y;
    // Warm tint strength peaks at horizon (sunHeight ~ 0)
    float warmFactor = 1.0 - smoothstep(0.0, 0.3, abs(sunHeight));
    vec3 warmCol = vec3(1.0, 0.55, 0.25);
    return mix(col, col * warmCol, warmFactor * 0.6);
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

    // Weather map: low-frequency FBM on xz plane, controls large-scale coverage
    // Sampled at 1/50 of base frequency for broad cloud patterns
    vec3 wp = vec3(p.xz * 0.001 * cloudScale, 0.0) + 100.0;
    float weather = fbm(wp);
    float coverage = mix(1.0, smoothstep(0.3, 0.7, weather), cloudWeatherStrength);

    float n1 = fbm(p * 0.005 * cloudScale);
    float n2 = fbm(p * 0.015 * cloudScale + 33.0);
    float n3 = fbm(p * 0.05 * cloudScale + 66.0);
    // Erosion: subtract high-frequency noise from edges for wispy, curled details
    float base = n1 * 0.65 + n2 * 0.35;
    float eroded = base - (1.0 - base) * n3 * cloudErosion;
    float n = clamp(eroded, 0.0, 1.0);
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
    density *= coverage;
    density = clamp(density, 0.0, 1.0);
    return density;
}
void main(){
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);
    float maxT = cloudVisibility;

    // ===== Analytic slab intersection (horizon-safe) =====
    float tEnter, tExit;
    if (abs(rd.y) < 1e-4) {
        // Horizontal ray: only sample if camera is already within cloud layer
        if (ro.y < cloudBaseY || ro.y > cloudTopY) { discard; return; }
        tEnter = 0.0;
        tExit = maxT;
    } else {
        float tA = (cloudBaseY - ro.y) / rd.y;
        float tB = (cloudTopY  - ro.y) / rd.y;
        tEnter = max(0.0, min(tA, tB));
        tExit  = min(maxT, max(tA, tB));
        if (tEnter >= tExit) { discard; return; }
    }

    float T = 1.0;
    vec3 L = vec3(0.0);
    vec3 cloudCol = vec3(1.0, 1.0, 1.0);
    // Apply sunset tint to base cloud color and light color
    vec3 sunDirN = normalize(sunDir);
    cloudCol = applySunsetTint(cloudCol, sunDirN);
    vec3 lightCol = applySunsetTint(sceneLightColor * brightness, sunDirN);
    vec3 Ldir = normalize(-sceneLightDir);

    // Adaptive jitter with blue-noise for smoother dithering and less banding
    // Blue noise has better spatial distribution than white noise at equal sample count.
    // NOTE: 除数 ${BLUE_NOISE_SIZE} 必须与 _ensureBlueNoiseTexture() 的 size 参数一致
    // Slab-uniform dense sampling: step derived from the analytic cloud slab
    // length (tExit - tEnter) so volumetric detail is distance-independent.
    // Fixes high-altitude clouds rendering flat/distorted — the old growing
    // step (8 + t*0.03) sampled a 40-unit-thick slab with only 1-2 hits at t~325.
    float jitter = texture(blueNoiseTex, gl_FragCoord.xy / ${BLUE_NOISE_SIZE}.0).r;
    float slabLen = tExit - tEnter;
    float slabDt = clamp(slabLen / 24.0, CLOUD_STEP_MIN * 0.25, CLOUD_STEP_MIN * 1.5);
    float t = tEnter + jitter * slabDt;

    for (int i = 0; i < CLOUD_MAX_STEPS; i++) {
        float dt = slabDt;
        t += dt;
        if (t > tExit) break;
        vec3 p = ro + rd * t;

        // Ground clipping: stop marching after ray passes below ground
        if (rd.y < 0.0 && p.y < groundLevel) break;
        // Ground fade: smooth density falloff near ground (10 units above)
        float groundFade = 1.0 - smoothstep(groundLevel, groundLevel + 10.0, p.y);
        float groundMask = (rd.y < 0.0) ? (1.0 - groundFade) : 1.0;

        float d = getDensity(p, cloudDensity, windDirection) * groundMask;
        if (d > CLOUD_DENSITY_THRESHOLD) {
            // ---- Light march: integrate transmittance toward the sun ----
            // Produces volumetric self-shadowing: dense cloud in front of this
            // sample point attenuates the in-scattered light, giving the cloud
            // real depth instead of a uniform glow. CLOUD_LIGHT_STEPS (was a
            // dead #define) now drives this secondary march.
            float lightStepSize = (cloudTopY - cloudBaseY) / float(CLOUD_LIGHT_STEPS);
            vec3 toSun = Ldir;  // Ldir = normalize(-sceneLightDir) points at the sun
            vec3 lp = p;
            float lightT = 1.0;
            for (int j = 0; j < CLOUD_LIGHT_STEPS; j++) {
                lp += toSun * lightStepSize;
                float ld = getDensity(lp, cloudDensity, windDirection);
                if (ld > CLOUD_DENSITY_THRESHOLD) {
                    lightT *= max(0.0, 1.0 - ld * lightStepSize * CLOUD_LIGHT_ATTEN);
                }
            }

            float ct = max(dot(Ldir, rd), 0.0);
            // Dual-lobe phase for forward + back scatter (silver lining)
            float phase = dualPhase(ct);
            float od = d * dt;
            // Powder effect: darken dense clouds viewed against light
            float powderFactor = powder(od);
            vec3 S = cloudCol * lightCol * d * phase * dt * CLOUD_SCATTER_INTENSITY;
            S *= lightT;  // self-shadow: occluding cloud in front dims in-scatter
            L += T * S * powderFactor;
            T *= max(0.0, 1.0 - od * CLOUD_LIGHT_ATTEN);
            if (T < 0.02) break;
        }
    }

    vec3 ambient = cloudCol * 0.25 * (1.0 - T) * min(brightness * 2.0, 1.0);
    vec3 color = L + ambient;
    float alpha = 1.0 - T;
    if (alpha < 0.008) discard;

    // Distance fog: fade out distant clouds gradually without color shift
    float dist = length(vWorldPos - cameraPosition);
    float fogStart = cloudVisibility * 0.6;
    float fogFactor = smoothstep(fogStart, cloudVisibility, dist);
    color = mix(color, vec3(1.0, 1.0, 1.0), fogFactor * 0.3);
    alpha *= (1.0 - fogFactor * 0.85);

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

    // P1 修复：场景重建时（如 HMR、场景切换），模块级单例的 mesh/material
    // 仍附着在旧 scene 上。若直接复用会导致 uniform 写入废弃对象 + observer
    // 仍向旧 scene 推送事件。检测到不一致时强制 dispose 重建。
    if (_volCloudMesh && _volCloudMesh.getScene() !== scene) {
        disposeClouds();
    }
    // 球体直径 = min(40000, camera.maxZ * 1.8)，确保地平线附近顶点不被远平面裁剪
    const cam = scene.activeCamera;
    const farZ = cam?.maxZ ?? 10000;
    const SPHERE_DIAMETER = Math.min(40000, farZ * 1.8);

    // Compute wind velocity once
    const windVel = _computeWindVelocity(state);

    // Update existing material uniforms without rebuilding mesh
    if (_volCloudMesh && _volCloudMat) {
        // P3 修复：球壳直径取决于 camera.maxZ，farZ 显著变化时需重建 mesh
        // （segments 是创建时定下的 48，不能仅靠 scaling 调整）
        const prevFarZ = (_volCloudMesh.metadata?.farZ as number | undefined) ?? 0;
        if (Math.abs(farZ - prevFarZ) > 500) {
            disposeClouds();
            // 走完整重建路径
        } else {
            const halfThick = (state.cloudThickness ?? 40) / 2;
            _volCloudMat.setFloat('cloudDensity', state.cloudCover * CLOUD_DENSITY_SCALE);
            _volCloudMat.setVector3(
                'windDirection',
                new Vector3(windVel[0], windVel[1], windVel[2])
            );
            _volCloudMat.setFloat('cloudBaseY', state.cloudHeight - halfThick);
            _volCloudMat.setFloat('cloudTopY', state.cloudHeight + halfThick);
            _volCloudMat.setFloat('cloudScale', state.cloudScale);
            _volCloudMat.setFloat('cloudVisibility', state.cloudVisibility ?? 2000);
            _volCloudMat.setFloat('cloudGap', state.cloudGap ?? 0.5);
            _volCloudMat.setFloat('cloudErosion', state.cloudErosion ?? 0.4);
            _volCloudMat.setFloat('cloudWeatherStrength', state.cloudWeatherStrength ?? 0.6);
            _volCloudMat.setFloat('cloudBacklight', state.cloudBacklight ?? 0.5);
            _volCloudMat.setFloat('cloudPowder', state.cloudPowder ?? 0.8);
            _volCloudMat.setFloat('groundLevel', state.groundLevel);

            // Sync debug visualization
            _createDebugVisuals(state, scene);
            return;
        }
    }

    disposeClouds();

    // Debug visualization
    _createDebugVisuals(state, scene);

    const mesh = MeshBuilder.CreateSphere(
        'volCloud',
        { diameter: SPHERE_DIAMETER * 0.98, segments: 48, sideOrientation: Mesh.BACKSIDE },
        scene
    );
    // 在 group -1 最先渲染并写入深度，让 group 0 的角色/地面/水面自然覆盖它
    // 球壳 0.98× 略小于天空盒球壳直径，确保 Group -2 天空盒（先渲染、不写深度）
    // 已填入 framebuffer 的背景色，云层在 Group -1 正确 alpha 合成
    mesh.renderingGroupId = -1;
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
                'cloudErosion',
                'cloudWeatherStrength',
                'cloudBacklight',
                'cloudPowder',
                'sunDir',
                'sunColor',
                'brightness',
                'sceneLightDir',
                'sceneLightColor',
                'groundLevel',
                'sceneFogColor',
            ],
            samplers: ['noiseTex', 'blueNoiseTex'],
            needAlphaBlending: true,
        }
    );

    mat.backFaceCulling = false;
    mat.alpha = 1.0;
    // Bind 3D noise texture (must be after mat is created)
    const noiseTex = _ensureNoiseTexture(scene);
    mat.setTexture('noiseTex', noiseTex);
    const blueNoise = _ensureBlueNoiseTexture(scene);
    mat.setTexture('blueNoiseTex', blueNoise);

    const halfThick = (state.cloudThickness ?? 40) / 2;
    mat.setFloat('cloudDensity', state.cloudCover * CLOUD_DENSITY_SCALE);
    mat.setFloat('cloudBaseY', state.cloudHeight - halfThick);
    mat.setFloat('cloudTopY', state.cloudHeight + halfThick);
    mat.setFloat('cloudScale', state.cloudScale);
    mat.setFloat('cloudVisibility', state.cloudVisibility ?? 2000);
    mat.setFloat('cloudGap', state.cloudGap ?? 0.5);
    mat.setFloat('cloudErosion', state.cloudErosion ?? 0.4);
    mat.setFloat('cloudWeatherStrength', state.cloudWeatherStrength ?? 0.6);
    mat.setFloat('cloudBacklight', state.cloudBacklight ?? 0.5);
    mat.setFloat('cloudPowder', state.cloudPowder ?? 0.8);
    mat.setFloat('groundLevel', state.groundLevel);
    mat.setVector3('sceneLightDir', new Vector3(-0.4, -1.0, -0.3));
    mat.setColor3('sceneLightColor', new Color3(1, 0.98, 0.92));
    mat.setVector3('sunDir', new Vector3(-0.4, -1.0, -0.3));
    mat.setColor3('sunColor', new Color3(1, 0.98, 0.92));
    mat.setFloat('brightness', 1.0);
    mat.setVector3('windDirection', new Vector3(windVel[0], windVel[1], windVel[2]));
    mat.setColor3('sceneFogColor', new Color3(0.53, 0.7, 0.92));

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
            mat.setVector3('sunDir', dl.direction);
            mat.setColor3('sunColor', dl.diffuse);
            const lightIntensity = dl.intensity * 2.0;
            const brightness = Math.max(0.02, Math.min(1.5, lightIntensity));
            mat.setFloat('brightness', brightness);
        } else {
            mat.setVector3('sceneLightDir', new Vector3(-0.4, -1.0, -0.3));
            mat.setColor3('sceneLightColor', new Color3(1, 0.98, 0.92));
            mat.setVector3('sunDir', new Vector3(-0.4, -1.0, -0.3));
            mat.setColor3('sunColor', new Color3(1, 0.98, 0.92));
            mat.setFloat('brightness', 1.0);
        }
        mat.setColor3(
            'sceneFogColor',
            scene.fogEnabled ? scene.fogColor : new Color3(0.53, 0.7, 0.92)
        );
    });
    mesh.metadata = { obs, followObs, farZ };

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
    if (_blueNoiseTex) {
        _blueNoiseTex.dispose();
        _blueNoiseTex = null;
    }
}
