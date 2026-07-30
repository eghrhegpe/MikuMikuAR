// 零依赖叶：Canvas 图像工具。
// 下沉自 @/core/utils（god barrel）；根因与纪律见 ADR-191。

/**
 * 将 Canvas 编码为 base64 字符串（剥离 data:image/...;base64, 前缀）。
 * 优先走 toBlob 异步编码（后台线程），不阻塞主线程；
 * toBlob 不支持或失败时同步回退 toDataURL。
 *
 * @param canvas  目标 canvas
 * @param format  MIME 类型（image/png, image/jpeg, image/webp）
 * @param quality 编码质量（0–1，仅有损格式生效）
 */
export function canvasToBase64(
    canvas: HTMLCanvasElement,
    format: string,
    quality: number
): Promise<string> {
    return new Promise((resolve) => {
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
                    const result = reader.result;
                    if (typeof result === 'string') {
                        resolve(result.replace(/^data:image\/\w+;base64,/, ''));
                    } else {
                        resolve(
                            canvas
                                .toDataURL(format, quality)
                                .replace(/^data:image\/\w+;base64,/, '')
                        );
                    }
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
    });
}
