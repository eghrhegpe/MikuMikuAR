// env-ground.ts — 地面子系统（程序化/纹理/地形/反射/淡出/滚动）
// 从 env-impl.ts 拆分而来。

import {
    Scene,
    Color3,
    Texture,
    BaseTexture,
    DynamicTexture,
    StandardMaterial,
    PBRMaterial,
    FresnelParameters,
    Material,
    Mesh,
    MeshBuilder,
    GroundMesh,
    MirrorTexture,
    Plane,
    Vector3,
    Matrix,
} from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { col3FromTriple, rgbString } from '@/core/color-helpers';
import { logWarn } from '@/core/logger';
import { fbm, hash2 } from './env-terrain';
import { createHeightmapGround, applyTerrainMaterial } from './env-terrain';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { getPlanarQualityOverride } from './env-reflection';
import { createCanvasTexture, getOrCreateCanvasTexture, isCacheOwnedTexture } from './env-texture';
import { _envSys, getScene } from './env-context';
import { ensureEnvUpdateObserver } from './env-impl';
import {
    getGroundRippleTexture,
    hasActiveGroundRipples,
    setGroundGeometryProvider,
    disposeGroundRipples,
} from './env-water';
import { getCanvasCtx } from './env-type-helpers';

// ======== ADR-114: 材质适配层（StandardMaterial ↔ PBRMaterial）========

type GroundMat = StandardMaterial | PBRMaterial;

function _getAlbedoTex(mat: GroundMat): Texture | null {
    if (mat instanceof PBRMaterial) {
        return mat.albedoTexture as Texture | null;
    }
    return mat.diffuseTexture as Texture | null;
}
function _setAlbedoTex(mat: GroundMat, tex: Texture | null): void {
    if (mat instanceof PBRMaterial) {
        mat.albedoTexture = tex;
        return;
    }
    mat.diffuseTexture = tex;
}
function _getAlbedoColor(mat: GroundMat): Color3 {
    if (mat instanceof PBRMaterial) {
        return mat.albedoColor;
    }
    return mat.diffuseColor;
}
function _setAlbedoColor(mat: GroundMat, color: Color3): void {
    if (mat instanceof PBRMaterial) {
        mat.albedoColor = color;
        return;
    }
    mat.diffuseColor = color;
}

// ======== ADR-114: PBR 材质工厂 ========

/** ADR-114 Phase 2: 反射模糊映射到 roughness 偏移（blur=1 最多增加 0.4）；低质量模式自动关闭 */
export function _effectiveRoughness(state: EnvState): number {
    // 低质量模式自动关闭反射模糊（退化为锐利反射）
    if (state.reflectionQuality === 'low' || state.reflectionQuality === 'off') {
        return state.groundRoughness;
    }
    return Math.max(0, Math.min(1, state.groundRoughness + state.groundReflectionBlur * 0.4));
}

/** ADR-114 Phase 2: 法线扭曲映射到 bumpTexture.level 增强（distort=1 时额外 +2.0）；低质量模式自动关闭 */
export function _effectiveBumpLevel(state: EnvState): number {
    // 低质量模式自动关闭法线扭曲
    if (state.reflectionQuality === 'low' || state.reflectionQuality === 'off') {
        return state.groundNormalStrength;
    }
    return state.groundNormalStrength + state.groundReflectionDistort * 2.0;
}

function createGroundMaterial(state: EnvState, scene: Scene): GroundMat {
    if (!state.groundPbrEnabled) {
        return new StandardMaterial('envGroundMat', scene);
    }
    const mat = new PBRMaterial('envGroundPBR', scene);
    mat.metallic = state.groundMetallic;
    mat.roughness = _effectiveRoughness(state);
    // PBR 自动使用 scene.environmentTexture 作为 IBL，无需手动赋值
    mat.useSpecularOverAlpha = false;
    mat.useRadianceOverAlpha = false;
    // ADR-114: 透明模式下显式设置 transparencyMode，PBRMaterial 依赖显式队列
    mat.transparencyMode = _needAlphaBlend(state)
        ? Material.MATERIAL_ALPHABLEND
        : Material.MATERIAL_OPAQUE;
    return mat;
}

/** 判断地面是否需要 alpha blend 渲染（alpha < 1 或边缘淡出）。 */
function _needAlphaBlend(state: EnvState): boolean {
    return state.groundAlpha < 1 || state.groundEdgeFade > 0;
}

// ======== ADR-114: 程序化纹理生成（木纹/大理石/混凝土/瓷砖/地毯/金属板）========

const PROCEDURAL_SIZE = 512;

/** 程序化地面纹理类型（单一来源：env-state-schema.ts 的 groundProceduralTexture 枚举） */
export type GroundProceduralKind = EnvState['groundProceduralTexture'];

// ---- 通用像素填充辅助（统一标准，消除逐通道样板代码）----

function _clamp255(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
}

/** 遍历 size×size 像素；pixel() 返回 [r,g,b]（自动夹取 0~255，alpha 恒 255）。 */
function _fillPixels(
    ctx: CanvasRenderingContext2D,
    size: number,
    pixel: (x: number, y: number) => [number, number, number]
): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const [r, g, b] = pixel(x, y);
            const i = (y * size + x) * 4;
            data[i] = _clamp255(r);
            data[i + 1] = _clamp255(g);
            data[i + 2] = _clamp255(b);
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

/** 灰度粗糙度贴图：value() 返回粗糙度 0~1（自动夹取）。 */
function _roughnessMap(
    ctx: CanvasRenderingContext2D,
    size: number,
    value: (x: number, y: number) => number
): void {
    _fillPixels(ctx, size, (x, y) => {
        const v = Math.max(0, Math.min(1, value(x, y))) * 255;
        return [v, v, v];
    });
}

/** 法线贴图：由高度函数前向差分导出（与 Babylon bump 约定一致），strength 控制凹凸强度。 */
function _normalMap(
    ctx: CanvasRenderingContext2D,
    size: number,
    height: (x: number, y: number) => number,
    strength: number
): void {
    _fillPixels(ctx, size, (x, y) => {
        const c = height(x, y);
        const cx = height(x + 1, y);
        const cy = height(x, y + 1);
        const dx = (cx - c) * strength;
        const dy = (cy - c) * strength;
        const nz = 1.0;
        const len = Math.sqrt(dx * dx + dy * dy + nz * nz);
        return [
            ((dx / len) * 0.5 + 0.5) * 255,
            ((dy / len) * 0.5 + 0.5) * 255,
            ((nz / len) * 0.5 + 0.5) * 255,
        ];
    });
}

// ---- 木纹 wood ----

function _woodGrain(x: number, y: number, seed: number): number {
    const nLow = fbm(x * 0.02, y * 0.005, seed, 4, 1.0); // ~[-1, 1]
    const nHigh = fbm(x * 0.2, y * 0.2, seed + 100, 2, 1.0);
    return (nLow + nHigh * 0.2 + 1) * 0.5; // ~[0,1]
}

function generateWoodAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _fillPixels(ctx, size, (x, y) => {
        const n = _woodGrain(x, y, seed);
        return [139 + n * 40 - 10, 69 + n * 25 - 5, 19 + n * 12 - 2];
    });
}

function generateWoodRoughness(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _roughnessMap(ctx, size, (x, y) => {
        const n = (fbm(x * 0.015, y * 0.004, seed, 3, 1.0) + 1) * 0.5;
        return 0.4 + n * 0.2; // [0.4, 0.6]
    });
}

function generateWoodNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _normalMap(ctx, size, (x, y) => fbm(x * 0.02, y * 0.005, seed, 4, 1.0), 20.0);
}

// ---- 大理石 marble ----
// 经典白灰大理石：fbm 湍流扭曲 sin 场产生细脉络纹。

function _marbleVein(x: number, y: number, seed: number): number {
    const turb = fbm(x * 0.008, y * 0.008, seed, 5, 1.0);
    const vein = Math.abs(Math.sin((x + y) * 0.015 + turb * 6));
    return Math.pow(vein, 3); // 0 = 脉络中心（暗），1 = 石基（亮）
}

function generateMarbleAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _fillPixels(ctx, size, (x, y) => {
        const vein = _marbleVein(x, y, seed);
        const base = 228 + fbm(x * 0.05, y * 0.05, seed + 50, 2, 1.0) * 12;
        const dark = 95;
        const c = dark + (base - dark) * vein;
        return [c, c * 0.99, c * 0.97]; // 微暖白
    });
}

function generateMarbleRoughness(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _roughnessMap(ctx, size, (x, y) => {
        const vein = _marbleVein(x, y, seed);
        return 0.16 + (1 - vein) * 0.14; // 脉络处略粗糙
    });
}

function generateMarbleNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _normalMap(ctx, size, (x, y) => _marbleVein(x, y, seed), 6.0);
}

// ---- 混凝土 concrete ----
// 水泥基面：大面积斑驳 + 细骨料噪点。

function _concreteBase(x: number, y: number, seed: number): number {
    const blotch = fbm(x * 0.015, y * 0.015, seed, 4, 1.0);
    const fine = fbm(x * 0.15, y * 0.15, seed + 77, 2, 1.0);
    return 128 + blotch * 30 + fine * 14;
}

function generateConcreteAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _fillPixels(ctx, size, (x, y) => {
        const c = _concreteBase(x, y, seed);
        return [c, c, c * 1.03]; // 微冷灰
    });
}

function generateConcreteRoughness(
    ctx: CanvasRenderingContext2D,
    size: number,
    seed: number
): void {
    _roughnessMap(ctx, size, (x, y) => {
        const fine = (fbm(x * 0.15, y * 0.15, seed + 77, 2, 1.0) + 1) * 0.5;
        return 0.72 + fine * 0.18;
    });
}

function generateConcreteNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _normalMap(ctx, size, (x, y) => fbm(x * 0.15, y * 0.15, seed + 77, 3, 1.0), 10.0);
}

// ---- 瓷砖 tile ----
// 方形瓷砖 + 填缝剂缝，每砖色差，凹陷缝法线。

const _TILE = 128;
const _GROUT = 6;
const _BEVEL = 8;

/** 砖面高度：0 = 缝内，1 = 砖面，缝到砖面有倒角过渡。 */
function _tileFace(x: number, y: number): number {
    const gx = x % _TILE;
    const gy = y % _TILE;
    const hx = gx < _GROUT ? 0 : Math.min(1, (gx - _GROUT) / _BEVEL);
    const hy = gy < _GROUT ? 0 : Math.min(1, (gy - _GROUT) / _BEVEL);
    return Math.min(hx, hy);
}

function generateTileAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _fillPixels(ctx, size, (x, y) => {
        const face = _tileFace(x, y);
        if (face === 0) {
            return [72, 72, 75]; // 填缝剂（深灰）
        }
        const tx = Math.floor(x / _TILE);
        const ty = Math.floor(y / _TILE);
        const tint = hash2(tx, ty, seed); // 每砖色差
        const n = fbm(x * 0.05, y * 0.05, seed + tx * 7 + ty * 13, 2, 1.0);
        const base = 198 + tint * 28 + n * 8;
        return [base, base, base + 6]; // 陶瓷白，微冷
    });
}

function generateTileRoughness(ctx: CanvasRenderingContext2D, size: number, _seed: number): void {
    _roughnessMap(ctx, size, (x, y) => (_tileFace(x, y) === 0 ? 0.85 : 0.22)); // 缝粗糙、砖面光滑
}

function generateTileNormal(ctx: CanvasRenderingContext2D, size: number, _seed: number): void {
    _normalMap(ctx, size, (x, y) => _tileFace(x, y), 30.0); // 缝凹陷
}

// ---- 地毯 carpet ----
// 深红地毯：高频绒毛噪点 + 大面积磨损斑块，高粗糙度。

function _carpetPile(x: number, y: number, seed: number): number {
    return fbm(x * 0.3, y * 0.3, seed, 3, 1.0);
}

function generateCarpetAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _fillPixels(ctx, size, (x, y) => {
        const pile = _carpetPile(x, y, seed);
        const wear = fbm(x * 0.02, y * 0.02, seed + 33, 3, 1.0); // 磨损斑块
        return [
            118 + pile * 26 + wear * 22,
            42 + pile * 12 + wear * 10,
            46 + pile * 12 + wear * 10,
        ];
    });
}

function generateCarpetRoughness(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _roughnessMap(ctx, size, (x, y) => {
        const pile = (_carpetPile(x, y, seed) + 1) * 0.5;
        return 0.88 + pile * 0.1;
    });
}

function generateCarpetNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _normalMap(ctx, size, (x, y) => _carpetPile(x, y, seed), 14.0);
}

// ---- 金属板 metal ----
// 拉丝金属：沿 x 轴拉长的各向异性拉丝纹，低粗糙度。

function _metalStreak(x: number, y: number, seed: number): number {
    return fbm(x * 0.005, y * 0.25, seed, 3, 1.0); // x 低频 → 拉丝沿 x 方向
}

function generateMetalAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _fillPixels(ctx, size, (x, y) => {
        const s = _metalStreak(x, y, seed);
        const base = 158 + s * 34;
        return [base, base, base + 7]; // 冷调钢灰
    });
}

function generateMetalRoughness(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _roughnessMap(ctx, size, (x, y) => {
        const s = (_metalStreak(x, y, seed) + 1) * 0.5;
        return 0.24 + s * 0.2; // 拉丝各向异性
    });
}

function generateMetalNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    _normalMap(ctx, size, (x, y) => _metalStreak(x, y, seed), 5.0);
}

