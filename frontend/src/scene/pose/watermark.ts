// [doc:architecture] Watermark — 截图水印系统
// 职责: 在 canvas 截图时叠加文字/图片水印

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
            const margin = 12;

            let x: number, y: number;
            switch (_config.position) {
                case 'topLeft':
                    x = margin;
                    y = _config.fontSize + margin;
                    ctx.textBaseline = 'top';
                    break;
                case 'topRight':
                    x = img.width - textWidth - margin;
                    y = _config.fontSize + margin;
                    ctx.textBaseline = 'top';
                    break;
                case 'bottomLeft':
                    x = margin;
                    y = img.height - margin;
                    break;
                case 'center':
                    x = (img.width - textWidth) / 2;
                    y = img.height / 2 + _config.fontSize / 2;
                    ctx.textBaseline = 'middle';
                    break;
                default: // bottomRight
                    x = img.width - textWidth - margin;
                    y = img.height - margin;
                    break;
            }

            // 带阴影的文字（提升可读性）
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
                            canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
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
                            canvas.toDataURL(format, quality).replace(/^data:image\/\w+;base64,/, '')
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
