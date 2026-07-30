// locale.detect.test.ts — [doc:adr-059] 系统语言自动识别（detectSystemLang 纯逻辑）
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectSystemLang } from './locale';

// 用 vi.stubGlobal 覆写 navigator.languages，验证繁简判定与基准语言匹配。
function stubLanguages(langs: string[] | undefined): void {
    vi.stubGlobal('navigator', langs === undefined ? {} : { languages: langs });
}

describe('detectSystemLang — 系统语言自动识别', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('繁体标识（zh-TW / zh-HK / zh-Hant）识别为 zh-TW', () => {
        for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW']) {
            stubLanguages([tag]);
            expect(detectSystemLang(), tag).toBe('zh-TW');
        }
    });

    it('其余中文变体（zh / zh-CN / zh-SG）识别为 zh-CN', () => {
        for (const tag of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN']) {
            stubLanguages([tag]);
            expect(detectSystemLang(), tag).toBe('zh-CN');
        }
    });

    it('en / ja / ko 及其地区变体匹配对应基准语言', () => {
        stubLanguages(['en-US']);
        expect(detectSystemLang()).toBe('en');
        stubLanguages(['ja-JP']);
        expect(detectSystemLang()).toBe('ja');
        stubLanguages(['ko-KR']);
        expect(detectSystemLang()).toBe('ko');
    });

    it('按 languages 顺序取首个命中的受支持语言', () => {
        // 首选 fr 不支持 → 跳过 → 命中 ja
        stubLanguages(['fr-FR', 'ja-JP', 'en']);
        expect(detectSystemLang()).toBe('ja');
    });

    it('无任何受支持语言时返回 null（由调用方回落 FALLBACK）', () => {
        stubLanguages(['fr-FR', 'de-DE']);
        expect(detectSystemLang()).toBeNull();
    });

    it('navigator.languages 为空时回退 navigator.language 单值', () => {
        vi.stubGlobal('navigator', { language: 'ko-KR' });
        expect(detectSystemLang()).toBe('ko');
    });

    it('navigator 无语言信息时返回 null', () => {
        stubLanguages(undefined);
        expect(detectSystemLang()).toBeNull();
    });
});
