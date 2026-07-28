// [doc:adr-156] 台词语音朗读 — 浏览器原生 SpeechSynthesis 封装（Step 2a）
//
// 零依赖叶子：封装 Web Speech API 的 SpeechSynthesis，供台词模式将对白朗读出声。
// ⚠️ 注意：SpeechSynthesis 走浏览器独立音频输出，不经 HTMLAudioElement/AudioContext，
// 因此【无法】被 LipSync 的 BeatDetector（createMediaElementSource 绑定 MMD 音乐元素）采样，
// 口型不会自动跟随 TTS。口型闭环需独立方案（见 ADR-156 §Step 2b：A 后端 TTS blob / B 时长估算伪振幅）。
// 本模块职责仅限「出声」。
// 优雅降级：环境不支持（无 window.speechSynthesis，如部分 WebView）时静默 no-op，
// isSpeechSupported() 供 UI 决定是否展示朗读开关。

/** 环境是否支持语音合成。 */
export function isSpeechSupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        typeof window.SpeechSynthesisUtterance === 'function'
    );
}

/** 情绪 → 语音参数映射（rate/pitch），让不同情绪的朗读有区分度。 */
const EMOTION_PROSODY: Record<string, { rate: number; pitch: number }> = {
    neutral: { rate: 1.0, pitch: 1.0 },
    happy: { rate: 1.1, pitch: 1.2 },
    sad: { rate: 0.85, pitch: 0.9 },
    angry: { rate: 1.15, pitch: 0.85 },
    surprised: { rate: 1.2, pitch: 1.3 },
    shy: { rate: 0.9, pitch: 1.1 },
};

/** 一条待朗读台词。 */
export interface SpeakLine {
    line: string;
    emotion: string;
}

/** 停止当前所有朗读（切换角色/取消/面板关闭时调用）。 */
export function cancelSpeech(): void {
    if (isSpeechSupported()) {
        window.speechSynthesis.cancel();
    }
}

/**
 * 依次朗读多条台词（按情绪调整语速/音高）。
 * @param lines 台词数组
 * @param lang  BCP-47 语言标签（如 'zh-CN' / 'ja-JP'），匹配语音音色
 * 非阻塞：内部串联 utterance 队列；不支持时静默返回。
 */
export function speakLines(lines: SpeakLine[], lang: string = 'zh-CN'): void {
    if (!isSpeechSupported() || lines.length === 0) {
        return;
    }
    // 先清空既有队列，避免叠加重播。
    window.speechSynthesis.cancel();
    for (const { line, emotion } of lines) {
        if (!line) {
            continue;
        }
        const u = new SpeechSynthesisUtterance(line);
        const prosody = EMOTION_PROSODY[emotion] ?? EMOTION_PROSODY.neutral;
        u.rate = prosody.rate;
        u.pitch = prosody.pitch;
        u.lang = lang;
        window.speechSynthesis.speak(u);
    }
}
