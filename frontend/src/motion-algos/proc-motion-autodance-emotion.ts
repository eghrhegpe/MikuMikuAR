/**
 * proc-motion-autodance-emotion.ts
 * 情绪引擎：morph 评分、轮换、动画生成
 * 从 proc-motion-autodance.ts 拆分（第372-513行）
 */
import { canEncodeName, type MorphKeyFrame } from './vmd-writer';
import { logWarn } from '../core/utils';

// ============================================================================
// 黑名单模式（眨眼/口型等非情绪 morph）
// ============================================================================
const MORPH_BLACKLIST_PATTERNS = [
    'まばたき',
    'blink',
    '眨眼',
    'wink',
    'ウィンク',
    'あ',
    'い',
    'う',
    'え',
    'お',
    'a ',
    'i ',
    'u ',
    'e ',
    'o ',
] as const;

// ============================================================================
// 情绪分类 → 关键词（多语言）
// ============================================================================
export const EMOTION_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
    smile: ['にがり', '笑い', 'smile', 'えがお', 'happy', '喜び', '嬉しい', 'よろこび'],
    sad: ['悲しみ', 'sad', 'cry', '泣き', '哀しみ', 'かなしみ'],
    angry: ['怒り', 'angry', 'いかり', 'むっ', 'まゆ'],
    surprise: ['びく/', 'surprise', 'おどろき', '驚き', 'wonder', 'わお'],
    worry: ['困る', 'worry', 'こまる', '悩み', 'なやみ', '困惑'],
    serious: ['真面目', 'serious', 'まじめ', 'じと目', 'じと'],
    shy: ['照れ', 'shy', 'てれ', 'はにかみ', '恥ずかしい'],
    wink: ['ウィンク', 'wink', 'ういんく', 'win'],
} as const;

export type EmotionCategory = keyof typeof EMOTION_CANDIDATES;

// ============================================================================
// 评分函数
// ============================================================================

/**
 * 计算 morph 名称对一组关键词的匹配得分
 * - 含关键词 +10 分（大小写不敏感）
 * - 含黑名单模式 -10 分
 *
 * ⚠️ P3: 使用字符串包含匹配精度较低，建议后续用正则或语义向量
 */
export function scoreMorph(name: string, keywords: readonly string[]): number {
    const nameLC = name.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
        if (name.includes(kw) || nameLC.includes(kw.toLowerCase())) {
            score += 10;
        }
    }
    for (const bp of MORPH_BLACKLIST_PATTERNS) {
        if (name.includes(bp)) {
            score -= 10;
        }
    }
    return score;
}

/**
 * 从 morph 列表中找出最佳情绪映射
 * @returns Map<category, morphName>，不含 wink
 */
export function findBestEmotionMorphs(morphNames: readonly string[]): Map<EmotionCategory, string> {
    const emotionMorphs = new Map<EmotionCategory, string>();

    for (const [category, keywords] of Object.entries(EMOTION_CANDIDATES)) {
        let bestName: string | null = null;
        let bestScore = 0;

        for (const mName of morphNames) {
            const s = scoreMorph(mName, keywords);
            if (s > bestScore) {
                bestScore = s;
                bestName = mName;
            }
        }
        if (bestName) {
            emotionMorphs.set(category as EmotionCategory, bestName);
        }
    }

    // 过滤 Shift-JIS 不可编码的 morph
    for (const [k, n] of emotionMorphs) {
        if (!canEncodeName(n)) {
            logWarn('proc-motion-autodance-emotion', `表情 morph "${k}=${n}" 无法编码为 Shift-JIS，跳过`);
            emotionMorphs.delete(k);
        }
    }

    return emotionMorphs;
}

// ============================================================================
// 帧生成
// ============================================================================

/** 向 morphs 追加一个 fade-in → hold → fade-out 四帧序列 */
function pushFadeMorph(
    morphs: MorphKeyFrame[],
    name: string,
    start: number,
    peak: number,
    hold: number,
    end: number,
    weight: number
): void {
    morphs.push({ name, frame: start, weight: 0 });
    morphs.push({ name, frame: peak, weight });
    morphs.push({ name, frame: hold, weight });
    morphs.push({ name, frame: end, weight: 0 });
}

/**
 * 生成情绪轮播帧（多个情绪依次出现）
 */
