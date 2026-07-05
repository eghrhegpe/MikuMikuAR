import {
    Scene,
    Color3,
    Vector3,
    Texture,
    Constants,
    Mesh,
    MeshBuilder,
    ShaderMaterial,
    Observer,
    DirectionalLight,
    DefaultRenderingPipeline,
    Effect,
    PostProcess,
} from '@babylonjs/core';
import { EnvState, envState } from '../../core/config';
import { getWindVector, isWindActive } from '../../core/physics/wind-utils';
import { _envSys, getScene, ensureEnvUpdateObserver } from './env-impl';

// ======== 常量定义 ========
const WATER_BASE_SIZE = 60; // 水面基准尺寸（世界单位），通过缩放调整最终大小
const LOD_HIGH_DISTANCE = 30; // LOD 切换距离（近）
const LOD_LOW_DISTANCE = 80; // LOD 切换距离（远）
const UNDERWATER_TRANSITION_SPEED = 0.5; // 水下过渡速度（秒）

// ======== 水下状态（供 Env Update Observer 和 disposeWater 使用）========
export let _underwaterActive = false;
export let _underwaterSavedFog: { mode: number; color: Color3; density: number } | null = null;
export let _underwaterTransitionProgress = 0;
export let _underwaterTarget = false;

// ======== 波方向计算（风向联动）========
/**
 * 根据风向计算 4 层 Gerstner 波的 vec2 方向数组。
 * 主方向与风向对齐，其余 3 层以微小偏移分散，保持波浪自然丰富度。
 * 风向为零或无效时回退到默认的均匀分布方向。
 */
function computeWaveDirs(windDir: [number, number, number]): number[] {
    // Float32Array → number[] 因为 Babylon setArray2 需要 number[]
    const arr: number[] = new Array(8).fill(0); // 4 × vec2
    if (!windDir || (windDir[0] === 0 && windDir[2] === 0)) {
        // 无有效风向 → 回退到原硬编码的均匀分布
        const fallback: [number, number][] = [
            [0.8, 0.6], [-0.3, 0.9], [-0.7, -0.5], [0.5, -0.8],
        ];
        for (let i = 0; i < 4; i++) {
            const len = Math.sqrt(fallback[i][0] ** 2 + fallback[i][1] ** 2);
            arr[i * 2] = fallback[i][0] / len;
            arr[i * 2 + 1] = fallback[i][1] / len;
        }
        return arr;
    }
    // 从 windDirection 计算风向角（XZ 平面）
    const angle = Math.atan2(windDir[0], windDir[2]);
    // 4 个波方向：主方向对齐风向，其余偏移以保持波面复杂度
    const offsets = [0, 0.3, -0.2, 0.1];
    for (let i = 0; i < 4; i++) {
        const a = angle + offsets[i];
        arr[i * 2] = Math.sin(a);
        arr[i * 2 + 1] = Math.cos(a);
    }
    return arr;
}

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

// ======== 水下 Tint 后处理（自定义 PostProcess，替代不存在的 tintColor/tintAmount）========
Effect.ShadersStore['underwaterTintFragmentShader'] = [
    'precision highp float;',
    'varying vec2 vUV;',
    'uniform sampler2D textureSampler;',
    'uniform vec3 tintColor;',
    'uniform float tintAmount;',
    'void main() {',
    '    vec4 color = texture2D(textureSampler, vUV);',
    '    vec3 mixed = mix(color.rgb, tintColor, tintAmount);',
    '    gl_FragColor = vec4(mixed, color.a);',
    '}',
].join('\n');

let _tintPostProcess: PostProcess | null = null;

function ensureTintPostProcess(camera: any): void {
    if (_tintPostProcess) return;
    _tintPostProcess = new PostProcess(
        'underwaterTint',
        'underwaterTint',
        ['tintColor', 'tintAmount'],
        null,
        1.0,
        camera,
        Constants.TEXTURE_BILINEAR_SAMPLINGMODE
    );
    (_tintPostProcess as any).disable();
}

