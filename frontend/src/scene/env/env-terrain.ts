import {
    Scene,
    MeshBuilder,
    GroundMesh,
    StandardMaterial,
    PBRMaterial,
    Texture,
    BaseTexture,
    Color3,
    VertexBuffer,
} from '@babylonjs/core';
import { EnvState } from '@/core/config';
import { createCanvasDataURL, isCacheOwnedTexture } from './_shared/env-texture';
import { clamp01 } from '@/core/clamp';
import { _effectiveBumpLevel } from './env-ground';
import { underwaterFogController } from './env-underwater-fog';

// ======== 确定性值噪声（FBM）========
// 哈希与值噪声原语统一由 @/core/math/hash-noise 提供（与 water/caustics 共用，消除重复）；
// re-export 保留 hash2/valueNoise 的对外符号，避免破坏既有 import。
import { hash2, valueNoise } from '@/core/math/hash-noise';
export { hash2, valueNoise };

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

// [adr-231] 地形重建代际计数器（对齐 env-ground 的 _texGroundGeneration 模式）：
// 快速连切地面类型时，旧 heightmap 的 onReady 仍会异步触发，而 mesh/material 已被销毁；
// 回调首行比对代际，过期直接放弃，避免对僵尸材质做 install / _syncGroundEmissive。
let _terrainGen = 0;

/** 测试/场景重置用：清零地形代际计数器。 */
export function clearTerrainGeneration(): void {
    _terrainGen = 0;
}

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
    const gen = ++_terrainGen;
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
                if (gen !== _terrainGen) {
                    return; // 已被更新的地形重建取代，旧回调放弃
                }
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
 * Phase B: 支持 groundElevationColoringEnabled（按高程 per-vertex 着色）。
 * 供 env-impl 在 onReady 与就地更新时复用。
 */
export function applyTerrainMaterial(ground: GroundMesh, state: EnvState, scene: Scene): void {
    // 释放旧材质及其纹理，防止 GPU 显存泄漏
    const oldMat = ground.material;
    if (oldMat) {
        // 缓存所有的贴图（如边缘淡出 opacityTexture）跳过——由 disposeTextureCache 统一释放，
        // 避免提前 dispose 后 getOrCreateCanvasTexture 复用已失效贴图。
        const disposeTex = (tex: BaseTexture | null) => {
            if (tex && !isCacheOwnedTexture(tex)) {
                tex.dispose();
            }
        };
        if (oldMat instanceof PBRMaterial) {
            disposeTex(oldMat.albedoTexture);
            disposeTex(oldMat.metallicTexture);
        }
        if (oldMat instanceof StandardMaterial) {
            disposeTex(oldMat.diffuseTexture);
        }
        if (oldMat instanceof PBRMaterial || oldMat instanceof StandardMaterial) {
            disposeTex(oldMat.bumpTexture);
            disposeTex(oldMat.opacityTexture);
            disposeTex(oldMat.reflectionTexture);
        }
        // Step 2: 脱离缓存贴图，防止 oldMat.dispose() 连带释放（对齐 env-ground.disposeGroundMaterial）
        if (oldMat instanceof PBRMaterial) {
            if (isCacheOwnedTexture(oldMat.albedoTexture)) {
                oldMat.albedoTexture = null;
            }
            if (isCacheOwnedTexture(oldMat.metallicTexture)) {
                oldMat.metallicTexture = null;
            }
        }
        if (oldMat instanceof StandardMaterial) {
            if (isCacheOwnedTexture(oldMat.diffuseTexture)) {
                oldMat.diffuseTexture = null;
            }
        }
        if (oldMat instanceof PBRMaterial || oldMat instanceof StandardMaterial) {
            if (isCacheOwnedTexture(oldMat.bumpTexture)) {
                oldMat.bumpTexture = null;
            }
            if (isCacheOwnedTexture(oldMat.opacityTexture)) {
                oldMat.opacityTexture = null;
            }
            if (isCacheOwnedTexture(oldMat.reflectionTexture)) {
                oldMat.reflectionTexture = null;
            }
            // [adr-231] emissiveTexture 与 albedo/diffuse（自发光复用）或共享焦散纹理同引用，
            // 非独立持有：无条件脱离，避免 dispose 连带释放缓存/共享纹理。
            oldMat.emissiveTexture = null;
        }
        // [fix P1] 移除水下焦散安装条目，避免对已销毁地形材质残留引用
        if (oldMat instanceof PBRMaterial || oldMat instanceof StandardMaterial) {
            underwaterFogController.uninstall(oldMat);
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
    if (state.groundElevationColoringEnabled) {
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
        mat.bumpTexture.level =
            mat instanceof PBRMaterial ? _effectiveBumpLevel(state) : state.groundNormalStrength;
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
