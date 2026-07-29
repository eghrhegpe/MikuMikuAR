// [doc:adr-156] 角色圣经 — 供 AI 台词生成注入人设约束
//
// 纯数据 + 纯函数叶子模块（对齐 scene-snapshot.ts 风格），零副作用、零应用层依赖。
// 台词模式（settings-diagnostic.ts 的 'dialogue' tab）取 activeBible 组装 system prompt，
// 约束 LLM 以固定人设 + 结构化情绪标签产出对白，避免人设漂移。
//
// 数据源说明：项目 novel/ 目录为「开发编年史」（拟人化讲代码重构），并非角色人设，
// 故本模块内建人设，不从 novel/ 抽取（修正 ADR-156 初版数据源假设）。

/** 单个角色的人设定义。 */
export interface CharacterBible {
    /** 稳定标识，用于选择/序列化。 */
    id: string;
    /** 展示名。 */
    name: string;
    /** 一句话定位（如「虚拟歌姬，元气少女」）。 */
    persona: string;
    /** 说话风格约束（语气、口头禅、句式）。 */
    speechStyle: string;
    /** 硬性禁忌（不可 OOC 的边界）。 */
    taboos: string[];
}

/** 台词生成的输出情绪标签闭集（用于后续 TTS/表情映射，Step 2）。 */
export const DIALOGUE_EMOTIONS = [
    'neutral',
    'happy',
    'sad',
    'angry',
    'surprised',
    'shy',
    'curious',
] as const;

export type DialogueEmotion = (typeof DIALOGUE_EMOTIONS)[number];

/** 内置角色圣经（可扩展；后续支持用户自定义导入）。 */
export const BUILTIN_BIBLES: readonly CharacterBible[] = [
    {
        id: 'miku',
        name: '初音未来',
        persona: '虚拟歌姬，元气满满的少女，热爱唱歌与舞台，对世界充满好奇。',
        speechStyle: '语气活泼可爱，句尾偶尔带「～」，多用感叹，自称「我」，亲切不做作。',
        taboos: ['不使用粗俗或攻击性语言', '不脱离歌姬/少女的身份设定', '不谈论现实政治与敏感话题'],
    },
    {
        id: 'narrator',
        name: '旁白',
        persona: '沉稳中立的叙述者，负责场景旁白与氛围铺陈。',
        speechStyle: '语气平和克制，用第三人称叙述，简洁而有画面感。',
        taboos: ['不使用第一人称口语', '不加入主观评价'],
    },
] as const;

/** 按 id 查角色圣经；未命中返回第一个内置角色兜底。 */
export function getBible(id: string): CharacterBible {
    return BUILTIN_BIBLES.find((b) => b.id === id) ?? BUILTIN_BIBLES[0];
}

/**
 * 组装台词模式的 system prompt：固定人设 + 结构化输出契约。
 * 输出契约要求 LLM 每句台词带情绪标签，为 Step 2（TTS/口型）预留结构。
 */
export function buildDialogueSystemPrompt(bible: CharacterBible): string {
    const emotions = DIALOGUE_EMOTIONS.join(' / ');
    return [
        `你现在扮演角色「${bible.name}」。`,
        `人设：${bible.persona}`,
        `说话风格：${bible.speechStyle}`,
        `禁忌（必须遵守）：${bible.taboos.map((x) => `- ${x}`).join('\n')}`,
        '请始终保持该角色的口吻与身份，不要跳出角色（不要以 AI 助手身份说话）。',
        `每次回复请用如下 JSON 数组格式输出一段或多段台词，情绪标签仅限：${emotions}：`,
        '[{"line": "台词内容", "emotion": "情绪标签"}]',
        '只输出 JSON，不要额外解释。',
    ].join('\n');
}

/** 一条解析后的台词。 */
export interface DialogueLine {
    line: string;
    emotion: DialogueEmotion;
}

/**
 * 从 LLM 文本响应解析台词数组；容错：非法情绪归一到 neutral，
 * 解析失败时将整段文本作为单条 neutral 台词兜底（保证 UI 永远有内容渲染）。
 */
export function parseDialogueLines(raw: string): DialogueLine[] {
    const emotionSet = new Set<string>(DIALOGUE_EMOTIONS);
    const normalize = (e: unknown): DialogueEmotion =>
        typeof e === 'string' && emotionSet.has(e) ? (e as DialogueEmotion) : 'neutral';

    // 提取首个 JSON 数组片段（LLM 可能包裹代码块或前后缀文本）。
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
        try {
            const arr = JSON.parse(raw.slice(start, end + 1)) as unknown;
            if (Array.isArray(arr)) {
                const lines = arr
                    .map((item): DialogueLine | null => {
                        if (item && typeof item === 'object' && 'line' in item) {
                            const line = String((item as { line: unknown }).line ?? '').trim();
                            if (!line) {
                                return null;
                            }
                            return {
                                line,
                                emotion: normalize((item as { emotion?: unknown }).emotion),
                            };
                        }
                        return null;
                    })
                    .filter((x): x is DialogueLine => x !== null);
                if (lines.length > 0) {
                    return lines;
                }
            }
        } catch {
            /* 落入兜底 */
        }
    }

    const fallback = raw.trim();
    return fallback ? [{ line: fallback, emotion: 'neutral' }] : [];
}
