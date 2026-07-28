import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSpeechSupported, speakLines, cancelSpeech } from '../ai/dialogue-speech';

describe('dialogue-speech（SpeechSynthesis 封装）', () => {
    let speakSpy: ReturnType<typeof vi.fn>;
    let cancelSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        speakSpy = vi.fn();
        cancelSpy = vi.fn();
        // 注入最小 SpeechSynthesis mock
        (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
            speak: speakSpy,
            cancel: cancelSpy,
        };
        (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
            class {
                text: string;
                rate = 1;
                pitch = 1;
                lang = '';
                constructor(text: string) {
                    this.text = text;
                }
            };
    });

    afterEach(() => {
        delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
        delete (window as unknown as { SpeechSynthesisUtterance?: unknown })
            .SpeechSynthesisUtterance;
    });

    it('支持探测：mock 注入后为 true', () => {
        expect(isSpeechSupported()).toBe(true);
    });

    it('speakLines 对每条非空台词调用 speak', () => {
        speakLines(
            [
                { line: '你好', emotion: 'happy' },
                { line: '再见', emotion: 'sad' },
            ],
            'zh-CN'
        );
        expect(cancelSpy).toHaveBeenCalledTimes(1); // 先清队列
        expect(speakSpy).toHaveBeenCalledTimes(2);
    });

    it('speakLines 按情绪设置 rate/pitch', () => {
        speakLines([{ line: '哇', emotion: 'surprised' }], 'zh-CN');
        const utter = speakSpy.mock.calls[0][0] as { rate: number; pitch: number; lang: string };
        expect(utter.rate).toBeGreaterThan(1);
        expect(utter.pitch).toBeGreaterThan(1);
        expect(utter.lang).toBe('zh-CN');
    });

    it('未知情绪回落 neutral 参数', () => {
        speakLines([{ line: '嗯', emotion: 'bogus' }], 'zh-CN');
        const utter = speakSpy.mock.calls[0][0] as { rate: number; pitch: number };
        expect(utter.rate).toBe(1.0);
        expect(utter.pitch).toBe(1.0);
    });

    it('空数组不朗读', () => {
        speakLines([], 'zh-CN');
        expect(speakSpy).not.toHaveBeenCalled();
    });

    it('过滤空 line', () => {
        speakLines(
            [
                { line: '', emotion: 'happy' },
                { line: '有效', emotion: 'neutral' },
            ],
            'zh-CN'
        );
        expect(speakSpy).toHaveBeenCalledTimes(1);
    });

    it('cancelSpeech 调用底层 cancel', () => {
        cancelSpeech();
        expect(cancelSpy).toHaveBeenCalledTimes(1);
    });
});

describe('dialogue-speech（环境不支持时优雅降级）', () => {
    beforeEach(() => {
        delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    });

    it('isSpeechSupported 为 false', () => {
        expect(isSpeechSupported()).toBe(false);
    });

    it('speakLines 静默 no-op（不抛错）', () => {
        expect(() => speakLines([{ line: '测试', emotion: 'happy' }])).not.toThrow();
    });

    it('cancelSpeech 静默 no-op（不抛错）', () => {
        expect(() => cancelSpeech()).not.toThrow();
    });
});
