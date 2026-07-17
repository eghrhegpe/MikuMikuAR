// [doc:adr-071] 感知层 — 眨眼（morph 权重脉冲）

import { MORPH_BLINK_CANDIDATES, matchBone } from '../../motion-algos/proc-motion-shared';
import type { MmdModelLike } from './perception-shared';
import { getPerceptionState } from './perception';

// ── 眨眼参数（默认值，实际从 perceptionState 读取） ──
const DEFAULT_BLINK_FREQ = 0.15; // Hz

export function _applyBlinking(mmdModel: MmdModelLike, time: number): void {
    const s = getPerceptionState();
    const freq = s.blinkFrequency ?? DEFAULT_BLINK_FREQ;
    const phase = time * freq * 2 * Math.PI;
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5;

    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) {
        return;
    }

    // Babylon.js MorphTargetManager API: getTargetByName / numTargets + getTarget(i)
    const morphNames: string[] = [];
    for (let i = 0; i < morphManager.numTargets; i++) {
        morphNames.push(morphManager.getTarget(i).name);
    }
    const blinkName = matchBone(morphNames, MORPH_BLINK_CANDIDATES);
    if (!blinkName) {
        return;
    }

    const eyeClose = morphManager.getTargetByName(blinkName);
    if (eyeClose) {
        eyeClose.influence = blinkIntensity;
    }
}
