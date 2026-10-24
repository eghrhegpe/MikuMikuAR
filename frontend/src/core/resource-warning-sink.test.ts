// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// [feature:resource-warning-sink] 验证「去重 + debounce 合并为单条 toast」的核心行为。
vi.mock('@/core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('@/core/i18n/t', () => ({
    t: (k: string, p?: Record<string, unknown>) => `${k}:${JSON.stringify(p ?? {})}`,
}));
vi.mock('@/core/logger', () => ({ logWarn: vi.fn() }));

import { reportResourceWarning } from './resource-warning-sink';
import { showInfoToast } from '@/core/toast';
import { logWarn } from '@/core/logger';

describe('resource-warning-sink', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.advanceTimersByTime(400); // 触发 flush，清空模块级 pending
        vi.useRealTimers();
    });

    it('merges multiple warnings within the debounce window into one toast', () => {
        reportResourceWarning('tex A');
        reportResourceWarning('tex B');
        vi.advanceTimersByTime(400);
        expect(showInfoToast).toHaveBeenCalledTimes(1);
        const detail = (showInfoToast as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
        expect(detail).toContain('tex A');
        expect(detail).toContain('tex B');
    });

    it('dedupes identical messages', () => {
        reportResourceWarning('same');
        reportResourceWarning('same');
        vi.advanceTimersByTime(400);
        expect(showInfoToast).toHaveBeenCalledTimes(1);
    });

    it('emits a logWarn summary alongside the toast', () => {
        reportResourceWarning('x');
        vi.advanceTimersByTime(400);
        expect(logWarn).toHaveBeenCalled();
    });
    it('truncates detail to first 8 items when >8 unique warnings', () => {
        for (let i = 1; i <= 10; i++) {
            reportResourceWarning('tex ' + i);
        }
        vi.advanceTimersByTime(400);
        expect(showInfoToast).toHaveBeenCalledTimes(1);
        const detail = (showInfoToast as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
        expect(detail).toContain('tex 8');
        expect(detail).toContain(' …+2');
        expect(detail).not.toContain('tex 9');
    });

    it('showInfoToast throws → silent degrade, logWarn still emitted', () => {
        vi.mocked(showInfoToast).mockImplementation(() => {
            throw new Error('toast channel unavailable');
        });
        expect(() => {
            reportResourceWarning('boom');
            vi.advanceTimersByTime(400);
        }).not.toThrow();
        expect(vi.mocked(logWarn)).toHaveBeenCalledWith(
            'resource-warning',
            expect.anything(),
            expect.anything()
        );
        vi.mocked(showInfoToast).mockImplementation(() => {});
    });
});
