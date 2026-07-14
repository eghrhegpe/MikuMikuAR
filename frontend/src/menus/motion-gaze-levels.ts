// [doc:architecture] Motion Perception Levels — 感知表现独立弹窗层级（ADR-093 schema 驱动）
// [doc:adr-071] 感知层统一入口：眼部跟随 / 头部跟随 / 呼吸 / 眨眼
// 与程序化动作解耦，独立文件责任分明

import { cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import { getPerceptionState, activatePerception } from '../scene/motion/perception';
import { triggerAutoSave } from '../core/utils';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function refreshMotionMenu(): void {
    getMotionMenu()?.updateControls();
}

function withActivate(_v: unknown): void {
    activatePerception();
    triggerAutoSave();
    refreshMotionMenu();
}

function withSaveOnly(_v: unknown): void {
    triggerAutoSave();
    refreshMotionMenu();
}

const gazeSchema: MenuNode[] = [
    {
        id: 'perception:eyeFollow',
        kind: 'toggle',
        label: 'motion.eyeFollow',
        control: { bind: 'perception.eyeTrackingEnabled', onChange: withActivate },
        icon: 'lucide:eye',
    },
    {
        id: 'perception:headFollow',
        kind: 'toggle',
        label: 'motion.headFollow',
        control: { bind: 'perception.headTrackingEnabled', onChange: withActivate },
        icon: 'lucide:mouse-pointer-2',
    },
    {
        id: 'perception:breath',
        kind: 'toggle',
        label: 'motion.perceptionBreath',
        control: { bind: 'perception.breathEnabled', onChange: withSaveOnly },
        icon: 'lucide:wind',
    },
    {
        id: 'perception:blink',
        kind: 'toggle',
        label: 'motion.perceptionBlink',
        control: { bind: 'perception.blinkEnabled', onChange: withSaveOnly },
        icon: 'lucide:eye',
    },
    {
        id: 'perception:microExpr',
        kind: 'toggle',
        label: 'motion.microExpression',
        control: { bind: 'perception.microExpressionEnabled', onChange: withActivate },
        icon: 'lucide:smile',
    },
    {
        id: 'perception:emotion',
        kind: 'modeRow',
        label: 'motion.emotion',
        control: {
            bind: 'perception.emotion',
            onChange: withActivate,
            options: [
                { value: 'neutral', label: 'motion.emotionNeutral' },
                { value: 'happy', label: 'motion.emotionHappy' },
                { value: 'sad', label: 'motion.emotionSad' },
                { value: 'surprised', label: 'motion.emotionSurprised' },
                { value: 'angry', label: 'motion.emotionAngry' },
            ],
        },
    },
    {
        id: 'perception:balanceSway',
        kind: 'toggle',
        label: 'motion.balanceSway',
        control: { bind: 'perception.balanceSwayEnabled', onChange: withActivate },
        icon: 'lucide:activity',
    },
    {
        id: 'perception:lipsync',
        kind: 'folder',
        label: 'motion.lipSync',
        icon: 'lucide:mic',
        defaultOpen: true,
        children: [
            {
                id: 'perception:lipSyncToggle',
                kind: 'toggle',
                label: 'motion.lipSync',
                control: { bind: 'perception.lipSyncEnabled', onChange: withActivate },
                icon: 'lucide:mic',
            },
            {
                id: 'perception:lipSyncSens',
                kind: 'slider',
                label: 'motion.lipSyncSensitivity',
                control: {
                    bind: 'perception.lipSyncSensitivity',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    onChange: withSaveOnly,
                },
                visibleWhen: () => getPerceptionState().lipSyncEnabled,
            },
            {
                id: 'perception:lipSyncInt',
                kind: 'slider',
                label: 'motion.lipSyncIntensity',
                control: {
                    bind: 'perception.lipSyncIntensity',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    onChange: withSaveOnly,
                },
                visibleWhen: () => getPerceptionState().lipSyncEnabled,
            },
            {
                id: 'perception:lipSyncMulti',
                kind: 'toggle',
                label: 'motion.lipSyncMultiMorph',
                control: { bind: 'perception.lipSyncMultiMorphEnabled', onChange: withSaveOnly },
                visibleWhen: () => getPerceptionState().lipSyncEnabled,
            },
        ],
    },
];

export function buildGazeTrackingLevel(): PopupLevel {
    return {
        label: t('motion.gazeTracking'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                renderMenu(gazeSchema, c);
            });
        },
    };
}
