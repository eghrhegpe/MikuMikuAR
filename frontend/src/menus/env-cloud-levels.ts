// [doc:architecture] Env Cloud Level — 云功能面板
// 从 env-feature-levels.ts 拆分

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { setEnvState } from '../scene/scene';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel } from './env-level-helpers';

export function buildCloudLevel(): PopupLevel {
    return _buildLevel(t('env.cloud'), (c) => {
        const cloudSchema: MenuNode[] = [
            {
                id: 'env:cloud:cover',
                kind: 'slider',
                label: 'env.cloudCover',
                control: { bind: 'env.cloudCover', min: 0, max: 1, step: 0.01 },
                icon: 'lucide:cloud',
            },
            {
                id: 'env:cloud:gap',
                kind: 'slider',
                label: 'env.cloudGap',
                control: {
                    bind: 'env.cloudGap',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.1,
                },
                icon: 'lucide:columns',
            },
            {
                id: 'env:cloud:sectionDetail',
                kind: 'sectionTitle',
                label: 'env.cloudDetail',
            },
            {
                id: 'env:cloud:erosion',
                kind: 'slider',
                label: 'env.cloudErosion',
                control: {
                    bind: 'env.cloudErosion',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.4,
                },
                icon: 'lucide:wind',
            },
            {
                id: 'env:cloud:weather',
                kind: 'slider',
                label: 'env.cloudWeatherStrength',
                control: {
                    bind: 'env.cloudWeatherStrength',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.6,
                },
                icon: 'lucide:cloud-sun',
            },
            {
                id: 'env:cloud:height',
                kind: 'slider',
                label: 'env.height',
                control: { bind: 'env.cloudHeight', min: 50, max: 3000, step: 5 },
                icon: 'lucide:arrow-up',
            },
            {
                id: 'env:cloud:scale',
                kind: 'slider',
                label: 'env.scale',
                control: { bind: 'env.cloudScale', min: 0.1, max: 1, step: 0.05 },
                icon: 'lucide:maximize',
            },
            {
                id: 'env:cloud:thickness',
                kind: 'slider',
                label: 'env.thickness',
                control: {
                    bind: 'env.cloudThickness',
                    min: 10,
                    max: 200,
                    step: 1,
                    get: (v) => (v as number) ?? 60,
                },
                icon: 'lucide:move-vertical',
            },
            {
                id: 'env:cloud:visibility',
                kind: 'slider',
                label: 'env.visibility',
                control: {
                    bind: 'env.cloudVisibility',
                    min: 500,
                    max: 12000,
                    step: 100,
                    get: (v) => (v as number) ?? 8000,
                },
                icon: 'lucide:eye',
            },
            {
                id: 'env:cloud:sectionLighting',
                kind: 'sectionTitle',
                label: 'env.cloudLighting',
            },
            {
                id: 'env:cloud:backlight',
                kind: 'slider',
                label: 'env.cloudBacklight',
                control: {
                    bind: 'env.cloudBacklight',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.5,
                },
                icon: 'lucide:sun',
            },
            {
                id: 'env:cloud:powder',
                kind: 'slider',
                label: 'env.cloudPowder',
                control: {
                    bind: 'env.cloudPowder',
                    min: 0,
                    max: 2,
                    step: 0.05,
                    get: (v) => (v as number) ?? 0.8,
                },
                icon: 'lucide:snowflake',
            },
        ];
        renderMenu(cloudSchema, c);
    });
}
