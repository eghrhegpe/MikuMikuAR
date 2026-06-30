import {
    Scene,
    Color3,
    Vector3,
    Texture,
    Mesh,
    MeshBuilder,
    ShaderMaterial,
    Observer,
    StandardMaterial,
    Engine,
    DirectionalLight,
    RawTexture3D,
} from '@babylonjs/core';
import { EnvState, envState } from '../core/config';
import { _envSys, getScene, getPipeline, ensureEnvUpdateObserver } from './scene-env-impl';

// ======== Cloud System Constants ========
/** Density scale factor applied to cloudCover (1.2 = 20% boost) */
const CLOUD_DENSITY_SCALE = 1.2;
/** Threshold blend factor for density calculation (0.65 = 65% coverage threshold) */
const CLOUD_THRESHOLD_FACTOR = 0.65;
/** Light attenuation factor for volumetric scattering */
const CLOUD_LIGHT_ATTEN = 0.15;
/** Phase function asymmetry parameter (0.8 = strong forward scattering) */
const CLOUD_PHASE_G = 0.8;
/** Scattering intensity multiplier */
const CLOUD_SCATTER_INTENSITY = 0.5;
/** Sigma_s (scattering coefficient) scale factor */
const CLOUD_SIGMA_S_SCALE = 0.08;
/** Maximum optical depth before early termination (5.0 = thick cloud) */
const CLOUD_MAX_OPTICAL_DEPTH = 5.0;
/** Minimum density threshold for volumetric sampling */
const CLOUD_DENSITY_THRESHOLD = 0.005;
/** Debug visualization Y-offset range (±30 units from cloudHeight) */
const CLOUD_DEBUG_Y_RANGE = 30;
/** Debug visualization Y-step */
const CLOUD_DEBUG_Y_STEP = 15;

// ======== Clouds (Phase 8) ========
const _perlinPerm: number[] = (() => {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) {
        p[i] = i;
    }
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    return p.concat(p);
})();

function _perlinFade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
}
function _perlinLerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
}
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
    return (
        _perlinLerp(
            _perlinLerp(_perlinGrad(aa, xf, yf), _perlinGrad(ba, xf - 1, yf), u),
            _perlinLerp(_perlinGrad(ab, xf, yf - 1), _perlinGrad(bb, xf - 1, yf - 1), u),
            v
        ) *
            0.5 +
        0.5
    );
}

function cloudNoise(x: number, y: number, cover: number): number {
    const v1 = perlin2(x * 0.02, y * 0.02);
    const v2 = perlin2(x * 0.04 + 10, y * 0.04 + 10) * 0.5;
    const n = v1 + v2;
    const threshold = cover * 0.8;
    const t = (n - threshold) / (1.0 - threshold);
    return Math.max(0, Math.min(1, t * t * (3 - 2 * t)));
}

// ======== 3D Noise Texture (128³) ========
let _noiseTex3D: RawTexture3D | null = null;

/** GPU-style hash (matches GLSL hash() exactly) */
function _hash3D(ix: number, iy: number, iz: number): number {
    const p = [
        (ix * 0.3183099 + 0.1) - Math.floor(ix * 0.3183099 + 0.1),
        (iy * 0.3183099 + 0.1) - Math.floor(iy * 0.3183099 + 0.1),
        (iz * 0.3183099 + 0.1) - Math.floor(iz * 0.3183099 + 0.1),
    ];
    p[0] *= 17; p[1] *= 17; p[2] *= 17;
    const v = p[0] * p[1] * p[2] * (p[0] + p[1] + p[2]);
    return v - Math.floor(v); // fract
}

