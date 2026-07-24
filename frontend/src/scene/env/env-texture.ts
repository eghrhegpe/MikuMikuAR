// env-texture.ts — 统一贴图工厂（ADR-092）
// 所有环境内 canvas 生成的贴图统一经此创建，消除散点 `getContext→toDataURL→new Texture`。
// 优先 DynamicTexture（无 PNG 编码开销，复用天空已验证路径）；构造/绘制失败时回退
// toDataURL→Texture，且回退路径同样吞掉受约束环境（NullEngine 无完整 2D 上下文）的绘制异常。

import { DynamicTexture, Texture, BaseTexture, Scene } from '@babylonjs/core';
import { getCanvasCtx } from './env-type-helpers';

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
        const dtCtx = getCanvasCtx(dt);
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
 * P3-fix: 缓存上限。用户频繁切换地面纹理类型时，缓存只增不减会累积大量 Texture 对象。
 * Map 的迭代顺序按插入顺序，淘汰最旧 key 即 LRU 近似实现。
 */
const MAX_TEXTURE_CACHE_SIZE = 32;

/**
 * 缓存所有权标记：凡经 getOrCreateCanvasTexture 创建的贴图均归缓存所有，
 * 统一由 disposeTextureCache 释放。材质释放路径（disposeGroundMaterial 等）
 * 须先经 isCacheOwnedTexture 判断并跳过缓存贴图，避免提前 dispose 后
 * getOrCreateCanvasTexture 命中已失效贴图、地面渲染退化为空白。
 */
const _cacheOwned = new WeakSet<BaseTexture>();
/**
 * 已从 key 缓存淘汰但仍由缓存拥有的贴图。
 * 淘汰时不立即 dispose，避免贴图仍挂在活动材质上；在环境整体销毁时统一释放。
 */
const _retiredTextures = new Set<BaseTexture>();

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
    _cacheOwned.add(tex);
    _texCache.set(key, tex);
    // P3-fix: LRU 淘汰 — 超过上限时释放最旧的 Texture
    if (_texCache.size > MAX_TEXTURE_CACHE_SIZE) {
        const oldestKey = _texCache.keys().next().value;
        if (oldestKey !== undefined) {
            const oldest = _texCache.get(oldestKey);
            if (oldest) {
                // 仅移出索引，不立即释放：旧贴图可能仍被活动材质引用。
                _retiredTextures.add(oldest);
            }
            _texCache.delete(oldestKey);
        }
    }
    return tex;
}

/** 判断贴图是否归缓存所有——是则调用方不得手动 dispose（由 disposeTextureCache 统一释放）。 */
export function isCacheOwnedTexture(tex: BaseTexture | null | undefined): boolean {
    return !!tex && _cacheOwned.has(tex);
}

/** 释放全部缓存贴图（供 disposeEnv 统一清理）。 */
export function disposeTextureCache(): void {
    for (const tex of _texCache.values()) {
        tex.dispose();
        _cacheOwned.delete(tex);
    }
    for (const tex of _retiredTextures) {
        tex.dispose();
        _cacheOwned.delete(tex);
    }
    _texCache.clear();
    _retiredTextures.clear();
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
