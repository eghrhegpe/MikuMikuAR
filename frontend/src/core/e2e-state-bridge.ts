// e2e-state-bridge.ts — [doc:adr-238] E2E 状态读取器注入桥（纯叶子）。
// 切断 core/dev-hooks → menus/menu-schema 反向依赖：
//   - menus/menu-schema 模块加载时注册 getStateValue（本文件 setter）
//   - core/dev-hooks 的 window.__state 钩子从此读取（本文件 getter）
// 双方只依赖本叶，不互相 import；menu-schema 也不会拖起 dev-hooks 的 scene/outfit 链。
// [doc:adr-265] 槽语义收敛至通用原语 core/bridge-slot（行为不变：单值 set/get）。

import { createSlot } from './bridge-slot';

export type StateReader = (path: string, modelId?: string) => unknown;

const _stateReader = createSlot<StateReader>();

/** 注册 E2E 状态读取器（menus/menu-schema 侧调用，模块加载即注册）。
 * 透传 bridge-slot 的 identity token：持 token 注销时若槽已被 HMR/后注册者覆盖则安全 no-op。 */
export function setE2EStateReader(reader: StateReader): () => void {
    return _stateReader.set(reader);
}

/** 注销读取器：传 set 返回的 token 则 identity 安全删除；不传则无条件清空（测试隔离） */
export function clearE2EStateReader(token?: () => void): void {
    if (token) token();
    else _stateReader.reset();
}

/** 读取 E2E 状态读取器（core/dev-hooks 侧调用；未注册返回 null） */
export function getE2EStateReader(): StateReader | null {
    return _stateReader.get();
}
