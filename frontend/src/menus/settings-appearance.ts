// settings-appearance.ts — 外观设置子菜单

import { SetUIScale, SetUIPopupWidth, SetUIFontFamily, SetUIAnimations, SetUIBlurBg, SetUIAccent } from '../core/wails-bindings';
import { setStatus, cardContainer } from '../core/config';
import { slideRow, addToggleRow, addSliderRow, addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import type { PopupLevel, PopupRow } from '../core/config';
import { t } from '../core/i18n/t';
import {
    generateTextColors,
    rgbToString,
    hexToRgb,
    setTheme,
    FONT_MAP,
    THEME_PRESETS,
    SETTINGS_FONT_RESTORE,
    type SettingsMenuHandle,
} from './settings-shared';

export function buildSettingsAppearanceLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    const initialScale =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const initialWidth =
        parseInt(getComputedStyle(document.documentElement).getPropertyValue('--popup-width')) ||
        280;
    const initialAnim =
        getComputedStyle(document.documentElement).getPropertyValue('--ui-animations').trim() !==
        '0';
    const initialBlur =
        getComputedStyle(document.documentElement).getPropertyValue('--ui-blur').trim() !== '0';

    return {
        label: '外观',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    'UI 缩放',
                    initialScale,
                    0.8,
                    1.3,
                    0.05,
                    (v) => {
                        document.documentElement.style.setProperty('--ui-scale', String(v));
                        SetUIScale(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                    },
                    'lucide:maximize',
                    undefined,
                    {
                        bind: () =>
                            parseFloat(
                                getComputedStyle(document.documentElement).getPropertyValue(
                                    '--ui-scale'
                                )
                            ) || 1,
                    }
                );
                addSliderRow(
                    c,
                    '弹窗宽度',
                    initialWidth,
                    220,
                    360,
                    10,
                    (v) => {
                        document.documentElement.style.setProperty('--popup-width', v + 'px');
                        SetUIPopupWidth(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                    },
                    'lucide:sidebar',
                    undefined,
                    {
                        bind: () =>
                            parseInt(
                                getComputedStyle(document.documentElement).getPropertyValue(
                                    '--popup-width'
                                )
                            ) || 280,
                    }
                );
            });

            const currentAccent =
                getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
                '#4a6cf7';
            cardContainer(container, (c) => {
                addSectionTitle(c, '主题色');
                const themeRows: HTMLElement[] = [];
                for (const p of THEME_PRESETS) {
                    const isActive = currentAccent.toLowerCase() === p.color.toLowerCase();
                    const row = document.createElement('div');
                    row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                    row.dataset.themeColor = p.color;
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check-circle' : 'circle'}"></iconify-icon></span><span class="slide-label">${p.label}</span>`;
                    const swatch = document.createElement('span');
                    swatch.className = 'theme-swatch';
                    swatch.style.cssText = `width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid var(--white-12);flex-shrink:0;margin-left:auto;`;
                    row.appendChild(swatch);
                    row.addEventListener('click', () => setTheme(p.color, getSettingsMenu));
                    c.appendChild(row);
                    themeRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const accent =
                        getComputedStyle(document.documentElement)
                            .getPropertyValue('--accent')
                            .trim() || '#4a6cf7';
                    for (const row of themeRows) {
                        const color = row.dataset.themeColor!;
                        const isActive = accent.toLowerCase() === color.toLowerCase();
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
            cardContainer(container, (c) => {
                c.className = 'card-container accent-input-card';
                c.style.cssText = 'display:flex;gap:6px;padding:8px 14px;align-items:center;';
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = '#RRGGBB';
                input.className = 'tag-input';
                input.value = currentAccent;
                const applyBtn = document.createElement('button');
                applyBtn.className = 'btn btn-sm btn-primary';
                applyBtn.textContent = '应用';
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        applyBtn.click();
                    }
                });
                applyBtn.addEventListener('click', () => {
                    const hex = input.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                        setTheme(hex, getSettingsMenu);
                    } else if (input.value.trim() !== '') {
                        setStatus(t('settings.invalidColorFormat'), false);
                    }
                });
                c.appendChild(input);
                c.appendChild(applyBtn);
                getCurrentRenderingMenu()?.registerControl(() => {
                    const accent =
                        getComputedStyle(document.documentElement)
                            .getPropertyValue('--accent')
                            .trim() || '#4a6cf7';
                    input.value = accent;
                });
            });

            const currentCss = getComputedStyle(document.documentElement)
                .getPropertyValue('--font')
                .trim();
            cardContainer(container, (c) => {
                addSectionTitle(c, '字体');
                const fontRows: HTMLElement[] = [];
                for (const [key, f] of Object.entries(FONT_MAP)) {
                    const isActive = currentCss === f.css;
                    const row = slideRow(
                        c,
                        `lucide:${isActive ? 'check' : 'circle'}`,
                        f.label,
                        false,
                        () => {
                            document.documentElement.style.setProperty('--font', f.css);
                            SetUIFontFamily(key).catch(() => {});
                            getSettingsMenu()?.updateControls();
                            setStatus(t('settings.fontSet', { label: f.label }), true);
                        },
                        undefined,
                        undefined,
                        isActive
                    );
                    row.dataset.fontKey = key;
                    fontRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const fontCss = getComputedStyle(document.documentElement)
                        .getPropertyValue('--font')
                        .trim();
                    for (const row of fontRows) {
                        const key = row.dataset.fontKey!;
                        const isActive = FONT_MAP[key] && fontCss === FONT_MAP[key].css;
                        row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                        const icon = row.querySelector(
                            '.slide-icon iconify-icon'
                        ) as HTMLElement | null;
                        if (icon) {
                            icon.setAttribute('icon', `lucide:${isActive ? 'check' : 'circle'}`);
                        }
                    }
                });
            });

            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    '滑动动画',
                    initialAnim,
                    (v) => {
                        document.documentElement.style.setProperty(
                            '--ui-animations',
                            v ? '1' : '0'
                        );
                        SetUIAnimations(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                    },
                    'lucide:move',
                    {
                        bind: () =>
                            getComputedStyle(document.documentElement)
                                .getPropertyValue('--ui-animations')
                                .trim() !== '0',
                    }
                );
                addToggleRow(
                    c,
                    '背景模糊',
                    initialBlur,
                    (v) => {
                        document.documentElement.style.setProperty('--ui-blur', v ? '1' : '0');
                        document
                            .querySelectorAll<HTMLElement>('.overlay')
                            .forEach((el) => el.classList.toggle('blur-bg', v));
                        SetUIBlurBg(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                    },
                    'lucide:monitor',
                    {
                        bind: () =>
                            getComputedStyle(document.documentElement)
                                .getPropertyValue('--ui-blur')
                                .trim() !== '0',
                    }
                );
            });

            cardContainer(container, (c) => {
                slideRow(c, 'lucide:rotate-ccw', '恢复默认外观', false, () => {
                    const root = document.documentElement;
                    root.style.setProperty('--ui-scale', '1');
                    root.style.setProperty('--popup-width', '280px');
                    root.style.setProperty('--accent', '#4a6cf7');
                    root.style.setProperty('--accent-rgb', '74, 108, 247');
                    root.style.setProperty('--accent-dim', 'rgba(74,108,247,0.2)');
                    root.style.setProperty(
                        '--font',
                        SETTINGS_FONT_RESTORE['system']
                    );
                    root.style.setProperty('--ui-animations', '1');
                    root.style.setProperty('--ui-blur', '0');
                    document
                        .querySelectorAll<HTMLElement>('.overlay')
                        .forEach((el) => el.classList.remove('blur-bg'));
                    SetUIScale(1).catch(() => {});
                    SetUIPopupWidth(280).catch(() => {});
                    SetUIAccent('#4a6cf7').catch(() => {});
                    SetUIFontFamily('system').catch(() => {});
                    SetUIAnimations(true).catch(() => {});
                    SetUIBlurBg(false).catch(() => {});
                    getSettingsMenu()?.updateControls();
                    setStatus(t('settings.appearanceReset'), true);
                });
            });
        },
    };
}
