// [doc:adr-085] Feet Adjustment Levels — 脚部地面跟随 UI
// 职责: 按模型配置脚部贴地参数（Phase A: 启用/强度/脚底高度/跳跃阈值/双平滑/双倾角）
// 路由: motion-popup.ts → motionOnFolderEnter → 'motion:feet'
// 持久化: 直接写 ModelInstance.feet，引擎钩子 (feet-adjustment.ts) 每帧读取

import {
    setStatus,
    PopupLevel,
    cardContainer,
    modelRegistry,
    focusedModelId,
    triggerAutoSave,
} from '../core/config';
import { addToggleRow, addSliderRow, addEmptyRow } from '../core/ui-helpers';
import { getMotionMenu } from './motion-popup';
import { t } from '../core/i18n/t';

export function buildFeetLevel(): PopupLevel {
    return {
        label: t('motion.feet.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const modelId = focusedModelId;
            if (!modelId) {
                addEmptyRow(container, t('motion.feet.noModel'));
                return;
            }
            const inst = modelRegistry.get(modelId);
            if (!inst?.mmdModel) {
                addEmptyRow(container, t('motion.feet.noModel'));
                return;
            }
            const feet = inst.feet;
            const menu = getMotionMenu();

            const persist = (): void => {
                triggerAutoSave();
            };

            // —— 卡片 1：总开关 + 强度 ——
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.feet.enable'),
                    feet.enabled,
                    (v) => {
                        feet.enabled = v;
                        setStatus(
                            v
                                ? t('motion.feet.enabled')
                                : t('motion.feet.disabled'),
                            true
                        );
                        persist();
                        menu?.reRender();
                    },
                    'lucide:footprints',
                    { bind: () => inst.feet.enabled }
                );

                addSliderRow(
                    c,
                    t('motion.feet.intensity'),
                    feet.intensity,
                    0,
                    1,
                    0.05,
                    (v) => {
                        feet.intensity = v;
                        persist();
                    },
                    'lucide:gauge',
                    undefined,
                    { bind: () => inst.feet.intensity }
                );
            });

            // —— 卡片 2：脚部贴地参数 ——
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText =
                    'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = t('motion.feet.grounding');
                c.appendChild(title);

                addSliderRow(
                    c,
                    t('motion.feet.soleHeight'),
                    feet.soleHeight,
                    -0.1,
                    0.1,
                    0.01,
                    (v) => {
                        feet.soleHeight = v;
                        persist();
                    },
                    'lucide:ruler',
                    undefined,
                    { bind: () => inst.feet.soleHeight }
                );

                addSliderRow(
                    c,
                    t('motion.feet.jumpThreshold'),
                    feet.jumpThreshold,
                    0.1,
                    2,
                    0.05,
                    (v) => {
                        feet.jumpThreshold = v;
                        persist();
                    },
                    'lucide:arrow-up-from-line',
                    undefined,
                    { bind: () => inst.feet.jumpThreshold }
                );

                addSliderRow(
                    c,
                    t('motion.feet.bodySmooth'),
                    feet.bodySmooth,
                    0,
                    1,
                    0.05,
                    (v) => {
                        feet.bodySmooth = v;
                        persist();
                    },
                    'lucide:waves',
                    undefined,
                    { bind: () => inst.feet.bodySmooth }
                );

                addSliderRow(
                    c,
                    t('motion.feet.footSmooth'),
                    feet.footSmooth,
                    0,
                    1,
                    0.05,
                    (v) => {
                        feet.footSmooth = v;
                        persist();
                    },
                    'lucide:wind',
                    undefined,
                    { bind: () => inst.feet.footSmooth }
                );

                addSliderRow(
                    c,
                    t('motion.feet.maxAngle'),
                    feet.maxAngle,
                    0,
                    60,
                    1,
                    (v) => {
                        feet.maxAngle = v;
                        persist();
                    },
                    'lucide:angle',
                    undefined,
                    { bind: () => inst.feet.maxAngle }
                );

                addSliderRow(
                    c,
                    t('motion.feet.reachAngle'),
                    feet.reachAngle,
                    0,
                    45,
                    1,
                    (v) => {
                        feet.reachAngle = v;
                        persist();
                    },
                    'lucide:move-vertical',
                    undefined,
                    { bind: () => inst.feet.reachAngle }
                );
            });
        },
    };
}
