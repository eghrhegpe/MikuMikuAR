// settings-screenshot.ts — 截图设置子菜单

import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { slideRow, addSliderRow, addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import type { PopupLevel } from '../core/config';

type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

export function buildSettingsScreenshotLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSectionTitle(c, '截图格式');
                const formats: Array<{ key: 'image/png' | 'image/jpeg' | 'image/webp'; label: string; icon: string }> = [
                    { key: 'image/png', label: 'PNG', icon: 'lucide:file-image' },
                    { key: 'image/jpeg', label: 'JPEG', icon: 'lucide:file-image' },
                    { key: 'image/webp', label: 'WebP', icon: 'lucide:file-image' },
                ];
                const formatRows: HTMLElement[] = [];
                for (const f of formats) {
                    const isActive = (uiState.screenshotFormat ?? 'image/png') === f.key;
                    const row = slideRow(
                        c, `lucide:${isActive ? 'check-circle' : 'circle'}`, f.label, false,
                        () => { uiState.screenshotFormat = f.key; setUIState({ screenshotFormat: f.key }); getSettingsMenu()?.updateControls(); setStatus(`✓ 截图格式已设为 ${f.label}`, true); },
                        undefined, undefined, isActive
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
                        const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
                        if (icon) { icon.setAttribute('icon', `lucide:${isActive ? 'check-circle' : 'circle'}`); }
                    }
                });
            });

            cardContainer(container, (c) => {
                addSliderRow(
                    c, '截图质量', uiState.screenshotQuality ?? 0.9, 0.5, 1.0, 0.05,
                    (v) => { uiState.screenshotQuality = v; setUIState({ screenshotQuality: v }); getSettingsMenu()?.updateControls(); },
                    'lucide:gauge', undefined,
                    {
                        bind: () => uiState.screenshotQuality ?? 0.9,
                        onUpdate: (el) => { const valEl = el.querySelector('.cs-value'); if (valEl) { valEl.textContent = Math.round((uiState.screenshotQuality ?? 0.9) * 100) + '%'; } },
                    }
                );
            });
        },
    };
}