// ---- 生成器注册表 + 入口 ----

interface ProceduralGenerators {
    albedo: (ctx: CanvasRenderingContext2D, size: number, seed: number) => void;
    roughness: (ctx: CanvasRenderingContext2D, size: number, seed: number) => void;
    normal: (ctx: CanvasRenderingContext2D, size: number, seed: number) => void;
}

const PROCEDURAL_GENERATORS: Record<Exclude<GroundProceduralKind, 'none'>, ProceduralGenerators> = {
    wood: {
        albedo: generateWoodAlbedo,
        roughness: generateWoodRoughness,
        normal: generateWoodNormal,
    },
    marble: {
        albedo: generateMarbleAlbedo,
        roughness: generateMarbleRoughness,
        normal: generateMarbleNormal,
    },
    concrete: {
        albedo: generateConcreteAlbedo,
        roughness: generateConcreteRoughness,
        normal: generateConcreteNormal,
    },
    tile: {
        albedo: generateTileAlbedo,
        roughness: generateTileRoughness,
        normal: generateTileNormal,
    },
    carpet: {
        albedo: generateCarpetAlbedo,
        roughness: generateCarpetRoughness,
        normal: generateCarpetNormal,
    },
    metal: {
        albedo: generateMetalAlbedo,
        roughness: generateMetalRoughness,
        normal: generateMetalNormal,
    },
};

interface ProceduralTextures {
    albedo: Texture;
    roughness: Texture;
    normal: Texture;
}

function generateProceduralGroundTextures(
    type: Exclude<GroundProceduralKind, 'none'>,
    seed: number,
    scene: Scene,
    state?: EnvState
): ProceduralTextures {
    const gens = PROCEDURAL_GENERATORS[type];
    const hasOverlay = state != null && state.groundOverlay !== 'none';
    const overlaySuffix = hasOverlay
        ? `_ov:${state!.groundOverlay}:${state!.groundGridSize}:${state!.groundLineColor.join(',')}`
        : '';
    const make = (channel: 'albedo' | 'roughness' | 'normal') =>
        getOrCreateCanvasTexture(`groundProcedural_${type}_${seed}_${channel}${channel === 'albedo' ? overlaySuffix : ''}`, {
            size: PROCEDURAL_SIZE,
            draw: (ctx, s) => {
                gens[channel](ctx, s, seed);
                if (channel === 'albedo' && hasOverlay) {
                    _drawOverlayPattern(ctx, s, state!);
                }
            },
            scene,
            name: `groundProcedural_${type}_${channel}`,
            wrap: 'wrap',
            generateMipMaps: true,
        });
    return { albedo: make('albedo'), roughness: make('roughness'), normal: make('normal') };
}

/**
 * 释放材质及其所有纹理（PBR 和 Standard 共用 opacity/bump/reflection，差异在 albedo/diffuse）。
 * 缓存所有的贴图（程序化三件套 / 边缘淡出）跳过——由 disposeTextureCache 统一释放，
 * 避免提前 dispose 后 getOrCreateCanvasTexture 复用已失效贴图导致地面空白。
 */
function disposeGroundMaterial(mat: Material | null): void {
    if (!mat) {
        return;
    }
    const disposeTex = (tex: BaseTexture | null) => {
        if (tex && !isCacheOwnedTexture(tex)) {
            tex.dispose();
        }
    };
    if (mat instanceof PBRMaterial) {
        disposeTex(mat.albedoTexture);
        disposeTex(mat.metallicTexture);
    }
    if (mat instanceof StandardMaterial) {
        disposeTex(mat.diffuseTexture);
    }
    if (mat instanceof PBRMaterial || mat instanceof StandardMaterial) {
        disposeTex(mat.bumpTexture);
        disposeTex(mat.opacityTexture);
        disposeTex(mat.reflectionTexture);
    }
    mat.dispose();
}

// ======== ADR-134: Infinite ground constants ========
// 相机追踪 lerp 跟随方案已废弃（_groundInfinitePrevX/Z 从未被使用），
// 无限地面改为固定大 mesh + 纹理世界空间平铺，不再跟随相机移动。
const INFINITE_GROUND_SIZE = 2000; // 无限地面 mesh 固定尺寸（匹配碰撞体范围）
let _groundActualSize = 60; // 当前 mesh 实际尺寸（用于 UV 补偿计算）

// [doc:adr-160] 向 env-water 注入地面几何，供涟漪世界坐标→UV 映射。
// 地面 mesh 不跟随相机，中心在原点 XZ，尺寸为 _groundActualSize。
setGroundGeometryProvider(() => ({ centerX: 0, centerZ: 0, size: _groundActualSize }));

// ======== Module state ========
let _currentGroundKey: string = '';
let _onTerrainReady: (() => void) | null = null;
let _onGroundChanged: (() => void) | null = null;
let _prevGroundHeight = NaN;
let _prevGroundPitch = NaN;
let _prevGroundRoll = NaN;
let _groundScrollU = 0;
let _groundScrollV = 0;

// ======== 地面涟漪状态 ========
let _groundRipples: BaseTexture | null = null;
let _groundRippleApplied = false;

function _syncGroundRippleTexture(mat: GroundMat, scene: import('@babylonjs/core').Scene): void {
    const tex = getGroundRippleTexture(scene);
    if (tex) {
        // 暂存用户的 normalTexture，用 ripple 纹理覆盖 bumpTexture
        if (!_groundRipples) {
            _groundRipples = mat.bumpTexture;
        }
        mat.bumpTexture = tex;
        tex.level = 0.5; // 半强度叠加，不淹没原始法线
        _groundRippleApplied = true;
    }
}

export function _disableGroundRippleTexture(mat: GroundMat): void {
    if (_groundRippleApplied && _groundRipples !== undefined) {
        mat.bumpTexture = _groundRipples;
        _groundRipples = null;
        _groundRippleApplied = false;
    }
}

// ======== Texture mode cache ========
const _TEX_GROUND_SIZE = 512;
let _texGroundImg: HTMLImageElement | null = null;
let _texGroundImgUrl: string | null = null;
let _texGroundGeneration = 0;

export function clearGroundTexCache() {
    _texGroundImg = null;
    _texGroundImgUrl = null;
    _texGroundGeneration = 0;
}

