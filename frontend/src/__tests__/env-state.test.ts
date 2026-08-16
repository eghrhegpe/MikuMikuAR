// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { envState } from '../core/config';
import type { EnvState } from '../core/config';
import { deriveDefaultEnvState } from '../core/env-state-defaults';
import { ENV_STATE_SCHEMA, getEnvKeys, type EnvDispatchGroup } from '../core/env-state-schema';

// 真实默认值（单一事实源：ENV_STATE_SCHEMA 派生，替代原文件内手写字面量自证）
const defaultEnv: EnvState = deriveDefaultEnvState();

// ====================================================================
// Schema 完整性：默认值必须覆盖 schema 全部 key
// ====================================================================

describe('EnvState schema completeness', () => {
    it('deriveDefaultEnvState covers every schema key', () => {
        const schemaKeys = Object.keys(ENV_STATE_SCHEMA) as (keyof EnvState)[];
        for (const k of schemaKeys) {
            expect(k in defaultEnv, `missing key: ${String(k)}`).toBe(true);
        }
    });

    it('deriveDefaultEnvState produces no extra keys outside schema', () => {
        const schemaKeys = new Set(Object.keys(ENV_STATE_SCHEMA));
        for (const k of Object.keys(defaultEnv)) {
            expect(schemaKeys.has(k as keyof EnvState), `extra key: ${k}`).toBe(true);
        }
    });

    it('schema key count matches EnvState key count', () => {
        const schemaCount = Object.keys(ENV_STATE_SCHEMA).length;
        const envCount = Object.keys(defaultEnv).length;
        expect(envCount).toBe(schemaCount);
    });
});

// ====================================================================
// 默认值类型与范围
// ====================================================================

describe('EnvState defaults', () => {
    it("skyMode defaults to 'color'", () => {
        expect(defaultEnv.skyMode).toBe('color');
    });

    it('default sky colors are valid RGB arrays', () => {
        for (const c of [defaultEnv.skyColorTop, defaultEnv.skyColorMid, defaultEnv.skyColorBot]) {
            expect(c.length).toBe(3);
            for (const v of c) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
    });

    it('wind direction is a unit vector', () => {
        const d = defaultEnv.windDirection;
        const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        expect(len).toBeCloseTo(1, 5);
    });

    it('cloud cover is between 0 and 1', () => {
        expect(defaultEnv.cloudCover).toBeGreaterThanOrEqual(0);
        expect(defaultEnv.cloudCover).toBeLessThanOrEqual(1);
    });

    it('iblIntensity default is 2 (not 1)', () => {
        // 回归保护：旧测试硬编码 iblIntensity===1 是自证错误，schema 实际默认 2
        expect(defaultEnv.iblIntensity).toBe(2);
    });
});

// ====================================================================
// deriveDefaultEnvState — schema 值忠实度（核心契约：派生值 == schema default）
// ====================================================================

describe('deriveDefaultEnvState — schema value faithfulness', () => {
    it('every derived value deep-equals its schema default', () => {
        // 反推源码不足：原测试只抽验零散字段（skyMode/iblIntensity），
        // 未验证「遍历 schema 派生」的核心契约——每个字段值必须忠实等于对应 default。
        // 这是推导逻辑的回归防线：schema 改 default 而 derivive 漏同步会在全量下暴露。
        for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
            const derived = (defaultEnv as Record<string, unknown>)[key];
            expect(derived, `derived mismatch for key: ${key}`).toEqual(
                (def as { default: unknown }).default,
            );
        }
    });

    it('optional-string field defaults to undefined', () => {
        // lightingPresetName type='optional-string' default=undefined，走 derive 的 else 分支
        expect(defaultEnv.lightingPresetName).toBeUndefined();
    });
});

// ====================================================================
// tuple3 字段克隆隔离（deriveDefaultEnvState 的 slice 策略）
// ====================================================================

