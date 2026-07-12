// env-texture.ts — 统一贴图工厂（ADR-092）
// 所有环境内 canvas 生成的贴图统一经此创建，消除散点 `getContext→toDataURL→new Texture`。
// 优先 DynamicTexture（无 PNG 编码开销，复用天空已验证路径）；构造/绘制失败时回退
// toDataURL→Texture，且回退路径同样吞掉受约束环境（NullEngine 无完整 2D 上下文）的绘制异常。

import { DynamicTexture, Texture, Scene } from '@babylonjs/core';

export interface CanvasTextureOptions {
    /** 正方形画布边长（px） */
    size: number;
    /** 绘制回调：在 2D 上下文上作画 */
    draw: (ctx: CanvasRenderingContext2D, size: number) => void;
    scene: Scene;
    /** 资源名（便于调试） */
    name?: string;
    /** 地址模式：'clamp'（默认，边缘贴地/淡出用）或 'wrap'（平铺纹理） */
    wrap?: 'clamp' | 'wrap';
    /** 用亮度驱动不透明度（白=不透明，黑=透明），边缘淡出用 */
    getAlphaFromRGB?: boolean;
    /** 贴图自带 alpha 通道（粒子雪花/樱花等），直接标记 hasAlpha */
    hasAlpha?: boolean;
    /** 是否生成 mipmap */
    generateMipMaps?: boolean;
}

function _applyWrap(tex: Texture, wrap: 'clamp' | 'wrap'): void {
    if (wrap === 'clamp') {
        tex.wrapU = Texture.CLAMP_ADDRESSMODE;
        tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    } else if (wrap === 'wrap') {
        tex.wrapU = Texture.WRAP_ADDRESSMODE;
        tex.wrapV = Texture.WRAP_ADDRESSMODE;
    }
}

/**
 * 统一创建 canvas 贴图。优先 DynamicTexture（无 toDataURL PNG 编码开销，ADR-091 §6 方向）；
 * 任意环节失败（含 NullEngine 受约束的 2D 上下文）回退 toDataURL→Texture，确保不崩。
 * 返回 Texture（DynamicTexture 是其子类，可直接设为 diffuseTexture / opacityTexture / bumpTexture）。
 */
export function createCanvasTexture(opts: CanvasTextureOptions): Texture {
    const {
        size,
        draw,
        scene,
        name = 'envCanvasTex',
        wrap = 'clamp',
        getAlphaFromRGB = false,
        hasAlpha = false,
        generateMipMaps = false,
    } = opts;

    // 优先 DynamicTexture
    try {
        const dt = new DynamicTexture(name, size, scene, generateMipMaps);
        const dtCtx = dt.getContext() as unknown as CanvasRenderingContext2D | null;
        if (!dtCtx) {
            throw new Error('DynamicTexture 无 2D 上下文');
        }
        draw(dtCtx, size);
        dt.update(false);
        if (getAlphaFromRGB) {
            dt.getAlphaFromRGB = true;
        }
        if (hasAlpha) {
            dt.hasAlpha = true;
        }
        _applyWrap(dt, wrap);
        return dt;
    } catch {
        // 回退：普通 canvas 绘制 → toDataURL → Texture。受约束环境下绘制异常一并吞掉。
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        try {
            if (ctx) {
                draw(ctx, size);
            }
        } catch {
            // 受约束环境（无 fillRect 等）下忽略绘制，使用空纹理
        }
        const tex = new Texture(canvas.toDataURL(), scene, false, false);
        if (getAlphaFromRGB) {
            tex.getAlphaFromRGB = true;
        }
        if (hasAlpha) {
            tex.hasAlpha = true;
        }
        _applyWrap(tex, wrap);
        return tex;
    }
}

// ======== 缓存封装：按 key 缓存，避免拖动滑块时反复生成 canvas ========

const _texCache = new Map<string, Texture>();

/**
 * 按 key 获取或创建 canvas 贴图。key 不变则复用；调用方不应手动 dispose 缓存贴图
 * （统一由 disposeTextureCache 在 disposeEnv 时释放）。
 */
export function getOrCreateCanvasTexture(key: string, opts: CanvasTextureOptions): Texture {
    const cached = _texCache.get(key);
    if (cached) {
        return cached;
    }
    const tex = createCanvasTexture(opts);
    _texCache.set(key, tex);
    return tex;
}

/** 释放全部缓存贴图（供 disposeEnv 统一清理）。 */
export function disposeTextureCache(): void {
    for (const tex of _texCache.values()) {
        tex.dispose();
    }
    _texCache.clear();
}

/**
 * 统一创建 canvas 并导出 data URL（供 CreateGroundFromHeightMap 等以 URL 为输入的场景，
 * 与 createCanvasTexture 不同：返回 data URL 字符串而非 Texture）。
 * ctx 不可用或绘制异常时返回 ''（与旧实现行为一致），确保受约束环境不崩。
 */
export function createCanvasDataURL(opts: {
    size: number;
    draw: (ctx: CanvasRenderingContext2D, size: number) => void;
}): string {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = opts.size;
        canvas.height = opts.size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return '';
        }
        opts.draw(ctx, opts.size);
        return canvas.toDataURL();
    } catch {
        return '';
    }
}
