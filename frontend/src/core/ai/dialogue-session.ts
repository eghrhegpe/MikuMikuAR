// [doc:adr-156] 台词会话状态 — 持有当前选中角色，转发 prompt 构建
//
// 薄封装：面板（settings-diagnostic.ts）不直接管理角色状态，
// 由本模块单点持有 activeBibleId，便于后续扩展（用户自定义角色/序列化）。
// 依赖 character-bible.ts 纯函数，自身仅一处模块级 state，写入点唯一（setActiveBible）。

import {
    BUILTIN_BIBLES,
    getBible,
    buildDialogueSystemPrompt as _buildPrompt,
    type CharacterBible,
} from './character-bible';

let _activeBibleId: string = BUILTIN_BIBLES[0].id;

/** 当前选中的角色圣经。 */
export function getActiveBible(): CharacterBible {
    return getBible(_activeBibleId);
}

/** 切换当前角色（唯一写入点）。 */
export function setActiveBible(id: string): void {
    _activeBibleId = getBible(id).id; // 经 getBible 归一，非法 id 兜底到内置首个
}

/** 可选角色列表（供 UI 下拉/切换）。 */
export function listBibles(): readonly CharacterBible[] {
    return BUILTIN_BIBLES;
}

/** 转发：为当前角色构建台词 system prompt。 */
export function buildDialogueSystemPrompt(bible: CharacterBible): string {
    return _buildPrompt(bible);
}
