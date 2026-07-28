import { describe, it, expect } from 'vitest';
import {
    getBible,
    buildDialogueSystemPrompt,
    parseDialogueLines,
    BUILTIN_BIBLES,
    DIALOGUE_EMOTIONS,
} from '../ai/character-bible';

describe('getBible', () => {
    it('命中已知 id 返回对应角色', () => {
        expect(getBible('miku').name).toBe('初音未来');
        expect(getBible('narrator').id).toBe('narrator');
    });

    it('未命中 id 兜底到第一个内置角色', () => {
        expect(getBible('__nope__').id).toBe(BUILTIN_BIBLES[0].id);
    });
});

describe('buildDialogueSystemPrompt（纯函数）', () => {
    const prompt = buildDialogueSystemPrompt(getBible('miku'));

    it('包含角色名、人设与说话风格', () => {
        expect(prompt).toContain('初音未来');
        expect(prompt).toContain('虚拟歌姬');
        expect(prompt).toContain('活泼');
    });

    it('包含结构化输出契约与情绪闭集', () => {
        expect(prompt).toContain('"line"');
        expect(prompt).toContain('"emotion"');
        for (const e of DIALOGUE_EMOTIONS) {
            expect(prompt).toContain(e);
        }
    });

    it('要求不跳出角色', () => {
        expect(prompt).toContain('不要跳出角色');
    });
});

describe('parseDialogueLines（容错解析）', () => {
    it('解析标准 JSON 数组', () => {
        const raw = '[{"line":"你好呀～","emotion":"happy"},{"line":"今天也要加油！","emotion":"neutral"}]';
        const lines = parseDialogueLines(raw);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toEqual({ line: '你好呀～', emotion: 'happy' });
        expect(lines[1].emotion).toBe('neutral');
    });

    it('提取被前后文本/代码块包裹的 JSON', () => {
        const raw = '好的，这是台词：\n```json\n[{"line":"嗨","emotion":"shy"}]\n```\n希望你喜欢';
        const lines = parseDialogueLines(raw);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toEqual({ line: '嗨', emotion: 'shy' });
    });

    it('非法情绪归一到 neutral', () => {
        const raw = '[{"line":"测试","emotion":"excited"}]';
        expect(parseDialogueLines(raw)[0].emotion).toBe('neutral');
    });

    it('缺失 emotion 字段归一到 neutral', () => {
        const raw = '[{"line":"无情绪"}]';
        expect(parseDialogueLines(raw)[0].emotion).toBe('neutral');
    });

    it('过滤空 line 条目', () => {
        const raw = '[{"line":"","emotion":"happy"},{"line":"有效","emotion":"sad"}]';
        const lines = parseDialogueLines(raw);
        expect(lines).toHaveLength(1);
        expect(lines[0].line).toBe('有效');
    });

    it('非 JSON 文本兜底为单条 neutral 台词', () => {
        const lines = parseDialogueLines('抱歉我无法生成 JSON');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toEqual({ line: '抱歉我无法生成 JSON', emotion: 'neutral' });
    });

    it('空字符串返回空数组', () => {
        expect(parseDialogueLines('   ')).toEqual([]);
    });

    it('JSON 解析失败但含方括号时兜底为整段文本', () => {
        const raw = '[这不是合法 JSON';
        const lines = parseDialogueLines(raw);
        expect(lines).toHaveLength(1);
        expect(lines[0].emotion).toBe('neutral');
    });
});
