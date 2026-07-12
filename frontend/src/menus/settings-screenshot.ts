// settings-screenshot.ts — 截图设置子菜单

import { setStatus, uiState, setUIState, cardContainer, escapeHtml } from '../core/config';
import { t } from '../core/i18n/t';
import { slideRow, addSectionTitle, addFieldRow } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { SelectDir, OpenScreenshotDir } from '../core/wails-bindings';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';

export function buildSettingsScreenshotLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // —— 卡片 1：截图格式 ——（custom：slideRow 列表 + registerControl icon 动态更新）
            cardContainer(container, (c) => {
                addSectionTitle(c, '截图格式');
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
                        c,
                        `lucide:${isActive ? 'check-circle' : 'circle'}`,
                        f.label,
                        false,
                        () => {
                            setUIState({ screenshotFormat: f.key });
                            getSettingsMenu()?.updateControls();
                            setStatus(t('settings.screenshotFormatSet', { label: f.label }), true);
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

            // —— 卡片 2：截图质量 ——（schema slider + ui. 前缀 + get/set 百分比转换）
            cardContainer(container, (c) => {
                const qualitySchema: MenuNode[] = [
                    {
                        id: 'settings:screenshot:quality',
                        kind: 'slider',
                        label: '截图质量',
                        control: {
                            bind: 'ui.screenshotQuality',
                            min: 50,
                            max: 100,
                            step: 5,
                            get: (v) => Math.round(((v as number) ?? 0.9) * 100),
                            set: (v) => v / 100,
                            onChange: () => getSettingsMenu()?.updateControls(),
                        },
                        icon: 'lucide:gauge',
                    },
                ];
                renderMenu(qualitySchema, c);
            });

            // —— 卡片 3：保存目录 ——（custom：文件系统操作）
            cardContainer(container, (c) => {
                addSectionTitle(c, '保存目录');
                const dir = uiState.screenshotDir ?? '';
                addFieldRow(c, '当前目录', dir ? escapeHtml(dir) : '（尚未设置，截图时会选择）');

                slideRow(c, 'lucide:folder', '选择目录', false, async () => {
                    const d = await SelectDir();
                    if (!d) {
                        return;
                    }
                    setUIState({ screenshotDir: d });
                    getSettingsMenu()?.reRender();
                    setStatus(t('settings.screenshotDirSet', { dir }), true);
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
