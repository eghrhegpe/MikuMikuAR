// env-caustics.ts — 共享焦散纹理 + UV 滚动（ADR-115 P5 跨场景复用）
//
// 设计目标：水面 + 水底地面共用同一张焦散纹理 + 同一组 UV 滚动状态。
// 之前焦散在 env-water.ts 私有，重建条件还耦合 waterColor 造成"颜色微变就重建"。
// 这里拆出来做单实例：场景内只生成一次，滚动由 controller 集中维护。
//
// UV 滚动策略：所有"消费者"（水面 Shader / 地面 emissiveTexture）读取
// `texture.uOffset` / `texture.vOffset`，由 controller 每帧 setFloat 推一次，
// 推一次相当于 texture.uOffset += dt * speed 再 wrap 回 [0,1)。
// 这让水面与地面焦散方向/速度严格一致，水底光斑与水波光纹同步。

import { Color3, Material, PBRMaterial, Scene, StandardMaterial, Texture } from '@babylonjs/core';
import { createCanvasTexture } from './_shared/env-texture';
import { hash2v } from '@/core/math/hash-noise';

const CAUSTIC_TEX_SIZE = 256;
const DEFAULT_SCROLL_SPEED = 0.05; // 焦散光斑每秒滚动 UV 速率

/**
 * Voronoi 焦散纹理生成器（保留 env-water 原版算法，仅换成 callback 工厂签名）。
 * 不规则网状亮纹，模拟折射光汇聚线。
 */
function _drawCausticCanvas(ctx: CanvasRenderingContext2D, s: number): void {
    const data = ctx.createImageData(s, s).data;
    const TILE = 8;
    for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
            const px = (x / s) * TILE;
            const py = (y / s) * TILE;
            const ix = Math.floor(px);
            const iy = Math.floor(py);
            let f1 = 10, f2 = 10;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const wx = ((ix + dx) % TILE + TILE) % TILE;
                    const wy = ((iy + dy) % TILE + TILE) % TILE;
                    const [rx, ry] = hash2v(wx, wy);
                    const ptX = ix + dx + rx;
                    const ptY = iy + dy + ry;
                    let ddx = px - ptX;
                    let ddy = py - ptY;
                    if (ddx > TILE / 2) ddx -= TILE;
                    else if (ddx < -TILE / 2) ddx += TILE;
                    if (ddy > TILE / 2) ddy -= TILE;
                    else if (ddy < -TILE / 2) ddy += TILE;
                    const d = Math.hypot(ddx, ddy);
                    if (d < f1) { f2 = f1; f1 = d; }
                    else if (d < f2) { f2 = d; }
                }
            }
            const edge = f2 - f1;
            const baseBright = 0.65 + 0.3 * (1 - f1);
            const edgeDark = Math.pow(edge, 0.6) * 0.25;
            const g = Math.min(1, Math.max(0, baseBright - edgeDark));
            const i = (y * s + x) * 4;
            const b = Math.floor(g * 255);
            data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
        }
    }
    // 写入回 ctx
    const id = ctx.createImageData(s, s);
    id.data.set(data);
    ctx.putImageData(id, 0, 0);
}

/** 焦散滚动配置（用户可通过 state.causticScrollX/Y 覆盖） */
export interface CausticsScrollConfig {
    speedU: number;
    speedV: number;
    /** 焦散 UV 在材质上重复次数（0.5 = 大光斑；2.0 = 细密） */
    scale: number;
    /** 焦散颜色（淡蓝白色，模拟水底折射） */
    color: Color3;
    /** 焦散强度（emissiveColor 比例） */
    intensity: number;
}

const DEFAULT_CONFIG: CausticsScrollConfig = {
    speedU: DEFAULT_SCROLL_SPEED,
    speedV: DEFAULT_SCROLL_SPEED * 0.7, // 微微 X/Y 不同步，更像水流
    scale: 1.0,
    color: new Color3(0.7, 0.85, 1.0),
    intensity: 1.0,
};

class CausticsControllerImpl {
    private _texture: Texture | null = null;
    private _scene: Scene | null = null;
    private _config: CausticsScrollConfig = { ...DEFAULT_CONFIG };
    private _offsetU = 0;
    private _offsetV = 0;

    getTexture(scene: Scene): Texture {
        if (this._texture && this._scene === scene) {
            return this._texture;
        }
        // 旧场景失效，dispose 旧纹理
        if (this._texture) {
            this._texture.dispose();
            this._texture = null;
        }
        this._texture = createCanvasTexture({
            size: CAUSTIC_TEX_SIZE,
            draw: _drawCausticCanvas,
            scene,
            name: 'envCaustics',
            wrap: 'wrap',
        });
        this._scene = scene;
        return this._texture;
    }

    setConfig(cfg: Partial<CausticsScrollConfig>): void {
        this._config = { ...this._config, ...cfg };
    }

    /**
     * 每帧调用：推进 UV offset。
     * 返回当前 config 供消费者查 scrollSpeed/scrollScale。
     */
    update(dt: number): { offsetU: number; offsetV: number; cfg: CausticsScrollConfig } {
        this._offsetU = (this._offsetU + this._config.speedU * dt) % 1;
        this._offsetV = (this._offsetV + this._config.speedV * dt) % 1;
        if (this._texture) {
            this._texture.uOffset = this._offsetU;
            this._texture.vOffset = this._offsetV;
        }
        return { offsetU: this._offsetU, offsetV: this._offsetV, cfg: this._config };
    }

    getConfig(): CausticsScrollConfig {
        return this._config;
    }

    dispose(): void {
        if (this._texture) {
            this._texture.dispose();
            this._texture = null;
        }
        this._scene = null;
        this._offsetU = 0;
        this._offsetV = 0;
    }
}

export const causticsController = new CausticsControllerImpl();

/** 类型守卫：材质是否支持 emissiveTexture（用于焦散投影） */
export type CausticsHostMat = PBRMaterial | StandardMaterial;

export function isCausticsHost(mat: Material | null | undefined): mat is CausticsHostMat {
    return mat instanceof PBRMaterial || mat instanceof StandardMaterial;
}
