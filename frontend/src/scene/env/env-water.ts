import { Scene } from '@babylonjs/core/scene';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { Effect } from '@babylonjs/core/Materials/effect';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { EnvState, envState } from '@/core/config';
import { col3FromTriple } from '@/core/color-helpers';
import { _envSys, getScene, ensureEnvUpdateObserver } from './env-impl';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { createCanvasTexture } from './env-texture';
import { clamp01, logWarn } from '@/core/utils';
import { setPostProcessEnabled } from './env-type-helpers';
import WATER_VERT_SRC from './shaders/water.vert.glsl?raw';
import WATER_FRAG_SRC from './shaders/water.frag.glsl?raw';

// ======== 常量定义 ========
const WATER_BASE_SIZE = 60; // 水面基准尺寸（世界单位），通过缩放调整最终大小
const LOD_HIGH_DISTANCE = 30; // LOD 切换距离（近）
const LOD_LOW_DISTANCE = 80; // LOD 切换距离（远）
const UNDERWATER_TRANSITION_SPEED = 0.8; // 水下过渡速度（秒）

// 波方向偏移（Gerstner 波 4 层）
const WAVE_DIR_OFFSETS: [number, number, number, number] = [0, 0.3, -0.2, 0.1];
// 涟漪参数
const RIPPLE_MIN_RADIUS = 0.1;
const RIPPLE_MIN_SPEED = 0.1;
const RIPPLE_INFINITY_LIFE = 9999;
// 每秒新增涟漪上限（暴雨时碰撞频率极高，限制每秒最多 4 个，保证 256 slot 不被瞬间占满）
const RIPPLE_MAX_PER_SECOND = 4;
// 焦散着色系数（暗部底色 / 亮部增量）
const CAUSTIC_DARK_FACTOR = 0.3;
const CAUSTIC_BRIGHT_FACTOR = 0.9;
// 涟漪扩展速率
const RIPPLE_EXPANSION_RATE = 0.15;
// 涟漪 shader 衰减系数
const RIPPLE_SHADER_FADE_FACTOR = 0.8;
// deltaTime 钳制上限（秒），防止切后台返回时跳变
const DT_CLAMP_MAX = 0.1;
// 水下雾密度系数
const UNDERWATER_FOG_DENSITY_FACTOR = 0.5;

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
export function computeWaveDirs(windDir: [number, number, number]): number[] {
    // Float32Array → number[] 因为 Babylon setArray2 需要 number[]
    const arr: number[] = new Array(8).fill(0); // 4 × vec2
    if (!windDir || (windDir[0] === 0 && windDir[2] === 0)) {
        // Fail-Fast: 无有效风向直接抛错
        throw new Error('env-water: 无有效风向，请先设置风向');
    }
    // 从 windDirection 计算风向角（XZ 平面）
    const angle = Math.atan2(windDir[0], windDir[2]);
    // 4 个波方向：主方向对齐风向，其余偏移以保持波面复杂度
    const offsets = WAVE_DIR_OFFSETS;
    for (let i = 0; i < 4; i++) {
        const a = angle + offsets[i];
        arr[i * 2] = Math.sin(a);
        arr[i * 2 + 1] = Math.cos(a);
    }
    return arr;
}

// === LOD 水面：记录所有 LOD 子网格（兄弟根网格），用于同步缩放/位置和手动可见性控制 ===
let _waterLODs: Mesh[] = [];
let _activeWaterLOD = -1; // 手动 LOD 当前层级：-1=未初始化, 0=high, 1=mid, 2=low
let _waterPhase = 0; // 累计波相位，避免调节波速时相位跳变
let _waterWaveSpeed = 1; // 当前波速，供每帧相位累加使用

// === 每帧更新水面的 observer ===
let _waterUpdateObserver: Observer<Scene> | null = null;
let _waterScene: Scene | null = null;

// === 平面反射（统一平面反射引擎，ADR-092）===
// 水面用 screenSpace 模式：RenderTargetTexture + 镜像相机（_worldMatrix 镜像矩阵）+ ShaderMaterial 屏空采样。
// 互斥可恢复：启用地面反射时本引擎自动停用，地面关闭后由协调器触发重建（关地即开水）。
const waterReflection = new PlanarReflection({
    name: 'water',
    mode: 'screenSpace',
    resolutionMap: { high: 1024, medium: 512, low: 256, off: 0 },
    getQuality: (s) => s.reflectionQuality,
    getBlend: (s) => s.planarReflectBlend ?? 0.5,
    getSurfaceLevel: (s) => s.waterLevel,
    getMirrorCameraMatrix: (s, scene) => {
        const cam = scene.activeCamera;
        if (!cam) {
            return null;
        }
        // 复用 Plane 缓存，避免每帧 new Plane 分配
        return Matrix.Reflection(new Plane(0, 1, 0, -s.waterLevel)).multiply(cam.getWorldMatrix());
    },
    predicate: (mesh, level) =>
        !mesh.name.startsWith('envWater') &&
        mesh.isEnabled() &&
        mesh.getBoundingInfo().boundingBox.maximumWorld.y >= level,
    getMaterial: () => _envSys.water.material as ShaderMaterial | null,
    mount: (rt) => {
        const mat = _envSys.water.material as ShaderMaterial | null;
        if (mat) {
            mat.setTexture('reflectionTexture', rt as Texture | null);
        }
    },
    setBlend: (b) => {
        const mat = _envSys.water.material as ShaderMaterial | null;
        if (mat) {
            mat.setFloat('planarReflectBlend', b);
        }
    },
    skipWhenUnderwater: true,
    onDisable: () => {
        // 停用时保留 RT（blend=0 时隐藏反射但不销毁 RT），避免 blend 从 0→正数时闪烁
        // 仅在 quality 真正变为 off 时才销毁 RT（由 disable() 处理）
    },
});
registerReflectionSurface('water', waterReflection, () =>
    waterReflection.update(envState, getScene())
);

