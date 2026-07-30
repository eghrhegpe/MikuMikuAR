// [doc:adr-155] param-adapters 守护测试：枚举/范围/颜色/实体适配器 + 分发。
// 纯函数测试，不依赖场景模块（entityAdapter 的 resolve 用 mock）。

import { describe, it, expect, vi } from 'vitest';
import {
    enumAdapter,
    rangeAdapter,
    colorAdapter,
    entityAdapter,
    adaptParam,
} from '../param-adapters';
import type { ParamDef } from '../../action-registry';
import type { AdapterResult } from '../param-adapters';

/** 提取 error 消息（将 "ok:false" 结果的 error 字段转为 string）。 */
const errMsg = (r: AdapterResult): string => (r as { error: string }).error;

function def(overrides: Partial<ParamDef> & { name: string; type: ParamDef['type'] }): ParamDef {
    return { name: 'p', ...overrides } as ParamDef;
}

describe('enumAdapter', () => {
    it('合法值通过', () => {
        const r = enumAdapter(
            def({ name: 'mode', type: 'enum', enum: ['orbit', 'freefly', 'surround'] }),
            'orbit'
        );
        expect(r).toEqual({ ok: true, value: 'orbit' });
    });

    it('同义词映射后通过', () => {
        const r = enumAdapter(
            def({
                name: 'mode',
                type: 'enum',
                enum: ['quality', 'balanced', 'performance'],
                synonyms: { high: 'quality', low: 'performance' },
            }),
            'high'
        );
        expect(r).toEqual({ ok: true, value: 'quality' });
    });

    it('非法值返回错误', () => {
        const r = enumAdapter(
            def({ name: 'mode', type: 'enum', enum: ['a', 'b'] }),
            'c'
        );
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('不在可选范围');
    });

    it('同义词查找 case-insensitive（val 侧 lowercase）', () => {
        const r = enumAdapter(
            def({
                name: 'mode',
                type: 'enum',
                enum: ['quality'],
                synonyms: { high: 'quality' },
            }),
            'HIGH'
        );
        expect(r).toEqual({ ok: true, value: 'quality' });
    });
});

describe('rangeAdapter', () => {
    it('合法数值通过', () => {
        const r = rangeAdapter(
            def({ name: 'val', type: 'range', min: 0, max: 1 }),
            0.5
        );
        expect(r).toEqual({ ok: true, value: 0.5 });
    });

    it('超过上限返回错误', () => {
        const r = rangeAdapter(
            def({ name: 'val', type: 'range', min: 0, max: 1 }),
            2
        );
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('超出范围');
    });

    it('低于下限返回错误', () => {
        const r = rangeAdapter(
            def({ name: 'val', type: 'range', min: 0, max: 1 }),
            -1
        );
        expect(r.ok).toBe(false);
    });

    it('NaN 返回错误', () => {
        const r = rangeAdapter(
            def({ name: 'val', type: 'range' }),
            'abc'
        );
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('不是有效数值');
    });

    it('无 min/max 时不过界校验', () => {
        const r = rangeAdapter(def({ name: 'val', type: 'range' }), 999);
        expect(r).toEqual({ ok: true, value: 999 });
    });
});

describe('colorAdapter', () => {
    it('hex #rrggbb 字符串解析', () => {
        const r = colorAdapter(def({ name: 'c', type: 'color' }), '#ff8800');
        expect(r).toEqual({ ok: true, value: [1, 0.5333333333333333, 0] });
    });

    it('无 # 前缀的 hex 也支持', () => {
        const r = colorAdapter(def({ name: 'c', type: 'color' }), 'ff0000');
        expect(r).toEqual({ ok: true, value: [1, 0, 0] });
    });

    it('RGB 数组直接通过', () => {
        const r = colorAdapter(def({ name: 'c', type: 'color' }), [0.5, 0.5, 0.5]);
        expect(r).toEqual({ ok: true, value: [0.5, 0.5, 0.5] });
    });

    it('非法 hex 返回错误', () => {
        const r = colorAdapter(def({ name: 'c', type: 'color' }), 'not-a-color');
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('不是有效 hex 颜色');
    });

    it('RGB 数组长度不为 3 回退 hex 解析', () => {
        const r = colorAdapter(def({ name: 'c', type: 'color' }), [1, 2]);
        expect(r.ok).toBe(false);
    });
});

describe('entityAdapter', () => {
    it('名称匹配时返回解析结果', async () => {
        const resolve = vi.fn(async (name: string) => ({ id: name, file_path: `${name}.pmx` }));
        const r = await entityAdapter(
            def({ name: 'name', type: 'entity', resolve }),
            'miku'
        );
        expect(r).toEqual({ ok: true, value: { id: 'miku', file_path: 'miku.pmx' } });
        expect(resolve).toHaveBeenCalledWith('miku');
    });

    it('空名称返回错误', async () => {
        const r = await entityAdapter(
            def({ name: 'name', type: 'entity', resolve: async () => null }),
            ''
        );
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('为空');
    });

    it('resolve 返回 null 时返回未找到', async () => {
        const resolve = vi.fn(async () => null);
        const r = await entityAdapter(
            def({ name: 'name', type: 'entity', resolve }),
            'nope'
        );
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('未找到');
    });

    it('无 resolve 函数返回错误', async () => {
        const r = await entityAdapter(
            def({ name: 'name', type: 'entity' }),
            'anything'
        );
        expect(r.ok).toBe(false);
        expect(errMsg(r)).toContain('不支持运行时解析');
    });
});

describe('adaptParam', () => {
    it('enum 类型分发到 enumAdapter', () => {
        const r = adaptParam(
            def({ name: 'm', type: 'enum', enum: ['a', 'b'] }),
            'a'
        );
        expect(r).toEqual({ ok: true, value: 'a' });
    });

    it('string 类型直接透传', () => {
        const r = adaptParam(
            def({ name: 's', type: 'string' }),
            'hello'
        ) as { ok: true; value: string };
        expect(r.value).toBe('hello');
    });

    it('boolean 类型转换', () => {
        const r = adaptParam(
            def({ name: 'b', type: 'boolean' }),
            true
        ) as { ok: true; value: boolean };
        expect(r.value).toBe(true);
    });

    it('toggle 类型转换', () => {
        const r = adaptParam(
            def({ name: 't', type: 'toggle' }),
            false
        ) as { ok: true; value: boolean };
        expect(r.value).toBe(false);
    });

    it('不支持的参数类型返回错误', () => {
        const r = adaptParam(
            { name: 'x', type: 'unsupported' as ParamDef['type'] },
            'val'
        );
        expect(r).toEqual({ ok: false, error: '不支持的参数类型: unsupported' });
    });
});