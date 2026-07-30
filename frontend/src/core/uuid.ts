// 零依赖叶：UUID 生成。
// 下沉自 @/core/utils（god barrel）；根因与纪律见 ADR-191。

/**
 * 生成 UUID v4 字符串（格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx）。
 * 基于 Math.random，非密码学安全，适用于运行时实例 ID 生成场景。
 */
export function generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
