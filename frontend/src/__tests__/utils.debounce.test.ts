// @vitest-environment node
// [doc:adr-101] P3 工具函数单测：debounce（core/debounce.ts）
// 范式对齐 utils.async.test.ts：node 环境直接对全局 setTimeout 做 spy，
// 验证 debounce 传递到 setTimeout 的 delay 参数（NaN 归一 / Infinity 保留）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { debounce } from '../core/debounce';

describe('ADR-101 P3: debounce delay 归一（[audit:fix 2026-10]）', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    /** 捕获 setTimeout 收到的 delay 参数（不真正调度，避免污染 runner）。 */
    function captureDelay(fn: () => void, ms: number): number | undefined {
        const spy = vi
            .spyOn(globalThis, 'setTimeout')
            .mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const debounced = debounce(fn, ms);
        debounced();
        const delay = spy.mock.calls[0]?.[1];
        spy.mockRestore();
        return delay;
    }

    it('debounce(fn, NaN) 传入 delay === 0（不再依赖 setTimeout 的隐式强转）', () => {
        expect(captureDelay(() => {}, NaN)).toBe(0);
    });

    it('debounce(fn, Infinity) 保留 Infinity（合法「永不执行」语义）', () => {
        expect(captureDelay(() => {}, Infinity)).toBe(Infinity);
    });

    it('正常延迟原样透传（500 → 500）', () => {
        expect(captureDelay(() => {}, 500)).toBe(500);
    });

    it('负数原样透传（setTimeout 本就按 0 处理，非本修复范围）', () => {
        expect(captureDelay(() => {}, -5)).toBe(-5);
    });

    it('cancel() 清掉 pending 定时器（clearTimeout 收到 setTimeout 返回的 id）', () => {
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 42 as unknown as ReturnType<typeof setTimeout>);
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
        const debounced = debounce(() => {}, 100);
        debounced();
        debounced.cancel();
        expect(clearSpy).toHaveBeenCalledWith(42);
        clearSpy.mockRestore();
    });

    it('cancel() 对无 pending timer 安全（no-op 不抛）', () => {
        const debounced = debounce(() => {}, 100);
        expect(() => debounced.cancel()).not.toThrow();
    });
});