// ======== 涟漪系统（Interaction Ripples）========
const MAX_RIPPLES = 256;
interface RippleSource {
    position: Vector3;
    radius: number;
    strength: number;
    speed: number;
    life: number;
    maxLife: number;
    cooldown: number; // 冷却倒计时（秒），>0 时该 slot 不可被复用
}
let _ripples: RippleSource[] = [];
// 每秒新增涟漪时间累加器（_waterUpdateCallback 每帧累加 dt，满 1/RIPPLE_MAX_PER_SECOND 秒允许一次）
let _rippleAccumulator = 0;

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

function ensureTintPostProcess(camera: Camera): void {
    if (_tintPostProcess) {
        return;
    }
    _tintPostProcess = new PostProcess(
        'underwaterTint',
        'underwaterTint',
        ['tintColor', 'tintAmount'],
        null,
        1.0,
        camera,
        Constants.TEXTURE_BILINEAR_SAMPLINGMODE
    );
    // PostProcess 没有 .disable() 实例方法；用 _enabled 属性控制
    setPostProcessEnabled(_tintPostProcess, false);
}

function disposeTintPostProcess(): void {
    if (_tintPostProcess) {
        _tintPostProcess.dispose();
        _tintPostProcess = null;
    }
}

export function addRipple(pos: Vector3, radius = 5, strength = 0.5, speed = 2, maxLife = 3): void {
    // 每秒新增上限：暴雨时碰撞频率极高，限制每秒最多 4 个，保证 256 slot 不被瞬间占满
    // 累加器在 _waterUpdateCallback 每帧累加 dt；此处减去 interval 消费一个配额。
    // 高频调用时累加器可能暂时为负，guard 会持续拒绝直到自然回升——此行为预期。
    const interval = 1 / RIPPLE_MAX_PER_SECOND;
    if (_rippleAccumulator < interval) {
        return;
    }
    _rippleAccumulator -= interval;

    let idx = -1;
    let oldestLife = Infinity;
    for (let i = 0; i < _ripples.length; i++) {
        const r = _ripples[i];
        // 优先复用已死亡且冷却完毕的 slot
        if (r.life <= 0 && r.cooldown <= 0) {
            idx = i;
            break;
        }
        // 次选：找生命最短的（但需冷却完毕）
        if (r.cooldown <= 0 && r.life < oldestLife) {
            oldestLife = r.life;
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
            cooldown: 0,
        });
    }
    if (idx === -1) {
        return; // 所有 slot 都在冷却中，丢弃本次涟漪
    }
    const r = _ripples[idx];
    r.position.copyFrom(pos);
    r.radius = Math.max(RIPPLE_MIN_RADIUS, radius);
    r.strength = clamp01(strength);
    r.speed = Math.max(RIPPLE_MIN_SPEED, speed);
    r.life = maxLife > 0 ? maxLife : RIPPLE_INFINITY_LIFE;
    r.maxLife = maxLife;
    // 冷却期 = 涟漪寿命：确保 slot 在涟漪完整播放期间不被复用，保证动画连续性
    r.cooldown = r.maxLife;
}

export function clearRipples(): void {
    _ripples = [];
    _rippleAccumulator = 0;
}

// ======== 焦散系统（静态纹理 + UV 滚动）========
let _causticTexture: Texture | null = null;
let _causticScene: Scene | null = null;
let _lastCausticColor: [number, number, number] | null = null;
const CAUSTIC_TEX_SIZE = 128;

// ADR-115 P1: 高频法线细节纹理（程序化生成，单例，不随水色变化）
let _detailNormalTexture: Texture | null = null;
let _detailNormalScene: Scene | null = null;
const DETAIL_NORMAL_TEX_SIZE = 512;

