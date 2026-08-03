// e2e-state-bridge.ts — [doc:adr-238] E2E 状态读取器注入桥（纯叶子，零依赖）。
// 切断 core/dev-hooks → menus/menu-schema 反向依赖：
//   - menus/menu-schema 模块加载时注册 getStateValue（本文件 setter）
//   - core/dev-hooks 的 window.__state 钩子从此读取（本文件 getter）
// 双方只依赖本叶，不互相 import；menu-schema 也不会拖起 dev-hooks 的 scene/outfit 链。

export type StateReader = (path: string, modelId?: string) => unknown;

let _stateReader: StateReader | null = null;

/** 注册 E2E 状态读取器（menus/menu-schema 侧调用，模块加载即注册） */
export function setE2EStateReader(reader: StateReader): void {
    _stateReader = reader;
}

/** 读取 E2E 状态读取器（core/dev-hooks 侧调用；未注册返回 null） */
export function getE2EStateReader(): StateReader | null {
    return _stateReader;
}
