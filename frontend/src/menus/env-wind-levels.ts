// [doc:architecture] Env Wind Level — 风功能面板
// 从 env-feature-levels.ts 拆分

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel } from './env-level-helpers';

export function buildWindLevel(): PopupLevel {
    return _buildLevel(t('env.wind'), (c) => {
        const windSchema: MenuNode[] = [
            {
                id: 'env:wind:angle',
                kind: 'slider',
                label: 'env.windAngle',
                control: {
                    bind: 'env.windDirection',
                    min: 0,
                    max: 360,
                    step: 1,
                    get: (v) => {
                        const d = v as [number, number, number];
                        return ((Math.atan2(d[0], d[2]) * 180) / Math.PI + 360) % 360;
                    },
                    set: (angle) => {
                        const rad = ((angle as number) * Math.PI) / 180;
                        return [Math.sin(rad), envState.windDirection[1], Math.cos(rad)];
                    },
                },
                icon: 'lucide:compass',
            },
            {
                id: 'env:wind:speed',
                kind: 'slider',
                label: 'env.windSpeed',
                control: { bind: 'env.windSpeed', min: 0, max: 10, step: 0.1 },
                icon: 'lucide:gauge',
            },
        ];
        return renderMenu(windSchema, c);
    });
}
