// [doc:adr-243] deriveDefaultEnvState 单测 —— 从 schema 自动推导的默认值契约
import { describe, it, expect } from 'vitest';
import { ENV_STATE_SCHEMA } from '../env-state-schema';
import { deriveDefaultEnvState } from '../env-state-defaults';

describe('deriveDefaultEnvState [doc:adr-243]', () => {
    it('字段数与 schema 完全一致（无孤儿字段、无遗漏字段）', () => {
        const s = deriveDefaultEnvState();
        expect(Object.keys(s)).toHaveLength(Object.keys(ENV_STATE_SCHEMA).length);
    });

    it('每个字段 key 都存在于 schema（推导不引入 schema 外字段）', () => {
        const s = deriveDefaultEnvState();
        for (const k of Object.keys(s)) {
            expect(k in ENV_STATE_SCHEMA).toBe(true);
        }
    });

    it('tuple3 字段返回新引用（防 reactive 不代理数组导致写穿 schema 字面量）', () => {
        const s = deriveDefaultEnvState() as unknown as Record<string, unknown>;
        for (const [k, def] of Object.entries(ENV_STATE_SCHEMA)) {
            if (def.type === 'tuple3') {
                expect(Array.isArray(s[k]), `${k} 应为数组`).toBe(true);
                expect(s[k], `${k} 必须为新引用（slice 克隆）`).not.toBe(def.default);
                expect(s[k], `${k} 值应等于 schema default`).toEqual(def.default);
            }
        }
    });

    it('非 tuple3 字段值与 schema default 严格相等（值类型直引）', () => {
        const s = deriveDefaultEnvState() as unknown as Record<string, unknown>;
        for (const [k, def] of Object.entries(ENV_STATE_SCHEMA)) {
            if (def.type !== 'tuple3') {
                expect(s[k], `${k} 应等于 schema default`).toBe(def.default);
            }
        }
    });

    it('optional-string 字段（lightingPresetName）default 为 undefined 时正常推导', () => {
        const s = deriveDefaultEnvState();
        expect(s.lightingPresetName).toBeUndefined();
    });

    it('重复调用返回互不共享引用的 tuple3（每次推导都克隆）', () => {
        const a = deriveDefaultEnvState();
        const b = deriveDefaultEnvState();
        expect(a.skyColorTop).not.toBe(b.skyColorTop);
        expect(a.skyColorTop).toEqual(b.skyColorTop);
    });
});