function regenerateCausticTexture(scene: Scene, waterColor: [number, number, number]): void {
    const S = CAUSTIC_TEX_SIZE;
    // 经统一工厂创建（优先 DynamicTexture，回退 toDataURL→Texture）。
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        const imgData = ctx.createImageData(s, s);
        const data = imgData.data;

        // 用水色对灰度焦散图案着色：暗部用水色×0.5，亮部用水色
        const [wr, wg, wb] = waterColor;

        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                const u = x / s,
                    v = y / s;
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
                n = (n / total) * 0.5 + 0.5; // 灰度 0~1

                // 灰度映射到 [水色×DARK, 水色×BRIGHT]，让暗部偏水色，亮部更亮
                const i = (y * s + x) * 4;
                const t = n; // 0=暗纹, 1=亮纹
                data[i] = Math.min(
                    255,
                    Math.floor((wr * CAUSTIC_DARK_FACTOR + t * wr * CAUSTIC_BRIGHT_FACTOR) * 255)
                );
                data[i + 1] = Math.min(
                    255,
                    Math.floor((wg * CAUSTIC_DARK_FACTOR + t * wg * CAUSTIC_BRIGHT_FACTOR) * 255)
                );
                data[i + 2] = Math.min(
                    255,
                    Math.floor((wb * CAUSTIC_DARK_FACTOR + t * wb * CAUSTIC_BRIGHT_FACTOR) * 255)
                );
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imgData, 0, 0);
    };

    if (_causticTexture) {
        _causticTexture.dispose();
        _causticTexture = null;
    }
    // 焦散纹理直调 createCanvasTexture（不经 _texCache）：水面单实例，随颜色变化重建；
    // 重建前已 dispose 旧纹理（上方程序 272-275），水 dispose 时一并释放。
    _causticTexture = createCanvasTexture({
        size: S,
        draw,
        scene,
        name: 'waterCaustic',
        wrap: 'wrap',
    });
    _causticScene = scene;
    _lastCausticColor = [...waterColor];
}

function ensureCausticTexture(scene: Scene, waterColor: [number, number, number]): Texture {
    const needsRegen =
        !_causticTexture ||
        _causticScene !== scene ||
        !_lastCausticColor ||
        _lastCausticColor.some((v, i) => Math.abs(v - waterColor[i]) > 0.01);

    if (_causticTexture && !needsRegen) {
        return _causticTexture;
    }
    regenerateCausticTexture(scene, waterColor);
    return _causticTexture!;
}

// ======== ADR-115 P1: 程序化法线细节纹理 ========
// 生成 512×512 双通道噪声法线图：多层 Value noise 叠加 → 中心差分求法线
// 纹理编码：R=世界X梯度, G=世界Z梯度, B=世界Y(上, ~1.0)
function _hash2d(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function _valueNoise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const a = _hash2d(ix, iy);
    const b = _hash2d(ix + 1, iy);
    const c = _hash2d(ix, iy + 1);
    const d = _hash2d(ix + 1, iy + 1);
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function regenerateDetailNormalTexture(scene: Scene): void {
    const S = DETAIL_NORMAL_TEX_SIZE;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        const imgData = ctx.createImageData(s, s);
        const data = imgData.data;
        const heights = new Float32Array(s * s);

        // 4 层 octave 叠加生成高度图
        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                let h = 0, amp = 1, freq = 1;
                for (let oct = 0; oct < 4; oct++) {
                    h += _valueNoise((x * freq) / s, (y * freq) / s) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                heights[y * s + x] = h;
            }
        }

        // 中心差分求法线，编码到 RGB
        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                const xl = heights[y * s + ((x - 1 + s) % s)];
                const xr = heights[y * s + ((x + 1) % s)];
                const yl = heights[((y - 1 + s) % s) * s + x];
                const yr = heights[((y + 1) % s) * s + x];
                const nx = (xl - xr) * 0.5;
                const ny = (yl - yr) * 0.5;
                const nz = 1.0;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                const i = (y * s + x) * 4;
                data[i] = Math.floor(((nx / len) * 0.5 + 0.5) * 255);
                data[i + 1] = Math.floor(((ny / len) * 0.5 + 0.5) * 255);
                data[i + 2] = Math.floor(((nz / len) * 0.5 + 0.5) * 255);
                data[i + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    };

    if (_detailNormalTexture) {
        _detailNormalTexture.dispose();
        _detailNormalTexture = null;
    }
    _detailNormalTexture = createCanvasTexture({
        size: S,
        draw,
        scene,
        name: 'waterDetailNormal',
        wrap: 'wrap',
    });
    _detailNormalScene = scene;
}

