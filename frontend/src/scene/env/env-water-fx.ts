// env-water-fx.ts — 水面 FX 子系统：涟漪/地面涟漪/LOD/水下（ADR-239 拆分）
// 自 env-water.ts 迁出。宿主 env-water.ts 保留生命周期编排 + material/reflect，本模块互不 import 宿主。
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';

import { clamp01 } from '@/core/clamp';
import { envState } from '@/core/config';
import { logWarn } from '@/core/logger';
import { safeDispose } from '@/core/dispose-helpers';
import { _envSys } from './_shared/env-context';

// ======== 常量 ========
const LOD_HIGH_DISTANCE = 30; // LOD 切换距离（近）
const LOD_LOW_DISTANCE = 80; // LOD 切换距离（远）
const UNDERWATER_TRANSITION_SPEED = 0.8; // 水下过渡速度（秒）

// 波方向偏移（Gerstner 波 4 层）— 四风归一后加宽偏移，制造交叉浪
const WAVE_DIR_OFFSETS: [number, number, number, number] = [0, 0.6, -0.4, 1.2];
// 涟漪参数
const RIPPLE_MIN_RADIUS = 0.1;
const RIPPLE_MIN_SPEED = 0.1;
const RIPPLE_INFINITY_LIFE = 9999;
// 水下后处理色调：蓝绿色相（colorCurves 色相旋转滤镜，保亮度，替代原 FOGMODE_EXP2 雾）
const UNDERWATER_TINT_HUE = 200;

export const MAX_RIPPLES = 1024;
interface RippleSource {
    position: Vector3;
    radius: number;
    strength: number;
    speed: number;
    life: number;
    maxLife: number;
}
let _ripples: RippleSource[] = [];

// ======== 水下灯光衰减（微降，保留亮度；色调由后处理 colorCurves 负责）========
const UNDERWATER_DIR_INTENSITY_SCALE = 0.8;
const UNDERWATER_HEMI_INTENSITY_SCALE = 0.9;

// ======== 水下状态 ========
let _underwaterActive = false;
let _underwaterSavedDirIntensity = 1;
let _underwaterSavedHemiIntensity = 0.6;
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

// === LOD 水面：记录所有 LOD 子网格（兄弟根网格），用于同步缩放/位置和手动可见性控制 ===
let _waterLODs: Mesh[] = [];
let _activeWaterLOD = -1; // 手动 LOD 当前层级：-1=未初始化, 0=high, 1=mid, 2=low

/** 供宿主 createWater 写入 LOD 网格（拆分后状态归本模块，宿主经函数访问） */
export function setWaterLODMeshes(meshes: Mesh[]): void {
    _waterLODs = meshes;
    _activeWaterLOD = 0;
}

/** 供宿主 disposeWater 重置 LOD 状态 */
export function resetWaterLODState(): void {
    _waterLODs = [];
    _activeWaterLOD = -1;
}

/** 供宿主/material 读取 LOD 网格（同步缩放/位置或逐层 dispose） */
export function getWaterLODMeshes(): Mesh[] {
    return _waterLODs;
}

/** 供宿主 disposeWater 重置水下状态 flag（灯光强度恢复由 resetUnderwaterState 负责） */
export function resetUnderwaterFlags(): void {
    _underwaterActive = false;
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
}

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

