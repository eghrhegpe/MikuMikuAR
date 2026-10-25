// settings-media.ts — 媒体设置子菜单（ADR-157：合并原 audio + screenshot）
// 音频/音效来自原 settings-audio；截图来自原 settings-screenshot（裸中文已 i18n 化）。

import { uiState, setUIState, cardContainer } from '../core/config';
import { feedbackInfo } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { slideRow, addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { SelectDir, OpenScreenshotDir } from '../core/wails-bindings';
import { setVolume, setAudioOffset, setRepeatMode, getRepeatModeStr } from '@/core/audio';
import {
    setSfxEnabled,
    setSfxVolume,
    setFootstepEnabled,
    setFootstepVolume,
} from '../core/audio-bus';
import { setBpmQuantizeEnabled } from '../scene/motion/proc-motion-bridge';
import {
    setAutoLoadCompanionAudio,
    truncatePath,
    type SettingsMenuHandle,
} from './settings-shared';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { getCachedCapabilities } from '../core/backend';

// ======== 音频核心（音量/偏移/BPM/伴奏/循环） ========
// [audit:fix 2026-10] P2：media:mute 静音前音量缓存——取消静音恢复原值，
// 不再固定写 1（音量从 0 跳到 100%）。回退默认 0.7 对齐 defaultUIState.volume（core/ui-state.ts）
let _preMuteVolume: number | null = null;

function buildAudioCoreSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    const refresh = () => getSettingsMenu()?.updateControls();

    return [
        {
            id: 'media:volume',
            kind: 'slider',
            label: 'settings.audio.defaultVolume',
            icon: 'lucide:volume-2',
            control: {
                bind: 'ui.volume',
                min: 0,
                max: 100,
                step: 5,
                get: (v) => Math.round(((v as number) ?? 0.7) * 100),
                set: (v) => (v as number) / 100,
                onChange: (v) => {
                    setVolume((v as number) / 100);
                    refresh();
                },
            },
        },
        {
            id: 'media:mute',
            kind: 'toggle',
            label: 'settings.audio.mute',
            icon: 'lucide:volume-x',
            control: {
                bind: 'ui.volume',
                get: (v) => (v as number) === 0,
                // [audit:fix 2026-10] P2：renderToggle 契约中 set() 先于 onChange 写 uiState，
                // 故缓存/恢复逻辑放在 set()：静音前缓存 uiState.volume（>0 才缓存），
                // 取消静音恢复缓存值（缓存丢失/为 0 时回 0.7 默认）
                set: (muted) => {
                    if (muted) {
                        const prev = uiState.volume;
                        if (typeof prev === 'number' && prev > 0) {
                            _preMuteVolume = prev;
                        }
                        return 0;
                    }
                    const prev = _preMuteVolume;
                    _preMuteVolume = null;
                    return typeof prev === 'number' && prev > 0 ? prev : 0.7;
                },
                onChange: (muted) => {
                    // set() 已写入 uiState；取消静音按写入值恢复（0/非法回 0.7）
                    setVolume(
                        muted
                            ? 0
                            : typeof uiState.volume === 'number' && uiState.volume > 0
                              ? uiState.volume
                              : 0.7
                    );
                    refresh();
                },
            },
        },
        {
            id: 'media:offset',
            kind: 'slider',
            label: 'settings.audio.offset',
            icon: 'lucide:clock',
            control: {
                bind: 'ui.audioOffset',
                min: -5,
                max: 5,
                step: 0.1,
                get: (v) => (v as number) ?? 0,
                onChange: (v) => {
                    setAudioOffset(v as number);
                    refresh();
                },
            },
        },
        {
            id: 'media:offset-hint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint-center';
                hint.textContent = t('settings.audio.offsetHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'media:bpm-quant',
            kind: 'toggle',
            label: 'settings.audio.bpmQuantize',
            icon: 'lucide:activity',
            control: {
                bind: 'ui.bpmQuantizeEnabled',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    setBpmQuantizeEnabled(v as boolean);
                    refresh();
                    feedbackInfo(v ? 'settings.bpmQuantOn' : 'settings.bpmQuantOff', undefined);
                },
            },
        },
        {
            id: 'media:companion',
            kind: 'toggle',
            label: 'settings.audio.companionAutoLoad',
            icon: 'lucide:disc-3',
            control: {
                bind: 'ui.autoLoadCompanionAudio',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    setAutoLoadCompanionAudio(v as boolean);
                    refresh();
                    feedbackInfo(v ? 'settings.companionOn' : 'settings.companionOff', undefined);
                },
            },
        },
        {
            id: 'media:repeat-mode',
            kind: 'custom',
            renderCustom: (c) => {
                const row = document.createElement('div');
                row.className = 'slide-item';
                row.style.cursor = 'pointer';

                const iconSpan = document.createElement('span');
                iconSpan.className = 'slide-icon';
                const iconEl = document.createElement('span');
                iconEl.className = 'iconify';
                iconEl.dataset.icon = 'lucide:repeat';
                iconSpan.appendChild(iconEl);
                row.appendChild(iconSpan);

                const labelSpan = document.createElement('span');
                labelSpan.className = 'slide-label';
                labelSpan.textContent = t('settings.audio.repeatMode');
                row.appendChild(labelSpan);

                const valueSpan = document.createElement('span');
                valueSpan.className = 'slide-value';
                valueSpan.style.cssText =
                    'margin-left:auto;margin-right:8px;font-size:0.85em;opacity:0.8';
                row.appendChild(valueSpan);
                const modeLabels: Record<string, string> = {
                    none: t('settings.audio.repeatNone'),
                    one: t('settings.audio.repeatOne'),
                    all: t('settings.audio.repeatAll'),
                    shuffle: t('settings.audio.repeatShuffle'),
                };
                const modes = ['none', 'one', 'all', 'shuffle'] as const;
                const updateLabel = () => {
                    const m = getRepeatModeStr();
                    valueSpan.textContent = modeLabels[m] ?? m;
                };
                updateLabel();
                row.addEventListener('click', () => {
                    const cur = getRepeatModeStr();
                    const idx = modes.indexOf(cur);
                    const next = modes[(idx + 1) % modes.length];
                    setRepeatMode(next);
                    updateLabel();
                    showInfoToast(t('settings.audio.repeatModeSet', { mode: modeLabels[next] }));
                    refresh();
                });
                c.appendChild(row);
            },
        },
    ] satisfies MenuNode[];
}

