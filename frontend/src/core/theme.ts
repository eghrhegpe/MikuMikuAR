// theme.ts — [doc:adr-238] 主题纯函数/常量叶（从 menus/settings-shared 下沉）。
// 切断 core/init.ts → menus/settings-shared 反向依赖：主题计算是纯函数，
// 归 core 叶；menus/settings-shared re-export 保持既有消费者兼容。
import { clamp01 } from './clamp';
import { hexToRgb } from './color-helpers';

export function generateTextColors(hex: string): { bright: string; dim: string; muted: string } {
    const rgb = hexToRgb(hex);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;

    // factor 直接作为混合比例：0 = 纯白，1 = 纯主题色
    // 亮主题（brightness>128）→ 文字偏暗 → factor 大（更多主题色）
    // 暗主题 → 文字偏亮 → factor 小（更多白）
    const mix = (factor: number) => {
        const f = clamp01(factor);
        const r = Math.round(rgb.r * f + 255 * (1 - f));
        const g = Math.round(rgb.g * f + 255 * (1 - f));
        const b = Math.round(rgb.b * f + 255 * (1 - f));
        return `rgb(${r}, ${g}, ${b})`;
    };

    return {
        // 暗背景（brightness≤128）→ 文字偏亮，轻染主题色
        // 亮背景                 → 文字偏暗，但饱和度不过高
        bright: mix(brightness > 128 ? 0.55 : 0.25),
        dim: mix(brightness > 128 ? 0.35 : 0.4),
        muted: mix(0.4),
    };
}

// ======== Font map ========

export const FONT_MAP: Record<string, { labelKey: string; css: string }> = {
    system: {
        labelKey: 'settings.font.system',
        css: "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif",
    },
    noto: {
        labelKey: 'settings.font.noto',
        css: "'Source Han Sans SC', 'Noto Sans CJK SC', system-ui, sans-serif",
    },
    yahei: {
        labelKey: 'settings.font.yahei',
        css: "'Microsoft YaHei', 'Microsoft YaHei UI', system-ui, sans-serif",
    },
};

export const SETTINGS_FONT_RESTORE: Record<string, string> = Object.fromEntries(
    Object.entries(FONT_MAP).map(([key, font]) => [key, font.css])
);
