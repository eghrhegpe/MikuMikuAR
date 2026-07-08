// settings-language.ts — 语言设置子菜单

import type { PopupLevel, PopupRow } from '../core/config';
import { t, AVAILABLE_LANGS } from '../core/i18n/t';
import { getLang, SUPPORTED_LANGS, type LangCode } from '../core/i18n/locale';

export function buildSettingsLanguageLevel(): PopupLevel {
    const cur = getLang();
    const items: PopupRow[] = SUPPORTED_LANGS.filter((l) => AVAILABLE_LANGS.includes(l.code)).map((l) => ({
        kind: 'action' as const,
        label: t(l.key),
        icon: l.code === cur ? 'lucide:check' : '',
        target: `lang:${l.code}`,
    }));
    return {
        label: t('settings.language'),
        dir: '',
        items,
    };
}
