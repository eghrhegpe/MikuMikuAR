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
import { isWorldMatrixFrozen, setPostProcessEnabled } from './env-type-helpers';
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

// === 平面反射（统一平面反射引擎，ADR-092）===
// 水面用 screenSpace 模式：RenderTargetTexture + 镜像相机（_worldMatrix 镜像矩阵）+ ShaderMaterial 屏空采样。
// 互斥可恢复：启用地面反射时本引擎自动停用，地面关闭后由协调器触发重建（关地即开水）。
const waterReflection = new PlanarReflection({
    name: 'water',
    mode: 'screenSpace',
    resolutionMap: { high: 512, medium: 256, low: 128, off: 0 },
    getQuality: (s) => s.reflectionQuality,
    getBlend: (s) => s.planarReflectBlend ?? 0.5,
    getSurfaceLevel: (s) => s.waterLevel,
    getMirrorCameraMatrix: (s, scene) => {
        const cam = scene.activeCamera;
        if (!cam) {
            return null;
        }
        const plane = new Plane(0, 1, 0, -s.waterLevel);
        return Matrix.Reflection(plane).multiply(cam.getWorldMatrix());
    },
    predicate: (mesh, level) =>
        !mesh.name.startsWith('envWater') &&
        mesh.isEnabled() &&
        !isWorldMatrixFrozen(mesh) &&
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
});
registerReflectionSurface('water', waterReflection, () =>
    waterReflection.update(envState, getScene())
);

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
    r.radius = Math.max(RIPPLE_MIN_RADIUS, radius);
    r.strength = clamp01(strength);
    r.speed = Math.max(RIPPLE_MIN_SPEED, speed);
    r.life = maxLife > 0 ? maxLife : RIPPLE_INFINITY_LIFE;
    r.maxLife = maxLife;
}

export function clearRipples(): void {
    _ripples = [];
}

// ======== 焦散系统（静态纹理 + UV 滚动）========
let _causticTexture: Texture | null = null;
let _causticScene: Scene | null = null;
let _lastCausticColor: [number, number, number] | null = null;
const CAUSTIC_TEX_SIZE = 128;

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
                data[i] = Math.min(255, Math.floor((wr * CAUSTIC_DARK_FACTOR + t * wr * CAUSTIC_BRIGHT_FACTOR) * 255));
                data[i + 1] = Math.min(255, Math.floor((wg * CAUSTIC_DARK_FACTOR + t * wg * CAUSTIC_BRIGHT_FACTOR) * 255));
                data[i + 2] = Math.min(255, Math.floor((wb * CAUSTIC_DARK_FACTOR + t * wb * CAUSTIC_BRIGHT_FACTOR) * 255));
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
    'world', 'viewProjection', 'time', 'waveHeight', 'wavePhase',
    'cameraPosition', 'waterColor', 'waterTransparency', 'waterLevel',
    'uWaterFlip', 'envIntensity', 'foamColor', 'foamThreshold', 'foamIntensity',
    'lightDir', 'lightColor', 'ambientIntensity',
    'uRipplePosRad', 'uRippleStrSpdLife', 'uRippleCount',
    'uCausticIntensity', 'uCausticSpeed', 'uCausticScale',
    'fresnelBias', 'fresnelPower', 'diffuseStrength', 'ambientStrength',
    'foamTransitionRange', 'rippleNormalStrength', 'rippleGlintStrength',
    'causticColor1', 'causticColor2', 'causticScrollX', 'causticScrollY',
    'fresnelAlphaInfluence', 'foamOpacity',
    'waterFogColor', 'waterFogDensity', 'waterFogOpacityInfluence',
    'uWindDir', 'planarReflectBlend',
];

function _createWaterMaterial(scene: Scene, state: EnvState): ShaderMaterial {
    const hasEnv = !!scene.environmentTexture;
    const hasReflection = state.reflectionQuality !== 'off';
    const mat = new ShaderMaterial(
        'customWaterMat', scene,
        { vertexSource: WATER_VERT_SRC, fragmentSource: WATER_FRAG_SRC },
        {
            attributes: ['position', 'uv', 'normal'],
            uniforms: WATER_UNIFORMS,
            uniformBuffers: [],
            samplers: ['uCausticTex']
                .concat(hasEnv ? ['envTexture'] : [])
                .concat(hasReflection ? ['reflectionTexture'] : []),
            defines: (hasEnv ? ['ENV_TEXTURE'] : [])
                .concat(hasReflection ? ['PLANAR_REFLECTION'] : []),
            needAlphaBlending: true,
        }
    );
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    return mat;
}

