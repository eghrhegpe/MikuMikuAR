import {
    Scene,
    MeshBuilder,
    GroundMesh,
    StandardMaterial,
    PBRMaterial,
    Texture,
    Color3,
    VertexBuffer,
} from '@babylonjs/core';
import { EnvState } from '@/core/config';
import { createCanvasDataURL } from './env-texture';
import { clamp01 } from '@/core/utils';
import { _effectiveBumpLevel } from './env-ground';

// ======== 确定性值噪声（FBM）========
// 用整数哈希产生可复现的伪随机，seed 相同则地形一致。
export function hash2(ix: number, iz: number, seed: number): number {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
}

export function valueNoise(x: number, z: number, seed: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed);
    const b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed);
    const d = hash2(ix + 1, iz + 1, seed);
    const top = a + (b - a) * ux;
    const bot = c + (d - c) * ux;
    return top + (bot - top) * uz; // [0,1]
}

export function fbm(x: number, z: number, seed: number, octaves: number, baseFreq: number): number {
    let amp = 1;
    let freq = baseFreq;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * (valueNoise(x * freq, z * freq, seed + o * 1013) * 2 - 1);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return norm > 0 ? sum / norm : 0; // ~[-1,1]
}

// 高度图分辨率：CPU 端 canvas 逐像素 FBM 生成。256² 在加载开销与地形细节间平衡良好。
// 技术债：若需更高分辨率（≥512²）或运行时动态地形，应改 GPU 生成（计算/顶点着色器）；当前 256² 可接受。
const TERRAIN_HM_SIZE = 256;

/** 程序化生成灰度高度图（data URL），亮=高峰、暗=低谷。经统一工厂创建（受约束环境返回 ''）。 */
export function generateTerrainHeightmapURL(opts: {
    height: number;
    scale: number;
    seed: number;
    octaves: number;
}): string {
    const S = TERRAIN_HM_SIZE;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        const img = ctx.createImageData(s, s);
        const data = img.data;
        const octaves = Math.max(1, Math.min(8, Math.round(opts.octaves)));
        const seed = Math.max(0, Math.floor(opts.seed));
        for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
                const n = fbm(x, y, seed, octaves, opts.scale); // ~[-1,1]
                const v = Math.max(0, Math.min(255, Math.round((n * 0.5 + 0.5) * 255)));
                const i = (y * s + x) * 4;
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
                data[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
    };
    return createCanvasDataURL({ size: S, draw });
}

const TERRAIN_SUBDIVISIONS = 200;

/**
 * 用程序化 FBM 高度图创建可拾取地形网格（CreateGroundFromHeightMap）。
 * 几何体在 onReady 触发前为空；onReady 由 env-impl 提供，负责材质/重贴地。
 * 网格 isPickable=true → 自带碰撞，模型可调用 getHeightAtCoordinates 站在坡面上。
 */
export function createHeightmapGround(
    state: EnvState,
    scene: Scene,
    onReady: (mesh: GroundMesh) => void
): GroundMesh {
    const url = generateTerrainHeightmapURL({
        height: state.groundTerrainHeight,
        scale: state.groundTerrainScale,
        seed: state.groundTerrainSeed,
        octaves: state.groundTerrainOctaves,
    });
    const half = state.groundTerrainHeight / 2;
    const size = Math.max(1, state.groundSize);
    const ground = MeshBuilder.CreateGroundFromHeightMap(
        'envGround',
        url,
        {
            width: size,
            height: size,
            subdivisions: TERRAIN_SUBDIVISIONS,
            minHeight: -half,
            maxHeight: half,
            updatable: false,
            onReady: (mesh) => {
                const gm = mesh as GroundMesh;
                gm.isPickable = true; // 碰撞/拾取：模型可站上去
                gm.position.y = state.groundLevel;
                gm.rotation.x = (state.groundPitch * Math.PI) / 180;
                gm.rotation.z = (state.groundRoll * Math.PI) / 180;
                onReady(gm);
            },
        },
        scene
    ) as GroundMesh;
    // onReady 前几何体为空，先标记不可拾取，避免被物理/拾取提前误用
    ground.isPickable = false;
    return ground;
}

/**
 * 地形材质（与其他地面模式一致：纯色或半透明/纹理）。
 * Phase B: 支持 groundElevationColoring（按高程 per-vertex 着色）。
 * 供 env-impl 在 onReady 与就地更新时复用。
 */