/** CPU-side value noise (matches GLSL noise3D() exactly) */
function _noise3D_cpu(px: number, py: number, pz: number): number {
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    let fx = px - ix, fy = py - iy, fz = pz - iz;
    // smoothstep: f*f*(3-2*f)
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);
    const perm = _perlinPerm;
    const h = (x: number, y: number, z: number) => _hash3D(x & 255, y & 255, z & 255);
    const mix1 = (a: number, b: number, t: number) => a + t * (b - a);
    const n00 = mix1(h(ix, iy, iz),     h(ix + 1, iy, iz),     u);
    const n01 = mix1(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u);
    const n10 = mix1(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u);
    const n11 = mix1(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u);
    return mix1(mix1(n00, n01, v), mix1(n10, n11, v), w);
}

/** CPU-side FBM (matches GLSL fbm() exactly, 3 octaves) */
function _fbm_cpu(px: number, py: number, pz: number): number {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < 3; i++) {
        v += a * _noise3D_cpu(px * f, py * f, pz * f);
        a *= 0.5; f *= 2;
    }
    return v;
}

/** Generate 128³ texture storing fbm(p * 0.04) in range [0,1].
 *  Shader samples this instead of computing hash/noise3D/fbm in real-time. */
function _generateNoise3D(): Float32Array {
    const S = 128;
    const data = new Float32Array(S * S * S);
    const scale = 0.04; // matches shader: fbm(p * 0.04 * cloudScale)
    for (let z = 0; z < S; z++) {
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                // p in [0, ~5.1] for S=128, scale=0.04 → good noise frequency
                const px = x / S * 4.0, py = y / S * 4.0, pz = z / S * 4.0;
                let n = _fbm_cpu(px * scale * 100, py * scale * 100, pz * scale * 100);
                // Remap from approx [-1,1] to [0,1] for texture storage
                n = Math.max(0, Math.min(1, n * 0.5 + 0.5));
                data[z * S * S + y * S + x] = n;
            }
        }
    }
    return data;
}

function _ensureNoiseTexture(scene: Scene): RawTexture3D {
    if (_noiseTex3D) return _noiseTex3D;
    const S = 128;
    const data = _generateNoise3D();
    // @ts-ignore
    _noiseTex3D = new RawTexture3D(
        data, S, S, S, scene as any,
        data, S, S, S, scene,
        false,  // generateMipMaps
        false,  // invertY (not meaningful for 3D)
        Texture.TRILINEAR_SAMPLINGMODE,
        Engine.TEXTUREFORMAT_R, // single-channel float
    );
    _noiseTex3D.wrapU = Texture.WRAP_ADDRESSMODE;
    _noiseTex3D.wrapV = Texture.WRAP_ADDRESSMODE;
    _noiseTex3D.wrapR = Texture.WRAP_ADDRESSMODE;
    console.log('[VolCloud] 3D noise texture created (128³)');
    return _noiseTex3D;
}

// ======== Volumetric Cloud (ShaderMaterial-on-Sphere) ========
let _volCloudMesh: Mesh | null = null;
let _volCloudMat: ShaderMaterial | null = null;
let _volCloudObs: Observer<Scene> | null = null;
let _debugCloudRing: Mesh | null = null;
let _debugCloudMarkers: Mesh[] = [];

const VERT_SRC = `
#version 300 es
precision highp float;
in vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float sphereRadius;
out vec3 vWorldPos;
out float vDistFromCenter;
void main(){
    vec4 worldPos = world * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vDistFromCenter = length(worldPos.xz);
    gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const FRAG_SRC = `
precision highp float;
varying vec3 vWorldPos;
varying float vDistFromCenter;  // XZ distance from sphere center
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
uniform float sphereRadius;  // 400.0 — for horizon fade

