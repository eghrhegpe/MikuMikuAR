// [doc:architecture] Env Fog Level — 雾功能面板
// 从 env-feature-levels.ts 拆分

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { buildLevel } from './env-level-helpers';

/** 导出 fog schema 供 menu-registry 静态分析（ADR-093 元测试） */
export function getFogSchema(): MenuNode[] {
    return [
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
}

export function buildFogLevel(): PopupLevel {
    return buildLevel(t('env.fog'), (c) => {
        return renderMenu(getFogSchema(), c);
    });
}