function disposeTintPostProcess(): void {
    if (_tintPostProcess) {
        _tintPostProcess.dispose();
        _tintPostProcess = null;
    }
}

export function addRipple(pos: Vector3, radius = 5, strength = 0.5, speed = 2, maxLife = 3): void {
    let idx = -1;
    let oldestLife = Infinity;
    for (let i = 0; i < _ripples.length; i++) {
        if (_ripples[i].life <= 0) {
            idx = i;
            break;
        }
        if (_ripples[i].life < oldestLife) {
            oldestLife = _ripples[i].life;
            idx = i;
        }
    }
    if (idx === -1 && _ripples.length < MAX_RIPPLES) {
        idx = _ripples.length;
        _ripples.push({
            position: new Vector3(0, 0, 0),
            radius: 0,
            strength: 0,
            speed: 0,
            life: 0,
            maxLife: 0,
        });
    }
    if (idx === -1) {
        return;
    }
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
    if (_causticTexture) {
        return _causticTexture;
    }
    const S = CAUSTIC_TEX_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(S, S);
    const data = imgData.data;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const u = x / S,
                v = y / S;
            let n = 0,
                total = 0,
                amp = 1,
                freq = 4;
            for (let o = 0; o < 3; o++) {
                n += amp * (Math.sin(u * freq * Math.PI) * Math.cos(v * freq * Math.PI));
                total += amp;
                amp *= 0.5;
                freq *= 2;
            }
            n = (n / total) * 0.5 + 0.5;
            const i = (y * S + x) * 4;
            const val = Math.floor(128 + (n - 0.5) * 128);
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
            data[i + 3] = 255;
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

// Gerstner 波参数
// WAVE_DIR 由外部 uniform uWindDir[4] 驱动（风向联动），在 createWater 时计算并传入
const int WAVE_COUNT = 4;
uniform vec2 uWindDir[4];
const float WAVE_FREQ[4] = float[4](0.15, 0.2, 0.25, 0.3);
const float WAVE_AMP[4] = float[4](0.3, 0.25, 0.2, 0.15);
const float WAVE_SPEED[4] = float[4](0.7, 0.9, 0.5, 1.2);

varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

void main() {
    vUV = uv;
    vec3 worldPos = (world * vec4(position, 1.0)).xyz;
    vec3 p = worldPos;
    vec3 n = vec3(0.0, 1.0, 0.0);

    for (int i = 0; i < WAVE_COUNT; i++) {
        vec2 dir = uWindDir[i];
        float f = WAVE_FREQ[i];
        float a = WAVE_AMP[i] * waveHeight;
        float th = f * dot(dir, p.xz) + WAVE_SPEED[i] * time * waveSpeed;
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

// ======== 可调节的视觉参数（从硬编码提取）========
uniform float fresnelBias;      // Fresnel 偏移（默认 0.02）
uniform float fresnelPower;      // Fresnel 幂次（默认 3.0）
uniform float diffuseStrength;    // 漫反射强度（默认 0.15）
uniform float ambientStrength;    // 环境光强度系数（默认 0.15）
uniform float foamTransitionRange; // 泡沫过渡范围（默认 0.15）
uniform float rippleNormalStrength; // 涟漪法线影响强度（默认 0.15）
uniform float rippleGlintStrength; // 涟漪光泽强度（默认 0.25）
uniform vec3 causticColor1;     // 焦散颜色1（亮部，默认 vec3(1.0, 0.9, 0.6)）
uniform vec3 causticColor2;     // 焦散颜色2（暗部，默认 vec3(1.0, 1.0, 0.8)）
uniform float causticScrollX;   // 焦散UV滚动速度X（默认 0.10）
uniform float causticScrollY;   // 焦散UV滚动速度Y（默认 0.15）
uniform float fresnelAlphaInfluence; // Fresnel对alpha的影响（默认 0.5）
uniform float foamAlphaInfluence;    // 泡沫对alpha的影响（默认 0.2）

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

    float fresnel = fresnelBias + (1.0 - fresnelBias) * pow(1.0 - max(dot(viewDir, normal), 0.0), fresnelPower);

    vec3 base = waterColor;
    vec3 color = mix(base, reflection, fresnel);

    float diff = max(dot(normal, normalize(lightDir)), 0.0);
    color += diff * lightColor * diffuseStrength;
    color += ambientIntensity * waterColor * ambientStrength;

    float foamH = vHeight - waterLevel;
    float foam = smoothstep(foamThreshold, foamThreshold + foamTransitionRange, foamH);
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
    vec3 rippleN = vec3(rippleSum * rippleNormalStrength, 0.0, rippleSum * rippleNormalStrength);
    normal = normalize(normal + rippleN);
    float rippleGlint = max(0.0, rippleSum * rippleGlintStrength);
    color += vec3(rippleGlint);

    vec2 causticUV = vWorldPos.xz * uCausticScale + vec2(time * uCausticSpeed * causticScrollX, time * uCausticSpeed * causticScrollY);
    float caustic = texture2D(uCausticTex, causticUV).r;
    vec3 causticCol = mix(causticColor1, causticColor2, caustic);
    color += causticCol * caustic * uCausticIntensity;

    float depth = length(vWorldPos - cameraPosition);
    float fog = 1.0 - exp(-fogDensity * depth);
    color = mix(color, fogColor, fog);

    float alpha = mix(waterTransparency, 1.0, fresnel * fresnelAlphaInfluence + foam * foamAlphaInfluence);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
}`;

// ======== Water System ========

/**
 * 同步水面材质的全部 uniform 参数（非破坏性，不销毁/重建材质）。
 * 由 createWater 在惰性路径和首次创建后调用。
 */
function _syncWaterUniforms(state: EnvState, scene: Scene): void {
    const mat = _envSys.water.material as ShaderMaterial | null;
    const mesh = _envSys.water.mesh;
    if (!mat || !mesh) {
        return;
    }

    // ——— 基础参数 ———
    mat.setFloat('waveHeight', state.waterWaveHeight);
    mat.setFloat('waveSpeed', (state.waterAnimSpeed ?? 1) * 1.0);
    mat.setColor3('waterColor', new Color3(state.waterColor[0], state.waterColor[1], state.waterColor[2]));
    mat.setFloat('waterTransparency', state.waterTransparency);
    mat.setFloat('waterLevel', state.waterLevel);

    const hasEnv = !!scene.environmentTexture;
    mat.setFloat('envIntensity', hasEnv ? (scene.environmentIntensity ?? 0.8) : 0);
    if (hasEnv && scene.environmentTexture) {
        mat.setTexture('envTexture', scene.environmentTexture);
    }

    // ——— 泡沫 ———
    mat.setColor3('foamColor', new Color3(1, 1, 1));
    mat.setFloat('foamThreshold', state.foamThreshold);
    mat.setFloat('foamIntensity', state.foamIntensity);

    // ——— 灯光 ———
    const dirLight = scene.getLightByName('dir') as DirectionalLight | null;
    if (dirLight) {
        mat.setVector3('lightDir', dirLight.direction);
        mat.setColor3('lightColor', dirLight.diffuse);
    } else {
        mat.setVector3('lightDir', new Vector3(-0.5, -1, -0.5));
        mat.setColor3('lightColor', new Color3(1, 1, 1));
    }
    mat.setFloat('ambientIntensity', 0.3);

    // ——— 焦散 ———
    const causticTex = ensureCausticTexture(scene);
    mat.setTexture('uCausticTex', causticTex);
    mat.setFloat('uCausticIntensity', 0.15);
    mat.setFloat('uCausticSpeed', 0.5);
    mat.setFloat('uCausticScale', 0.04);

    // ——— 高级参数（从 EnvState 读取，持久化）———
    mat.setFloat('fresnelBias', state.fresnelBias);
    mat.setFloat('fresnelPower', state.fresnelPower);
    mat.setFloat('diffuseStrength', state.diffuseStrength);
    mat.setFloat('ambientStrength', state.ambientStrength);
    mat.setFloat('foamTransitionRange', state.foamTransitionRange);
    mat.setFloat('rippleNormalStrength', state.rippleNormalStrength);
    mat.setFloat('rippleGlintStrength', state.rippleGlintStrength);
    mat.setVector3('causticColor1', new Vector3(state.causticColor1[0], state.causticColor1[1], state.causticColor1[2]));
    mat.setVector3('causticColor2', new Vector3(state.causticColor2[0], state.causticColor2[1], state.causticColor2[2]));
    mat.setFloat('causticScrollX', state.causticScrollX);
    mat.setFloat('causticScrollY', state.causticScrollY);
    mat.setFloat('fresnelAlphaInfluence', state.fresnelAlphaInfluence);
    mat.setFloat('foamAlphaInfluence', state.foamAlphaInfluence);

    // ——— 雾 ———
    mat.setColor3('fogColor', scene.fogColor);
    mat.setFloat('fogDensity', scene.fogDensity);

    // ——— 波方向（风向联动）———
    const windDirs = computeWaveDirs(envState.windDirection);
    mat.setArray2('uWindDir', windDirs);

    // ——— 涟漪数组（初始化为空）———
    mat.setArray4('uRipplePosRad', new Array(MAX_RIPPLES * 4).fill(0));
    mat.setArray4('uRippleStrSpdLife', new Array(MAX_RIPPLES * 4).fill(0));
    mat.setInt('uRippleCount', 0);
}

/**
 * 更新水面网格的位置和缩放（非破坏性）。
 */
function _updateWaterMesh(state: EnvState): void {
    const mesh = _envSys.water.mesh;
    if (!mesh) {
        return;
    }
    mesh.position.y = state.waterLevel;
    const scale = Math.max(1, state.waterSize / WATER_BASE_SIZE);
    mesh.scaling = new Vector3(scale, 1, scale);
}

export function createWater(state: EnvState): void {
    ensureEnvUpdateObserver();

    // **惰性路径**：水面已初始化且启用 → 只同步参数，不销毁重建
    if (state.waterEnabled && _envSys.water.material && _envSys.water.mesh) {
        const scene = getScene();
        _syncWaterUniforms(state, scene);
        _updateWaterMesh(state);
        return;
    }

    // **关闭路径**：水面未启用 → 清理资源
    if (!state.waterEnabled) {
        disposeWater();
        return;
    }

    // **首次创建路径**：水面不存在且启用 → 全量构建
    const scene = getScene();

    _waterLODs = [];
    // 使用基准尺寸创建网格，通过缩放调整最终大小（避免尺寸叠加错误）
    const meshHigh = MeshBuilder.CreateGround(
        'envWater',
        { width: WATER_BASE_SIZE, height: WATER_BASE_SIZE, subdivisions: 48 },
        scene
    );
    meshHigh.isPickable = false;
    meshHigh.position.y = state.waterLevel;
    const scale = Math.max(1, state.waterSize / WATER_BASE_SIZE);
    meshHigh.scaling = new Vector3(scale, 1, scale);

    const meshMid = MeshBuilder.CreateGround(
        'envWater_LOD1',
        { width: WATER_BASE_SIZE, height: WATER_BASE_SIZE, subdivisions: 16 },
        scene
    );
    meshMid.isPickable = false;
    meshMid.position = new Vector3(0, 0, 0); // 相对于父网格的偏移
    meshMid.parent = meshHigh; // 建立父子关系，自动继承变换

    const meshLow = MeshBuilder.CreateGround(
        'envWater_LOD2',
        { width: WATER_BASE_SIZE, height: WATER_BASE_SIZE, subdivisions: 6 },
        scene
    );
    meshLow.isPickable = false;
    meshLow.position = new Vector3(0, 0, 0); // 相对于父网格的偏移
    meshLow.parent = meshHigh; // 建立父子关系，自动继承变换

    meshHigh.addLODLevel(LOD_HIGH_DISTANCE, meshMid);
    meshHigh.addLODLevel(LOD_LOW_DISTANCE, meshLow);
    _waterLODs = [meshMid, meshLow];

    const hasEnv = !!scene.environmentTexture;
    const mat = new ShaderMaterial(
        'customWaterMat',
        scene,
        {
            vertexSource: WATER_VERT_SRC,
            fragmentSource: WATER_FRAG_SRC,
        },
        {
            attributes: ['position', 'uv', 'normal'],
            uniforms: [
                'world',
                'viewProjection',
                'time',
                'waveHeight',
                'waveSpeed',
                'cameraPosition',
                'waterColor',
                'waterTransparency',
                'waterLevel',
                'envIntensity',
                'foamColor',
                'foamThreshold',
                'foamIntensity',
                'fogColor',
                'fogDensity',
                'lightDir',
                'lightColor',
                'ambientIntensity',
                'uRipplePosRad',
                'uRippleStrSpdLife',
                'uRippleCount',
                'uCausticIntensity',
                'uCausticSpeed',
                'uCausticScale',
                'fresnelBias',
                'fresnelPower',
                'diffuseStrength',
                'ambientStrength',
                'foamTransitionRange',
                'rippleNormalStrength',
                'rippleGlintStrength',
                'causticColor1',
                'causticColor2',
                'causticScrollX',
                'causticScrollY',
                'fresnelAlphaInfluence',
                'foamAlphaInfluence',
                'uWindDir',
            ],
            uniformBuffers: [],
            samplers: ['uCausticTex'].concat(hasEnv ? ['envTexture'] : []),
            defines: hasEnv ? ['ENV_TEXTURE'] : [],
            needAlphaBlending: true,
        }
    );

    meshHigh.material = mat;
    meshMid.material = mat;
    meshLow.material = mat;

    _envSys.water.mesh = meshHigh;
    _envSys.water.material = mat;

    // 同步所有 uniform（复用 _syncWaterUniforms 逻辑）
    _syncWaterUniforms(state, scene);

    // —— 每帧更新 observer（涟漪衰减 + 动态数据）——
    if (!_waterUpdateObserver) {
        _waterUpdateObserver = scene.onBeforeRenderObservable.add(() => {
            if (!_envSys.water.material) {
                return;
            }
            const m = _envSys.water.material as ShaderMaterial;
            const now = performance.now() / 1000;
            m.setFloat('time', now);
            const cam = scene.activeCamera;
            if (cam) {
                m.setVector3('cameraPosition', cam.position);
            }
            m.setColor3('fogColor', scene.fogColor);
            m.setFloat('fogDensity', scene.fogDensity);
            const dl = scene.getLightByName('dir') as DirectionalLight | null;
            if (dl) {
                m.setVector3('lightDir', dl.direction);
                m.setColor3('lightColor', dl.diffuse);
            }

            const dt = scene.deltaTime / 1000;
            if (dt > 0) {
                let anyAlive = false;
                for (const r of _ripples) {
                    if (r.life > 0) {
                        r.life -= dt;
                        if (r.life < 0) {
                            r.life = 0;
                        }
                        if (r.life > 0) {
                            anyAlive = true;
                        }
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
                    if (r.life <= 0) {
                        continue;
                    }
                    posRad[i * 4 + 0] = r.position.x;
                    posRad[i * 4 + 1] = r.position.y;
                    posRad[i * 4 + 2] = r.position.z;
                    posRad[i * 4 + 3] = r.radius;
                    strSpdLife[i * 4 + 0] = r.strength;
                    strSpdLife[i * 4 + 1] = r.speed;
                    strSpdLife[i * 4 + 2] = r.life;
                    strSpdLife[i * 4 + 3] = 0;
                }
                m.setArray4('uRipplePosRad', posRad);
                m.setArray4('uRippleStrSpdLife', strSpdLife);
                m.setInt('uRippleCount', count);
            }
        });
    }
}

export function disposeWater(): void {
    if (_envSys.water.mesh) {
        _envSys.water.mesh.dispose(true); // true = recursive, disposes LOD children too
        _envSys.water.mesh = null;
    }
    // mesh.dispose(true) 已递归销毁所有子 LOD 网格，仅需清空引用
    _waterLODs = [];
    clearRipples(); // 清理残留涟漪，避免 dispose 后再次 createWater 时显示旧数据
    if (_envSys.water.material) {
        _envSys.water.material.dispose();
        _envSys.water.material = null;
    }
    // 释放焦散纹理，防止内存泄漏
    if (_causticTexture) {
        _causticTexture.dispose();
        _causticTexture = null;
    }
    if (_waterUpdateObserver) {
        getScene().onBeforeRenderObservable.remove(_waterUpdateObserver);
        _waterUpdateObserver = null;
    }
    _underwaterActive = false;
    _underwaterSavedFog = null;
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
    disposeTintPostProcess();
}

/**
 * 刷新水面渲染列表（钩子函数）
 * 当前为空实现，保留作为API接口，未来可能用于：
 * - 更新水的渲染顺序
 * - 响应场景图形变更（如新增/移除需要水面反射的对象）
 * - 同步水的渲染状态
 * 当前水系统通过ShaderMaterial和场景渲染自动处理，无需手动刷新
 */
export function refreshWaterRenderList(): void {}

// ======== Water Animation Speed ========
export function updateWaterAnimSpeed(speed: number): void {
    const mat = _envSys.water.material;
    if (mat) {
        mat.setFloat('waveSpeed', speed * 1.0);
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
    if (_underwaterTarget && _underwaterTransitionProgress < 1) {
        _underwaterTransitionProgress = Math.min(
            1,
            _underwaterTransitionProgress + dt / UNDERWATER_TRANSITION_SPEED
        );
    } else if (!_underwaterTarget && _underwaterTransitionProgress > 0) {
        _underwaterTransitionProgress = Math.max(
            0,
            _underwaterTransitionProgress - dt / UNDERWATER_TRANSITION_SPEED
        );
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
            envState.underwaterFogColor[2]
        );
        scene.fogDensity = envState.underwaterFogDensity * t * envState.underwaterFogMultiplier;

        // 自定义 Tint PostProcess（替代不存在的 tintColor/tintAmount）
        if (scene.activeCamera) {
            ensureTintPostProcess(scene.activeCamera);
        }
        if (_tintPostProcess) {
            (_tintPostProcess as any).enable();
            const wc = envState.waterColor;
            _tintPostProcess.onApply = (effect) => {
                effect.setFloat3('tintColor', wc[0] * 0.7, wc[1] * 0.7, wc[2] * 0.7);
                effect.setFloat(
                    'tintAmount',
                    t * envState.underwaterToneIntensity * (1 - envState.waterTransparency * 0.5)
                );
            };
        }
    } else if (!_underwaterActive) {
        pipeline.chromaticAberrationEnabled = false;
        if (_tintPostProcess) {
            (_tintPostProcess as any).disable();
        }
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
    if (_tintPostProcess) {
        (_tintPostProcess as any).disable();
    }
}

// ======== Water Presets (migrated from env-lighting.ts) =======

export interface WaterPreset {
    label: string;
    waterColor: [number, number, number];
    waterTransparency: number;
    waterWaveHeight: number;
    waterAnimSpeed: number;
    foamThreshold: number;
    foamIntensity: number;
    // 新增：从着色器硬编码提取的可调参数（可选，使用默认值如未定义）
    fresnelBias?: number;
    fresnelPower?: number;
    diffuseStrength?: number;
    ambientStrength?: number;
    foamTransitionRange?: number;
    rippleNormalStrength?: number;
    rippleGlintStrength?: number;
    causticColor1?: [number, number, number];
    causticColor2?: [number, number, number];
    causticScrollX?: number;
    causticScrollY?: number;
    fresnelAlphaInfluence?: number;
    foamAlphaInfluence?: number;
}

export const WATER_PRESETS: Record<string, WaterPreset> = {
    calm: {
        label: '平静',
        waterColor: [0.15, 0.4, 0.6],
        waterTransparency: 0.8,
        waterWaveHeight: 0.15,
        waterAnimSpeed: 0.2,
        foamThreshold: 0.35,
        foamIntensity: 0.15,
    },
    ripple: {
        label: '涟漪',
        waterColor: [0.2, 0.42, 0.62],
        waterTransparency: 0.72,
        waterWaveHeight: 0.6,
        waterAnimSpeed: 1.0,
        foamThreshold: 0.2,
        foamIntensity: 0.4,
    },
    ocean: {
        label: '海浪',
        waterColor: [0.08, 0.25, 0.5],
        waterTransparency: 0.6,
        waterWaveHeight: 1.8,
        waterAnimSpeed: 2.5,
        foamThreshold: 0.08,
        foamIntensity: 0.7,
    },
    storm: {
        label: '风暴',
        waterColor: [0.04, 0.14, 0.35],
        waterTransparency: 0.45,
        waterWaveHeight: 3.0,
        waterAnimSpeed: 5.0,
        foamThreshold: 0.04,
        foamIntensity: 0.9,
    },
    tropical: {
        label: '热带',
        waterColor: [0.1, 0.55, 0.7],
        waterTransparency: 0.7,
        waterWaveHeight: 0.8,
        waterAnimSpeed: 1.2,
        foamThreshold: 0.2,
        foamIntensity: 0.35,
    },
};

// ======== 应用水预设参数到当前材质 ========
export function applyWaterPresetToCurrent(preset: Partial<WaterPreset>): void {
    const mat = _envSys.water.material as ShaderMaterial | null;
    if (!mat) {
        return;
    }

    // 应用新增的可调参数（如果预设中有定义）
    if (preset.fresnelBias !== undefined) {
        mat.setFloat('fresnelBias', preset.fresnelBias);
    }
    if (preset.fresnelPower !== undefined) {
        mat.setFloat('fresnelPower', preset.fresnelPower);
    }
    if (preset.diffuseStrength !== undefined) {
        mat.setFloat('diffuseStrength', preset.diffuseStrength);
    }
    if (preset.ambientStrength !== undefined) {
        mat.setFloat('ambientStrength', preset.ambientStrength);
    }
    if (preset.foamTransitionRange !== undefined) {
        mat.setFloat('foamTransitionRange', preset.foamTransitionRange);
    }
    if (preset.rippleNormalStrength !== undefined) {
        mat.setFloat('rippleNormalStrength', preset.rippleNormalStrength);
    }
    if (preset.rippleGlintStrength !== undefined) {
        mat.setFloat('rippleGlintStrength', preset.rippleGlintStrength);
    }
    if (preset.causticColor1 !== undefined) {
        mat.setVector3(
            'causticColor1',
            new Vector3(preset.causticColor1[0], preset.causticColor1[1], preset.causticColor1[2])
        );
    }
    if (preset.causticColor2 !== undefined) {
        mat.setVector3(
            'causticColor2',
            new Vector3(preset.causticColor2[0], preset.causticColor2[1], preset.causticColor2[2])
        );
    }
    if (preset.causticScrollX !== undefined) {
        mat.setFloat('causticScrollX', preset.causticScrollX);
    }
    if (preset.causticScrollY !== undefined) {
        mat.setFloat('causticScrollY', preset.causticScrollY);
    }
    if (preset.fresnelAlphaInfluence !== undefined) {
        mat.setFloat('fresnelAlphaInfluence', preset.fresnelAlphaInfluence);
    }
    if (preset.foamAlphaInfluence !== undefined) {
        mat.setFloat('foamAlphaInfluence', preset.foamAlphaInfluence);
    }
}
