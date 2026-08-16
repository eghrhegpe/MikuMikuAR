// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logInfo, logWarn, logError, logDebug, __debugLog, setDebugLog, getDebugLog, getLogBuffer, clearLogs } from '../logger';

describe('logger', () => {
    beforeEach(() => {
        clearLogs();
        setDebugLog(false);
    });

    it('logInfo formats [tag] message', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logInfo('test', 'hello');
        expect(spy).toHaveBeenCalledWith('[test] hello');
        spy.mockRestore();
    });

    it('logInfo with empty message omits space', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logInfo('test', '');
        expect(spy).toHaveBeenCalledWith('[test]');
        spy.mockRestore();
    });

    it('logInfo with extra args', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logInfo('test', 'msg', 'a', 1);
        expect(spy).toHaveBeenCalledWith('[test] msg', 'a', 1);
        spy.mockRestore();
    });

    it('logWarn formats [tag] message', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logWarn('test', 'warn');
        expect(spy).toHaveBeenCalledWith('[test] warn');
        spy.mockRestore();
    });

    it('logWarn with error passes error as second arg', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = new Error('test');
        logWarn('test', 'warn', err);
        expect(spy).toHaveBeenCalledWith('[test] warn', err);
        spy.mockRestore();
    });

    it('logError formats [tag] message', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logError('test', 'err');
        expect(spy).toHaveBeenCalledWith('[test] err');
        spy.mockRestore();
    });

    describe('logDebug', () => {
        it('当 __debugLog=false 时静默不输出', () => {
            setDebugLog(false);
            const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
            logDebug('test', 'hello');
            expect(spy).not.toHaveBeenCalled();
            expect(getLogBuffer().getAll()).toHaveLength(0);
            spy.mockRestore();
        });

        it('当 __debugLog=true 时写入 buffer + console', () => {
            setDebugLog(true);
            const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
            logDebug('test', 'hello');
            expect(spy).toHaveBeenCalledWith('[test] hello');
            expect(getLogBuffer().getAll()).toHaveLength(1);
            expect(getLogBuffer().getAll()[0].message).toBe('[test] hello');
            spy.mockRestore();
        });

        it('getDebugLog / setDebugLog 读写正确', () => {
            expect(getDebugLog()).toBe(false);
            setDebugLog(true);
            expect(getDebugLog()).toBe(true);
            setDebugLog(false);
            expect(getDebugLog()).toBe(false);
        });

        it('__debugLog 是响应式对象（共享引用）', () => {
            setDebugLog(true);
            expect(__debugLog.value).toBe(true);
        });
    });
});