// ======== Constants ========
#define CLOUD_LIGHT_ATTEN 0.15
#define CLOUD_PHASE_G 0.8
#define CLOUD_SCATTER_INTENSITY 0.5
#define CLOUD_SIGMA_S_SCALE 0.08
#define CLOUD_MAX_OPTICAL_DEPTH 5.0
#define CLOUD_DENSITY_THRESHOLD 0.005
#define CLOUD_LIGHT_STEPS 2  // Reduced from 4 for performance
#define CLOUD_MAX_STEPS 96   // Reduced from 200 for performance
#define CLOUD_FBM_OCTAVES 3  // Reduced from 4 for performance
#define CLOUD_THRESHOLD_FACTOR 0.65

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
    for (int i = 0; i < CLOUD_FBM_OCTAVES; i++) {
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

    float detail = fbm(p * 0.24 * cloudScale + 100.0) * 0.15;
    n += detail;

    float threshold = 1.0 - dScale * CLOUD_THRESHOLD_FACTOR;
    threshold = clamp(threshold, 0.15, 0.95);
    float t = (n - threshold) / (1.0 - threshold);
    n = clamp(t * t, 0.0, 1.0);

    n *= 1.5 * hf * distFactor;
    return max(0.0, n);
}

float phase(float ct) {
    float g = CLOUD_PHASE_G;
    float gg = g * g;
    return (1.0 - gg) / (4.0 * 3.14159 * pow(1.0 + gg - 2.0 * g * ct, 1.5));
}

