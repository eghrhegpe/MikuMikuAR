// [doc:architecture] Motion Gaze Levels — 视线追踪独立弹窗层级
// 与程序化动作解耦，独立文件责任分明

import { cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addToggleRow } from '../core/ui-helpers';
import {
    getProcMotionState,
    regenerateProcMotion,
} from '../scene/scene';
import {
    setProcMotionEyeTrackingEnabled,
    setProcMotionHeadTrackingEnabled,
    setProcMotionBoneToggle,
} from '../scene/motion/proc-motion-bridge';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t'; // [doc:adr-059]

export function buildGazeTrackingLevel(): PopupLevel {
    const st = getProcMotionState();
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
                        setProcMotionEyeTrackingEnabled(v);
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:eye',
                    {
                        bind: () => getProcMotionState().eyeTrackingEnabled,
                    }
                );
                addToggleRow(
                    c,
                    t('motion.headFollow'),
                    st.headTrackingEnabled,
                    (v) => {
                        setProcMotionHeadTrackingEnabled(v);
                        getMotionMenu()?.updateControls();
                    },
                    'lucide:mouse-pointer-2',
                    {
                        bind: () => getProcMotionState().headTrackingEnabled,
                    }
                );
            });
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.boneHead'),
                    st.boneToggles.head,
                    (v) => {
                        setProcMotionBoneToggle('head', v);
                        regenerateProcMotion();
                    },
                    'lucide:box-select',
                    {
                        bind: () => getProcMotionState().boneToggles.head,
                    }
                );
                addToggleRow(
                    c,
                    t('motion.boneBlink'),
                    st.boneToggles.blink,
                    (v) => {
                        setProcMotionBoneToggle('blink', v);
                        regenerateProcMotion();
                    },
                    'lucide:eye',
                    {
                        bind: () => getProcMotionState().boneToggles.blink,
                    }
                );
            });
        },
    };
}
