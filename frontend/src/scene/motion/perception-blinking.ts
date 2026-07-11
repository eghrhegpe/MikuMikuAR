// [doc:adr-071] 感知层 — 眨眼（morph 权重脉冲）

import { MORPH_BLINK_CANDIDATES, matchBone } from '../../motion-algos/proc-motion-shared';

// ── 眨眼参数 ──
const BLINK_FREQ = 0.15; // Hz

export function _applyBlinking(mmdModel: any, time: number): void {
    const phase = time * BLINK_FREQ * 2 * Math.PI;
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5;

    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) {
        return;
    }

    const morphNames = morphManager.getMorphTargetNames?.() || [];
    const blinkName = matchBone(morphNames, MORPH_BLINK_CANDIDATES);
    if (!blinkName) {
        return;
    }

    const eyeClose = morphManager.getMorphTargetByName?.(blinkName);
    if (eyeClose) {
        eyeClose.influence = blinkIntensity;
    }
}
