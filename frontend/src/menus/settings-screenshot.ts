// settings-screenshot.ts — 截图设置子菜单

import { setStatus, uiState, setUIState, cardContainer, escapeHtml } from '../core/config';
import { t } from '../core/i18n/t';
import { slideRow, addSliderRow, addSectionTitle, addFieldRow } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { SelectDir, OpenScreenshotDir } from '../core/wails-bindings';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';

export function buildSettingsScreenshotLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // —— 卡片 1：截图格式 ——
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

            // —— 卡片 2：截图质量 ——
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

            // —— 卡片 3：保存目录 ——
            cardContainer(container, (c) => {
                addSectionTitle(c, '保存目录');
                const dir = uiState.screenshotDir ?? '';
                addFieldRow(c, '当前目录', dir ? escapeHtml(dir) : '（尚未设置，截图时会选择）');

                slideRow(c, 'lucide:folder', '选择目录', false, async () => {
                    const d = await SelectDir();
                    if (!d) { return; }
                    uiState.screenshotDir = d;
                    setUIState({ screenshotDir: d });
                    getSettingsMenu()?.reRender();
                    setStatus(`✓ 截图目录已设置: ${d}`, true);
                });

                slideRow(c, 'lucide:folder-open', '打开目录', false, () => {
                    OpenScreenshotDir().catch((err: unknown) => {
                        const msg = err instanceof Error ? err.message : String(err);
                        setStatus(`✗ ${msg}`, false);
                    });
                });
            });
        },
    };
}
