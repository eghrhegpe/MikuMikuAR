// [doc:architecture] Motion Gaze Levels — 视线追踪独立弹窗层级
// [doc:adr-071] 感知层统一入口：眼部跟随 / 头部跟随 / 呼吸 / 眨眼
// 与程序化动作解耦，独立文件责任分明

import { cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addToggleRow, addSliderRow, addModeRow } from '../core/ui-helpers';
import {
    getPerceptionState,
    setEyeTrackingEnabled,
    setHeadTrackingEnabled,
    setBreathEnabled,
    setBlinkEnabled,
    setMicroExpressionEnabled,
    setEmotion,
    setBalanceSwayEnabled,
    setLipSyncEnabled,
    setLipSyncSensitivity,
    setLipSyncIntensity,
    setLipSyncMultiMorphEnabled,
    activatePerception,
} from '../scene/motion/perception';
import type { Emotion } from '../scene/motion/perception';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t'; // [doc:adr-059]

export function buildGazeTrackingLevel(): PopupLevel {
    const st = getPerceptionState();
    return {
        label: t('motion.gazeTracking'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.eyeFollow'),
                    st.eyeTrackingEnabled,
                    (v) => {
                        setEyeTrackingEnabled(v);
                        activatePerception();
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:eye',
                    {
                        bind: () => getPerceptionState().eyeTrackingEnabled,
                    }
                );
                addToggleRow(
                    c,
                    t('motion.headFollow'),
                    st.headTrackingEnabled,
                    (v) => {
                        setHeadTrackingEnabled(v);
                        activatePerception();
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:mouse-pointer-2',
                    {
                        bind: () => getPerceptionState().headTrackingEnabled,
                    }
                );
            });
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.perceptionBreath'),
                    st.breathEnabled,
                    (v) => {
                        setBreathEnabled(v);
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:wind',
                    {
                        bind: () => getPerceptionState().breathEnabled,
                    }
                );
                addToggleRow(
                    c,
                    t('motion.perceptionBlink'),
                    st.blinkEnabled,
                    (v) => {
                        setBlinkEnabled(v);
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:eye',
                    {
                        bind: () => getPerceptionState().blinkEnabled,
                    }
                );
            });
            // 微表情 + 情绪选择
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.microExpression'),
                    st.microExpressionEnabled,
                    (v) => {
                        setMicroExpressionEnabled(v);
                        activatePerception();
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:smile',
                    {
                        bind: () => getPerceptionState().microExpressionEnabled,
                    }
                );
                const emotionOptions: Array<{ value: Emotion; label: string }> = [
                    { value: 'neutral', label: t('motion.emotionNeutral') },
                    { value: 'happy', label: t('motion.emotionHappy') },
                    { value: 'sad', label: t('motion.emotionSad') },
                    { value: 'surprised', label: t('motion.emotionSurprised') },
                    { value: 'angry', label: t('motion.emotionAngry') },
                ];
                addModeRow<Emotion>(
                    c,
                    t('motion.emotion'),
                    emotionOptions,
                    getPerceptionState().emotion,
                    (v) => {
                        setEmotion(v);
                        activatePerception();
                        getMotionMenu()?.updateControls();
                    }
                );
            });
            // 重心微动（躯干骨骼平衡微晃）
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.balanceSway'),
                    st.balanceSwayEnabled,
                    (v) => {
                        setBalanceSwayEnabled(v);
                        activatePerception();
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:activity',
                    {
                        bind: () => getPerceptionState().balanceSwayEnabled,
                    }
                );
            });
            // Lip-sync（口型同步）
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.lipSync'),
                    getPerceptionState().lipSyncEnabled,
                    (v) => {
                        setLipSyncEnabled(v);
                        activatePerception();
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:mic',
                    {
                        bind: () => getPerceptionState().lipSyncEnabled,
                    }
                );
                // 灵敏度/强度滑块 + 多口型开关仅在 lip-sync 开启时显示
                if (getPerceptionState().lipSyncEnabled) {
                    addSliderRow(
                        c,
                        t('motion.lipSyncSensitivity'),
                        getPerceptionState().lipSyncSensitivity,
                        0,
                        1,
                        0.01,
                        (v) => {
                            setLipSyncSensitivity(v);
                            getMotionMenu()?.updateControls();
                        }
                    );
                    addSliderRow(
                        c,
                        t('motion.lipSyncIntensity'),
                        getPerceptionState().lipSyncIntensity,
                        0,
                        1,
                        0.01,
                        (v) => {
                            setLipSyncIntensity(v);
                            getMotionMenu()?.updateControls();
                        }
                    );
                    addToggleRow(
                        c,
                        t('motion.lipSyncMultiMorph'),
                        getPerceptionState().lipSyncMultiMorphEnabled,
                        (v) => {
                            setLipSyncMultiMorphEnabled(v);
                            getMotionMenu()?.updateControls();
                        }
                    );
                }
            });
        },
    };
}
