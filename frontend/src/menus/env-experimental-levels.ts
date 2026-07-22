// [doc:architecture] Env Experimental Level — 实验功能面板
// 从 env-feature-levels.ts 拆分

import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { PopupLevel } from '../core/config';
import { _buildLevel } from './env-level-helpers';

export function buildExperimentalLevel(): PopupLevel {
    return _buildLevel(t('env.experimental'), (c) => {
        const expSchema: MenuNode[] = [
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
        return renderMenu(expSchema, c);
    });
}
