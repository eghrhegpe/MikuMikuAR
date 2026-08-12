// [doc:architecture] Watermark — 截图水印系统
// 职责: 在 canvas 截图时叠加文字/图片水印

import { logWarn } from '@/core/logger';

export interface WatermarkConfig {
    enabled: boolean;
    text: string;
    /** 水印位置: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center' */
    position: 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft' | 'center';
    /** 透明度 0-1 */
    opacity: number;
    /** 字体大小（px） */
    fontSize: number;
    /** 字体颜色 */
    color: string;
}

export const DEFAULT_WATERMARK: WatermarkConfig = {
    enabled: false,
    text: 'MikuMikuAR',
    position: 'bottomRight',
    opacity: 0.6,
    fontSize: 24,
    color: '#ffffff',
};

let _config: WatermarkConfig = { ...DEFAULT_WATERMARK };

/** 获取当前水印配置。 */
export function getWatermarkConfig(): WatermarkConfig {
    return { ..._config };
}

/** 设置水印配置（部分更新）。 */
export function setWatermarkConfig(partial: Partial<WatermarkConfig>): void {
    _config = { ..._config, ...partial };
}

/** 水印文字锚点计算结果。 */
export interface WatermarkPosition {
    x: number;
    y: number;
    textBaseline: CanvasTextBaseline;
}

/**
 * 计算水印文字绘制位置（纯函数，可独立测试）。
 * 各锚点语义与原实现一致：topLeft/topRight 基线贴顶，bottomLeft/bottomRight 贴底，center 居中。
 */
export function computeWatermarkPosition(
    position: WatermarkConfig['position'],
    textWidth: number,
    imgWidth: number,
    imgHeight: number,
    fontSize: number
): WatermarkPosition {
    const margin = 12;
    switch (position) {
        case 'topLeft':
            return { x: margin, y: fontSize + margin, textBaseline: 'top' };
        case 'topRight':
            // 文字比图宽时会算出负 x，clamp 到左侧 margin 避免画到画布外
            return {
                x: Math.max(margin, imgWidth - textWidth - margin),
                y: fontSize + margin,
                textBaseline: 'top',
            };
        case 'bottomLeft':
            return { x: margin, y: imgHeight - margin, textBaseline: 'bottom' };
        case 'center':
            return {
                x: Math.max(margin, (imgWidth - textWidth) / 2),
                y: imgHeight / 2 + fontSize / 2,
                textBaseline: 'middle',
            };
        default: // bottomRight
            return {
                x: Math.max(margin, imgWidth - textWidth - margin),
                y: imgHeight - margin,
                textBaseline: 'bottom',
            };
    }
}

/**
 * 在 base64 图片数据上叠加水印。
 * @param base64 原始截图 base64（不含 data:URI 前缀）
 * @param format 图片格式 image/png | image/jpeg
 * @param quality 图片质量 0-1
 * @returns 带水印的 base64 数据（不含 data:URI 前缀）
 */
export function applyWatermark(base64: string, format: string, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!_config.enabled) {
            resolve(base64);
            return;
        }

        const img = new Image();
        // 超时守卫：防止畸形 base64 导致 Promise 永久 pending
        const timeoutId = setTimeout(() => {
            img.onload = null;
            img.onerror = null;
            reject(new Error('Watermark image load timeout'));
        }, 10000);
        img.onload = () => {
            clearTimeout(timeoutId);
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                logWarn('watermark', 'canvas.getContext("2d") returned null, skipping watermark');
                resolve(base64);
                return;
            }

            // 绘制原始图片
            ctx.drawImage(img, 0, 0);

            // 水印文字
            ctx.save();
            ctx.globalAlpha = _config.opacity;
            ctx.font = `${_config.fontSize}px sans-serif`;
            ctx.fillStyle = _config.color;
            ctx.textBaseline = 'bottom';

            const textWidth = ctx.measureText(_config.text).width;

            const { x, y, textBaseline } = computeWatermarkPosition(
                _config.position,
                textWidth,
                img.width,
                img.height,
                _config.fontSize
            );

            // 带阴影的文字（提升可读性）
            ctx.textBaseline = textBaseline;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 1;
            ctx.shadowOffsetY = 1;
            ctx.fillText(_config.text, x, y);
            ctx.restore();

            // 异步编码：toBlob 移至后台线程，避免低端机 OOM（ADR-017 A2-04）
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        resolve(
                            canvas
                                .toDataURL(format, quality)
                                .replace(/^data:image\/\w+;base64,/, '')
                        );
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                        const r = reader.result;
                        resolve(
                            typeof r === 'string'
                                ? r.replace(/^data:image\/\w+;base64,/, '')
                                : canvas
                                      .toDataURL(format, quality)
                                      .replace(/^data:image\/\w+;base64,/, '')
                        );
                    };
                    reader.onerror = () => {
                        resolve(
                            canvas
                                .toDataURL(format, quality)
                                .replace(/^data:image\/\w+;base64,/, '')
                        );
                    };
                    reader.readAsDataURL(blob);
                },
                format,
                quality
            );
        };
        img.onerror = () => {
            clearTimeout(timeoutId);
            reject(new Error('Failed to load image for watermark'));
        };
        img.src = `data:image/png;base64,${base64}`;
    });
}
