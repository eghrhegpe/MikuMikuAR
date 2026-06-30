import { Scene, Color3, Vector3, Texture, Mesh, MeshBuilder, ShaderMaterial, Observer, StandardMaterial } from "@babylonjs/core";
import { EnvState, envState } from "../core/config";
import { _envSys, getScene, getPipeline, ensureEnvUpdateObserver } from "./scene-env-impl";

// ======== Clouds (Phase 8) ========
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

    float detail = fbm(p * 0.24 * cloudScale + 100.0) * 0.15;
    n += detail;

    float threshold = 1.0 - dScale * 0.65;
    threshold = clamp(threshold, 0.15, 0.95);
    float t = (n - threshold) / (1.0 - threshold);
    n = clamp(t * t, 0.0, 1.0);

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
    float distToCloud = abs(cloudBaseY - cameraPosition.y);
    float stepMultiplier = clamp(distToCloud / 400.0, 0.33, 1.0);
    steps = int(float(steps) * stepMultiplier);
    if (steps < 16) steps = 16;

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

    for (int i = 0; i < 200; i++) {
        if (i >= steps) break;
        if (dist > maxDist) break;

        float distRatio = clamp(dist / (maxDist * 0.3), 0.0, 1.0);
        float dynamicStep = mix(stepSize * 0.5, stepSize * 1.5, distRatio * distRatio);
        dynamicStep = clamp(dynamicStep, 2.0, 20.0);

        rp += rd * dynamicStep;
        dist += dynamicStep;

        float distFactor = 1.0 - smoothstep(0.0, maxDist, dist * 0.8);

        float d = getDensity(rp, cloudDensity, wind, distFactor);
        if (d > 0.005) {
            opticalDepth += d * dynamicStep * 0.12;
            T = exp(-opticalDepth);

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

            float sigma_s = d * 0.08;
            scatter += sc * T * (1.0 - exp(-sigma_s * dynamicStep));
        }
        if (opticalDepth > 5.0) break;
    }

    float hg = clamp((rd.y + 0.4) / 0.9, 0.0, 1.0);
    vec3 sky = mix(vec3(0.5, 0.65, 0.85), vec3(0.25, 0.45, 0.75), hg);
    vec3 color = sky * T + scatter;

    color = mix(color, vec3(1.0, 0.98, 0.95), smoothstep(0.7, 0.2, T));

    float edgeIntensity = T * (1.0 - T) * 4.0;
    edgeIntensity = clamp(edgeIntensity, 0.0, 1.0);
    float backScatter = max(0.0, -dot(rd, normalize(sceneLightDir)));
    float angleFactor = pow(backScatter, 1.5) * 1.5;
    vec3 glowColor = mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.95, 0.8), edgeIntensity);
    color += glowColor * edgeIntensity * angleFactor * 0.6;

    gl_FragColor = vec4(color, clamp(1.0 - T, 0.0, 0.95));

    if (gl_FragColor.a < 0.05 || T > 0.95) discard;
}`;

export function createClouds(state: EnvState): void {
    const scene = getScene();

    if (_volCloudMesh) {
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
        return;
    }

    disposeClouds();
    if (!state.cloudsEnabled) return;

    const debugRing = MeshBuilder.CreateTorus("cloudDebugRing", { diameter: 100, thickness: 2, tessellation: 32 }, scene);
    debugRing.position.y = state.cloudHeight;
    debugRing.isPickable = false;
    const ringMat = new StandardMaterial("cloudDebugRingMat", scene);
    ringMat.diffuseColor = new Color3(1, 0, 0);
    ringMat.alpha = 0.4;
    ringMat.backFaceCulling = false;
    debugRing.material = ringMat;
    console.log("[VolCloud] DEBUG: red ring at Y=", state.cloudHeight);

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

    const mesh = MeshBuilder.CreateSphere("volCloud", { diameter: 400, segments: 24, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.isPickable = false;
    mesh.position.y = 0;

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
    mat.transparencyMode = 2;

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

    ensureEnvUpdateObserver();

    scene.executeWhenReady(() => {
        const ready = mat.isReady(mesh);
        console.log("[VolCloud] ShaderMaterial isReady:", ready);
        if (!ready) console.warn("[VolCloud] Shader not ready");
    });
}

export function disposeClouds(): void {
    if (_volCloudMesh && _volCloudMesh.metadata?.followObs) {
        getScene().onBeforeRenderObservable.remove(_volCloudMesh.metadata.followObs);
    }
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
}