// ======== 地面镜面反射（ADR-092）========
const groundReflection = new PlanarReflection({
    name: 'ground',
    mode: 'mirrorTexture',
    resolutionMap: { high: 2048, medium: 1024, low: 512, off: 0 },
    // ADR-114 Phase 2: 开启 mipmap 供 PBR roughness 驱动反射模糊
    generateMipMaps: true,
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
    getBlend: (s) => s.groundReflectionBlend,
    getSurfaceLevel: (s) => s.groundLevel,
    getMirrorPlane: (_s, _scene) => {
        const mesh = _envSys.ground.mesh;
        if (mesh) {
            const n = Vector3.TransformNormal(Vector3.Up(), mesh.getWorldMatrix()).normalize();
            return Plane.FromPositionAndNormal(mesh.getAbsolutePosition(), n);
        }
        return new Plane(0, -1, 0, 0);
    },
    predicate: (mesh, _level) => {
        // 排除地面自身和天空球（天空球跟随主相机，在镜像相机中位置不对）
        // 天空反射由 scene.environmentTexture (IBL) 处理
        if (mesh.name.startsWith('envGround')) {
            return false;
        }
        if (mesh.name === 'envSkySphere' || mesh.name === 'envSkyDome') {
            return false;
        }
        return mesh.isEnabled();
    },
    getMaterial: () => _envSys.ground.mesh?.material ?? null,
    mount: (rt) => {
        const mat = _envSys.ground.mesh?.material as GroundMat | null;
        if (!mat) {
            return;
        }
        if (rt) {
            mat.reflectionTexture = rt as MirrorTexture | null;
            // 用当前 blend 值初始化 level，避免默认 1.00 闪烁
            (rt as MirrorTexture).level = envState.groundReflectionBlend;
            if (mat instanceof StandardMaterial) {
                mat.reflectionFresnelParameters = new FresnelParameters();
                mat.reflectionFresnelParameters.isEnabled = false;
                // specularColor 控制灯光高光强度（太阳等），不是镜面反射叠加强度
                // 过高会导致太阳高光刺眼，与 reflectionTexture.level 混淆
                mat.specularColor = new Color3(0.3, 0.3, 0.3);
            }
            // PBR: 反射由 roughness + environmentTexture 驱动，无需 Fresnel
        } else {
            mat.reflectionTexture = null;
            if (mat instanceof StandardMaterial) {
                mat.reflectionFresnelParameters = new FresnelParameters();
                mat.reflectionFresnelParameters.isEnabled = true;
                mat.specularColor = new Color3(0.2, 0.2, 0.2);
            }
        }
    },
    setBlend: (b) => {
        const mat = _envSys.ground.mesh?.material as GroundMat | null;
        if (!mat || !mat.reflectionTexture) {
            return;
        }
        mat.reflectionTexture.level = b;
    },
});
registerReflectionSurface('ground', groundReflection, () =>
    groundReflection.update(envState, getScene())
);

function buildGroundReflection(state: EnvState): void {
    groundReflection.markRenderListDirty();
    groundReflection.update(state, getScene());
}

function disposeGroundReflection(): void {
    groundReflection.dispose();
}

// ======== 地面高度查询（倾斜平面补偿）========
const _groundPlaneNormal = new Vector3();
const _groundPlaneUp = new Vector3(0, 1, 0);
const _groundPlanePoint = new Vector3();
const _terrainInvWorld = new Matrix();
const _terrainLocalPos = new Vector3();
const _terrainWorldPos = new Vector3();

function getTiltedPlaneHeight(mesh: Mesh, x: number, z: number): number {
    const world = mesh.getWorldMatrix();
    Vector3.TransformNormalToRef(_groundPlaneUp, world, _groundPlaneNormal);
    _groundPlaneNormal.normalize();
    if (Math.abs(_groundPlaneNormal.y) < 1e-4) {
        return envState.groundLevel;
    }
    Vector3.TransformCoordinatesFromFloatsToRef(0, 0, 0, world, _groundPlanePoint);
    return (
        _groundPlanePoint.y -
        (_groundPlaneNormal.x * (x - _groundPlanePoint.x) +
            _groundPlaneNormal.z * (z - _groundPlanePoint.z)) /
            _groundPlaneNormal.y
    );
}

export function getGroundHeightAt(x: number, z: number): number {
    const m = _envSys.ground.mesh;
    if (!m || !m.isReady()) {
        return envState.groundLevel;
    }

    if (
        envState.groundType === 'terrain' &&
        typeof (m as GroundMesh).getHeightAtCoordinates === 'function'
    ) {
        try {
            const gm = m as GroundMesh;
            if (Math.abs(gm.rotation.x) > 0.001 || Math.abs(gm.rotation.z) > 0.001) {
                const worldMat = gm.getWorldMatrix();
                worldMat.invertToRef(_terrainInvWorld);
                Vector3.TransformCoordinatesFromFloatsToRef(
                    x,
                    0,
                    z,
                    _terrainInvWorld,
                    _terrainLocalPos
                );
                const localHeight = gm.getHeightAtCoordinates(
                    _terrainLocalPos.x,
                    _terrainLocalPos.z
                );
                if (!isFinite(localHeight)) {
                    return envState.groundLevel;
                }
                Vector3.TransformCoordinatesFromFloatsToRef(
                    _terrainLocalPos.x,
                    localHeight,
                    _terrainLocalPos.z,
                    worldMat,
                    _terrainWorldPos
                );
                return _terrainWorldPos.y;
            }
            return gm.getHeightAtCoordinates(x, z);
        } catch (e) {
            logWarn('terrain', 'getGroundHeightAt failed', e);
            return envState.groundLevel;
        }
    }

    return getTiltedPlaneHeight(m, x, z);
}

export function setOnTerrainReady(cb: (() => void) | null): void {
    _onTerrainReady = cb;
}

export function setOnGroundChanged(cb: (() => void) | null): void {
    _onGroundChanged = cb;
}

// ======== 纹理生成 ========

function _generateGroundTexture(state: EnvState, scene: Scene): Texture {
    const c0 = rgbString(col3FromTriple(state.groundColor));
    const c1 = rgbString(col3FromTriple(state.groundLineColor));

    const size = 512;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        ctx.fillStyle = c0;
        ctx.fillRect(0, 0, s, s);

        if (state.groundOverlay === 'grid') {
            const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));
            ctx.strokeStyle = c1;
            ctx.lineWidth = Math.max(1, Math.round(tileSize / 24));
            for (let x = tileSize; x < s; x += tileSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, s);
                ctx.stroke();
            }
            for (let y = tileSize; y < s; y += tileSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(s, y);
                ctx.stroke();
            }
        } else if (state.groundOverlay === 'checker') {
            const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));
            switch (state.groundPattern) {
                case 'checker':
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? c0 : c1;
                            ctx.fillRect(x, y, tileSize, tileSize);
                        }
                    }
                    break;
                case 'dots':
                    ctx.fillStyle = c0;
                    ctx.fillRect(0, 0, s, s);
                    ctx.fillStyle = c1;
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            ctx.beginPath();
                            ctx.arc(
                                x + tileSize / 2,
                                y + tileSize / 2,
                                tileSize / 3,
                                0,
                                Math.PI * 2
                            );
                            ctx.fill();
                        }
                    }
                    break;
                case 'stripes':
                    for (let x = 0; x < s; x += tileSize) {
                        ctx.fillStyle = (x / tileSize) % 2 === 0 ? c0 : c1;
                        ctx.fillRect(x, 0, tileSize, s);
                    }
                    break;
                case 'radial': {
                    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
                    grad.addColorStop(0, c0);
                    grad.addColorStop(1, c1);
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, 0, s, s);
                    break;
                }
                default:
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? c0 : c1;
                            ctx.fillRect(x, y, tileSize, tileSize);
                        }
                    }
                    break;
            }
        }
    };

    return createCanvasTexture({ size, draw, scene, name: 'envGround', wrap: 'clamp' });
}