function ensureDetailNormalTexture(scene: Scene): Texture {
    if (_detailNormalTexture && _detailNormalScene === scene) {
        return _detailNormalTexture;
    }
    regenerateDetailNormalTexture(scene);
    return _detailNormalTexture!;
}

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
    // ADR-115 P4: 双层尺度 — 大波/小波独立振幅缩放，?? 1.0 兜底防 NaN
    mat.setFloat('bigWaveHeight', state.bigWaveHeight ?? 1.0);
    mat.setFloat('smallWaveHeight', state.smallWaveHeight ?? 1.0);
    _waterWaveSpeed = (state.waterAnimSpeed ?? 1) * 1.0;
    mat.setFloat('wavePhase', _waterPhase);
    mat.setColor3('waterColor', col3FromTriple(state.waterColor));
    mat.setFloat('waterTransparency', state.waterTransparency);
    mat.setFloat('waterLevel', state.waterLevel);
    mat.setInt('uWaterFlip', state.waterFlip ? 1 : 0);

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

    // ——— 焦散（随 waterColor 重新生成）——
    const causticTex = ensureCausticTexture(scene, state.waterColor);
    mat.setTexture('uCausticTex', causticTex);
    mat.setFloat('uCausticIntensity', state.causticIntensity);
    mat.setFloat('uCausticSpeed', 0.5);
    mat.setFloat('uCausticScale', 0.04);

    // ——— ADR-115 P1: 高频法线扰动层 + Sun Glitter ——

    const detailNormalTex = ensureDetailNormalTexture(scene);
    mat.setTexture('uDetailNormalTex', detailNormalTex);
    mat.setFloat('uDetailNormalStrength', state.waterNormalStrength);
    mat.setFloat('uDetailNormalTiling1', 0.1);
    mat.setFloat('uDetailNormalTiling2', 0.3);
    mat.setFloat('uDetailNormalSpeed1', 0.05);
    mat.setFloat('uDetailNormalSpeed2', -0.08);
    mat.setFloat('uGlintStrength', state.waterGlintStrength);
    mat.setFloat('uGlintPower', 96);
    mat.setFloat('uGlintScale', 80.0);
    mat.setFloat('uGlintSpeed', 2.0);

    // ——— ADR-115 P3: 地平线淡出 + 天空-水面颜色联动 ———
    // 天空基准色：优先 skyColorBot，fallback waterFogColor
    const skyBot = state.skyColorBot ?? state.waterFogColor;
    mat.setVector3('uSkyBlendColor', new Vector3(skyBot[0], skyBot[1], skyBot[2]));
    mat.setFloat('uSkyColorBlend', state.waterSkyColorBlend ?? 0);
    // 地平线淡出距离按 waterSize 自动计算
    const ws = state.waterSize;
    mat.setFloat('uHorizonFade', state.waterHorizonFade ?? 0);
    mat.setFloat('uHorizonStart', ws * 0.7);
    mat.setFloat('uHorizonEnd', ws * 0.95);
    // 地平线融合色：优先 skyColorBot，fallback waterFogColor
    mat.setVector3('uHorizonColor', new Vector3(skyBot[0], skyBot[1], skyBot[2]));

    // ——— 高级参数（从 EnvState 读取，持久化）———
    mat.setFloat('fresnelBias', state.fresnelBias);
    mat.setFloat('fresnelPower', state.fresnelPower);
    mat.setFloat('diffuseStrength', state.diffuseStrength);
    mat.setFloat('ambientStrength', state.ambientStrength);
    mat.setFloat('foamTransitionRange', state.foamTransitionRange);
    mat.setFloat('rippleNormalStrength', state.rippleNormalStrength);
    mat.setFloat('rippleGlintStrength', state.rippleGlintStrength);
    mat.setVector3(
        'causticColor1',
        new Vector3(state.causticColor1[0], state.causticColor1[1], state.causticColor1[2])
    );
    mat.setVector3(
        'causticColor2',
        new Vector3(state.causticColor2[0], state.causticColor2[1], state.causticColor2[2])
    );
    mat.setFloat('causticScrollX', state.causticScrollX);
    mat.setFloat('causticScrollY', state.causticScrollY);
    mat.setFloat('fresnelAlphaInfluence', state.fresnelAlphaInfluence);
    mat.setFloat('foamOpacity', state.foamOpacity);
    mat.setColor3('waterFogColor', col3FromTriple(state.waterFogColor));
    mat.setFloat('waterFogDensity', state.waterFogDensity);
    mat.setFloat('waterFogOpacityInfluence', state.waterFogOpacityInfluence);

    // ——— 波方向（风向联动）———
    const windDirs = computeWaveDirs(state.windDirection);
    mat.setArray2('uWindDir', windDirs);

    // ——— 涟漪数组（初始化为空）———
    mat.setArray4('uRipplePosRad', new Array(MAX_RIPPLES * 4).fill(0));
    mat.setArray4('uRippleStrSpdLife', new Array(MAX_RIPPLES * 4).fill(0));
    mat.setInt('uRippleCount', 0);

    // ——— 平面反射（ADR-062）———
    mat.setFloat('planarReflectBlend', state.planarReflectBlend ?? 0.5);
}

// ══════════════════════════════════════════════════════════════
// 平面反射（ADR-062 P1）：委托统一平面反射引擎（ADR-092）
// ══════════════════════════════════════════════════════════════

/** 初始化/更新水面平面反射：委托给统一引擎（创建 RT、镜像相机、挂载、互斥）。 */
function _setupMirrorRT(scene: Scene, state: EnvState): void {
    waterReflection.update(state, scene);
}

/**
 * 更新水面网格的位置和缩放（非破坏性）。所有 LOD 层同步变换。
 */
function _updateWaterMesh(state: EnvState): void {
    const scale = Math.max(1, state.waterSize / WATER_BASE_SIZE);
    const rotX = state.waterFlip ? Math.PI : 0;
    const meshes: Mesh[] = [];
    if (_envSys.water.mesh) {
        meshes.push(_envSys.water.mesh);
    }
    meshes.push(..._waterLODs);
    for (const m of meshes) {
        m.position.y = state.waterLevel;
        m.scaling = new Vector3(scale, 1, scale);
        m.rotation.x = rotX;
    }
}

/**
 * 按相机到水面的距离选择 LOD 层级（纯函数，便于单测）。
 * 0=近景高精度, 1=中景, 2=远景低精度。
 */
export function selectWaterLOD(distance: number): 0 | 1 | 2 {
    if (distance > LOD_LOW_DISTANCE) {
        return 2;
    }
    if (distance > LOD_HIGH_DISTANCE) {
        return 1;
    }
    return 0;
}

