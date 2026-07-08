// settings-audio.ts — 音频设置子菜单

import { setStatus, cardContainer } from '../core/config';
import { slideRow, addSliderRow, addToggleRow } from '../core/ui-helpers';
import { setVolume, getVolume, setAudioOffset, getAudioOffset } from '../outfit/audio';
import { setBpmQuantizeEnabled, getBpmQuantizeEnabled } from '../scene/motion/proc-motion-bridge';
import { getAutoLoadCompanionAudio, setAutoLoadCompanionAudio } from './settings-shared';
import type { PopupLevel } from '../core/config';

type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

export function buildSettingsAudioLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '音频',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(
                    c, '默认音量', getVolume(), 0, 1, 0.05,
                    (v) => { setVolume(v); getSettingsMenu()?.updateControls(); },
                    'lucide:volume-2', undefined,
                    {
                        bind: () => getVolume(),
                        onUpdate: (el) => { const valEl = el.querySelector('.cs-value'); if (valEl) { valEl.textContent = Math.round(getVolume() * 100) + '%'; } },
                    }
                );
            });

            cardContainer(container, (c) => {
                let muteFlag = false;
                addToggleRow(c, '静音', false,
                    (v) => { muteFlag = v; if (v) { setVolume(0); } else { setVolume(1); } getSettingsMenu()?.updateControls(); },
                    'lucide:volume-x',
                    { bind: () => getVolume() === 0 }
                );
            });

            cardContainer(container, (c) => {
                addSliderRow(
                    c, '音频偏移', getAudioOffset(), -5, 5, 0.1,
                    (v) => { setAudioOffset(v); getSettingsMenu()?.updateControls(); },
                    'lucide:clock', undefined,
                    {
                        bind: () => getAudioOffset(),
                        onUpdate: (el) => { const valEl = el.querySelector('.cs-value'); if (valEl) { valEl.textContent = getAudioOffset().toFixed(2); } },
                    }
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-dark);text-align:center;margin-top:4px;';
                hint.textContent = '正=音频先播，负=音频后播（对所有音乐全局生效）';
                c.appendChild(hint);
            });

            cardContainer(container, (c) => {
                addToggleRow(c, 'BPM 量化', true,
                    (v) => { setBpmQuantizeEnabled(v); getSettingsMenu()?.updateControls(); setStatus(v ? '✓ BPM 量化已开启' : '✓ BPM 量化已关闭', true); },
                    'lucide:activity',
                    { bind: () => getBpmQuantizeEnabled() }
                );
            });

            cardContainer(container, (c) => {
                addToggleRow(c, '加载动作时自动加载同目录音乐', getAutoLoadCompanionAudio(),
                    (v) => { setAutoLoadCompanionAudio(v); getSettingsMenu()?.updateControls(); setStatus(v ? '✓ 伴音自动加载已开启' : '✓ 伴音自动加载已关闭', true); },
                    'lucide:disc-3',
                    { bind: () => getAutoLoadCompanionAudio() }
                );
            });
        },
    };
}
