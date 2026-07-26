// [doc:adr-189] GPU 压缩纹理能力探测 — Phase 0 基础设施
// 在 capabilities() 被调用时（可能在 Engine 创建前）通过临时 canvas 探测 GPU 压缩纹理扩展。
// 探测结果缓存，避免重复创建 canvas + WebGL context。
// 项目当前用 WebGL（@babylonjs/core/Engines/engine），WebGPU 探测延后到 Phase 1+。

export type Ktx2PreferredFormat = 'astc' | 'bc7' | 'etc2' | null;

export interface Ktx2Capability {
    supported: boolean;
    preferredFormat: Ktx2PreferredFormat;
}

let _cached: Ktx2Capability | null = null;

/**
 * 探测 GPU 对 KTX2 压缩纹理的支持。
 * 优先级：ASTC（移动端现代 GPU）> BC7（桌面）> ETC2（WebGL2 强制）。
 * 探测结果缓存，避免重复创建 WebGL context。
 */
export function detectKtx2Support(): Ktx2Capability {
    if (_cached) return _cached;
    _cached = _doDetect();
    return _cached;
}

function _doDetect(): Ktx2Capability {
    if (typeof document === 'undefined') {
        // Node.js 环境（测试）— 保守返回 false
        return { supported: false, preferredFormat: null };
    }

    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
        if (!gl) {
            return { supported: false, preferredFormat: null };
        }

        // 优先级：ASTC（移动端现代 GPU）> BC7（桌面）> ETC2（WebGL2 强制兜底）
        if (gl.getExtension('WEBGL_compressed_texture_astc')) {
            return { supported: true, preferredFormat: 'astc' };
        }
        if (gl.getExtension('EXT_texture_compression_bptc')) {
            return { supported: true, preferredFormat: 'bc7' };
        }
        if (gl.getExtension('WEBGL_compressed_texture_etc')) {
            return { supported: true, preferredFormat: 'etc2' };
        }
        return { supported: false, preferredFormat: null };
    } catch {
        return { supported: false, preferredFormat: null };
    }
}

/** 仅供测试使用：重置缓存。 */
export function _resetKtx2CacheForTest(): void {
    _cached = null;
}
