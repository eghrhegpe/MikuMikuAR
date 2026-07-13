// settings-audio.ts — 音频设置子菜单（ADR-093 schema 驱动）
// 状态来源分散（audio.ts / audio-bus.ts / proc-motion-bridge.ts / settings-shared.ts），
// 无法用 StatePath 绑定，全部用 custom 节点 + 声明式 schema 结构。

import { setStatus, cardContainer } from '../core/config';
import { t } from '../core/i18n/t';
import { addSliderRow, addToggleRow } from '../core/ui-helpers';
import { setVolume, getVolume, setAudioOffset, getAudioOffset } from '../outfit/audio';
import {
    getSfxEnabled,
    setSfxEnabled,
    getSfxVolume,
    setSfxVolume,
    getFootstepEnabled,
    setFootstepEnabled,
    getFootstepVolume,
    setFootstepVolume,
} from '../core/audio-bus';
import { setBpmQuantizeEnabled, getBpmQuantizeEnabled } from '../scene/motion/proc-motion-bridge';
import {
    getAutoLoadCompanionAudio,
    setAutoLoadCompanionAudio,
    type SettingsMenuHandle,
} from './settings-shared';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function buildAudioSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    const refresh = () => getSettingsMenu()?.updateControls();

    return [
        {
            id: 'audio:volume',
            kind: 'custom',
            renderCustom: (c) => {
                addSliderRow(
                    c,
                    '默认音量',
                    getVolume(),
                    0,
                    1,
                    0.05,
                    (v) => {
                        setVolume(v);
                        refresh();
                    },
                    'lucide:volume-2',
                    undefined,
                    {
                        bind: () => getVolume(),
                        onUpdate: (el) => {
                            const valEl = el.querySelector('.cs-value');
                            if (valEl) {
                                valEl.textContent = Math.round(getVolume() * 100) + '%';
                            }
                        },
                    }
                );
            },
        },
        {
            id: 'audio:mute',
            kind: 'custom',
            renderCustom: (c) => {
                let muteFlag = false;
                addToggleRow(
                    c,
                    '静音',
                    false,
                    (v) => {
                        muteFlag = v;
                        if (v) {
                            setVolume(0);
                        } else {
                            setVolume(1);
                        }
                        refresh();
                    },
                    'lucide:volume-x',
                    { bind: () => getVolume() === 0 }
                );
            },
        },
        {
            id: 'audio:offset',
            kind: 'custom',
            renderCustom: (c) => {
                addSliderRow(
                    c,
                    '音频偏移',
                    getAudioOffset(),
                    -5,
                    5,
                    0.1,
                    (v) => {
                        setAudioOffset(v);
                        refresh();
                    },
                    'lucide:clock',
                    undefined,
                    {
                        bind: () => getAudioOffset(),
                        onUpdate: (el) => {
                            const valEl = el.querySelector('.cs-value');
                            if (valEl) {
                                valEl.textContent = getAudioOffset().toFixed(2);
                            }
                        },
                    }
                );
                const hint = document.createElement('div');
                hint.style.cssText =
                    'font-size:10px;color:var(--text-dark);text-align:center;margin-top:4px;';
                hint.textContent = t('settings.audio.offsetHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'audio:bpmQuant',
            kind: 'custom',
            renderCustom: (c) => {
                addToggleRow(
                    c,
                    'BPM 量化',
                    true,
                    (v) => {
                        setBpmQuantizeEnabled(v);
                        refresh();
                        setStatus(v ? t('settings.bpmQuantOn') : t('settings.bpmQuantOff'), true);
                    },
                    'lucide:activity',
                    { bind: () => getBpmQuantizeEnabled() }
                );
            },
        },
        {
            id: 'audio:companion',
            kind: 'custom',
            renderCustom: (c) => {
                addToggleRow(
                    c,
                    '加载动作时自动加载同目录音乐',
                    getAutoLoadCompanionAudio(),
                    (v) => {
                        setAutoLoadCompanionAudio(v);
                        refresh();
                        setStatus(v ? t('settings.companionOn') : t('settings.companionOff'), true);
                    },
                    'lucide:disc-3',
                    { bind: () => getAutoLoadCompanionAudio() }
                );
            },
        },
        {
            id: 'audio:sfx',
            kind: 'custom',
            renderCustom: (c) => {
                addToggleRow(
                    c,
                    t('settings.sfx.enabled'),
                    getSfxEnabled(),
                    (v) => {
                        setSfxEnabled(v);
                        refresh();
                    },
                    'lucide:volume-2',
                    { bind: () => getSfxEnabled() }
                );
            },
        },
        {
            id: 'audio:sfxVol',
            kind: 'custom',
            renderCustom: (c) => {
                addSliderRow(
                    c,
                    t('settings.sfx.volume'),
                    getSfxVolume(),
                    0,
                    1,
                    0.05,
                    (v) => {
                        setSfxVolume(v);
                        refresh();
                    },
                    'lucide:volume-2',
                    undefined,
                    {
                        bind: () => getSfxVolume(),
                        onUpdate: (el) => {
                            const valEl = el.querySelector('.cs-value');
                            if (valEl) {
                                valEl.textContent = Math.round(getSfxVolume() * 100) + '%';
                            }
                        },
                    }
                );
            },
        },
        {
            id: 'audio:footstep',
            kind: 'custom',
            renderCustom: (c) => {
                addToggleRow(
                    c,
                    t('settings.footstep.enabled'),
                    getFootstepEnabled(),
                    (v) => {
                        setFootstepEnabled(v);
                        refresh();
                    },
                    'lucide:footprints',
                    { bind: () => getFootstepEnabled() }
                );
            },
        },
        {
            id: 'audio:footstepVol',
            kind: 'custom',
            renderCustom: (c) => {
                addSliderRow(
                    c,
                    t('settings.footstep.volume'),
                    getFootstepVolume(),
                    0,
                    1,
                    0.05,
                    (v) => {
                        setFootstepVolume(v);
                        refresh();
                    },
                    'lucide:footprints',
                    undefined,
                    {
                        bind: () => getFootstepVolume(),
                        onUpdate: (el) => {
                            const valEl = el.querySelector('.cs-value');
                            if (valEl) {
                                valEl.textContent = Math.round(getFootstepVolume() * 100) + '%';
                            }
                        },
                    }
                );
            },
        },
    ];
}

export function buildSettingsAudioLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '音频',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                renderMenu(buildAudioSchema(getSettingsMenu), c);
            });
        },
    };
}
