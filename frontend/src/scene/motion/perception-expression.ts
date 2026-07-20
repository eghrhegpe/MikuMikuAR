// [doc:adr-079] 感知层 — 微表情（情绪 morph 实时脉冲）

import { matchBone } from '../../motion-algos/proc-motion-shared';
import type { Emotion, MmdModelLike } from './perception-shared';

/** 情绪 → morph 名候选（按优先级降序匹配，复用 matchBone） */
const EMOTION_MORPH_CANDIDATES: Record<Exclude<Emotion, 'neutral'>, string[]> = {
    happy: ['笑み', 'Smile', 'smile', 'にっこり', 'Happy'],
    // 「困り」语义为「困扰/为难」非「悲伤」，已修正为悲伤系候选
    // （与 proc-motion-autodance-emotion.ts 的 sad 候选保持一致）
    sad: ['悲しみ', 'sad', 'cry', '泣き', '哀しみ', 'Sad', '悲しい'],
    surprised: ['驚き', 'Surprised', 'surprised', 'びっくり', 'Surprise'],
    angry: ['怒り', 'Angry', 'angry', '怒', 'Angry2'],
};

/** 微表情脉冲周期（秒） */
const MICRO_EXPR_PERIOD = 4.0;
/** 微表情脉冲峰值权重 */
const MICRO_EXPR_PEAK = 0.12;

/** 上次写入的 morph 名（用于关闭/切换情绪时复位，防止残留冻结） */
let _lastEmotionMorphName: string | null = null;

/** 内部 setter（供 perception.ts 在 deactivate/reset 时调用） */
export function _resetLastEmotionMorphName(): void {
    _lastEmotionMorphName = null;
}

export function _applyMicroExpression(
    mmdModel: MmdModelLike,
    time: number,
    enabled: boolean,
    emotion: Emotion
): void {
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) {
        return;
    }

    // 关闭或 neutral：复位上次 morph 并退出（防止非零权重定格）
    if (!enabled || emotion === 'neutral') {
        if (_lastEmotionMorphName) {
            const old = morphManager.getTargetByName(_lastEmotionMorphName);
            if (old) {
                old.influence = 0;
            }
            _lastEmotionMorphName = null;
        }
        return;
    }

    const candidates = EMOTION_MORPH_CANDIDATES[emotion];
    if (!candidates || candidates.length === 0) {
        return;
    }

    // 复用 matchBone 匹配候选 morph 名（与 _applyBlinking 同款模式）
    const morphNames: string[] = [];
    for (let i = 0; i < morphManager.numTargets; i++) {
        morphNames.push(morphManager.getTarget(i).name);
    }
    const targetName = matchBone(morphNames, candidates);
    if (!targetName) {
        return;
    }

    const targetMorph = morphManager.getTargetByName(targetName);
    if (!targetMorph) {
        return;
    }

    // 情绪切换时复位旧 morph（如 happy→angry，清零笑み防串味）
    if (_lastEmotionMorphName && _lastEmotionMorphName !== targetName) {
        const old = morphManager.getTargetByName(_lastEmotionMorphName);
        if (old) {
            old.influence = 0;
        }
    }

    // 周期性脉冲：sin²(t * 2π / period) 在 [0,1] 间振荡，乘以峰值权重
    const phase = (time % MICRO_EXPR_PERIOD) / MICRO_EXPR_PERIOD; // [0,1)
    const pulse = Math.sin(phase * Math.PI * 2) ** 2; // [0,1]
    const weight = pulse * MICRO_EXPR_PEAK;

    // 写入 morph 权重（与 _applyBlinking 的 influence 赋值一致）
    targetMorph.influence = weight;
    _lastEmotionMorphName = targetName;
}