export function genEmotionCycles(
    morphs: MorphKeyFrame[],
    emotionMorphs: Map<EmotionCategory, string>,
    beatFrames: number,
    loopFrames: number,
    intensity: number
): void {
    // wink 不参与轮播
    const foundEmotions = Array.from(emotionMorphs.entries()).filter(([k]) => k !== 'wink');
    if (foundEmotions.length === 0) {
        return;
    }

    logWarn('proc-motion-autodance-emotion', `表情 morph 匹配: [${foundEmotions.map(([k, n]) => `${k}=${n}`).join(', ')}]`);

    const cycleBeats = 4;
    const cycleFrames = beatFrames * cycleBeats;
    const cycleCount = Math.min(foundEmotions.length, Math.floor(loopFrames / cycleFrames));
    const availEmo = foundEmotions.slice(0, cycleCount);

    for (let ci = 0; ci < availEmo.length; ci++) {
        const [, morphName] = availEmo[ci];
        const start = cycleFrames * ci;
        const end = Math.min(start + cycleFrames - 1, loopFrames);
        const fadeIn = Math.floor(beatFrames * 0.3);
        const fadeOut = Math.max(end - Math.floor(beatFrames * 0.3), start + fadeIn);
        const weight = 0.5 + 0.3 * intensity;

        pushFadeMorph(morphs, morphName, start, start + fadeIn, fadeOut, end, weight);
    }
}

/**
 * 生成情绪强调帧（surprise/wink 随机点缀）
 */
export function genAccentMorph(
    morphs: MorphKeyFrame[],
    emotionMorphs: Map<EmotionCategory, string>,
    beatFrames: number,
    loopFrames: number,
    intensity: number
): void {
    const surpriseMorph = emotionMorphs.get('surprise') ?? null;
    const winkMorph = emotionMorphs.get('wink') ?? null;
    const accentMorph = surpriseMorph ?? winkMorph;
    if (!accentMorph) {
        return;
    }

    const measureCount = Math.min(4, Math.floor(loopFrames / (beatFrames * 2)));
    for (let m = 0; m < measureCount; m++) {
        const base = m * beatFrames * 2;
        const rand = (m * 7 + 3) % 10;
        if (rand < 3) {
            const t = base + Math.floor(beatFrames * 0.2);
            if (t + 6 <= loopFrames) {
                const w = 0.5 + 0.3 * intensity;
                pushFadeMorph(morphs, accentMorph, t, t + 1, t + 3, t + 6, w);
            }
        }
    }
}

/**
 * 生成害羞 morph（仅当存在时）
 */
export function genShyMorph(
    morphs: MorphKeyFrame[],
    emotionMorphs: Map<EmotionCategory, string>,
    beatFrames: number,
    loopFrames: number,
    intensity: number
): void {
    const shyMorph = emotionMorphs.get('shy') ?? null;
    if (!shyMorph) {
        return;
    }

    const shyStart = loopFrames - beatFrames * 4;
    if (shyStart > 0) {
        const w = 0.6 * intensity;
        pushFadeMorph(
            morphs,
            shyMorph,
            shyStart,
            shyStart + Math.floor(beatFrames * 0.5),
            shyStart + beatFrames * 2,
            shyStart + beatFrames * 2 + 2,
            w
        );
    }
}

/**
 * 生成全部情绪 morph 帧
 */
export function generateEmotionMorphs(
    morphNames: readonly string[],
    beatFrames: number,
    loopFrames: number,
    intensity: number
): { morphs: MorphKeyFrame[]; found: number } {
    const morphs: MorphKeyFrame[] = [];
    const emotionMorphs = findBestEmotionMorphs(morphNames);

    if (emotionMorphs.size === 0) {
        logWarn('procedural-motion', '未找到任何表情 morph，跳过情绪轮');
        return { morphs, found: 0 };
    }

    genEmotionCycles(morphs, emotionMorphs, beatFrames, loopFrames, intensity);
    genAccentMorph(morphs, emotionMorphs, beatFrames, loopFrames, intensity);
    genShyMorph(morphs, emotionMorphs, beatFrames, loopFrames, intensity);

    const foundEmotions = Array.from(emotionMorphs.entries()).filter(([k]) => k !== 'wink');
    return { morphs, found: foundEmotions.length };
}
