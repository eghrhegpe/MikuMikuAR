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
});