function _waterUpdateCallback(scene: Scene): void {
    if (!_envSys.water.material) return;
    const m = _envSys.water.material as ShaderMaterial;
    const dt = Math.min(scene.deltaTime / 1000, DT_CLAMP_MAX);
    const now = performance.now() / 1000;

    _waterPhase += dt * _waterWaveSpeed;
    m.setFloat('time', now);
    m.setFloat('wavePhase', _waterPhase);
    const cam = scene.activeCamera;
    if (cam) m.setVector3('cameraPosition', cam.position);
    m.setColor3('waterColor', col3FromTriple(envState.waterColor));
    const dl = scene.getLightByName('dir') as DirectionalLight | null;
    if (dl) {
        m.setVector3('lightDir', dl.direction);
        m.setColor3('lightColor', dl.diffuse);
    }

    // 涟漪衰减
    if (dt > 0) {
        let anyAlive = false;
        for (const r of _ripples) {
            if (r.life > 0) {
                r.life = Math.max(0, r.life - dt);
                if (r.life > 0) anyAlive = true;
            }
        }
        if (!anyAlive && _ripples.length > 0) _ripples = [];
    }

    waterReflection.update(envState, scene);
    _applyWaterLOD(scene);

    // 上传涟漪数据到 shader
    const posRad = new Array<number>(MAX_RIPPLES * 4).fill(0);
    const strSpdLife = new Array<number>(MAX_RIPPLES * 4).fill(0);
    let aliveCount = 0;
    for (const r of _ripples) {
        if (r.life <= 0 || aliveCount >= MAX_RIPPLES) continue;
        const i = aliveCount * 4;
        posRad[i] = r.position.x; posRad[i + 1] = r.position.y;
        posRad[i + 2] = r.position.z; posRad[i + 3] = r.radius;
        strSpdLife[i] = r.strength; strSpdLife[i + 1] = r.speed;
        strSpdLife[i + 2] = r.life; strSpdLife[i + 3] = r.maxLife;
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
            name, { width: WATER_BASE_SIZE, height: WATER_BASE_SIZE, subdivisions }, scene
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
        _waterUpdateObserver = scene.onBeforeRenderObservable.add(() => _waterUpdateCallback(scene));
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
    const scene = getScene();
    if (_waterUpdateObserver) {
        if (scene) {
            scene.onBeforeRenderObservable.remove(_waterUpdateObserver);
        }
        _waterUpdateObserver = null;
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
    causticColor1?: [number, number, number];
    causticColor2?: [number, number, number];
    causticScrollX?: number;
    causticScrollY?: number;
    fresnelAlphaInfluence?: number;
    foamOpacity?: number;
}

export const WATER_PRESETS: Record<string, WaterPreset> = {
    calm: {
        label: '平静',
        waterColor: [0.15, 0.4, 0.6],
        waterTransparency: 0.88,
        waterWaveHeight: 0.15,
        waterAnimSpeed: 0.2,
        foamThreshold: 0.35,
        foamIntensity: 0.12,
        waterFogColor: [0.5, 0.52, 0.62],
        waterFogDensity: 0.006,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.35,
        foamOpacity: 0.5,
    },
    ripple: {
        label: '涟漪',
        waterColor: [0.2, 0.42, 0.62],
        waterTransparency: 0.8,
        waterWaveHeight: 0.6,
        waterAnimSpeed: 1.0,
        foamThreshold: 0.25,
        foamIntensity: 0.3,
        waterFogColor: [0.48, 0.5, 0.6],
        waterFogDensity: 0.009,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.4,
        foamOpacity: 0.55,
    },
    ocean: {
        label: '海浪',
        waterColor: [0.08, 0.25, 0.5],
        waterTransparency: 0.65,
        waterWaveHeight: 1.8,
        waterAnimSpeed: 2.5,
        foamThreshold: 0.12,
        foamIntensity: 0.55,
        waterFogColor: [0.4, 0.42, 0.55],
        waterFogDensity: 0.014,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.5,
        foamOpacity: 0.65,
    },
    storm: {
        label: '风暴',
        waterColor: [0.04, 0.14, 0.35],
        waterTransparency: 0.5,
        waterWaveHeight: 3.0,
        waterAnimSpeed: 5.0,
        foamThreshold: 0.08,
        foamIntensity: 0.7,
        waterFogColor: [0.35, 0.36, 0.48],
        waterFogDensity: 0.022,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.6,
        foamOpacity: 0.7,
    },
    tropical: {
        label: '热带',
        waterColor: [0.1, 0.55, 0.7],
        waterTransparency: 0.78,
        waterWaveHeight: 0.8,
        waterAnimSpeed: 1.2,
        foamThreshold: 0.25,
        foamIntensity: 0.25,
        waterFogColor: [0.45, 0.58, 0.62],
        waterFogDensity: 0.008,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.42,
        foamOpacity: 0.55,
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
        waterAnimSpeed: preset.waterAnimSpeed,
        foamThreshold: preset.foamThreshold,
        foamIntensity: preset.foamIntensity,
        waterFogColor: preset.waterFogColor,
        waterFogDensity: preset.waterFogDensity,
        waterFogOpacityInfluence: preset.waterFogOpacityInfluence,
        // 扩展参数一并写入：setEnvState 同步触发的 _syncWaterUniforms 据此应用并持久化，
        // 避免被后续任意 envState 变化还原
        fresnelAlphaInfluence: preset.fresnelAlphaInfluence,
        foamOpacity: preset.foamOpacity,
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
}
