// [doc:adr-243] EnvState 默认值从 Schema 自动推导（单一事实源，消除 state.ts 手工 148 字段映射双源）
// 职责: deriveDefaultEnvState() 纯函数 —— 遍历 ENV_STATE_SCHEMA 按 type 克隆策略派生默认 EnvState。
// 新增 env 字段只需改 schema 一处（type + default + group），无需再手写第二份默认值投影。
import { ENV_STATE_SCHEMA } from './env-state-schema';
import type { EnvState } from './types';

/**
 * 从 ENV_STATE_SCHEMA 派生默认 EnvState。
 *
 * 克隆策略（按 type 区分）：
 * - `tuple3`：`slice()` 克隆新引用。reactive() 的 Proxy **不代理数组**
 *   （见 core/reactivity.ts），共享 schema 的 default 数组会被 `envState.xxx[0]=v`
 *   静默写穿——污染模块级 schema 字面量且不可自愈。
 * - 其余值类型（number/boolean/string/enum/`optional-string`）：直接引用 default。
 *   ⚠ `optional-string`（如 lightingPresetName，default=undefined）走 else 分支；
 *   未来若新增**非 tuple3 的引用类型** type，必须在此补克隆分支，否则共享引用泄漏。
 */
export function deriveDefaultEnvState(): EnvState {
    const out = {} as Record<keyof EnvState, unknown>;
    for (const [key, def] of Object.entries(ENV_STATE_SCHEMA) as Array<
        [keyof EnvState, { type: string; default: unknown }]
    >) {
        out[key] = def.type === 'tuple3' ? (def.default as readonly number[]).slice() : def.default;
    }
    // [doc:adr-243] 编译期兜底不在此处（as unknown as 绕过类型检查）——
    // 防线前移：ENV_STATE_SCHEMA 的 satisfies Record<string, _AnyFieldDef> 已互锁
    // type↔default（env-state-schema.ts），default 类型错误在 schema 声明处即编译失败。
    return out as unknown as EnvState;
}