void main(){
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - cameraPosition);

    int steps = 64;  // Reduced from 96 for performance
    float distToCloud = abs(cloudBaseY - cameraPosition.y);
    float stepMultiplier = clamp(distToCloud / 400.0, 0.33, 1.0);
    steps = int(float(steps) * stepMultiplier);
    if (steps < 12) steps = 12;  // Reduced from 16

    float maxDist = cloudVisibility;
    float stepSize = maxDist / float(steps);
    vec3 stepVec = rd * stepSize;
    vec3 rp = ro;

    float seed = dot(gl_FragCoord.xy, vec2(12.9898, 78.233));
    float dither = fract(sin(seed) * 43758.5453) * stepSize;
    rp += rd * dither;

    float opticalDepth = 0.0;
    float T = 1.0;
    vec3 scatter = vec3(0.0);
    float dist = 0.0;
    vec3 wind = windDirection;
    vec3 lightDir = normalize(sceneLightDir);

    for (int i = 0; i < CLOUD_MAX_STEPS; i++) {
        if (i >= steps) break;
        if (dist > maxDist) break;

        float distRatio = clamp(dist / (maxDist * 0.3), 0.0, 1.0);
        float dynamicStep = mix(stepSize * 0.5, stepSize * 1.5, distRatio * distRatio);
        dynamicStep = clamp(dynamicStep, 1.5, 15.0);  // Reduced from 2.0~20.0

        rp += rd * dynamicStep;
        dist += dynamicStep;

        float distFactor = 1.0 - smoothstep(0.0, maxDist, dist * 0.8);

        float d = getDensity(rp, cloudDensity, wind, distFactor);
        if (d > CLOUD_DENSITY_THRESHOLD) {
            opticalDepth += d * dynamicStep * 0.12;

            float lightSteps = float(CLOUD_LIGHT_STEPS);
            float lightStepSize = 4.0;
            float lightDensitySum = 0.0;
            for (int j = 0; j < 8; j++) {
                if (float(j) >= lightSteps) break;
                vec3 lightPos = rp + lightDir * lightStepSize * float(j);
                float ld = getDensity(lightPos, cloudDensity * 0.6, wind, distFactor);
                lightDensitySum += ld * lightStepSize;
            }
            float transmittance = exp(-lightDensitySum * CLOUD_LIGHT_ATTEN);

            float ct = dot(rd, -lightDir);
            float ph = phase(ct);

            vec3 sc = sceneLightColor * transmittance * ph * CLOUD_SCATTER_INTENSITY * brightness;

            float sigma_s = d * CLOUD_SIGMA_S_SCALE;
            scatter += sc * T * (1.0 - exp(-sigma_s * dynamicStep));
        }
        if (opticalDepth > CLOUD_MAX_OPTICAL_DEPTH) break;
    }

    float hg = clamp((rd.y + 0.4) / 0.9, 0.0, 1.0);
    vec3 sky = mix(vec3(0.5, 0.65, 0.85), vec3(0.25, 0.45, 0.75), hg);
    vec3 color = sky * T + scatter;

    // Horizon fade — smooth alpha near sphere edge
    float horizonFade = 1.0 - smoothstep(sphereRadius * 0.85, sphereRadius, vDistFromCenter);
    color *= horizonFade;

    color = mix(color, vec3(1.0, 0.98, 0.95), smoothstep(0.7, 0.2, T));

    float edgeIntensity = T * (1.0 - T) * 4.0;
    edgeIntensity = clamp(edgeIntensity, 0.0, 1.0);
    float backScatter = max(0.0, -dot(rd, normalize(sceneLightDir)));
    float angleFactor = pow(backScatter, 1.5) * 1.5;
    vec3 glowColor = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.95, 0.8), edgeIntensity);
    color += glowColor * edgeIntensity * angleFactor * 0.6;

    gl_FragColor = vec4(color, clamp(1.0 - T, 0.0, 0.95) * horizonFade);

    if (gl_FragColor.a < 0.05 || T > 0.95) discard;
}`;

export function createClouds(state: EnvState): void {
    if (!state.cloudsEnabled) {
        disposeClouds();
        return;
    }
    const scene = getScene();

    if (_volCloudMesh && _volCloudMat) {
        const halfThick = (state.cloudThickness ?? 40) / 2;
        _volCloudMat.setFloat('cloudDensity', state.cloudCover * CLOUD_DENSITY_SCALE);
        const windSpeed = state.windEnabled ? state.windSpeed : 0;
        _volCloudMat.setVector3(
            'windDirection',
            new Vector3(
                state.windDirection[0] * windSpeed * 2.0,
                0,
                state.windDirection[2] * windSpeed * 2.0
            )
        );
        _volCloudMat.setFloat('cloudBaseY', state.cloudHeight - halfThick);
        _volCloudMat.setFloat('cloudTopY', state.cloudHeight + halfThick);
        _volCloudMat.setFloat('cloudScale', state.cloudScale);
        _volCloudMat.setFloat('cloudVisibility', state.cloudVisibility ?? 2000);

        // Sync debug visualization positions if enabled
        if (state.debugClouds) {
            // Dispose old debug objects
            if (_debugCloudRing) {
                _debugCloudRing.dispose();
                _debugCloudRing = null;
            }
            for (const m of _debugCloudMarkers) {
                m.dispose();
            }
            _debugCloudMarkers = [];

            // Recreate at new height
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
                mMat.diffuseColor =
                    y === state.cloudHeight ? new Color3(0, 1, 0) : new Color3(1, 1, 0);
                mMat.alpha = 0.6;
                marker.material = mMat;
                _debugCloudMarkers.push(marker);
            }
        }
        return;
    }

    disposeClouds();

    // Debug visualization (red ring + yellow/green markers)
    if (state.debugClouds) {
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
        console.log('[VolCloud] DEBUG: red ring at Y=', state.cloudHeight);

        _debugCloudMarkers = [];
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
    }

    const mesh = MeshBuilder.CreateSphere(
        'volCloud',
        { diameter: 400, segments: 24, sideOrientation: Mesh.DOUBLESIDE },
        scene
    );
    mesh.isPickable = false;
    mesh.position.y = 0;

    const followObs = scene.onBeforeRenderObservable.add(() => {
        const cam = scene.activeCamera;
        if (cam) {
            mesh.position.x = cam.position.x;
            mesh.position.z = cam.position.z;
        }
    });

    const mat = new ShaderMaterial(
        'volCloudMat',
        scene,
        {
            vertexSource: VERT_SRC,
            fragmentSource: FRAG_SRC,
        },
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
                'brightness',
                'sceneLightDir',
                'sceneLightColor',
            ],
            needAlphaBlending: true,
        }
    );

    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alpha = 1.0;
    mat.transparencyMode = 2;
    mat.setFloat('sphereRadius', 200.0); // Half of diameter (400/2)

    const halfThick = (state.cloudThickness ?? 40) / 2;
    mat.setFloat('cloudDensity', state.cloudCover * CLOUD_DENSITY_SCALE);
    mat.setFloat('cloudBaseY', state.cloudHeight - halfThick);
    mat.setFloat('cloudTopY', state.cloudHeight + halfThick);
    mat.setFloat('cloudScale', state.cloudScale);
    mat.setFloat('cloudVisibility', state.cloudVisibility ?? 2000);
    mat.setVector3('sceneLightDir', new Vector3(-0.4, -1, -0.3));
    mat.setColor3('sceneLightColor', new Color3(1, 0.98, 0.92));
    mat.setFloat('brightness', 1.0);
    mat.setVector3(
        'windDirection',
        new Vector3(
            state.windDirection[0] * (state.windEnabled ? state.windSpeed : 0) * 2.0,
            0,
            state.windDirection[2] * (state.windEnabled ? state.windSpeed : 0) * 2.0
        )
    );

    // Error handling: check shader compilation
    const shaderReady = mat.isReady(mesh);
    if (!shaderReady) {
        console.error('[VolCloud] Shader compilation failed, creating fallback cloud plane');
        // Dispose the failed shader material
        mat.dispose();
        _volCloudMat = null;
        // Create fallback: simple semi-transparent plane
        const fallbackMat = new StandardMaterial('volCloudFallbackMat', scene);
        fallbackMat.diffuseColor = new Color3(0.8, 0.8, 0.9);
        fallbackMat.alpha = 0.3;
        fallbackMat.backFaceCulling = false;
        mesh.material = fallbackMat;
        _volCloudMat = null as any; // Mark as fallback
        console.warn('[VolCloud] Using fallback cloud visualization');
    }

    const startTime = performance.now();
    const obs = scene.onBeforeRenderObservable.add(() => {
        mat.setFloat('time', (performance.now() - startTime) / 1000);
        mat.setVector3('cameraPosition', scene.activeCamera.position ?? Vector3.Zero());
        const dl = scene.getLightByName('dir') as DirectionalLight;
        if (dl) {
            mat.setVector3('sceneLightDir', dl.direction);
            mat.setColor3('sceneLightColor', dl.diffuse);
            const lightIntensity = dl.intensity * 2.0;
            const brightness = Math.max(0.1, Math.min(1.5, lightIntensity));
            mat.setFloat('brightness', brightness);
        } else {
            mat.setVector3('sceneLightDir', new Vector3(-0.4, -1, -0.3));
            mat.setColor3('sceneLightColor', new Color3(1, 0.98, 0.92));
            mat.setFloat('brightness', 1.0);
        }
    });
    mesh.metadata = { obs, followObs };

    mesh.material = mat;
    _volCloudMesh = mesh;
    _volCloudMat = mat;
    _volCloudObs = obs;

    ensureEnvUpdateObserver();

    console.log('[VolCloud] Cloud system created successfully');
}

export function disposeClouds(): void {
    // Clean up debug visualization objects
    if (_debugCloudRing) {
        _debugCloudRing.dispose();
        _debugCloudRing = null;
    }
    for (const m of _debugCloudMarkers) {
        m.dispose();
    }
    _debugCloudMarkers = [];

    const scene = getScene();

    // Remove observers first (before disposing mesh/material)
    if (_volCloudMesh.metadata?.obs) {
        scene.onBeforeRenderObservable.remove(_volCloudMesh.metadata.obs);
        _volCloudMesh.metadata.obs = null;
    }
    if (_volCloudMesh.metadata?.followObs) {
        scene.onBeforeRenderObservable.remove(_volCloudMesh.metadata.followObs);
        _volCloudMesh.metadata.followObs = null;
    }
    if (_volCloudObs) {
        scene.onBeforeRenderObservable.remove(_volCloudObs);
        _volCloudObs = null;
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
}