/**
 * 按相机到水面的距离手动切换 LOD 可见性（仅 0/1/2 三层中恰好一层 enabled），
 * 规避 Babylon addLODLevel 的父子/兄弟重复渲染问题。仅当层级变化时才 setEnabled。
 */
export function _applyWaterLOD(scene: Scene): void {
    const high = _envSys.water.mesh;
    if (!high || _waterLODs.length < 2) {
        return;
    }
    const cam = scene.activeCamera;
    if (!cam) {
        return;
    }
    const dist = Vector3.Distance(cam.globalPosition, high.getAbsolutePosition());
    const level = selectWaterLOD(dist);
    if (level === _activeWaterLOD) {
        return;
    }
    _activeWaterLOD = level;
    high.setEnabled(level === 0);
    _waterLODs[0].setEnabled(level === 1);
    _waterLODs[1].setEnabled(level === 2);
}

const WATER_UNIFORMS = [
    'world',
    'viewProjection',
    'time',
    'waveHeight',
    'bigWaveHeight',
    'smallWaveHeight',
    'wavePhase',
    'cameraPosition',
    'waterColor',
    'waterTransparency',
    'waterLevel',
    'uWaterFlip',
    'envIntensity',
    'foamColor',
    'foamThreshold',
    'foamIntensity',
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
    'foamOpacity',
    'waterFogColor',
    'waterFogDensity',
    'waterFogOpacityInfluence',
    'uWindDir',
    'planarReflectBlend',
    // ADR-115 P1: 高频法线扰动 + Sun Glitter
    'uDetailNormalStrength',
    'uDetailNormalTiling1',
    'uDetailNormalTiling2',
    'uDetailNormalSpeed1',
    'uDetailNormalSpeed2',
    'uGlintStrength',
    'uGlintPower',
    'uGlintScale',
    'uGlintSpeed',
    // ADR-115 P3: 地平线淡出 + 天空联动
    'uHorizonFade',
    'uHorizonStart',
    'uHorizonEnd',
    'uHorizonColor',
    'uSkyBlendColor',
    'uSkyColorBlend',
];

function _createWaterMaterial(scene: Scene, state: EnvState): ShaderMaterial {
    const hasEnv = !!scene.environmentTexture;
    const hasReflection = state.reflectionQuality !== 'off';
    const mat = new ShaderMaterial(
        'customWaterMat',
        scene,
        { vertexSource: WATER_VERT_SRC, fragmentSource: WATER_FRAG_SRC },
        {
            attributes: ['position', 'uv', 'normal'],
            uniforms: WATER_UNIFORMS,
            uniformBuffers: [],
            samplers: ['uCausticTex', 'uDetailNormalTex']
                .concat(hasEnv ? ['envTexture'] : [])
                .concat(hasReflection ? ['reflectionTexture'] : []),
            defines: (hasEnv ? ['ENV_TEXTURE'] : []).concat(
                hasReflection ? ['PLANAR_REFLECTION'] : []
            ),
            needAlphaBlending: true,
        }
    );
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    return mat;
}

/** 重建水面材质（切换 PLANAR_REFLECTION define 时必须），保持网格与 LOD 引用一致。 */
function _rebuildWaterMaterial(scene: Scene, state: EnvState): void {
    const oldMat = _envSys.water.material;
    const newMat = _createWaterMaterial(scene, state);
    if (_envSys.water.mesh) {
        _envSys.water.mesh.material = newMat;
    }
    for (const lod of _waterLODs) {
        lod.material = newMat;
    }
    _envSys.water.material = newMat;
    oldMat?.dispose();
}

function _waterUpdateCallback(scene: Scene): void {
    // 防御：disposeWater 后 observer 仍可能触发一帧（如 scene 已 dispose 但 observer 未摘除）
    if (scene.isDisposed) {
        return;
    }
    if (!_envSys.water.material) {
        return;
    }
    const m = _envSys.water.material as ShaderMaterial;
    const dt = Math.min(scene.deltaTime / 1000, DT_CLAMP_MAX);
    // 每秒新增涟漪时间累加器：每帧累加 dt，满 1/RIPPLE_MAX_PER_SECOND 秒允许一次
    if (dt > 0) {
        _rippleAccumulator += dt;
    }
    const now = performance.now() / 1000;

    _waterPhase += dt * _waterWaveSpeed;
    m.setFloat('time', now);
    m.setFloat('wavePhase', _waterPhase);
    const cam = scene.activeCamera;
    if (cam) {
        m.setVector3('cameraPosition', cam.position);
    }
    m.setColor3('waterColor', col3FromTriple(envState.waterColor));
    const dl = scene.getLightByName('dir') as DirectionalLight | null;
    if (dl) {
        m.setVector3('lightDir', dl.direction);
        m.setColor3('lightColor', dl.diffuse);
    }

    // 涟漪衰减 + 冷却递减
    if (dt > 0) {
        let anyAlive = false;
        for (const r of _ripples) {
            if (r.life > 0) {
                r.life = Math.max(0, r.life - dt);
                if (r.life > 0) {
                    anyAlive = true;
                }
            }
            // 冷却倒计时（即使 life 已耗尽，冷却仍在继续）
            if (r.cooldown > 0) {
                r.cooldown = Math.max(0, r.cooldown - dt);
            }
        }
        if (!anyAlive && _ripples.length > 0) {
            // 全部死亡且冷却完毕才清空，避免残留冷却 slot
            const allCooldownDone = _ripples.every((r) => r.cooldown <= 0);
            if (allCooldownDone) {
                _ripples = [];
            }
        }
    }

    waterReflection.update(envState, scene);
    _applyWaterLOD(scene);

    // 上传涟漪数据到 shader
    const posRad = new Array<number>(MAX_RIPPLES * 4).fill(0);
    const strSpdLife = new Array<number>(MAX_RIPPLES * 4).fill(0);
    let aliveCount = 0;
    for (const r of _ripples) {
        if (r.life <= 0 || aliveCount >= MAX_RIPPLES) {
            continue;
        }
        const i = aliveCount * 4;
        posRad[i] = r.position.x;
        posRad[i + 1] = r.position.y;
        posRad[i + 2] = r.position.z;
        posRad[i + 3] = r.radius;
        strSpdLife[i] = r.strength;
        strSpdLife[i + 1] = r.speed;
        strSpdLife[i + 2] = r.life;
        strSpdLife[i + 3] = r.maxLife;
        aliveCount++;
    }
    m.setArray4('uRipplePosRad', posRad);
    m.setArray4('uRippleStrSpdLife', strSpdLife);
    m.setInt('uRippleCount', aliveCount);
}

