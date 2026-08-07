// settings-shared.ts — 设置子模块共享的工具函数与状态
// 从 settings.ts 拆出，供各 settings-* 子模块引用。

import {
    SetUIAccent,
    GetDownloadAutoImport,
    GetDownloadWatchEnabled,
} from '../core/wails-bindings';
import { UIState } from '../core/config';
import { showInfoToast } from '../core/toast';
import { clamp01 } from '../core/clamp';
import { tryCatchStatus } from '../core/status-helpers';
import { hexToRgb, rgbToString } from '../core/color-helpers';
import { t } from '../core/i18n/t';

// ======== Auto-import state cache ========
// buildRootItems 是同步签名，无法内部 await；用模块级缓存 + 启动预加载。
let autoImportCached = false;

/** 启动时预加载自动导入开关状态。在 main.ts init 中调用。 */
export async function preloadAutoImportState(): Promise<void> {
    try {
        autoImportCached = await GetDownloadAutoImport();
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
        downloadWatchEnabledCached = await GetDownloadWatchEnabled();
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
import { setUIState } from '../core/state';

export function setAutoLoadCompanionAudio(v: boolean): void {
    setUIState({ autoLoadCompanionAudio: v });
}

// ======== Color utilities ========
// 实现下沉至 @/core/color-helpers。



// ======== Theme helper ========

// [fix P2] 并发守卫（true last-wins）：setTheme 的 await tryCatchStatus 是 suspension
// point，快速连点主题预设时多次调用并发——首版用 in-flight 去重（进行中返回同一
// promise）实为 first-wins：后点击的 hex 被静默丢弃，主题停在第一个颜色（code_review
// P2）。改为请求链：进行中记录最新 hex，当前 promise 完成后循环消费，最终 DOM 颜色
// = 最后一次点击。
let _themeInFlight: Promise<void> | null = null;
let _pendingThemeHex: string | null = null;

export async function setTheme(
    hex: string,
    getSettingsMenu: () => { updateControls: () => void } | null
): Promise<void> {
    if (_themeInFlight) {
        _pendingThemeHex = hex; // 记下最新请求，待当前完成后消费
        return _themeInFlight;
    }
    _pendingThemeHex = null;
    const p = (async (): Promise<void> => {
        let current = hex;
        for (;;) {
            const _r = await tryCatchStatus(() => SetUIAccent(current), t('settings.themeColor'));
            const next = _pendingThemeHex;
            if (_r === undefined || next === null) {
                if (_r === undefined) {
                    getSettingsMenu()?.updateControls();
                    return;
                }
                // 应用最终 DOM（无更新请求时）
                const root = document.documentElement;
                const textColors = generateTextColors(current);
                root.style.setProperty('--accent', current);
                root.style.setProperty('--accent-rgb', rgbToString(hexToRgb(current)));
                root.style.setProperty('--accent-dim', current + '33');
                root.style.setProperty('--text-bright', textColors.bright);
                root.style.setProperty('--text-dim', textColors.dim);
                root.style.setProperty('--text-muted', textColors.muted);
                showInfoToast(t('settings.themeColorSet', { hex: current }));
                getSettingsMenu()?.updateControls();
                return;
            }
            // 消费最新请求继续循环
            _pendingThemeHex = null;
            current = next;
        }
    })().finally(() => {
        _themeInFlight = null;
        _pendingThemeHex = null;
    });
    _themeInFlight = p;
    return p;
}

// [doc:adr-238] 主题纯函数/常量下沉 core/theme.ts，此处 re-export 保持兼容
import { generateTextColors, FONT_MAP, SETTINGS_FONT_RESTORE } from '../core/theme';
export { generateTextColors, FONT_MAP, SETTINGS_FONT_RESTORE };

// ======== Theme presets ========

export const THEME_PRESETS: Array<{ labelKey: string; color: string }> = [
    { labelKey: 'settings.theme.classicBlue', color: '#4a6cf7' },
    { labelKey: 'settings.theme.sakuraPink', color: '#f74a6c' },
    { labelKey: 'settings.theme.mintGreen', color: '#4af7a6' },
    { labelKey: 'settings.theme.sunsetOrange', color: '#f7a64a' },
    { labelKey: 'settings.theme.nightPurple', color: '#6c4af7' },
    { labelKey: 'settings.theme.minimalGray', color: '#888888' },
];

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

/** 路径截断显示：超长时保留尾部（用户更关心文件名/末级目录） */
export function truncatePath(p: string, max = 40): string {
    return p.length > max ? '...' + p.slice(-(max - 3)) : p;
}

// [doc:adr-238] 注册预加载状态供 core/init 经 ui-action-bridge 调用（切断 core→menus）
import { registerUiAction } from '@/core/ui-action-bridge';
registerUiAction('preloadAutoImportState', () => preloadAutoImportState());
// 注：download-watch 预加载不在 bridge 注册——nav-actions.ts:213-214 在打开设置页时
// 直接 safeCallAsync 调用（code_review P0：接口无该 key，注册即 tsc 编译错误 + 死代码）。
