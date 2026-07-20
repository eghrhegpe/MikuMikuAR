// [doc:adr-071] 感知层 — 眨眼（morph 权重脉冲）
//
// 防覆盖策略：
//   1. amp=0 时 early return（避免每帧 influence=0 覆盖 VMD 半眨眼关键帧）
//   2. 与既有 morph influence 取 max（眨眼优先：感知层眨眼触发时压过 VMD 表演）
//   3. 关闭时清零 morph（防残留冻结）

import { MORPH_BLINK_CANDIDATES, matchBone } from '../../motion-algos/proc-motion-shared';
import type { MmdModelLike } from './perception-shared';
import { getPerceptionState } from './perception';

// ── 眨眼参数（默认值，实际从 perceptionState 读取） ──
// 生理上人每 2-4 秒眨一次眼，对应 0.25-0.5 Hz，默认取下界 0.25
const DEFAULT_BLINK_FREQ = 0.25; // Hz
const DEFAULT_BLINK_AMP = 1.0; // 眨眼力度系数

export function _applyBlinking(mmdModel: MmdModelLike, time: number): void {
    const s = getPerceptionState();
    const freq = s.blinkFrequency ?? DEFAULT_BLINK_FREQ;
    const amp = s.blinkAmplitude ?? DEFAULT_BLINK_AMP;
    // amp=0 时跳过：避免每帧 influence=0 覆盖 VMD 半眨眼 / 情绪眨眼关键帧
    if (amp <= 0) {
        return;
    }

    const phase = time * freq * 2 * Math.PI;
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5 * amp;

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
        // 与既有 influence 取 max（眨眼优先）：
        //   - VMD 中的半眨眼（如 0.3）会被感知层全眨眼（1.0）覆盖
        //   - VMD 中的非眨眼表情（如 0.0）不会受感知层 idle 眨眼影响（取 max）
        eyeClose.influence = Math.max(eyeClose.influence, blinkIntensity);
    }
}
