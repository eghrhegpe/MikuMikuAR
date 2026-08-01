// [doc:architecture] Env Experimental Level — 实验功能面板
// 从 env-feature-levels.ts 拆分

import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { PopupLevel } from '../core/config';
import { buildLevel } from './env-level-helpers';

/** 导出 experimental schema 供 menu-registry 静态分析（ADR-093 元测试） */
export function getExperimentalSchema(): MenuNode[] {
    return [
        {
            id: 'env:exp:warn',
            kind: 'custom',
            renderCustom: (cc) => {
                const warning = document.createElement('div');
                warning.className = 'experimental-warning';
                warning.innerHTML =
                    '<iconify-icon icon="lucide:alert-triangle" style="margin-right:6px;"></iconify-icon><span>' +
                    t('env.experimentalWarn') +
                    '</span>';
                cc.appendChild(warning);
            },
        },
    ];
}

export function buildExperimentalLevel(): PopupLevel {
    return buildLevel(t('env.experimental'), (c) => {
        return renderMenu(getExperimentalSchema(), c);
    });
}
