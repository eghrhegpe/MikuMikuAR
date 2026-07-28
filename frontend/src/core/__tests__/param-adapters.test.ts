import { describe, it, expect } from 'vitest';
import {
    enumAdapter,
    rangeAdapter,
    colorAdapter,
    entityAdapter,
    adaptParam,
} from '../ai/param-adapters';
import type { ParamDef } from '../action-registry';

function def(overrides: Partial<ParamDef>): ParamDef {
    return { name: 'test', type: 'string', ...overrides } as ParamDef;
}

describe('enumAdapter', () => {
    it('匹配有效值', () => {
        const r = enumAdapter(def({ type: 'enum', enum: ['orbit', 'freefly'] }), 'orbit');
        expect(r).toEqual({ ok: true, value: 'orbit' });
    });

    it('通过同义词映射', () => {
        const r = enumAdapter(
            def({ type: 'enum', enum: ['freefly'], synonyms: { follow: 'freefly' } }),
            'follow'
        );
        expect(r).toEqual({ ok: true, value: 'freefly' });
    });

    it('同义词匹配不区分输入大小写', () => {
        const r = enumAdapter(
            def({ type: 'enum', enum: ['freefly'], synonyms: { follow: 'freefly' } }),
            'FOLLOW'
        );
        expect(r).toEqual({ ok: true, value: 'freefly' });
    });

    it('非法值返回错误', () => {
        const r = enumAdapter(def({ type: 'enum', enum: ['a', 'b'] }), 'c');
        expect(r.ok).toBe(false);
    });

    it('空 enum 列表总是返回错误', () => {
        const r = enumAdapter(def({ type: 'enum', enum: [] }), 'anything');
        expect(r.ok).toBe(false);
    });
});

describe('rangeAdapter', () => {
    it('范围内的数值', () => {
        const r = rangeAdapter(def({ type: 'range', min: 0, max: 1 }), 0.5);
        expect(r).toEqual({ ok: true, value: 0.5 });
    });

    it('字符串形式数值', () => {
        const r = rangeAdapter(def({ type: 'range', min: 0, max: 10 }), '5');
        expect(r).toEqual({ ok: true, value: 5 });
    });

    it('小于最小值', () => {
        const r = rangeAdapter(def({ type: 'range', min: 0, max: 1 }), -1);
        expect(r.ok).toBe(false);
    });

    it('大于最大值', () => {
        const r = rangeAdapter(def({ type: 'range', min: 0, max: 1 }), 2);
        expect(r.ok).toBe(false);
    });

    it('NaN 返回错误', () => {
        const r = rangeAdapter(def({ type: 'range' }), NaN);
        expect(r.ok).toBe(false);
    });

    it('无 min/max 时无限范围', () => {
        const r = rangeAdapter(def({ type: 'range' }), 1e9);
        expect(r).toEqual({ ok: true, value: 1e9 });
    });
});

describe('colorAdapter', () => {
    it('#rrggbb 字符串', () => {
        const r = colorAdapter(def({ type: 'color' }), '#ff8800');
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value[0]).toBe(1);
            expect(r.value[1]).toBeCloseTo(0.53333, 5);
            expect(r.value[2]).toBe(0);
        }
    });

    it('无 # 前缀 hex', () => {
        const r = colorAdapter(def({ type: 'color' }), 'ff0088');
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value[0]).toBe(1);
            expect(r.value[1]).toBe(0);
            expect(r.value[2]).toBeCloseTo(0.53333, 5);
        }
    });

    it('RGB 数组', () => {
        const r = colorAdapter(def({ type: 'color' }), [0.5, 0.2, 0.8]);
        expect(r).toEqual({ ok: true, value: [0.5, 0.2, 0.8] });
    });

    it('数组长度不为 3', () => {
        const r = colorAdapter(def({ type: 'color' }), [0.5, 0.2]);
        expect(r.ok).toBe(false);
    });

    it('非法 hex', () => {
        const r = colorAdapter(def({ type: 'color' }), 'not-a-color');
        expect(r.ok).toBe(false);
    });

    it('空字符串', () => {
        const r = colorAdapter(def({ type: 'color' }), '');
        expect(r.ok).toBe(false);
    });
});

describe('entityAdapter', () => {
    it('名称匹配时返回已解析实体', async () => {
        const r = await entityAdapter(
            def({
                type: 'entity',
                resolve: async (name: string) => (name === 'miku' ? { id: 1 } : null),
            }),
            'miku'
        );
        expect(r).toEqual({ ok: true, value: { id: 1 } });
    });

    it('名称不匹配时返回错误', async () => {
        const r = await entityAdapter(
            def({
                type: 'entity',
                resolve: async () => null,
            }),
            'unknown'
        );
        expect(r.ok).toBe(false);
    });

    it('空名称', async () => {
        const r = await entityAdapter(
            def({
                type: 'entity',
                resolve: async () => null,
            }),
            ''
        );
        expect(r.ok).toBe(false);
    });

    it('无 resolve 函数时返回错误', async () => {
        const r = await entityAdapter(def({ type: 'entity' }), 'miku');
        expect(r.ok).toBe(false);
    });

    it('resolve 抛异常时返回错误', async () => {
        const r = await entityAdapter(
            def({
                type: 'entity',
                resolve: async () => {
                    throw new Error('db error');
                },
            }),
            'miku'
        );
        expect(r.ok).toBe(false);
    });
});

describe('adaptParam', () => {
    it('委托到对应适配器', () => {
        const r = adaptParam(def({ type: 'range', min: 0, max: 1 }), 0.5);
        expect(r).toEqual({ ok: true, value: 0.5 });
    });

    it('string 直通适配器（原样透传字符串，不校验）', () => {
        const r = adaptParam(def({ type: 'string' }), 'hello');
        expect(r).toEqual({ ok: true, value: 'hello' });
    });

    it('不支持的参数类型', () => {
        const r = adaptParam(def({ type: 'nonexistent' as ParamDef['type'] }), 'hello');
        expect(r).toEqual({ ok: false, error: '不支持的参数类型: nonexistent' });
    });

    it('boolean 适配器', () => {
        const r = adaptParam(def({ type: 'boolean' }), true);
        expect(r).toEqual({ ok: true, value: true });
    });

    it('toggle 适配器', () => {
        const r = adaptParam(def({ type: 'toggle' }), false);
        expect(r).toEqual({ ok: true, value: false });
    });
});
