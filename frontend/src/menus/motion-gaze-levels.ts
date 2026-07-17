// [doc:architecture] Motion Perception Levels — 感知表现独立弹窗层级（ADR-093 schema 驱动）
// [doc:adr-071] 感知层统一入口：眼部跟随 / 头部跟随 / 呼吸 / 眨眼
// 与程序化动作解耦，独立文件责任分明
// 开关合并至 folder headerToggle（参考 env-menu 模式）

import { cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import { getPerceptionState, activatePerception } from '../scene/motion/perception';
import { triggerAutoSave } from '../core/utils';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function refreshMotionMenu(): void {
    getMotionMenu()?.reRender();
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
    // ── 头部跟随：开关在 header，参数在 folder 内 ──
    {
        id: 'perception:headFollow',
        kind: 'folder',
        label: 'motion.headFollow',
        icon: 'lucide:mouse-pointer-2',
        headerToggle: { bind: 'perception.headTrackingEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:headYawRange',
                kind: 'slider',
                label: 'perception.headYawRange',
                control: {
                    bind: 'perception.headGazeMaxYaw',
                    min: 0,
                    max: 90,
                    step: 1,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:headPitchRange',
                kind: 'slider',
                label: 'perception.headPitchRange',
                control: {
                    bind: 'perception.headGazeMaxPitch',
                    min: 0,
                    max: 90,
                    step: 1,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 眼部跟随 ──
    {
        id: 'perception:eyeFollow',
        kind: 'folder',
        label: 'motion.eyeFollow',
        icon: 'lucide:eye',
        headerToggle: { bind: 'perception.eyeTrackingEnabled', onChange: withActivate },
        children: [
            {
                id: 'perception:eyeYawRange',
                kind: 'slider',
                label: 'perception.eyeYawRange',
                control: {
                    bind: 'perception.eyeGazeMaxYaw',
                    min: 0,
                    max: 15,
                    step: 0.5,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:eyePitchRange',
                kind: 'slider',
                label: 'perception.eyePitchRange',
                control: {
                    bind: 'perception.eyeGazeMaxPitch',
                    min: 0,
                    max: 15,
                    step: 0.5,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:eyeSmooth',
                kind: 'slider',
                label: 'perception.eyeSmooth',
                control: {
                    bind: 'perception.eyeGazeSmooth',
                    min: 0,
                    max: 1,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 呼吸 ──
    {
        id: 'perception:breath',
        kind: 'folder',
        label: 'motion.perceptionBreath',
        icon: 'lucide:wind',
        headerToggle: { bind: 'perception.breathEnabled', onChange: withSaveOnly },
        children: [
            {
                id: 'perception:breathFreq',
                kind: 'slider',
                label: 'perception.breathFreq',
                control: {
                    bind: 'perception.breathFrequency',
                    min: 0.1,
                    max: 1.0,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:breathAmp',
                kind: 'slider',
                label: 'perception.breathAmp',
                control: {
                    bind: 'perception.breathAmplitude',
                    min: 0,
                    max: 0.05,
                    step: 0.005,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 眨眼 ──
    {
        id: 'perception:blink',
        kind: 'folder',
        label: 'motion.perceptionBlink',
        icon: 'lucide:eye',
        headerToggle: { bind: 'perception.blinkEnabled', onChange: withSaveOnly },
        children: [
            {
                id: 'perception:blinkFreq',
                kind: 'slider',
                label: 'perception.blinkFreq',
                control: {
                    bind: 'perception.blinkFrequency',
                    min: 0.05,
                    max: 0.5,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
            {
                id: 'perception:blinkAmp',
                kind: 'slider',
                label: 'perception.blinkAmp',
                control: {
                    bind: 'perception.blinkAmplitude',
                    min: 0,
                    max: 1,
                    step: 0.05,
                    onChange: withActivate,
                },
            },
        ],
    },
    // ── 微表情（无参数，独立 toggle） ──
    {
        id: 'perception:microExpr',
        kind: 'toggle',
        label: 'motion.microExpression',
        control: { bind: 'perception.microExpressionEnabled', onChange: withActivate },
        icon: 'lucide:smile',
    },
    // ── 情绪选择 ──
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
    // ── Lip-sync（已有 headerToggle 模式） ──
    {
        id: 'perception:lipsync',
        kind: 'folder',
        label: 'motion.lipSync',
        icon: 'lucide:mic',
        headerToggle: { bind: 'perception.lipSyncEnabled', onChange: withActivate },
        children: [
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
            },
            {
                id: 'perception:lipSyncMulti',
                kind: 'toggle',
                label: 'motion.lipSyncMultiMorph',
                control: { bind: 'perception.lipSyncMultiMorphEnabled', onChange: withSaveOnly },
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