export function applyTerrainMaterial(ground: GroundMesh, state: EnvState, scene: Scene): void {
    // 释放旧材质及其纹理，防止 GPU 显存泄漏
    const oldMat = ground.material;
    if (oldMat) {
        if (oldMat instanceof PBRMaterial) {
            oldMat.albedoTexture?.dispose();
            oldMat.metallicTexture?.dispose();
        }
        if (oldMat instanceof StandardMaterial) {
            oldMat.diffuseTexture?.dispose();
        }
        if (oldMat instanceof PBRMaterial || oldMat instanceof StandardMaterial) {
            oldMat.bumpTexture?.dispose();
            oldMat.opacityTexture?.dispose();
            oldMat.reflectionTexture?.dispose();
        }
        oldMat.dispose();
        ground.material = null;
    }

    const resolve = (p: string): string => {
        if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
            return p;
        }
        return new URL(p, window.location.origin).href;
    };

    // Phase B: 高程着色（覆盖纯色/纹理，优先级最高）
    if (state.groundElevationColoring) {
        applyElevationColoring(ground, state);
        return;
    }

    // ADR-114: PBR 材质升级
    const mat = state.groundPbrEnabled
        ? new PBRMaterial('envGroundPBR', scene)
        : new StandardMaterial('envGroundMat', scene);

    if (mat instanceof PBRMaterial) {
        mat.metallic = state.groundMetallic;
        mat.roughness = state.groundRoughness;
        // PBR 自动使用 scene.environmentTexture 作为 IBL，无需手动赋值
        mat.useSpecularOverAlpha = false;
        mat.useRadianceOverAlpha = false;
    }
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;

    if (state.groundTextureEnabled && state.groundTexture) {
        const tex = new Texture(resolve(state.groundTexture), scene);
        tex.uScale = tex.vScale = 1 / Math.max(0.1, state.groundTextureScale);
        if (mat instanceof PBRMaterial) {
            mat.albedoTexture = tex;
            mat.albedoColor = new Color3(1, 1, 1);
        } else {
            mat.diffuseTexture = tex;
            mat.diffuseColor = new Color3(1, 1, 1);
        }
    } else {
        const c = new Color3(state.groundColor[0], state.groundColor[1], state.groundColor[2]);
        if (mat instanceof PBRMaterial) {
            mat.albedoColor = c;
        } else {
            mat.diffuseColor = c;
        }
    }

    // Phase B: 法线贴图（PBR 使用 _effectiveBumpLevel 支持法线扭曲增强，Standard 直接用 groundNormalStrength）
    if (state.groundNormalTexture) {
        mat.bumpTexture = new Texture(resolve(state.groundNormalTexture), scene);
        mat.bumpTexture.level = mat instanceof PBRMaterial
            ? _effectiveBumpLevel(state)
            : state.groundNormalStrength;
    }
}

/**
 * Phase B: 高程着色 — 按顶点高度插值三段色（低谷→山腰→峰顶）。
 * 使用 VertexData.SetData 写入 colorKind=Color3 到 ground 的 vertex buffer。
 */
function applyElevationColoring(ground: GroundMesh, state: EnvState): void {
    const positions = ground.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) {
        return;
    }

    const half = state.groundTerrainHeight / 2;
    const minH = -half;
    const maxH = half;
    const range = maxH - minH;
    if (range < 0.01) {
        return;
    }

    // 三段色：低谷（深绿）→ 山腰（棕）→ 峰顶（白）
    const low = new Color3(0.2, 0.35, 0.15);
    const mid = new Color3(0.45, 0.35, 0.2);
    const high = new Color3(0.9, 0.9, 0.9);

    const vertexCount = positions.length / 3;
    const colors: number[] = new Array(vertexCount * 4);

    for (let i = 0; i < vertexCount; i++) {
        const y = positions[i * 3 + 1]; // 顶点高度
        const t = clamp01((y - minH) / range); // 归一化 [0,1]
        let r: number, g: number, b: number;
        if (t < 0.5) {
            const k = t * 2;
            r = low.r + (mid.r - low.r) * k;
            g = low.g + (mid.g - low.g) * k;
            b = low.b + (mid.b - low.b) * k;
        } else {
            const k = (t - 0.5) * 2;
            r = mid.r + (high.r - mid.r) * k;
            g = mid.g + (high.g - mid.g) * k;
            b = mid.b + (high.b - mid.b) * k;
        }
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 1; // alpha
    }

    ground.setVerticesData(VertexBuffer.ColorKind, colors, false);

    const scene = ground.getScene();
    // 释放旧材质（如有），避免高程着色反复切换时泄漏
    const prev = ground.material;
    if (prev) {
        if (prev instanceof StandardMaterial) {
            prev.diffuseTexture?.dispose();
            prev.bumpTexture?.dispose();
        }
        prev.dispose();
    }
    const mat = new StandardMaterial('envGroundElevationMat', scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;
}
