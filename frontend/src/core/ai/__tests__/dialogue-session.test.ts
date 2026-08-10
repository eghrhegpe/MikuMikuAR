// @vitest-environment node
// [doc:adr-156] dialogue-session 守护测试：角色状态单点持有、切换、prompt 转发。
// 依赖 character-bible 纯函数，自身仅模块级 state。

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getActiveBible,
    setActiveBible,
    listBibles,
    buildDialogueSystemPrompt,
} from '../dialogue-session';

describe('dialogue-session', () => {
    beforeEach(() => {
        // 每次测试前重置为默认角色
        setActiveBible('miku');
    });

    it('默认角色为内置首个（miku）', () => {
        const bible = getActiveBible();
        expect(bible.id).toBe('miku');
        expect(bible.name).toBe('初音未来');
    });

    it('setActiveBible 切换角色', () => {
        setActiveBible('narrator');
        const bible = getActiveBible();
        expect(bible.id).toBe('narrator');
        expect(bible.name).toBe('旁白');
    });

    it('setActiveBible 非法 id 兜底到内置首个', () => {
        setActiveBible('nonexistent');
        const bible = getActiveBible();
        expect(bible.id).toBe('miku');
    });

    it('listBibles 返回全部内置角色', () => {
        const bibles = listBibles();
        expect(bibles).toHaveLength(2);
        expect(bibles[0].id).toBe('miku');
        expect(bibles[1].id).toBe('narrator');
    });

    it('setActiveBible 空字符串兜底到内置首个', () => {
        setActiveBible('');
        const bible = getActiveBible();
        expect(bible.id).toBe('miku');
    });

    it('buildDialogueSystemPrompt 转发给 character-bible', () => {
        const prompt = buildDialogueSystemPrompt(getActiveBible());
        expect(prompt).toContain('初音未来');
        expect(prompt).toContain('JSON 数组');
    });

    it('切换角色后 getActiveBible 返回新角色', () => {
        setActiveBible('narrator');
        const prompt = buildDialogueSystemPrompt(getActiveBible());
        expect(prompt).toContain('旁白');
        expect(prompt).toContain('第三人称');
    });
});
