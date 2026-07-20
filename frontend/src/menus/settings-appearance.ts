// settings-appearance.ts — 外观设置子菜单（ADR-093 schema 驱动）
// 状态源：CSS 变量 + Wails bindings（无法用 StatePath，故全 custom 节点）

import {
    SetUIScale,
    SetUIPopupWidth,
    SetUIFontFamily,
    SetUIAnimations,
    SetUIBlurBg,
    SetUIAccent,
} from '../core/wails-bindings';
import { setStatus, cardContainer } from '../core/config';
import { slideRow, addToggleRow, addSliderRow, addSectionTitle } from '../core/ui-helpers';
import { swallowError } from '../core/utils';
import { getCurrentRenderingMenu } from './menu';
import { t } from '../core/i18n/t';
import {
    setTheme,
    FONT_MAP,
    THEME_PRESETS,
    SETTINGS_FONT_RESTORE,
    type SettingsMenuHandle,
} from './settings-shared';
import type { PopupLevel } from '../core/config';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { getLang, setLang, SUPPORTED_LANGS } from '../core/i18n/locale';
import { AVAILABLE_LANGS } from '../core/i18n/t';

// ======== UI 尺寸控件（缩放 + 弹窗宽度） ========
function _renderUISizeControls(
    container: HTMLElement,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    const initialScale =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const initialWidth =
        parseInt(getComputedStyle(document.documentElement).getPropertyValue('--popup-width')) ||
        280;

    addSectionTitle(container, 'UI 尺寸');
    addSliderRow(
        container,
        t('settings.uiScale'),
        initialScale,
        0.8,
        1.3,
        0.05,
        (v) => {
            document.documentElement.style.setProperty('--ui-scale', String(v));
            swallowError(SetUIScale(v));
            getSettingsMenu()?.updateControls();
        },
        'lucide:maximize',
        undefined,
        {
            bind: () =>
                parseFloat(
                    getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
                ) || 1,
        }
    );
    addSliderRow(
        container,
        t('settings.popupWidth'),
        initialWidth,
        220,
        360,
        10,
        (v) => {
            document.documentElement.style.setProperty('--popup-width', v + 'px');
            swallowError(SetUIPopupWidth(v));
            getSettingsMenu()?.updateControls();
        },
        'lucide:sidebar',
        undefined,
        {
            bind: () =>
                parseInt(
                    getComputedStyle(document.documentElement).getPropertyValue('--popup-width')
                ) || 280,
        }
    );
}

// ======== 主题色预设列表 ========
function _renderThemePresetList(
    container: HTMLElement,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    const currentAccent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a6cf7';

    addSectionTitle(container, t('settings.themeColor'));
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
        container.appendChild(row);
        themeRows.push(row);
    }
    getCurrentRenderingMenu()?.registerControl(() => {
        const accent =
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
            '#4a6cf7';
        for (const row of themeRows) {
            const color = row.dataset.themeColor!;
            const isActive = accent.toLowerCase() === color.toLowerCase();
            row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
            const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
            if (icon) {
                icon.setAttribute('icon', `lucide:${isActive ? 'check-circle' : 'circle'}`);
            }
        }
    });
}

// ======== 主题色自定义输入（独立卡片） ========
function _renderThemeColorInput(
    container: HTMLElement,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    const currentAccent =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a6cf7';

    const card = document.createElement('div');
    card.className = 'card-container accent-input-card';
    card.style.cssText = 'display:flex;gap:6px;padding:8px 14px;align-items:center;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '#RRGGBB';
    input.className = 'tag-input';
    input.value = currentAccent;
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-sm btn-primary';
    applyBtn.textContent = t('common.apply');
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
    card.appendChild(input);
    card.appendChild(applyBtn);
    container.appendChild(card);
    getCurrentRenderingMenu()?.registerControl(() => {
        const accent =
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
            '#4a6cf7';
        input.value = accent;
    });
}

// ======== 字体控件 ========
function _renderFontControls(
    container: HTMLElement,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    const currentCss = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();

    addSectionTitle(container, t('settings.font'));
    const fontRows: HTMLElement[] = [];
    for (const [key, f] of Object.entries(FONT_MAP)) {
        const isActive = currentCss === f.css;
        const row = slideRow(
            container,
            `lucide:${isActive ? 'check' : 'circle'}`,
            f.label,
            false,
            () => {
                document.documentElement.style.setProperty('--font', f.css);
                swallowError(SetUIFontFamily(key));
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
            const icon = row.querySelector('.slide-icon iconify-icon') as HTMLElement | null;
            if (icon) {
                icon.setAttribute('icon', `lucide:${isActive ? 'check' : 'circle'}`);
            }
        }
    });
}