export function createWater(state: EnvState): void {
    ensureEnvUpdateObserver();

    // 惰性路径：已初始化 → 只同步参数
    if (state.waterEnabled && _envSys.water.material && _envSys.water.mesh) {
        const scene = getScene();
        // P1 修复：reflectionQuality 跨 off↔非 off 时材质 define 需切换，强制重建
        const needReflect = state.reflectionQuality !== 'off';
        const hasReflect = !!_envSys.water.material.options.defines?.includes('PLANAR_REFLECTION');
        if (needReflect !== hasReflect) {
            _rebuildWaterMaterial(scene, state);
        }
        _syncWaterUniforms(state, scene);
        _updateWaterMesh(state);
        _setupMirrorRT(scene, state);
        _applyWaterLOD(scene);
        return;
    }

    if (!state.waterEnabled) {
        disposeWater();
        return;
    }

    // 首次创建
    const scene = getScene();
    if (!scene) {
        logWarn('env-water', 'createWater: scene not ready');
        return;
    }

    const scale = Math.max(1, state.waterSize / WATER_BASE_SIZE);
    const rotX = state.waterFlip ? Math.PI : 0;
    const makeGround = (name: string, subdivisions: number): Mesh => {
        const m = MeshBuilder.CreateGround(
            name,
            { width: WATER_BASE_SIZE, height: WATER_BASE_SIZE, subdivisions },
            scene
        );
        m.isPickable = false;
        m.position.y = state.waterLevel;
        m.scaling = new Vector3(scale, 1, scale);
        m.rotation.x = rotX;
        return m;
    };

    const meshHigh = makeGround('envWater', 48);
    const meshMid = makeGround('envWater_LOD1', 16);
    const meshLow = makeGround('envWater_LOD2', 6);
    meshMid.setEnabled(false);
    meshLow.setEnabled(false);
    _waterLODs = [meshMid, meshLow];
    _activeWaterLOD = 0;

    const mat = _createWaterMaterial(scene, state);
    meshHigh.material = mat;
    meshMid.material = mat;
    meshLow.material = mat;
    _envSys.water.mesh = meshHigh;
    _envSys.water.material = mat;

    _syncWaterUniforms(state, scene);
    _setupMirrorRT(scene, state);
    _applyWaterLOD(scene);

    if (!_waterUpdateObserver) {
        _waterScene = scene;
        _waterUpdateObserver = scene.onBeforeRenderObservable.add(() =>
            _waterUpdateCallback(scene)
        );
    }
}

