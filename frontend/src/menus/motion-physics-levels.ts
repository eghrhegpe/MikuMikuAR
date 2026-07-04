// [doc:architecture] Motion Physics Levels — 物理设置子页
// 从 motion-popup.ts 提取，独立管理全局物理参数

import type { PopupLevel, PopupRow } from '../core/config';
import { envState } from '../core/config';
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
    const reRender = () => { if (getMotionMenu()) getMotionMenu()?.reRender(); };

    return {
        label: '物理',
        dir: '',
        items: [
            // 布料模拟：folder + headerToggle（开关内嵌在行右侧）
            {
                kind: 'folder',
                label: '布料模拟',
                icon: 'lucide:shirt',
                target: 'physics:cloth',
                headerToggle: {
                    value: envState.clothEnabled,
                    onChange: (v: boolean) => {
                        envState.clothEnabled = v;
                        toggleCloth(v);
                        refreshMotionRoot();
                        reRender();
                    },
                },
            } as PopupRow,
            // 重力强度
            {
                kind: 'slider',
                label: '重力强度',
                icon: 'lucide:arrow-down',
                target: 'physics:gravity',
                sliderValue: getGravityStrength(),
                sliderMin: 0,
                sliderMax: 2,
                sliderStep: 0.05,
                onSliderChange: (v: number) => {
                    setGravityStrength(v);
                    reRender();
                },
            } as PopupRow,
            // 求解迭代次数
            {
                kind: 'slider',
                label: '求解迭代',
                icon: 'lucide:repeat',
                target: 'physics:substeps',
                sliderValue: getSolverSubsteps(),
                sliderMin: 1,
                sliderMax: 16,
                sliderStep: 1,
                onSliderChange: (v: number) => {
                    setSolverSubsteps(v);
                    reRender();
                },
            } as PopupRow,
            // 地面碰撞
            {
                kind: 'toggle',
                label: '地面碰撞',
                icon: 'lucide:square',
                target: 'physics:ground',
                toggleValue: getGroundCollisionEnabled(),
                onToggleChange: (v: boolean) => {
                    setGroundCollisionEnabled(v);
                },
            } as PopupRow,
        ],
        onFolderEnter: (row: PopupRow) => {
            if (row.target === 'physics:cloth') return buildClothParamsLevel();
            return null;
        },
    };
}
