// [doc:architecture] Env Fog Level — 雾功能面板
// 从 env-feature-levels.ts 拆分

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel } from './env-level-helpers';

export function buildFogLevel(): PopupLevel {
    return _buildLevel(t('env.fog'), (c) => {
        const fogSchema: MenuNode[] = [
            {
                id: 'env:fog:mode',
                kind: 'modeSlider',
                label: 'env.fogMode',
                control: {
                    bind: 'env.fogMode',
                    options: [
                        { value: 'exp2', label: t('env.exp2') },
                        { value: 'exp', label: t('env.exp') },
                        { value: 'linear', label: t('env.linear') },
                    ],
                },
                icon: 'lucide:layers',
            },
            {
                id: 'env:fog:color',
                kind: 'colorSlider',
                label: 'env.fogColor',
                control: { bind: 'env.fogColor' },
            },
            {
                id: 'env:fog:density',
                kind: 'slider',
                label: 'env.fogDensity',
                control: { bind: 'env.fogDensity', min: 0, max: 0.1, step: 0.001 },
                icon: 'lucide:droplets',
                visibleWhen: () => envState.fogMode !== 'linear',
            },
            {
                id: 'env:fog:start',
                kind: 'slider',
                label: 'env.fogStart',
                control: {
                    bind: 'env.fogStart',
                    min: 0,
                    max: 200,
                    step: 1,
                    get: (v) => (v as number) ?? 10,
                },
                visibleWhen: () => envState.fogMode === 'linear',
            },
            {
                id: 'env:fog:end',
                kind: 'slider',
                label: 'env.fogEnd',
                control: {
                    bind: 'env.fogEnd',
                    min: 0,
                    max: 200,
                    step: 1,
                    get: (v) => (v as number) ?? 100,
                },
                visibleWhen: () => envState.fogMode === 'linear',
            },
        ];
        return renderMenu(fogSchema, c);
    });
}
