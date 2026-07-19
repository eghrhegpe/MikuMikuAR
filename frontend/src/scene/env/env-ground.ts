// env-ground.ts — 地面子系统（程序化/纹理/地形/反射/淡出/滚动）
// 从 env-impl.ts 拆分而来。

import {
    Scene,
    Color3,
    Texture,
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
import { fbm } from './env-terrain';
import { createHeightmapGround, applyTerrainMaterial } from './env-terrain';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { createCanvasTexture, getOrCreateCanvasTexture } from './env-texture';
import { _envSys, getScene } from './env-context';
import { ensureEnvUpdateObserver } from './env-impl';
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
function _effectiveRoughness(state: EnvState): number {
    // 低质量模式自动关闭反射模糊（退化为锐利反射）
    if (state.groundReflectionQuality === 'low' || state.groundReflectionQuality === 'off') {
        return state.groundRoughness;
    }
    return Math.max(0, Math.min(1, state.groundRoughness + state.groundReflectionBlur * 0.4));
}

/** ADR-114 Phase 2: 法线扭曲映射到 bumpTexture.level 增强（distort=1 时额外 +2.0）；低质量模式自动关闭 */
function _effectiveBumpLevel(state: EnvState): number {
    // 低质量模式自动关闭法线扭曲
    if (state.groundReflectionQuality === 'low' || state.groundReflectionQuality === 'off') {
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

// ======== ADR-114: 程序化纹理生成（木纹）========

const PROCEDURAL_SIZE = 512;

function generateWoodAlbedo(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const nLow = fbm(x * 0.02, y * 0.005, seed, 4, 1.0); // ~[-1, 1]
            const nHigh = fbm(x * 0.2, y * 0.2, seed + 100, 2, 1.0);
            const n = (nLow + nHigh * 0.2 + 1) * 0.5; // 归一化 ~[0, 1]

            const r = Math.round(139 + n * 40 - 10);
            const g = Math.round(69 + n * 25 - 5);
            const b = Math.round(19 + n * 12 - 2);

            const i = (y * size + x) * 4;
            data[i] = Math.max(0, Math.min(255, r));
            data[i + 1] = Math.max(0, Math.min(255, g));
            data[i + 2] = Math.max(0, Math.min(255, b));
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

function generateWoodRoughness(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const n = (fbm(x * 0.015, y * 0.004, seed, 3, 1.0) + 1) * 0.5; // [0,1]
            const roughness = 0.4 + n * 0.2; // [0.2, 0.6]
            const v = Math.round(roughness * 255);

            const i = (y * size + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

function generateWoodNormal(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const eps = 1.0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const c = fbm(x * 0.02, y * 0.005, seed, 4, 1.0);
            const cx = fbm((x + eps) * 0.02, y * 0.005, seed, 4, 1.0);
            const cy = fbm(x * 0.02, (y + eps) * 0.005, seed, 4, 1.0);

            const dx = (cx - c) * 20.0;
            const dy = (cy - c) * 20.0;
            const nz = 1.0;
            const len = Math.sqrt(dx * dx + dy * dy + nz * nz);

            const i = (y * size + x) * 4;
            data[i] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
            data[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
            data[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

interface ProceduralTextures {
    albedo: Texture;
    roughness: Texture;
    normal: Texture;
}

function generateProceduralGroundTextures(
    type: string,
    seed: number,
    scene: Scene
): ProceduralTextures {
    // 目前仅支持 wood，marble/concrete 为后续扩展预留
    const genAlbedo = (ctx: CanvasRenderingContext2D, s: number) =>
        generateWoodAlbedo(ctx, s, seed);
    const genRoughness = (ctx: CanvasRenderingContext2D, s: number) =>
        generateWoodRoughness(ctx, s, seed);
    const genNormal = (ctx: CanvasRenderingContext2D, s: number) =>
        generateWoodNormal(ctx, s, seed);

    const albedo = getOrCreateCanvasTexture(`groundProcedural_${type}_${seed}_albedo`, {
        size: PROCEDURAL_SIZE,
        draw: genAlbedo,
        scene,
        name: `groundProcedural_${type}_albedo`,
        wrap: 'wrap',
        generateMipMaps: true,
    });
    const roughness = getOrCreateCanvasTexture(`groundProcedural_${type}_${seed}_roughness`, {
        size: PROCEDURAL_SIZE,
        draw: genRoughness,
        scene,
        name: `groundProcedural_${type}_roughness`,
        wrap: 'wrap',
        generateMipMaps: true,
    });
    const normal = getOrCreateCanvasTexture(`groundProcedural_${type}_${seed}_normal`, {
        size: PROCEDURAL_SIZE,
        draw: genNormal,
        scene,
        name: `groundProcedural_${type}_normal`,
        wrap: 'wrap',
        generateMipMaps: true,
    });
    return { albedo, roughness, normal };
}

/** 释放材质及其所有纹理（PBR 和 Standard 共用 opacity/bump/reflection，差异在 albedo/diffuse） */
function disposeGroundMaterial(mat: Material | null): void {
    if (!mat) {
        return;
    }
    if (mat instanceof PBRMaterial) {
        mat.albedoTexture?.dispose();
        mat.metallicTexture?.dispose();
    }
    if (mat instanceof StandardMaterial) {
        mat.diffuseTexture?.dispose();
    }
    if (mat instanceof PBRMaterial || mat instanceof StandardMaterial) {
        mat.bumpTexture?.dispose();
        mat.opacityTexture?.dispose();
        mat.reflectionTexture?.dispose();
    }
    mat.dispose();
}

// ======== ADR-134: Infinite ground constants ========
// 相机追踪 lerp 跟随方案已废弃（_groundInfinitePrevX/Z 从未被使用），
// 无限地面改为固定大 mesh + 纹理世界空间平铺，不再跟随相机移动。
const INFINITE_GROUND_SIZE = 2000; // 无限地面 mesh 固定尺寸（匹配碰撞体范围）
let _groundActualSize = 60; // 当前 mesh 实际尺寸（用于 UV 补偿计算）

// ======== Module state ========
let _currentGroundKey: string = '';
let _onTerrainReady: (() => void) | null = null;
let _onGroundChanged: (() => void) | null = null;
let _prevGroundHeight = NaN;
let _prevGroundPitch = NaN;
let _prevGroundRoll = NaN;
let _groundScrollU = 0;
let _groundScrollV = 0;

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
    resolutionMap: { high: 1024, medium: 512, low: 256, off: 0 },
    // ADR-114 Phase 2: 开启 mipmap 供 PBR roughness 驱动反射模糊
    generateMipMaps: true,
    getQuality: (s) => {
        // 独立字段为非 'off' 时作为显式覆盖；否则从 qualityProfile 派生
        if (s.groundReflectionQuality !== 'off') return s.groundReflectionQuality;
        const map: Record<string, string> = { high: 'high', medium: 'medium', low: 'low' };
        return map[s.qualityProfile] ?? 'off';
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
    predicate: (mesh, _level) => !mesh.name.startsWith('envGround') && mesh.isEnabled(),
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

        if (state.groundDecoStyle === 'grid') {
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
        } else if (state.groundDecoStyle === 'checker') {
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

// ======== Texture mode: external image compositing ========

function _drawTextureGroundCanvas(
    ctx: CanvasRenderingContext2D,
    size: number,
    img: HTMLImageElement,
    state: EnvState
): void {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    if (state.groundDecoStyle === 'none') {
        return;
    }

    const r = Math.round(state.groundLineColor[0] * 255);
    const g = Math.round(state.groundLineColor[1] * 255);
    const b = Math.round(state.groundLineColor[2] * 255);
    const lineColor = `rgb(${r},${g},${b})`;
    const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));

    if (state.groundDecoStyle === 'grid') {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, Math.round(tileSize / 24));
        for (let x = tileSize; x < size; x += tileSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, size);
            ctx.stroke();
        }
        for (let y = tileSize; y < size; y += tileSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(size, y);
            ctx.stroke();
        }
    } else if (state.groundDecoStyle === 'checker') {
        for (let y = 0; y < size; y += tileSize) {
            for (let x = 0; x < size; x += tileSize) {
                if ((x / tileSize + y / tileSize) % 2 === 0) {
                    ctx.fillStyle = lineColor;
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
        }
    }
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
    // [fix:ADR-134] 无限地面 UV 补偿：网格变大时按比例缩小纹理密度
    const uvCompensation = state.groundSize / Math.max(1, _groundActualSize);
    const baseScale = (1 / Math.max(0.1, state.groundTextureScale)) * uvCompensation;
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
    _syncGroundTextureOffset(mat, state);

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

function _syncGroundTextureOffset(mat: GroundMat, state: EnvState): void {
    const tex = _getAlbedoTex(mat);
    if (!tex) {
        return;
    }
    const angle = (state.groundTextureRotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let u = 0.5 * (1 - cos) + 0.5 * sin + _groundScrollU;
    let v = 0.5 * (1 - cos) - 0.5 * sin + _groundScrollV;
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    if (u < 0) {
        u += 1;
    }
    if (v < 0) {
        v += 1;
    }
    tex.uOffset = u;
    tex.vOffset = v;
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

    // ADR-114: typeKey 加入 PBR / 程序化字段；Phase 2: blur/distort 影响反射视觉需重建
    const pbrKey = `:pbr:${state.groundPbrEnabled}:rough:${state.groundRoughness}:metal:${state.groundMetallic}:blur:${state.groundReflectionBlur}:distort:${state.groundReflectionDistort}`;
    const proceduralKey =
        state.groundProceduralTexture !== 'none' && !state.groundTextureEnabled
            ? `:proc:${state.groundProceduralTexture}:${state.groundProceduralSeed}:${state.groundProceduralScale}`
            : '';
    const typeKey =
        state.groundType === 'terrain'
            ? `heightmap:${state.groundTerrainHeight}:${state.groundTerrainScale}:${state.groundTerrainSeed}:${state.groundTerrainOctaves}:${state.groundLevel}:${state.groundSize}:${state.groundColor.join(',')}:${state.groundAlpha}:${state.groundTextureEnabled}:${state.groundTexture}:${state.groundTextureScale}:${state.groundTextureRotation}${pbrKey}${infKey}`
            : state.groundTextureEnabled && state.groundTexture
              ? `texture:${state.groundTexture}:${state.groundSize}:${state.groundReflectionQuality}${pbrKey}${infKey}`
              : `canvas:${state.groundStyle}:${state.groundGridSize}:${state.groundColor.join(',')}:${state.groundLineColor.join(',')}:${state.groundSize}:${state.groundReflectionQuality}${pbrKey}${proceduralKey}${infKey}`;
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
                // [fix:ADR-134] 无限地面 UV 补偿：网格变大时按比例缩小纹理密度
                const uvCompensation = state.groundSize / Math.max(1, _groundActualSize);
                albedoTex.uScale = albedoTex.vScale = (1 / Math.max(0.1, state.groundTextureScale)) * uvCompensation;
                _syncGroundTextureOffset(mat, state);
            }
            _syncGroundNormalTexture(mat, state);
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

    if (
        state.groundPbrEnabled &&
        state.groundProceduralTexture !== 'none' &&
        !state.groundTextureEnabled
    ) {
        // ADR-114: 程序化纹理模式（PBR 专属）
        const texs = generateProceduralGroundTextures(
            state.groundProceduralTexture,
            state.groundProceduralSeed,
            scene
        );
        const scale = 1 / Math.max(0.1, state.groundProceduralScale);
        texs.albedo.uScale = texs.albedo.vScale = scale;
        texs.roughness.uScale = texs.roughness.vScale = scale;
        texs.normal.uScale = texs.normal.vScale = scale;
        _setAlbedoTex(mat, texs.albedo);
        _setAlbedoColor(mat, new Color3(1, 1, 1));
        if (mat instanceof PBRMaterial) {
            mat.bumpTexture = texs.normal;
            // ADR-114 Phase 2: 法线扭曲增强 bumpTexture.level
            mat.bumpTexture.level = _effectiveBumpLevel(state);
        }
    } else if (state.groundStyle !== 'texture') {
        // canvas 程序化图案（grid/checker/dots 等）
        const tex = _generateGroundTexture(state, scene);
        _setAlbedoTex(mat, tex);
        _setAlbedoColor(mat, new Color3(1, 1, 1));
        // [fix:ADR-134] 无限地面 UV 补偿：网格变大时按比例缩小纹理密度，保持视觉一致
        const uvScale = state.groundSize / Math.max(1, _groundActualSize);
        tex.uScale = tex.vScale = uvScale;
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
                _syncGroundTextureOffset(mat as GroundMat, envState);
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
    groundDecoStyle: 'none' | 'grid' | 'checker';
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
    groundProceduralTexture: 'none' | 'wood' | 'marble' | 'concrete';
    groundProceduralSeed: number;
    groundProceduralScale: number;
    // Reflection
    groundReflectionQuality: 'off' | 'low' | 'medium' | 'high';
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
        groundDecoStyle: 'none',
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
        groundReflectionQuality: 'low',
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
        groundDecoStyle: 'none',
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
        groundReflectionQuality: 'high',
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
        groundDecoStyle: 'none',
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
        groundReflectionQuality: 'low',
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
        groundDecoStyle: 'grid',
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
        groundReflectionQuality: 'medium',
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
        groundDecoStyle: 'none',
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
        groundReflectionQuality: 'medium',
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
        groundDecoStyle: 'grid',
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
        groundReflectionQuality: 'off',
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
        groundDecoStyle: preset.groundDecoStyle,
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
        groundReflectionQuality: preset.groundReflectionQuality,
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
}