describe('tuple3 clone isolation', () => {
    it('two deriveDefaultEnvState calls produce independent tuple3 references', () => {
        const a = deriveDefaultEnvState();
        const b = deriveDefaultEnvState();
        // 引用不同（slice 创建新数组）
        expect(a.skyColorTop).not.toBe(b.skyColorTop);
        expect(a.skyColorMid).not.toBe(b.skyColorMid);
        expect(a.skyColorBot).not.toBe(b.skyColorBot);
        // 值相等
        expect(a.skyColorTop).toEqual(b.skyColorTop);
    });

    it('mutating one derive result tuple3 does not affect another', () => {
        const a = deriveDefaultEnvState();
        const b = deriveDefaultEnvState();
        const originalB = [...b.skyColorTop];
        (a.skyColorTop as number[])[0] = 999;
        expect(b.skyColorTop).toEqual(originalB);
    });

    it('all tuple3 fields are cloned (not shared with schema defaults)', () => {
        // 找出 schema 中所有 tuple3 字段
        const tuple3Keys: string[] = [];
        for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
            if (def.type === 'tuple3') tuple3Keys.push(key);
        }
        expect(tuple3Keys.length).toBeGreaterThan(0);

        const a = deriveDefaultEnvState();
        const b = deriveDefaultEnvState();
        for (const k of tuple3Keys) {
            const valA = (a as Record<string, unknown>)[k];
            const valB = (b as Record<string, unknown>)[k];
            expect(valA).not.toBe(valB);
            expect(valA).toEqual(valB);
        }
    });
});

// ====================================================================
// partial merge 语义
// ====================================================================

describe('EnvState 默认值一致性（partial merge 语义）', () => {
    it('partial merge preserves other fields', () => {
        const state = { ...defaultEnv };
        const updated = Object.assign(state, {
            skyMode: 'procedural' as const,
            skyBrightness: 1.5,
        });
        expect(updated.skyMode).toBe('procedural');
        expect(updated.skyBrightness).toBe(1.5);
        expect(updated.groundVisibleEnabled).toBe(defaultEnv.groundVisibleEnabled);
        expect(updated.iblIntensity).toBe(defaultEnv.iblIntensity);
    });
});

// ====================================================================
// getEnvKeys — dispatch 分组派生
// ====================================================================

describe('getEnvKeys', () => {
    it('returns keys for known group "sky"', () => {
        const keys = getEnvKeys('sky');
        expect(keys.length).toBeGreaterThan(0);
        expect(keys).toContain('skyMode');
        expect(keys).toContain('skyColorTop');
        expect(keys).toContain('iblIntensity');
    });

    it('returns keys for known group "water"', () => {
        const keys = getEnvKeys('water');
        expect(keys).toContain('waterEnabled');
        expect(keys).toContain('waterLevel');
        // 跨组字段：windEnabled group=['particle','water']
        expect(keys).toContain('windEnabled');
        // 跨组字段：groundSize group=['ground','water']
        expect(keys).toContain('groundSize');
    });

    it('returns keys for known group "ground"', () => {
        const keys = getEnvKeys('ground');
        expect(keys).toContain('groundVisibleEnabled');
        expect(keys).toContain('groundColor');
    });

    it('multi-group fields appear in all their groups', () => {
        // windEnabled: group=['particle','water']
        expect(getEnvKeys('particle')).toContain('windEnabled');
        expect(getEnvKeys('water')).toContain('windEnabled');
    });

    it('fields without group are not in any dispatch list', () => {
        // lightingPresetName has no group
        const allGroups = ['sky', 'ground', 'fog', 'water', 'particle', 'cloud', 'reflection', 'mirror', 'collision'] as const;
        for (const g of allGroups) {
            expect(getEnvKeys(g)).not.toContain('lightingPresetName');
        }
    });

    it('returns cached reference on second call', () => {
        const a = getEnvKeys('sky');
        const b = getEnvKeys('sky');
        expect(a).toBe(b); // 同一引用（缓存命中）
    });

    it('every declared-group field appears in all its groups', () => {
        // 反推源码不足：原测试只抽样验证 windEnabled/groundSize 等个别跨组字段，
        // 未全量验证 getEnvKeys 的派生契约——每个声明了 group 的字段必须出现在其所有声明组。
        for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
            const g = (def as { group?: string | readonly string[] }).group;
            if (!g) continue;
            const groups = typeof g === 'string' ? [g] : g;
            for (const grp of groups) {
                expect(
                    getEnvKeys(grp as EnvDispatchGroup),
                    `key ${key} missing in declared group ${grp}`,
                ).toContain(key);
            }
        }
    });

    it('single-group fields appear in exactly their declared group', () => {
        // 组归属精确性：单组字段只应出现在其声明组，不得泄漏进其他任一 dispatch 组。
        const allGroups: EnvDispatchGroup[] = [
            'sky', 'ground', 'fog', 'water', 'particle', 'cloud', 'reflection', 'mirror', 'collision',
        ];
        for (const [key, def] of Object.entries(ENV_STATE_SCHEMA)) {
            const g = (def as { group?: string | readonly string[] }).group;
            if (typeof g !== 'string') continue; // 跨组数组字段由上一测试全量覆盖
            for (const grp of allGroups) {
                const inList = getEnvKeys(grp).includes(key);
                expect(inList, `key ${key}: expect ${g === grp ? 'in' : 'NOT in'} group ${grp}`).toBe(g === grp);
            }
        }
    });

    it('unknown group returns empty array (runtime guard)', () => {
        // EnvDispatchGroup 在编译期收窄，但运行时误传非法组名也应安全返回空数组而非抛错
        expect(getEnvKeys('nonexistent' as unknown as EnvDispatchGroup)).toEqual([]);
    });
});

