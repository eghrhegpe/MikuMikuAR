// [doc:adr-156] dialogue-speech 守护测试：语音合成封装。
// 依赖 Web Speech API（mock），验证情绪映射、朗读逻辑。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isSpeechSupported,
    cancelSpeech,
    speakLines,
} from '../dialogue-speech';

// ── 模拟 SpeechSynthesis ──────────────────────────────────────────
const mockSpeak = vi.fn();
const mockCancel = vi.fn();
const mockUtterance = vi.fn();

// mock.instances[0] 类型为 unknown，提取为强类型 utterance 访问 rate/pitch/lang
type UtteranceLike = { rate: number; pitch: number; lang: string };
function lastUtterance(): UtteranceLike {
    return mockUtterance.mock.instances[0] as UtteranceLike;
}

beforeEach(() => {
    mockSpeak.mockClear();
    mockCancel.mockClear();
    mockUtterance.mockClear();
    // 模拟完整 Web Speech API：window 对象 + globalThis 全局构造函数
    Object.defineProperty(globalThis, 'window', {
        value: {
            speechSynthesis: {
                speak: mockSpeak,
                cancel: mockCancel,
            },
            SpeechSynthesisUtterance: mockUtterance,
        },
        writable: true,
        configurable: true,
    });
    // speakLines 中直接 new SpeechSynthesisUtterance()，需挂全局
    globalThis.SpeechSynthesisUtterance = mockUtterance as unknown as typeof SpeechSynthesisUtterance;
});

afterEach(() => {
    // 还原 window 和全局构造函数，避免影响其他测试
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
});

// ── isSpeechSupported ──────────────────────────────────────────────
describe('isSpeechSupported', () => {
    it('有 SpeechSynthesis 时返回 true', () => {
        expect(isSpeechSupported()).toBe(true);
    });

    it('无 window 时返回 false', () => {
        delete (globalThis as Record<string, unknown>).window;
        expect(isSpeechSupported()).toBe(false);
    });

    it('无 speechSynthesis 时返回 false', () => {
        Object.defineProperty(globalThis, 'window', {
            value: { SpeechSynthesisUtterance: vi.fn() },
            writable: true,
            configurable: true,
        });
        expect(isSpeechSupported()).toBe(false);
    });
});

// ── cancelSpeech ───────────────────────────────────────────────────
describe('cancelSpeech', () => {
    it('调用 speechSynthesis.cancel()', () => {
        cancelSpeech();
        expect(mockCancel).toHaveBeenCalledTimes(1);
    });

    it('环境不支持时静默不报错', () => {
        delete (globalThis as Record<string, unknown>).window;
        expect(() => cancelSpeech()).not.toThrow();
    });
});

// ── speakLines ─────────────────────────────────────────────────────
describe('speakLines', () => {
    it('空数组静默返回，不调用 speak', () => {
        speakLines([]);
        expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('朗读前先 cancel 清空队列', () => {
        speakLines([{ line: '你好', emotion: 'neutral' }]);
        // cancel 应在 speak 之前调用
        expect(mockCancel).toHaveBeenCalledBefore(mockSpeak);
    });

    it('按情绪映射 rate/pitch', () => {
        speakLines([{ line: '太好了！', emotion: 'happy' }]);
        expect(mockUtterance).toHaveBeenCalledTimes(1);
        // 获取构造的 utterance 实例
        const utterance = lastUtterance();
        // happy: rate=1.1, pitch=1.2
        expect(utterance.rate).toBe(1.1);
        expect(utterance.pitch).toBe(1.2);
    });

    it('neutral 情绪使用默认语速音高', () => {
        speakLines([{ line: '你好', emotion: 'neutral' }]);
        const utterance = lastUtterance();
        expect(utterance.rate).toBe(1.0);
        expect(utterance.pitch).toBe(1.0);
    });

    it('未知情绪降级为 neutral', () => {
        speakLines([{ line: '测试', emotion: 'unknown_emotion' as string }]);
        const utterance = lastUtterance();
        expect(utterance.rate).toBe(1.0);
        expect(utterance.pitch).toBe(1.0);
    });

    it('依次朗读多条台词', () => {
        speakLines([
            { line: '第一句', emotion: 'neutral' },
            { line: '第二句', emotion: 'happy' },
        ]);
        expect(mockUtterance).toHaveBeenCalledTimes(2);
        expect(mockSpeak).toHaveBeenCalledTimes(2);
    });

    it('空行条目跳过不朗读', () => {
        speakLines([
            { line: '', emotion: 'neutral' },
            { line: '有效内容', emotion: 'sad' },
        ]);
        expect(mockUtterance).toHaveBeenCalledTimes(1);
        expect(mockSpeak).toHaveBeenCalledTimes(1);
    });

    it('指定 lang 参数传递给 utterance', () => {
        speakLines([{ line: 'こんにちは', emotion: 'neutral' }], 'ja-JP');
        const utterance = lastUtterance();
        expect(utterance.lang).toBe('ja-JP');
    });

    it('默认 lang 为 zh-CN', () => {
        speakLines([{ line: '你好', emotion: 'neutral' }]);
        const utterance = lastUtterance();
        expect(utterance.lang).toBe('zh-CN');
    });

    it('环境不支持时静默返回', () => {
        delete (globalThis as Record<string, unknown>).window;
        expect(() => speakLines([{ line: 'test', emotion: 'neutral' }])).not.toThrow();
        expect(mockSpeak).not.toHaveBeenCalled();
    });
});