// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    logInfo,
    logWarn,
    logError,
    logDebug,
    __debugLog,
    setDebugLog,
    getDebugLog,
    getLogBuffer,
    clearLogs,
} from '../logger';

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

    // [audit:fix 2026-09] round74 diff-coverage 收口：clear() 的逐监听 try/catch 隔离路径
    describe('监听器异常隔离', () => {
        it('clear()：抛错监听器不阻断其余监听器', () => {
            const buffer = getLogBuffer();
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const good = vi.fn();
            const unsubBad = buffer.subscribe(() => {
                throw new Error('listener-throw');
            });
            const unsubGood = buffer.subscribe(good);
            buffer.clear();
            expect(good).toHaveBeenCalledTimes(1);
            expect(errSpy).toHaveBeenCalledWith('[logger] listener error:', expect.any(Error));
            unsubBad();
            unsubGood();
            errSpy.mockRestore();
        });

        it('push()：抛错监听器不阻断其余监听器', () => {
            const buffer = getLogBuffer();
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const good = vi.fn();
            const unsubBad = buffer.subscribe(() => {
                throw new Error('push-throw');
            });
            const unsubGood = buffer.subscribe(good);
            logWarn('iso', 'probe');
            expect(good).toHaveBeenCalledTimes(1);
            expect(errSpy).toHaveBeenCalledWith('[logger] listener error:', expect.any(Error));
            unsubBad();
            unsubGood();
            errSpy.mockRestore();
        });
    });
});
