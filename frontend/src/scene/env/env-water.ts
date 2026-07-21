import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';

import { Plane } from '@babylonjs/core/Maths/math.plane';
import { EnvState, envState } from '@/core/config';
import { col3FromTriple } from '@/core/color-helpers';
import { _envSys, getScene } from './env-context';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { getPlanarQualityOverride } from './env-reflection';
import { createCanvasTexture } from './env-texture';
import { registerEnvCallback } from './env-dispatcher';
import { getEnvKeys } from '@/core/env-state-schema';
import { clamp01 } from '@/core/utils';
import { logWarn } from '@/core/logger';

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
// deltaTime 钳制上限（秒），防止切后台返回时跳变
const DT_CLAMP_MAX = 0.1;
// 水下雾密度系数
const UNDERWATER_FOG_DENSITY_FACTOR = 0.5;

// ======== 水下状态（供 Env Update Observer 和 disposeWater 使用）========
// 私有化 + getter 导出，消除导出可变绑定（审核 P2-4）
let _underwaterActive = false;
let _underwaterSavedFog: { mode: number; color: Color3; density: number } | null = null;
let _underwaterTransitionProgress = 0;
let _underwaterTarget = false;

/** 相机是否处于水下（雾效接管中）。 */
export function isUnderwaterActive(): boolean {
    return _underwaterActive;
}

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
        // 零风向时回退到默认方向（Z+），避免运行时 throw 导致水面崩溃
        logWarn('env-water', '零风向，回退到默认方向 [0,0,1]');
        windDir = [0, 0, 1];
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

// ======== 共享噪声工具（消除焦散与法线纹理间的重复代码）========
// _hash2d + _valueNoise 供 regenerateDetailNormalTexture 内部使用；
// 与 env-terrain.ts 的 valueNoise 不同（后者含 seed），此处无状态、不需要 seed。
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

// === LOD 水面：记录所有 LOD 子网格（兄弟根网格），用于同步缩放/位置和手动可见性控制 ===
let _waterLODs: Mesh[] = [];
let _activeWaterLOD = -1; // 手动 LOD 当前层级：-1=未初始化, 0=high, 1=mid, 2=low
let _waterPhase = 0; // 累计波相位，避免调节波速时相位跳变
let _waterWaveSpeed = 1; // 当前波速，供每帧相位累加使用

// Gerstner 波参数（与 water.vert.glsl 中 WAVE_SPEED/WAVE_FREQ 保持一致）
const _GERSTNER_WAVE_FREQ = [0.15, 0.2, 0.25, 0.3] as const;
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
    const baseSpeed = _GERSTNER_WAVE_SPEED[0] / _GERSTNER_WAVE_FREQ[0]; // ≈ 4.67
    // 大尺度层：与主波同速；小尺度层：稍慢（反向交错感）
    const speed1 = baseSpeed * waveSpeedMultiplier; // 沿风向滚动
    const speed2 = baseSpeed * waveSpeedMultiplier * 0.55; // 反向，0.55:1 比例（两层不重复）
    return [speed1, speed2];
}
let _waterUpdateObserver: ObserverHandle | null = null;
let _waterScene: Scene | null = null;

