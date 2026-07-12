// settings-shared.ts — 设置子模块共享的工具函数与状态
// 从 settings.ts 拆出，供各 settings-* 子模块引用。

import {
    SetDownloadAutoImport,
    SetUIAccent,
    SetUIAnimations,
    SetUIBlurBg,
    SetUIFontFamily,
    SetUIPopupWidth,
    SetUIScale,
    SetPerformanceMode,
} from '../core/wails-bindings';
import { setStatus, UIState, uiState, setUIState } from '../core/config';
import { tryCatchStatus } from '../core/utils';
import { t } from '../core/i18n/t';

// ======== Auto-import state cache ========
// buildRootItems 是同步签名，无法内部 await；用模块级缓存 + 启动预加载。
let autoImportCached = false;

/** 启动时预加载自动导入开关状态。在 main.ts init 中调用。 */
export async function preloadAutoImportState(): Promise<void> {
    try {
        autoImportCached = await import('../core/wails-bindings').then((m) =>
            m.GetDownloadAutoImport()
        );
    } catch {
        autoImportCached = false;
    }
}

export function getAutoImportCached(): boolean {
    return autoImportCached;
}

export function setAutoImportCached(v: boolean): void {
    autoImportCached = v;
}

// ======== Download watch enabled state cache ========
// 与 autoImport 同模式：buildRootItems 同步签名无法 await，用模块级缓存 + 启动预加载。
let downloadWatchEnabledCached = false;

/** 启动时预加载下载监听开关状态。在 main.ts init 中调用。 */
export async function preloadDownloadWatchState(): Promise<void> {
    try {
        downloadWatchEnabledCached = await import('../core/wails-bindings').then((m) =>
            m.GetDownloadWatchEnabled()
        );
    } catch {
        downloadWatchEnabledCached = false;
    }
}

export function getDownloadWatchEnabledCached(): boolean {
    return downloadWatchEnabledCached;
}

export function setDownloadWatchEnabledCached(v: boolean): void {
    downloadWatchEnabledCached = v;
}

// ======== VMD 伴音自动加载 ========
/** 加载 VMD 动作时自动发现并加载同目录同名音频（.mp3/.wav/.ogg/.flac）。默认开启。 */
// AO ✂️ Replace setter with SettingsStore.set
import { SettingsStore } from '../lib/settings-store';

export function isAutoLoadCompanionAudioEnabled(): boolean {
    return SettingsStore.get().get('autoLoadCompanionAudio') as boolean;
}

export function setAutoLoadCompanionAudio(v: boolean): void {
    SettingsStore.get().set('autoLoadCompanionAudio', v);
    setUIState({ autoLoadCompanionAudio: v });
}

export function getAutoLoadCompanionAudio(): boolean {
    return SettingsStore.get().get('autoLoadCompanionAudio') as boolean;
}

// ======== Color utilities ========

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return { r: 74, g: 108, b: 247 };
    }
    return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
    };
}

export function rgbToString(rgb: { r: number; g: number; b: number }): string {
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

export function generateTextColors(hex: string): { bright: string; dim: string; muted: string } {
    const rgb = hexToRgb(hex);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;

    // factor 直接作为混合比例：0 = 纯白，1 = 纯主题色
    // 亮主题（brightness>128）→ 文字偏暗 → factor 大（更多主题色）
    // 暗主题 → 文字偏亮 → factor 小（更多白）
    const mix = (factor: number) => {
        const f = Math.max(0, Math.min(1, factor));
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

// ======== Theme helper ========

export async function setTheme(
    hex: string,
    getSettingsMenu: () => { updateControls: () => void } | null
): Promise<void> {
    const root = document.documentElement;
    const textColors = generateTextColors(hex);

    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', rgbToString(hexToRgb(hex)));
    root.style.setProperty('--accent-dim', hex + '33');
    root.style.setProperty('--text-bright', textColors.bright);
    root.style.setProperty('--text-dim', textColors.dim);
    root.style.setProperty('--text-muted', textColors.muted);

    const _r = await tryCatchStatus(() => SetUIAccent(hex), t('status.error'));
    if (_r !== undefined) {
        setStatus(t('settings.themeColorSet', { hex }), true);
    }
    getSettingsMenu()?.updateControls();
}

// ======== Font map ========

export const FONT_MAP: Record<string, { label: string; css: string }> = {
    system: {
        label: '系统默认',
        css: "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif",
    },
    noto: {
        label: '思源黑体',
        css: "'Source Han Sans SC', 'Noto Sans CJK SC', system-ui, sans-serif",
    },
    yahei: {
        label: '微软雅黑',
        css: "'Microsoft YaHei', 'Microsoft YaHei UI', system-ui, sans-serif",
    },
};

export const SETTINGS_FONT_RESTORE: Record<string, string> = Object.fromEntries(
    Object.entries(FONT_MAP).map(([key, font]) => [key, font.css])
);

// ======== Theme presets ========

export const THEME_PRESETS: Array<{ label: string; color: string }> = [
    { label: '经典蓝', color: '#4a6cf7' },
    { label: '樱花粉', color: '#f74a6c' },
    { label: '薄荷绿', color: '#4af7a6' },
    { label: '日落橙', color: '#f7a64a' },
    { label: '暗夜紫', color: '#6c4af7' },
    { label: '极简灰', color: '#888888' },
];

// ======== Display name priority ========

import type { DisplayNamePriority } from '../core/config';

export const NAME_PRIORITY_LABELS: Record<DisplayNamePriority, string> = {
    name_jp: '日语名',
    name_en: '英语名',
    filename: '文件名',
};

export const NAME_PRIORITY_INDEX: Record<number, DisplayNamePriority> = {
    0: 'name_jp',
    1: 'name_en',
    2: 'filename',
};

/** displayNamePriority → slider index (0/1/2)，消除 settings-filename.ts 中的隐式重复映射 */
export const PRIORITY_TO_INDEX: Record<DisplayNamePriority, number> = {
    name_jp: 0,
    name_en: 1,
    filename: 2,
};

// ======== Appearance restore (for import/reset) ========

export function applyUIAppearanceDom(s: UIState): void {
    const root = document.documentElement;
    if (s.scale) {
        root.style.setProperty('--ui-scale', String(s.scale));
    }
    if (s.popupWidth) {
        root.style.setProperty('--popup-width', s.popupWidth + 'px');
    }
    if (s.accent) {
        root.style.setProperty('--accent', s.accent);
        root.style.setProperty('--accent-rgb', rgbToString(hexToRgb(s.accent)));
        root.style.setProperty('--accent-dim', s.accent + '33');
        const tc = generateTextColors(s.accent);
        root.style.setProperty('--text-bright', tc.bright);
        root.style.setProperty('--text-dim', tc.dim);
        root.style.setProperty('--text-muted', tc.muted);
    }
    if (s.fontFamily && SETTINGS_FONT_RESTORE[s.fontFamily]) {
        root.style.setProperty('--font', SETTINGS_FONT_RESTORE[s.fontFamily]);
    }
    root.style.setProperty('--ui-animations', s.animations === false ? '0' : '1');
    root.style.setProperty('--ui-blur', s.blurBg ? '1' : '0');
    document
        .querySelectorAll<HTMLElement>('.overlay')
        .forEach((el) => el.classList.toggle('blur-bg', !!s.blurBg));
}

// ======== Format bytes ========

// ======== Shared type for settings menu handle ========

export type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

export function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const idx = Math.min(i, units.length - 1);
    const val = bytes / Math.pow(1024, idx);
    return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