// ====================================================================
// envState 颜色字段隔离（env-state-integrity 合并）
// ====================================================================

function setColorField<K extends keyof typeof envState>(key: K, value: (typeof envState)[K]) {
    Object.assign(envState, { [key]: value });
}

describe('envState — color field isolation', () => {
    beforeEach(() => {
        envState.skyColorTop = [0.3, 0.5, 0.8];
        envState.skyColorBot = [0.2, 0.2, 0.25];
        envState.skyColorMid = [0.8, 0.8, 0.9];
    });

    it('skyColorTop does not leak into skyColorBot', () => {
        setColorField('skyColorTop', [0.8, 0.2, 0.2]);
        expect(envState.skyColorTop).toEqual([0.8, 0.2, 0.2]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it('skyColorBot does not leak into skyColorTop', () => {
        setColorField('skyColorBot', [0.1, 0.9, 0.3]);
        expect(envState.skyColorBot).toEqual([0.1, 0.9, 0.3]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('skyColorMid is independent', () => {
        setColorField('skyColorMid', [1, 0, 1]);
        expect(envState.skyColorMid).toEqual([1, 0, 1]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it('rapid sequential calls preserve final values', () => {
        setColorField('skyColorTop', [0.5, 0.5, 0.5]);
        setColorField('skyColorBot', [0.7, 0.3, 0.7]);
        setColorField('skyColorTop', [0.9, 0.1, 0.9]);
        setColorField('skyColorBot', [0.2, 0.8, 0.2]);
        expect(envState.skyColorTop).toEqual([0.9, 0.1, 0.9]);
        expect(envState.skyColorBot).toEqual([0.2, 0.8, 0.2]);
    });

    it('iblIntensity does not clobber sky colors', () => {
        setColorField('iblIntensity', 0.5 as any);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('skyBrightness does not clobber sky colors', () => {
        setColorField('skyBrightness', 2 as any);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('mode switch to gradient does not mute color state', () => {
        setColorField('skyMode', 'gradient' as any);
        expect(envState.skyMode).toBe('gradient');
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('rapid skyColorTop drags keep bot unchanged', () => {
        setColorField('skyColorTop', [1, 0, 0]);
        setColorField('skyColorTop', [1, 0.5, 0]);
        setColorField('skyColorTop', [1, 0.5, 0.8]);
        expect(envState.skyColorTop).toEqual([1, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.2, 0.2, 0.25]);
    });

    it('rapid skyColorBot drags keep top unchanged', () => {
        setColorField('skyColorBot', [0, 1, 0]);
        setColorField('skyColorBot', [0, 0, 1]);
        setColorField('skyColorBot', [0.5, 0.5, 0.8]);
        expect(envState.skyColorBot).toEqual([0.5, 0.5, 0.8]);
        expect(envState.skyColorTop).toEqual([0.3, 0.5, 0.8]);
    });

    it('sequential writes keep all RGB channels positive', () => {
        // 原名 "never produces black from color manipulation"——
        // 实际验证的是 Object.assign 整体替换后各通道值 > 0，不涉及颜色计算
        for (let i = 0; i < 10; i++) {
            setColorField('skyColorTop', [0.3 + i * 0.05, 0.5, 0.8]);
            setColorField('skyColorBot', [0.2, 0.2 + i * 0.05, 0.25]);
        }
        expect(envState.skyColorTop[0]).toBeGreaterThan(0);
        expect(envState.skyColorTop[1]).toBeGreaterThan(0);
        expect(envState.skyColorTop[2]).toBeGreaterThan(0);
        expect(envState.skyColorBot[0]).toBeGreaterThan(0);
        expect(envState.skyColorBot[1]).toBeGreaterThan(0);
        expect(envState.skyColorBot[2]).toBeGreaterThan(0);
    });
});