// === 平面反射（统一平面反射引擎，ADR-092）===
// 水面用 screenSpace 模式：RenderTargetTexture + 镜像相机（_worldMatrix 镜像矩阵）+ ShaderMaterial 屏空采样。
// 互斥可恢复：启用地面反射时本引擎自动停用，地面关闭后由协调器触发重建（关地即开水）。
const waterReflection = new PlanarReflection({
    name: 'water',
    mode: 'screenSpace',
    resolutionMap: { high: 2048, medium: 1024, low: 512, off: 0 },
    getQuality: (s) => {
        // ADR-151: reflectionMode 全局覆盖（none→强关、planar→拔高到至少 low）
        const override = getPlanarQualityOverride(s);
        if (override === 'off') {
            return 'off';
        }
        let q: string;
        // reflectionQuality 显式指定（含 'off'）直接返回；仅当值不在合法列表时 fallback
        if (['high', 'medium', 'low', 'off'].includes(s.reflectionQuality)) {
            q = s.reflectionQuality;
        } else {
            const map: Record<string, string> = { high: 'high', medium: 'medium', low: 'low' };
            q = map[s.qualityProfile] ?? 'off';
        }
        if (override === 'low' && q === 'off') {
            return 'low';
        }
        return q;
    },
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
            if (rt) {
                mat.setTexture('reflectionTexture', rt as Texture);
            } else {
                // ADR-### P1: setTexture(name, null) 在 Babylon 中直接赋值 _textures[name]=null，
                // 导致 isReady() for…in 遍历时 null.isReady() 崩溃。改用 removeTexture 彻底删除 key。
                (mat as ShaderMaterial).removeTexture('reflectionTexture');
            }
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
// 最大 slot 数（与 shader 循环上限 1024 对齐）；有效使用数由 envState.waterRippleSlots 控制
const MAX_RIPPLES = 1024;
interface RippleSource {
    position: Vector3;
    radius: number;
    strength: number;
    speed: number;
    life: number;
    maxLife: number;
}
let _ripples: RippleSource[] = [];

// ======== 水下灯光衰减（入水后降低灯光强度，避免暖光+蓝雾产生脏色）========
const UNDERWATER_DIR_INTENSITY_SCALE = 0.3;
const UNDERWATER_HEMI_INTENSITY_SCALE = 0.4;

/** slot 数由水效面板控制，确保每秒碰撞率 × rippleLife 可填满启用 slot */
function _maxSlots(): number {
    return Math.min(MAX_RIPPLES, Math.max(16, Math.round(envState.waterRippleSlots ?? 256)));
}

export function addRipple(pos: Vector3, radius = 5, strength = 0.5, speed = 2, maxLife = 3): void {
    const maxSlots = _maxSlots();
    // 1. 找已死亡的 slot（直接复用）
    for (let i = 0; i < _ripples.length; i++) {
        if (_ripples[i].life <= 0) {
            _fillSlot(i, pos, radius, strength, speed, maxLife);
            return;
        }
    }
    // 2. 未满 → push 新 slot
    if (_ripples.length < maxSlots) {
        const idx = _ripples.length;
        _ripples.push({
            position: new Vector3(0, 0, 0),
            radius: 0,
            strength: 0,
            speed: 0,
            life: 0,
            maxLife: 0,
        });
        _fillSlot(idx, pos, radius, strength, speed, maxLife);
        return;
    }
    // 3. 全活 → 替换寿命最短的（等效缩短其动画，适应高密度场景）
    let oldest = 0;
    for (let i = 1; i < _ripples.length; i++) {
        if (_ripples[i].life < _ripples[oldest].life) {
            oldest = i;
        }
    }
    _fillSlot(oldest, pos, radius, strength, speed, maxLife);
}

function _fillSlot(
    idx: number,
    pos: Vector3,
    radius: number,
    strength: number,
    speed: number,
    maxLife: number
): void {
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

// ======== 地面涟漪系统（Ground Ripples）========
// 与水面涟漪结构相同，但渲染到地面材质的 bumpTexture（法线扰动）
// 由 env-particles 在粒子落地时触发，模拟雨滴/落叶触地效果
const GROUND_RIPPLE_SIZE = 256; // 地面涟漪纹理尺寸
const GROUND_RIPPLE_MAX = 64; // 最大同时活跃数
let _groundRipples: RippleSource[] = [];
let _groundRippleTex: DynamicTexture | null = null;
let _groundRippleScene: Scene | null = null;
let _groundRippleDirty = false;

// 地面几何提供者（由 env-ground 注入，避免 env-water→env-ground 循环依赖）。
// 用于将涟漪世界坐标映射到地面 mesh 的 UV 空间。默认原点居中、尺寸 60。
let _groundGeomProvider: () => { centerX: number; centerZ: number; size: number } = () => ({
    centerX: 0,
    centerZ: 0,
    size: 60,
});

/** 注入地面几何提供者（env-ground 在模块初始化时调用一次） */
export function setGroundGeometryProvider(
    provider: () => { centerX: number; centerZ: number; size: number }
): void {
    _groundGeomProvider = provider;
}

/** 添加地面涟漪（粒子落地时调用） */
export function addGroundRipple(
    pos: Vector3,
    radius = 3,
    strength = 0.3,
    speed = 1.5,
    maxLife = 2
): void {
    // 复用死亡 slot
    for (let i = 0; i < _groundRipples.length; i++) {
        if (_groundRipples[i].life <= 0) {
            _fillGroundRippleSlot(i, pos, radius, strength, speed, maxLife);
            return;
        }
    }
    // 未满 → push
    if (_groundRipples.length < GROUND_RIPPLE_MAX) {
        const idx = _groundRipples.length;
        _groundRipples.push({
            position: new Vector3(0, 0, 0),
            radius: 0,
            strength: 0,
            speed: 0,
            life: 0,
            maxLife: 0,
        });
        _fillGroundRippleSlot(idx, pos, radius, strength, speed, maxLife);
        return;
    }
    // 全活 → 替换寿命最短的
    let oldest = 0;
    for (let i = 1; i < _groundRipples.length; i++) {
        if (_groundRipples[i].life < _groundRipples[oldest].life) {
            oldest = i;
        }
    }
    _fillGroundRippleSlot(oldest, pos, radius, strength, speed, maxLife);
}

function _fillGroundRippleSlot(
    idx: number,
    pos: Vector3,
    radius: number,
    strength: number,
    speed: number,
    maxLife: number
): void {
    const r = _groundRipples[idx];
    r.position.copyFrom(pos);
    r.radius = Math.max(0.5, radius);
    r.strength = clamp01(strength);
    r.speed = Math.max(0.5, speed);
    r.life = maxLife > 0 ? maxLife : 3;
    r.maxLife = maxLife;
    _groundRippleDirty = true;
}

export function clearGroundRipples(): void {
    _groundRipples = [];
    _groundRippleDirty = true;
}

/** 释放地面涟漪纹理与状态（由 disposeWater / disposeGround 调用，防止 GPU 纹理泄漏） */
export function disposeGroundRipples(): void {
    _groundRippleTex = safeDispose(_groundRippleTex);
    _groundRippleScene = null;
    _groundRipples = [];
    _groundRippleDirty = false;
}

/** 获取地面涟漪纹理（供 env-ground 设置到 bumpTexture） */
export function getGroundRippleTexture(scene: Scene): Texture | null {
    if (!_groundRippleTex || _groundRippleScene !== scene) {
        // 场景变更时释放旧纹理
        if (_groundRippleTex && _groundRippleScene !== scene) {
            _groundRippleTex.dispose();
        }
        _groundRippleScene = scene;
        const tex = new DynamicTexture(
            'groundRippleTex',
            { width: GROUND_RIPPLE_SIZE, height: GROUND_RIPPLE_SIZE },
            scene,
            false
        );
        tex.name = 'groundRippleTex';
        _groundRippleTex = tex;
        _groundRippleDirty = true;
    }
    return _groundRippleTex;
}

/** 是否有活跃的地面涟漪（供 env-ground 判断是否需要叠加 ripple 法线纹理） */
export function hasActiveGroundRipples(): boolean {
    return _groundRipples.length > 0;
}

/** 每帧更新地面涟漪纹理（由 env-ground 的 update observer 驱动） */
export function updateGroundRipples(dt: number): void {
    if (_groundRipples.length === 0) {
        return;
    }

    // 更新生命
    let anyAlive = false;
    for (const r of _groundRipples) {
        if (r.life <= 0) {
            continue;
        }
        r.life -= dt;
        anyAlive = true;
    }
    if (!anyAlive) {
        _groundRipples = [];
        return;
    }

    if (!_groundRippleDirty && _groundRipples.every((r) => r.life <= 0)) {
        return;
    }
    _groundRippleDirty = false;

    // 绘制涟漪法线扰动到 DynamicTexture 的 canvas
    const rippleTex = _groundRippleTex;
    if (!rippleTex) {
        return;
    }
    const ctx = rippleTex.getContext();
    if (!ctx) {
        return;
    }

    const S = GROUND_RIPPLE_SIZE;
    ctx.clearRect(0, 0, S, S);
    // 默认法线朝上 (128,128,255) = 无扰动
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, S, S);

    // 地面 mesh 几何：将涟漪世界坐标映射到纹理 UV（原点/尺寸由 env-ground 注入）
    const geom = _groundGeomProvider();
    const safeSize = geom.size || 60;
    const halfSize = safeSize / 2;
    // 世界单位 → 像素比例（用于半径换算，使涟漪大小与地面尺度一致）
    const worldToPixel = S / safeSize;

    for (const r of _groundRipples) {
        if (r.life <= 0) {
            continue;
        }
        const lifeRatio = r.life / (r.maxLife || 1);
        const alpha = Math.max(0, lifeRatio);
        const currentRadius = r.radius * (1 + (1 - lifeRatio) * 0.5);
        const pixelRadius = Math.max(2, currentRadius * worldToPixel);

        // 世界坐标 → UV → 像素中心。地面 mesh 中心对应纹理中心。
        const u = (r.position.x - geom.centerX) / geom.size + 0.5;
        const v = (r.position.z - geom.centerZ) / geom.size + 0.5;
        // 落在地面范围外的涟漪跳过绘制（含半径外扩容差）
        if (
            r.position.x < geom.centerX - halfSize - currentRadius ||
            r.position.x > geom.centerX + halfSize + currentRadius ||
            r.position.z < geom.centerZ - halfSize - currentRadius ||
            r.position.z > geom.centerZ + halfSize + currentRadius
        ) {
            continue;
        }
        const px = u * S;
        const py = v * S;

        // 径向渐变法线扰动：中心法线偏转最大，向外衰减
        const grad = ctx.createRadialGradient(px, py, 0, px, py, pixelRadius);
        // 涟漪中心：法线偏转（r=偏红, g=偏绿, b=255）
        const rStrength = r.strength * alpha;
        grad.addColorStop(0, `rgb(${128 + rStrength * 80}, ${128}, 255)`);
        grad.addColorStop(0.5, `rgb(128, ${128 + rStrength * 60}, 255)`);
        grad.addColorStop(1, 'rgb(128,128,255)');
        ctx.fillStyle = grad;
        ctx.fillRect(px - pixelRadius, py - pixelRadius, pixelRadius * 2, pixelRadius * 2);
    }

    // 更新 texture
    if (_groundRippleTex) {
        _groundRippleTex.update();
    }
}

// ======== 焦散系统（静态纹理 + UV 滚动）========
let _causticTexture: Texture | null = null;
let _causticScene: Scene | null = null;
let _lastCausticColor: [number, number, number] | null = null;
const CAUSTIC_TEX_SIZE = 128;

// ADR-115 P1: 高频法线细节纹理（程序化生成，单例，不随水色变化）
// P1 增强：1024×1024 + 6 层 octave + 波峰锐化 → 高光密度 + 锐度提升
let _detailNormalTexture: Texture | null = null;
let _detailNormalScene: Scene | null = null;
const DETAIL_NORMAL_TEX_SIZE = 1024;

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

    _causticTexture = safeDispose(_causticTexture);
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
                    h += _valueNoise((x * freq) / s, (y * freq) / s) * amp;
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
    // wavePhase 由 _waterUpdateCallback 每帧统一写入，此处无需重复赋值
    mat.setColor3('waterColor', col3FromTriple(state.waterColor));
    mat.setFloat('waterTransparency', state.waterTransparency);
    mat.setFloat('waterLevel', state.waterLevel);
    mat.setInt('uWaterFlip', state.waterFlip ? 1 : 0);

    const hasEnv = !!scene.environmentTexture;
    mat.setFloat('envIntensity', hasEnv ? (scene.environmentIntensity ?? 0.8) : 0);
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

    // ——— 焦散（随 waterColor 重新生成）——
    const causticTex = ensureCausticTexture(scene, state.waterColor);
    mat.setTexture('uCausticTex', causticTex);
    mat.setFloat('uCausticIntensity', state.causticIntensity);
    mat.setFloat('uCausticSpeed', 0.5);
    mat.setFloat('uCausticScale', 0.04);

    // ——— ADR-115 P1: 高频法线扰动层 + Sun Glitter（波浪联动）——

    const detailNormalTex = ensureDetailNormalTexture(scene);
    mat.setTexture('uDetailNormalTex', detailNormalTex);
    mat.setFloat('uDetailNormalStrength', state.waterNormalStrength);
    // 波纹方格尺度：tile 周期 = 1/tiling 世界单位
    // tiling1=0.5 → 大尺度波纹单元 ≈2 单位（原 0.2 → 5 单位，偏大似角色身高）
    // tiling2=1.5 → 细尺度 ≈0.67 单位；两层保持 3:1 比例，层次不丢
    mat.setFloat('uDetailNormalTiling1', 0.5);
    mat.setFloat('uDetailNormalTiling2', 1.5);
    // P2 修复：删除 dead code，改为动态计算速度（与 Gerstner 波相位同步）
    const waveAnimSpeed = state.waterAnimSpeed ?? 1;
    const [speed1, speed2] = computeDetailNormalSpeeds(waveAnimSpeed);
    mat.setFloat('uDetailNormalSpeed1', speed1);
    mat.setFloat('uDetailNormalSpeed2', speed2);
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
    mat.setColor3('waterFogColor', col3FromTriple(state.waterFogColor));
    mat.setFloat('waterFogDensity', state.waterFogDensity);
    mat.setFloat('waterFogOpacityInfluence', state.waterFogOpacityInfluence);

    // ——— 波方向（风向联动）———
    const windDirs = computeWaveDirs(state.windDirection);
    mat.setArray2('uWindDir', windDirs);
    // 细节法线滚动方向：取 Gerstner 主波（第一波）风向
    mat.setVector3('uDetailWindDir', new Vector3(windDirs[0], windDirs[1], 0));

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
    const now = performance.now() / 1000;

    _waterPhase += dt * _waterWaveSpeed;
    m.setFloat('time', now);
    m.setFloat('wavePhase', _waterPhase);
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
    }

    // 涟漪衰减 + 清理死亡 slot
    if (dt > 0) {
        for (const r of _ripples) {
            if (r.life > 0) {
                r.life = Math.max(0, r.life - dt);
            }
        }
        // 全部死亡则清空（避免残留数组）
        if (_ripples.length > 0 && _ripples.every((r) => r.life <= 0)) {
            _ripples = [];
        }
    }

    waterReflection.update(envState, scene);
    _applyWaterLOD(scene);

    // 上传涟漪数据到 shader（按 MAX_RIPPLES 分配，未用 slot 为 0）
    const maxSlots = _maxSlots();
    const posRad = new Array<number>(MAX_RIPPLES * 4).fill(0);
    const strSpdLife = new Array<number>(MAX_RIPPLES * 4).fill(0);
    let aliveCount = 0;
    for (const r of _ripples) {
        if (r.life <= 0 || aliveCount >= maxSlots) {
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
        _waterUpdateObserver = observe(scene.onBeforeRenderObservable, () =>
            _waterUpdateCallback(scene)
        );
    }
}

export function disposeWater(): void {
    // [fix] 先解绑所有 mesh 的材质引用，防止 mesh.dispose() 级联销毁
    // 共享 ShaderMaterial 导致其他仍存活 mesh 引用已销毁材质（_effect=null），
    // 下一帧 GroundMesh.render() → ShaderMaterial.isReady() → 💥
    if (_envSys.water.mesh) {
        _envSys.water.mesh.material = null;
    }
    for (const lod of _waterLODs) {
        lod.material = null;
    }
    // 先释放材质，确保 _effect 被正确清理
    _envSys.water.material = safeDispose(_envSys.water.material);
    // LOD 网格为兄弟根网格（非父子），需显式销毁（材质已解绑，dispose 不再级联）
    for (const lod of _waterLODs) {
        lod.dispose(false, false); // doNotRecurse=false, disposeMaterialAndTextures=false
    }
    _envSys.water.mesh = safeDispose(_envSys.water.mesh, false, false); // doNotRecurse=false, disposeMaterialAndTextures=false
    _waterLODs = [];
    _activeWaterLOD = -1;
    _waterPhase = 0;
    _waterWaveSpeed = 1;
    clearRipples(); // 清理残留涟漪，避免 dispose 后再次 createWater 时显示旧数据
    disposeGroundRipples(); // 释放地面涟漪 DynamicTexture（256×256）+ 状态，防止 GPU 泄漏
    // 释放焦散纹理，防止内存泄漏
    _causticTexture = safeDispose(_causticTexture);
    _causticScene = null;
    _lastCausticColor = null;
    // ADR-115 P1: 释放法线细节纹理
    _detailNormalTexture = safeDispose(_detailNormalTexture);
    _detailNormalScene = null;
    if (_waterUpdateObserver) {
        // 使用注册时捕获的 scene 引用摘除，避免 getScene() 在 scene 已 dispose 时返回 null 导致漏删
        if (_waterScene) {
            _waterUpdateObserver = safeDispose(_waterUpdateObserver);
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

        // 水下灯光衰减：降低方向光和半球光强度，避免暖光+蓝雾产生脏色
        const dl = scene.getLightByName('dir');
        if (dl) {
            dl.intensity =
                dl.intensity * (1 - t) + dl.intensity * UNDERWATER_DIR_INTENSITY_SCALE * t;
        }
        const hl = scene.getLightByName('hemi');
        if (hl) {
            hl.intensity =
                hl.intensity * (1 - t) + hl.intensity * UNDERWATER_HEMI_INTENSITY_SCALE * t;
        }
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
    waterFogColor: [number, number, number];
    waterFogDensity: number;
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
        waterFogDensity: 0.006,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.35,
        causticIntensity: 0.1,
        waterNormalStrength: 0.35,
        waterGlintStrength: 0.05,
        // ADR-115 P3: 地平线淡出 + 天空联动（原缺失，补全）
        waterHorizonFade: 0.8,
        waterSkyColorBlend: 0.15,
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
        waterFogDensity: 0.009,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.4,
        causticIntensity: 0.15,
        waterNormalStrength: 0.5,
        waterGlintStrength: 0.2,
        waterHorizonFade: 0.85,
        waterSkyColorBlend: 0.2,
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
        waterFogDensity: 0.014,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.5,
        causticIntensity: 0.2,
        waterNormalStrength: 0.6,
        waterGlintStrength: 0.3,
        waterHorizonFade: 0.9,
        waterSkyColorBlend: 0.25,
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
        waterFogDensity: 0.022,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.6,
        causticIntensity: 0.25,
        waterNormalStrength: 0.65,
        waterGlintStrength: 0.1,
        waterHorizonFade: 0.9,
        waterSkyColorBlend: 0.15,
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
        waterFogDensity: 0.008,
        waterFogOpacityInfluence: 0,
        fresnelAlphaInfluence: 0.42,
        causticIntensity: 0.2,
        waterNormalStrength: 0.55,
        waterGlintStrength: 0.35,
        waterHorizonFade: 0.85,
        waterSkyColorBlend: 0.3,
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
        waterFogColor: preset.waterFogColor,
        waterFogDensity: preset.waterFogDensity,
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

// ======== [ADR-138] env-dispatcher 回调注册 ========
const _WATER_KEYS = getEnvKeys('water');

registerEnvCallback((changed, state) => {
    if (!changed || [...changed].some((k) => _WATER_KEYS.includes(k))) {
        if (state.waterEnabled) {
            createWater(state);
        } else {
            disposeWater();
        }
    }
});
