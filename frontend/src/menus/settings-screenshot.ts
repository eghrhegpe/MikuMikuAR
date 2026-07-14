// settings-screenshot.ts — 截图设置子菜单

import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { t } from '../core/i18n/t';
import { slideRow, addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { SelectDir, OpenScreenshotDir } from '../core/wails-bindings';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';

function buildScreenshotSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：截图格式
        {
            id: 'screenshot:format',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '截图格式');
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
                                setStatus(
                                    t('settings.screenshotFormatSet', { label: f.label }),
                                    true
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
        // 卡片 2：截图质量
        {
            id: 'screenshot:quality',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '截图质量');
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
                                set: (v) => (v as number) / 100,
                                onChange: () => getSettingsMenu()?.updateControls(),
                            },
                            icon: 'lucide:gauge',
                        },
                    ];
                    renderMenu(qualitySchema, inner);
                });
            },
        },
        // 卡片 3：保存目录
        {
            id: 'screenshot:dir',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '保存目录');
                    const dir = uiState.screenshotDir ?? '';
                    const dirSub = dir
                        ? dir.length > 20
                            ? '...' + dir.slice(-17)
                            : dir
                        : '（尚未设置，截图时会选择）';

                    slideRow(inner, 'lucide:folder', '选择目录', false, async () => {
                        const d = await SelectDir();
                        if (!d) {
                            return;
                        }
                        setUIState({ screenshotDir: d });
                        getSettingsMenu()?.reRender();
                        setStatus(t('settings.screenshotDirSet', { dir: d }), true);
                    }, dirSub);

                    slideRow(inner, 'lucide:folder-open', '打开目录', false, () => {
                        OpenScreenshotDir().catch((err: unknown) => {
                            const msg = err instanceof Error ? err.message : String(err);
                            setStatus(`✗ ${msg}`, false);
                        });
                    });
                });
            },
        },
    ];
}

export function buildSettingsScreenshotLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildScreenshotSchema(getSettingsMenu), container);
        },
    };
}