// ======== 音效（SFX 总开关/音量/脚步声） ========
function buildSfxSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    const refresh = () => getSettingsMenu()?.updateControls();

    return [
        {
            id: 'media:sfx',
            kind: 'toggle',
            label: 'settings.sfx.enabled',
            icon: 'lucide:volume-2',
            control: {
                bind: 'ui.sfxEnabled',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    setSfxEnabled(v as boolean);
                    refresh();
                },
            },
        },
        {
            id: 'media:sfx-vol',
            kind: 'slider',
            label: 'settings.sfx.volume',
            icon: 'lucide:volume-2',
            control: {
                bind: 'ui.sfxVolume',
                min: 0,
                max: 100,
                step: 5,
                get: (v) => Math.round(((v as number) ?? 0.7) * 100),
                set: (v) => (v as number) / 100,
                onChange: (v) => {
                    setSfxVolume((v as number) / 100);
                    refresh();
                },
            },
        },
        {
            id: 'media:footstep',
            kind: 'toggle',
            label: 'settings.footstep.enabled',
            icon: 'lucide:footprints',
            control: {
                bind: 'ui.footstepEnabled',
                get: (v) => v === true,
                set: (v) => v,
                onChange: (v) => {
                    setFootstepEnabled(v as boolean);
                    refresh();
                },
            },
        },
        {
            id: 'media:footstep-vol',
            kind: 'slider',
            label: 'settings.footstep.volume',
            icon: 'lucide:footprints',
            control: {
                bind: 'ui.footstepVolume',
                min: 0,
                max: 100,
                step: 5,
                get: (v) => Math.round(((v as number) ?? 0.8) * 100),
                set: (v) => (v as number) / 100,
                onChange: (v) => {
                    setFootstepVolume((v as number) / 100);
                    refresh();
                },
            },
        },
    ] satisfies MenuNode[];
}

