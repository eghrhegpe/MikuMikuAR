// env-water-material.ts — 水面材质/着色器与预设（ADR-239 拆分）
// 自 env-water.ts 迁出。依赖 fx（涟漪/LOD/波方向）与 reflect（waterReflection）为单向叶，不 import 宿主。
import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Vector2 } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';

import { EnvState, envState } from '@/core/config';
import { col3FromTriple } from '@/core/color-helpers';
import { _envSys, effectiveGroundSize } from './_shared/env-context';
import { createCanvasTexture } from './_shared/env-texture';
import { causticsController } from './env-caustics';
import { valueNoise } from '@/core/math/hash-noise';
import { getEnvKeys } from '@/core/env-state-schema';
import { safeDispose } from '@/core/dispose-helpers';
import {
    MAX_RIPPLES,
    _applyWaterLOD,
    buildRippleBuffers,
    computeWaveDirs,
    getWaterLODMeshes,
    updateRipples,
} from './env-water-fx';
import { waterReflection } from './env-water-reflect';

import WATER_VERT_SRC from './shaders/water.vert.glsl?raw';
import WATER_FRAG_SRC from './shaders/water.frag.glsl?raw';

const DT_CLAMP_MAX = 0.1;

let _waterPhase = 0; // 累计波相位，避免调节波速时相位跳变
let _waterWaveSpeed = 1; // 当前波速，供每帧相位累加使用

/** 宿主 updateWaterAnimSpeed 委托：只更新累加速率，相位由每帧 observer 累加（改波速不跳变） */
export function setWaterWaveSpeed(speed: number): void {
    _waterWaveSpeed = speed;
}

/** 宿主 disposeWater 委托：重置相位/波速状态 */
export function resetWaterPhaseState(): void {
    _waterPhase = 0;
    _waterWaveSpeed = 1;
}

// Gerstner 波参数（与 water.vert.glsl 中 WAVE_SPEED/WAVE_FREQ 保持一致）
// ADR-115 P5: 层 0/1 频率下调（0.15/0.2 → 0.07/0.11），拉长波长制造连绵涌浪
// ADR-115 二轮增强: WAVE_SPEED 在 uDispersionEnabled=1 时被 ω=sqrt(g·k) 覆盖（见 vert shader）
const _GERSTNER_WAVE_FREQ = [0.07, 0.11, 0.25, 0.3] as const;
const _GERSTNER_WAVE_SPEED = [0.7, 0.9, 0.5, 1.2] as const;

/**
 * ADR-115 P2: 动态计算细节法线滚动速度倍率。
 * 基于 Gerstner 波相位的瞬时速度（WAVE_SPEED/WAVE_FREQ）同步法线纹理 UV 滚动，
 * 保证大波高时法线滚动快、小波高时滚动慢，与顶点波形运动一致。
 * @param waveSpeedMultiplier 当前波速倍率（来自 state.waterAnimSpeed，默认 1.0）
 * @returns [speed1, speed2] 大/小尺度法线层的滚动倍率（正值沿风向）
 */
function computeDetailNormalSpeeds(waveSpeedMultiplier = 1): [number, number] {
    // 第 0 层（大波组代表层）：speed/freq，决定大尺度法线滚动基准
    const baseSpeed = _GERSTNER_WAVE_SPEED[0] / _GERSTNER_WAVE_FREQ[0]; // ≈ 10（P5 后）
    // 大尺度层：与主波同速；小尺度层：稍慢（反向交错感）
    const speed1 = baseSpeed * waveSpeedMultiplier; // 沿风向滚动
    const speed2 = baseSpeed * waveSpeedMultiplier * 0.55; // 反向，0.55:1 比例（两层不重复）
    return [speed1, speed2];
}

let _detailNormalTexture: Texture | null = null;
let _detailNormalScene: Scene | null = null;
const DETAIL_NORMAL_TEX_SIZE = 1024;

/** 宿主 disposeWater 委托：释放法线细节纹理（ADR-115 P1） */
export function disposeDetailNormalTexture(): void {
    _detailNormalTexture = safeDispose(_detailNormalTexture);
    _detailNormalScene = null;
}