// ======== Overlay pattern (grid/checker) for any canvas context ========

function _drawOverlayPattern(
    ctx: CanvasRenderingContext2D,
    size: number,
    state: EnvState
): void {
    if (state.groundOverlay === 'none') return;
    const r = Math.round(state.groundLineColor[0] * 255);
    const g = Math.round(state.groundLineColor[1] * 255);
    const b = Math.round(state.groundLineColor[2] * 255);
    const lineColor = `rgb(${r},${g},${b})`;
    const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));

    if (state.groundOverlay === 'grid') {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, Math.round(tileSize / 24));
        for (let x = tileSize; x < size; x += tileSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
        }
        for (let y = tileSize; y < size; y += tileSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
        }
    } else if (state.groundOverlay === 'checker') {
        ctx.fillStyle = lineColor;
        for (let y = 0; y < size; y += tileSize) {
            for (let x = 0; x < size; x += tileSize) {
                if ((x / tileSize + y / tileSize) % 2 === 0) {
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
        }
    }
}

// ======== Texture mode: external image compositing ========

function _drawTextureGroundCanvas(
    ctx: CanvasRenderingContext2D,
    size: number,
    img: HTMLImageElement,
    state: EnvState
): void {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    _drawOverlayPattern(ctx, size, state);
}

function _ensureTextureGroundImage(url: string, onReady: (img: HTMLImageElement) => void): void {
    if (_texGroundImg && _texGroundImgUrl === url && _texGroundImg.complete) {
        onReady(_texGroundImg);
        return;
    }
    if (_texGroundImgUrl !== url) {
        _texGroundImg = null;
        _texGroundImgUrl = url;
    }
    const generation = ++_texGroundGeneration;
    const img = new Image();
    img.onload = () => {
        if (generation !== _texGroundGeneration) {
            return;
        }
        _texGroundImg = img;
        onReady(img);
    };
    img.onerror = () => {
        if (generation !== _texGroundGeneration) {
            return;
        }
        logWarn('ground', 'texture load failed:', url);
    };
    img.src = url;
}

function _syncTextureGroundTexture(mat: GroundMat, state: EnvState, scene: Scene): void {
    const url = state.groundTexture
        ? new URL(state.groundTexture, window.location.origin).href
        : null;
    if (!url) {
        return;
    }

    let dt = _getAlbedoTex(mat) as DynamicTexture | null;
    const needCreate = !dt || !(dt instanceof DynamicTexture) || dt.name !== 'envGroundTex';
    // [fix] 纹理密度与 mesh 尺寸成正比：mesh 变大时自动增加平铺次数，避免拉伸模糊
    const baseScale = _groundActualSize / 10 / Math.max(0.1, state.groundTextureScale);
    if (needCreate) {
        if (dt) {
            dt.dispose();
        }
        dt = new DynamicTexture('envGroundTex', _TEX_GROUND_SIZE, scene, false);
        dt.wrapU = dt.wrapV = Texture.WRAP_ADDRESSMODE;
        dt.uScale = dt.vScale = baseScale;
        _setAlbedoTex(mat, dt);
        _setAlbedoColor(mat, new Color3(1, 1, 1));
    } else {
        dt.uScale = dt.vScale = baseScale;
    }
    _syncAllTextureOffsets(mat, state);

    _ensureTextureGroundImage(url, (img) => {
        const cur = _getAlbedoTex(mat) as DynamicTexture | null;
        if (!(cur instanceof DynamicTexture) || cur !== dt) {
            return;
        }
        const ctx = getCanvasCtx(cur);
        if (!ctx) {
            return;
        }
        _drawTextureGroundCanvas(ctx, _TEX_GROUND_SIZE, img, state);
        cur.update(false);
    });
}

// ======== Edge fade / normal / offset helpers ========

function getGroundEdgeFadeTexture(fade: number, scene: Scene): Texture | null {
    if (fade <= 0) {
        return null;
    }
    const key = Math.round(fade * 100);
    const S = 256;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        const r0 = Math.max(0, 1 - fade);
        const grad = ctx.createRadialGradient(s / 2, s / 2, r0 * (s / 2), s / 2, s / 2, s / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
    };
    return getOrCreateCanvasTexture(`env-ground-edge-fade-${key}`, {
        size: S,
        draw,
        scene,
        name: 'envGroundEdgeFade',
        wrap: 'clamp',
        getAlphaFromRGB: true,
    });
}

function applyGroundEdgeFade(mat: GroundMat, fade: number, scene: Scene): void {
    mat.opacityTexture = getGroundEdgeFadeTexture(fade, scene);
}

function _getScrollUV(state: EnvState): { u: number; v: number } {
    const angle = (state.groundTextureRotation * Math.PI) / 180;
    let u: number;
    let v: number;
    if (angle === 0) {
        u = _groundScrollU;
        v = _groundScrollV;
    } else {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        u = 0.5 * (1 - cos) + 0.5 * sin + _groundScrollU;
        v = 0.5 * (1 - cos) - 0.5 * sin + _groundScrollV;
    }
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    if (u < 0) { u += 1; }
    if (v < 0) { v += 1; }
    return { u, v };
}

function _syncGroundTextureOffset(mat: GroundMat, state: EnvState): void {
    const tex = _getAlbedoTex(mat);
    if (!tex) {
        return;
    }
    const { u, v } = _getScrollUV(state);
    tex.uOffset = u;
    tex.vOffset = v;
}

function _syncAllTextureOffsets(mat: GroundMat, state: EnvState): void {
    const { u, v } = _getScrollUV(state);
    const apply = (tex: BaseTexture | null) => {
        if (tex instanceof Texture) {
            tex.uOffset = u;
            tex.vOffset = v;
        }
    };
    apply(_getAlbedoTex(mat));
    if (mat instanceof PBRMaterial) {
        apply(mat.bumpTexture);
        apply(mat.metallicTexture);
    }
}

function _updateGroundTexture(mat: GroundMat, state: EnvState): void {
    const scene = getScene();
    const newTex = _generateGroundTexture(state, scene);
    const oldTex = _getAlbedoTex(mat);
    newTex.uScale = oldTex instanceof Texture ? oldTex.uScale : 1;
    newTex.vScale = oldTex instanceof Texture ? oldTex.vScale : 1;
    _setAlbedoTex(mat, newTex);
    _setAlbedoColor(mat, new Color3(1, 1, 1));
    if (oldTex) {
        oldTex.dispose();
    }
}

function _syncGroundNormalTexture(mat: GroundMat, state: EnvState): void {
    const scene = getScene();
    if (state.groundNormalTexture) {
        if (!mat.bumpTexture || (mat.bumpTexture as Texture).name !== state.groundNormalTexture) {
            if (mat.bumpTexture && !isCacheOwnedTexture(mat.bumpTexture)) {
                mat.bumpTexture.dispose();
            }
            mat.bumpTexture = new Texture(state.groundNormalTexture, scene);
        }
        // ADR-114 Phase 2: PBR 模式下法线扭曲增强 bumpTexture.level
        mat.bumpTexture.level = state.groundPbrEnabled
            ? _effectiveBumpLevel(state)
            : state.groundNormalStrength;
    } else {
        if (mat.bumpTexture) {
            mat.bumpTexture.dispose();
            mat.bumpTexture = null;
        }
    }
}

/** PBR 增量更新：roughness / metallic / 程序化纹理无需重建材质的属性 */
function _syncPbrProperties(mat: PBRMaterial, state: EnvState): void {
    // ADR-114 Phase 2: roughness 含反射模糊偏移
    mat.roughness = _effectiveRoughness(state);
    mat.metallic = state.groundMetallic;
    // ADR-114 Phase 2: 法线扭曲增强 bumpTexture.level
    if (mat.bumpTexture) {
        mat.bumpTexture.level = _effectiveBumpLevel(state);
    }
}

// ======== applyGround (public) ========

export function applyGround(state: EnvState): void {
    const scene = getScene();
    ensureEnvUpdateObserver();
    // ADR-134: 加入 groundInfinite 标记
    const infKey = `:inf:${state.groundInfinite}`;

    // ADR-114: typeKey 加入 PBR / 程序化字段
    // rough/metal/blur/distort 由 _syncPbrProperties 增量更新，不触发重建
    const pbrKey = `:pbr:${state.groundPbrEnabled}`;
    const proceduralKey =
        state.groundProceduralTexture !== 'none' && !state.groundTextureEnabled
            ? `:proc:${state.groundProceduralTexture}:${state.groundProceduralSeed}:${state.groundProceduralScale}:deco:${state.groundOverlay}`
            : '';
    const typeKey =
        state.groundType === 'terrain'
            ? `heightmap:${state.groundTerrainHeight}:${state.groundTerrainScale}:${state.groundTerrainSeed}:${state.groundTerrainOctaves}:${state.groundLevel}:${state.groundSize}:${state.groundColor.join(',')}:${state.groundAlpha}:${state.groundTextureEnabled}:${state.groundTexture}:${state.groundTextureScale}:${state.groundTextureRotation}${pbrKey}${infKey}`
            : state.groundTextureEnabled && state.groundTexture
              ? `texture:${state.groundTexture}:${state.groundSize}:${state.reflectionQuality}${pbrKey}${infKey}`
              : `canvas:${state.groundStyle}:${state.groundGridSize}:${state.groundColor.join(',')}:${state.groundLineColor.join(',')}:${state.groundSize}:${state.reflectionQuality}${pbrKey}${proceduralKey}${infKey}`;
    const keyChanged = typeKey !== _currentGroundKey;

    // 原地更新路径
    if (_envSys.ground.mesh && state.groundVisible && !keyChanged) {
        const mat = _envSys.ground.mesh.material as GroundMat | null;
        if (mat && (mat instanceof StandardMaterial || mat instanceof PBRMaterial)) {
            if (state.groundStyle !== 'texture') {
                _updateGroundTexture(mat, state);
            }
            mat.alpha = state.groundAlpha;
            // ADR-114: 透明模式同步（PBRMaterial 需显式，StandardMaterial 自动处理）
            if (mat instanceof PBRMaterial) {
                const needAlpha = _needAlphaBlend(state);
                mat.transparencyMode = needAlpha
                    ? Material.MATERIAL_ALPHABLEND
                    : Material.MATERIAL_OPAQUE;
            }
            const albedoTex = _getAlbedoTex(mat);
            if (albedoTex && albedoTex instanceof Texture) {
                // [fix] 纹理密度与 mesh 尺寸成正比，避免拉伸模糊
                albedoTex.uScale = albedoTex.vScale =
                    _groundActualSize / 10 / Math.max(0.1, state.groundTextureScale);
                _syncAllTextureOffsets(mat, state);
            }
            _syncGroundNormalTexture(mat, state);
            // [doc:adr-160] 地面涟漪法线纹理叠加
            if (hasActiveGroundRipples()) {
                _syncGroundRippleTexture(mat, scene);
            } else if (_groundRippleApplied) {
                _disableGroundRippleTexture(mat);
            }
            if (state.groundStyle === 'texture') {
                _syncTextureGroundTexture(mat, state, scene);
            }
            if (mat instanceof PBRMaterial) {
                _syncPbrProperties(mat, state);
            }
            applyGroundEdgeFade(mat, state.groundEdgeFade, scene);
        }
        _envSys.ground.mesh.position.y = state.groundLevel;
        _envSys.ground.mesh.rotation.x = (state.groundPitch * Math.PI) / 180;
        _envSys.ground.mesh.rotation.z = (state.groundRoll * Math.PI) / 180;
        if (
            state.groundLevel !== _prevGroundHeight ||
            state.groundPitch !== _prevGroundPitch ||
            state.groundRoll !== _prevGroundRoll
        ) {
            _prevGroundHeight = state.groundLevel;
            _prevGroundPitch = state.groundPitch;
            _prevGroundRoll = state.groundRoll;
            _onGroundChanged?.();
        }
        buildGroundReflection(state);
        return;
    }

    // 重建路径
    _currentGroundKey = typeKey;
    _groundScrollU = 0;
    _groundScrollV = 0;
    disposeGroundReflection();
    if (_envSys.ground.mesh) {
        const oldMesh = _envSys.ground.mesh;
        disposeGroundMaterial(oldMesh.material);
        oldMesh.dispose();
        _envSys.ground.mesh = null;
    }
    if (!state.groundVisible) {
        return;
    }

    // 地形模式
    if (state.groundType === 'terrain') {
        const hg = createHeightmapGround(state, scene, (gm) => {
            applyTerrainMaterial(gm, state, scene);
            applyGroundEdgeFade(gm.material as GroundMat, state.groundEdgeFade, scene);
            _onTerrainReady?.();
        });
        _envSys.ground.mesh = hg;
        // [adr-114] 时序修复：mesh 赋值后再 buildGroundReflection，确保 mount 能拿到 material
        buildGroundReflection(state);
        return;
    }

    // 平面模式
    // ADR-134: infinite 模式下使用固定大 mesh，groundSize 退化为视觉密度参数
    const meshSize = state.groundInfinite ? INFINITE_GROUND_SIZE : state.groundSize;
    const ground = MeshBuilder.CreateGround(
        'envGround',
        { width: meshSize, height: meshSize, subdivisions: 2 },
        scene
    );
    _groundActualSize = meshSize;
    ground.isPickable = false;
    ground.position.y = state.groundLevel;

    const mat = createGroundMaterial(state, scene);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;

    if (state.groundProceduralTexture !== 'none' && !state.groundTextureEnabled) {
        // ADR-114: 程序化纹理模式（PBR 专属）
        const texs = generateProceduralGroundTextures(
            state.groundProceduralTexture,
            state.groundProceduralSeed,
            scene,
            state
        );
        // [fix] 纹理密度与 mesh 尺寸成正比，避免拉伸模糊
        const scale = _groundActualSize / 10 / Math.max(0.1, state.groundProceduralScale);
        texs.albedo.uScale = texs.albedo.vScale = scale;
        texs.roughness.uScale = texs.roughness.vScale = scale;
        texs.normal.uScale = texs.normal.vScale = scale;
        _setAlbedoTex(mat, texs.albedo);
        _setAlbedoColor(mat, new Color3(1, 1, 1));
        if (mat instanceof PBRMaterial) {
            mat.bumpTexture = texs.normal;
            // ADR-114 Phase 2: 法线扭曲增强 bumpTexture.level
            mat.bumpTexture.level = _effectiveBumpLevel(state);
            // ADR-114: 接通粗糙度贴图（此前生成后未赋给材质，逐像素粗糙度被丢弃）。
            // Babylon 9.x 默认从 metallicTexture 的 Alpha 通道读粗糙度，而程序化贴图为
            // RGB 灰度（alpha 恒为 1），须改读 Green 通道；Blue（金属度）/Red（AO）通道
            // 保持关闭——金属度走标量 groundMetallic。标量 roughness 与贴图相乘（Babylon
            // 约定 “scale the roughness values of the metallic texture”），groundRoughness 滑杆依旧生效。
            mat.metallicTexture = texs.roughness;
            mat.useRoughnessFromMetallicTextureAlpha = false;
            mat.useRoughnessFromMetallicTextureGreen = true;
        }
    } else if (state.groundStyle !== 'texture') {
        // canvas 程序化图案（grid/checker/dots 等）
        const tex = _generateGroundTexture(state, scene);
        _setAlbedoTex(mat, tex);
        _setAlbedoColor(mat, new Color3(1, 1, 1));
        // [fix] 纹理密度与 mesh 尺寸成正比，避免拉伸模糊
        tex.uScale = tex.vScale = _groundActualSize / 10;
    } else if (state.groundTextureEnabled && state.groundTexture) {
        // 外部贴图模式
        _setAlbedoColor(mat, new Color3(1, 1, 1));
        _syncTextureGroundTexture(mat, state, scene);
        _syncGroundNormalTexture(mat, state);
    } else {
        // 纯色模式
        _setAlbedoColor(
            mat,
            new Color3(state.groundColor[0], state.groundColor[1], state.groundColor[2])
        );
    }

    applyGroundEdgeFade(mat, state.groundEdgeFade, scene);
    ground.rotation.x = (state.groundPitch * Math.PI) / 180;
    ground.rotation.z = (state.groundRoll * Math.PI) / 180;

    // [adr-114] 时序修复：必须先赋值 mesh，再 buildGroundReflection。
    // groundReflection.mount 依赖 _envSys.ground.mesh.material，若 mesh 为 null 则 mount 静默跳过，
    // reflectionTexture 永远挂不上去（旧 bug：曾把 buildGroundReflection 放在赋值前）。
    _envSys.ground.mesh = ground;
    buildGroundReflection(state);
}

// ======== Per-frame ground updates (called by observer) ========

export function tickGround(dt: number): void {
    // Ground texture scroll
    if (
        _envSys.ground.mesh &&
        (envState.groundScrollSpeedX !== 0 || envState.groundScrollSpeedZ !== 0) &&
        (envState.groundStyle === 'checker' ||
            (envState.groundStyle === 'texture' &&
                envState.groundTextureEnabled &&
                envState.groundTexture))
    ) {
        const mat = _envSys.ground.mesh.material;
        if (mat && (mat instanceof StandardMaterial || mat instanceof PBRMaterial)) {
            const tex = _getAlbedoTex(mat as GroundMat);
            if (tex) {
                _groundScrollU += envState.groundScrollSpeedX * dt;
                _groundScrollV += envState.groundScrollSpeedZ * dt;
                _groundScrollU = _groundScrollU - Math.floor(_groundScrollU);
                _groundScrollV = _groundScrollV - Math.floor(_groundScrollV);
                if (_groundScrollU < 0) {
                    _groundScrollU += 1;
                }
                if (_groundScrollV < 0) {
                    _groundScrollV += 1;
                }
                _syncAllTextureOffsets(mat as GroundMat, envState);
            }
        }
    }

    // Ground reflection
    groundReflection.update(envState, getScene());
}

// ======== Ground Presets (follows WATER_PRESETS pattern) ========

export interface GroundPreset {
    label: string;
    // Style
    groundStyle: 'solid' | 'grid' | 'checker' | 'texture';
    groundOverlay: 'none' | 'grid' | 'checker';
    groundColor: [number, number, number];
    groundAlpha: number;
    groundPattern: 'checker' | 'dots' | 'stripes' | 'radial';
    // Texture
    groundTexture: string;
    groundTextureEnabled: boolean;
    groundTextureScale: number;
    groundTextureRotation: number;
    // Decoration
    groundGridSize: number;
    groundLineColor: [number, number, number];
    // PBR
    groundPbrEnabled: boolean;
    groundMetallic: number;
    groundRoughness: number;
    // Procedural
    groundProceduralTexture: GroundProceduralKind;
    groundProceduralSeed: number;
    groundProceduralScale: number;
    // Reflection
    reflectionQuality: 'off' | 'low' | 'medium' | 'high';
    groundReflectionBlend: number;
    groundNormalStrength: number;
    groundReflectionBlur: number;
    groundReflectionDistort: number;
    groundContactShadowEnabled: boolean;
    groundContactShadowIntensity: number;
    groundContactShadowDistance: number;
    // Terrain
    groundElevationColoring: boolean;
    // Enhancement
    groundEdgeFade: number;
    groundPitch: number;
    groundRoll: number;
}

export const GROUND_PRESETS: Record<string, GroundPreset> = {
    cleanGray: {
        label: '素净灰',
        groundStyle: 'solid',
        groundOverlay: 'none',
        groundColor: [0.2, 0.2, 0.22],
        groundAlpha: 0.85,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.5, 0.5, 0.55],
        groundPbrEnabled: false,
        groundMetallic: 0,
        groundRoughness: 0.6,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'low',
        groundReflectionBlend: 0.3,
        groundNormalStrength: 1,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.3,
        groundContactShadowEnabled: false,
        groundContactShadowIntensity: 0.5,
        groundContactShadowDistance: 0.5,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    mirrorStage: {
        label: '镜面舞台',
        groundStyle: 'solid',
        groundOverlay: 'none',
        groundColor: [0.05, 0.05, 0.08],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.3, 0.3, 0.35],
        groundPbrEnabled: true,
        groundMetallic: 1,
        groundRoughness: 0.1,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'high',
        groundReflectionBlend: 0.8,
        groundNormalStrength: 1.2,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.2,
        groundContactShadowEnabled: false,
        groundContactShadowIntensity: 0.5,
        groundContactShadowDistance: 0.5,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    grass: {
        label: '草地',
        groundStyle: 'texture',
        groundOverlay: 'none',
        groundColor: [0.3, 0.5, 0.25],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: 'textures/grass.png',
        groundTextureEnabled: true,
        groundTextureScale: 0.8,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.4, 0.5, 0.35],
        groundPbrEnabled: false,
        groundMetallic: 0,
        groundRoughness: 0.6,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'low',
        groundReflectionBlend: 0.2,
        groundNormalStrength: 0.8,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0.3,
        groundContactShadowEnabled: false,
        groundContactShadowIntensity: 0.5,
        groundContactShadowDistance: 0.5,
        groundElevationColoring: false,
        groundEdgeFade: 0.3,
        groundPitch: 0,
        groundRoll: 0,
    },
    stoneTile: {
        label: '石板',
        groundStyle: 'texture',
        groundOverlay: 'none',
        groundColor: [0.35, 0.33, 0.3],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: 'textures/stone.png',
        groundTextureEnabled: true,
        groundTextureScale: 1.5,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.5, 0.5, 0.5],
        groundPbrEnabled: true,
        groundMetallic: 0.1,
        groundRoughness: 0.8,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'medium',
        groundReflectionBlend: 0.4,
        groundNormalStrength: 0.6,
        groundReflectionBlur: 0.1,
        groundReflectionDistort: 0.3,
        groundContactShadowEnabled: true,
        groundContactShadowIntensity: 0.4,
        groundContactShadowDistance: 0.6,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    woodStage: {
        label: '木纹舞台',
        groundStyle: 'texture',
        groundOverlay: 'none',
        groundColor: [0.55, 0.4, 0.25],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: 'textures/stone.png',
        groundTextureEnabled: true,
        groundTextureScale: 2,
        groundTextureRotation: 0,
        groundGridSize: 1,
        groundLineColor: [0.4, 0.3, 0.2],
        groundPbrEnabled: true,
        groundMetallic: 0,
        groundRoughness: 0.8,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'medium',
        groundReflectionBlend: 0.35,
        groundNormalStrength: 0.7,
        groundReflectionBlur: 0.1,
        groundReflectionDistort: 0.25,
        groundContactShadowEnabled: true,
        groundContactShadowIntensity: 0.5,
        groundContactShadowDistance: 0.5,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
    cyberGrid: {
        label: '赛博网格',
        groundStyle: 'grid',
        groundOverlay: 'grid',
        groundColor: [0.02, 0.02, 0.06],
        groundAlpha: 1,
        groundPattern: 'checker',
        groundTexture: '',
        groundTextureEnabled: false,
        groundTextureScale: 1,
        groundTextureRotation: 0,
        groundGridSize: 0.5,
        groundLineColor: [0.2, 0.8, 1],
        groundPbrEnabled: true,
        groundMetallic: 1,
        groundRoughness: 0.2,
        groundProceduralTexture: 'none',
        groundProceduralSeed: 42,
        groundProceduralScale: 1,
        reflectionQuality: 'off',
        groundReflectionBlend: 0,
        groundNormalStrength: 1,
        groundReflectionBlur: 0,
        groundReflectionDistort: 0,
        groundContactShadowEnabled: false,
        groundContactShadowIntensity: 0.5,
        groundContactShadowDistance: 0.5,
        groundElevationColoring: false,
        groundEdgeFade: 0,
        groundPitch: 0,
        groundRoll: 0,
    },
};

/** 预设 → EnvState 字段映射，供 UI chip handler 调用并持久化。 */
export function buildGroundPresetEnvState(preset: GroundPreset): Partial<EnvState> {
    return {
        groundStyle: preset.groundStyle,
        groundOverlay: preset.groundOverlay,
        groundColor: preset.groundColor,
        groundAlpha: preset.groundAlpha,
        groundPattern: preset.groundPattern,
        groundTexture: preset.groundTexture,
        groundTextureEnabled: preset.groundTextureEnabled,
        groundTextureScale: preset.groundTextureScale,
        groundTextureRotation: preset.groundTextureRotation,
        groundGridSize: preset.groundGridSize,
        groundLineColor: preset.groundLineColor,
        groundPbrEnabled: preset.groundPbrEnabled,
        groundMetallic: preset.groundMetallic,
        groundRoughness: preset.groundRoughness,
        groundProceduralTexture: preset.groundProceduralTexture,
        groundProceduralSeed: preset.groundProceduralSeed,
        groundProceduralScale: preset.groundProceduralScale,
        reflectionQuality: preset.reflectionQuality,
        groundReflectionBlend: preset.groundReflectionBlend,
        groundNormalStrength: preset.groundNormalStrength,
        groundReflectionBlur: preset.groundReflectionBlur,
        groundReflectionDistort: preset.groundReflectionDistort,
        groundContactShadowEnabled: preset.groundContactShadowEnabled,
        groundContactShadowIntensity: preset.groundContactShadowIntensity,
        groundContactShadowDistance: preset.groundContactShadowDistance,
        groundElevationColoring: preset.groundElevationColoring,
        groundEdgeFade: preset.groundEdgeFade,
        groundPitch: preset.groundPitch,
        groundRoll: preset.groundRoll,
    };
}

export function disposeGround(): void {
    disposeGroundReflection();
    if (_envSys.ground.mesh) {
        disposeGroundMaterial(_envSys.ground.mesh.material);
        _envSys.ground.mesh.dispose();
        _envSys.ground.mesh = null;
    }
    _currentGroundKey = '';
    _groundScrollU = 0;
    _groundScrollV = 0;
    // 补全状态重置：回调引用 / 纹理缓存 / diff 哨兵值，避免场景重建后脏值泄漏
    _onTerrainReady = null;
    _onGroundChanged = null;
    _groundActualSize = 60;
    _prevGroundHeight = NaN;
    _prevGroundPitch = NaN;
    _prevGroundRoll = NaN;
    clearGroundTexCache();
    // 地面涟漪：mesh 已销毁，复位应用标志与暂存的原始 bumpTexture 引用，并释放涟漪纹理
    _groundRipples = null;
    _groundRippleApplied = false;
    disposeGroundRipples();
}
