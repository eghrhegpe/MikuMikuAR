// [doc:adr-156] character-bible 守护测试：角色查表、system prompt 组装、台词解析。
// 纯叶子模块，零依赖。

import { describe, it, expect } from 'vitest';
import {
    getBible,
    buildDialogueSystemPrompt,
    parseDialogueLines,
    BUILTIN_BIBLES,
    DIALOGUE_EMOTIONS,
} from '../character-bible';

describe('BUILTIN_BIBLES', () => {
    it('内置 2 个角色', () => {
        expect(BUILTIN_BIBLES).toHaveLength(2);
        expect(BUILTIN_BIBLES[0].id).toBe('miku');
        expect(BUILTIN_BIBLES[1].id).toBe('narrator');
    });

    it('每位角色有完整字段', () => {
        for (const bible of BUILTIN_BIBLES) {
            expect(bible.id).toBeTruthy();
            expect(bible.name).toBeTruthy();
            expect(bible.persona).toBeTruthy();
            expect(bible.speechStyle).toBeTruthy();
            expect(bible.taboos.length).toBeGreaterThan(0);
        }
    });
});

describe('DIALOGUE_EMOTIONS', () => {
    it('包含 7 种情绪', () => {
        expect(DIALOGUE_EMOTIONS).toEqual([
            'neutral',
            'happy',
            'sad',
            'angry',
            'surprised',
            'shy',
            'curious',
        ]);
    });
});

describe('getBible', () => {
    it('按 id 返回对应角色', () => {
        const miku = getBible('miku');
        expect(miku.name).toBe('初音未来');
    });

    it('未知 id 返回第一个角色兜底', () => {
        const fallback = getBible('nonexistent');
        expect(fallback.id).toBe('miku');
    });
});

describe('buildDialogueSystemPrompt', () => {
    it('包含角色名和人设', () => {
        const prompt = buildDialogueSystemPrompt(getBible('miku'));
        expect(prompt).toContain('初音未来');
        expect(prompt).toContain('虚拟歌姬');
        expect(prompt).toContain('活泼可爱');
    });

    it('包含输出格式约束（JSON 数组）', () => {
        const prompt = buildDialogueSystemPrompt(getBible('miku'));
        expect(prompt).toContain('JSON 数组');
        expect(prompt).toContain('"line"');
        expect(prompt).toContain('"emotion"');
    });

    it('包含情绪标签列表', () => {
        const prompt = buildDialogueSystemPrompt(getBible('miku'));
        for (const em of DIALOGUE_EMOTIONS) {
            expect(prompt).toContain(em);
        }
    });

    it('narrator 角色不含第一人称', () => {
        const prompt = buildDialogueSystemPrompt(getBible('narrator'));
        expect(prompt).toContain('旁白');
        expect(prompt).toContain('第三人称');
    });
});

describe('parseDialogueLines', () => {
    it('解析合法 JSON 数组', () => {
        const lines = parseDialogueLines(
            '[{"line": "你好！", "emotion": "happy"}, {"line": "再见", "emotion": "sad"}]'
        );
        expect(lines).toHaveLength(2);
        expect(lines[0].line).toBe('你好！');
        expect(lines[0].emotion).toBe('happy');
        expect(lines[1].line).toBe('再见');
        expect(lines[1].emotion).toBe('sad');
    });

    it('非法情绪归一为 neutral', () => {
        const lines = parseDialogueLines('[{"line": "hello", "emotion": "invalid_emotion"}]');
        expect(lines).toHaveLength(1);
        expect(lines[0].emotion).toBe('neutral');
    });

    it('从 LLM 代码块包裹中提取 JSON', () => {
        const lines = parseDialogueLines(
            '好的，这是台词：\n```json\n[{"line": "测试", "emotion": "curious"}]\n```'
        );
        expect(lines).toHaveLength(1);
        expect(lines[0].line).toBe('测试');
    });

    it('空行条目被过滤', () => {
        const lines = parseDialogueLines(
            '[{"line": "", "emotion": "happy"}, {"line": "ok", "emotion": "neutral"}]'
        );
        expect(lines).toHaveLength(1);
        expect(lines[0].line).toBe('ok');
    });

    it('空数组降级为整段文本兜底（非空 raw 不走空数组分支）', () => {
        const lines = parseDialogueLines('[]');
        expect(lines).toHaveLength(1);
        expect(lines[0].line).toBe('[]');
        expect(lines[0].emotion).toBe('neutral');
    });

    it('解析失败时整段文本作为 neutral 兜底', () => {
        const lines = parseDialogueLines('你好，我是初音未来！');
        expect(lines).toHaveLength(1);
        expect(lines[0].line).toBe('你好，我是初音未来！');
        expect(lines[0].emotion).toBe('neutral');
    });

    it('空文本返回空数组', () => {
        expect(parseDialogueLines('')).toEqual([]);
        expect(parseDialogueLines('   ')).toEqual([]);
    });
});
