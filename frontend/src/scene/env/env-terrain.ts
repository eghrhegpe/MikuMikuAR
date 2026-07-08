import { Scene, MeshBuilder, GroundMesh, StandardMaterial, Texture, Color3 } from '@babylonjs/core';
import { EnvState } from '@/core/config';

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

const TERRAIN_HM_SIZE = 256;

/** 程序化生成灰度高度图（data URL），亮=高峰、暗=低谷。 */
export function generateTerrainHeightmapURL(opts: {
    height: number;
    scale: number;
    seed: number;
    octaves: number;
}): string {
    const S = TERRAIN_HM_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    const data = img.data;
    const octaves = Math.max(1, Math.min(8, Math.round(opts.octaves)));
    const seed = Math.max(0, Math.floor(opts.seed));
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const n = fbm(x, y, seed, octaves, opts.scale); // ~[-1,1]
            const v = Math.max(0, Math.min(255, Math.round((n * 0.5 + 0.5) * 255)));
            const i = (y * S + x) * 4;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

const TERRAIN_GROUND_SIZE = 60;
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
    const ground = MeshBuilder.CreateGroundFromHeightMap(
        'envGround',
        url,
        {
            width: TERRAIN_GROUND_SIZE,
            height: TERRAIN_GROUND_SIZE,
            subdivisions: TERRAIN_SUBDIVISIONS,
            minHeight: -half,
            maxHeight: half,
            updatable: false,
            onReady: (mesh) => {
                const gm = mesh as GroundMesh;
                gm.isPickable = true; // 碰撞/拾取：模型可站上去
                gm.position.y = state.groundLevel;
                onReady(gm);
            },
        },
        scene
    ) as GroundMesh;
    // onReady 前几何体为空，先标记不可拾取，避免被物理/拾取提前误用
    ground.isPickable = false;
    return ground;
}

/** 地形材质（与其他地面模式一致：纯色或半透明/纹理）。供 env-impl 在 onReady 与就地更新时复用。 */
export function applyTerrainMaterial(ground: GroundMesh, state: EnvState, scene: Scene): void {
    const resolve = (p: string): string => {
        if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
            return p;
        }
        return new URL(p, window.location.origin).href;
    };
    if (state.groundTextureEnabled && state.groundTexture) {
        const tex = new Texture(resolve(state.groundTexture), scene);
        tex.uScale = tex.vScale = 1 / Math.max(0.1, state.groundTextureScale);
        if (state.groundTextureRotation !== 0) {
            const angle = (state.groundTextureRotation * Math.PI) / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            tex.uOffset = 0.5 * (1 - cos) + 0.5 * sin;
            tex.vOffset = 0.5 * (1 - cos) - 0.5 * sin;
        }
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseTexture = tex;
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    } else {
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2]
        );
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    }
}