// ======== 动效控件（滑动动画 + 背景模糊） ========
function _renderAnimationControls(
    container: HTMLElement,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    const initialAnim =
        getComputedStyle(document.documentElement).getPropertyValue('--ui-animations').trim() !==
        '0';
    const initialBlur =
        getComputedStyle(document.documentElement).getPropertyValue('--ui-blur').trim() !== '0';

    addSectionTitle(container, '动效');
    addToggleRow(
        container,
        t('settings.slideAnimation'),
        initialAnim,
        (v) => {
            document.documentElement.style.setProperty('--ui-animations', v ? '1' : '0');
            swallowError(SetUIAnimations(v));
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
        container,
        t('settings.bgBlur'),
        initialBlur,
        (v) => {
            document.documentElement.style.setProperty('--ui-blur', v ? '1' : '0');
            document
                .querySelectorAll<HTMLElement>('.overlay')
                .forEach((el) => el.classList.toggle('blur-bg', v));
            swallowError(SetUIBlurBg(v));
            getSettingsMenu()?.updateControls();
        },
        'lucide:monitor',
        {
            bind: () =>
                getComputedStyle(document.documentElement).getPropertyValue('--ui-blur').trim() !==
                '0',
        }
    );
}

// ======== 恢复默认 ========
function _renderResetButton(
    container: HTMLElement,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    slideRow(container, 'lucide:rotate-ccw', t('settings.resetAppearance'), false, () => {
        const root = document.documentElement;
        root.style.setProperty('--ui-scale', '1');
        root.style.setProperty('--popup-width', '280px');
        root.style.setProperty('--accent', '#4a6cf7');
        root.style.setProperty('--accent-rgb', '74, 108, 247');
        root.style.setProperty('--accent-dim', 'rgba(74,108,247,0.2)');
        root.style.setProperty('--font', SETTINGS_FONT_RESTORE['system']);
        root.style.setProperty('--ui-animations', '1');
        root.style.setProperty('--ui-blur', '0');
        document
            .querySelectorAll<HTMLElement>('.overlay')
            .forEach((el) => el.classList.remove('blur-bg'));
        swallowError(SetUIScale(1));
        swallowError(SetUIPopupWidth(280));
        swallowError(SetUIAccent('#4a6cf7'));
        swallowError(SetUIFontFamily('system'));
        swallowError(SetUIAnimations(true));
        swallowError(SetUIBlurBg(false));
        getSettingsMenu()?.updateControls();
        setStatus(t('settings.appearanceReset'), true);
    });
}

// ======== Schema 定义 ========

function buildAppearanceSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：UI 尺寸（缩放 + 弹窗宽度）
        {
            id: 'appearance:size',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _renderUISizeControls(inner, getSettingsMenu);
                });
            },
        },
        // 卡片 2：主题色预设
        {
            id: 'appearance:theme-presets',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _renderThemePresetList(inner, getSettingsMenu);
                });
            },
        },
        // 卡片 3：主题色自定义输入（独立卡片，特殊样式）
        {
            id: 'appearance:theme-custom',
            kind: 'custom',
            renderCustom: (c) => {
                _renderThemeColorInput(c, getSettingsMenu);
            },
        },
        // 卡片 4：字体
        {
            id: 'appearance:font',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _renderFontControls(inner, getSettingsMenu);
                });
            },
        },
        // 卡片 5：动效（滑动动画 + 背景模糊）
        {
            id: 'appearance:anim',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _renderAnimationControls(inner, getSettingsMenu);
                });
            },
        },
        // 卡片 6：语言
        {
            id: 'appearance:language',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.language'));
                    const cur = getLang();
                    const langRows: HTMLElement[] = [];
                    for (const l of SUPPORTED_LANGS) {
                        if (!AVAILABLE_LANGS.includes(l.code)) {
                            continue;
                        }
                        const isActive = l.code === cur;
                        const row = slideRow(
                            inner,
                            `lucide:${isActive ? 'check' : 'circle'}`,
                            t(l.key),
                            false,
                            () => {
                                setLang(l.code);
                                getSettingsMenu()?.reRender();
                            },
                            undefined,
                            undefined,
                            isActive
                        );
                        row.dataset.langCode = l.code;
                        langRows.push(row);
                    }
                    getCurrentRenderingMenu()?.registerControl(() => {
                        const current = getLang();
                        for (const row of langRows) {
                            const code = row.dataset.langCode!;
                            const isActive = current === code;
                            row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                            const icon = row.querySelector(
                                '.slide-icon iconify-icon'
                            ) as HTMLElement | null;
                            if (icon) {
                                icon.setAttribute(
                                    'icon',
                                    `lucide:${isActive ? 'check' : 'circle'}`
                                );
                            }
                        }
                    });
                });
            },
        },
        // 卡片 7：恢复默认
        {
            id: 'appearance:reset',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _renderResetButton(inner, getSettingsMenu);
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildSettingsAppearanceLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.appearance'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildAppearanceSchema(getSettingsMenu), container);
        },
    };
}
