// [doc:architecture] Env Shadow Level — 阴影功能面板
// 从 env-feature-levels.ts 拆分

import { createIconifyIcon } from '../core/icons';
import { setStatus } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, buildPresetChipGroup } from '../core/ui-helpers';
import { t } from '../core/i18n/t';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel } from './env-level-helpers';

export function buildShadowLevel(): PopupLevel {
    return buildLevel(t('env.shadow'), (c) => {
        const shadowSchema: MenuNode[] = [
            {
                id: 'env:shadow:env',
                kind: 'folder',
                label: 'env.envShadow',
                icon: 'lucide:cloud',
                defaultOpen: true,
                children: [
                    {
                        id: 'env:shadow:type',
                        kind: 'modeSlider',
                        label: 'env.shadowType',
                        control: {
                            bind: 'light.shadowType',
                            options: [
                                { value: 'hard', label: t('env.hardShadow') },
                                { value: 'soft', label: t('env.softShadow') },
                                { value: 'pcf', label: t('env.pcf') },
                            ],
                        },
                        icon: 'lucide:cloud',
                    },
                    {
                        id: 'env:shadow:quality',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            buildPresetChipGroup(
                                cc,
                                [
                                    { label: t('env.low'), value: 512 },
                                    { label: t('env.medium'), value: 1024 },
                                    { label: t('env.high'), value: 2048 },
                                    { label: t('env.ultra'), value: 4096 },
                                ].map((sq) => ({
                                    label: sq.label,
                                    isActive: () => getLightState().shadowResolution === sq.value,
                                    onClick: () => setLightingState({ shadowResolution: sq.value }),
                                }))
                            );
                        },
                    },
                    {
                        id: 'env:shadow:bias',
                        kind: 'slider',
                        label: 'env.shadowBias',
                        control: {
                            bind: 'light.shadowBias',
                            min: 0,
                            max: 0.01,
                            step: 0.0001,
                        },
                        icon: 'lucide:move',
                    },
                    {
                        id: 'env:shadow:cascades',
                        kind: 'slider',
                        label: 'env.shadowCascades',
                        control: { bind: 'light.shadowCascades', min: 2, max: 4, step: 1 },
                        icon: 'lucide:layers',
                    },
                ],
            },
            {
                id: 'env:shadow:charHint',
                kind: 'custom',
                renderCustom: (cc) => {
                    const charRow = document.createElement('div');
                    charRow.className = 'slide-item';
                    charRow.style.opacity = '0.6';
                    charRow.style.cursor = 'default';
                    const ci = document.createElement('span');
                    ci.className = 'slide-icon';
                    const ce = createIconifyIcon('lucide:user');
                    if (ce) {
                        ci.appendChild(ce);
                    }
                    charRow.appendChild(ci);
                    const cl = document.createElement('span');
                    cl.className = 'slide-label';
                    cl.textContent = t('env.characterShadow');
                    charRow.appendChild(cl);
                    const cs = document.createElement('span');
                    cs.className = 'slide-sublabel';
                    cs.textContent = t('env.characterShadowHint');
                    charRow.appendChild(cs);
                    cc.appendChild(charRow);
                },
            },
            {
                id: 'env:shadow:stageHint',
                kind: 'custom',
                renderCustom: (cc) => {
                    slideRow(
                        cc,
                        'lucide:lightbulb',
                        t('env.stageLightShadow'),
                        false,
                        () => {
                            setStatus(t('env.shadowHint'), true);
                        },
                        '→ ' + t('env.sceneMenu')
                    );
                },
            },
        ];
        return renderMenu(shadowSchema, c);
    });
}