/** 每帧涟漪衰减 + 死亡清理（由材质更新回调驱动；dt<=0 时跳过避免零时距死循环） */
export function updateRipples(dt: number): void {
    if (dt <= 0) {
        return;
    }
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

/** 收集涟漪数据供 shader 上传（材质回调调用；按 MAX_RIPPLES 分配，未用 slot 为 0） */
export function buildRippleBuffers(): {
    posRad: number[];
    strSpdLife: number[];
    aliveCount: number;
} {
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
    return { posRad, strSpdLife, aliveCount };
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

// ======== LOD 选择与切换 ========
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

// ======== 水下过渡（相机潜入水面）========
export function updateUnderwaterTransition(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    if (!envState.waterEnabled || !scene.activeCamera) {
        if (_underwaterTransitionProgress > 0 || _underwaterActive) {
            resetUnderwaterState(scene, pipeline);
        }
        return;
    }

    const camY = scene.activeCamera.globalPosition.y;
    // ADR-211 Part3：水下效果受 underwaterEnabled 门控。关闭时无论相机是否潜入水下，
    // 都视作非水下目标——复用现有过渡回退逻辑平滑退出（雾/色调/灯光归位），不硬切避免闪跳。
    _underwaterTarget = (envState.underwaterEnabled ?? true) && camY < envState.waterLevel;

    if (_underwaterTarget && !_underwaterActive) {
        _underwaterActive = true;
        // 保存原始灯光强度（入水首帧，灯光尚未被衰减）
        const dl0 = scene.getLightByName('dir');
        if (dl0) {
            _underwaterSavedDirIntensity = dl0.intensity;
        }
        const hl0 = scene.getLightByName('hemi');
        if (hl0) {
            _underwaterSavedHemiIntensity = hl0.intensity;
        }
    } else if (!_underwaterTarget && _underwaterActive && _underwaterTransitionProgress < 0.001) {
        _underwaterActive = false;
        // 恢复原始灯光强度
        const dl = scene.getLightByName('dir');
        if (dl) {
            dl.intensity = _underwaterSavedDirIntensity;
        }
        const hl = scene.getLightByName('hemi');
        if (hl) {
            hl.intensity = _underwaterSavedHemiIntensity;
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
            // 色差默认值从 20 降至 8，避免明显色散条纹（原 20 产生可见红蓝边）
            pipeline.chromaticAberration.aberrationAmount =
                envState.underwaterChromaticAmount * t * 0.4;
        }

        // 后处理色调叠加：用 imageProcessing.colorCurves 做蓝绿色相旋转（保亮度），
        // 替代原 FOGMODE_EXP2 全局雾（雾会糊掉水面且配合灯光衰减双重压暗画面）。
        const ip = pipeline.imageProcessing;
        if (ip) {
            ip.colorCurvesEnabled = true;
            const curves = ip.colorCurves ?? (ip.colorCurves = new ColorCurves());
            curves.globalHue = UNDERWATER_TINT_HUE;
            // colorCurves 是乘性滤镜（非纯色相旋转），密度过大会压暗画面；
            // 乘以 0.3 使默认上限≈0.15（近白蓝绿色调），保亮度。
            curves.globalDensity = t * envState.underwaterToneIntensity * 0.3;
        }

        // 水下灯光衰减：从保存的原始值计算混合（微降，不再砍到 30%/40%）
        const dl = scene.getLightByName('dir');
        if (dl) {
            dl.intensity =
                _underwaterSavedDirIntensity * (1 - t + UNDERWATER_DIR_INTENSITY_SCALE * t);
        }
        const hl = scene.getLightByName('hemi');
        if (hl) {
            hl.intensity =
                _underwaterSavedHemiIntensity * (1 - t + UNDERWATER_HEMI_INTENSITY_SCALE * t);
        }
    } else if (!_underwaterActive) {
        pipeline.chromaticAberrationEnabled = false;
        // 完全出水：关闭后处理色调，恢复原始观感
        const ip = pipeline.imageProcessing;
        if (ip) {
            ip.colorCurvesEnabled = false;
            if (ip.colorCurves) {
                ip.colorCurves.globalDensity = 0;
            }
        }
    }
}

export function resetUnderwaterState(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _underwaterActive = false;
    // 恢复灯光强度
    const dl = scene.getLightByName('dir');
    if (dl) {
        dl.intensity = _underwaterSavedDirIntensity;
    }
    const hl = scene.getLightByName('hemi');
    if (hl) {
        hl.intensity = _underwaterSavedHemiIntensity;
    }
    _underwaterTransitionProgress = 0;
    _underwaterTarget = false;
    pipeline.chromaticAberrationEnabled = false;
    // 清除后处理色调
    const ip = pipeline.imageProcessing;
    if (ip) {
        ip.colorCurvesEnabled = false;
        if (ip.colorCurves) {
            ip.colorCurves.globalDensity = 0;
        }
    }
}