export function disposeWater(): void {
    // LOD 网格为兄弟根网格（非父子），需显式销毁
    for (const lod of _waterLODs) {
        lod.dispose();
    }
    if (_envSys.water.mesh) {
        _envSys.water.mesh.dispose(true); // true = recursive
        _envSys.water.mesh = null;
    }
    _waterLODs = [];
    _activeWaterLOD = -1;
    _waterPhase = 0;
    _waterWaveSpeed = 1;
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
    _causticScene = null;
    _lastCausticColor = null;
    // ADR-115 P1: 释放法线细节纹理
    if (_detailNormalTexture) {
        _detailNormalTexture.dispose();
        _detailNormalTexture = null;
    }
    _detailNormalScene = null;
    if (_waterUpdateObserver) {
        // 使用注册时捕获的 scene 引用摘除，避免 getScene() 在 scene 已 dispose 时返回 null 导致漏删
        if (_waterScene) {
            _waterScene.onBeforeRenderObservable.remove(_waterUpdateObserver);
        }
        _waterUpdateObserver = null;
        _waterScene = null;
    }
    _underwaterActive = false;
    _underwaterSavedFog = null;
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
    // 清理平面反射（委托引擎：释放 RT、镜像相机、移出 customRenderTargets、清材质引用）
    waterReflection.dispose();
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
    // 只更新累加速率：相位由每帧 observer 累加，改波速不会造成相位跳变
    // 不直接操作材质 uniform（由 _syncWaterUniforms / 每帧 observer 统一同步），
    // 避免与 setEnvState → _syncWaterUniforms 重复写入 _waterWaveSpeed。
    _waterWaveSpeed = speed;
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
        const wc = envState.waterColor;
        scene.fogColor = new Color3(
            wc[0] * envState.underwaterTintStrength,
            wc[1] * envState.underwaterTintStrength,
            wc[2] * envState.underwaterTintStrength
        );
        scene.fogDensity = envState.underwaterFogDensity * t * UNDERWATER_FOG_DENSITY_FACTOR;

        // 自定义 Tint PostProcess（替代不存在的 tintColor/tintAmount）
        if (scene.activeCamera) {
            ensureTintPostProcess(scene.activeCamera);
        }
        if (_tintPostProcess) {
            setPostProcessEnabled(_tintPostProcess, true);
            const wc = envState.waterColor;
            _tintPostProcess.onApply = (effect) => {
                // tintColor 由 waterColor × underwaterTintStrength 派生（默认强度 0.5，即水色×0.5）
                effect.setFloat3(
                    'tintColor',
                    wc[0] * envState.underwaterTintStrength,
                    wc[1] * envState.underwaterTintStrength,
                    wc[2] * envState.underwaterTintStrength
                );
                effect.setFloat(
                    'tintAmount',
                    t * envState.underwaterToneIntensity * (1 - envState.waterTransparency * 0.5)
                );
            };
        }
    } else if (!_underwaterActive) {
        pipeline.chromaticAberrationEnabled = false;
        if (_tintPostProcess) {
            setPostProcessEnabled(_tintPostProcess, false);
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
        setPostProcessEnabled(_tintPostProcess, false);
    }
}

// ======== Water Presets (migrated from env-lighting.ts) =======

export interface WaterPreset {
    label: string;
    waterColor: [number, number, number];
    waterTransparency: number;
    waterWaveHeight: number;
    // ADR-115 P4: 双层尺度拆分
    bigWaveHeight: number;
    smallWaveHeight: number;
    waterAnimSpeed: number;
    foamThreshold: number;
    foamIntensity: number;
    waterFogColor: [number, number, number];
    waterFogDensity: number;
    waterFogOpacityInfluence: number;
    // 新增：从着色器硬编码提取的可调参数（可选，使用默认值如未定义）
    fresnelBias?: number;
    fresnelPower?: number;
    diffuseStrength?: number;
    ambientStrength?: number;
    foamTransitionRange?: number;
    rippleNormalStrength?: number;
    rippleGlintStrength?: number;
    causticIntensity?: number;
    causticColor1?: [number, number, number];
    causticColor2?: [number, number, number];
    causticScrollX?: number;
    causticScrollY?: number;
    fresnelAlphaInfluence?: number;
    foamOpacity?: number;
    // ADR-115 P1: 高频法线扰动 + Sun Glitter
    waterNormalStrength?: number;
    waterGlintStrength?: number;
    // ADR-115 P3: 地平线淡出 + 天空联动
    waterHorizonFade?: number;
    waterSkyColorBlend?: number;
}

export const WATER_PRESETS: Record<string, WaterPreset> = {
    calm: {
        label: '平静',
        waterColor: [0.15, 0.4, 0.6],
        waterTransparency: 0.88,
        waterWaveHeight: 0.15,
        bigWaveHeight: 0.3,
        smallWaveHeight: 0.5,
        waterAnimSpeed: 0.2,
        foamThreshold: 0.35,
        foamIntensity: 0.12,
        waterFogColor: [0.5, 0.52, 0.62],
        waterFogDensity: 0.006,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.35,
        foamOpacity: 0.5,
        causticIntensity: 0.1,
        waterNormalStrength: 0.15,
        waterGlintStrength: 0,
    },
    ripple: {
        label: '涟漪',
        waterColor: [0.2, 0.42, 0.62],
        waterTransparency: 0.8,
        waterWaveHeight: 0.6,
        bigWaveHeight: 0.6,
        smallWaveHeight: 1.0,
        waterAnimSpeed: 1.0,
        foamThreshold: 0.25,
        foamIntensity: 0.3,
        waterFogColor: [0.48, 0.5, 0.6],
        waterFogDensity: 0.009,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.4,
        foamOpacity: 0.55,
        causticIntensity: 0.15,
        waterNormalStrength: 0.3,
        waterGlintStrength: 0.1,
    },
    ocean: {
        label: '海浪',
        waterColor: [0.08, 0.25, 0.5],
        waterTransparency: 0.65,
        waterWaveHeight: 1.8,
        bigWaveHeight: 1.5,
        smallWaveHeight: 0.8,
        waterAnimSpeed: 2.5,
        foamThreshold: 0.12,
        foamIntensity: 0.55,
        waterFogColor: [0.4, 0.42, 0.55],
        waterFogDensity: 0.014,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.5,
        foamOpacity: 0.65,
        causticIntensity: 0.2,
        waterNormalStrength: 0.4,
        waterGlintStrength: 0.2,
    },
    storm: {
        label: '风暴',
        waterColor: [0.04, 0.14, 0.35],
        waterTransparency: 0.5,
        waterWaveHeight: 3.0,
        bigWaveHeight: 2.0,
        smallWaveHeight: 0.5,
        waterAnimSpeed: 5.0,
        foamThreshold: 0.08,
        foamIntensity: 0.7,
        waterFogColor: [0.35, 0.36, 0.48],
        waterFogDensity: 0.022,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.6,
        foamOpacity: 0.7,
        causticIntensity: 0.25,
        waterNormalStrength: 0.5,
        waterGlintStrength: 0.05,
    },
    tropical: {
        label: '热带',
        waterColor: [0.1, 0.55, 0.7],
        waterTransparency: 0.78,
        waterWaveHeight: 0.8,
        bigWaveHeight: 0.8,
        smallWaveHeight: 1.2,
        waterAnimSpeed: 1.2,
        foamThreshold: 0.25,
        foamIntensity: 0.25,
        waterFogColor: [0.45, 0.58, 0.62],
        waterFogDensity: 0.008,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.42,
        foamOpacity: 0.55,
        causticIntensity: 0.2,
        waterNormalStrength: 0.35,
        waterGlintStrength: 0.3,
    },
};