// ======== ADR-115 P1: 程序化法线细节纹理 ========
function regenerateDetailNormalTexture(scene: Scene): void {
    const S = DETAIL_NORMAL_TEX_SIZE;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        const imgData = ctx.createImageData(s, s);
        const data = imgData.data;
        const heights = new Float32Array(s * s);

        // P1 增强：6 层 octave（原来 4 层）→ 高频细节更密集，波光更多
        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                let h = 0,
                    amp = 1,
                    freq = 1;
                for (let oct = 0; oct < 6; oct++) {
                    h += valueNoise((x * freq) / s, (y * freq) / s) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                // P1 增强：幂函数锐化（原来线性），波峰更尖，高光更亮
                h = Math.pow(h, 0.8);
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

    _detailNormalTexture = safeDispose(_detailNormalTexture);
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
 * 水下雾状态：自定义 ShaderMaterial 不参与 Babylon 的 scene.fog，
 * 因此由 underwaterFogController 在穿越水面时把水下雾参数推给水面，
 * 让水面与地面/角色用同一套雾（同起始距离 + 同雾色），视觉统一。
 * enabled=0 时水面不做水下雾混合（出水/陆地）。
 */
let _underwaterFog = {
    enabled: 0,
    color: new Color3(0.35, 0.58, 0.72),
    start: 40,
    end: 500,
};

// 复用的焦散 UV 偏移向量（每帧由 causticsController 推进的纹理 uOffset/vOffset 注入，避免每帧分配）
const _causticOffset = new Vector2(0, 0);

/** 由水下雾控制器同步水下雾参数到水面材质（含材质重建后的恢复由 _syncWaterUniforms 负责）。 */
export function setUnderwaterFog(
    enabled: boolean,
    color: Color3,
    start: number,
    end: number
): void {
    _underwaterFog = { enabled: enabled ? 1 : 0, color: color.clone(), start, end };
    const mat = _envSys.water.material as ShaderMaterial | null;
    if (mat) {
        mat.setFloat('uUnderwater', _underwaterFog.enabled);
        mat.setColor3('uUnderwaterFogColor', _underwaterFog.color);
        mat.setFloat('uUnderwaterFogStart', start);
        mat.setFloat('uUnderwaterFogEnd', end);
    }
}

/**
 * 同步水面材质的全部 uniform 参数（非破坏性，不销毁/重建材质）。
 * 由 createWater 在惰性路径和首次创建后调用。
 */
export function _syncWaterUniforms(state: EnvState, scene: Scene): void {
    const mat = _envSys.water.material as ShaderMaterial | null;
    const mesh = _envSys.water.mesh;
    if (!mat || !mesh) {
        return;
    }

    // ——— 基础参数 ———
    mat.setFloat('waveHeight', state.waterWaveHeight);
    // ADR-115 P4 + ADR-211 Part3：大波受 bigWaveEnabled 门控，关闭时送 0 振幅（水面趋于平静镜面）
    mat.setFloat(
        'bigWaveHeight',
        (state.bigWaveEnabled ?? true) ? (state.bigWaveHeight ?? 1.0) : 0
    );
    // ADR-115 P4 + 功能开关试点：小波受 smallWaveEnabled 门控，关闭时送 0 振幅（水面呈纯净反射面）
    mat.setFloat(
        'smallWaveHeight',
        (state.smallWaveEnabled ?? true) ? (state.smallWaveHeight ?? 1.0) : 0
    );
    _waterWaveSpeed = (state.waterAnimSpeed ?? 1) * 1.0;
    // wavePhase 由 _waterUpdateCallback 每帧统一写入，此处无需重复赋值
    // ADR-115 二轮增强：色散关系开关（0=旧硬编码 ω 零回归，1=物理色散 ω=sqrt(g·k)）
    mat.setFloat('uDispersionEnabled', state.waterDispersionEnabled ? 1 : 0);
    mat.setColor3('waterColor', col3FromTriple(state.waterColor));
    mat.setFloat('waterTransparency', state.waterTransparency);
    mat.setFloat('waterLevel', state.waterLevel);
    mat.setInt('uWaterFlip', state.waterFlipEnabled ? 1 : 0);

    const hasEnv = !!scene.environmentTexture;
    // envIntensity 随日照微缩放（与 per-frame 同公式）：高底线保留夕阳暖色
    const _initDl = scene.getLightByName('dir') as DirectionalLight | null;
    const _initSunI = _initDl ? _initDl.intensity : 0.4;
    mat.setFloat('envIntensity', hasEnv ? Math.max(0.6, Math.min(1, _initSunI * 0.4 + 0.6)) : 0);
    if (hasEnv && scene.environmentTexture) {
        mat.setTexture('envTexture', scene.environmentTexture);
    }

    // ——— 灯光 ———
    const dirLight = scene.getLightByName('dir') as DirectionalLight | null;
    if (dirLight) {
        mat.setVector3('lightDir', dirLight.direction);
        mat.setColor3('lightColor', dirLight.diffuse);
        mat.setFloat('lightIntensity', dirLight.intensity);
    } else {
        mat.setVector3('lightDir', new Vector3(-0.5, -1, -0.5));
        mat.setColor3('lightColor', new Color3(1, 1, 1));
        mat.setFloat('lightIntensity', 0.5);
    }
    mat.setFloat('ambientIntensity', 0.3);

    // ——— 焦散（共享 env-caustics controller 唯一实例，UV 滚动由 controller 推）——
    const causticTex = causticsController.getTexture(scene);
    mat.setTexture('uCausticTex', causticTex);
    // ADR-211 Part3：焦散受 causticEnabled 门控，关闭时送 0 强度（水底无光斑）
    mat.setFloat('uCausticIntensity', (state.causticEnabled ?? true) ? state.causticIntensity : 0);
    // 焦散 UV 偏移（联动 causticScrollX/Y，经 causticsController 推 uOffset/vOffset）
    mat.setVector2('uCausticOffset', _causticOffset.set(causticTex.uOffset, causticTex.vOffset));

    // ——— ADR-115 P1: 高频法线扰动层 + Sun Glitter（波浪联动）——

    const detailNormalTex = ensureDetailNormalTexture(scene);
    mat.setTexture('uDetailNormalTex', detailNormalTex);
    mat.setFloat('uDetailNormalStrength', state.waterNormalStrength);
    // 波纹方格尺度：tile 周期 = 1/tiling 世界单位
    // tiling1=3.0 → 细尺度波纹单元 ≈0.33 单位（60 单位水面重复 180 次）
    // tiling2=6.0 → 高频微纹单元 ≈0.17 单位（重复 360 次）；两层保持 2:1 比例
    // 原 0.5/1.5 单元过大（2/0.67 单位），高频扰动不可见
    mat.setFloat('uDetailNormalTiling1', 3.0);
    mat.setFloat('uDetailNormalTiling2', 6.0);
    // P2 修复：删除 dead code，改为动态计算速度（与 Gerstner 波相位同步）
    const waveAnimSpeed = state.waterAnimSpeed ?? 1;
    const [speed1, speed2] = computeDetailNormalSpeeds(waveAnimSpeed);
    mat.setFloat('uDetailNormalSpeed1', speed1);
    mat.setFloat('uDetailNormalSpeed2', speed2);
    mat.setFloat('uGlintStrength', state.waterGlintStrength);
    mat.setFloat('uGlintPower', 96);
    mat.setFloat('uGlintScale', 80.0);
    mat.setFloat('uGlintSpeed', 2.0);

    // ——— ADR-115 P5: 低频滚动法线层（大尺度滚动光带）——
    mat.setFloat('uLowFreqNormalTiling', 0.04);
    mat.setFloat('uLowFreqNormalStrength', state.lowFreqNormalStrength ?? 0.15);
    mat.setFloat('uLowFreqNormalSpeed', 0.05);

    // ——— ADR-115 P3: 地平线淡出 + 天空-水面颜色联动 ———
    // 天空基准色：优先 skyColorBot，fallback waterFogColor
    const skyBot = state.skyColorBot ?? state.waterFogColor;
    mat.setVector3('uSkyBlendColor', new Vector3(skyBot[0], skyBot[1], skyBot[2]));
    mat.setFloat('uSkyColorBlend', state.waterSkyColorBlend ?? 0);
    // 地平线淡出距离按生效地面尺寸自动计算（无限地面时同步推到 2000，与地面延伸对齐）
    const ws = effectiveGroundSize(state.groundSize, state.groundInfiniteEnabled ?? false);
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
    mat.setFloat('fresnelAlphaInfluence', state.fresnelAlphaInfluence);

    // ——— 泡沫系统（foamEnabled=false 零回归：foamIntensity 送 0，mix 因子为 0）———
    const foamOn = state.foamEnabled ?? false;
    mat.setFloat('foamThreshold', state.foamThreshold);
    mat.setFloat('foamIntensity', foamOn ? state.foamIntensity : 0);
    mat.setFloat('foamOpacity', state.foamOpacity);
    mat.setFloat('foamTransitionRange', state.foamTransitionRange);
    mat.setColor3('foamColor', col3FromTriple(state.foamColor));
    mat.setFloat('uFoamNoiseStrength', foamOn ? state.foamNoiseStrength : 0);

    mat.setColor3('waterFogColor', col3FromTriple(state.waterFogColor));
    mat.setFloat('waterFogStart', state.waterFogStart);
    mat.setFloat('waterFogEnd', state.waterFogEnd);
    mat.setFloat('waterFogOpacityInfluence', state.waterFogOpacityInfluence);

    // ——— 水下雾（与 scene.fog 同源；ShaderMaterial 不参与 Babylon fog，需手动注入）———
    // 入水时由 underwaterFogController 调 setUnderwaterFog 改写 _underwaterFog；
    // 此处每帧/重建时兜底写入，保证材质重建后水下雾参数不丢失。
    mat.setFloat('uUnderwater', _underwaterFog.enabled);
    mat.setColor3('uUnderwaterFogColor', _underwaterFog.color);
    mat.setFloat('uUnderwaterFogStart', _underwaterFog.start);
    mat.setFloat('uUnderwaterFogEnd', _underwaterFog.end);

    // ——— 波方向（风向联动）———
    const windDirs = computeWaveDirs(state.windDirection);
    mat.setArray2('uWindDir', windDirs);
    // 风速调制波幅度（0 级风时 0.3 倍平静海面，10 级风时 1.8 倍汹涌涌浪）
    // windEnabled 守卫：对齐其他三系统（粒子/Bullet/云）行为，风关则浪静（wind-physics-fix P2）
    const effectiveWindSpeed = state.windEnabled ? state.windSpeed : 0;
    mat.setFloat('uWindSpeed', effectiveWindSpeed);
    // 细节法线滚动方向：取 Gerstner 主波（第一波）风向
    mat.setVector3('uDetailWindDir', new Vector3(windDirs[0], windDirs[1], 0));

    // ——— 涟漪数组（初始化为空）———
    mat.setArray4('uRipplePosRad', new Array(MAX_RIPPLES * 4).fill(0));
    mat.setArray4('uRippleStrSpdLife', new Array(MAX_RIPPLES * 4).fill(0));
    mat.setInt('uRippleCount', 0);

    // ——— 平面反射（ADR-062）———
    mat.setFloat('planarReflectionBlend', state.planarReflectionBlend ?? 0.5);

    // ——— ADR-222: 水面深度差雾 — 水柱厚度驱动雾效 ——
    const depthMap = (scene as any).depthRenderer?.getDepthMap?.() ?? null;
    if (depthMap) {
        mat.setTexture('sceneDepthTexture', depthMap);
    }
    const cam = scene.activeCamera;
    if (cam) {
        mat.setFloat('cameraNear', cam.minZ ?? 0.01);
        mat.setFloat('cameraFar', cam.maxZ ?? 10000);
    }
    // 颜色从 waterColor 派生：深蓝青色调
    const wc = col3FromTriple(state.waterColor);
    mat.setColor3('waterDepthFogColor', new Color3(wc.r * 0.4, wc.g * 0.5, wc.b * 0.9));
    mat.setFloat('waterDepthFogDensity', state.waterDepthFogDensity ?? 0.015);
    mat.setFloat('waterDepthFogStrength', state.waterDepthFogStrength ?? 1.0);
}

// ══════════════════════════════════════════════════════════════
// 平面反射（ADR-062 P1）：委托统一平面反射引擎（ADR-092），实现见 env-water-reflect.ts

/**
 * 更新水面网格的位置和缩放（非破坏性）。所有 LOD 层同步变换。
 */

const WATER_UNIFORMS = [
    'world',
    'viewProjection',
    'time',
    'waveHeight',
    'bigWaveHeight',
    'smallWaveHeight',
    'wavePhase',
    'uDispersionEnabled',
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
    'uCausticOffset',
    'fresnelBias',
    'fresnelPower',
    'diffuseStrength',
    'ambientStrength',
    'foamTransitionRange',
    'rippleNormalStrength',
    'rippleGlintStrength',
    'causticColor1',
    'causticColor2',
    'fresnelAlphaInfluence',
    'foamOpacity',
    'uFoamNoiseStrength',
    'waterFogColor',
    'waterFogStart',
    'waterFogEnd',
    'waterFogOpacityInfluence',
    'uWindDir',
    'uWindSpeed',
    'planarReflectionBlend',
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
    // ADR-115 P5: 低频滚动法线层
    'uLowFreqNormalTiling',
    'uLowFreqNormalStrength',
    'uLowFreqNormalSpeed',
    // 水下雾（与 scene.fog 同源；ShaderMaterial 不参与 Babylon fog，需手动注入）
    'uUnderwater',
    'uUnderwaterFogColor',
    'uUnderwaterFogStart',
    'uUnderwaterFogEnd',
    // ADR-222: 水面深度差雾
    'waterDepthFogDensity',
    'waterDepthFogColor',
    'waterDepthFogStrength',
    'cameraNear',
    'cameraFar',
];

export function _createWaterMaterial(scene: Scene, state: EnvState): ShaderMaterial {
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
                .concat(hasReflection ? ['reflectionTexture'] : [])
                .concat(['sceneDepthTexture']),
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
export function _rebuildWaterMaterial(scene: Scene, state: EnvState): void {
    const oldMat = _envSys.water.material;
    const newMat = _createWaterMaterial(scene, state);
    if (_envSys.water.mesh) {
        _envSys.water.mesh.material = newMat;
    }
    for (const lod of getWaterLODMeshes()) {
        lod.material = newMat;
    }
    _envSys.water.material = newMat;
    oldMat?.dispose();
}

export function _waterUpdateCallback(scene: Scene): void {
    // 防御：disposeWater 后 observer 仍可能触发一帧（如 scene 已 dispose 但 observer 未摘除）
    if (scene.isDisposed) {
        return;
    }
    if (!_envSys.water.material) {
        return;
    }
    const m = _envSys.water.material as ShaderMaterial;
    const dt = Math.min(scene.deltaTime / 1000, DT_CLAMP_MAX);
    const now = performance.now() / 1000;

    _waterPhase += dt * _waterWaveSpeed;
    m.setFloat('time', now);
    m.setFloat('wavePhase', _waterPhase);
    // 焦散 UV 偏移：每帧由 causticsController 推进的纹理 uOffset/vOffset 提供（联动 causticScrollX/Y）
    const cTex = causticsController.getTexture(scene);
    m.setVector2('uCausticOffset', _causticOffset.set(cTex.uOffset, cTex.vOffset));
    // P2: 每帧同步法线滚动速度（用户调整波速时实时响应）
    const [speed1, speed2] = computeDetailNormalSpeeds(envState.waterAnimSpeed ?? 1);
    m.setFloat('uDetailNormalSpeed1', speed1);
    m.setFloat('uDetailNormalSpeed2', speed2);
    const cam = scene.activeCamera;
    if (cam) {
        m.setVector3('cameraPosition', cam.position);
    }
    m.setColor3('waterColor', col3FromTriple(envState.waterColor));
    const dl = scene.getLightByName('dir') as DirectionalLight | null;
    if (dl) {
        m.setVector3('lightDir', dl.direction);
        m.setColor3('lightColor', dl.diffuse);
        m.setFloat('lightIntensity', dl.intensity);
        // envIntensity 随日照微缩放：高底线 0.6 保留夕阳暖色，避免水面颜色随天空大幅变化
        m.setFloat('envIntensity', Math.max(0.6, Math.min(1, dl.intensity * 0.4 + 0.6)));
    }

    // 涟漪衰减 + 清理死亡 slot（FX 子系统自持状态，ADR-239）
    updateRipples(dt);

    waterReflection.update(envState, scene);
    _applyWaterLOD(scene);

    // 上传涟漪数据到 shader（FX 子系统打包，ADR-239）
    const { posRad, strSpdLife, aliveCount } = buildRippleBuffers();
    m.setArray4('uRipplePosRad', posRad);
    m.setArray4('uRippleStrSpdLife', strSpdLife);
    m.setInt('uRippleCount', aliveCount);
}


export interface WaterPreset {
    label: string;
    waterColor: [number, number, number];
    waterTransparency: number;
    waterWaveHeight: number;
    // ADR-115 P4: 双层尺度拆分
    bigWaveHeight: number;
    smallWaveHeight: number;
    waterAnimSpeed: number;
    waterFogColor: [number, number, number];
    waterFogStart: number;
    waterFogEnd: number;
    waterFogOpacityInfluence: number;
    // 新增：从着色器硬编码提取的可调参数（可选，使用默认值如未定义）
    fresnelBias?: number;
    fresnelPower?: number;
    diffuseStrength?: number;
    ambientStrength?: number;
    rippleNormalStrength?: number;
    rippleGlintStrength?: number;
    causticIntensity?: number;
    causticColor1?: [number, number, number];
    causticColor2?: [number, number, number];
    causticScrollX?: number;
    causticScrollY?: number;
    fresnelAlphaInfluence?: number;
    // ADR-115 P1: 高频法线扰动 + Sun Glitter
    waterNormalStrength?: number;
    waterGlintStrength?: number;
    // ADR-115 P3: 地平线淡出 + 天空联动
    waterHorizonFade?: number;
    waterSkyColorBlend?: number;
    // ADR-115 P5: 低频滚动法线层
    lowFreqNormalStrength?: number;
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
        waterFogColor: [0.5, 0.52, 0.62],
        waterFogStart: 150,
        waterFogEnd: 800,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.35,
        causticIntensity: 0.3,
        waterNormalStrength: 0.35,
        waterGlintStrength: 0.3,
        // ADR-115 P3: 地平线淡出 + 天空联动（原缺失，补全）
        waterHorizonFade: 0.8,
        waterSkyColorBlend: 0.15,
        // ADR-115 P5: 低频滚动法线层
        lowFreqNormalStrength: 0.0,
    },
    ripple: {
        label: '涟漪',
        waterColor: [0.2, 0.42, 0.62],
        waterTransparency: 0.8,
        waterWaveHeight: 0.6,
        bigWaveHeight: 0.6,
        smallWaveHeight: 1.0,
        waterAnimSpeed: 1.0,
        waterFogColor: [0.48, 0.5, 0.6],
        waterFogStart: 100,
        waterFogEnd: 500,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.4,
        causticIntensity: 0.4,
        waterNormalStrength: 0.5,
        waterGlintStrength: 0.6,
        waterHorizonFade: 0.85,
        waterSkyColorBlend: 0.2,
        // ADR-115 P5: 低频滚动法线层
        lowFreqNormalStrength: 0.08,
    },
    ocean: {
        label: '海浪',
        waterColor: [0.08, 0.25, 0.5],
        waterTransparency: 0.65,
        waterWaveHeight: 1.8,
        bigWaveHeight: 1.5,
        smallWaveHeight: 0.8,
        waterAnimSpeed: 2.5,
        waterFogColor: [0.4, 0.42, 0.55],
        waterFogStart: 50,
        waterFogEnd: 300,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.5,
        causticIntensity: 0.5,
        waterNormalStrength: 0.6,
        waterGlintStrength: 0.8,
        waterHorizonFade: 0.9,
        waterSkyColorBlend: 0.6,
        // ADR-115 P5: 低频滚动法线层
        lowFreqNormalStrength: 0.35,
    },
    storm: {
        label: '风暴',
        waterColor: [0.04, 0.14, 0.35],
        waterTransparency: 0.5,
        waterWaveHeight: 3.0,
        bigWaveHeight: 2.0,
        smallWaveHeight: 0.5,
        waterAnimSpeed: 5.0,
        waterFogColor: [0.35, 0.36, 0.48],
        waterFogStart: 15,
        waterFogEnd: 150,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.6,
        causticIntensity: 0.6,
        waterNormalStrength: 0.65,
        waterGlintStrength: 0.5,
        waterHorizonFade: 0.9,
        waterSkyColorBlend: 0.15,
        // ADR-115 P5: 低频滚动法线层
        lowFreqNormalStrength: 0.15,
    },
    tropical: {
        label: '热带',
        waterColor: [0.1, 0.55, 0.7],
        waterTransparency: 0.78,
        waterWaveHeight: 0.8,
        bigWaveHeight: 0.8,
        smallWaveHeight: 1.2,
        waterAnimSpeed: 1.2,
        waterFogColor: [0.45, 0.58, 0.62],
        waterFogStart: 120,
        waterFogEnd: 600,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.42,
        causticIntensity: 0.45,
        waterNormalStrength: 0.55,
        waterGlintStrength: 1.0,
        waterHorizonFade: 0.85,
        waterSkyColorBlend: 0.55,
        // ADR-115 P5: 低频滚动法线层
        lowFreqNormalStrength: 0.3,
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
        waterFogColor: preset.waterFogColor,
        waterFogStart: preset.waterFogStart,
        waterFogEnd: preset.waterFogEnd,
        waterFogOpacityInfluence: preset.waterFogOpacityInfluence,
        causticIntensity: preset.causticIntensity,
        // 扩展参数一并写入：setEnvState 同步触发的 _syncWaterUniforms 据此应用并持久化，
        // 避免被后续任意 envState 变化还原
        fresnelAlphaInfluence: preset.fresnelAlphaInfluence,
        // ADR-115 P1: 法线扰动 + Sun Glitter
        waterNormalStrength: preset.waterNormalStrength,
        waterGlintStrength: preset.waterGlintStrength,
        // ADR-115 P3: 地平线淡出 + 天空联动
        // 兜底 0：WATER_PRESETS 当前未定义这两个字段，直接传 undefined 会让
        // _syncWaterUniforms 的 setFloat 写入 NaN，导致真实引擎下水面渲染消失且不可逆。
        waterHorizonFade: preset.waterHorizonFade ?? 0,
        waterSkyColorBlend: preset.waterSkyColorBlend ?? 0,
        // ADR-115 P5: 低频滚动法线层（可选字段，?? 0.15 兜底）
        lowFreqNormalStrength: preset.lowFreqNormalStrength ?? 0.15,
    };
}

// ======== 应用水预设参数到当前材质 ========
// 收敛 ADR-146 主题 8：fresnelBias/fresnelPower/diffuseStrength/ambientStrength 4 行
// setFloat 与 _syncWaterUniforms 同源，提取为私有 helper 消除字面重复。
// 保留 `!== undefined` 守卫——preset 为 Partial 预览应用，仅覆盖已定义字段，
// 不可机械改调 _syncWaterUniforms(state)（会从完整 state 无条件写入并触发 facade 副作用）。
function applyWaterPresetCoreUniforms(mat: ShaderMaterial, preset: Partial<WaterPreset>): void {
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
}

export function applyWaterPresetToCurrent(preset: Partial<WaterPreset>): void {
    const mat = _envSys.water.material as ShaderMaterial | null;
    if (!mat) {
        return;
    }

    // 应用新增的可调参数（如果预设中有定义）
    applyWaterPresetCoreUniforms(mat, preset);
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
    if (preset.waterFogColor !== undefined) {
        mat.setColor3('waterFogColor', col3FromTriple(preset.waterFogColor));
    }
    if (preset.waterFogStart !== undefined) {
        mat.setFloat('waterFogStart', preset.waterFogStart);
    }
    if (preset.waterFogEnd !== undefined) {
        mat.setFloat('waterFogEnd', preset.waterFogEnd);
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
    // ADR-115 P5: 低频滚动法线层
    if (preset.lowFreqNormalStrength !== undefined) {
        mat.setFloat('uLowFreqNormalStrength', preset.lowFreqNormalStrength);
    }
}

// ======== [ADR-138] env-dispatcher 回调注册 ========
export const _WATER_KEYS = getEnvKeys('water');
