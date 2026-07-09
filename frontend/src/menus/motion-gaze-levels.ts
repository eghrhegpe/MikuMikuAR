// [doc:architecture] Motion Gaze Levels — 视线追踪独立弹窗层级
// [doc:adr-071] 感知层统一入口：眼部跟随 / 头部跟随 / 呼吸 / 眨眼
// 与程序化动作解耦，独立文件责任分明

import { cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addToggleRow } from '../core/ui-helpers';
import {
    getPerceptionState,
    setEyeTrackingEnabled,
    setHeadTrackingEnabled,
    setBreathEnabled,
    setBlinkEnabled,
    activatePerception,
} from '../scene/motion/perception';
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
        },
    };
}