/**
 * 测试/调试用：读取当前累计波相位。
 * 相位由每帧累加（dt × 波速），改波速只改变累加速率，不会造成相位跳变。
 */
export function getWaterPhase(): number {
    return _waterPhase;
}

/**
 * 测试/调试用：读取当前波速累加速率。
 */
export function getWaterWaveSpeed(): number {
    return _waterWaveSpeed;
}

/**
 * 预设 → EnvState 完整字段映射（含扩展参数），供 UI chip handler 调用并持久化。
 * 修复前扩展参数仅由 applyWaterPresetToCurrent 写入材质、不进 envState，
 * 会被后续任意 envState 变化还原；此处一并写入，由 _syncWaterUniforms 统一应用。
 */
export function buildWaterPresetEnvState(preset: WaterPreset): Partial<EnvState> {
    return {
        waterColor: preset.waterColor,
        waterTransparency: preset.waterTransparency,
        waterWaveHeight: preset.waterWaveHeight,
        // ADR-115 P4: 双尺度波高（大/小波独立振幅）
        bigWaveHeight: preset.bigWaveHeight ?? 1.0,
        smallWaveHeight: preset.smallWaveHeight ?? 1.0,
        waterAnimSpeed: preset.waterAnimSpeed,
        foamThreshold: preset.foamThreshold,
        foamIntensity: preset.foamIntensity,
        waterFogColor: preset.waterFogColor,
        waterFogDensity: preset.waterFogDensity,
        waterFogOpacityInfluence: preset.waterFogOpacityInfluence,
        causticIntensity: preset.causticIntensity,
        // 扩展参数一并写入：setEnvState 同步触发的 _syncWaterUniforms 据此应用并持久化，
        // 避免被后续任意 envState 变化还原
        fresnelAlphaInfluence: preset.fresnelAlphaInfluence,
        foamOpacity: preset.foamOpacity,
        // ADR-115 P1: 法线扰动 + Sun Glitter
        waterNormalStrength: preset.waterNormalStrength,
        waterGlintStrength: preset.waterGlintStrength,
        // ADR-115 P3: 地平线淡出 + 天空联动
        // 兜底 0：WATER_PRESETS 当前未定义这两个字段，直接传 undefined 会让
        // _syncWaterUniforms 的 setFloat 写入 NaN，导致真实引擎下水面渲染消失且不可逆。
        waterHorizonFade: preset.waterHorizonFade ?? 0,
        waterSkyColorBlend: preset.waterSkyColorBlend ?? 0,
    };
}

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
    if (preset.causticIntensity !== undefined) {
        mat.setFloat('uCausticIntensity', preset.causticIntensity);
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
    if (preset.foamOpacity !== undefined) {
        mat.setFloat('foamOpacity', preset.foamOpacity);
    }
    if (preset.waterFogColor !== undefined) {
        mat.setColor3('waterFogColor', col3FromTriple(preset.waterFogColor));
    }
    if (preset.waterFogDensity !== undefined) {
        mat.setFloat('waterFogDensity', preset.waterFogDensity);
    }
    if (preset.waterFogOpacityInfluence !== undefined) {
        mat.setFloat('waterFogOpacityInfluence', preset.waterFogOpacityInfluence);
    }
    // ADR-115 P1: 法线扰动 + Sun Glitter
    if (preset.waterNormalStrength !== undefined) {
        mat.setFloat('uDetailNormalStrength', preset.waterNormalStrength);
    }
    if (preset.waterGlintStrength !== undefined) {
        mat.setFloat('uGlintStrength', preset.waterGlintStrength);
    }
    // ADR-115 P3: 地平线淡出 + 天空联动
    if (preset.waterHorizonFade !== undefined) {
        mat.setFloat('uHorizonFade', preset.waterHorizonFade);
    }
    if (preset.waterSkyColorBlend !== undefined) {
        mat.setFloat('uSkyColorBlend', preset.waterSkyColorBlend);
    }
}
