// [doc:architecture] Motion Physics Levels — 物理设置子页
// 从 motion-popup.ts 提取，独立管理全局物理参数

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { cardContainer, addSliderRow, addToggleRow } from '../core/ui-helpers';
import { getGravityStrength, setGravityStrength } from '../scene/env/env-bridge';
import {
    toggleCloth,
    getSolverSubsteps,
    setSolverSubsteps,
    getGroundCollisionEnabled,
    setGroundCollisionEnabled,
} from '../physics/cloth-manager';
import { buildClothParamsLevel } from './motion-cloth-levels';
import { getMotionMenu, refreshMotionRoot } from './motion-popup';

/** 构建物理设置子页 */
export function buildPhysicsLevel(): PopupLevel {
    return {
        label: '物理',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                // 全局重力
                addSliderRow(c, '重力强度', getGravityStrength(), 0, 2, 0.05,
                    (v) => {
                        setGravityStrength(v);
                        if (getMotionMenu()) getMotionMenu()?.reRender();
                    },
                    'lucide:arrow-down',
                );

                // 布料模拟总开关行
                const row = document.createElement('div');
                row.className = 'slide-row';
                row.style.cursor = 'pointer';

                const icon = document.createElement('iconify-icon');
                icon.setAttribute('icon', 'lucide:shirt');
                icon.className = 'menu-icon-svg';
                row.appendChild(icon);

                const label = document.createElement('span');
                label.className = 'slide-label';
                label.textContent = '布料模拟';
                row.appendChild(label);

                const sub = document.createElement('span');
                sub.className = 'slide-sub';
                sub.textContent = envState.clothEnabled ? '开启' : '关闭';
                row.appendChild(sub);

                // 头部开关
                const headerToggle = document.createElement('input');
                headerToggle.type = 'checkbox';
                headerToggle.checked = envState.clothEnabled;
                headerToggle.style.cssText = 'margin-left:auto;accent-color:var(--accent);';
                headerToggle.addEventListener('change', (e) => {
                    const v = (e.target as HTMLInputElement).checked;
                    envState.clothEnabled = v;
                    toggleCloth(v);
                    refreshMotionRoot();
                    if (getMotionMenu()) getMotionMenu()?.reRender();
                });
                row.appendChild(headerToggle);

                // 点击行打开布料参数子页
                row.addEventListener('click', (e) => {
                    if ((e.target as HTMLElement).tagName === 'INPUT') return;
                    const level = buildClothParamsLevel();
                    if (getMotionMenu()) getMotionMenu()?.push(level);
                });

                c.appendChild(row);

                // Solver 迭代次数
                addSliderRow(c, '求解迭代', getSolverSubsteps(), 1, 16, 1,
                    (v) => {
                        setSolverSubsteps(v);
                        if (getMotionMenu()) getMotionMenu()?.reRender();
                    },
                    'lucide:repeat',
                );

                // 地面碰撞
                addToggleRow(c, '地面碰撞', getGroundCollisionEnabled(),
                    (v) => {
                        setGroundCollisionEnabled(v);
                    },
                    'lucide:square',
                );
            });
        },
    };
}
