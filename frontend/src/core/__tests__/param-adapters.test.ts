// @vitest-environment node
// [doc:adr-155] param-adapters 守护测试（合并 ai/__tests__ 同版，audit:round17 P3）。
// 纯函数测试，不依赖场景模块（entityAdapter 的 resolve 用 mock）。
import { describe, it, expect, vi } from 'vitest';
import {
    enumAdapter,
    rangeAdapter,
    colorAdapter,
    entityAdapter,
    adaptParam,
} from '../ai/param-adapters';
import type { ParamDef } from '../action-registry';
import type { AdapterResult } from '../ai/param-adapters';

function def(overrides: Partial<ParamDef>): ParamDef {
    return { name: 'test', type: 'string', ...overrides } as ParamDef;
}

/** 提取 error 消息（将 "ok:false" 结果的 error 字段转为 string）。 */
const errMsg = (r: AdapterResult): string => (r as { error: string }).error;

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
        expect(errMsg(r)).toContain('不在可选范围');
    });

    it('空 enum 列表总是返回错误', () => {
        const r = enumAdapter(def({ type: 'enum', enum: [] }), 'anything');
        expect(r.ok).toBe(false);
    });

    it('直接值匹配大小写不敏感（audit:round17）', () => {
        const r = enumAdapter(def({ type: 'enum', enum: ['orbit', 'freefly'] }), 'ORBIT');
        expect(r).toEqual({ ok: true, value: 'orbit' });
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
        expect(errMsg(r)).toContain('超出范围');
    });

    it('NaN 返回错误', () => {
        const r = rangeAdapter(def({ type: 'range' }), NaN);
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('不是有效数值');
    });

    it('无 min/max 时无限范围', () => {
        const r = rangeAdapter(def({ type: 'range' }), 1e9);
        expect(r).toEqual({ ok: true, value: 1e9 });
    });

    it('宽松转换拒绝 null/空串/布尔/数组（audit:round17）', () => {
        expect(rangeAdapter(def({ type: 'range', min: 0, max: 1 }), null).ok).toBe(false);
        expect(rangeAdapter(def({ type: 'range', min: 0, max: 1 }), '').ok).toBe(false);
        expect(rangeAdapter(def({ type: 'range', min: 0, max: 1 }), true).ok).toBe(false);
        expect(rangeAdapter(def({ type: 'range', min: 0, max: 1 }), []).ok).toBe(false);
        // 非空数字字符串仍支持
        expect(rangeAdapter(def({ type: 'range', min: 0, max: 1 }), '0.5')).toEqual({
            ok: true,
            value: 0.5,
        });
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
        expect(errMsg(r)).toContain('不是有效 hex 颜色');
    });

    it('空字符串', () => {
        const r = colorAdapter(def({ type: 'color' }), '');
        expect(r.ok).toBe(false);
    });

    it('RGB 数组值域越界/NaN 拒绝（audit:round17）', () => {
        expect(colorAdapter(def({ type: 'color' }), [2, 0, 0]).ok).toBe(false);
        expect(colorAdapter(def({ type: 'color' }), [-1, 0, 0]).ok).toBe(false);
        expect(colorAdapter(def({ type: 'color' }), [NaN, 0, 0]).ok).toBe(false);
        // 边界值 0 与 1 合法
        expect(colorAdapter(def({ type: 'color' }), [0, 1, 0.5])).toEqual({
            ok: true,
            value: [0, 1, 0.5],
        });
    });
});

describe('entityAdapter', () => {
    it('名称匹配时返回已解析实体', async () => {
        const resolve = vi.fn(async (name: string) => (name === 'miku' ? { id: 1 } : null));
        const r = await entityAdapter(def({ type: 'entity', resolve }), 'miku');
        expect(r).toEqual({ ok: true, value: { id: 1 } });
        expect(resolve).toHaveBeenCalledWith('miku');
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
        expect(errMsg(r)).toContain('未找到');
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
        expect(errMsg(r)).toContain('为空');
    });

    it('无 resolve 函数时返回错误', async () => {
        const r = await entityAdapter(def({ type: 'entity' }), 'miku');
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('不支持运行时解析');
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

    it('boolean 字符串黑名单 → false（round18 修复守护，audit:round17）', () => {
        // LLM 可能传字符串 "false"/"0"/"off" 等，直接 Boolean(s)===true 会语义反转；
        // 该修复此前无回归测试守护（ADR-219 同型风险）。
        for (const s of ['false', '0', 'off', 'no', 'null', 'undefined', '']) {
            const r = adaptParam(def({ type: 'boolean' }), s) as { ok: true; value: boolean };
            expect(r.value).toBe(false);
        }
        // 真值字符串保持 true
        expect(
            (adaptParam(def({ type: 'boolean' }), 'true') as { ok: true; value: boolean }).value
        ).toBe(true);
        expect(
            (adaptParam(def({ type: 'boolean' }), 'yes') as { ok: true; value: boolean }).value
        ).toBe(true);
    });
});