// ======== 截图（格式/质量/缩略图分辨率/保存目录） ========
function buildScreenshotSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'media:shot-format',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(
                        inner,
                        t('settings.screenshot.format'),
                        'settings:screenshot:format'
                    );
                    const formats: Array<{
                        key: 'image/png' | 'image/jpeg' | 'image/webp';
                        label: string;
                    }> = [
                        { key: 'image/png', label: 'PNG' },
                        { key: 'image/jpeg', label: 'JPEG' },
                        { key: 'image/webp', label: 'WebP' },
                    ];
                    const formatRows: HTMLElement[] = [];
                    for (const f of formats) {
                        const isActive = (uiState.screenshotFormat ?? 'image/png') === f.key;
                        const row = slideRow(
                            inner,
                            `lucide:${isActive ? 'check-circle' : 'circle'}`,
                            f.label,
                            false,
                            () => {
                                setUIState({ screenshotFormat: f.key });
                                getSettingsMenu()?.updateControls();
                                showInfoToast(
                                    t('settings.screenshotFormatSet', { label: f.label })
                                );
                            },
                            undefined,
                            undefined,
                            isActive
                        );
                        row.dataset.formatKey = f.key;
                        formatRows.push(row);
                    }
                    getCurrentRenderingMenu()?.registerControl(() => {
                        const current = uiState.screenshotFormat ?? 'image/png';
                        for (const row of formatRows) {
                            const key = row.dataset.formatKey!;
                            const isActive = current === key;
                            row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                            const icon = row.querySelector(
                                '.slide-icon iconify-icon'
                            ) as HTMLElement | null;
                            if (icon) {
                                icon.setAttribute(
                                    'icon',
                                    `lucide:${isActive ? 'check-circle' : 'circle'}`
                                );
                            }
                        }
                    });
                });
            },
        },
        {
            id: 'media:shot-quality',
            kind: 'custom',
            renderCustom: (c) => {
                // [audit:fix 2026-10] P2：return cardContainer(...) 使内层 renderMenu disposer 级联（先例 scene-render-levels）
                return cardContainer(c, (inner) => {
                    addSectionTitle(
                        inner,
                        t('settings.screenshot.quality'),
                        'settings:screenshot:quality'
                    );
                    const qualitySchema: MenuNode[] = [
                        {
                            id: 'media:screenshot-quality-slider',
                            kind: 'slider',
                            label: 'settings.screenshot.quality',
                            control: {
                                bind: 'ui.screenshotQuality',
                                min: 50,
                                max: 100,
                                step: 5,
                                get: (v) => Math.round(((v as number) ?? 0.9) * 100),
                                set: (v) => (v as number) / 100,
                                onChange: () => getSettingsMenu()?.updateControls(),
                            },
                            icon: 'lucide:gauge',
                        },
                    ];
                    return renderMenu(qualitySchema, inner);
                });
            },
        },
        {
            id: 'media:shot-thumb-res',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(
                        inner,
                        t('settings.screenshot.thumbRes'),
                        'settings:screenshot:thumb-res'
                    );
                    const resolutions: Array<{ key: number; label: string }> = [
                        { key: 512, label: '512px' },
                        { key: 1024, label: '1024px' },
                        { key: 2048, label: '2048px' },
                        { key: 4096, label: '4096px (4K)' },
                    ];
                    const resRows: HTMLElement[] = [];
                    for (const r of resolutions) {
                        const isActive = (uiState.thumbnailResolution ?? 512) === r.key;
                        const row = slideRow(
                            inner,
                            `lucide:${isActive ? 'check-circle' : 'circle'}`,
                            r.label,
                            false,
                            () => {
                                setUIState({ thumbnailResolution: r.key });
                                getSettingsMenu()?.updateControls();
                                showInfoToast(
                                    t('settings.screenshot.thumbResSet', { label: r.label })
                                );
                            },
                            undefined,
                            undefined,
                            isActive
                        );
                        row.dataset.resKey = String(r.key);
                        resRows.push(row);
                    }
                    getCurrentRenderingMenu()?.registerControl(() => {
                        const current = uiState.thumbnailResolution ?? 512;
                        for (const row of resRows) {
                            const key = Number(row.dataset.resKey);
                            const isActive = current === key;
                            row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                            const icon = row.querySelector(
                                '.slide-icon iconify-icon'
                            ) as HTMLElement | null;
                            if (icon) {
                                icon.setAttribute(
                                    'icon',
                                    `lucide:${isActive ? 'check-circle' : 'circle'}`
                                );
                            }
                        }
                    });
                });
            },
        },
        {
            id: 'media:shot-dir',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(
                        inner,
                        t('settings.screenshot.saveDir'),
                        'settings:screenshot:save-dir'
                    );
                    const dir = uiState.screenshotDir ?? '';
                    const dirSub = dir ? truncatePath(dir) : t('settings.screenshot.dirNotSet');

                    slideRow(
                        inner,
                        'lucide:folder',
                        t('settings.screenshot.selectDir'),
                        false,
                        async () => {
                            const d = await SelectDir();
                            if (!d) {
                                return;
                            }
                            setUIState({ screenshotDir: d });
                            getSettingsMenu()?.reRender();
                            showInfoToast(t('settings.screenshotDirSet', { dir: d }));
                        },
                        dirSub
                    );

                    if (getCachedCapabilities().systemDirOpen) {
                        slideRow(
                            inner,
                            'lucide:folder-open',
                            t('settings.screenshot.openDir'),
                            false,
                            () => {
                                OpenScreenshotDir().catch((err: unknown) => {
                                    const msg = translateGoError(err);
                                    showInfoToast(t('settings.error', { message: msg }));
                                });
                            }
                        );
                    }
                });
            },
        },
    ] satisfies MenuNode[];
}

function buildMediaSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：音频
        {
            id: 'media:audio-card',
            kind: 'custom',
            renderCustom: (c) => {
                // [audit:fix 2026-10] P2：return cardContainer(...) 使内层 renderMenu disposer 级联（先例 scene-render-levels）
                return cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.audio'));
                    return renderMenu(buildAudioCoreSchema(getSettingsMenu), inner);
                });
            },
        },
        // 卡片 2：音效
        {
            id: 'media:sfx-card',
            kind: 'custom',
            renderCustom: (c) => {
                // [audit:fix 2026-10] P2：return cardContainer(...) 使内层 renderMenu disposer 级联（先例 scene-render-levels）
                return cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.sfx.title'));
                    return renderMenu(buildSfxSchema(getSettingsMenu), inner);
                });
            },
        },
        // 截图卡片组（buildScreenshotSchema 内部自带 cardContainer）
        ...buildScreenshotSchema(getSettingsMenu),
    ];
}

export function buildSettingsMediaLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.media'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildMediaSchema(getSettingsMenu), container);
        },
    };
}
