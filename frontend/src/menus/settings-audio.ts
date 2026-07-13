// settings-audio.ts — 音频设置子菜单（ADR-093 schema 驱动）
// 状态均已存在于 uiState 中，通过 ui. 前缀绑定声明式控件；
// onChange 调用各模块 setter 以触发 uiState 写入与副作用（增益刷新等）。

import { setStatus, cardContainer } from '../core/config';
import { t } from '../core/i18n/t';
import { setVolume, setAudioOffset } from '../outfit/audio';
import {
    setSfxEnabled,
    setSfxVolume,
    setFootstepEnabled,
    setFootstepVolume,
} from '../core/audio-bus';
import { setBpmQuantizeEnabled } from '../scene/motion/proc-motion-bridge';
import { setAutoLoadCompanionAudio, type SettingsMenuHandle } from './settings-shared';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function buildAudioSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    const refresh = () => getSettingsMenu()?.updateControls();

    return [
        {
            id: 'audio:volume',
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
            id: 'audio:mute',
            kind: 'toggle',
            label: 'settings.audio.mute',
            icon: 'lucide:volume-x',
            control: {
                bind: 'ui.volume',
                get: (v) => (v as number) === 0,
                set: (muted) => (muted ? 0 : 1),
                onChange: (muted) => {
                    setVolume(muted ? 0 : 1);
                    refresh();
                },
            },
        },
        {
            id: 'audio:offset',
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
            id: 'audio:offsetHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.style.cssText =
                    'font-size:10px;color:var(--text-dark);text-align:center;margin-top:4px;';
                hint.textContent = t('settings.audio.offsetHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'audio:bpmQuant',
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
                    setStatus(
                        v ? t('settings.bpmQuantOn') : t('settings.bpmQuantOff'),
                        true
                    );
                },
            },
        },
        {
            id: 'audio:companion',
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
                    setStatus(
                        v ? t('settings.companionOn') : t('settings.companionOff'),
                        true
                    );
                },
            },
        },
        {
            id: 'audio:sfx',
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
            id: 'audio:sfxVol',
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
            id: 'audio:footstep',
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
            id: 'audio:footstepVol',
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
    ];
}

export function buildSettingsAudioLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.audio'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                renderMenu(buildAudioSchema(getSettingsMenu), c);
            });
        },
    };
}
